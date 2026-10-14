import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { testDb, fixture, asTestRole } from './helpers';
import { migrate } from '../server/migrations';
import { importCatalog, getCatalog } from '../server/catalog-repository';
import {
  canonical,
  counts,
  datasetHash,
  normalizeDataset,
} from '../server/catalog-model';

test('migration, full-field SQL roundtrip, safe retries and import rejection', async () => {
  const db = await testDb(false);
  try {
    const input = await fixture();
    assert.deepEqual(await migrate(db), []);
    const result = await importCatalog(db, input);
    assert.equal(result.imported, true);
    assert.deepEqual(counts(input), {
      courses: 70,
      sections: 287,
      instructors: 92,
    });
    const stored = await getCatalog(db, input.semester.key);
    assert.equal(canonical(stored.dataset), canonical(input));
    assert.equal(stored.hash, datasetHash(input));
    assert.equal((await importCatalog(db, input)).imported, false);
    assert.throws(
      () => normalizeDataset({ ...input, majors: [] }),
      /CATALOG_VALIDATION_FAILED/
    );
    const noYears = structuredClone(input);
    noYears.majors[0].years = [];
    assert.throws(() => normalizeDataset(noYears), /CATALOG_VALIDATION_FAILED/);
    const changed = structuredClone(input);
    changed.courses[0].name = 'A reviewed change';
    await assert.rejects(importCatalog(db, changed), /IMPORT_WOULD_OVERWRITE/);
    const duplicate = structuredClone(input);
    duplicate.courses.push(duplicate.courses[0]);
    assert.throws(() => normalizeDataset(duplicate), /CATALOG_VALIDATION/);
    const duplicateCodeOtherCatalog = structuredClone(input);
    duplicateCodeOtherCatalog.sch[0].code = input.courses[0].code;
    assert.doesNotThrow(() => normalizeDataset(duplicateCodeOtherCatalog));
    assert.equal((await getCatalog(db, input.semester.key)).hash, stored.hash);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM planora.catalog_snapshots'
        )
      ).rows[0].n,
      1
    );
  } finally {
    await db.close();
  }
});

test('constraints, foreign keys, failed-write rollback and least-privilege roles', async () => {
  const db = await testDb();
  try {
    const course = (await db.query('SELECT * FROM planora.courses LIMIT 1'))
      .rows[0];
    await assert.rejects(
      db.query('UPDATE planora.courses SET credits=-1 WHERE id=$1', [course.id])
    );
    await assert.rejects(
      db.query('UPDATE planora.meetings SET end_minute=start_minute')
    );
    await assert.rejects(
      db.query("UPDATE planora.meetings SET weekday='Friday'")
    );
    await assert.rejects(
      db.query('DELETE FROM planora.courses WHERE id=$1', [course.id])
    );
    const term = (await fixture()).semester.key,
      before = await getCatalog(db, term);
    await assert.rejects(
      db.transaction(async (sql) => {
        await sql.query('UPDATE planora.courses SET title=$1 WHERE id=$2', [
          'Do not commit',
          course.id,
        ]);
        await sql.query('UPDATE planora.courses SET credits=-1 WHERE id=$1', [
          course.id,
        ]);
      })
    );
    assert.equal(
      canonical((await getCatalog(db, term)).dataset),
      canonical(before.dataset)
    );
    await db.exec(
      await readFile(new URL('../db/permissions.sql', import.meta.url), 'utf8')
    );
    const runtime = asTestRole(db, 'planora_runtime');
    assert.equal(
      (await runtime.query('SELECT current_user')).rows[0].current_user,
      'planora_runtime'
    );
    await assert.rejects(
      runtime.query('DELETE FROM planora.catalog_snapshots')
    );
    await assert.rejects(
      runtime.query('UPDATE planora.catalog_changes SET category=$1', [
        'course_removed',
      ])
    );
    await assert.rejects(
      runtime.query('SELECT * FROM planora.schema_migrations')
    );
    assert.equal(
      (await runtime.query('SELECT count(*)::int n FROM planora.courses'))
        .rows[0].n,
      70
    );

    // Execute the actual publication pipeline under the restricted runtime role,
    // not just the fixture owner; the same grants will be needed after cutover.
    const { createRun, stageRun, publishRun } = await import(
      '../server/sync-service'
    );
    const revised = structuredClone(before.dataset);
    revised.courses[0].name += ' (runtime grant test)';
    const publication = await createRun(runtime, term, 'test-admin', 'admin');
    const proposal = await stageRun(runtime, publication.id, revised);
    await publishRun(
      runtime,
      publication.id,
      proposal.hash,
      'test-admin',
      'Synthetic role verification'
    );
    assert.equal(
      (await getCatalog(runtime, term)).revision,
      before.revision + 1
    );
    assert.equal(
      (
        await runtime.query(
          'SELECT count(*)::int n FROM planora.catalog_changes'
        )
      ).rows[0].n,
      1
    );
    const publicPrivileges = await db.query(
      "SELECT has_schema_privilege('public','planora','USAGE') AS allowed"
    );
    assert.equal(publicPrivileges.rows[0].allowed, false);
  } finally {
    await db.close();
  }
});

test('separate worker can stage a complete catalog but cannot publish or read subscribers', async () => {
  const db = await testDb();
  try {
    const { createRun, claimRun, stageRun } = await import(
      '../server/sync-service'
    );
    const input = await fixture();
    await db.exec(
      await readFile(new URL('../db/permissions.sql', import.meta.url), 'utf8')
    );
    const results = await Promise.allSettled([
      createRun(
        db,
        input.semester.key,
        'admin',
        'self-service',
        'test-contract'
      ),
      createRun(
        db,
        input.semester.key,
        'admin',
        'self-service',
        'test-contract'
      ),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const run = (
      results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
        id: string;
      }>
    ).value;
    const worker = asTestRole(db, 'planora_worker');
    assert.equal(
      (await worker.query('SELECT current_user')).rows[0].current_user,
      'planora_worker'
    );
    await assert.rejects(
      worker.query('SELECT * FROM planora.email_subscriptions')
    );
    await assert.rejects(
      worker.query("UPDATE planora.courses SET title='not allowed'")
    );
    await assert.rejects(worker.query('DELETE FROM planora.catalog_changes'));
    const lease = await claimRun(worker, run.id, 'test-contract');
    const staged = await stageRun(worker, run.id, input, {
      token: lease.token,
      coverage: {
        complete: true,
        term: input.semester.key,
        ...counts(input),
        pagesRead: 1,
        pageCount: 1,
        snapshot: 'synthetic-coverage',
      },
    });
    assert.match(staged.status, /completed/);
    const mailer = asTestRole(db, 'planora_mailer');
    await mailer.query('SELECT * FROM planora.notification_deliveries');
    await assert.rejects(
      mailer.query("UPDATE planora.courses SET title='not allowed'")
    );
    await assert.rejects(
      mailer.query("UPDATE planora.sync_runs SET requested_by='not allowed'")
    );
  } finally {
    await db.close();
  }
});
