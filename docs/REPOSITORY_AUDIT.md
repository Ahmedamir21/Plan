# Repository audit — 2026-10-14 (before implementation)

## Scope and evidence

Verified with local Git, file inspection, repository-wide searches, JSON analysis and executed checks, **before editing source**:

- Repository: `https://github.com/Ahmedamir21/Plan.git` (fetch and push).
- Branch: `arena/cd36c549-plan`.
- HEAD: `fb0b16f794786cdc7fb10773bc25b19e79f5823b` (`Merge pull request #1 from Ahmedamir21/sync-planora-ci-improvements`).
- Repository root: `/home/user/Plan`. Working tree was clean, including after baseline checks.
- No other repository, deployment, database or university account was accessed or modified.
- The reference deployment was **not inspected**: sandbox outbound access is restricted to GitHub and package registries. Its current behavior and correspondence to this checkout are unverified.

Throughout these documents **P** means the existing planner package, exactly:

```text
Final_Fall_2026_ZewailCity/Templates-Final-Final-main/
  Zewail-City-Templates-arena-01a09711-zewail-city-templates/
    Final_Fall_2026_ZewailCity/Final_Fall_2026_Zewail
```

The above line breaks are only for readability. No nested directory will be renamed, moved, flattened or duplicated.

## Verified directory map

```text
Plan/
├── .github/workflows/{planner-ci,security-review,self-service-sync}.yml
├── app/                         Vercel project root, NOT the React package
│   ├── package.json             nested build wrapper, originally no lockfile/dependencies
│   ├── vercel.json              single-file builds copied into app/dist
│   ├── admin-accounts.ts        two server-approved administrator identities
│   ├── dataset-validation.cjs
│   ├── .env.example
│   └── api/
│       ├── admin.ts             server-side scrypt login, cookies, data editor, sync drafts
│       ├── admin-store.ts       private Upstash/KV REST adapter and atomic Lua operations
│       ├── admin-security.ts    private login security log
│       ├── catalog.ts           Redis live overrides, then bundled JSON
│       ├── sync-ingest.ts       shared-secret machine ingest into Redis draft
│       ├── sync-store.ts        Redis stage/publish/backup helpers
│       ├── assistant.ts         Gemini endpoint (browser-provided planner context)
│       ├── reports.ts, report-email.ts, feedback.ts, security.ts
├── [unchanged nested path P]/
│   ├── package.json, package-lock.json, vite.config.ts, tsconfig.json
│   ├── index.html, admin.html
│   ├── src/
│   │   ├── main.tsx, App.tsx, admin.tsx, types.ts, index.css
│   │   ├── semester/{semester,courses,sch,majors}.json
│   │   ├── data/{courses,schElectives,majors,meta}.ts
│   │   ├── config/semester.ts
│   │   ├── lib/                  scheduling, picks, state, sharing, import, audit
│   │   └── components/           existing student and admin design system
│   ├── public/                   PWA, brand assets, service worker
│   ├── semester-template/        empty course/catalog templates, not production data
│   ├── scripts/                  semester validator and service-worker stamping
│   └── tests/                    15 npm test scripts (several contain multiple suites)
├── sync/{package.json,self-service-sync.mjs}
├── scripts/                     password hashing and optional report mailer
├── docs/, assets/, README.md
```

## Verified architecture and baseline

React **19.2.6**, TypeScript **5.9.3**, Vite **7.3.6**, Tailwind **4.1.17**, npm lockfile in P. Node 22 is configured in CI; sandbox Node **22.22.3**, npm **10.9.8**. Two Vite single-file entry builds preserve the existing planner/admin visual design. Vercel deploys `app/`, builds P in place, and copies its output. Browser API URLs are same-origin. The Vite development server did not proxy backend routes.

No SQL client, SQL schema, migrations, SQL connection or managed authentication provider exists in the inspected revision. Redis is used for public catalog overrides, private drafts, history, login rate limits, security events, reports and feedback. Browser schedules are local, not server-owned accounts.

### Checks actually executed on the original revision

- `npm ci` in P: passed; reported four high-severity development dependency audit findings.
- `npm run typecheck`: passed.
- `npm run build`: passed for student and admin entry points plus service-worker stamping.
- `npm audit --omit=dev --audit-level=high`: passed, zero production vulnerabilities.
- `npm audit --audit-level=high`: **failed**, four high findings: `braces` through `micromatch`/`vite-plugin-singlefile`, and `source-map-js`.
- All **15** scripts passed: `test:platform`, `test:data`, `test:assistant`, `test:admin`, `test:completeness`, `test:admin-ui`, `test:import`, `test:patch`, `test:patch-ui`, `test:english`, `test:english-import`, `test:audit`, `test:ssr`, `test:ui`, `test:harness`.
- Data integrity: **2,463 passed, 0 failed**; two known missing-room warnings (`CSAI 102` lecture 03, `CSAI 301` lab 05). Engine audit **16/16**; core harness **136/136**.
- No standalone lint script/configuration exists. The existing TypeScript check enforces unused variables/parameters. Backend `.ts` files are not covered by the original TypeScript project.
- No baseline command connected to a production database, real email provider or university account.

