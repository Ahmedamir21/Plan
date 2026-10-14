import assert from 'node:assert/strict';
import { SafeError } from '../server/errors';
import { openBrowser, restrictBrowser } from './browser';
import { REPOSITORY, BRANCH } from '../ops/preview-contract';
export type SmokeTarget = {
  url: string;
  sha: string;
  hash: string;
  bindingId: string;
  password: string;
  bypassSecret?: string;
};
/** Actual HTTPS Preview verifier. Private drafts only: never publishes a catalog. No screenshots/traces. */
export async function verifyPreview(target: SmokeTarget) {
  const url = new URL(target.url);
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.vercel.app') ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new SafeError('INVALID_PREVIEW_SMOKE_ORIGIN');
  const headers: Record<string, string> = target.bypassSecret
    ? { 'x-vercel-protection-bypass': target.bypassSecret }
    : {};
  const request = async (path: string) => {
    const r = await fetch(url.origin + path, {
      redirect: 'error',
      headers,
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new SafeError(`PREVIEW_HTTP_${r.status}`);
    return r.json();
  };
  const identity = await request('/api/deployment');
  if (
    identity.repository !== REPOSITORY ||
    identity.branch !== BRANCH ||
    identity.sha !== target.sha ||
    identity.environment !== 'preview' ||
    identity.source !== 'postgresql' ||
    identity.binding?.id !== target.bindingId ||
    identity.binding.repository !== REPOSITORY ||
    identity.binding.purpose !== 'preview' ||
    identity.catalog?.hash !== target.hash ||
    identity.safeguards?.productionCutoverApproved !== false ||
    identity.safeguards?.universitySyncEnabled !== false ||
    identity.safeguards?.emailMode !== 'disabled' ||
    identity.safeguards?.securityEmailEnabled !== false
  )
    throw new SafeError('PREVIEW_HTTP_IDENTITY_OR_SAFEGUARD_MISMATCH');
  const catalog = await request('/api/catalog');
  assert.equal(catalog.hash, target.hash);
  assert.equal(catalog.source, 'postgresql');
  const disabled = await request('/api/notifications');
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.mode, 'disabled');
  const protectedRead = await fetch(
    url.origin + '/api/admin?action=sync_status',
    { headers, redirect: 'error' }
  );
  assert.equal(protectedRead.status, 401);
  const browser = await exercisePlannerBrowser(
    url.origin,
    catalog,
    target.password,
    headers
  );
  return {
    ...browser,
    catalog: true,
    anonymousAdminDenied: true,
    repository: identity.repository,
    branch: identity.branch,
    sha: identity.sha,
    environment: identity.environment,
    source: identity.source,
    catalogCounts: identity.catalog,
  };
}

/** Shared real browser smoke, also exercised on the isolated fixture HTTP server. */
export async function exercisePlannerBrowser(
  origin: string,
  catalog: any,
  password: string,
  headers: Record<string, string> = {}
) {
  const request = async (path: string) => {
    const r = await fetch(origin + path, {
      redirect: 'error',
      headers,
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new SafeError(`PREVIEW_HTTP_${r.status}`);
    return r.json();
  };
  const browser = await openBrowser();
  let phase = 'planner_load';
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const blocked = await restrictBrowser(context, origin, headers);
    const page = await context.newPage();
    let runtimeErrors = 0;
    page.on('pageerror', () => runtimeErrors++);
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    // Build a schedule with the actual student controls, then verify a reload preserves it.
    const course = catalog.courses.find(
      (c: any) =>
        c.instructors.some((i: any) => i.lectures.length) &&
        catalog.majors.some((m: any) =>
          m.years.some((y: any) => y.courseIds.includes(c.id))
        )
    );
    assert(course);
    const major = catalog.majors.find((m: any) =>
        m.years.some((y: any) => y.courseIds.includes(course.id))
      ),
      year = major.years.find((y: any) => y.courseIds.includes(course.id));
    phase = 'year_selection';
    const yearLabels: Record<string, string> = {
      y1: 'Year 1 (Freshman)',
      y2: 'Year 2 (Sophomore)',
      y3: 'Year 3 (Junior)',
      y4: 'Year 4 (Senior)',
    };
    await page.getByText(yearLabels[year.id], { exact: true }).first().click();
    phase = 'major_selection';
    await page.getByText(major.title, { exact: true }).first().click();
    phase = 'course_selection';
    await page.getByLabel(`Register ${course.code}`, { exact: true }).check();
    phase = 'meeting_selection';
    await page
      .locator(`input[type=radio][name="${course.id}-Lecture"]:enabled`)
      .first()
      .check();
    await page.waitForFunction(
      (id) =>
        JSON.parse(localStorage.getItem('zw-app-state-v2') || '{}').picks?.[id]
          ?.Lecture,
      course.id
    );
    const picks = await page.evaluate(
      () => JSON.parse(localStorage.getItem('zw-app-state-v2')!).picks
    );
    phase = 'saved_plan_reload';
    await page.reload();
    await page
      .getByRole('button', { name: 'Change year', exact: true })
      .waitFor();
    assert.deepEqual(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('zw-app-state-v2')!).picks
      ),
      picks
    );
    phase = 'admin_login';
    await page.goto(origin + '/admin.html');
    await page.getByLabel('Username', { exact: true }).fill('ahmed');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Log out', exact: true }).waitFor();
    const adminGet = (path: string) =>
      page.evaluate(async (path) => {
        const r = await fetch(path, { cache: 'no-store' });
        return { status: r.status, data: await r.json() };
      }, path);
    const adminPost = (body: unknown) =>
      page.evaluate(async (body) => {
        const r = await fetch('/api/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return { status: r.status, data: await r.json() };
      }, body);
    phase = 'private_draft_edit_and_undo';
    for (const file of [
      'courses.json',
      'sch.json',
      'majors.json',
      'semester.json',
    ]) {
      const previous = await adminGet(`/api/admin?action=draft&file=${file}`);
      assert.equal(previous.status, 200);
      if (previous.data.content !== null)
        throw new SafeError('PREVIEW_HAS_EXISTING_DRAFT_REVIEW_BEFORE_SMOKE');
    }
    const content = structuredClone(catalog.courses);
    content[0].name += ' (private acceptance draft only)';
    const saved = await adminPost({
      action: 'save_draft',
      file: 'courses.json',
      content: JSON.stringify(content),
      expectedRevision: '',
      source: 'Isolated preview smoke test: private edit only',
    });
    assert.equal(saved.status, 200);
    try {
      const draft = await adminGet('/api/admin?action=draft&file=courses.json');
      assert.equal(draft.status, 200);
      assert.equal(JSON.parse(draft.data.content)[0].name, content[0].name);
      assert.equal((await request('/api/catalog')).hash, catalog.hash);
    } finally {
      // Restore only OUR exact saved revision, with an audit entry; never erase someone else's concurrent work.
      const undo = await adminPost({
        action: 'undo',
        file: 'courses.json',
        expectedRevision: saved.data.revision,
        source:
          'Restore the prior empty draft after isolated preview verification',
      });
      if (undo.status !== 200)
        throw new SafeError('PREVIEW_TEST_DRAFT_REQUIRES_MANUAL_REVIEW');
    }
    assert.equal((await request('/api/catalog')).hash, catalog.hash);
    const sync = await adminGet('/api/admin?action=sync_status');
    assert.equal(sync.data.capability.enabled, false);
    assert(['disabled', 'mock'].includes(sync.data.emailMode));
    assert.equal(runtimeErrors, 0);
    assert(
      blocked.every((origin) => origin === 'https://fonts.googleapis.com')
    );
    await context.close();
    return {
      adminLogin: true,
      privateEditingAndUndo: true,
      studentScheduleBuilt: true,
      savedScheduleReload: true,
      publishedCatalogUnchanged: true,
      liveFeaturesDisabled: true,
      blockedExternalFontRequests: blocked.length,
    };
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError('DEPLOYED_PREVIEW_SMOKE_FAILED', 400, [phase]);
  } finally {
    // Do not log browser call arguments/passwords.
    await browser.close();
  }
}
