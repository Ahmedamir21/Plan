/** Real browser + HTTP handlers + SQL. Source, Redis and mail are controlled fixtures.
 * Refuses real database URLs via testDb; never contacts a university or sends email.
 */
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { testDb, asTestRole } from '../tests/helpers';
import { useTestDatabase } from '../server/db';
import { apiServer } from '../server/http-adapter';
import { importCatalog, getCatalog } from '../server/catalog-repository';
import {
  canonical,
  counts,
  sha,
  normalizeDataset,
} from '../server/catalog-model';
import { readFixtures } from '../server/fixtures';
import { createRun, inspectRun, publishRun } from '../server/sync-service';
import { runCatalogJob } from '../server/catalog-job';
import {
  subscribe,
  applySubscriptionToken,
  subscriptionToken,
  deliverNotifications,
} from '../server/notifications';
import { controlledCatalog, changedCatalog } from './fixture';
import { openBrowser, restrictBrowser } from './browser';
import { exercisePlannerBrowser } from './preview-smoke';
import { uid } from '../../Final_Fall_2026_ZewailCity/Templates-Final-Final-main/Zewail-City-Templates-arena-01a09711-zewail-city-templates/Final_Fall_2026_ZewailCity/Final_Fall_2026_Zewail/src/lib/picks';
import {
  selectedSnapshot,
  scheduleImpacts,
} from '../../Final_Fall_2026_ZewailCity/Templates-Final-Final-main/Zewail-City-Templates-arena-01a09711-zewail-city-templates/Final_Fall_2026_ZewailCity/Final_Fall_2026_Zewail/src/lib/scheduleImpact';
const base = controlledCatalog(),
  changed = changedCatalog();
const contract = {
  version: 1,
  approved: true,
  origin: 'https://sisselfservice.zewailcity.edu.eg',
  catalogPath: '/api/catalog/synthetic-fixture',
  term: base.semester.key,
  authentication: 'bearer',
  format: 'planora.catalog-page.v1',
  reviewReference: 'CONTROLLED FIXTURE ONLY - NOT LIVE AUTHORIZATION',
};
const dist = fileURLToPath(
  new URL(
    '../../Final_Fall_2026_ZewailCity/Templates-Final-Final-main/Zewail-City-Templates-arena-01a09711-zewail-city-templates/Final_Fall_2026_ZewailCity/Final_Fall_2026_Zewail/dist/',
    import.meta.url
  )
);
const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)
    )
  );
const close = (server: Server) =>
  new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
