import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Database } from './db';
import { SafeError } from './errors';
import {
  emailConfigured,
  emailMode,
  emailProvider,
  MailError,
  type EmailProvider,
  type Mail,
} from './email-provider';
const emailSchema = z.string().trim().toLowerCase().max(254).email();
export const subscriptionInput = z
  .object({
    action: z.literal('subscribe'),
    email: emailSchema,
    courseIds: z
      .array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/))
      .min(1)
      .max(30),
    consent: z.literal(true),
  })
  .strict();
const tokenSchema = z
  .object({
    id: z.string().uuid(),
    version: z.string().uuid(),
    kind: z.enum(['verify', 'unsubscribe']),
    expires: z.number().int().nullable(),
  })
  .strict();
function key() {
  const secret = process.env.PLANORA_EMAIL_TOKEN_SECRET;
  if (!secret || secret.length < 32)
    throw new SafeError('EMAIL_DISABLED_OR_NOT_CONFIGURED', 503);
  return secret;
}
function signature(payload: string) {
  return createHmac('sha256', key()).update(payload).digest('base64url');
}
export function subscriptionToken(row: any, kind: 'verify' | 'unsubscribe') {
  const payload = Buffer.from(
    JSON.stringify({
      id: row.id,
      version: row.token_version,
      kind,
      expires:
        kind === 'verify'
          ? new Date(row.consent_at).getTime() + 48 * 60 * 60 * 1000
          : null,
    })
  ).toString('base64url');
  return `${payload}.${signature(payload)}`;
}
export function readSubscriptionToken(
  value: string,
  expected: 'verify' | 'unsubscribe'
) {
  if (value.length > 1000) throw new SafeError('INVALID_OR_EXPIRED_EMAIL_LINK');
  const [payload, sig, extra] = value.split('.');
  if (!payload || !sig || extra)
    throw new SafeError('INVALID_OR_EXPIRED_EMAIL_LINK');
  const actual = Buffer.from(sig),
    valid = Buffer.from(signature(payload));
  if (actual.length !== valid.length || !timingSafeEqual(actual, valid))
    throw new SafeError('INVALID_OR_EXPIRED_EMAIL_LINK');
  let parsed;
  try {
    parsed = tokenSchema.parse(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    );
  } catch {
    throw new SafeError('INVALID_OR_EXPIRED_EMAIL_LINK');
  }
  if (
    parsed.kind !== expected ||
    (expected === 'verify' && (!parsed.expires || parsed.expires < Date.now()))
  )
    throw new SafeError('INVALID_OR_EXPIRED_EMAIL_LINK');
  return parsed;
}
export async function subscribe(
  db: Database,
  term: string,
  input: z.infer<typeof subscriptionInput>
) {
  if (!emailConfigured())
    throw new SafeError('EMAIL_DISABLED_OR_NOT_CONFIGURED', 503);
  if (
    emailMode() === 'resend-test' &&
    input.email !== process.env.PLANORA_EMAIL_TEST_RECIPIENT?.toLowerCase()
  )
    throw new SafeError('EMAIL_TEST_RECIPIENT_ONLY', 403);
  const ids = [...new Set(input.courseIds)];
  return db.transaction(async (sql) => {
    // Serialize absent-row creation by a transaction lock; no address is logged or embedded in lock keys.
    await sql.query('SELECT pg_advisory_xact_lock(701427)');
    const courses = (
      await sql.query(
        'SELECT id,legacy_id FROM planora.courses WHERE term_key=$1 AND active AND legacy_id=ANY($2::text[])',
        [term, ids]
      )
    ).rows;
    if (courses.length !== ids.length)
      throw new SafeError('INVALID_SUBSCRIPTION_COURSES');
    const existing = (
      await sql.query(
        'SELECT * FROM planora.email_subscriptions WHERE term_key=$1 AND email=$2 FOR UPDATE',
        [term, input.email]
      )
    ).rows[0];
    // Unauthenticated sign-up must never change an existing subscriber's interests.
    if (existing?.status === 'active') return;
    const id = existing?.id || randomUUID(),
      version = randomUUID();
    await sql.query(
      `INSERT INTO planora.email_subscriptions(id,term_key,email,status,token_version,consent_at)
      VALUES($1,$2,$3,'pending',$4,now()) ON CONFLICT(term_key,email) DO UPDATE SET status='pending',token_version=EXCLUDED.token_version,consent_at=now(),verified_at=null`,
      [id, term, input.email, version]
    );
    await sql.query(
      'DELETE FROM planora.subscription_courses WHERE subscription_id=$1',
      [id]
    );
    for (const course of courses)
      await sql.query(
        'INSERT INTO planora.subscription_courses(subscription_id,course_id) VALUES($1,$2)',
        [id, course.id]
      );
    await sql.query(
      "UPDATE planora.notification_deliveries SET status='cancelled' WHERE subscription_id=$1 AND status IN ('pending','sending')",
      [id]
    );
    await sql.query(
      "INSERT INTO planora.notification_deliveries(id,subscription_id,kind,event_key) VALUES($1,$2,'verification',$3) ON CONFLICT DO NOTHING",
      [randomUUID(), id, `verify:${id}:${version}`]
    );
  });
}
export async function applySubscriptionToken(
  db: Database,
  value: string,
  action: 'verify' | 'unsubscribe'
) {
  const token = readSubscriptionToken(value, action);
  return db.transaction(async (sql) => {
    const row = (
      await sql.query(
        'SELECT * FROM planora.email_subscriptions WHERE id=$1 FOR UPDATE',
        [token.id]
      )
    ).rows[0];
    if (!row || row.token_version !== token.version)
      throw new SafeError('INVALID_OR_EXPIRED_EMAIL_LINK');
    if (action === 'verify') {
      if (row.status === 'unsubscribed')
        throw new SafeError('EMAIL_SUBSCRIPTION_CANCELLED');
      await sql.query(
        "UPDATE planora.email_subscriptions SET status='active',verified_at=coalesce(verified_at,now()) WHERE id=$1",
        [row.id]
      );
      return { status: 'active' };
    }
    await sql.query(
      "UPDATE planora.email_subscriptions SET status='unsubscribed' WHERE id=$1",
      [row.id]
    );
    await sql.query(
      "UPDATE planora.notification_deliveries SET status='cancelled' WHERE subscription_id=$1 AND status IN ('pending','sending')",
      [row.id]
    );
    return { status: 'unsubscribed' };
  });
}
function publicUrl() {
  const value = process.env.PLANORA_PUBLIC_URL || 'https://example.invalid';
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new SafeError('INVALID_EMAIL_PUBLIC_URL', 503);
  if (emailMode() !== 'mock' && url.hostname === 'example.invalid')
    throw new SafeError('INVALID_EMAIL_PUBLIC_URL', 503);
  return url.origin;
}
export function emailFor(row: any, subscription: any, event?: any): Mail {
  const url = publicUrl();
  const unsubscribe = `${url}/#emailAction=unsubscribe&token=${subscriptionToken(subscription, 'unsubscribe')}`;
  if (
    row.kind === 'verification' &&
    new Date(subscription.consent_at).getTime() + 48 * 60 * 60 * 1000 <
      Date.now()
  )
    throw new SafeError('EMAIL_VERIFICATION_EXPIRED');
  if (row.kind === 'verification')
    return {
      to: subscription.email,
      subject: 'Confirm your Planora course-update subscription',
      text: `You requested course-update emails from the unofficial Planora planner. Confirm within 48 hours:\n${url}/#emailAction=verify&token=${subscriptionToken(subscription, 'verify')}\n\nIf you did not request this, ignore this email or cancel:\n${unsubscribe}\n\nNo university account or private schedule is accessed.`,
    };
  if (!event) throw new SafeError('EMAIL_EVENT_MISSING', 500);
  return {
    to: subscription.email,
    subject:
      `Planora: ${event.course_code} — ${String(event.category).replace(/_/g, ' ')}`.slice(
        0,
        250
      ),
    text: `${event.course_code}: ${event.course_title}\nConfirmed planning-catalog change: ${String(event.category).replace(/_/g, ' ')}\nSection: ${event.section_key || 'course information'}\nFields: ${event.fields.join(', ')}\nPrevious: ${JSON.stringify(event.before_value)}\nPublished: ${JSON.stringify(event.after_value)}\n\nReview your local plan: ${url}/\nThis does not mean your actual university registration has changed. Verify official details in Self-Service.\n\nUnsubscribe: ${unsubscribe}`,
  };
}
export async function deliverNotifications(
  db: Database,
  limit = 20,
  provider?: EmailProvider
) {
  if (!emailConfigured())
    throw new SafeError('EMAIL_DISABLED_OR_NOT_CONFIGURED', 503);
  const sender = provider || emailProvider(),
    summary = { sent: 0, mocked: 0, failed: 0, retry: 0, cancelled: 0 };
  const max = Math.max(1, Math.min(50, limit));
  // No retry beyond a one-hour window or five attempts, even if a worker crashes.
  const exhausted =
    await db.query(`UPDATE planora.notification_deliveries SET status='failed',error_code='DELIVERY_RETRY_WINDOW_EXHAUSTED',lease_until=null
    WHERE status IN ('pending','sending') AND (attempts>=5 OR first_attempt_at<now()-interval '1 hour') AND (lease_until IS NULL OR lease_until<now()) RETURNING id`);
  summary.failed += exhausted.rows.length;
  for (let i = 0; i < max; i++) {
    const row = await db.transaction(async (sql) => {
      const item = (
        await sql.query(`SELECT * FROM planora.notification_deliveries WHERE
        ((status='pending' AND next_attempt_at<=now()) OR (status='sending' AND lease_until<now())) AND attempts<5
        ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`)
      ).rows[0];
      if (!item) return null;
      return (
        await sql.query(
          `UPDATE planora.notification_deliveries SET status='sending',attempts=attempts+1,
        lease_until=now()+interval '2 minutes',first_attempt_at=coalesce(first_attempt_at,now()) WHERE id=$1 RETURNING *`,
          [item.id]
        )
      ).rows[0];
    });
    if (!row) break;
    const subscription = (
      await db.query('SELECT * FROM planora.email_subscriptions WHERE id=$1', [
        row.subscription_id,
      ])
    ).rows[0];
    const expected = row.kind === 'verification' ? 'pending' : 'active';
    if (
      !subscription ||
      subscription.status !== expected ||
      (row.kind === 'verification' &&
        row.event_key !==
          `verify:${subscription.id}:${subscription.token_version}`)
    ) {
      await db.query(
        "UPDATE planora.notification_deliveries SET status='cancelled',lease_until=null WHERE id=$1 AND status='sending'",
        [row.id]
      );
      summary.cancelled++;
      continue;
    }
    try {
      const event = row.event_id
        ? (
            await db.query(
              'SELECT * FROM planora.catalog_changes WHERE id=$1',
              [row.event_id]
            )
          ).rows[0]
        : undefined;
      const result = await sender.send(
        emailFor(row, subscription, event),
        row.id
      );
      // If unsubscribe won while a provider request was in flight, don't resurrect a cancelled row.
      await db.query(
        `UPDATE planora.notification_deliveries SET status=$2,sent_at=now(),provider_id=$3,lease_until=null,error_code=null WHERE id=$1 AND status='sending'`,
        [row.id, result.mocked ? 'mocked' : 'sent', result.id]
      );
      if (result.mocked) summary.mocked++;
      else summary.sent++;
    } catch (error) {
      const retry =
        error instanceof MailError && error.retryable && row.attempts < 5;
      const code =
        error instanceof MailError
          ? error.code
          : error instanceof SafeError
            ? error.code
            : 'EMAIL_DELIVERY_OUTCOME_UNKNOWN';
      await db.query(
        `UPDATE planora.notification_deliveries SET status=$2,error_code=$3,lease_until=null,next_attempt_at=now()+($4::int*interval '1 second') WHERE id=$1 AND status='sending'`,
        [
          row.id,
          retry ? 'pending' : 'failed',
          code,
          Math.min(1800, 30 * 4 ** (row.attempts - 1)),
        ]
      );
      if (retry) summary.retry++;
      else summary.failed++;
    }
  }
  return summary;
}
