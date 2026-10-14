import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDb, fixture } from './helpers';
import {
  canonical,
  counts,
  datasetHash,
  normalizeDataset,
} from '../server/catalog-model';
import { diffCatalog } from '../server/diff';
import {
  createRun,
  claimRun,
  stageRun,
  publishRun,
  cancelRun,
  heartbeat,
  failRun,
  verifyCoverage,
  syncHistory,
} from '../server/sync-service';
import { getCatalog } from '../server/catalog-repository';
import { mergeSourceCatalog } from '../server/source-normalization';

test('deterministic diff: whitespace/order, additions/removals, metadata, section source identity and null preservation', async () => {
  const a = await fixture(),
    b = structuredClone(a);
  b.courses.reverse();
  b.courses.forEach((c) => {
    c.name = `  ${c.name.replaceAll(' ', '  ')}  `;
    c.instructors.reverse();
  });
  const normalized = normalizeDataset(b).dataset;
  assert.equal(datasetHash(a), datasetHash(normalized));
  assert.equal(diffCatalog(a, normalized).changes.length, 0);
  const c = structuredClone(a);
  c.courses[0].name = 'New title';
  c.courses[0].credits = 2;
  c.courses[0].instructors[0].lectures[0].start += 10;
  c.courses[0].instructors[0].name = 'New teacher';
  const delta = diffCatalog(a, c);
  assert(
    delta.changes.some(
      (x) => x.category === 'course_modified' && x.fields.includes('credits')
    )
  );
  assert(
    delta.changes.some(
      (x) =>
        x.category === 'section_modified' &&
        x.fields.includes('start') &&
        x.fields.includes('instructor')
    )
  );
  const old = structuredClone(a),
    next = structuredClone(a);
  old.courses[0].instructors[0].lectures[0].sourceId = 'stable-section';
  next.courses[0].instructors[0].lectures[0].sourceId = 'stable-section';
  next.courses[0].instructors[0].lectures[0].sec = '99';
  assert.equal(
    diffCatalog(old, next).changes.filter(
      (x) => x.category === 'section_modified'
    ).length,
    1
  );
  const adopted = structuredClone(a);
  adopted.courses[0].instructors[0].lectures[0].sourceId = 'adopted';
  assert.equal(diffCatalog(a, adopted).summary.removals, 0);
  const partial: any = structuredClone(a);
  partial.courses[0].credits = null;
  partial.courses[0].instructors[0].lectures[0].room = '';
  assert.equal(
    mergeSourceCatalog(a, partial).courses[0].credits,
    a.courses[0].credits
  );
  assert.equal(
    mergeSourceCatalog(a, partial).courses[0].instructors[0].lectures[0].room,
    a.courses[0].instructors[0].lectures[0].room
  );
  const invalid = structuredClone(a);
  invalid.courses[0].instructors[0].lectures[0].end = 1;
  assert.throws(() => normalizeDataset(invalid), /VALIDATION/);
  const duplicate = structuredClone(a);
  duplicate.courses[0].instructors[0].lectures.push(
    duplicate.courses[0].instructors[0].lectures[0]
  );
  assert.throws(() => normalizeDataset(duplicate), /VALIDATION/);
  const remove = structuredClone(a);
  remove.courses.pop();
  assert(
    diffCatalog(a, remove).changes.some((c) => c.category === 'course_removed')
  );
  const add = structuredClone(a);
  add.courses.push({
    ...structuredClone(add.courses[0]),
    id: 'new101',
    code: 'NEW 101',
  });
  assert(
    diffCatalog(a, add).changes.some((c) => c.category === 'course_added')
  );
});

