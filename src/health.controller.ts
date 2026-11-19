import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DeliveryQueue } from './delivery/queues';
import { PrismaService } from './prisma.service';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly queues: DeliveryQueue) {}

  @Get()
  async check() {
    try {
      await this.prisma.db.$queryRaw`SELECT 1`;
      await this.queues.ping();
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
  }
}
