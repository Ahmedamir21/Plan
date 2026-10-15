import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, fixture } from './helpers';
import {
  applySubscriptionToken,
  deliverNotifications,
  readSubscriptionToken,
  subscribe,
  subscriptionInput,
  subscriptionToken,
} from '../server/notifications';
import { emailProvider, MailError } from '../server/email-provider';
import { createRun, publishRun, stageRun } from '../server/sync-service';
const configure = () => {
  process.env.PLANORA_EMAIL_MODE = 'mock';
  process.env.PLANORA_EMAIL_TOKEN_SECRET =
    'test-only-email-signing-secret-not-a-real-value';
  process.env.PLANORA_PUBLIC_URL = 'https://planner.example.invalid';
};

test('explicit consent, double opt-in, private interests, committed-only outbox and unsubscribe', async () => {
  configure();
  const db = await testDb();
  const data = await fixture(),
    term = data.semester.key;
  try {
    const request = subscriptionInput.parse({
      action: 'subscribe',
      email: 'DEMO@EXAMPLE.INVALID',
      courseIds: [data.courses[0].id],
      consent: true,
    });
    assert.equal(request.email, 'demo@example.invalid');
    assert(
      !subscriptionInput.safeParse({ ...request, consent: false }).success
    );
    await subscribe(db, term, request);
    let sub = (await db.query('SELECT * FROM planora.email_subscriptions'))
      .rows[0];
    assert.equal(sub.status, 'pending');
    assert.equal(
      (await db.query('SELECT * FROM planora.notification_deliveries')).rows
        .length,
      1
    );
    const captured: string[] = [];
    assert.equal(
      (
        await deliverNotifications(db, 10, {
          send: async (mail, key) => {
            captured.push(mail.text);
            return { id: `mock-${key}`, mocked: true };
          },
        })
      ).mocked,
      1
    );
    assert(captured[0].includes('#emailAction=verify&token='));
    assert(!captured[0].includes(process.env.PLANORA_EMAIL_TOKEN_SECRET!));
    const token = subscriptionToken(sub, 'verify');
    assert.throws(
      () => readSubscriptionToken(token.replace(/.$/, '?'), 'verify'),
      /INVALID_OR_EXPIRED/
    );
    assert.throws(
      () =>
        readSubscriptionToken(
          subscriptionToken({ ...sub, consent_at: '2001-01-01' }, 'verify'),
          'verify'
        ),
      /INVALID_OR_EXPIRED/
    );
    assert.throws(
      () => readSubscriptionToken(token, 'unsubscribe'),
      /INVALID_OR_EXPIRED/
    );
    await applySubscriptionToken(db, token, 'verify');
    await applySubscriptionToken(db, token, 'verify');
    sub = (await db.query('SELECT * FROM planora.email_subscriptions')).rows[0];
    assert.equal(sub.status, 'active');
    await subscribe(db, term, { ...request, courseIds: [data.courses[1].id] });
    assert.equal(
      (
        await db.query(
          'SELECT c.legacy_id FROM planora.subscription_courses sc JOIN planora.courses c ON c.id=sc.course_id'
        )
      ).rows[0].legacy_id,
      data.courses[0].id
    );
    const run = await createRun(db, term, 'admin', 'admin');
    const changed = structuredClone(data);
    changed.courses[0].name = 'Verified changed title';
    changed.courses[1].name = 'Unfollowed change';
    const staged = await stageRun(db, run.id, changed);
    assert.equal(
      (
        await db.query(
          "SELECT * FROM planora.notification_deliveries WHERE kind='catalog_change'"
        )
      ).rows.length,
      0
    );
    await publishRun(
      db,
      run.id,
      staged.hash,
      'reviewer',
      'Verified academic information'
    );
    await publishRun(db, run.id, staged.hash, 'reviewer', 'Response retry');
    assert.equal(
      (
        await db.query(
          "SELECT * FROM planora.notification_deliveries WHERE kind='catalog_change'"
        )
      ).rows.length,
      1
    );
    const unsubscribe = subscriptionToken(sub, 'unsubscribe');
    await applySubscriptionToken(db, unsubscribe, 'unsubscribe');
    await applySubscriptionToken(db, unsubscribe, 'unsubscribe');
    const delivered = await deliverNotifications(db, 10, {
      send: async () => {
        throw new Error('Unsubscribed person must not receive a message');
      },
    });
    assert.equal(delivered.sent, 0);
    assert.equal(delivered.failed, 0);
    assert.equal(
      (
        await db.query(
          "SELECT status FROM planora.notification_deliveries WHERE kind='catalog_change'"
        )
      ).rows[0].status,
      'cancelled'
    );
  } finally {
    await db.close();
  }
});

