import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, scryptSync } from 'node:crypto';
import catalog from '../api/catalog';
import deployment from '../api/deployment';
import changes from '../api/changes';
import admin from '../api/admin';
import notifications from '../api/notifications';
import legacy from '../api/sync-ingest';
import { testDb, fixture } from './helpers';
import { useTestDatabase } from '../server/db';
import { subscribe, subscriptionToken } from '../server/notifications';
import { createRun, stageRun, publishRun } from '../server/sync-service';
const invoke = async (
  handler: any,
  method = 'GET',
  query = {},
  body = {},
  cookie = '',
  origin = 'https://planner.example.invalid'
) => {
  const result: {
    status: number;
    body: any;
    headers: Record<string, unknown>;
  } = { status: 0, body: null, headers: {} };
  const res = {
    setHeader: (name: string, value: unknown) => {
      result.headers[name] = value;
    },
    status: (code: number) => {
      result.status = code;
      return res;
    },
    json: (data: unknown) => {
      result.body = data;
      return res;
    },
  };
  await handler(
    {
      method,
      headers: {
        host: 'planner.example.invalid',
        origin,
        cookie,
        'content-type': 'application/json',
      },
      socket: { remoteAddress: '192.0.2.1' },
      query,
      body,
    },
    res
  );
  return result;
};
function testCookie() {
  const salt = randomBytes(16),
    hash = `${salt.toString('hex')}:${scryptSync('test-only-long-password', salt, 64).toString('hex')}`;
  process.env.PLANORA_ADMIN_AHMED_PASSWORD_HASH = hash;
  process.env.PLANORA_ADMIN_YOUSSEF_PASSWORD_HASH = hash;
  process.env.PLANORA_ADMIN_SESSION_SECRET = randomBytes(40).toString('hex');
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.invalid';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-only-token';
  const payload = Buffer.from(
    JSON.stringify({
      id: 'ahmed',
      exp: Date.now() + 60000,
      credentialVersion: createHash('sha256').update(hash).digest('hex'),
    })
  ).toString('base64url');
  return `planora_admin=${payload}.${createHmac('sha256', process.env.PLANORA_ADMIN_SESSION_SECRET).update(payload).digest('base64url')}`;
}
test('SQL-only public API, publication visibility, authorization, CSRF and redacted failures', async () => {
  const db = await testDb();
  useTestDatabase(db);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ result: 1 }));
  try {
    const cookie = testCookie(),
      d = await fixture();
    const loaded = await invoke(catalog);
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.source, 'postgresql');
    assert.equal(loaded.body.courses.length, 57);
    const evidence = await invoke(deployment);
    assert.equal(evidence.status, 200);
    assert.equal(evidence.body.source, 'postgresql');
    assert.equal(evidence.body.catalog.courses, 70);
    assert.equal(evidence.body.repository, null);
    assert(!JSON.stringify(evidence.body).includes('DATABASE_URL'));
    assert.equal((await invoke(deployment, 'POST')).status, 405);
    assert(loaded.body.semester.key);
    assert.equal(
      (await invoke(catalog, 'GET', { catalog: 'arbitrary' })).status,
      400
    );
    assert.equal(
      (await invoke(catalog, 'GET', { courseId: d.courses[0].id })).body.course
        .id,
      d.courses[0].id
    );
    assert.equal(
      (await invoke(admin, 'GET', { action: 'sync_status' })).status,
      401
    );
    assert.equal(
      (
        await invoke(
          admin,
          'POST',
          {},
          { action: 'sync_start', confirmed: true }
        )
      ).status,
      401
    );
    assert.equal(
      (
        await invoke(
          admin,
          'POST',
          {},
          { action: 'sync_start', confirmed: true },
          cookie,
          'https://evil.example.invalid'
        )
      ).status,
      403
    );
    assert.equal(
      (
        await invoke(
          admin,
          'POST',
          {},
          {
            action: 'sync_start',
            confirmed: true,
            extraUrl: 'https://evil.example.invalid',
          },
          cookie
        )
      ).status,
      400
    );
    assert.equal(
      (
        await invoke(
          admin,
          'POST',
          {},
          { action: 'sync_start', confirmed: true },
          cookie
        )
      ).status,
      503
    ); // Unapproved contract, no network call.
    const status = await invoke(
      admin,
      'GET',
      { action: 'sync_status' },
      {},
      cookie
    );
    assert.equal(status.body.capability.enabled, false);
    assert(!JSON.stringify(status.body).includes('test-only-token'));
    assert.equal(
      (await invoke(legacy, 'POST', {}, { dataset: d })).status,
      410
    );
    const run = await createRun(db, d.semester.key, 'admin', 'admin');
    const next = structuredClone(d);
    next.courses[0].name = 'Public academic title';
    const proposal = await stageRun(db, run.id, next);
    assert.equal((await invoke(changes)).body.changes.length, 0);
    await publishRun(
      db,
      run.id,
      proposal.hash,
      'admin',
      'Internal-only review comment'
    );
    const publicHistory = await invoke(changes, 'GET', {
      q: d.courses[0].code,
    });
    assert.equal(publicHistory.body.changes.length, 1);
    assert.equal(publicHistory.body.verified, true);
    const serialized = JSON.stringify(publicHistory.body);
    assert(
      !serialized.includes('Internal-only') &&
        !serialized.includes('requested_by') &&
        !serialized.includes('worker_token')
    );
    assert.equal(
      (await invoke(changes, 'GET', { q: 'NOT-A-COURSE' })).body.changes.length,
      0
    );
    assert.equal(
      (await invoke(changes, 'GET', { category: 'bad' })).status,
      400
    );
    process.env.PLANORA_EMAIL_MODE = 'mock';
    process.env.PLANORA_EMAIL_TOKEN_SECRET =
      'test-only-32-plus-character-subscription-secret';
    await subscribe(db, d.semester.key, {
      action: 'subscribe',
      email: 'api@example.invalid',
      courseIds: [d.courses[0].id],
      consent: true,
    });
    const subscriber = (
      await db.query('SELECT * FROM planora.email_subscriptions')
    ).rows[0];
    process.env.PLANORA_EMAIL_MODE = 'disabled';
    assert.equal((await invoke(notifications)).body.enabled, false);
    globalThis.fetch = async () => {
      throw new Error('Redis unavailable');
    };
    assert.equal(
      (
        await invoke(
          notifications,
          'POST',
          {},
          {
            action: 'unsubscribe',
            token: subscriptionToken(subscriber, 'unsubscribe'),
          }
        )
      ).body.status,
      'unsubscribed'
    );
    useTestDatabase({
      ...db,
      transaction: async () => {
        throw new Error('database-password-should-not-appear');
      },
    });
    const failed = await invoke(catalog);
    assert.equal(failed.status, 503);
    assert(!JSON.stringify(failed.body).includes('password'));
    assert.equal(failed.body.courses, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    useTestDatabase();
    await db.close();
  }
});
