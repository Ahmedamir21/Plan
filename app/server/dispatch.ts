import contract from '../../sync/source-contract.json' with { type: 'json' };
import { canonical, sha } from './catalog-model.js';
import { activeTerm } from './db.js';
import type { Database } from './db.js';
import { createRun, failRun } from './sync-service.js';
import { SafeError } from './errors.js';
import { validateContract } from '../../sync/catalog-reader.mjs';
export function syncCapability() {
  let reason = 'SOURCE_CONTRACT_NOT_APPROVED';
  try {
    validateContract(contract);
    reason = 'WORKER_NOT_CONFIGURED';
  } catch {
    return { enabled: false, reason };
  }
  const ref = process.env.PLANORA_SYNC_REF || '';
  const enabled =
    process.env.PLANORA_SELF_SERVICE_ENABLED === 'true' &&
    !!process.env.PLANORA_GITHUB_ACTIONS_TOKEN &&
    /^[a-zA-Z0-9._/-]{1,150}$/.test(ref) &&
    contract.term === activeTerm();
  return { enabled, reason: enabled ? null : reason };
}
export async function dispatchSync(db: Database, admin: string) {
  if (!syncCapability().enabled)
    throw new SafeError(syncCapability().reason || 'SYNC_DISABLED', 503);
  const run = await createRun(
    db,
    activeTerm(),
    admin,
    'self-service',
    sha(canonical(contract))
  );
  try {
    const response = await fetch(
      'https://api.github.com/repos/Ahmedamir21/Plan/actions/workflows/self-service-sync.yml/dispatches',
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${process.env.PLANORA_GITHUB_ACTIONS_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          ref: process.env.PLANORA_SYNC_REF,
          inputs: { run_id: run.id },
        }),
      }
    );
    if (!response.ok) throw new SafeError('WORKFLOW_DISPATCH_REJECTED', 503);
    return run;
  } catch (error) {
    // A possibly accepted but timed-out dispatch must not later publish; its DB lease is invalidated.
    await failRun(db, run.id, 'WORKFLOW_DISPATCH_FAILED_OR_UNCERTAIN');
    throw new SafeError('WORKFLOW_DISPATCH_FAILED_OR_UNCERTAIN', 503);
  }
}
