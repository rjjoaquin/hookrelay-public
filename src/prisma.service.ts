import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { config, usesSqlite } from './config';
import { Prisma, PrismaClient } from './generated/prisma/client';

function adapter() {
  if (usesSqlite) {
    // Optional dependency, only loaded for local SQLite development.
    const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
    return new PrismaBetterSqlite3({ url: config.databaseUrl });
  }
  return new PrismaPg({ connectionString: config.databaseUrl });
}

function createClient() {
  return new PrismaClient({
    adapter: adapter(),
    // Secrets are never returned unless a query explicitly selects them.
    omit: {
      user: { passwordHash: true },
      source: { inboundSecret: true },
      destination: { signingSecret: true },
    },
  });
}

export type Db = ReturnType<typeof createClient>;

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly db: Db = createClient();

  async onModuleDestroy(): Promise<void> {
    await this.db.$disconnect();
  }
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}
