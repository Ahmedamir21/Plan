import { randomUUID } from 'node:crypto';
import type { Database, Sql } from './db.js';
import { readCatalog, writeCatalog } from './catalog-repository.js';
import {
  counts,
  datasetHash,
  normalizeDataset,
  sha,
  canonical,
  type Dataset,
} from './catalog-model.js';
import { diffCatalog } from './diff.js';
import { SafeError } from './errors.js';

export const activeStates = [
  'queued',
  'running',
  'validating',
  'awaiting_review',
  'applying',
];
export type Coverage = {
  complete: true;
  term: string;
  courses: number;
  sections: number;
  pagesRead: number;
  pageCount: number;
  snapshot: string;
};
async function expireRuns(sql: Sql, term: string) {
  await sql.query(
    `UPDATE planora.sync_runs SET status='failed',finished_at=now(),error_code='WORKER_LEASE_EXPIRED',lease_until=null
    WHERE term_key=$1 AND status IN ('queued','running','validating') AND lease_until<now()`,
    [term]
  );
}
export async function createRun(
  db: Database,
  term: string,
  admin: string,
  source: 'self-service' | 'admin' | 'recovery' = 'self-service',
  contractHash?: string
) {
  return db.transaction(async (sql) => {
    const state = (
      await sql.query(
        'SELECT revision FROM planora.catalog_state WHERE term_key=$1 FOR UPDATE',
        [term]
      )
    ).rows[0];
    if (!state) throw new SafeError('CATALOG_NOT_IMPORTED', 503);
    await expireRuns(sql, term);
    if (
      (
        await sql.query(
          'SELECT id FROM planora.sync_runs WHERE term_key=$1 AND status=ANY($2::text[])',
          [term, activeStates]
        )
      ).rows.length
    )
      throw new SafeError('SYNC_ALREADY_ACTIVE_OR_AWAITING_REVIEW', 409);
    const id = randomUUID();
    await sql.query(
      `INSERT INTO planora.sync_runs(id,term_key,source,requested_by,status,base_revision,contract_hash,lease_until)
      VALUES($1,$2,$3,$4,'queued',$5,$6,now()+interval '30 minutes')`,
      [id, term, source, admin, state.revision, contractHash ?? null]
    );
    return { id, status: 'queued', baseRevision: state.revision };
  });
}
export async function claimRun(
  db: Database,
  id: string,
  contractHash: string,
  githubRunId?: string
) {
  const token = randomUUID();
  const run = (
    await db.query(
      `UPDATE planora.sync_runs SET status='running',started_at=now(),worker_token=$2,
    github_run_id=$4,lease_until=now()+interval '30 minutes' WHERE id=$1 AND source='self-service' AND status='queued'
    AND contract_hash=$3 AND lease_until>now() RETURNING term_key,base_revision`,
      [
        id,
        token,
        contractHash,
        githubRunId && /^\d+$/.test(githubRunId) ? githubRunId : null,
      ]
    )
  ).rows[0];
  if (!run) throw new SafeError('JOB_NOT_CLAIMABLE', 409);
  return { token, term: run.term_key, baseRevision: run.base_revision };
}
export async function heartbeat(
  db: Database,
  id: string,
  token: string,
  phase: 'running' | 'validating',
  progress: Record<string, number> = {}
) {
  const result = await db.query(
    `UPDATE planora.sync_runs SET status=$3,lease_until=now()+interval '30 minutes',summary=summary||$4::jsonb
    WHERE id=$1 AND worker_token=$2 AND status IN ('running','validating') AND lease_until>now() RETURNING id`,
    [id, token, phase, JSON.stringify(progress)]
  );
  if (!result.rows.length) throw new SafeError('JOB_CANCELLED_OR_EXPIRED', 409);
}
export function verifyCoverage(
  before: Dataset,
  after: Dataset,
  proof?: Coverage
) {
  const actual = counts(after),
    previous = counts(before);
  if (
    !proof ||
    proof.complete !== true ||
    proof.term !== after.semester.key ||
    !Number.isInteger(proof.pageCount) ||
    proof.pageCount < 1 ||
    proof.pagesRead !== proof.pageCount ||
    !proof.snapshot ||
    proof.courses !== actual.courses ||
    proof.sections !== actual.sections
  )
    throw new SafeError('INCOMPLETE_CATALOG', 422);
  // A source-reported total alone is not enough if its coverage suddenly collapses.
  if (
    actual.courses < previous.courses * 0.7 ||
    actual.sections < previous.sections * 0.7
  )
    throw new SafeError('SUSPICIOUS_CATALOG_SHRINKAGE', 422);
}
export async function failRun(
  db: Database,
  id: string,
  code: string,
  details: string[] = [],
  token?: string
) {
  await db.query(
    `UPDATE planora.sync_runs SET status='failed',finished_at=now(),lease_until=null,error_code=$2,diagnostics=$3,
    summary=summary || jsonb_build_object('validationErrors',$5::int,'skipped',0)
    WHERE id=$1 AND status IN ('queued','running','validating','applying') AND ($4::uuid IS NULL OR worker_token=$4)`,
    [
      id,
      code,
      JSON.stringify(details.slice(0, 100)),
      token ?? null,
      details.length || 1,
    ]
  );
}
export async function stageRun(
  db: Database,
  id: string,
  input: unknown,
  options: { token?: string; coverage?: Coverage } = {}
) {
  const { dataset, warnings } = normalizeDataset(input),
    hash = datasetHash(dataset);
  return db.transaction(async (sql) => {
    const run = (
      await sql.query(
        'SELECT * FROM planora.sync_runs WHERE id=$1 FOR UPDATE',
        [id]
      )
    ).rows[0];
    if (!run) throw new SafeError('RUN_NOT_FOUND', 404);
    if (
      run.source === 'self-service' &&
      (!options.token || options.token !== run.worker_token)
    )
      throw new SafeError('INVALID_WORKER_LEASE', 403);
    if (
      run.proposed_hash === hash &&
      ['awaiting_review', 'completed', 'completed_with_warnings'].includes(
        run.status
      )
    )
      return { id, status: run.status, hash, summary: run.summary };
    if (
      !['queued', 'running', 'validating'].includes(run.status) ||
      !run.lease_until ||
      new Date(run.lease_until).getTime() <= Date.now()
    )
      throw new SafeError('RUN_NOT_STAGEABLE', 409);
    // The locked active-run row excludes any other publisher for this term.
    const current = await readCatalog(sql, run.term_key);
    if (
      dataset.semester.key !== run.term_key ||
      current.revision !== run.base_revision
    )
      throw new SafeError('CATALOG_CHANGED_RETRY_SYNC', 409);
    if (run.source === 'self-service')
      verifyCoverage(current.dataset, dataset, options.coverage);
    const diff = diffCatalog(current.dataset, dataset);
    const unchanged = current.hash === hash;
    const status = unchanged
      ? warnings.length
        ? 'completed_with_warnings'
        : 'completed'
      : 'awaiting_review';
    const diagnostics = [...warnings];
    if (diff.summary.removals)
      diagnostics.unshift(
        'Removals require explicit administrator approval. Nothing has been removed yet.'
      );
    await sql.query(
      `UPDATE planora.sync_runs SET status=$2,proposed_hash=$3,proposal=$4,summary=$5,diagnostics=$6,
      lease_until=null,finished_at=CASE WHEN $7 THEN now() ELSE NULL END WHERE id=$1`,
      [
        id,
        status,
        hash,
        JSON.stringify(dataset),
        JSON.stringify(diff.summary),
        JSON.stringify(diagnostics),
        unchanged,
      ]
    );
    return { id, status, hash, summary: diff.summary };
  });
}
/** One transaction includes catalog, snapshot, academic audit, review and outbox. */
export async function publishRun(
  db: Database,
  id: string,
  expectedHash: string,
  reviewer: string,
  reason: string,
  allowRemovals = false,
  afterWrite?: (sql: Sql) => Promise<void>
) {
  if (!reason.trim() || reason.length > 500)
    throw new SafeError('REVIEW_REASON_REQUIRED');
  return db.transaction(async (sql) => {
    const run = (
      await sql.query(
        'SELECT * FROM planora.sync_runs WHERE id=$1 FOR UPDATE',
        [id]
      )
    ).rows[0];
    if (!run) throw new SafeError('RUN_NOT_FOUND', 404);
    if (run.proposed_hash !== expectedHash)
      throw new SafeError('PROPOSAL_CHANGED', 409);
    if (['completed', 'completed_with_warnings'].includes(run.status))
      return { id, status: run.status, alreadyPublished: true };
    if (run.status !== 'awaiting_review' || !run.proposal)
      throw new SafeError('RUN_NOT_REVIEWABLE', 409);
    await sql.query(
      'SELECT term_key FROM planora.catalog_state WHERE term_key=$1 FOR UPDATE',
      [run.term_key]
    );
    const current = await readCatalog(sql, run.term_key);
    if (current.revision !== run.base_revision)
      throw new SafeError('CATALOG_CHANGED_RESTAGE', 409);
    const { dataset, warnings } = normalizeDataset(run.proposal);
    if (datasetHash(dataset) !== expectedHash)
      throw new SafeError('PROPOSAL_CHECKSUM_MISMATCH', 422);
    const diff = diffCatalog(current.dataset, dataset);
    if (diff.summary.removals && !allowRemovals)
      throw new SafeError('REMOVALS_REQUIRE_EXPLICIT_APPROVAL', 409);
    await sql.query(
      `UPDATE planora.sync_runs SET status='applying',reviewed_by=$2,reviewed_at=now(),review_reason=$3 WHERE id=$1`,
      [id, reviewer, reason.trim()]
    );
    await writeCatalog(sql, dataset, current.dataset);
    const revision = current.revision + 1;
    await sql.query(
      `UPDATE planora.catalog_state SET revision=$2,content_hash=$3,published_at=now() WHERE term_key=$1`,
      [run.term_key, revision, expectedHash]
    );
    const roundtrip = await readCatalog(sql, run.term_key);
    if (datasetHash(roundtrip.dataset) !== expectedHash)
      throw new SafeError('PUBLICATION_ROUNDTRIP_FAILED', 500);
    await sql.query(
      `INSERT INTO planora.catalog_snapshots(term_key,revision,run_id,content_hash,dataset) VALUES($1,$2,$3,$4,$5)`,
      [run.term_key, revision, id, expectedHash, JSON.stringify(dataset)]
    );
    for (const change of diff.changes) {
      const eventId = randomUUID(),
        eventKey = sha(`${run.term_key}:${revision}:${canonical(change)}`);
      await sql.query(
        `INSERT INTO planora.catalog_changes(id,run_id,term_key,catalog_key,course_legacy_id,course_code,course_title,section_key,category,before_value,after_value,fields,event_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          eventId,
          id,
          run.term_key,
          change.catalog,
          change.courseId,
          change.code,
          change.title,
          change.sectionKey,
          change.category,
          JSON.stringify(change.before),
          JSON.stringify(change.after),
          change.fields,
          eventKey,
        ]
      );
      if (change.courseId) {
        // One statement per academic event, not one round trip per subscriber.
        // PostgreSQL 15+ supplies gen_random_uuid() without an extra extension.
        await sql.query(
          `INSERT INTO planora.notification_deliveries(id,subscription_id,event_id,kind,event_key)
           SELECT gen_random_uuid(),s.id,$3::uuid,'catalog_change',$3::text||':'||s.id::text
           FROM planora.email_subscriptions s JOIN planora.subscription_courses sc ON sc.subscription_id=s.id
           JOIN planora.courses c ON c.id=sc.course_id
           WHERE s.term_key=$1 AND s.status='active' AND c.term_key=$1 AND c.legacy_id=$2
           ON CONFLICT(event_key) DO NOTHING`,
          [run.term_key, change.courseId, eventId]
        );
      }
    }
    if (afterWrite) await afterWrite(sql);
    const status = warnings.length ? 'completed_with_warnings' : 'completed';
    await sql.query(
      `UPDATE planora.sync_runs SET status=$2,finished_at=now(),summary=$3,error_code=null WHERE id=$1`,
      [id, status, JSON.stringify(diff.summary)]
    );
    return {
      id,
      status,
      revision,
      summary: diff.summary,
      alreadyPublished: false,
    };
  });
}
export async function cancelRun(db: Database, id: string, admin: string) {
  const result = await db.query(
    `UPDATE planora.sync_runs SET status='cancelled',finished_at=now(),lease_until=null,reviewed_by=$2,reviewed_at=now()
    WHERE id=$1 AND status IN ('queued','running','validating','awaiting_review') RETURNING id`,
    [id, admin]
  );
  if (!result.rows.length) throw new SafeError('RUN_NOT_CANCELLABLE', 409);
}
export async function syncHistory(db: Database, term: string, page = 0) {
  await expireRuns(db, term);
  const runs = (
    await db.query(
      `SELECT id,source,requested_by,status,created_at,started_at,finished_at,summary,diagnostics,error_code,reviewed_by,reviewed_at,review_reason,proposed_hash,base_revision,github_run_id
    FROM planora.sync_runs WHERE term_key=$1 ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $2`,
      [term, page * 20]
    )
  ).rows;
  const lastSuccess =
    (
      await db.query(
        `SELECT finished_at FROM planora.sync_runs WHERE term_key=$1 AND source='self-service' AND status IN ('completed','completed_with_warnings') ORDER BY finished_at DESC LIMIT 1`,
        [term]
      )
    ).rows[0]?.finished_at ?? null;
  const lastAttempt =
    (
      await db.query(
        `SELECT created_at FROM planora.sync_runs WHERE term_key=$1 AND source='self-service' ORDER BY created_at DESC LIMIT 1`,
        [term]
      )
    ).rows[0]?.created_at ?? null;
  const active =
    (
      await db.query(
        `SELECT id,status FROM planora.sync_runs WHERE term_key=$1 AND status=ANY($2::text[])`,
        [term, activeStates]
      )
    ).rows[0] ?? null;
  const deliveries = (
    await db.query(
      `SELECT n.status,count(*)::int AS count FROM planora.notification_deliveries n JOIN planora.email_subscriptions s ON s.id=n.subscription_id WHERE s.term_key=$1 GROUP BY n.status`,
      [term]
    )
  ).rows;
  const snapshots = (
    await db.query(
      'SELECT revision,created_at FROM planora.catalog_snapshots WHERE term_key=$1 ORDER BY revision DESC LIMIT 20',
      [term]
    )
  ).rows;
  return {
    runs: runs.slice(0, 20),
    hasMore: runs.length > 20,
    lastSuccess,
    lastAttempt,
    active,
    deliveries,
    snapshots,
  };
}
export async function inspectRun(db: Database, id: string, term: string) {
  return db.transaction(async (sql) => {
    const run = (
      await sql.query(
        'SELECT id,term_key,proposed_hash,proposal,status FROM planora.sync_runs WHERE id=$1 AND term_key=$2',
        [id, term]
      )
    ).rows[0];
    if (!run) throw new SafeError('RUN_NOT_FOUND', 404);
    if (['completed', 'completed_with_warnings'].includes(run.status)) {
      const changes = (
        await sql.query(
          'SELECT * FROM planora.public_changes WHERE id IN (SELECT id FROM planora.catalog_changes WHERE run_id=$1) ORDER BY course_code,category,section_key',
          [id]
        )
      ).rows;
      return {
        id,
        status: run.status,
        hash: run.proposed_hash,
        changes,
        published: true,
      };
    }
    if (!run.proposal)
      return {
        id,
        status: run.status,
        hash: run.proposed_hash,
        changes: [],
        published: false,
      };
    const current = await readCatalog(sql, term);
    return {
      id,
      status: run.status,
      hash: run.proposed_hash,
      changes: diffCatalog(current.dataset, run.proposal).changes,
      published: false,
    };
  }, true);
}
