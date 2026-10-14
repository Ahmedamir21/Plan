# Implementation and verification report

Review date: **2026-10-14**. Repository: **Ahmedamir21/Plan**. Working branch: `arena/cd36c549-plan`; audited baseline commit: `fb0b16f794786cdc7fb10773bc25b19e79f5823b`. No other repository, branch, database or external account was changed. See [REPOSITORY_AUDIT.md](REPOSITORY_AUDIT.md) for the read-only pre-edit findings and baseline.

## Delivered in code

- Kept the exact nested React/Vite/Tailwind planner, original academic fixtures, scheduler/engine, branding, manual course/section flow, saved-state key, separate admin page and Vercel `app/` wrapper. Original semester fixture files have **no diff**.
- Added normalized PostgreSQL migrations, constraints, checksummed/idempotent migration/import, full-field semantic roundtrip verification, server-only DAL/TLS and separate runtime/source-worker/mailer role grants. Runtime academic JSON/Redis fallbacks are removed; original JSON remains an import/test fixture only. A read-only legacy Redis export supports a reviewed cutover without losing newer live overrides.
- Extended the existing protected admin/editor with SQL drafts/history, full-catalog review/publication, safe snapshot recovery, manual sync control, real job states/counts/diagnostics/history, per-term concurrency, leases/cancellation and explicit removal approval. Existing server auth, reports/feedback/security flows remain; server helpers moved from route discovery into `app/server/`.
- Replaced the unsafe scraper with a contract-gated dedicated catalog-JSON reader, deny-by-default requests, all-page/manifest checks, strict academic fields, bounded retries and fail-closed validation. Legacy scraper/ingest cannot update live data.
- Added deterministic before/after academic changes, no-op deduplication, atomic catalog/snapshot/history/outbox and public filtered history. Failed/stale/incomplete runs retain the known-good catalog. Missing source fields do not erase known optional facts; course identity is never inferred from code alone.
- Added local selected-section impact/overlap checks with explicit uncertainty, raw pre-revision backups and paused autosave if backup storage fails. Old meeting keys/retired choices remain; nothing is auto-reselected. v6 share links retain exact meeting facts; older positional links show caution, and share previews do not overwrite local plans/locks without explicit save.
- Added explicit course-interest consent, double opt-in, signed verification/unsubscribe capabilities, disabled/mock/designated-test/live provider modes, committed-only unique outbox and bounded retries. Opt-out still works while delivery is paused. Telegram deferred.
- Added local same-origin API development support, reproducible locked dependencies, real-PostgreSQL CI configuration, safe worker/mail workflows, setup/recovery/security/notification docs and a production build gate requiring independently verified SQL cutover approval. Builds run no migrations, source requests or emails.

## Executed locally — passed

| Check | Actual result |
| --- | --- |
| Read-only baseline | Original 15 suite scripts, TypeScript checks and both frontend builds passed before implementation. |
| Original catalog migration | 57 main + 13 SCH = **70 courses**, **92 instructor groups**, **287 sections**, **zero rejected**. |
| Repeated local seed + verification | Identical import returned `imported: false`, revision 1; checksum/count verification passed. |
| Backend TypeScript | Passed. |
| SQL/API/notification/deployment tests | **12/12** with both isolated PostgreSQL WASM (PGlite) and native PostgreSQL **16.14**; migrations/constraints/roles, exact normalized roundtrip, duplicate/concurrent jobs, stale leases, removal review, atomic rollback, outbox/no-op retries, public/private API, CSRF/redaction, consent/verification/unsubscribe/provider bounds and production gate. |
| Reader syntax + safety tests | **7/7**; synthetic fetch/HTML only, including pagination, counts, denied routes/actions/personal fields, auth/redirect/challenge failure, transient timeout and redaction. |
| Planner TypeScript | Passed. |
| Planner suites | **19/19 scripts passed**: the original 15 plus SQL client/preservation, sync UI, notification UI and built-bundle DOM smoke. |
| Data integrity | **2,463 checks passed**, 0 failures; original 2 missing-room warnings retained (CSAI 102 Lecture 03, CSAI 301 Lab 05). Unassigned instructors remain explicit, not fabricated. |
| Scheduler engine audit | **16/16**. |
| Core harness | **136/136**. The size assertion was updated from a positional-link budget to a bounded v6 meeting-fact payload, retaining URL-safe/roundtrip checks. |
| Existing UI suites | Max-hours **35**, share sheet **15**, year/credit-cap/cross-year **33** passed; timetable details passed. Existing admin/import/patch/English/SSR/assistant tests also passed. |
| Actual built student JS in DOM | Passed SQL hydration, relative-only catalog fetch, original local choices, raw backup and term-scoped locks. This found/fixed an eager-single-file-module initialization issue that source-only fixture injection would miss. This is not a real-browser/university-login test. |
| Production builds | Both student and admin Vite single-file builds and service-worker stamp passed, including the existing `app/` wrapper build. |
| Dependency audits | Production app/planner/sync: **0 vulnerabilities**. Full backend: 0. Full frontend tooling: **3 high** in the pre-existing `vite-plugin-singlefile → micromatch → braces` chain; no compatible patched braces release verified. No forced breaking downgrade was applied. See [SECURITY.md](SECURITY.md). |
| Local API/proxy smoke | Student and admin HTML 200, SQL catalog 200 with 70 courses, public changes/notification status 200. Missing private local admin configuration returns an honest 503 rather than fake authentication. |
| Source preservation/review | `git diff --check` passed; no fixture diff; no runtime academic JSON import found in frontend/API consumers. Private exports, local DB/builds/dependencies/diagnostics are ignored. |

