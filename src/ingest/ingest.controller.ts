import { BadRequestException, Controller, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { config } from '../config';
import { IngestService } from './ingest.service';

@Controller('in')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post(':slug')
  @HttpCode(202)
  @Throttle({ default: { limit: config.ingestRateLimitPerMin, ttl: 60_000 } })
  async receive(@Param('slug') slug: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!/^[a-z0-9-]{1,64}$/.test(slug)) throw new BadRequestException('Invalid source');
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (body.includes(0)) throw new BadRequestException('Binary payloads are not supported');
    const result = await this.ingest.ingest(slug, body, req.headers);
    if (result.duplicate) res.status(200);
    return result;
  }
}
