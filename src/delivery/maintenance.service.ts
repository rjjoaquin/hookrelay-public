import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { config, usesRedis } from '../config';
import { PrismaService } from '../prisma.service';
import { DeliveryQueue } from './queues';

/**
 * Outbox-style recovery: deliveries are written to the database before being queued. If Redis was
 * unavailable or a job was lost, this sweep re-enqueues them (jobId dedupe makes it safe).
 * Also purges expired sessions and events older than EVENT_RETENTION_DAYS.
 */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Maintenance');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: DeliveryQueue,
  ) {}

  onModuleInit(): void {
    if (!config.runWorker) return;
    // Without Redis the in-process queue is the only worker, so orphaned deliveries (from a restart
    // or the seed script) can be picked up quickly; with Redis, only clearly stuck ones are.
    const every = usesRedis ? 60_000 : 3_000;
    this.timers.push(setInterval(() => this.recover().catch((e) => this.log.error(e.message)), every));
    this.timers.push(setInterval(() => this.purge().catch((e) => this.log.error(e.message)), 3_600_000));
    for (const t of this.timers) t.unref();
  }

  onModuleDestroy(): void {
    this.timers.forEach(clearInterval);
  }

  async recover(): Promise<number> {
    const now = Date.now();
    const [pendingGrace, retryGrace] = usesRedis ? [60_000, 5 * 60_000] : [0, 0];
    const stuck = await this.prisma.db.delivery.findMany({
      where: {
        OR: [
          { status: 'pending', updatedAt: { lt: new Date(now - pendingGrace) } },
          { status: 'retrying', nextAttemptAt: { lte: new Date(now - retryGrace) } },
        ],
      },
      select: { id: true },
      take: 500,
    });
    if (stuck.length) await this.queues.requeue(stuck.map((r) => r.id));
    return stuck.length;
  }

  async purge(): Promise<void> {
    await this.prisma.db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    if (!config.eventRetentionDays) return;
    // Batched delete so a large backlog never holds one huge lock. Works on PostgreSQL and SQLite.
    const cutoff = new Date(Date.now() - config.eventRetentionDays * 86_400_000);
    const old = await this.prisma.db.event.findMany({ where: { receivedAt: { lt: cutoff } }, select: { id: true }, take: 5000 });
    const { count } = await this.prisma.db.event.deleteMany({ where: { id: { in: old.map((e) => e.id) } } });
    if (count) this.log.log(`Purged ${count} events older than ${config.eventRetentionDays} days`);
  }
}