test('staging, manual review, atomic audit/outbox, no-op reruns and forced-write rollback', async () => {
  const db = await testDb();
  const original = await fixture(),
    term = original.semester.key;
  try {
    const subscriber = randomUUID();
    const course = (
      await db.query(
        'SELECT id FROM planora.courses WHERE term_key=$1 AND legacy_id=$2',
        [term, original.courses[0].id]
      )
    ).rows[0];
    await db.query(
      "INSERT INTO planora.email_subscriptions(id,term_key,email,status,token_version,consent_at,verified_at) VALUES($1,$2,'test@example.invalid','active',$3,now(),now())",
      [subscriber, term, randomUUID()]
    );
    await db.query(
      'INSERT INTO planora.subscription_courses(subscription_id,course_id) VALUES($1,$2)',
      [subscriber, course.id]
    );
    const run = await createRun(db, term, 'admin', 'admin');
    await assert.rejects(
      createRun(db, term, 'another', 'admin'),
      /ALREADY_ACTIVE/
    );
    const candidate = structuredClone(original);
    candidate.courses[0].instructors[0].lectures[0].room = 'Verified room';
    const stage = await stageRun(db, run.id, candidate);
    assert.equal(stage.status, 'awaiting_review');
    assert.equal((await getCatalog(db, term)).revision, 1);
    assert.equal(
      (await db.query('SELECT * FROM planora.public_changes')).rows.length,
      0
    );
    await assert.rejects(
      publishRun(
        db,
        run.id,
        stage.hash,
        'reviewer',
        'Verified',
        false,
        async () => {
          throw new Error('injected database-write failure');
        }
      )
    );
    assert.equal((await getCatalog(db, term)).revision, 1);
    assert.equal(
      (await db.query('SELECT * FROM planora.notification_deliveries')).rows
        .length,
      0
    );
    const published = await publishRun(
      db,
      run.id,
      stage.hash,
      'reviewer',
      'Verified academic fixture'
    );
    assert.equal(published.revision, 2);
    assert.equal(
      (await getCatalog(db, term)).dataset.courses[0].instructors[0].lectures[0]
        .room,
      'Verified room'
    );
    assert.equal(
      (await db.query('SELECT * FROM planora.public_changes')).rows.length,
      1
    );
    assert.equal(
      (await db.query('SELECT * FROM planora.notification_deliveries')).rows
        .length,
      1
    );
    await publishRun(
      db,
      run.id,
      stage.hash,
      'reviewer',
      'Retry after response lost'
    );
    assert.equal(
      (await db.query('SELECT * FROM planora.notification_deliveries')).rows
        .length,
      1
    );
    const again = await createRun(db, term, 'admin', 'admin');
    assert.match(
      (await stageRun(db, again.id, candidate)).status,
      /^completed/
    );
    assert.equal(
      (await db.query('SELECT * FROM planora.public_changes')).rows.length,
      1
    );
    const incomplete = structuredClone(candidate);
    incomplete.courses.splice(0, 40);
    assert.throws(
      () =>
        verifyCoverage(candidate, incomplete, {
          complete: true,
          term,
          ...counts(incomplete),
          pagesRead: 1,
          pageCount: 1,
          snapshot: 'test',
        }),
      /SHRINKAGE/
    );
    assert.throws(() => verifyCoverage(candidate, candidate), /INCOMPLETE/);
    const removal = structuredClone(candidate);
    removal.sch.pop();
    const remove = await createRun(db, term, 'admin', 'admin');
    const proposed = await stageRun(db, remove.id, removal);
    await assert.rejects(
      publishRun(
        db,
        remove.id,
        proposed.hash,
        'reviewer',
        'Removal needs consent'
      ),
      /REMOVALS_REQUIRE/
    );
    await publishRun(
      db,
      remove.id,
      proposed.hash,
      'reviewer',
      'Verified complete coverage; approve removal',
      true
    );
    assert.equal((await getCatalog(db, term)).dataset.sch.length, 12);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM planora.courses WHERE NOT active'
        )
      ).rows[0].n,
      1
    );
    const history = await syncHistory(db, term);
    assert(history.runs.some((r) => r.reviewed_by === 'reviewer'));
    assert.equal(history.lastSuccess, null);
  } finally {
    await db.close();
  }
});

test('worker lease, cancellation, expiration, completeness and stale publication fail closed', async () => {
  const db = await testDb();
  const d = await fixture(),
    term = d.semester.key;
  try {
    const run = await createRun(
      db,
      term,
      'admin',
      'self-service',
      'test-contract'
    );
    await assert.rejects(
      claimRun(db, run.id, 'changed-contract'),
      /NOT_CLAIMABLE/
    );
    const lease = await claimRun(db, run.id, 'test-contract', '123');
    await assert.rejects(
      claimRun(db, run.id, 'test-contract'),
      /NOT_CLAIMABLE/
    );
    await heartbeat(db, run.id, lease.token, 'validating');
    await assert.rejects(
      stageRun(db, run.id, d, { token: randomUUID() }),
      /INVALID_WORKER/
    );
    await assert.rejects(
      stageRun(db, run.id, d, { token: lease.token }),
      /INCOMPLETE/
    );
    await cancelRun(db, run.id, 'admin');
    await assert.rejects(
      heartbeat(db, run.id, lease.token, 'running'),
      /CANCELLED_OR_EXPIRED/
    );
    await assert.rejects(
      stageRun(db, run.id, d, { token: lease.token }),
      /NOT_STAGEABLE/
    );
    const expired = await createRun(
      db,
      term,
      'admin',
      'self-service',
      'test-contract'
    );
    await db.query(
      "UPDATE planora.sync_runs SET lease_until=now()-interval '1 hour' WHERE id=$1",
      [expired.id]
    );
    await assert.rejects(
      claimRun(db, expired.id, 'test-contract'),
      /NOT_CLAIMABLE/
    );
    const next = await createRun(
      db,
      term,
      'admin',
      'self-service',
      'test-contract'
    );
    assert.equal(
      (
        await db.query('SELECT status FROM planora.sync_runs WHERE id=$1', [
          expired.id,
        ])
      ).rows[0].status,
      'failed'
    );
    const nextLease = await claimRun(db, next.id, 'test-contract');
    await failRun(
      db,
      next.id,
      'SOURCE_INCOMPLETE_CATALOG',
      [],
      nextLease.token
    );
    assert.equal((await getCatalog(db, term)).hash, datasetHash(d));
    const stale = await createRun(db, term, 'admin', 'admin');
    const change = structuredClone(d);
    change.courses[0].name = 'Staged';
    const proposal = await stageRun(db, stale.id, change);
    await db.query(
      'UPDATE planora.catalog_state SET revision=revision+1 WHERE term_key=$1',
      [term]
    );
    await assert.rejects(
      publishRun(db, stale.id, proposal.hash, 'admin', 'Reviewed'),
      /CATALOG_CHANGED/
    );
    assert.equal(canonical((await getCatalog(db, term)).dataset), canonical(d));
  } finally {
    await db.close();
  }
});

test('source identity never maps a new legacy ID by course code alone', async () => {
  const d = await fixture();
  const incoming = structuredClone({ courses: d.courses, sch: d.sch });
  incoming.courses[0].id = 'unknown-source-identity';
  assert.throws(
    () => mergeSourceCatalog(d, incoming),
    /SOURCE_COURSE_IDENTITY_UNVERIFIED/
  );
});