## Actual academic data (not assumptions)

| Source | Courses | Lecture meetings | Lab meetings | Tutorial meetings |
|---|---:|---:|---:|---:|
| P/src/semester/courses.json | 57 | 69 | 166 | 34 |
| P/src/semester/sch.json | 13 | 18 | 0 | 0 |
| Total | **70** | **87** | **166** | **34** |

**92 instructor groups; 287 distinct course/type/section identities and meetings.** No repeated course IDs or codes within or between these two catalogs in this snapshot. That observation is NOT a guarantee for future terms/catalogs. `sch` is a separate shared-elective catalog, not a different term. Template course files are empty arrays.

Actual fields:

- Course: `id`, `code`, `name`, cosmetic `c`, optional `credits`, `group`, `noFixedSchedule`, `awaitingSource`, `instructors`.
- Instructor group: `name`, optional `note`, `unassigned`, plus `lectures`, `labs`, `tutorials` arrays.
- Meeting: `type`, `sec` (string, leading zeroes significant), `day` (`Sun`–`Thu`), integer `start`/`end` in minutes, `room` (may be empty or `Online`).
- No university source IDs, capacities, seat counts or descriptions currently exist. Do not invent them. Future stable source IDs may be stored only if an approved source actually supplies them.
- Four optional English shells intentionally have unknown credits and no sections. Senior project can legitimately have no fixed meetings. Preserve both.
- Semester: `fall-2026-main`, Fall 2026, Main Session; metadata includes institution, planner name, version, calendar dates, data verification date and public host label.
- Four majors, 16 year plans. Cyber upper years are intentionally empty. Academic mappings must not be inferred from course names.

## Every academic-data access path found

### Direct runtime readers/writers at baseline

1. P/src/data/courses.ts imports `courses.json`, combines SCH, constructs `COURSES`/`COURSE_BY_ID`; `hydrateCatalog` mutates them but accepts only the original ID set and counts.
2. P/src/data/schElectives.ts imports `sch.json` and computes shared course IDs.
3. P/src/data/majors.ts imports `majors.json`; P/src/config/semester.ts imports semester metadata; P/src/data/meta.ts derives verification label.
4. P/src/main.tsx fetches `/api/catalog`, hydrates before rendering; on failure explicitly falls back to the bundled timetable.
5. P/src/admin.tsx directly imports all four JSON files as editor seeds, then loads Redis live/drafts. Its course editor, CSV/English imports, schedule patch and completeness/engine-audit components consume these loaded datasets.
6. app/api/catalog.ts reads Redis `planora:admin:live:v1:<file>` and falls back to bundled course JSON. Returns 503 if Redis is not configured.
7. app/api/admin.ts imports all four JSON files; reads/writes drafts, live overrides and sync drafts; validates, exports, undoes and restores snapshots. Existing immediate course publication only permits the original course ID set.
8. app/api/admin-store.ts implements fixed Redis key and Lua live/draft writes and compare-and-set history.
9. app/api/sync-ingest.ts imports the four JSON files, reads current Redis overrides, validates and stages machine data.
10. app/api/sync-store.ts atomically stages/publishes/restores whole catalog JSON values and backup/history records.
11. sync/self-service-sync.mjs reads bundled `courses.json`/`sch.json`, scrapes up to three supplied codes, merges into fixtures, and posts to ingest. It does not know about newer live Redis edits.

### Indirect consumers

- P/src/App.tsx, `CrossYearBrowser`, `MajorPicker`, `YearPicker`, `lib/appState.ts`, `lib/share.ts` import centralized data adapters.
- App passes courses/picks to `CoursePicker`, `CommandPalette`, `ScheduleDetails`, `Timetable`, `BestSchedule`, `CompareSchedules`, `ScheduleAssistant`, `CreditsDashboard`, `SchedulePreferences`, sharing/export/report components. These do not query storage themselves.
- `lib/scheduler.ts`, `bestSchedule.ts`, `picks.ts`, `time.ts`, `freeTime.ts`, `calendar.ts`, `engineAudit.ts` consume supplied course/meeting objects. Preserve their scheduling rules.
- Assistant API consumes the student's explicitly submitted planner context, not JSON imports. The **new sync agent must never receive this context**.

