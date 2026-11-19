import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { SessionGuard } from './auth/session';
import { config, usesRedis } from './config';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { DeliveryProcessor } from './delivery/delivery.processor';
import { DeliveryRunner } from './delivery/delivery.runner';
import { MaintenanceService } from './delivery/maintenance.service';
import { MemoryDeliveryQueue } from './delivery/memory-queue';
import { BullDeliveryQueue, DEAD_LETTER_QUEUE, DELIVERY_QUEUE, DeliveryQueue } from './delivery/queues';
import { DevSinkController } from './dev/dev.controller';
import { HealthController } from './health.controller';
import { IngestController } from './ingest/ingest.controller';
import { IngestService } from './ingest/ingest.service';
import { PrismaService } from './prisma.service';

function redisImports(): DynamicModule[] {
  if (!usesRedis) return [];
  const redis = new URL(config.redisUrl);
  return [
    BullModule.forRoot({
      prefix: 'hookrelay',
      connection: {
        host: redis.hostname,
        port: Number(redis.port || 6379),
        username: redis.username || undefined,
        password: redis.password ? decodeURIComponent(redis.password) : undefined,
        db: redis.pathname.length > 1 ? Number(redis.pathname.slice(1)) : 0,
        tls: redis.protocol === 'rediss:' ? {} : undefined,
        maxRetriesPerRequest: null,
      },
    }),
    BullModule.registerQueue({ name: DELIVERY_QUEUE }, { name: DEAD_LETTER_QUEUE }),
  ];
}

const queueProviders: Provider[] = usesRedis
  ? [
      BullDeliveryQueue,
      { provide: DeliveryQueue, useExisting: BullDeliveryQueue },
      ...(config.runWorker ? [DeliveryProcessor] : []),
    ]
  : [{ provide: DeliveryQueue, useClass: MemoryDeliveryQueue }];

@Module({
  imports: [...redisImports(), ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }])],
  controllers: [
    IngestController,
    AuthController,
    DashboardController,
    HealthController,
    ...(config.enableDevSink ? [DevSinkController] : []),
  ],
  providers: [
    PrismaService,
    DeliveryRunner,
    ...queueProviders,
    AuthService,
    SessionGuard,
    IngestService,
    DashboardService,
    MaintenanceService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
