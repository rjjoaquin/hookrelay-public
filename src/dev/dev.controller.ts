import { Controller, Headers, HttpCode, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { config } from '../config';

/**
 * Local test receiver, only mounted when ENABLE_DEV_SINK=true and NODE_ENV != production.
 *   /dev/sink/200   -> always succeeds
 *   /dev/sink/500   -> always fails (retries, then dead-letter)
 *   /dev/sink/400   -> permanent failure (dead-letter immediately)
 *   /dev/sink/flaky -> fails the first 2 attempts, then succeeds
 */
@Controller('dev/sink')
@SkipThrottle()
export class DevSinkController {
  @Post(':mode')
  @HttpCode(200)
  sink(@Param('mode') mode: string, @Headers('x-hookrelay-attempt') attempt: string | undefined, @Res() res: Response) {
    if (!config.enableDevSink) throw new NotFoundException();
    if (mode === 'flaky') return res.status(Number(attempt ?? 1) <= 2 ? 503 : 200).json({ ok: Number(attempt) > 2 });
    const code = Number(mode);
    if (!Number.isInteger(code) || code < 200 || code > 599) throw new NotFoundException();
    return res.status(code).json({ ok: code < 300 });
  }
}
