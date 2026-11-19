import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { config } from '../config';
import { DeliveryRunner } from './delivery.runner';
import { DeliveryQueue } from './queues';

/**
 * In-process delivery queue used when REDIS_URL is not set (local development only).
 * Same retry/backoff/dead-letter behaviour as BullMQ, but jobs live in memory: the database is the
 * source of truth and MaintenanceService re-enqueues anything pending after a restart.
 */
@Injectable()
export class MemoryDeliveryQueue extends DeliveryQueue implements OnModuleDestroy {
  private readonly log = new Logger('MemoryQueue');
  /** Deliveries queued, running, or waiting for a retry timer. Prevents double scheduling. */
  private readonly scheduled = new Set<string>();
  private readonly ready: string[] = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  private running = 0;
  private stopped = false;

  constructor(private readonly runner: DeliveryRunner) {
    super();
  }

  async enqueue(deliveryIds: string[]): Promise<void> {
    if (!config.runWorker) return; // e.g. the seed script: the running app picks these up
    for (const id of deliveryIds) {
      if (this.scheduled.has(id)) continue;
      this.scheduled.add(id);
      this.ready.push(id);
    }
    this.pump();
  }

  requeue(deliveryIds: string[]): Promise<void> {
    return this.enqueue(deliveryIds);
  }

  async unpark(): Promise<void> {} // dead letters are tracked in the database only

  async ping(): Promise<void> {}

  onModuleDestroy(): void {
    this.stopped = true;
    this.timers.forEach(clearTimeout);
  }

  private pump(): void {
    while (!this.stopped && this.running < config.workerConcurrency && this.ready.length) {
      const id = this.ready.shift()!;
      this.running++;
      this.runner
        .run(id)
        .then(
          (result) => {
            if (result.outcome !== 'retry') return this.scheduled.delete(id);
            const timer = setTimeout(() => {
              this.timers.delete(timer);
              this.ready.push(id);
              this.pump();
            }, result.delayMs);
            timer.unref();
            this.timers.add(timer);
          },
          (err: Error) => {
            this.log.error(`Delivery ${id} failed unexpectedly: ${err.message}`);
            this.scheduled.delete(id); // left pending in the database; recovery retries it
          },
        )
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }
}
