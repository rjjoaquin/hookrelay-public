import { existsSync } from 'fs';
import { resolve } from 'path';
import { defineConfig } from 'prisma/config';

// Same rules as src/db-url.ts: no DATABASE_URL outside production means a local SQLite file.
if (existsSync('.env')) process.loadEnvFile('.env');
const raw = process.env.DATABASE_URL;
if (!raw && process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL must be set in production');
const url = !raw ? `file:${resolve('dev.db')}` : raw.startsWith('file:') ? `file:${resolve(raw.slice(5))}` : raw;
const dir = url.startsWith('file:') ? 'prisma/sqlite' : 'prisma';

export default defineConfig({
  schema: `${dir}/schema.prisma`,
  migrations: { path: `${dir}/migrations` },
  datasource: { url },
});
