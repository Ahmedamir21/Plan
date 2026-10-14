import contract from '../../sync/source-contract.json';
import { SourceError, validateContract } from '../../sync/catalog-reader.mjs';
import { activeTerm, database } from '../server/db';
import { runCatalogJob } from '../server/catalog-job';
import { SafeError, errorCode } from '../server/errors';
const runId = process.env.PLANORA_SYNC_RUN_ID || '';
let db;
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
  const staged = await runCatalogJob(db, {
    runId,
    contract,
    githubRunId: process.env.GITHUB_RUN_ID,
    credentials: {
      token: process.env.SELF_SERVICE_CATALOG_TOKEN,
      username: process.env.SELF_SERVICE_USERNAME,
      password: process.env.SELF_SERVICE_PASSWORD,
    },
  });
  console.log(
    JSON.stringify({
      runId,
      status: staged.status,
      summary: staged.summary,
      published: false,
    })
  );
} catch (error) {
  console.error(
    JSON.stringify({
      runId: /^[0-9a-f-]{36}$/i.test(runId) ? runId : undefined,
      error: error instanceof SourceError ? error.code : errorCode(error),
      published: false,
    })
  );
  process.exitCode = 1;
} finally {
  await db?.close();
}
