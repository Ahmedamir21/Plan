import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unmigratedTestDb, asTestRole } from './helpers';
import {
  preparePreviewDatabase,
  verifyRuntimeDatabase,
} from '../ops/preview-database';
import {
  assertPreviewJob,
  assertGithubIdentity,
  assertDeployment,
  previewDatabaseUrls,
  previewVariables,
  REPOSITORY,
  BRANCH,
  PROJECT_SETTINGS,
  PREVIEW_ACK,
} from '../ops/preview-contract';
import { VercelPreview } from '../ops/vercel-preview';
import { bindPreviewRedis } from '../ops/preview-redis';
import { controlledCatalog } from '../e2e/fixture';
import { getCatalog } from '../server/catalog-repository';
const sha = 'a'.repeat(40),
  repositoryId = 123;
const project = {
  id: 'prj_fixture',
  name: 'plan-fixture-preview',
  link: {
    type: 'github',
    org: 'Ahmedamir21',
    repo: 'Plan',
    repoId: repositoryId,
  },
  ...PROJECT_SETTINGS,
};
const deployment = {
  id: 'dpl_fixture',
  projectId: project.id,
  url: 'synthetic-fixture.vercel.app',
  target: null,
  readyState: 'READY',
  gitSource: { type: 'github', repoId: repositoryId, ref: BRANCH, sha },
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
test('preview rejects wrong repository, branch, SHA, environment, live gates and unsafe database URLs', () => {
  const env = {
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_REF: `refs/heads/${BRANCH}`,
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_SHA: sha,
    PLAN_PREVIEW_ACK: PREVIEW_ACK,
  };
  assert.doesNotThrow(() => assertPreviewJob(env));
  for (const delta of [
    { GITHUB_REPOSITORY: 'Ahmedamir21/Planora' },
    { GITHUB_REF: 'refs/heads/main' },
    { GITHUB_EVENT_NAME: 'push' },
    { PLANORA_SQL_CUTOVER_APPROVED: 'true' },
    { PLANORA_SELF_SERVICE_ENABLED: 'true' },
    { PLANORA_EMAIL_MODE: 'resend' },
  ])
    assert.throws(() => assertPreviewJob({ ...env, ...delta }));
  const repo = { full_name: REPOSITORY, id: repositoryId },
    pr = {
      number: 2,
      state: 'open',
      merged: false,
      base: { repo: { full_name: REPOSITORY } },
      head: { repo: { full_name: REPOSITORY }, ref: BRANCH, sha },
    };
  assert.doesNotThrow(() => assertGithubIdentity(repo, pr, sha));
  assert.throws(() =>
    assertGithubIdentity(
      repo,
      { ...pr, head: { ...pr.head, sha: 'b'.repeat(40) } },
      sha
    )
  );
  assert.equal(
    assertDeployment(deployment, project.id, repositoryId, sha, true),
    `https://${deployment.url}`
  );
  for (const delta of [
    { target: 'production' },
    { target: 'staging' },
    { projectId: 'prj_other' },
    { gitSource: { ...deployment.gitSource, repoId: 999 } },
    { gitSource: { ...deployment.gitSource, ref: 'main' } },
    { gitSource: { ...deployment.gitSource, sha: 'b'.repeat(40) } },
    { url: 'example.invalid' },
  ])
    assert.throws(() =>
      assertDeployment(
        { ...deployment, ...delta },
        project.id,
        repositoryId,
        sha,
        true
      )
    );
  const owner = 'postgresql://owner:synthetic@ep-fixture.neon.tech/neondb',
    runtime =
      'postgresql://plan_preview_fixture:synthetic@ep-fixture-pooler.neon.tech/neondb';
  assert.equal(
    previewDatabaseUrls(owner, runtime).role,
    'plan_preview_fixture'
  );
  for (const value of [
    owner,
    runtime.replace('neondb', 'other'),
    runtime.replace('ep-fixture', 'ep-other'),
    runtime.replace('neon.tech', 'example.invalid'),
  ])
    assert.throws(() => previewDatabaseUrls(owner, value));
  const vars = previewVariables({
    PLANORA_EMAIL_MODE: 'resend',
    PLANORA_SQL_CUTOVER_APPROVED: 'true',
  });
  assert(
    vars.every((v) => v.target[0] === 'preview' && v.gitBranch === BRANCH)
  );
  assert.equal(
    vars.find((v) => v.key === 'PLANORA_EMAIL_MODE')?.value,
    'disabled'
  );
});
test('Vercel project guard stops before EVERY mutation if the project belongs to Planora', async () => {
  const methods: string[] = [];
  const api = new VercelPreview(
    'synthetic-token',
    undefined,
    async (_input, init) => {
      methods.push(init?.method || 'GET');
      return response({
        ...project,
        link: { ...project.link, repo: 'Planora' },
      });
    }
  );
  await assert.rejects(
    api.project(repositoryId, project.id),
    /NOT_LINKED_TO_PLAN/
  );
  await assert.rejects(
    api.configure(project.id, repositoryId, { DATABASE_URL: 'synthetic' }),
    /NOT_LINKED_TO_PLAN/
  );
  await assert.rejects(
    api.deploy(project, repositoryId, sha),
    /NOT_LINKED_TO_PLAN/
  );
  await assert.rejects(
    api.withAutomationAccess(project.id, repositoryId, async () => {}),
    /NOT_LINKED_TO_PLAN/
  );
  assert(methods.every((method) => method === 'GET'));
});
test('provider mock: preview-only variables/immutable Git source, READY attestation, scoped protection cleanup', async () => {
  const calls: { method: string; path: string; body: any }[] = [];
  const api = new VercelPreview(
    'synthetic-token',
    undefined,
    async (input, init) => {
      const url = new URL(String(input)),
        method = init?.method || 'GET',
        body = init?.body ? JSON.parse(String(init.body)) : undefined;
      assert.equal(url.origin, 'https://api.vercel.com');
      assert.equal(init?.redirect, 'error');
      calls.push({ method, path: url.pathname, body });
      if (url.pathname.endsWith('/env'))
        return response({ created: body, failed: [] }, 201);
      if (url.pathname.endsWith('/protection-bypass'))
        return response(
          body.generate
            ? {
                protectionBypass: {
                  [body.generate.secret]: { scope: 'automation-bypass' },
                },
              }
            : { protectionBypass: {} }
        );
      if (url.pathname === '/v13/deployments') return response(deployment, 201);
      if (url.pathname.startsWith('/v13/deployments/'))
        return response(deployment);
      return response(project);
    }
  );
  await api.configure(project.id, repositoryId, {
    DATABASE_URL: 'not-a-real-credential',
  });
  await api.deploy(project, repositoryId, sha);
  assert.equal(
    (await api.waitForPreview(deployment.id, project.id, repositoryId, sha))
      .sha,
    sha
  );
  await assert.rejects(
    api.withAutomationAccess(project.id, repositoryId, async () => {
      throw new Error('synthetic smoke failure');
    }),
    /synthetic smoke failure/
  );
  const create = calls.find((c) => c.path === '/v13/deployments')!.body;
  assert.equal(create.target, undefined);
  assert.equal(create.alias, undefined);
  assert.equal(create.gitSource.sha, sha);
  assert.equal(create.gitSource.repoId, repositoryId);
  assert(calls.find((c) => c.body?.revoke)?.body.revoke.regenerate === false);
  assert(
    calls
      .filter((c) => c.path.endsWith('/env'))[0]
      .body.every(
        (v: any) =>
          v.target.length === 1 &&
          v.target[0] === 'preview' &&
          v.gitBranch === BRANCH
      )
  );
  const partial = new VercelPreview('synthetic', undefined, async (input) =>
    response(
      String(input).includes('/env')
        ? { created: [], failed: [{ error: 'synthetic' }] }
        : project
    )
  );
  await assert.rejects(
    partial.configure(project.id, repositoryId, {}),
    /VARIABLE_UPDATE_FAILED/
  );
});
test('preview database: existing data refused; scoped binding/import/permissions idempotent; changed data not replaced', async () => {
  const db = await unmigratedTestDb();
  const role = `plan_preview_${randomBytes(5).toString('hex')}` as const;
  try {
    const dataset = controlledCatalog();
    const initial = await preparePreviewDatabase(
      db,
      dataset,
      role,
      randomBytes(32).toString('hex')
    );
    assert.deepEqual(initial.counts, {
      courses: 3,
      sections: 4,
      instructors: 3,
    });
    assert.equal(initial.imported.imported, true);
    const runtime = asTestRole(db, role);
    assert.equal(
      (
        await verifyRuntimeDatabase(
          runtime,
          dataset.semester.key,
          initial.hash,
          initial.binding.id
        )
      ).restricted,
      true
    );
    await assert.rejects(
      verifyRuntimeDatabase(
        db,
        dataset.semester.key,
        initial.hash,
        initial.binding.id
      ),
      /NOT_RESTRICTED/
    );
    assert.equal(
      (
        await preparePreviewDatabase(
          db,
          dataset,
          role,
          'synthetic-password-will-not-reset-existing-role'
        )
      ).imported.imported,
      false
    );
    const before = await getCatalog(db, dataset.semester.key);
    await db.query(
      "UPDATE planora.courses SET title='Existing reviewed SQL edit' WHERE legacy_id='fixturea'"
    );
    await assert.rejects(
      preparePreviewDatabase(
        db,
        dataset,
        role,
        'synthetic-password-will-not-reset-existing-role'
      ),
      /IMPORT_WOULD_OVERWRITE/
    );
    assert.equal(
      (await getCatalog(db, dataset.semester.key)).dataset.courses[0].name,
      'Existing reviewed SQL edit'
    );
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM planora.catalog_snapshots'))
        .rows[0].n,
      1
    );
    assert.equal(before.revision, 1);
  } finally {
    await db.close();
  }
  const foreign = await unmigratedTestDb();
  try {
    await foreign.query('CREATE TABLE public.existing_application(id integer)');
    await foreign.query('INSERT INTO public.existing_application VALUES(42)');
    await assert.rejects(
      preparePreviewDatabase(
        foreign,
        controlledCatalog(),
        role,
        randomBytes(32).toString('hex')
      ),
      /NOT_EMPTY_OR_NOT_BOUND/
    );
    assert.equal(
      (await foreign.query('SELECT id FROM public.existing_application'))
        .rows[0].id,
      42
    );
    assert.equal(
      (await foreign.query("SELECT to_regclass('planora.courses') AS name"))
        .rows[0].name,
      null
    );
    await foreign.query('DROP TABLE public.existing_application'); // Only this disposable test fixture.
  } finally {
    await foreign.close();
  }
});
test('Redis preview fence only binds an empty or already-bound isolated store', async () => {
  for (const result of [-1, -2])
    await assert.rejects(
      bindPreviewRedis('https://fixture.upstash.io', 'synthetic', async () =>
        response({ result })
      ),
      /NOT_EMPTY_OR_NOT_BOUND/
    );
  await bindPreviewRedis(
    'https://fixture.upstash.io',
    'synthetic',
    async (_input, init) => {
      const command = JSON.parse(String(init?.body));
      assert.equal(command[0], 'EVAL');
      assert(command[1].includes('DBSIZE'));
      assert.equal(command[4], `${REPOSITORY}:preview`);
      return response({ result: 1 });
    }
  );
});
