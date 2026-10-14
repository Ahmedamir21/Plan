# Existing admin workspace, now SQL-backed

Open `/admin.html` on the **verified deployment of Ahmedamir21/Plan**, or use the existing Admin link. A historical reference URL is not proof of which Vercel project serves it. The student planner and admin remain separate builds with the existing design. No password or database token is in their HTML.

## Accounts and setup

The two fixed account definitions remain in `app/admin-accounts.ts`. Each uses a separate private scrypt hash. Generate it with the existing hidden-input `node scripts/hash-admin-password.mjs` command and store it privately under that account's variable listed in `app/.env.example`. Generate each separately. Keep one strong private session signing secret. There is no default/shared development password. Rotating a hash invalidates that account's old signed sessions; rotating the session secret invalidates all.

Existing Upstash/KV REST configuration is still required for distributed login/write limits, private report/feedback inboxes and legacy login/security history. **Academic live data, drafts, snapshots and publication history now use SQL**, not Redis. See [SQL_SETUP.md](SQL_SETUP.md) before deployment: migrations/import/permissions and explicit production cutover approval are required. A missing configuration or storage failure is an error, never a pretend saved state.

All private read/write actions authorize the signed server session; same-origin JSON, body limits and shared write throttling protect changes. The eight-hour Secure/HttpOnly/SameSite=Strict cookie is scoped to the admin API. Logout expires the current browser cookie; a copied token requires expiry/hash/secret rotation to invalidate. No public role flag grants access.

## Manual academic edits and imports

The existing **Data drafts**, searchable course editor, private timetable preview, CSV template/import, copied text importer, scoped patches, whole-semester validation and English-shell workflow remain. They operate on SQL-backed compatible `courses.json`, `sch.json`, `semester.json`, `majors.json` representations; these names are editor/export formats, not competing live files.

- Browser edits/imports do not publish. Supply an academic source/reason and save a draft explicitly. Imports that report skipped/ambiguous rows require review; they are not full-catalog synchronization.
- Draft saves are revision-checked, attributed and atomic with private SQL history. A stale second editor must reload. **Undo last saved draft** affects only that draft and records its reason.
- Existing **Save & publish to students** validates the complete candidate and base revision, stages a run, checks the review/removal requirements, and commits through the same SQL publication pipeline. Only explicitly confirmed, valid publication updates students on reload. No GitHub fixture is rewritten.
- Semester/major edits and accumulated saved drafts can be staged together in the sync panel, inspected against the current full catalog, then explicitly approved. Changing the term key itself requires a separately reviewed new-term import, not an in-place draft rename.
- Export is an explicit download of validated saved SQL content, not an implicit deployment step. Keep operational exports private; do not overwrite original migration fixtures merely to deploy an academic update.
- **Restore previous published version** now stages a recovery proposal. Review it in the sync panel and approve removals explicitly. Recovery is a new audited SQL revision, not deletion of history. Snapshot recovery can also be started from the listed retained revisions.

## Self-Service sync panel

The **Sync Self-Service** control is part of this existing dashboard. It is disabled until a verified dedicated academic catalog contract, protected worker, role-separated database connection and repository-restricted dispatch are configured. It does not claim that a guessed university login works. Read [sync/README.md](../sync/README.md) before any live configuration.

After confirmation, the server queues a UUID/lease and dispatches only this repository's worker. No arbitrary URL, course subset, credentials or repository is supplied by the browser. One active run per term (including review) prevents duplicates. The panel displays real queued/running/validating/review/applying/completed/warning/failed/cancelled states, source capability, last attempt/success, course/section counts, inserted/updated/unchanged/removed/skipped/error counts, safe diagnostics and paged history. Course+section records contribute to the operation counts. No fake success/timestamp/progress percentage is generated.

A complete changed proposal waits for a human diff review and reason. Removals need their own explicit checkbox. A stale base/proposal, invalid source coverage or failed transaction retains the known-good catalog. An unchanged run generates no new academic changes/outbox. Cancel stops a queued/running/review lease; if a runner is killed, the UI eventually reports lease expiry instead of hanging forever.

## Student visibility, local plans and mail

Students download only committed SQL data. Public change history is searchable by course/category/date and excludes private reviewer/source diagnostics. Drafts are never public. On SQL failure the app offers retry and, only if explicitly chosen, a previously downloaded **stale SQL cache**. It does not silently fall back to JSON.

Local saved choices are not rewritten to a changed section. The browser keeps a raw pre-revision backup, shows affected selected sections and newly introduced overlaps, distinguishes label-only potential issues from stable-ID comparisons, and never claims a real registration changed. It never uploads a student's plan to the sync worker. Older positional shared links display a caution; opening a share preview does not overwrite local choices until the user explicitly saves it.

Optional course-update email requires a separately selected course list, consent and verification. The admin panel shows delivery states and can process a confirmed batch of up to three messages in the configured mode. `mocked` does not mean emailed. Disabled is the default; live delivery needs separate approval and setup. See [NOTIFICATIONS.md](NOTIFICATIONS.md).

## Existing reports, feedback and security history

Reports and general feedback remain private Redis inboxes, with their existing size/rate limits, server authorization, review notes/statuses and attribution. The per-course report flow remains separate from editing academic data; resolving a report alone never changes the catalog. Optional names/free text are user supplied and should not contain sensitive information. No student ID or university login is requested.

Existing optional report and sign-in security alerts remain separate Apps Script/webhook integrations; see [REPORT_EMAIL.md](REPORT_EMAIL.md). They must not be enabled/tested against real recipients without approval. Private sign-in logs retain their existing limited history/retention and never log passwords. The admin **Published section completeness** view still highlights unknown rooms and unassigned instructors; absence must be checked, not invented.

Do not delete old Redis history, unpublished drafts or exports during cutover. Review/archive them through an approved operator procedure; no destructive migration is provided.
