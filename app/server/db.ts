import type { Pool } from 'pg';
import { SafeError } from './errors.js';

export interface Sql {
  exec(text: string): Promise<void>;
  query(
    text: string,
    values?: any[]
  ): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (sql: Sql) => Promise<T>, readOnly?: boolean): Promise<T>;
  close(): Promise<void>;
}
let cached: Promise<Database> | undefined;
let testDatabase: Database | undefined;
export function useTestDatabase(db?: Database) {
  if (process.env.NODE_ENV !== 'test')
    throw new SafeError('TEST_DATABASE_FORBIDDEN', 500);
  testDatabase = db;
}
export async function postgresDatabase(url: string): Promise<Database> {
  const { Pool } = await import('pg');
    const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol))
    throw new SafeError('INVALID_DATABASE_CONFIGURATION', 503);
  const local = ['localhost', '127.0.0.1', '::1', '[::1]', 'postgres'].includes(
    parsed.hostname
  );
  const noTls = process.env.DATABASE_SSL === 'disable';
  if (
    noTls &&
    (!local || process.env.VERCEL || process.env.NODE_ENV === 'production')
  )
    throw new SafeError('DATABASE_TLS_REQUIRED', 503);
  // node-postgres URL ssl options can otherwise override the verified TLS object.
  for (const key of [...parsed.searchParams.keys()])
    if (key.startsWith('ssl')) parsed.searchParams.delete(key);
  const pool: Pool = new Pool({
    connectionString: parsed.toString(),
    max: 3,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    ssl: noTls
      ? false
      : {
          rejectUnauthorized: true,
          ...(process.env.DATABASE_SSL_CA
            ? { ca: process.env.DATABASE_SSL_CA }
            : {}),
        },
  });
  pool.on('error', () => console.error('DATABASE_POOL_UNAVAILABLE')); // Never print URLs/provider errors.
  return {
    query: (text, values) => pool.query(text, values),
    exec: async (text) => {
      await pool.query(text);
    },
    async transaction(fn, readOnly = false) {
      const client = await pool.connect();
      try {
        await client.query(
          readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN'
        );
        await client.query("SET LOCAL lock_timeout = '5s'");
        const result = await fn({
          query: (text, values) => client.query(text, values),
          exec: async (text) => {
            await client.query(text);
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
export async function localDatabase(path?: string): Promise<Database> {
  if (process.env.VERCEL || process.env.NODE_ENV === 'production')
    throw new SafeError('LOCAL_DATABASE_FORBIDDEN', 503);
  // PGlite is real PostgreSQL compiled to WASM, for isolated local/test use only.
  const { PGlite } = await import('@electric-sql/pglite');
  if (path) {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  const pg = new PGlite(path);
  await pg.waitReady;
  return {
    query: (text, values) => pg.query(text, values),
    exec: async (text) => {
      await pg.exec(text);
    },
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn({
          query: (text, values) => tx.query(text, values),
          exec: async (text) => {
            await tx.exec(text);
          },
        })
      ),
    close: () => pg.close(),
  };
}
export function database(): Promise<Database> {
  if (testDatabase) return Promise.resolve(testDatabase);
  if (!cached)
    cached = (async () => {
      if (process.env.PLANORA_LOCAL_DB === 'true')
        return localDatabase(
          new URL('../.data/catalog', import.meta.url).pathname
        );
      if (!process.env.DATABASE_URL)
        throw new SafeError('DATABASE_NOT_CONFIGURED', 503);
      return postgresDatabase(process.env.DATABASE_URL);
    })().catch((error) => {
      cached = undefined;
      throw error;
    });
  return cached;
}
export function activeTerm(): string {
  const term = process.env.PLANORA_TERM_KEY || 'fall-2026-main';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(term))
    throw new SafeError('INVALID_TERM_CONFIGURATION', 503);
  return term;
}
