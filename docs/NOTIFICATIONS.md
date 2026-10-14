# Optional student academic-change email

Disabled by default; no real development messages have been authorized or sent. Telegram is deferred. Existing admin report/security alerts are a separate legacy integration described in `REPORT_EMAIL.md`.

## Consent and privacy

The student explicitly enters an email address, selects up to 30 courses and checks consent. Interests are **not inferred from the saved planner**. Pending subscriptions receive only a verification request; academic updates require double opt-in. Confirmation links expire in 48 hours. Verification/unsubscribe actions require an explicit button click (not a state-changing GET). Signed, version-bound capability tokens are placed in URL fragments, removed from the address bar once the UI loads, never stored/logged server-side as raw tokens, and never embedded in a schedule link.

An unauthenticated signup cannot change an active subscriber's interests. To change courses, use the email unsubscribe link, then request/verify a new subscription. Unsubscribe is idempotent, cancels pending messages, and remains usable when sending is disabled or the signup Redis limiter is unavailable, provided the token-signing key and SQL are still available. Already in-flight provider messages cannot be recalled. Never share an unsubscribe/verification link publicly: it is a bearer capability.

Only email, term, consent/verification timestamps, status and selected academic course IDs are stored privately. The sync worker cannot read subscribers. No student ID, university personal schedule or browser picks are sent to the source agent. The existing optional AI assistant still receives the context a user deliberately sends to it; this upgrade does not misrepresent that separate feature as purely local.

## Provider abstraction and modes

`app/server/email-provider.ts` implements a small `send` interface:

| Mode | Behavior |
| --- | --- |
| `disabled` (default) | No signups or sends; existing signed opt-out links still work. |
| `mock` | No network. Marks deliveries `mocked`, never `sent`. |
| `resend-test` | Only the privately configured designated test recipient; an API key and sender are required. |
| `resend` | Requires explicit `PLANORA_EMAIL_LIVE_APPROVED=true`, provider/sender/domain setup and authorization. |

No development test uses a real provider. Resend's current official SDK request shape and idempotency option were reviewed from [its upstream source](https://github.com/resend/resend-node). This is a conditional provider choice, **not a promise of free delivery**: pricing, free-account limits, test-recipient restrictions, sender/domain requirements and idempotency-retention windows must be rechecked for the actual account before use. There is no free SMTP/domain bypass, singing/messaging service, or Gmail password integration.

Server variables: `PLANORA_EMAIL_MODE`, `PLANORA_EMAIL_TOKEN_SECRET` (32+ random characters), `PLANORA_EMAIL_FROM`, `PLANORA_PUBLIC_URL` (HTTPS origin, no credentials/path/query), optional `PLANORA_EMAIL_TEST_RECIPIENT`, `RESEND_API_KEY`, and, for real mail, `PLANORA_EMAIL_LIVE_APPROVED=true`. Keep values private. Web API and delivery runner must share the same signing key and public origin. Key rotation invalidates old capability links; plan a user-support/re-verification procedure rather than silently abandoning opt-out support.

## Outbox and delivery guarantees

A committed academic change inserts one unique subscriber/event outbox entry in the **same SQL transaction** as the catalog revision. Drafts, failed/incomplete syncs, rolled-back publications and true unchanged runs cannot enqueue change mail. Verification has a separate version-bound event key. Retry of publication cannot duplicate entries.

Workers use `FOR UPDATE SKIP LOCKED` and two-minute leases, provider idempotency keys, at most five attempts and a one-hour retry window. Rate-limit/transient server errors get bounded exponential backoff. Permanent failures and ambiguous network outcomes fail without blind retry; an expired crash lease may be retried with the same key inside the bounded window. Exactly-once external delivery is **not guaranteed** if a provider's idempotency contract differs or a network outcome is unknown. An unknown outcome needs operator/provider reconciliation, not a new message/key.

States are `pending`, `sending`, `sent`, `mocked`, `failed`, `cancelled`; admin shows real counts. Failed email never rolls back an already published catalog. Messages contain plain-text public academic before/after facts and a disclaimer that the student's university registration has not changed.

## Running

- Tests inject a fake provider. `npm --prefix app test` covers opt-in, signature/expiry, private interests, committed-only events, unsubscribe, rate limits, bounded retry/idempotency keys, designated-recipient enforcement and error redaction.
- Authenticated admin can explicitly process up to three messages per request, with confirmation and the deployment's configured mode. This never overrides a disabled mode.
- Optional `npm --prefix app run notifications:deliver` handles a bounded 20-message batch and exits unsuccessfully on a genuine send failure. Do not run with real credentials in development without approval.
- `.github/workflows/notification-delivery.yml` has manual dispatch and a 15-minute schedule, but **its job is skipped unless** the Plan repository variable `PLANORA_EMAIL_DELIVERY_ENABLED` is exactly `true`. A GitHub schedule is best-effort, not an SLA. Large backlogs require quota-aware operational tuning; there is no unverified capacity/free-tier guarantee.
- Before enabling it, configure a protected `notifications` GitHub environment, a secret `PLANORA_EMAIL_DATABASE_URL` login granted only `planora_mailer`, optional `DATABASE_SSL_CA`, secret `PLANORA_EMAIL_TOKEN_SECRET`, `RESEND_API_KEY`, `PLANORA_EMAIL_TEST_RECIPIENT`, and the non-secret mode/from/origin/live-approved variables named above. Do not give this worker university credentials or a migration/owner DB login.

A retention policy for inactive subscriptions/delivery history must be approved by the operator for the deployment's jurisdiction and support obligations. No automatic destructive retention job is included. Public APIs never list subscribers, private tokens, admin notes or provider diagnostics.
