import { readFile, readdir } from 'node:fs/promises';
import type { Database } from './db';
import { sha } from './catalog-model';
import { SafeError } from './errors';
export async function migrate(db: Database) {
  const directory = new URL('../db/migrations/', import.meta.url);
  return db.transaction(async (sql) => {
    await sql.query('SELECT pg_advisory_xact_lock(701425)');
    await sql.query('CREATE SCHEMA IF NOT EXISTS planora');
    await sql.query('REVOKE ALL ON SCHEMA planora FROM PUBLIC');
    await sql.query(
      'CREATE TABLE IF NOT EXISTS planora.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())'
    );
    const applied: string[] = [];
    for (const name of (await readdir(directory))
      .filter((n) => /^\d{3}_[a-z_]+\.sql$/.test(n))
      .sort()) {
      const sqlText = await readFile(new URL(name, directory), 'utf8'),
        checksum = sha(sqlText);
      const old = (
        await sql.query(
          'SELECT checksum FROM planora.schema_migrations WHERE name=$1',
          [name]
        )
      ).rows[0];
      if (old) {
        if (old.checksum !== checksum)
          throw new SafeError('MIGRATION_CHECKSUM_CHANGED', 500);
        continue;
      }
      // A migration contains several statements; neither identifiers nor SQL come from API inputs.
      await sql.exec(sqlText);
      await sql.query(
        'INSERT INTO planora.schema_migrations(name,checksum) VALUES($1,$2)',
        [name, checksum]
      );
      applied.push(name);
    }
    return applied;
  });
}
