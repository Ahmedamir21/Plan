# PR #2 file-by-file review

Scope: `Ahmedamir21/Plan` only. Baseline: `fb0b16f794786cdc7fb10773bc25b19e79f5823b`; previously committed PR checkpoint: `5a2eca97f773a31820bc5c6e794d112110cdab29`.

This inventory covers every changed/deleted/renamed/new PR file as compared with main, including the continuation. Lockfiles were inspected structurally and through reproducible installation/audit rather than claiming a line-by-line security audit of third-party source. Tests do not establish real provider/university access.

`P` expands exactly to the existing, unmoved planner directory:

```text
Final_Fall_2026_ZewailCity/Templates-Final-Final-main/Zewail-City-Templates-arena-01a09711-zewail-city-templates/Final_Fall_2026_ZewailCity/Final_Fall_2026_Zewail
```

**121 file records** (rename old paths shown). Original `P/src/semester/*.json`, scheduling engine implementation, brand assets and nested directories are unchanged.

| Status | Exact file (`P` expanded as above) | Review / evidence |
| --- | --- | --- |
| A | `.github/workflows/notification-delivery.yml` | Repository/ref/environment gates and pinned actions reviewed; syntax parsed; normal CI only uses disposable SQL; managed Preview manual-only. |
| M | `.github/workflows/planner-ci.yml` | Repository/ref/environment gates and pinned actions reviewed; syntax parsed; normal CI only uses disposable SQL; managed Preview manual-only. |
| M | `.github/workflows/security-review.yml` | Repository/ref/environment gates and pinned actions reviewed; syntax parsed; normal CI only uses disposable SQL; managed Preview manual-only. |
| M | `.github/workflows/self-service-sync.yml` | Repository/ref/environment gates and pinned actions reviewed; syntax parsed; normal CI only uses disposable SQL; managed Preview manual-only. |
| M | `.gitignore` | Private env, exports, local SQL, dependencies/builds and diagnostics excluded; staged-file and credential-pattern checks. |
| M | `P/package-lock.json` | Locked package graph/integrity and registry URLs reviewed; npm ci and audits executed. No database/catalog content is stored here. |
| M | `P/package.json` | Wrapper/config/schema compatibility inspected; locked builds/typechecks/tests; no nested path relocation or embedded secrets. |
| M | `P/public/service-worker.js` | API data excluded; admin/error navigation cannot replace student shell; build stamping/platform regression passed. |
| M | `P/src/App.tsx` | SQL hydration replaces runtime fixture imports; original engine/palette/meeting structure retained; typecheck, 19 suites and built/real browser tests. |
| M | `P/src/admin.tsx` | Existing admin extended without redesign; real login, diff inspection/approval, private draft/undo and publication tested. |
| M | `P/src/components/AboutPage.tsx` | Hydrated verification label and correct Plan repository link; brand/design retained; SSR/browser build checked. |
| M | `P/src/components/AdminSelfServiceSync.tsx` | Existing admin extended without redesign; real login, diff inspection/approval, private draft/undo and publication tested. |
| M | `P/src/components/AppStatus.tsx` | SQL hydration replaces runtime fixture imports; original engine/palette/meeting structure retained; typecheck, 19 suites and built/real browser tests. |
| A | `P/src/components/CatalogUpdates.tsx` | Public committed-only history / explicit consent UI; filters documented accurately; no saved-plan upload or default real mail. |
| A | `P/src/components/EmailNotifications.tsx` | Public committed-only history / explicit consent UI; filters documented accurately; no saved-plan upload or default real mail. |
| A | `P/src/components/ScheduleImpact.tsx` | Local UID/raw backup/term locks/v6 sharing/impact rules reviewed; exact saved keys and new conflicts verified in real browser + SQL. |
| M | `P/src/config/semester.ts` | SQL hydration replaces runtime fixture imports; original engine/palette/meeting structure retained; typecheck, 19 suites and built/real browser tests. |
| M | `P/src/data/courses.ts` | SQL hydration replaces runtime fixture imports; original engine/palette/meeting structure retained; typecheck, 19 suites and built/real browser tests. |
| M | `P/src/data/majors.ts` | SQL hydration replaces runtime fixture imports; original engine/palette/meeting structure retained; typecheck, 19 suites and built/real browser tests. |
| M | `P/src/data/meta.ts` | SQL hydration replaces runtime fixture imports; original engine/palette/meeting structure retained; typecheck, 19 suites and built/real browser tests. |
| M | `P/src/data/schElectives.ts` | SQL hydration replaces runtime fixture imports; original engine/palette/meeting structure retained; typecheck, 19 suites and built/real browser tests. |
| M | `P/src/lib/appState.ts` | Local UID/raw backup/term locks/v6 sharing/impact rules reviewed; exact saved keys and new conflicts verified in real browser + SQL. |
| M | `P/src/lib/assistantControls.ts` | Local UID/raw backup/term locks/v6 sharing/impact rules reviewed; exact saved keys and new conflicts verified in real browser + SQL. |
| A | `P/src/lib/catalogClient.ts` | SQL hydration replaces runtime fixture imports; original engine/palette/meeting structure retained; typecheck, 19 suites and built/real browser tests. |
| A | `P/src/lib/scheduleImpact.ts` | Local UID/raw backup/term locks/v6 sharing/impact rules reviewed; exact saved keys and new conflicts verified in real browser + SQL. |
| M | `P/src/lib/share.ts` | Local UID/raw backup/term locks/v6 sharing/impact rules reviewed; exact saved keys and new conflicts verified in real browser + SQL. |
| M | `P/src/main.tsx` | SQL hydration replaces runtime fixture imports; original engine/palette/meeting structure retained; typecheck, 19 suites and built/real browser tests. |
| M | `P/src/types.ts` | SQL hydration replaces runtime fixture imports; original engine/palette/meeting structure retained; typecheck, 19 suites and built/real browser tests. |
| M | `P/tests/admin-auth.ts` | Original/new planner regression harness or test-only fixture injection; all 19 scripts executed, originals retained. |
| A | `P/tests/catalog-fixture.ts` | Original/new planner regression harness or test-only fixture injection; all 19 scripts executed, originals retained. |
| M | `P/tests/harness.ts` | Original/new planner regression harness or test-only fixture injection; all 19 scripts executed, originals retained. |
| A | `P/tests/production-ui.mjs` | Original/new planner regression harness or test-only fixture injection; all 19 scripts executed, originals retained. |
| A | `P/tests/sql-catalog.ts` | Original/new planner regression harness or test-only fixture injection; all 19 scripts executed, originals retained. |
| A | `P/tests/ui-notifications.tsx` | Original/new planner regression harness or test-only fixture injection; all 19 scripts executed, originals retained. |
| A | `P/tests/ui-sync.tsx` | Original/new planner regression harness or test-only fixture injection; all 19 scripts executed, originals retained. |
| M | `P/vite.config.ts` | Nested root preserved; relative API proxy, 0.0.0.0 binding and controlled preview hosts; both production builds passed. |
| M | `README.md` | Reconciled with actual source/results; managed services/source limitations explicit; no historical reference URL presented as a verified Plan deployment. |
| M | `app/.env.example` | Wrapper/config/schema compatibility inspected; locked builds/typechecks/tests; no nested path relocation or embedded secrets. |
| D | `app/api/admin-store.ts` | Removed obsolete academic Redis writer/utility route; no production data deleted. |
| M | `app/api/admin.ts` | Authorization/origin/body/privacy boundary reviewed; original feature regressions and SQL API/browser tests pass; no remote service success inferred. |
| M | `app/api/assistant.ts` | Authorization/origin/body/privacy boundary reviewed; original feature regressions and SQL API/browser tests pass; no remote service success inferred. |
| M | `app/api/catalog.ts` | Authorization/origin/body/privacy boundary reviewed; original feature regressions and SQL API/browser tests pass; no remote service success inferred. |
| A | `app/api/changes.ts` | Authorization/origin/body/privacy boundary reviewed; original feature regressions and SQL API/browser tests pass; no remote service success inferred. |
| A | `app/api/deployment.ts` | Safe public Git/SQL attestation endpoint; no credentials returned; controlled API test passes, real Vercel evidence pending. |
| M | `app/api/feedback.ts` | Authorization/origin/body/privacy boundary reviewed; original feature regressions and SQL API/browser tests pass; no remote service success inferred. |
| A | `app/api/notifications.ts` | Authorization/origin/body/privacy boundary reviewed; original feature regressions and SQL API/browser tests pass; no remote service success inferred. |
| M | `app/api/reports.ts` | Authorization/origin/body/privacy boundary reviewed; original feature regressions and SQL API/browser tests pass; no remote service success inferred. |
| M | `app/api/sync-ingest.ts` | Legacy ingestion retired with HTTP 410; cannot publish scraped partial data. |
| D | `app/api/sync-store.ts` | Removed obsolete academic Redis writer/utility route; no production data deleted. |
| M | `app/dataset-validation.cjs` | Wrapper/config/schema compatibility inspected; locked builds/typechecks/tests; no nested path relocation or embedded secrets. |
| A | `app/db/migrations/001_academic_catalog.sql` | Reviewed normalized constraints/role grants or empty-Preview binding bootstrap. Real local SQL tests; no production migration executed. |
| A | `app/db/permissions.sql` | Reviewed normalized constraints/role grants or empty-Preview binding bootstrap. Real local SQL tests; no production migration executed. |
| A | `app/db/preview-guard.sql` | Reviewed normalized constraints/role grants or empty-Preview binding bootstrap. Real local SQL tests; no production migration executed. |
| A | `app/e2e/browser.ts` | Controlled real Chromium + HTTP + native PostgreSQL acceptance; source/Redis/mail are fixtures; deployed verifier reused locally, cloud run pending access. |
| A | `app/e2e/catalog-flow.ts` | Controlled real Chromium + HTTP + native PostgreSQL acceptance; source/Redis/mail are fixtures; deployed verifier reused locally, cloud run pending access. |
| A | `app/e2e/fixture.ts` | Controlled real Chromium + HTTP + native PostgreSQL acceptance; source/Redis/mail are fixtures; deployed verifier reused locally, cloud run pending access. |
| A | `app/e2e/preview-smoke.ts` | Controlled real Chromium + HTTP + native PostgreSQL acceptance; source/Redis/mail are fixtures; deployed verifier reused locally, cloud run pending access. |
| A | `app/ops/preview-contract.ts` | Manual-only provider/DB/Redis Preview guard; wrong-repo/target/commit/nonempty-store/privilege/idempotency tests; real provider calls still unexecuted. |
| A | `app/ops/preview-database.ts` | Manual-only provider/DB/Redis Preview guard; wrong-repo/target/commit/nonempty-store/privilege/idempotency tests; real provider calls still unexecuted. |
| A | `app/ops/preview-redis.ts` | Manual-only provider/DB/Redis Preview guard; wrong-repo/target/commit/nonempty-store/privilege/idempotency tests; real provider calls still unexecuted. |
| A | `app/ops/vercel-preview.ts` | Manual-only provider/DB/Redis Preview guard; wrong-repo/target/commit/nonempty-store/privilege/idempotency tests; real provider calls still unexecuted. |
| A | `app/package-lock.json` | Locked package graph/integrity and registry URLs reviewed; npm ci and audits executed. No database/catalog content is stored here. |
| M | `app/package.json` | Wrapper/config/schema compatibility inspected; locked builds/typechecks/tests; no nested path relocation or embedded secrets. |
| A | `app/scripts/check-production-config.mjs` | Explicit CLI/build/local/worker boundaries checked; no build-time migration or automatic university/mail request. Resolved private-import path constrained. |
| A | `app/scripts/database.ts` | Explicit CLI/build/local/worker boundaries checked; no build-time migration or automatic university/mail request. Resolved private-import path constrained. |
| A | `app/scripts/deliver-notifications.ts` | Explicit CLI/build/local/worker boundaries checked; no build-time migration or automatic university/mail request. Resolved private-import path constrained. |
| A | `app/scripts/dev-server.ts` | Explicit CLI/build/local/worker boundaries checked; no build-time migration or automatic university/mail request. Resolved private-import path constrained. |
| A | `app/scripts/export-redis.ts` | Explicit CLI/build/local/worker boundaries checked; no build-time migration or automatic university/mail request. Resolved private-import path constrained. |
| A | `app/scripts/preview-setup.ts` | Explicit protected/manual Plan-only Preview orchestrator; production/source/mail forced off; blocked until private owner authorization. |
| A | `app/scripts/sync-worker.ts` | Explicit CLI/build/local/worker boundaries checked; no build-time migration or automatic university/mail request. Resolved private-import path constrained. |
| A | `app/server/admin-catalog.ts` | Reviewed server workflow/review/hash/lease/atomic-publication boundary; tested including native-PG failure rollback and real admin approval UI. |
| R100 | `app/api/admin-security.ts → app/server/admin-security.ts` | Existing server utility relocated out of API routes; original behavior/auth/report regressions retained. |
| A | `app/server/admin-store.ts` | Redis retained only for nonacademic/auth operations; academic mutators removed; no runtime JSON/Redis catalog fallback. |
| A | `app/server/catalog-job.ts` | Reviewed server workflow/review/hash/lease/atomic-publication boundary; tested including native-PG failure rollback and real admin approval UI. |
| A | `app/server/catalog-model.ts` | Server-only SQL/validation/import; full-field original-catalog roundtrip, idempotency, privileges and rollback verified. |
| A | `app/server/catalog-repository.ts` | Server-only SQL/validation/import; full-field original-catalog roundtrip, idempotency, privileges and rollback verified. |
| A | `app/server/db.ts` | Server-only SQL/validation/import; full-field original-catalog roundtrip, idempotency, privileges and rollback verified. |
| A | `app/server/diff.ts` | Reviewed server workflow/review/hash/lease/atomic-publication boundary; tested including native-PG failure rollback and real admin approval UI. |
| A | `app/server/dispatch.ts` | Reviewed server workflow/review/hash/lease/atomic-publication boundary; tested including native-PG failure rollback and real admin approval UI. |
| A | `app/server/email-provider.ts` | Consent/capability/outbox/provider boundaries checked; mock and injected-provider tests only, no real messages. |
| A | `app/server/errors.ts` | Reviewed server workflow/review/hash/lease/atomic-publication boundary; tested including native-PG failure rollback and real admin approval UI. |
| A | `app/server/fixtures.ts` | Server-only SQL/validation/import; full-field original-catalog roundtrip, idempotency, privileges and rollback verified. |
| A | `app/server/http-adapter.ts` | Local/test HTTP adapter only, production/Vercel startup denied; exact deployed handlers exercised in browser E2E. |
| A | `app/server/migrations.ts` | Server-only SQL/validation/import; full-field original-catalog roundtrip, idempotency, privileges and rollback verified. |
| A | `app/server/notifications.ts` | Consent/capability/outbox/provider boundaries checked; mock and injected-provider tests only, no real messages. |
| R100 | `app/api/report-email.ts → app/server/report-email.ts` | Existing server utility relocated out of API routes; original behavior/auth/report regressions retained. |
| R100 | `app/api/security.ts → app/server/security.ts` | Existing server utility relocated out of API routes; original behavior/auth/report regressions retained. |
| A | `app/server/source-normalization.ts` | Reviewed server workflow/review/hash/lease/atomic-publication boundary; tested including native-PG failure rollback and real admin approval UI. |
| A | `app/server/sync-service.ts` | Reviewed server workflow/review/hash/lease/atomic-publication boundary; tested including native-PG failure rollback and real admin approval UI. |
| A | `app/tests/api.test.ts` | Backend/security/SQL/role/provider-guard regression coverage; 17 tests run on both native PostgreSQL and PGlite. |
| A | `app/tests/database.test.ts` | Backend/security/SQL/role/provider-guard regression coverage; 17 tests run on both native PostgreSQL and PGlite. |
| A | `app/tests/deployment.test.ts` | Backend/security/SQL/role/provider-guard regression coverage; 17 tests run on both native PostgreSQL and PGlite. |
| A | `app/tests/helpers.ts` | Backend/security/SQL/role/provider-guard regression coverage; 17 tests run on both native PostgreSQL and PGlite. |
| A | `app/tests/notifications.test.ts` | Backend/security/SQL/role/provider-guard regression coverage; 17 tests run on both native PostgreSQL and PGlite. |
| A | `app/tests/preview.test.ts` | Backend/security/SQL/role/provider-guard regression coverage; 17 tests run on both native PostgreSQL and PGlite. |
| A | `app/tests/sync.test.ts` | Backend/security/SQL/role/provider-guard regression coverage; 17 tests run on both native PostgreSQL and PGlite. |
| A | `app/tsconfig.json` | Wrapper/config/schema compatibility inspected; locked builds/typechecks/tests; no nested path relocation or embedded secrets. |
| M | `app/vercel.json` | Wrapper/config/schema compatibility inspected; locked builds/typechecks/tests; no nested path relocation or embedded secrets. |
| M | `docs/ADMIN_PANEL.md` | Reconciled with actual source/results; managed services/source limitations explicit; no historical reference URL presented as a verified Plan deployment. |
| M | `docs/FALL_2026_SCHEDULE_IMPORT.md` | Reconciled with actual source/results; managed services/source limitations explicit; no historical reference URL presented as a verified Plan deployment. |
| A | `docs/IMPLEMENTATION_REPORT.md` | Reconciled with actual source/results; managed services/source limitations explicit; no historical reference URL presented as a verified Plan deployment. |
| A | `docs/NOTIFICATIONS.md` | Reconciled with actual source/results; managed services/source limitations explicit; no historical reference URL presented as a verified Plan deployment. |
| A | `docs/PR2_ACCEPTANCE.md` | Reconciled with actual source/results; managed services/source limitations explicit; no historical reference URL presented as a verified Plan deployment. |
| A | `docs/PR2_FILE_REVIEW.md` | Reconciled with actual source/results; managed services/source limitations explicit; no historical reference URL presented as a verified Plan deployment. |
| A | `docs/PREVIEW_SETUP.md` | Reconciled with actual source/results; managed services/source limitations explicit; no historical reference URL presented as a verified Plan deployment. |
| M | `docs/PROJECT_MAP.md` | Reconciled with actual source/results; managed services/source limitations explicit; no historical reference URL presented as a verified Plan deployment. |
| M | `docs/REPORT_EMAIL.md` | Reconciled with actual source/results; managed services/source limitations explicit; no historical reference URL presented as a verified Plan deployment. |
| A | `docs/REPOSITORY_AUDIT.md` | Reconciled with actual source/results; managed services/source limitations explicit; no historical reference URL presented as a verified Plan deployment. |
| M | `docs/SECURITY.md` | Reconciled with actual source/results; managed services/source limitations explicit; no historical reference URL presented as a verified Plan deployment. |
| M | `docs/SEMESTER_ROLLOVER.md` | Reconciled with actual source/results; managed services/source limitations explicit; no historical reference URL presented as a verified Plan deployment. |
| A | `docs/SQL_SETUP.md` | Reconciled with actual source/results; managed services/source limitations explicit; no historical reference URL presented as a verified Plan deployment. |
| A | `docs/evidence/controlled-catalog-flow.json` | Reconciled with actual source/results; managed services/source limitations explicit; no historical reference URL presented as a verified Plan deployment. |
| A | `sync/README.md` | Academic GET-only bounded reader or retired script; redirects/auth/partial/unknown fields fail closed; no university account interaction. |
| A | `sync/catalog-reader.mjs` | Academic GET-only bounded reader or retired script; redirects/auth/partial/unknown fields fail closed; no university account interaction. |
| A | `sync/fixtures/catalog-page.json` | Synthetic academic/personal-panel/challenge fixtures and safety tests; 7 reader tests plus shared-worker E2E. |
| A | `sync/fixtures/registration-page.html` | Synthetic academic/personal-panel/challenge fixtures and safety tests; 7 reader tests plus shared-worker E2E. |
| A | `sync/package-lock.json` | Locked package graph/integrity and registry URLs reviewed; npm ci and audits executed. No database/catalog content is stored here. |
| M | `sync/package.json` | Academic GET-only bounded reader or retired script; redirects/auth/partial/unknown fields fail closed; no university account interaction. |
| M | `sync/self-service-sync.mjs` | Academic GET-only bounded reader or retired script; redirects/auth/partial/unknown fields fail closed; no university account interaction. |
| A | `sync/source-contract.json` | Unapproved, empty real catalog path; no guessed endpoint/selector or live authorization. |
| A | `sync/tests/reader.test.mjs` | Synthetic academic/personal-panel/challenge fixtures and safety tests; 7 reader tests plus shared-worker E2E. |
