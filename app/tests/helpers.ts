import { localDatabase, postgresDatabase } from '../server/db';
import { migrate } from '../server/migrations';
import { readFixtures } from '../server/fixtures';
import { normalizeDataset } from '../server/catalog-model';
import { importCatalog } from '../server/catalog-repository';
process.env.NODE_ENV = 'test';
export const fixture = async () =>
  normalizeDataset(await readFixtures()).dataset;
export async function testDb(seed = true) {
  let db;
  if (process.env.TEST_DATABASE_URL) {
    const url = new URL(process.env.TEST_DATABASE_URL);
    if (
      !['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) ||
      url.pathname !== '/planora_test'
    )
      throw new Error('Tests require isolated local planora_test database.');
    process.env.DATABASE_SSL = 'disable';
    db = await postgresDatabase(process.env.TEST_DATABASE_URL);
    await db.query('DROP SCHEMA IF EXISTS planora CASCADE'); // Only the explicit disposable test DB above.
  } else db = await localDatabase();
  await migrate(db);
  if (seed) await importCatalog(db, await fixture());
  return db;
}

/** Exercise real grants without leaking SET ROLE across pooled connections.
 * Pool.query may discard a client after an expected permission error; therefore
 * each operation sets its role on the SAME transaction-bound client it uses.
 * Test-only: production logs in directly as its restricted database role.
 */
export function asTestRole(
  db: import('../server/db').Database,
  role: 'planora_runtime' | 'planora_worker' | 'planora_mailer'
): import('../server/db').Database {
  const transaction: import('../server/db').Database['transaction'] = (
    fn,
    readOnly
  ) =>
    db.transaction(async (sql) => {
      await sql.query(`SET LOCAL ROLE ${role}`);
      return fn(sql);
    }, readOnly);
  return {
    transaction,
    query: (text, values) => transaction((sql) => sql.query(text, values)),
    exec: (text) => transaction((sql) => sql.exec(text)),
    close: async () => {}, // The fixture owner, not a role view, owns the pool.
  };
}
