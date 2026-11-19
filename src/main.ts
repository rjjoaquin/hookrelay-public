import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app.module';
import { assertConfig, config, usesRedis, usesSqlite } from './config';

async function bootstrap() {
  assertConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const log = new Logger('HookRelay');

  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'connect-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'upgrade-insecure-requests': null } } }));
  // Webhook ingest keeps the exact raw bytes (needed for signature verification and faithful forwarding).
  app.use('/in', express.raw({ type: () => true, limit: config.maxBodyBytes }));
  app.use(express.json({ limit: '100kb' }));
  // No CORS: the dashboard and API are same-origin only.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useStaticAssets(join(__dirname, '..', 'public'), { index: 'index.html' });
  app.enableShutdownHooks();

  if (config.isProd && config.allowPrivateDestinations) log.warn('ALLOW_PRIVATE_DESTINATIONS is on in production (SSRF risk)');
  if (!config.isProd) {
    log.warn(
      `Development mode: ${usesSqlite ? 'SQLite (dev.db)' : 'PostgreSQL'}, ${usesRedis ? 'Redis queue' : 'in-process queue (no Redis)'}, ` +
        'localhost destinations allowed. Set NODE_ENV=production for real deployments.',
    );
  }
  await app.listen(config.port);
  log.log(`Listening on :${config.port} (worker ${config.runWorker ? 'on' : 'off'})`);
}

bootstrap().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
