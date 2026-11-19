import { readFileSync } from 'fs';
import { join } from 'path';

/** The SQLite dev schema must describe the same models as the PostgreSQL schema. */
function models(file: string): string {
  return readFileSync(join(__dirname, '..', 'prisma', file), 'utf8')
    .replace(/^\/\/.*$/gm, '')
    .replace(/ @db\.\w+(\([^)]*\))?/g, '')
    .replace(/[\s\S]*?(?=model |enum )/, '') // drop generator/datasource header
    .replace(/\s+/g, ' ')
    .trim();
}

describe('prisma schemas', () => {
  it('sqlite schema matches the postgres schema', () => {
    expect(models('sqlite/schema.prisma')).toBe(models('schema.prisma'));
  });
});
