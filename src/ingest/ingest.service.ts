import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { verifyInbound } from '../common/crypto';
import { DeliveryQueue } from '../delivery/queues';
import { isUniqueViolation, PrismaService } from '../prisma.service';

const IDEMPOTENCY_HEADERS = ['idempotency-key', 'webhook-id', 'x-github-delivery', 'x-request-id'];
const SIGNATURE_HEADERS = ['x-signature-256', 'x-hub-signature-256'];
const DROPPED_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-api-key', ...SIGNATURE_HEADERS]);

export interface IngestResult {
  eventId: string;
  duplicate: boolean;
  deliveries: number;
}

@Injectable()
export class IngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: DeliveryQueue,
  ) {}

  async ingest(slug: string, rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<IngestResult> {
    const db = this.prisma.db;
    const source = await db.source.findFirst({
      where: { slug, enabled: true },
      select: { id: true, requiresSignature: true, inboundSecret: true },
    });
    if (!source) throw new NotFoundException();

    if (source.requiresSignature) {
      const sig = SIGNATURE_HEADERS.map((h) => first(headers[h])).find(Boolean);
      if (!source.inboundSecret || !verifyInbound(source.inboundSecret, rawBody, sig)) {
        throw new UnauthorizedException('Invalid signature');
      }
    }

    const idempotencyKey = IDEMPOTENCY_HEADERS.map((h) => first(headers[h])).find(Boolean)?.slice(0, 255) ?? null;
    const storedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers).slice(0, 50)) {
      if (!DROPPED_HEADERS.has(k) && v !== undefined) storedHeaders[k] = (first(v) ?? '').slice(0, 1024);
    }

    try {
      // Event + deliveries are committed together; queueing happens after commit (outbox pattern).
      const { eventId, deliveryIds } = await db.$transaction(async (tx) => {
        const event = await tx.event.create({
          data: {
            sourceId: source.id,
            idempotencyKey,
            contentType: first(headers['content-type'])?.slice(0, 255) ?? null,
            headers: storedHeaders,
            body: rawBody.toString('utf8'),
          },
          select: { id: true },
        });
        const dests = await tx.destination.findMany({ where: { sourceId: source.id, enabled: true }, select: { id: true } });
        const rows = await tx.delivery.createManyAndReturn({
          data: dests.map((d) => ({ eventId: event.id, destinationId: d.id })),
          select: { id: true },
        });
        return { eventId: event.id, deliveryIds: rows.map((r) => r.id) };
      });
      await this.queues.enqueue(deliveryIds).catch(() => undefined); // recovered by MaintenanceService
      return { eventId, duplicate: false, deliveries: deliveryIds.length };
    } catch (e) {
      if (isUniqueViolation(e) && idempotencyKey) {
        const existing = await db.event.findFirstOrThrow({ where: { sourceId: source.id, idempotencyKey }, select: { id: true } });
        return { eventId: existing.id, duplicate: true, deliveries: 0 };
      }
      throw e;
    }
  }
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
