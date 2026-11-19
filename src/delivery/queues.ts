import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { config } from '../config';

export const DELIVERY_QUEUE = 'deliveries';
export const DEAD_LETTER_QUEUE = 'dead-letter';

export interface DeliveryJob {
  deliveryId: string;
}

export interface DeadLetterJob {
  deliveryId: string;
  eventId: string;
  destinationId: string;
  reason: string;
}

/** Queue abstraction: BullMQ when REDIS_URL is set, otherwise an in-process queue (dev only). */
export abstract class DeliveryQueue {
  abstract enqueue(deliveryIds: string[]): Promise<void>;
  /** Recovery path for deliveries stuck in pending/retrying. Must be safe to call repeatedly. */
  abstract requeue(deliveryIds: string[]): Promise<void>;
  abstract unpark(deliveryId: string): Promise<void>;
  abstract ping(): Promise<void>;
}

@Injectable()
export class BullDeliveryQueue extends DeliveryQueue {
  constructor(
    @InjectQueue(DELIVERY_QUEUE) private readonly deliveries: Queue<DeliveryJob>,
    @InjectQueue(DEAD_LETTER_QUEUE) private readonly deadLetters: Queue<DeadLetterJob>,
  ) {
    super();
  }

  /** jobId = deliveryId makes enqueueing idempotent: re-adding an existing job is a no-op. */
  async enqueue(deliveryIds: string[]): Promise<void> {
    if (!deliveryIds.length) return;
    await this.deliveries.addBulk(
      deliveryIds.map((deliveryId) => ({
        name: 'deliver',
        data: { deliveryId },
        opts: {
          jobId: deliveryId,
          attempts: config.maxAttempts,
          backoff: { type: 'jittered' },
          removeOnComplete: { age: 3600, count: 5000 },
          removeOnFail: { age: 24 * 3600, count: 5000 },
        },
      })),
    );
  }

  /** Recovery path: re-add missing jobs and retry jobs that failed without updating the database. */
  async requeue(deliveryIds: string[]): Promise<void> {
    const missing: string[] = [];
    for (const id of deliveryIds) {
      const job = await this.deliveries.getJob(id);
      if (!job) missing.push(id);
      else if (await job.isFailed()) await job.retry('failed', { resetAttemptsMade: true });
    }
    await this.enqueue(missing);
  }

  async park(job: DeadLetterJob): Promise<void> {
    await this.deadLetters.add('dead', job, { jobId: `dead-${job.deliveryId}`, removeOnComplete: true });
  }

  async unpark(deliveryId: string): Promise<void> {
    await this.deadLetters.remove(`dead-${deliveryId}`);
  }

  async ping(): Promise<void> {
    const client = await this.deliveries.client;
    await (client as unknown as { ping(): Promise<string> }).ping();
  }
}
