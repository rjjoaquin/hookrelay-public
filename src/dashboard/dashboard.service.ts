import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { config } from '../config';
import { newSecret } from '../common/crypto';
import { validateDestinationUrl } from '../common/ssrf';
import { validateTransform } from '../common/transform';
import { DeliveryQueue } from '../delivery/queues';
import { DeliveryStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateSourceDto, ListEventsQuery, UpdateSourceDto } from './dto';

// Caps stop one account from turning a single webhook into a large fan-out.
const MAX_SOURCES_PER_USER = 50;
const MAX_DESTINATIONS_PER_SOURCE = 10;

/**
 * Every query is scoped to the signed-in user. Ownership is enforced in the WHERE clause
 * (never fetched-then-checked), so a foreign id behaves exactly like a missing one: 404.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: DeliveryQueue,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  private ownedSource = (userId: string) => ({ userId });
  private ownedDestination = (userId: string) => ({ source: { userId } });
  private ownedDelivery = (userId: string) => ({ event: { source: { userId } } });

  async stats(userId: string) {
    const rows = await this.db.delivery.groupBy({
      by: ['status'],
      where: { ...this.ownedDelivery(userId), replayedAt: null, createdAt: { gt: new Date(Date.now() - 86_400_000) } },
      _count: { _all: true },
    });
    const out: Record<DeliveryStatus, number> = { pending: 0, retrying: 0, succeeded: 0, dead: 0 };
    for (const r of rows) out[r.status] = r._count._all;
    return out;
  }

  // ---- Sources ----

  listSources(userId: string) {
    return this.db.source.findMany({
      where: this.ownedSource(userId),
      include: { destinations: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createSource(userId: string, dto: CreateSourceDto) {
    const base = dto.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'relay';
    const slug = `${base}-${randomBytes(5).toString('hex')}`; // unguessable ingest URL
    const inboundSecret = dto.requireSignature ? newSecret('whin') : null;
    let destination: { id: string; url: string; signingSecret: string } | undefined;
    if (dto.destinationUrl) this.assertUrl(dto.destinationUrl);
    if ((await this.db.source.count({ where: { userId } })) >= MAX_SOURCES_PER_USER) {
      throw new BadRequestException(`Limit of ${MAX_SOURCES_PER_USER} relays reached`);
    }
    const source = await this.db.source.create({
      data: { userId, name: dto.name, slug, requiresSignature: !!inboundSecret, inboundSecret },
    });
    if (dto.destinationUrl) destination = await this.addDestination(userId, source.id, dto.destinationUrl);
    return { id: source.id, name: source.name, slug, inboundSecret, destination };
  }

  async updateSource(userId: string, id: string, dto: UpdateSourceDto) {
    const data: Prisma.SourceUpdateManyMutationInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.clearTransform) data.transform = Prisma.DbNull;
    else if (dto.transform !== undefined && dto.transform !== null) {
      const err = validateTransform(dto.transform);
      if (err) throw new BadRequestException(err);
      data.transform = dto.transform as Prisma.InputJsonObject;
    }
    await this.mustAffect(this.db.source.updateMany({ where: { id, ...this.ownedSource(userId) }, data }));
    return this.db.source.findFirstOrThrow({ where: { id, ...this.ownedSource(userId) } });
  }

  async deleteSource(userId: string, id: string) {
    await this.mustAffect(this.db.source.deleteMany({ where: { id, ...this.ownedSource(userId) } }));
  }

  async rotateInboundSecret(userId: string, id: string) {
    const inboundSecret = newSecret('whin');
    await this.mustAffect(
      this.db.source.updateMany({ where: { id, ...this.ownedSource(userId) }, data: { inboundSecret, requiresSignature: true } }),
    );
    return { inboundSecret };
  }

  async disableInboundSignature(userId: string, id: string) {
    await this.mustAffect(
      this.db.source.updateMany({ where: { id, ...this.ownedSource(userId) }, data: { inboundSecret: null, requiresSignature: false } }),
    );
  }

  // ---- Destinations ----

  async addDestination(userId: string, sourceId: string, url: string) {
    this.assertUrl(url);
    const owned = await this.db.source.findFirst({
      where: { id: sourceId, ...this.ownedSource(userId) },
      select: { _count: { select: { destinations: true } } },
    });
    if (!owned) throw new NotFoundException();
    if (owned._count.destinations >= MAX_DESTINATIONS_PER_SOURCE) {
      throw new BadRequestException(`Limit of ${MAX_DESTINATIONS_PER_SOURCE} destinations per relay reached`);
    }
    const signingSecret = newSecret('whsec');
    const d = await this.db.destination.create({ data: { sourceId, url, signingSecret } });
    return { id: d.id, url: d.url, signingSecret };
  }

  async setDestinationEnabled(userId: string, id: string, enabled: boolean) {
    await this.mustAffect(this.db.destination.updateMany({ where: { id, ...this.ownedDestination(userId) }, data: { enabled } }));
  }

  async deleteDestination(userId: string, id: string) {
    await this.mustAffect(this.db.destination.deleteMany({ where: { id, ...this.ownedDestination(userId) } }));
  }

  async rotateDestinationSecret(userId: string, id: string) {
    const signingSecret = newSecret('whsec');
    await this.mustAffect(
      this.db.destination.updateMany({ where: { id, ...this.ownedDestination(userId) }, data: { signingSecret } }),
    );
    return { signingSecret };
  }

  // ---- Events & deliveries ----

  async listEvents(userId: string, q: ListEventsQuery) {
    const rows = await this.db.event.findMany({
      where: {
        source: { userId, ...(q.sourceId ? { id: q.sourceId } : {}) },
        ...(q.before ? { receivedAt: { lt: new Date(q.before) } } : {}),
        ...(q.status ? { deliveries: { some: { status: q.status as DeliveryStatus } } } : {}),
      },
      select: { id: true, receivedAt: true, sourceId: true, source: { select: { name: true } }, deliveries: { select: { status: true } } },
      orderBy: { receivedAt: 'desc' },
      take: q.limit ?? 50,
    });
    return rows.map((r) => ({
      id: r.id,
      receivedAt: r.receivedAt,
      sourceId: r.sourceId,
      sourceName: r.source.name,
      statuses: [...new Set(r.deliveries.map((d) => d.status))],
    }));
  }

  async getEvent(userId: string, id: string) {
    const event = await this.db.event.findFirst({
      where: { id, source: { userId } },
      include: {
        source: { select: { id: true, name: true } },
        deliveries: {
          orderBy: { createdAt: 'asc' },
          include: { destination: { select: { url: true } }, attemptLog: { orderBy: { attemptNumber: 'asc' } } },
        },
      },
    });
    if (!event) throw new NotFoundException();
    const { deliveries, ...rest } = event;
    return {
      ...rest,
      deliveries: deliveries.map(({ destination, attemptLog, attempts, ...d }) => ({
        ...d,
        attemptCount: attempts,
        url: destination.url,
        attempts: attemptLog,
      })),
    };
  }

  async listDead(userId: string) {
    const rows = await this.db.delivery.findMany({
      where: { status: 'dead', replayedAt: null, ...this.ownedDelivery(userId) },
      include: { destination: { select: { url: true } }, event: { select: { source: { select: { name: true } } } } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return rows.map((d) => ({
      id: d.id,
      eventId: d.eventId,
      sourceName: d.event.source.name,
      url: d.destination.url,
      attempts: d.attempts,
      lastError: d.lastError,
      updatedAt: d.updatedAt,
    }));
  }

  async replayEvent(userId: string, eventId: string) {
    const event = await this.db.event.findFirst({ where: { id: eventId, source: { userId } }, select: { id: true, sourceId: true } });
    if (!event) throw new NotFoundException();
    const dests = await this.db.destination.findMany({ where: { sourceId: event.sourceId, enabled: true }, select: { id: true } });
    const rows = await this.db.delivery.createManyAndReturn({
      data: dests.map((d) => ({ eventId, destinationId: d.id })),
      select: { id: true },
    });
    await this.queues.enqueue(rows.map((r) => r.id));
    return { replayed: rows.length };
  }

  async replayDeliveries(userId: string, ids: string[]) {
    const originals = await this.db.delivery.findMany({
      where: { id: { in: ids }, status: 'dead', replayedAt: null, ...this.ownedDelivery(userId) },
      select: { id: true, eventId: true, destinationId: true },
    });
    const created: string[] = [];
    for (const d of originals) {
      const fresh = await this.db.$transaction(async (tx) => {
        // Claim the dead delivery so concurrent clicks cannot replay it twice.
        const claimed = await tx.delivery.updateMany({ where: { id: d.id, replayedAt: null }, data: { replayedAt: new Date() } });
        if (!claimed.count) return null;
        return tx.delivery.create({ data: { eventId: d.eventId, destinationId: d.destinationId, replayOf: d.id }, select: { id: true } });
      });
      if (!fresh) continue;
      created.push(fresh.id);
      await this.queues.unpark(d.id).catch(() => undefined);
    }
    await this.queues.enqueue(created);
    return { replayed: created.length };
  }

  async replayAllDead(userId: string) {
    const rows = await this.db.delivery.findMany({
      where: { status: 'dead', replayedAt: null, ...this.ownedDelivery(userId) },
      select: { id: true },
      take: 1000,
    });
    return this.replayDeliveries(userId, rows.map((r) => r.id));
  }

  private assertUrl(url: string) {
    const err = validateDestinationUrl(url, config.allowPrivateDestinations);
    if (err) throw new BadRequestException(err);
  }

  private async mustAffect(op: Promise<{ count: number }>) {
    if (!(await op).count) throw new NotFoundException();
  }
}