test('email provider failure, retry bounds, idempotent key and unknown-outcome redaction', async () => {
  configure();
  const db = await testDb();
  const data = await fixture();
  try {
    await subscribe(db, data.semester.key, {
      action: 'subscribe',
      email: 'retry@example.invalid',
      courseIds: [data.courses[0].id],
      consent: true,
    });
    const keys: string[] = [];
    const failing = {
      send: async (_mail: any, key: string) => {
        keys.push(key);
        throw new MailError('EMAIL_RATE_LIMITED', true);
      },
    };
    for (let i = 0; i < 5; i++) {
      const result = await deliverNotifications(db, 1, failing);
      assert.equal(i < 4 ? result.retry : result.failed, 1);
      await db.query(
        "UPDATE planora.notification_deliveries SET next_attempt_at=now() WHERE status='pending'"
      );
    }
    assert.equal(new Set(keys).size, 1);
    assert.equal(keys.length, 5);
    const row = (
      await db.query('SELECT * FROM planora.notification_deliveries')
    ).rows[0];
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, 5);
    await deliverNotifications(db, 1, failing);
    assert.equal(keys.length, 5);
    await db.query(
      "UPDATE planora.notification_deliveries SET status='pending',attempts=1,first_attempt_at=now()-interval '2 hours' WHERE id=$1",
      [row.id]
    );
    assert.equal((await deliverNotifications(db, 1, failing)).failed, 1);
    assert.equal(keys.length, 5);
    process.env.PLANORA_EMAIL_MODE = 'resend-test';
    process.env.RESEND_API_KEY = 'test-secret-never-log';
    process.env.PLANORA_EMAIL_FROM = 'Planner <test@example.invalid>';
    process.env.PLANORA_EMAIL_TEST_RECIPIENT = 'designated@example.invalid';
    let calls = 0;
    const provider = emailProvider(async (input, init) => {
      calls++;
      assert.equal(String(input), 'https://api.resend.com/emails');
      assert.equal(init?.redirect, 'error');
      assert.equal(
        (init?.headers as any)['Idempotency-Key'],
        'planora/test-key'
      );
      assert.equal(
        JSON.parse(String(init?.body)).to[0],
        'designated@example.invalid'
      );
      return new Response(JSON.stringify({ id: 'safe-provider-id' }), {
        status: 200,
      });
    });
    await assert.rejects(
      provider.send(
        { to: 'someone-else@example.invalid', subject: 'No', text: 'No' },
        'test-key'
      ),
      /TEST_RECIPIENT_ONLY/
    );
    assert.equal(calls, 0);
    assert.equal(
      (
        await provider.send(
          {
            to: 'designated@example.invalid',
            subject: 'Test',
            text: 'Synthetic body',
          },
          'test-key'
        )
      ).id,
      'safe-provider-id'
    );
    assert.equal(calls, 1);
    const ambiguous = emailProvider(async () => {
      throw new Error(process.env.RESEND_API_KEY);
    });
    await assert.rejects(
      ambiguous.send(
        { to: 'designated@example.invalid', subject: 'Test', text: 'Test' },
        'another-key'
      ),
      (e) =>
        e instanceof MailError &&
        !e.retryable &&
        e.message === 'EMAIL_DELIVERY_OUTCOME_UNKNOWN'
    );
  } finally {
    process.env.PLANORA_EMAIL_MODE = 'disabled';
    delete process.env.RESEND_API_KEY;
    await db.close();
  }
});
