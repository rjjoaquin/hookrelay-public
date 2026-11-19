import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, MinimalJob, UnrecoverableError } from 'bullmq';
import { config } from '../config';
import { retryDelay } from '../common/backoff';
import { DeliveryRunner } from './delivery.runner';
import { BullDeliveryQueue, DELIVERY_QUEUE, DeliveryJob } from './queues';

/** BullMQ worker (used when REDIS_URL is set). Retries and dead-lettering map onto BullMQ semantics. */
@Processor(DELIVERY_QUEUE, {
  concurrency: config.workerConcurrency,
  settings: {
    backoffStrategy: (attemptsMade: number, _type?: string, _err?: Error, job?: MinimalJob) =>
      retryDelay(job?.id, attemptsMade, config.backoffBaseMs, config.backoffMaxMs),
  },
})
export class DeliveryProcessor extends WorkerHost {
  constructor(
    private readonly runner: DeliveryRunner,
    private readonly queue: BullDeliveryQueue,
  ) {
    super();
  }

  async process(job: Job<DeliveryJob>): Promise<void> {
    const result = await this.runner.run(job.data.deliveryId);
    if (result.outcome === 'retry') throw new Error(result.reason);
    if (result.outcome === 'dead') {
      await this.queue.park({ deliveryId: job.data.deliveryId, eventId: result.eventId, destinationId: result.destinationId, reason: result.reason });
      throw new UnrecoverableError(result.reason);
    }
  }
}
