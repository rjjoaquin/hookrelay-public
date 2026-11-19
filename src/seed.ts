/**
 * Creates a demo account (demo@example.com) with relays pointing at the built-in dev sink,
 * then sends a few sample events. Synthetic data only.
 * Requires ENABLE_DEV_SINK=true and ALLOW_PRIVATE_DESTINATIONS=true on the running app.
 */
process.env.RUN_WORKER = 'false';

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { randomBytes } from 'crypto';

const DEMO_EMAIL = 'demo@example.com';

async function main() {
  const { AppModule } = await import('./app.module');
  const { DashboardService } = await import('./dashboard/dashboard.service');
  const { IngestService } = await import('./ingest/ingest.service');
  const { PrismaService } = await import('./prisma.service');
  const { hashPassword } = await import('./common/password');
  const { config } = await import('./config');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const db = app.get(PrismaService).db;

  if (await db.user.findUnique({ where: { email: DEMO_EMAIL } })) {
    console.log(`${DEMO_EMAIL} already exists, skipping.`);
    await app.close();
    return;
  }

  const password = process.env.SEED_PASSWORD || randomBytes(12).toString('base64url');
  const user = await db.user.create({ data: { email: DEMO_EMAIL, passwordHash: await hashPassword(password) } });

  const dashboard = app.get(DashboardService);
  const ingest = app.get(IngestService);
  const sinkBase = process.env.SEED_SINK_URL ?? `http://localhost:${config.port}/dev/sink`;

  const relays = [
    { name: 'Demo: always succeeds', mode: '200' },
    { name: 'Demo: flaky (succeeds on 3rd try)', mode: 'flaky' },
    { name: 'Demo: always 500 (ends in dead-letter)', mode: '500' },
    { name: 'Demo: rejects with 400', mode: '400' },
  ];
  const samples = [
    { type: 'order.created', data: { id: 'ord_1001', total: 4200, currency: 'USD' } },
    { type: 'order.paid', data: { id: 'ord_1001', total: 4200, currency: 'USD' } },
    { type: 'invoice.finalized', data: { id: 'inv_2001', amount_due: 1999 } },
  ];

  for (const r of relays) {
    const created = await dashboard.createSource(user.id, { name: r.name, destinationUrl: `${sinkBase}/${r.mode}` });
    for (const [i, s] of samples.entries()) {
      await ingest.ingest(created.slug, Buffer.from(JSON.stringify(s)), {
        'content-type': 'application/json',
        'idempotency-key': `seed-${created.slug}-${i}`,
      });
    }
  }

  console.log(`Demo account ready. Sign in with ${DEMO_EMAIL} / ${password}`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