Tests are not claimed to prove production account access, managed-provider networking or browser behavior on every device. Report/admin tests intentionally simulate storage/mail failures; their sanitized failure logs are expected assertions, not real delivered messages.

## Hosted CI / release status

The new CI uses a disposable PostgreSQL 16 service with an explicitly isolated test database, locked npm installs, source safety tests, all 19 planner suites, both builds and blocking production audits. Its full tooling audit explicitly reports the known unpatched dev-only advisory without silently force-fixing it.

Draft [PR #2](https://github.com/Ahmedamir21/Plan/pull/2) was opened from this session branch. Initial hosted CI failed in two permission tests because the test harness used session-level `SET ROLE` on a pooled connection; node-postgres can discard that connection after the expected error, making the next assertion run as the fixture owner. The assertions were retained and strengthened: each test operation now binds `SET LOCAL ROLE` to the same transaction/client, and actual publication is exercised under runtime grants. A separate loopback-only native PostgreSQL 16.14 cluster reproduced the failure and then passed all 11 tests after correction (the suite subsequently grew to 12 with a CI-path regression); the existing admin regression also passed on native PostgreSQL. This temporary binary/test data is ignored, not a production dependency or database. The next hosted run passed all real-PostgreSQL tests, source tests and production audits, then exposed a workflow working-directory typo that omitted one of the required nested folders. The workflow path was corrected without moving any files, and a filesystem regression now verifies its exact package locations. Hosted CI is being rerun before any merge. Runner actions were updated to verified Node-24 v6 SHAs and Ubuntu 24.04 to avoid deprecated action runtime / moving-image warnings. Repository access was verified through GitHub, but Actions-settings and repository-variable reads returned HTTP 403 (`Resource not accessible by integration`). Those settings were not inspected or changed; they require operator confirmation or an appropriately reconnected GitHub integration. Workflow YAML parsed locally through Prettier, and a credential-pattern scan found no matches (not a comprehensive secret-scanner guarantee). No manual deployment, production migration, live university request, university registration operation or real email has been executed. An automatic hosting preview/check may be triggered by a GitHub branch/PR; that is not evidence of a verified SQL production cutover.

## Unresolved external prerequisites — do not claim success

1. **Actual university connector:** no authorized dedicated catalog endpoint/export, precise source contract, supported authentication flow or real pagination/stable-ID evidence was provided. The tracked contract remains `approved: false`. The reference reader is tested; real login/catalog synchronization is **not implemented/verified against the university**. No personal schedule panel is inspected. Multi-meeting sections/additional source attributes require an evidence-based extension, not guessing.
2. **Production data and SQL readiness:** no production database was provisioned/migrated; no live Redis export was performed; no actual deployment project/DB permissions/TLS/cutover was verified. The operator must confirm current academic overrides, backups, restricted roles, validated import and a preview before setting `PLANORA_SQL_CUTOVER_APPROVED=true`. Do not update another Planora project.
3. **Hosted integration verification:** the corrected CI/service results must be checked on the actual PR; native PostgreSQL 16.14 now also passes locally. Neither local database setup verifies a managed production deployment. Remote publication latency/load and managed-pool behavior are unbenchmarked.
4. **Email:** no provider account/domain/recipient/quota or delivery was verified. Defaults are disabled. Real sending requires explicit approval and correct provider setup; no promise of free or exactly-once external delivery. Unknown outcomes require reconciliation. Approved retention procedures remain an operator task.
5. **Security/tooling limits:** three known dev-only audit findings remain; logout revocation of copied signed sessions relies on expiry or hash/key rotation. Details and controls are in `SECURITY.md`.

## Safe handoff

Read [SQL setup and rollback](SQL_SETUP.md), [admin workflow](ADMIN_PANEL.md), [sync contract](../sync/README.md), [notifications](NOTIFICATIONS.md) and [project map](PROJECT_MAP.md). Keep the previous deployment in service until the verified cutover is authorized. Restore prior academic data through a reviewed snapshot proposal/new revision, not deletion of audit history or a destructive down migration. Confirm database/deployment readiness before merging/promoting production, as requested.
