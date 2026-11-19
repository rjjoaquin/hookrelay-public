import { isSqliteUrl, loadDotEnv, resolveDatabaseUrl } from './db-url';

loadDotEnv();

function int(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

function bool(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  return raw === 'true' || raw === '1';
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: int('PORT', 3000),
  databaseUrl: resolveDatabaseUrl(),
  /** Empty means no Redis: deliveries run on an in-process queue (development only). */
  redisUrl: process.env.REDIS_URL ?? '',
  runWorker: bool('RUN_WORKER', true),
  workerConcurrency: int('WORKER_CONCURRENCY', 10),
  maxAttempts: Math.max(1, int('MAX_ATTEMPTS', 8)),
  backoffBaseMs: int('BACKOFF_BASE_MS', 2000),
  backoffMaxMs: int('BACKOFF_MAX_MS', 60 * 60 * 1000),
  deliveryTimeoutMs: int('DELIVERY_TIMEOUT_MS', 10000),
  maxBodyBytes: int('MAX_BODY_BYTES', 1024 * 1024),
  ingestRateLimitPerMin: int('INGEST_RATE_LIMIT_PER_MIN', 600),
  // Development defaults to on so localhost destinations and the test receiver work out of the box.
  allowPrivateDestinations: bool('ALLOW_PRIVATE_DESTINATIONS', !isProd),
  enableDevSink: bool('ENABLE_DEV_SINK', !isProd) && !isProd,
  trustProxy: bool('TRUST_PROXY', false),
  eventRetentionDays: int('EVENT_RETENTION_DAYS', 30),
  sessionTtlDays: Math.max(1, int('SESSION_TTL_DAYS', 7)),
  allowRegistration: bool('ALLOW_REGISTRATION', true),
  cookieSecure: bool('COOKIE_SECURE', isProd),
};

export const usesSqlite = isSqliteUrl(config.databaseUrl);
export const usesRedis = config.redisUrl !== '';

export function assertConfig(): void {
  if (isProd && !usesRedis) throw new Error('REDIS_URL must be set in production');
  if (isProd && usesSqlite) throw new Error('SQLite is for development only; set DATABASE_URL to PostgreSQL');
}
