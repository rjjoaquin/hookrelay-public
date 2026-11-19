import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';
import { isRetryable, retryDelay } from '../common/backoff';
import { signOutbound } from '../common/crypto';
import { applyTransform } from '../common/transform';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { sendWebhook } from './http-sender';

export type RunResult =
  | { outcome: 'done' }
  | { outcome: 'retry'; delayMs: number; reason: string }
  | { outcome: 'dead'; reason: string; eventId: string; destinationId: string };

/** One delivery attempt. Queue-agnostic: used by the BullMQ worker and the in-process queue. */
@Injectable()
export class DeliveryRunner {
  private readonly log = new Logger('Delivery');

  constructor(private readonly prisma: PrismaService) {}

  async run(deliveryId: string): Promise<RunResult> {
    const db = this.prisma.db;
    const delivery = await db.delivery.findUnique({
      where: { id: deliveryId },
      include: { event: { include: { source: { select: { transform: true } } } } },
    });
    // Idempotent: skip anything already finished (duplicate job, stalled re-run, deleted data).
    if (!delivery || delivery.status === 'succeeded' || delivery.status === 'dead') return { outcome: 'done' };

    const destination = await db.destination.findUnique({
      where: { id: delivery.destinationId },
      select: { id: true, url: true, enabled: true, signingSecret: true },
    });
    if (!destination || !destination.enabled) return this.kill(delivery, 'Destination disabled or removed');

    const { event } = delivery;
    let body = event.body;
    let contentType = event.contentType ?? 'application/octet-stream';
    if (event.source.transform) {
      try {
        body = JSON.stringify(applyTransform(event.source.transform as Record<string, unknown>, JSON.parse(event.body)));
        contentType = 'application/json';
      } catch {
        return this.kill(delivery, 'Transform failed: payload is not valid JSON');
      }
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const attemptNumber = delivery.attempts + 1;
    const result = await sendWebhook(destination.url, body, {
      'content-type': contentType,
      'user-agent': 'HookRelay/1.0',
      'x-hookrelay-event-id': event.id,
      'x-hookrelay-delivery-id': delivery.id,
      'x-hookrelay-attempt': String(attemptNumber),
      'x-hookrelay-signature': signOutbound(destination.signingSecret, body, timestamp),
    });

    await db.deliveryAttempt.create({
      data: {
        deliveryId: delivery.id,
        attemptNumber,
        statusCode: result.statusCode,
        durationMs: result.durationMs,
        error: result.error,
        responseBody: result.responseBody,
      },
    });

    const ok = result.statusCode !== null && result.statusCode >= 200 && result.statusCode < 300;
    const reason = result.error ?? `HTTP ${result.statusCode}`;
    const base = { attempts: attemptNumber, lastStatusCode: result.statusCode, lastError: ok ? null : reason } satisfies Prisma.DeliveryUpdateInput;

    if (ok) {
      await db.delivery.update({ where: { id: delivery.id }, data: { ...base, status: 'succeeded', deliveredAt: new Date(), nextAttemptAt: null } });
      return { outcome: 'done' };
    }

    if (result.permanent || !isRetryable(result.statusCode) || attemptNumber >= config.maxAttempts) {
      await db.delivery.update({ where: { id: delivery.id }, data: base });
      return this.kill(delivery, reason);
    }

    const delayMs = retryDelay(delivery.id, attemptNumber, config.backoffBaseMs, config.backoffMaxMs);
    await db.delivery.update({ where: { id: delivery.id }, data: { ...base, status: 'retrying', nextAttemptAt: new Date(Date.now() + delayMs) } });
    return { outcome: 'retry', delayMs, reason };
  }

  private async kill(delivery: { id: string; eventId: string; destinationId: string }, reason: string): Promise<RunResult> {
    await this.prisma.db.delivery.update({ where: { id: delivery.id }, data: { status: 'dead', lastError: reason, nextAttemptAt: null } });
    this.log.warn(`Delivery ${delivery.id} dead-lettered: ${reason}`);
    return { outcome: 'dead', reason, eventId: delivery.eventId, destinationId: delivery.destinationId };
  }
}