### Offline fixtures / validation consumers to retain

P/scripts/validate-semester.mjs; tests `admin-auth`, `admin-import`, `assistant-features`, `data-completeness`, `data-integrity`, `engine-audit`, `english-import`, `english-readiness`, `harness`, `platform-features`, `schedule-patch`, `ui-admin-course-search`, `ui-schedule-patch`, `ui-share`, `ui-timetable`. README, project map, admin guide and semester/import guides also refer to the JSON workflow. Repository-wide `git grep` covered all tracked files, not just `src/`.

## Scheduling and persistence risks

The scheduler combines one meeting per published component across instructor groups and uses true same-day half-open interval overlap. It has intentional computation budgets with explicit truncation flags. Current data has one meeting per section. A future multi-meeting-per-section export must be rejected until the engine explicitly supports linked meetings; silently treating these as alternatives is unsafe.

`lib/picks.ts` identity is `type|sec|day|start|end|room`. Schedules in **`zw-app-state-v2`** contain those keys; preferences, locks and assistant constraints have separate existing keys. Share links carry semester-aware state. Original state validation drops non-resolving keys; App trims removed courses and autosaves, potentially destroying evidence of an affected saved schedule. The upgrade must back up raw local state and retain unresolved selections without silently retargeting them. Warnings can be calculated entirely in the browser from SQL-backed public data; no private schedule upload is needed.

## Security and deployment assessment

Good existing controls: server-side scrypt hashes, HMAC-signed expiring HttpOnly/Secure/SameSite=Strict admin cookies; two fixed server-approved admins; same-origin/JSON/size checks; shared atomic Redis login limits; revision compare-and-set; React text rendering; no browser secrets. Reuse and test these rather than adding a second login. Existing logout expires a cookie but does not revoke a copied token until expiry; key rotation revokes all sessions. This limitation must remain documented or be improved.

Gaps:

- No SQL transaction/audit model and competing bundled/Redis sources; strict frontend hydration prevents catalog growth/removal.
- Self-Service script uses guessed login fallbacks, Enter submission, broad card heuristics and arbitrary environment URLs; no request write-deny rule, reliable personal-panel exclusion, complete pagination or verified totals. Some errors print stack/ingest bodies. This script is **not production-safe**.
- Draft success can be shown before publication, and partial scraped data can be merged into a plausible full fixture dataset. No durable run lease or app-triggered worker dispatch.
- Existing workflow installs unpinned transitive scraper dependencies without a lockfile; no repository guard or concurrency guard.
- No public field-level academic changelog, local schedule-impact warnings, consent-based academic email subscription or notification outbox.
- Existing report-email alerts are a different feature, not student academic-change notifications.
- API module type checking, SQL integration tests and source-reader safety tests are missing.

Existing private environment patterns (values not inspected/exposed): administrator hash variables, `PLANORA_ADMIN_SESSION_SECRET`, Upstash or Vercel KV REST pairs, `GEMINI_API_KEY`/`GEMINI_MODEL`, report/security mail settings, Self-Service credentials/selectors and ingest settings. No actual credential configuration was verified.

## Recommended architecture and ordered migration

**Decision: server-only PostgreSQL, using node-postgres, not Supabase.** There is no suitable existing SQL technology. Standard PostgreSQL transactions, constraints and indexes fit Vercel's Node backend and GitHub's worker, avoid a second authentication system, and permit any managed PostgreSQL provider. Nothing is exposed through a Supabase/Data API. PUBLIC privileges must be revoked; a restricted runtime role is documented. Preserve Redis for existing nonacademic workflows and login controls, not live academic data.

