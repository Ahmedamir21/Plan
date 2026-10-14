import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  collectCatalog,
  catalogRequest,
  validateContract,
  UNIVERSITY_ORIGIN,
} from '../catalog-reader.mjs';
const fixture = JSON.parse(
  await readFile(
    new URL('../fixtures/catalog-page.json', import.meta.url),
    'utf8'
  )
);
const contract = {
  version: 1,
  approved: true,
  origin: UNIVERSITY_ORIGIN,
  catalogPath: '/api/catalog/offerings',
  term: 'fixture-2026-main',
  authentication: 'bearer',
  format: 'planora.catalog-page.v1',
  reviewReference: 'SYNTHETIC TEST CONTRACT ONLY',
};
const credentials = { token: 'fixture-token-not-a-real-credential' };
const json = (data) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
const collect = (fetchImpl, other = {}) =>
  collectCatalog({
    contract,
    credentials,
    fetchImpl,
    wait: async () => {},
    ...other,
  });

test('all pages, sections and coverage; only exact HTTPS GETs with no redirect', async () => {
  const requests = [];
  const result = await collect(async (url, options) => {
    requests.push({ url, options });
    const page = Number(new URL(url).searchParams.get('page'));
    return json({
      ...fixture,
      page,
      pageCount: 2,
      courses: page === 1 ? fixture.courses : [],
      sch: page === 2 ? fixture.sch : [],
    });
  });
  assert.equal(result.dataset.courses.length + result.dataset.sch.length, 2);
  assert.equal(result.coverage.pagesRead, 2);
  assert.equal(result.coverage.sections, 2);
  assert.equal(requests.length, 2);
  for (const { url, options } of requests) {
    const u = new URL(url);
    assert.equal(u.origin, UNIVERSITY_ORIGIN);
    assert.equal(u.pathname, contract.catalogPath);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.body, undefined);
    assert(!url.includes(credentials.token));
  }
});
test('disabled contract, arbitrary URLs and registration/personal-schedule routes fail before network', () => {
  assert.throws(
    () => validateContract({ ...contract, approved: false }),
    /NOT_APPROVED/
  );
  for (const catalogPath of [
    '/Registration/Courses',
    '/api/catalog/register',
    '/api/catalog/MySchedule',
    '//evil.test/catalog',
    '/api/catalog?url=evil',
    '/api/catalog/%2e%2e',
    '/api/catalog/../student',
    '/api/catalog/drop',
    '/api/catalog/enroll',
    '/api/catalog/submit',
    '/api/catalog/save',
  ])
    assert.throws(
      () => validateContract({ ...contract, catalogPath }),
      /UNSAFE_SOURCE/
    );
  assert.throws(
    () => validateContract({ ...contract, origin: 'https://evil.test' }),
    /UNSAFE_SOURCE/
  );
  assert.throws(() => catalogRequest(contract, 1, {}), /CREDENTIALS_MISSING/);
});
test('login failure, expired session, access denied, redirect, missing catalog and MFA/CAPTCHA stop safely', async () => {
  for (const [status, code] of [
    [401, 'AUTHENTICATION_FAILED_OR_EXPIRED'],
    [403, 'ACCESS_DENIED_OR_CHALLENGE'],
    [302, 'UNEXPECTED_REDIRECT'],
    [404, 'CATALOG_NOT_FOUND'],
  ]) {
    let calls = 0;
    await assert.rejects(
      collect(async () => {
        calls++;
        return new Response('secret error body', { status });
      }),
      new RegExp(code)
    );
    assert.equal(calls, 1);
  }
  for (const html of [
    '<form>MFA CAPTCHA</form>',
    await readFile(
      new URL('../fixtures/registration-page.html', import.meta.url),
      'utf8'
    ),
  ])
    await assert.rejects(
      collect(
        async () =>
          new Response(html, { headers: { 'Content-Type': 'text/html' } })
      ),
      /STRUCTURE_CHANGED_OR_CHALLENGE/
    );
});
test('right-hand schedule payload, unknown controls and changed structure cannot enter academic data', async () => {
  for (const changes of [
    { personalSchedule: { courses: ['private'] } },
    { controls: [{ text: 'Drop' }] },
    { nextUrl: 'https://evil.test/catalog' },
    { complete: false },
    { courses: null },
  ])
    await assert.rejects(
      collect(async () => json({ ...fixture, ...changes })),
      /INCOMPLETE_OR_CHANGED_STRUCTURE/
    );
  const personal = structuredClone(fixture);
  personal.courses[0].studentId = 'PRIVATE';
  await assert.rejects(
    collect(async () => json(personal)),
    /NON_ACADEMIC/
  );
});
test('zero, incomplete, duplicate, changing and oversized page counts are never successful', async () => {
  for (const changes of [
    { totalCourses: 0, courses: [], sch: [] },
    { totalCourses: 3 },
    { totalSections: 3 },
    { pageCount: 10001 },
    { courses: [] },
    { complete: false },
  ])
    await assert.rejects(collect(async () => json({ ...fixture, ...changes })));
  await assert.rejects(
    collect(async (url) =>
      json({
        ...fixture,
        page: Number(new URL(url).searchParams.get('page')),
        pageCount: 2,
        totalCourses: 4,
        totalSections: 4,
      })
    ),
    /DUPLICATE_COURSE/
  );
  await assert.rejects(
    collect(async (url) => {
      const page = Number(new URL(url).searchParams.get('page'));
      return json({
        ...fixture,
        page,
        pageCount: 2,
        snapshot: page === 1 ? 'first' : 'second',
      });
    }),
    /CHANGED_DURING_PAGINATION/
  );
});
test('bounded retry/backoff; transient recovery and safe timeout errors never include tokens', async () => {
  let attempts = 0;
  const sleeps = [];
  const result = await collect(
    async () => {
      attempts++;
      return attempts < 3
        ? new Response('not logged', { status: 503 })
        : json(fixture);
    },
    { wait: async (ms) => sleeps.push(ms) }
  );
  assert.equal(result.coverage.courses, 2);
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [500, 1000]);
  attempts = 0;
  await assert.rejects(
    collect(async () => {
      attempts++;
      throw new Error(credentials.token);
    }),
    (error) =>
      error.message === 'SOURCE_NETWORK_TIMEOUT' &&
      !error.stack.includes(credentials.token)
  );
  assert.equal(attempts, 3);
});
test('basic authentication is restricted to the approved endpoint; content size is bounded, not truncated', async () => {
  const request = catalogRequest({ ...contract, authentication: 'basic' }, 1, {
    username: 'fixture',
    password: 'test-only',
  });
  assert.equal(request.options.method, 'GET');
  assert(!request.url.includes('fixture:'));
  await assert.rejects(
    collect(
      async () =>
        new Response('{}', {
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': '2000001',
          },
        })
    ),
    /TOO_LARGE/
  );
});
