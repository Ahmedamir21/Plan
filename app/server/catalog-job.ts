/** Shared source-worker pipeline. It can stage a proposal, never publish it. */
import {
  collectCatalog,
  SourceError,
  validateContract,
} from '../../sync/catalog-reader.mjs';
import type { Database } from './db';
import { getCatalog } from './catalog-repository';
import { canonical, sha } from './catalog-model';
import { claimRun, failRun, heartbeat, stageRun } from './sync-service';
import { mergeSourceCatalog } from './source-normalization';
import { SafeError, errorCode } from './errors';
export async function runCatalogJob(
  db: Database,
  input: {
    runId: string;
    contract: any;
    credentials: { token?: string; username?: string; password?: string };
    githubRunId?: string;
  },
  io: { fetchImpl?: typeof fetch; wait?: (ms: number) => Promise<void> } = {}
) {
  let lease: string | undefined;
  try {
    validateContract(input.contract);
    const claim = await claimRun(
      db,
      input.runId,
      sha(canonical(input.contract)),
      input.githubRunId
    );
    lease = claim.token;
    const current = await getCatalog(db, claim.term);
    if (current.dataset.semester.key !== input.contract.term)
      throw new SafeError('SOURCE_TERM_MISMATCH');
    const result = await collectCatalog({
      contract: input.contract,
      credentials: input.credentials,
      ...io,
      onPage: async (progress: Record<string, number>) =>
        heartbeat(db, input.runId, lease!, 'running', progress),
    });
    await heartbeat(db, input.runId, lease, 'validating');
    const candidate = mergeSourceCatalog(current.dataset, result.dataset);
    return await stageRun(db, input.runId, candidate, {
      token: lease,
      coverage: { ...result.coverage, complete: true },
    });
  } catch (error) {
    const code = error instanceof SourceError ? error.code : errorCode(error);
    if (lease)
      await failRun(
        db,
        input.runId,
        code,
        error instanceof SafeError ? error.details : [],
        lease
      );
    throw error;
  }
}
