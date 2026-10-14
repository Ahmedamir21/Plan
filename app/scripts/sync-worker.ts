import contract from '../../sync/source-contract.json';
import {
  collectCatalog,
  SourceError,
  validateContract,
} from '../../sync/catalog-reader.mjs';
import { activeTerm, database } from '../server/db';
import { getCatalog } from '../server/catalog-repository';
import { canonical, sha } from '../server/catalog-model';
import { claimRun, failRun, heartbeat, stageRun } from '../server/sync-service';
import { mergeSourceCatalog } from '../server/source-normalization';
import { SafeError, errorCode } from '../server/errors';

const runId = process.env.PLANORA_SYNC_RUN_ID || '';
let db, lease: string | undefined;
try {
  if (
    !/^[0-9a-f-]{36}$/i.test(runId) ||
    process.env.GITHUB_REPOSITORY !== 'Ahmedamir21/Plan' ||
    process.env.GITHUB_ACTIONS !== 'true'
  )
    throw new SafeError('WORKER_REQUIRES_TARGET_REPOSITORY_JOB');
  if (process.env.PLANORA_SELF_SERVICE_ENABLED !== 'true')
    throw new SafeError('LIVE_SOURCE_DISABLED');
  validateContract(contract);
  if (activeTerm() !== contract.term)
    throw new SafeError('SOURCE_TERM_MISMATCH');
  db = await database();
  const claim = await claimRun(
    db,
    runId,
    sha(canonical(contract)),
    process.env.GITHUB_RUN_ID
  );
  lease = claim.token;
  const current = await getCatalog(db, claim.term);
  const result = await collectCatalog({
    contract,
    credentials: {
      token: process.env.SELF_SERVICE_CATALOG_TOKEN,
      username: process.env.SELF_SERVICE_USERNAME,
      password: process.env.SELF_SERVICE_PASSWORD,
    },
    onPage: async (progress: Record<string, number>) =>
      heartbeat(db!, runId, lease!, 'running', progress),
  });
  await heartbeat(db, runId, lease, 'validating');
  const candidate = mergeSourceCatalog(current.dataset, result.dataset);
  const staged = await stageRun(db, runId, candidate, {
    token: lease,
    coverage: { ...result.coverage, complete: true },
  });
  // Safe counts/status only. Never output academic source pages, credentials or provider bodies.
  console.log(
    JSON.stringify({
      runId,
      status: staged.status,
      summary: staged.summary,
      published: false,
    })
  );
} catch (error) {
  const code = error instanceof SourceError ? error.code : errorCode(error);
  if (db && lease)
    await failRun(
      db,
      runId,
      code,
      error instanceof SafeError ? error.details : [],
      lease
    ).catch(() => console.error('FAILED_TO_RECORD_JOB_FAILURE'));
  console.error(
    JSON.stringify({
      runId: /^[0-9a-f-]{36}$/i.test(runId) ? runId : undefined,
      error: code,
      published: false,
    })
  );
  process.exitCode = 1;
} finally {
  await db?.close();
}
