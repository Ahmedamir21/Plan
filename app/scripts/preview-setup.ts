/** Manual protected Actions job only. No university access, mail, aliases, promotion or production env writes. */
import { randomBytes, scryptSync } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { postgresDatabase } from '../server/db';
import { readFixtures } from '../server/fixtures';
import { normalizeDataset } from '../server/catalog-model';
import { SafeError, errorCode } from '../server/errors';
import {
  assertPreviewJob,
  assertGithubIdentity,
  previewDatabaseUrls,
  REPOSITORY,
  BRANCH,
} from '../ops/preview-contract';
import {
  preparePreviewDatabase,
  verifyRuntimeDatabase,
} from '../ops/preview-database';
import { bindPreviewRedis } from '../ops/preview-redis';
import { VercelPreview } from '../ops/vercel-preview';
import { verifyPreview } from '../e2e/preview-smoke';
const required = [
  'VERCEL_TOKEN',
  'PLAN_PREVIEW_DATABASE_OWNER_URL',
  'PLAN_PREVIEW_DATABASE_RUNTIME_URL',
  'PLAN_PREVIEW_REDIS_URL',
  'PLAN_PREVIEW_REDIS_TOKEN',
  'PLAN_PREVIEW_ADMIN_PASSWORD',
  'PLAN_PREVIEW_SECOND_ADMIN_PASSWORD',
  'GITHUB_TOKEN',
];
let owner, runtime;
try {
  assertPreviewJob(process.env);
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length)
    throw new SafeError('PREVIEW_CONFIGURATION_MISSING', 400, missing);
  const password = process.env.PLAN_PREVIEW_ADMIN_PASSWORD!,
    second = process.env.PLAN_PREVIEW_SECOND_ADMIN_PASSWORD!;
  if (password.length < 16 || second.length < 16 || password === second)
    throw new SafeError('USE_TWO_DISTINCT_STRONG_PREVIEW_APP_PASSWORDS');
  const sha = process.env.GITHUB_SHA!;
  const github = async (path: string) => {
    const r = await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new SafeError('GITHUB_PREVIEW_IDENTITY_UNAVAILABLE');
    return r.json();
  };
  const [repository, pr] = await Promise.all([github(''), github('/pulls/2')]);
  assertGithubIdentity(repository, pr, sha);
  const urls = previewDatabaseUrls(
    process.env.PLAN_PREVIEW_DATABASE_OWNER_URL!,
    process.env.PLAN_PREVIEW_DATABASE_RUNTIME_URL!
  );
  const vercel = new VercelPreview(
    process.env.VERCEL_TOKEN!,
    process.env.VERCEL_TEAM_ID
  );
  const project = await vercel.project(
    repository.id,
    process.env.PLAN_PREVIEW_VERCEL_PROJECT_ID
  );
  await bindPreviewRedis(
    process.env.PLAN_PREVIEW_REDIS_URL!,
    process.env.PLAN_PREVIEW_REDIS_TOKEN!
  );
  delete process.env.DATABASE_SSL; // Managed connections must use verified TLS, never a CI localhost override.
  owner = await postgresDatabase(urls.owner.toString());
  const fixture = normalizeDataset(await readFixtures()).dataset;
  const setup = await preparePreviewDatabase(
    owner,
    fixture,
    urls.role,
    decodeURIComponent(urls.runtime.password)
  );
  runtime = await postgresDatabase(urls.runtime.toString());
  const verified = await verifyRuntimeDatabase(
    runtime,
    fixture.semester.key,
    setup.hash,
    setup.binding.id
  );
  const hashPassword = (value: string) => {
    const salt = randomBytes(16);
    return `${salt.toString('hex')}:${scryptSync(value, salt, 64).toString('hex')}`;
  };
  await vercel.configure(project.id, repository.id, {
    DATABASE_URL: urls.runtime.toString(),
    PLANORA_TERM_KEY: fixture.semester.key,
    PLANORA_PREVIEW_BINDING_ID: setup.binding.id,
    UPSTASH_REDIS_REST_URL: process.env.PLAN_PREVIEW_REDIS_URL!,
    UPSTASH_REDIS_REST_TOKEN: process.env.PLAN_PREVIEW_REDIS_TOKEN!,
    PLANORA_ADMIN_SESSION_SECRET: randomBytes(48).toString('hex'),
    PLANORA_ADMIN_AHMED_PASSWORD_HASH: hashPassword(password),
    PLANORA_ADMIN_YOUSSEF_PASSWORD_HASH: hashPassword(second),
  });
  // Recheck the PR head immediately before deployment; a changed commit requires a new reviewed run.
  assertGithubIdentity(repository, await github('/pulls/2'), sha);
  const id = await vercel.deploy(project, repository.id, sha);
  console.log(
    JSON.stringify({
      previewDeploymentCreated: true,
      id,
      repository: REPOSITORY,
      branch: BRANCH,
      sha,
      production: false,
    })
  );
  const deployment = await vercel.waitForPreview(
    id,
    project.id,
    repository.id,
    sha
  );
  const smoke = await vercel.withAutomationAccess(
    project.id,
    repository.id,
    (bypassSecret) =>
      verifyPreview({
        url: deployment.url,
        sha,
        hash: setup.hash,
        bindingId: setup.binding.id,
        password,
        bypassSecret,
      })
  );
  const evidence = {
    verifiedAt: new Date().toISOString(),
    provider: 'Neon PostgreSQL',
    database: verified,
    migrations: setup.migrations,
    import: setup.imported,
    deployment,
    smoke,
    safeguards: {
      productionCutoverApproved: false,
      universityAccess: false,
      realEmails: 0,
    },
    realProviderVerification: true,
  };
  await mkdir(new URL('../.data/evidence/', import.meta.url), {
    recursive: true,
  });
  await writeFile(
    new URL('../.data/evidence/deployed-preview.json', import.meta.url),
    JSON.stringify(evidence, null, 2) + '\n'
  );
  console.log(JSON.stringify(evidence, null, 2)); // Allowlisted public evidence only. No URLs with credentials/cookies/tokens.
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Verified Plan Preview\n\n- URL: ${deployment.url}\n- Repository: ${REPOSITORY}\n- Branch: ${BRANCH}\n- Commit: ${sha}\n- SQL: ${verified.catalog.courses} courses / ${verified.catalog.sections} sections\n- Browser/API/private editing/persistence: passed\n- Production, university access and real email: disabled\n`
    );
} catch (error) {
  const code = error instanceof SafeError ? error.code : 'PREVIEW_SETUP_FAILED';
  console.error(
    JSON.stringify({
      error: code,
      details: error instanceof SafeError ? error.details : [],
      verified: false,
      production: false,
    })
  );
  process.exitCode = 1;
} finally {
  await runtime?.close();
  await owner?.close();
}
