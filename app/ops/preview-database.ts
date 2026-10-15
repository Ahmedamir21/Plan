import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Database } from '../server/db';
import { migrate } from '../server/migrations';
import { getCatalog, importCatalog } from '../server/catalog-repository';
import { normalizeDataset, counts, datasetHash } from '../server/catalog-model';
import { SafeError } from '../server/errors';
import { REPOSITORY } from './preview-contract';
/** No reset/delete/overwrite path. A foreign/nonempty unbound database is rejected BEFORE DDL. */
export async function preparePreviewDatabase(
  db: Database,
  input: unknown,
  runtimeRole: string,
  runtimePassword: string
) {
  if (
    !/^plan_preview_[a-z0-9_]{1,32}$/.test(runtimeRole) ||
    runtimePassword.length < 24
  )
    throw new SafeError('PREVIEW_RUNTIME_CREDENTIALS_INVALID');
  const { dataset } = normalizeDataset(input);
  const hash = datasetHash(dataset);
  const binding = await db.transaction(async (sql) => {
    await sql.query('SELECT pg_advisory_xact_lock(701430)');
    const present = (
      await sql.query(
        "SELECT to_regclass('plan_preview_guard.binding') AS table_name"
      )
    ).rows[0].table_name;
    if (present) {
      const row = (
        await sql.query(
          'SELECT * FROM plan_preview_guard.binding WHERE singleton=true'
        )
      ).rows[0];
      if (
        row?.repository !== REPOSITORY ||
        row?.purpose !== 'preview' ||
        row?.runtime_role !== runtimeRole ||
        row?.fixture_hash !== hash
      )
        throw new SafeError('PREVIEW_DATABASE_BINDING_MISMATCH');
      return row;
    }
    const tables = (
      await sql.query(
        "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' AND c.relkind IN ('r','p','m','f') LIMIT 1"
      )
    ).rows;
    if (tables.length)
      throw new SafeError('PREVIEW_DATABASE_NOT_EMPTY_OR_NOT_BOUND');
    if (
      (
        await sql.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [
          runtimeRole,
        ])
      ).rows.length
    )
      throw new SafeError(
        'PREVIEW_RUNTIME_ROLE_ALREADY_EXISTS_WITHOUT_BINDING'
      );
    await sql.exec(
      await readFile(
        new URL('../db/preview-guard.sql', import.meta.url),
        'utf8'
      )
    );
    const id = randomUUID();
    await sql.query(
      'INSERT INTO plan_preview_guard.binding(singleton,id,repository,purpose,runtime_role,fixture_hash) VALUES(true,$1,$2,$3,$4,$5)',
      [id, REPOSITORY, 'preview', runtimeRole, hash]
    );
    return {
      id,
      repository: REPOSITORY,
      purpose: 'preview',
      runtime_role: runtimeRole,
      fixture_hash: hash,
    };
  });
  const migrations = await migrate(db);
  const imported = await importCatalog(db, dataset); // Rejects drift; never reseeds a changed catalog.
  await db.exec(
    await readFile(new URL('../db/permissions.sql', import.meta.url), 'utf8')
  );
  await db.transaction(async (sql) => {
    await sql.query('SELECT pg_advisory_xact_lock(701430)');
    if (
      !(
        await sql.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [
          runtimeRole,
        ])
      ).rows.length
    ) {
      // SQL-only role creation avoids Neon's elevated Console/API role defaults.
      // Role identifier is allowlisted; password is a quoted SQL literal, never logged by this CLI.
      const command = (
        await sql.query(
          "SELECT format('CREATE ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',$1::text,$2::text) AS command",
          [runtimeRole, runtimePassword]
        )
      ).rows[0].command;
      await sql.exec(command);
    }
    // Existing passwords are not reset. Credential/privilege verification follows with the supplied runtime URL.
    await sql.exec(
      `GRANT planora_runtime TO "${runtimeRole}"; GRANT USAGE ON SCHEMA plan_preview_guard TO "${runtimeRole}"; GRANT SELECT ON plan_preview_guard.binding TO "${runtimeRole}";`
    );
  });
  return {
    binding: {
      id: binding.id,
      repository: binding.repository,
      purpose: binding.purpose,
    },
    migrations,
    imported,
    hash,
    counts: counts(dataset),
  };
}
export async function verifyRuntimeDatabase(
  db: Database,
  term: string,
  expectedHash: string,
  bindingId: string
) {
  const roles = (
    await db.query(
      'SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user'
    )
  ).rows[0];
  const privileges = (
    await db.query(`SELECT has_schema_privilege(current_user,'planora','CREATE') AS create_schema,
    has_table_privilege(current_user,'planora.schema_migrations','SELECT') AS read_migrations,
    has_table_privilege(current_user,'planora.catalog_snapshots','DELETE') AS delete_snapshots,
    has_table_privilege(current_user,'planora.catalog_changes','UPDATE') AS modify_audit,
    has_table_privilege(current_user,'planora.courses','UPDATE') AS edit_courses`)
  ).rows[0];
  if (
    !roles ||
    Object.values(roles).some(Boolean) ||
    privileges.create_schema ||
    privileges.read_migrations ||
    privileges.delete_snapshots ||
    privileges.modify_audit ||
    !privileges.edit_courses
  )
    throw new SafeError('PREVIEW_RUNTIME_ROLE_NOT_RESTRICTED');
  const binding = (
    await db.query(
      'SELECT id,repository,purpose FROM plan_preview_guard.binding WHERE singleton=true'
    )
  ).rows[0];
  if (
    binding?.id !== bindingId ||
    binding.repository !== REPOSITORY ||
    binding.purpose !== 'preview'
  )
    throw new SafeError('PREVIEW_RUNTIME_DATABASE_MISMATCH');
  const catalog = await getCatalog(db, term);
  if (
    catalog.hash !== expectedHash ||
    datasetHash(catalog.dataset) !== expectedHash
  )
    throw new SafeError('PREVIEW_RUNTIME_CATALOG_MISMATCH');
  return {
    binding,
    catalog: {
      revision: catalog.revision,
      hash: catalog.hash,
      ...counts(catalog.dataset),
    },
    restricted: true,
  };
}
