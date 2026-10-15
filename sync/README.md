# Read-only academic catalog worker — disabled pending source approval

**This is a tested reference catalog-JSON reader, not a verified live university connector.** No dedicated Self-Service catalog endpoint, supported authentication contract or authorized live sample was supplied. `source-contract.json` therefore has `approved: false` and an empty path. Do not fill these by guessing or simply switch the flag on.

The old browser scraper is retired: `self-service-sync.mjs` exits unsuccessfully without a network call, and `/api/sync-ingest` returns 410. Its guessed login/registration interactions, arbitrary 1–3-course limit and fixture-merging behavior are not safe completeness guarantees.

## Hard boundaries

- Only `https://sisselfservice.zewailcity.edu.eg`, one version-controlled, independently approved **dedicated catalog** path, GET requests, and fixed term/page query parameters.
- No browser automation, DOM traversal, form submission, login-button guessing, cookies/session dumps, screenshots, traces, personal schedule panels, grades or financial/student records.
- Never select/click/submit add, drop, enroll, register, withdraw, save or similar controls. Suspicious route names, alternate origins, arbitrary URLs and redirects are denied.
- Bearer or HTTP Basic authentication is supported only if explicitly documented and approved for that read-only endpoint. This does **not** implement or bypass the university's interactive sign-in flow. MFA/CAPTCHA/challenge/HTML/login redirects stop the run without attempting bypass.
- No credentials or raw bodies in logs/artifacts. Errors are allowlisted codes. Unknown/personal JSON fields are rejected before staging.
- All declared pages must complete with stable term/snapshot/totals; duplicate IDs, empty/partial pages, changed manifests or impossible counts fail the run. Safety limits fail; they never truncate into a successful result. At most three attempts for transient failures with bounded backoff; 20-second request timeout, 2 MB/page, 20 MB aggregate, 10,000 pages. A >30% reduction from the published course/section counts is rejected even with a source manifest.

## Required evidence before implementing/enabling a live adapter

Obtain authorization to read the catalog, a documented safe endpoint or academic-only export, exact term/catalog scope, a redacted academic sample (no credentials or personal panel), stable course/section identity mapping, totals/pagination semantics, and a review reference. A normal registration-page URL is not evidence of a safe catalog API. If no such interface exists, stop and obtain a separately reviewed safe design; do not revive the retired scraper.

`fixtures/catalog-page.json` demonstrates **synthetic** `planora.catalog-page.v1`. Each page contains `format`, `term`, `snapshot`, `page`, `pageCount`, `totalCourses`, `totalSections`, `complete`, `courses`, and `sch`. The records use the existing planner's validated academic shape. This format is **not claimed to be provided by the university**. Both established catalogs must be covered. No capacity, description, stable university IDs or multi-meeting-section facts are invented when missing from the original data; unsupported source fields require a reviewed schema/adapter extension instead of silent loss.

Preserve known optional values when the source omits them; absence is not deletion evidence. An explicit stable source ID can map to its previously reviewed legacy ID; otherwise the existing scoped legacy ID must match. A new ID with only a matching course code is rejected. New academic requirements/year mappings are not guessed. Removals are shown for explicit human approval and never auto-published.

## Admin/job flow

1. Authenticated admin presses **Sync Self-Service**, acknowledges the read-only action, and POSTs to `/api/admin`.
2. Server validates the session/origin/body/rate limit and configured capability, creates a queued SQL run under a per-term uniqueness constraint, and dispatches only `Ahmedamir21/Plan`'s `self-service-sync.yml` with that UUID. No caller-supplied endpoint/repository/code list is accepted.
3. Actions claims a DB lease matching the exact source-contract hash. Directly inventing a workflow input does not create a claimable job. Source-worker SQL privileges cannot publish or read subscriptions.
4. Real page progress/validation is persisted. Queued/running/validating leases expire after 30 minutes without renewal; the UI reports expiry rather than inventing success. Cancel invalidates a pending/running lease. Failed or uncertain dispatch invalidates it too.
5. A complete valid difference becomes `awaiting_review`; a true unchanged catalog completes without new public events. Pending review also blocks another conflicting run.
6. Admin inspects the deterministic before/after diff, supplies a reason, explicitly permits removals if appropriate, then publishes. Expected base revision/proposal hash are checked again. Publication, full snapshot, academic history, attribution and outbox are one transaction.

Statuses: `queued`, `running`, `validating`, `awaiting_review`, `applying`, `completed`, `completed_with_warnings`, `failed`, `cancelled`. `applying` occurs within the atomic transaction and may not be externally observable before completion. The admin panel shows last attempt, last successful Self-Service check, counts, diagnostics, paged history, snapshots and mail delivery states. Insert/update/unchanged/remove counts include both course and section records; validation/skipped counts are explicit. There is no fabricated percentage progress.

## Workflow/environment configuration (not performed here)

The workflow is manual-only, target-repository guarded, read-permission scoped, SHA-pinned for checkout/setup-node, serialized, and limited to 20 minutes. There is **no periodic university job**. Configure a protected `self-service-sync` GitHub environment with required reviewers before enabling:

- Secret `PLANORA_WORKER_DATABASE_URL`: separate login granted only `planora_worker`.
- Optional secret `DATABASE_SSL_CA`.
- Secret `SELF_SERVICE_CATALOG_TOKEN`, **or**, for an approved Basic-auth contract only, `SELF_SERVICE_USERNAME` and `SELF_SERVICE_PASSWORD`.
- Variables `PLANORA_SELF_SERVICE_ENABLED=true` and `PLANORA_TERM_KEY` only after contract approval.
- The app separately needs a repository-restricted dispatch credential and approved `PLANORA_SYNC_REF`; see [SQL setup](../docs/SQL_SETUP.md). This session's work is on `arena/cd36c549-plan`; do not create/change branches merely to use the worker.

No screenshot/trace/raw-data artifact is uploaded. If the environment approval queue exceeds the lease, cancel/retry from the admin after resolving it. A runner killed before writing failure eventually times out in SQL. Read-only GET cannot technically guarantee that an undocumented remote server is side-effect-free; the independent endpoint review is essential.

## Tests

`npm ci && npm run check && npm test` in `sync/`: synthetic fetch/HTML fixtures only; no live HTTP request, account interaction or registered student plan. Covers all pages, coverage, denied actions/URLs, private/unknown fields, redirects, expired auth, MFA/challenge responses, incomplete/duplicate/empty data, bounded retries and sanitized errors. SQL worker-role, lease, stale-base, rollback, no-op and publication tests live in `app/tests/`.

## Controlled end-to-end acceptance

After building the planner, `npm --prefix app run test:e2e` runs the **same** `app/server/catalog-job.ts` pipeline as the worker CLI against two loopback HTTP fixture pages, actual SQL/HTTP handlers and real Chromium. It discovers a new Lab 02 and changed Lecture 01 times, displays/approves the diff through the admin UI, verifies atomic publication, preserved local selections/new conflicts, audit/outbox idempotency and rollback. The original 70-course catalog is also tested through SQL and browser controls. Use an isolated `TEST_DATABASE_URL` to run it against native PostgreSQL. This never authorizes or calls the university; source/Redis/mail are fixtures/mocks. [Acceptance evidence](../docs/PR2_ACCEPTANCE.md).
