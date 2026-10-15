# Project map — Ahmedamir21/Plan

Only this repository is in scope. Its historical reference links do not establish ownership of any external deployment. Nested planner folders have not been renamed, flattened, moved or duplicated.

Planner root (`P`):

```text
Final_Fall_2026_ZewailCity/Templates-Final-Final-main/Zewail-City-Templates-arena-01a09711-zewail-city-templates/Final_Fall_2026_ZewailCity/Final_Fall_2026_Zewail
```

| Path | Responsibility |
| --- | --- |
| `app/package.json`, `app/vercel.json` | Existing Vercel `app/` root wrapper, Node 22 server dependencies, production cutover gate and separate planner/admin builds. |
| `app/api/` | Public catalog/history/consent and existing protected admin, assistant, reports, feedback HTTP handlers; legacy sync ingest returns 410. |
| `app/server/db.ts`, `catalog-model.ts`, `catalog-repository.ts` | PostgreSQL access, strict academic schema/normalization and centralized relational reads/writes. |
| `app/server/diff.ts`, `sync-service.ts`, `admin-catalog.ts` | Deterministic diff, runs/leases, atomic reviewed publication, snapshots/outbox and existing editor compatibility. |
| `app/server/dispatch.ts`, `source-normalization.ts` | Fixed Plan workflow dispatch and safe academic-only identity/optional-field merging. |
| `app/server/notifications.ts`, `email-provider.ts` | Double opt-in, signed capability links, mock/test/live provider abstraction and bounded outbox delivery. |
| `app/server/admin-store.ts`, `admin-security.ts`, `security.ts`, `report-email.ts` | Existing Redis/auth/report utility code moved out of public route discovery. No academic Redis writer. |
| `app/db/migrations/`, `permissions.sql` | Additive normalized schema and separate runtime/source-worker/mailer privilege groups. |
| `app/scripts/` | Explicit database migration/import/verify/export, local API adapter, job/mail CLIs and no-network production configuration gate. |
| `app/ops/`, `app/scripts/preview-setup.ts` | Manually approved Plan-only managed Preview setup; refuses foreign repositories/databases, keeps production/live features off; not executed without private owner configuration. |
| `app/e2e/` | Real-browser controlled catalog-change acceptance and reusable actual-Preview smoke, with no screenshots/traces or real source/mail. |
| `app/tests/` | Isolated PostgreSQL/PGlite, permissions, API security, publication rollback, leases, consent/outbox and deployment-gate tests. |
| `sync/catalog-reader.mjs`, `source-contract.json` | GET-only reference JSON catalog reader; live source remains unapproved/disabled. |
| `sync/tests/`, `sync/fixtures/` | Synthetic pagination/auth/challenge/personal-panel/unsafe-action/timeout tests. |
| `sync/self-service-sync.mjs` | Retired unsafe scraper; exits without network. |
| `P/src/semester/*.json` | Untouched migration/test fixtures, not a live production data source. |
| `P/semester-template/` | Existing blank format reference; a new term still needs explicit SQL import/review. |
| `P/src/lib/catalogClient.ts`, `P/src/data/`, `P/src/config/semester.ts` | SQL API hydration and optional explicitly stale SQL cache; no runtime academic JSON imports. |
| `P/src/lib/scheduleImpact.ts`, `appState.ts`, `share.ts`, `assistantControls.ts` | Exact saved-key preservation, raw local backup, section-aware warnings/conflicts, v6 sharing and hydrated term-scoped locks. |
| `P/src/App.tsx`, `main.tsx`, `admin.tsx`, `components/` | Existing student/admin UI with loading/error/retry, sync review, public history, optional consent and local notices. |
| `P/src/lib/` (other files) | Existing scheduling engine, calendar, preference/AI validation, image sharing/import utilities. |
| `P/public/`, `scripts/` | Existing PWA/assets, data validator and build-specific service-worker stamping. API data and admin navigation do not overwrite the student shell cache. |
| `P/tests/` | Original 15 suite scripts plus SQL-client/preservation, sync UI and actual built-bundle DOM regression tests. Static fixture injection is test-only. |
| `.github/workflows/planner-ci.yml` | Locked installs, real disposable PostgreSQL CI, source safety tests, both builds, regression suites and audits. |
| `.github/workflows/self-service-sync.yml` | Protected, manual-only, target-repository source worker; never publishes. |
| `.github/workflows/notification-delivery.yml` | Separate optional bounded mail runner, disabled unless its repository variable is explicitly enabled. |
| `docs/REPOSITORY_AUDIT.md` | Pre-edit audit, baseline counts/risks and proposed boundaries. |
| `docs/SQL_SETUP.md`, `ADMIN_PANEL.md`, `SECURITY.md`, `NOTIFICATIONS.md` | Setup/cutover/recovery, operator workflow, security limits and consent/delivery. |
| `docs/IMPLEMENTATION_REPORT.md` | Executed tests and explicit unresolved external/deployment dependencies. |

Generated builds, node_modules, local databases, private exports and diagnostic logs are ignored. Academic source fixtures, existing brand/presentation assets and scheduler architecture remain. No claim is made about other branches or projects; inspect them separately rather than deleting or reconciling user work automatically.