1. Add versioned SQL schema and a checksummed migration runner. Normalize terms/catalogs, courses, instructor groups, sections and meetings; keep legacy IDs and ordering. Courses use surrogate IDs, term-scoped legacy identity, and catalog/term-scoped codes, never code-only primary keys. Migrate major/year relationships too.
2. Read and validate fixtures in an explicit CLI import, report counts/rejections, preserve all known fields, verify relational round trip. Retry is a no-op only for matching data; never overwrite an existing changed catalog during import. **Before production cutover, explicitly export and include Redis live overrides**, or abort if they differ. Never assume repository fixtures are newest.
3. Centralize all runtime reads/writes in SQL repository interfaces. Import fixtures remain unchanged. Production failure gives a clear unavailable state, not a silent fixture fallback. Optional local cache is labelled stale and must not overwrite saved state.
4. Replace the unsafe scraper with a **fail-closed, allowlisted read-only catalog-export adapter**. No university endpoint has been verified in this environment. Enable only after authorized read-only endpoint/format/coverage review; do not guess a browser login or registration route. Until then, exercise fixtures and mock responses only. If the university has no authorized dedicated catalog API/export, a separately reviewed browser adapter is a remaining prerequisite, not a feature to fake.
5. Add queued/running/validating/review/applying/completed/failed states and DB leases. Dispatch only a fixed workflow in `Ahmedamir21/Plan`, with a server-held Actions credential and a server-configured reviewed ref. Worker never accepts user-provided URLs/commands. Stage full validated proposals, require admin review, atomically write relational records, revision snapshots, public changes and outbox records.
6. Extend the existing sync panel with trigger confirmation, honest states, counts, detailed proposals/history, recovery and notification status. Keep editor/import/reports/feedback working through compatible SQL-backed academic routes.
7. Public changelog exposes only committed academic fields. Preserve local raw state and compute section-aware differences/conflicts locally; never infer real enrollment changes or auto-resolve selections.
8. Notifications follow committed changes only: opt-in/verification, test/disabled-by-default provider interface, unique delivery keys, bounded retries, fixed provider endpoint and private credentials. Telegram is deferred unless justified. Free-tier pricing could not be independently verified; do not promise free delivery.
9. Run original regressions plus SQL, authorization, coverage, diff, rollback, notification and UI tests. Use local isolated PostgreSQL-compatible engine for development checks and real PostgreSQL service in CI. No production migrations, emails, account login, workflow runs, pushes or deployments without separate approval.

## Planned exact existing-file edits

- `app/package.json`, new lockfile/typecheck/config and `app/vercel.json`, `app/.env.example`: reproducible backend, DB configuration, deployment trace paths.
- `app/api/catalog.ts`, `app/api/admin.ts`, `app/api/sync-ingest.ts`: SQL reads/compatible admin actions, retire unverified machine ingest. `app/api/admin-store.ts`/`sync-store.ts`: retire unused academic Redis mutation paths after callers move.
- `app/dataset-validation.cjs`: catalog-aware code uniqueness while retaining global legacy-ID compatibility.
- P `package.json`/lockfile, `vite.config.ts`: tests/dev API proxy and safe patched build dependency.
- P `src/main.tsx`, `src/admin.tsx`, `src/App.tsx`, `src/types.ts`, `src/data/{courses,schElectives,majors,meta}.ts`, `src/config/semester.ts`, `src/lib/appState.ts`, `src/components/{AdminSelfServiceSync,AppStatus}.tsx`: SQL hydration, no static course runtime seeds, local preservation and added controls.
- P affected tests (especially `admin-auth.ts`) and new fixture preload: test data only, not production bundles.
- `sync/package.json`, `sync/self-service-sync.mjs`, `.github/workflows/{planner-ci,self-service-sync}.yml`, `.gitignore`, README and affected `docs/*.md`.

Planned additions: `app/db/migrations/*.sql`, `app/db/permissions.sql`; `app/server/` for DB/repository/validation/diff/jobs/admin-compatibility/notification modules; `app/scripts/` for migration/import/local server/worker tools; `app/tests/`; public changes/notification API entry points; `sync/` source contract, safe adapter and fixtures/tests; P catalog-client/impact libraries and changelog/notification UI; architecture/setup/final-verification documentation. Final file inventory is generated from Git after implementation. No course JSON deletion or source-data rewrite is planned.

## Official references checked during design

Read-only upstream documentation was retrieved through GitHub (allowed network path), not copied from other application repositories:

- PostgreSQL transaction guarantees: `github.com/postgres/postgres/blob/master/doc/src/sgml/advanced.sgml`.
- node-postgres: `github.com/brianc/node-postgres/blob/master/docs/pages/features/transactions.mdx` (same client for every transaction statement).
- Node crypto: `github.com/nodejs/node/blob/main/doc/api/crypto.md` (scrypt/timing-safe primitives).
- GitHub REST workflow dispatch schema: `github.com/github/rest-api-description`.
- Playwright: `github.com/microsoft/playwright/blob/main/docs/src/network.md` (routing alone does not cover service workers). Browser automation is deliberately not enabled without a verified source boundary.
- Resend official SDK documentation: `github.com/resend/resend-node` (server-side send interface). Current free-plan limits remain unverified.

## Unverified prerequisites / decisions requiring later approval

Real PostgreSQL hosting/credentials, existing Redis live contents, university permissions and dedicated read-only API contract, actual login/MFA behavior, production environment/ref, mail-domain/provider approval and consent rollout. These do not prevent a fully tested offline implementation; they **do** prevent claims of live synchronization, production migration, email delivery or deployment success.
