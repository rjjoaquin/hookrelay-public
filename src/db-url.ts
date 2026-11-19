import { existsSync } from 'fs';
import { resolve } from 'path';

// Keep in sync with prisma.config.ts (which cannot import from src/ inside the Docker image).

/** Loads .env if present. Real environment variables always win. */
export function loadDotEnv(): void {
  if (existsSync('.env')) process.loadEnvFile('.env');
}

/**
 * DATABASE_URL, or a local SQLite file (dev.db) when it is unset outside production.
 * `file:` URLs are made absolute so the app and the Prisma CLI open the same file.
 */
export function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url.startsWith('file:') ? `file:${resolve(url.slice(5))}` : url;
  if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL must be set in production');
  return `file:${resolve('dev.db')}`;
}

export const isSqliteUrl = (url: string): boolean => url.startsWith('file:');