const db = await testDb(false);
const originalFetch = globalThis.fetch;
let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
let web: Server | undefined, source: Server | undefined;
const evidence: Record<string, unknown> = {
  kind: 'controlled-fixture-e2e',
  database: process.env.TEST_DATABASE_URL
    ? 'native-postgresql'
    : 'postgresql-wasm',
  realUniversityAccess: false,
  realEmails: 0,
};
try {
  await readFile(
    new URL('../db/permissions.sql', import.meta.url),
    'utf8'
  ).then((sql) => db.exec(sql));
  await importCatalog(db, base);
  const runtime = asTestRole(db, 'planora_runtime'),
    worker = asTestRole(db, 'planora_worker');
  useTestDatabase(runtime);
  process.env.PLANORA_TERM_KEY = base.semester.key;
  process.env.PLANORA_SQL_CUTOVER_APPROVED = 'false';
  process.env.PLANORA_SELF_SERVICE_ENABLED = 'false';
  process.env.PLANORA_EMAIL_MODE = 'mock';
  process.env.PLANORA_EMAIL_LIVE_APPROVED = 'false';
  process.env.PLANORA_SECURITY_MAIL_ENABLED = 'false';
  delete process.env.RESEND_API_KEY;
  delete process.env.PLANORA_REPORT_MAIL_WEBHOOK_URL;
  delete process.env.PLANORA_REPORT_MAIL_WEBHOOK_SECRET;
  process.env.PLANORA_EMAIL_TOKEN_SECRET = randomBytes(40).toString('hex');
  process.env.PLANORA_ADMIN_SESSION_SECRET = randomBytes(40).toString('hex');
  const passwords = {
    ahmed: randomBytes(24).toString('hex'),
    youssef: randomBytes(24).toString('hex'),
  };
  for (const name of ['ahmed', 'youssef'] as const) {
    const salt = randomBytes(16);
    process.env[`PLANORA_ADMIN_${name.toUpperCase()}_PASSWORD_HASH`] =
      `${salt.toString('hex')}:${scryptSync(passwords[name], salt, 64).toString('hex')}`;
  }
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.fixture.invalid';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'synthetic-no-network-token';
  const operations: { method: string; path: string }[] = [];
  globalThis.fetch = async (input, init) => {
    const target = String(input);
    if (target === 'https://redis.fixture.invalid') {
      const [command] = JSON.parse(String(init?.body));
      const result =
        command === 'LRANGE' || command === 'HMGET'
          ? []
          : command === 'HGET' || command === 'GET'
            ? null
            : 1;
      assert(
        ['EVAL', 'LPUSH', 'LRANGE', 'HMGET', 'HGET', 'GET'].includes(command),
        `Unexpected fixture Redis command ${command}`
      );
      return new Response(JSON.stringify({ result }), { status: 200 });
    }
    assert(
      new URL(target).hostname === '127.0.0.1',
      'Test must not make an external network request'
    );
    return originalFetch(input, init);
  };
  let variant: 'valid' | 'partial' | 'malformed' = 'valid';
  let sourceRequests = 0;
  source = createServer((req, res) => {
    assert.equal(req.method, 'GET');
    const url = new URL(req.url!, 'http://fixture.invalid');
    assert.equal(url.pathname, '/catalog');
    sourceRequests++;
    const page = Number(url.searchParams.get('page')),
      data = structuredClone(changed);
    if (variant === 'malformed')
      data.courses[0].instructors[0].lectures[0].end = 700;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        format: contract.format,
        term: contract.term,
        snapshot: 'synthetic-v2',
        page,
        pageCount: 2,
        totalCourses: 3,
        totalSections: variant === 'partial' ? 6 : 5,
        complete: true,
        courses: page === 1 ? data.courses : [],
        sch: page === 2 ? data.sch : [],
      })
    );
  });
  const sourceOrigin = await listen(source);
  const collect = async () => {
    const run = await createRun(
      runtime,
      base.semester.key,
      'fixture-admin',
      'self-service',
      sha(canonical(contract))
    );
    const result = await runCatalogJob(
      worker,
      {
        runId: run.id,
        contract,
        credentials: { token: 'synthetic-catalog-credential' },
      },
      {
        wait: async () => {},
        fetchImpl: async (url, options) => {
          const expected = new URL(String(url));
          assert.equal(expected.origin, contract.origin);
          assert.equal(expected.pathname, contract.catalogPath);
          assert.equal(options?.method, 'GET');
          assert.equal(options?.redirect, 'manual');
          return originalFetch(
            `${sourceOrigin}/catalog?page=${expected.searchParams.get('page')}`,
            { method: 'GET', redirect: 'error' }
          );
        },
      }
    );
    return result;
  };
  await subscribe(runtime, base.semester.key, {
    action: 'subscribe',
    email: 'fixture-student@example.invalid',
    courseIds: ['fixturea'],
    consent: true,
  });
  const subscription = (
    await db.query('SELECT * FROM planora.email_subscriptions')
  ).rows[0];
  await applySubscriptionToken(
    runtime,
    subscriptionToken(subscription, 'verify'),
    'verify'
  );
  web = apiServer({
    staticDirectory: dist,
    observe: (method, path) => operations.push({ method, path }),
  });
  const origin = await listen(web);
  assert.equal(
    (await fetch(`${origin}/api/admin?action=sync_status`)).status,
    401
  );
  evidence.previewBrowserSmoke = await exercisePlannerBrowser(
    origin,
    await (await fetch(`${origin}/api/catalog`)).json(),
    passwords.ahmed
  );
  const picks = {
    fixturea: {
      Lecture: uid(base.courses[0].instructors[0].lectures[0]),
      Lab: uid(base.courses[0].instructors[0].labs[0]),
      Tutorial: null,
    },
    fixtureb: {
      Lecture: uid(base.courses[1].instructors[0].lectures[0]),
      Lab: null,
      Tutorial: null,
    },
  };
  const snapshot = selectedSnapshot(
    picks,
    Object.fromEntries(base.courses.map((c) => [c.id, c]))
  );
  assert.equal(
    scheduleImpacts(
      picks,
      Object.fromEntries(base.courses.map((c) => [c.id, c])),
      snapshot
    ).length,
    0
  );
  const saved = {
    semesterKey: base.semester.key,
    majorId: 'it',
    yearId: 'y2',
    picks,
    instructorFilter: {},
    catalogRevision: 1,
    selectedSnapshot: snapshot,
  };
  browser = await openBrowser();
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const blocked = await restrictBrowser(context, origin);
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', () => pageErrors.push('BROWSER_RUNTIME_ERROR'));
  await page.goto(origin);
  await page.getByText('Choose Your Year', { exact: true }).waitFor();
  await page.evaluate(
    (value) => localStorage.setItem('zw-app-state-v2', JSON.stringify(value)),
    saved
  );
  await page.reload();
  await page
    .getByRole('button', { name: 'Change year', exact: true })
    .waitFor();
  const beforeRaw = await page.evaluate(() =>
    localStorage.getItem('zw-app-state-v2')
  );
  assert(beforeRaw);
  const before = await getCatalog(runtime, base.semester.key);
  const staged = await collect();
  assert.equal(staged.status, 'awaiting_review');
  const proposal = await inspectRun(runtime, staged.id, base.semester.key);
  assert(
    proposal.changes.some(
      (c: any) => c.category === 'section_added' && c.after.sec === '02'
    )
  );
  assert(
    proposal.changes.some(
      (c: any) =>
        c.category === 'section_modified' &&
        c.fields.includes('start') &&
        c.before.start === 600 &&
        c.after.start === 750
    )
  );
  assert.equal(
    (await getCatalog(runtime, base.semester.key)).hash,
    before.hash
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM planora.notification_deliveries WHERE kind='catalog_change'"
      )
    ).rows[0].n,
    0
  );
  evidence.discovered = {
    pages: 2,
    section: 'Lab 02',
    changedStart: [600, 750],
    changedEnd: [660, 810],
  };
  // Failure after ALL relational/audit/outbox writes must roll back ALL of them.
  await assert.rejects(
    publishRun(
      runtime,
      staged.id,
      staged.hash,
      'fixture-admin',
      'Controlled rollback test',
      false,
      async () => {
        throw new Error('INJECTED_TRANSACTION_FAILURE');
      }
    ),
    /INJECTED_TRANSACTION_FAILURE/
  );
  assert.equal(
    (await getCatalog(runtime, base.semester.key)).hash,
    before.hash
  );
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM planora.catalog_changes'))
      .rows[0].n,
    0
  );
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM planora.catalog_snapshots'))
      .rows[0].n,
    1
  );
  const approval = {
    action: 'sync_publish',
    id: staged.id,
    hash: staged.hash,
    reason: 'Explicit approval of controlled fixture only',
    approveRemovals: false,
  };
  assert.equal(
    (
      await fetch(`${origin}/api/admin`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(approval),
      })
    ).status,
    401
  );
  // Real browser login/session, real same-origin protected API. No manufactured cookie.
  await page.goto(`${origin}/admin.html`);
  await page.getByLabel('Username', { exact: true }).fill('ahmed');
  await page.getByLabel('Password', { exact: true }).fill(passwords.ahmed);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Log out', exact: true }).waitFor();
  await page
    .getByRole('button', { name: 'Inspect changes', exact: true })
    .first()
    .click();
  await page
    .getByRole('heading', {
      name: 'Proposed academic changes — not published',
      exact: true,
    })
    .waitFor();
  const inspection = page.getByLabel('Change inspection');
  assert((await inspection.innerText()).includes('2 change records'));
  await page
    .getByPlaceholder('Describe the official source and coverage you checked')
    .fill(approval.reason);
  page.once('dialog', (dialog) => void dialog.accept());
  const published = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin') &&
      response.request().method() === 'POST'
  );
  await page
    .getByRole('button', { name: 'Publish reviewed changes', exact: true })
    .click();
  const publish = await published;
  assert.equal(publish.status(), 200);
  assert.equal((await publish.json()).revision, 2);
  const updated = await getCatalog(runtime, base.semester.key);
  assert.deepEqual(counts(updated.dataset), {
    courses: 3,
    sections: 5,
    instructors: 3,
  });
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM planora.catalog_snapshots'))
      .rows[0].n,
    2
  );
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM planora.catalog_changes'))
      .rows[0].n,
    2
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM planora.notification_deliveries WHERE kind='catalog_change'"
      )
    ).rows[0].n,
    2
  );
  const review = (
    await db.query(
      'SELECT reviewed_by,review_reason FROM planora.sync_runs WHERE id=$1',
      [staged.id]
    )
  ).rows[0];
  assert.equal(review.reviewed_by, 'ahmed');
  await page.goto(origin);
  await page
    .getByRole('button', { name: 'Change year', exact: true })
    .waitFor();
  await page
    .getByRole('heading', {
      name: 'Review catalog updates for your saved plan',
    })
    .waitFor();
  assert(
    (
      await page.locator('#schedule-impact-heading').locator('..').innerText()
    ).includes('published meeting times now overlap')
  );
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('zw-app-state-v2')!)
  );
  assert.deepEqual(stored.picks, picks);
  assert.equal(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      `planora-preserved-schedule:${base.semester.key}:before-2`
    ),
    beforeRaw
  );
  const committedHash = updated.hash;
  const repeat = await collect();
  assert.match(repeat.status, /^completed/);
  assert.equal((await getCatalog(runtime, base.semester.key)).revision, 2);
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM planora.catalog_changes'))
      .rows[0].n,
    2
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM planora.notification_deliveries WHERE kind='catalog_change'"
      )
    ).rows[0].n,
    2
  );
  for (const invalid of ['partial', 'malformed'] as const) {
    variant = invalid;
    await assert.rejects(collect());
    assert.equal(
      (await getCatalog(runtime, base.semester.key)).hash,
      committedHash
    );
  }
  const delivered = await deliverNotifications(
    asTestRole(db, 'planora_mailer'),
    20
  );
  assert.equal(delivered.sent, 0);
  assert.equal(delivered.mocked, 2);
  assert.equal(
    (await deliverNotifications(asTestRole(db, 'planora_mailer'), 20)).mocked,
    0
  );
  assert.equal(pageErrors.length, 0);
  assert(blocked.every((origin) => origin === 'https://fonts.googleapis.com'));
  evidence.blockedExternalFontRequests = blocked.length;
  assert(
    operations
      .filter((o) => o.method === 'POST')
      .every((o) => o.path === '/api/admin')
  );
  evidence.studentSelectionsUploaded = false;
  evidence.assertions = {
    newSectionDiscovered: true,
    changedTimesInDiff: true,
    partialAndMalformedRejected: true,
    approvalRequired: true,
    atomicSqlSnapshotAuditOutbox: true,
    originalSelectionsAndRawBackupPreserved: true,
    newConflictWarning: true,
    retryDeduplicated: true,
    failureRetainsPublishedCatalog: true,
  };
  evidence.counts = {
    before: counts(base),
    after: counts(updated.dataset),
    academicChanges: 2,
    notificationEntries: 2,
    realEmails: 0,
    mockedEmails: 2,
    sourceRequests,
  };
  evidence.boundaries = {
    source: 'loopback HTTP fixture, never university',
    redis: 'in-memory response stub',
    browser: 'real headless Chromium',
    api: 'real Vercel handlers via local adapter',
    mail: 'mock provider',
    cutoverApproved: false,
  };
  await context.close();
  await browser.close();
  browser = undefined;
  // The existing 70-course catalog is also exercised through real SQL + HTTP + browser,
  // not just fixture injection. It is a separate term from the synthetic change scenario.
  const originalCatalog = normalizeDataset(await readFixtures()).dataset;
  await importCatalog(db, originalCatalog);
  process.env.PLANORA_TERM_KEY = originalCatalog.semester.key;
  const originalResponse = await (await fetch(`${origin}/api/catalog`)).json();
  assert.equal(originalResponse.source, 'postgresql');
  assert.deepEqual(counts(originalResponse), {
    courses: 70,
    sections: 287,
    instructors: 92,
  });
  evidence.originalCatalogBrowserSmoke = {
    counts: counts(originalResponse),
    ...(await exercisePlannerBrowser(
      origin,
      originalResponse,
      passwords.ahmed
    )),
  };

  await mkdir(new URL('../.data/evidence/', import.meta.url), {
    recursive: true,
  });
  await writeFile(
    new URL('../.data/evidence/catalog-flow.json', import.meta.url),
    JSON.stringify(evidence, null, 2) + '\n'
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close();
  if (web) await close(web);
  if (source) await close(source);
  globalThis.fetch = originalFetch;
  useTestDatabase();
  await db.close();
}
