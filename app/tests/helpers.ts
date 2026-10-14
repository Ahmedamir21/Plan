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
