# SQL architecture, migration and deployment

Scope: **Ahmedamir21/Plan only**. The historical Planora URL and other repositories/projects are not assumed to be this deployment. Do not change another Vercel project, database, university account or repository while following this guide.

## Architecture and authoritative data

```text
Student React app ── GET /api/catalog ── server DAL ── PostgreSQL
                  ├─ GET /api/changes ── public academic history
                  └─ local picks / backups / conflicts (no sync-agent upload)

Authenticated existing admin ── POST /api/admin ── queued SQL run
                  └─ fixed Ahmedamir21/Plan workflow dispatch
                     └─ approved GET-only catalog reader ── staged SQL proposal
Admin reviews proposal + removals ── atomic catalog + snapshot + history + outbox
Optional email runner ── committed outbox ── disabled / mock / test / approved live
```

The existing nested React/Vite/Tailwind planner, scheduler, palettes, section selection and separate admin page remain. Vercel root remains `app/`. PostgreSQL/node-postgres is server-only; there is **no Supabase/browser database API**. Redis remains solely for existing authentication limits, reports, feedback and legacy security/activity history. Redis live academic overrides are retired, not silently retained as another runtime source.

`app/server/` is the shared DAL/validation/publication layer. `app/api/` contains actual HTTP handlers only. Public queries use consistent read transactions. Production requires verified PostgreSQL TLS; `sslmode` URL options cannot override certificate validation. Use a provider pooler/connection budget appropriate for serverless: each warm process currently allows at most three connections. Monitor this before scaling; remote latency/load capacity has not been benchmarked.

Normalized tables: terms → catalogs → courses → instructor groups → sections → meetings; majors → year plans → course references. Term-scoped legacy course IDs preserve existing planner choices. Course codes are unique within term/catalog, **not global identifiers**. Sections use an explicit source ID when supplied, otherwise a course/component/label identity. Source matching never maps a new course ID by code alone. Removed courses are retired, not deleted. Snapshots, sync runs, changes, private drafts, attributed admin events, subscriptions and outbox are separate tables. SQL JSONB is used for term metadata and immutable snapshots/proposals/audit payloads, not as a competing live course-list file.

The original four `src/semester/*.json` files are unchanged migration fixtures and tests only. No production frontend module imports them. Source-less English shells keep unknown credits/meetings; no values are invented. The existing model supports one meeting per component/section; unexpected multi-meeting sections or unsupported source fields fail validation pending a reviewed adapter/schema extension.

## Local development (no external accounts)

Node 22 and npm are required. From the repository root:

```bash
P='Final_Fall_2026_ZewailCity/Templates-Final-Final-main/Zewail-City-Templates-arena-01a09711-zewail-city-templates/Final_Fall_2026_ZewailCity/Final_Fall_2026_Zewail'
npm --prefix app ci
npm --prefix sync ci
npm --prefix "$P" ci
npm --prefix app run dev:seed
PLANORA_LOCAL_DB=true npm --prefix app run dev
# In a second terminal:
npm --prefix "$P" run dev
```

Vite on port 5173 proxies relative `/api` requests to the local Node adapter on 3001. Both bind to `0.0.0.0`; `.e2b.app` preview hosts are allowed. Browser code never calls another service through browser-local `localhost`. Production is served by Vercel, not the local adapter.

Local seeding uses PostgreSQL WASM (PGlite) in ignored `app/.data/catalog`. It refuses a configured `DATABASE_URL`, Vercel or production context. It does not contact Redis/university/email providers. The fixture import contains **70 courses, 92 instructor groups and 287 sections**, with zero rejected rows; two rooms and several instructors are explicitly unpublished/unassigned. Repeating an identical import is a verified no-op.

Local admin login is intentionally not supplied with a default password or fake successful storage. Its existing private auth/Redis configuration is still required. Offline tests use isolated SQL and mocked Redis instead of real credentials. `app/.env` is optional and ignored; CLI development/database commands read it through Node's built-in environment-file support.

## Production cutover — operator checklist, NOT executed by the build

1. Confirm the project is connected to **Ahmedamir21/Plan**, its current production commit, actual live catalog overrides and database owner. Do not infer that the historical reference site belongs to this repository.
2. Back up the existing deployment/source and private Redis data. Agree a freeze on academic admin edits during export/cutover. Keep reports/feedback/security history intact. Do not delete legacy Redis keys.
3. Check whether Redis contains newer `planora:admin:live:v1:courses.json` or `sch.json` values. With the existing private Redis credentials, explicitly run `npm --prefix app run db:export-redis`. This reads only academic live overrides over the original fixtures and writes a mode-0600 file in ignored `app/private-exports/`. It never outputs tokens or reads personal university schedules. Review any existing private drafts separately; do not treat an unpublished draft as live data.
4. Provision **a dedicated PostgreSQL database for Plan**, preferably first an isolated staging database. Review `app/db/migrations/001_academic_catalog.sql`. Using an owner/migrator connection supplied privately, run `npm --prefix app run db:migrate`. Migrations are transactional, advisory-locked and checksum-tracked; a modified already-applied migration is rejected. No `DROP`/automatic down migration is supplied.
5. With the migrator connection, import the reviewed export:

   ```bash
   npm --prefix app run db:import -- --input=private-exports/catalog-REVIEWED.json
   npm --prefix app run db:verify
   ```

   `REVIEWED` means the actual export filename, not a literal file supplied in this repository. If the operator has verified that Redis contains **no newer live overrides**, `npm --prefix app run db:import -- --fixtures-reviewed` is the explicit alternative. There is no automatic fallback or overwrite. Existing different SQL data is rejected rather than replaced by a seed. Compare counts, semantic hash and all original field values. Re-export while edits remain frozen and confirm no cutover drift.
6. A DBA reviews/applies `app/db/permissions.sql` and creates separate **LOGIN** roles privately. Grant `planora_runtime` to the web-app login, `planora_worker` to the read-only source-worker login, and `planora_mailer` to an optional mail-runner login. These supplied groups are NOLOGIN and nonsuperuser. Never use an owner/superuser service connection in the web app or worker; do not grant the migration role to them. PUBLIC has no access to the schema/tables; no database credentials go to the browser. This is PostgreSQL role separation, not a pretend RLS policy.
7. Configure a preview of this repository with the runtime connection, active term and existing private admin/Redis variables. Leave university synchronization and live mail disabled. Verify `/api/catalog`, all major/year plans, manual section selection, engine, existing saved state, v6/legacy sharing, calendar/image export, admin drafts/history/publication/removal review, and the SQL revision visible to students. Use mocks, not a real email or university account. Verify Vercel's existing outside-root build-file setting accommodates the unchanged nested planner and traced `sync/` modules.
8. Only after explicit deployment authorization and verified migration, set `PLANORA_SQL_CUTOVER_APPROVED=true` in the **correct Plan production environment**. `app/scripts/check-production-config.mjs` blocks a Vercel production build without this flag and core private configuration, or with local DB/TLS-disable options. A successful build is not a database readiness test. No migration/import/job/send occurs in any build script.
9. Confirm the exact deployment, catalog revision/hash, public API shape and logs. Keep a recovery window and original backups. Enabling an actual university integration or real email remains a **separate authorization**.

### Environment variables

See `app/.env.example` for web-app names (only blank secrets and safe defaults are committed):

- `DATABASE_URL`, optional `DATABASE_SSL_CA`, `PLANORA_TERM_KEY`, `PLANORA_SQL_CUTOVER_APPROVED`.
- Existing `PLANORA_ADMIN_AHMED_PASSWORD_HASH`, `PLANORA_ADMIN_YOUSSEF_PASSWORD_HASH`, `PLANORA_ADMIN_SESSION_SECRET`; Upstash or KV REST URL/token pair. Use the existing hidden-input hash generator; never put actual values in a PR/chat.
- Existing optional `GEMINI_API_KEY`, report-mail webhook variables and `PLANORA_SECURITY_MAIL_ENABLED`.
- Optional dispatch: `PLANORA_SELF_SERVICE_ENABLED=false` by default, `PLANORA_GITHUB_ACTIONS_TOKEN`, `PLANORA_SYNC_REF` (an explicitly approved ref in **Plan**). Use a repository-restricted Actions-write credential; it has no reason to access Planora or another repository.
- Optional student mail: `PLANORA_EMAIL_MODE`, `PLANORA_EMAIL_TOKEN_SECRET` (32+ random characters), `PLANORA_PUBLIC_URL` (HTTPS origin only), `PLANORA_EMAIL_FROM`, `PLANORA_EMAIL_TEST_RECIPIENT`, `RESEND_API_KEY`, `PLANORA_EMAIL_LIVE_APPROVED`.

University credentials are **not web-app variables**. Worker/mail GitHub environments and additional variable names are documented in [sync/README.md](../sync/README.md) and [NOTIFICATIONS.md](NOTIFICATIONS.md). There are no `VITE_` credentials.

## Safe recovery and rollback

- Before cutover, leave the prior deployment in service. A blocked production build runs no migration. Do not approve the cutover flag merely to make CI green.
- After SQL publication, use the authenticated admin snapshot recovery action. It stages a previous **full SQL snapshot as a new proposal**; inspect the diff and explicitly approve any removals. Recovery creates a new revision, audit records and appropriate notifications, rather than erasing history. The UI can stage the latest retained snapshots (20 listed; older database snapshots remain preserved).
- A validation/constraint/write/audit/outbox failure rolls back the whole publication. Readers retain the previous catalog; incomplete reads never publish deletions.
- An application-code rollback should use a known-good **SQL-compatible** release and preserve the database. Reverting to the pre-SQL application is not transparent: it uses old Redis/JSON data and cannot understand new exact-section links. First export/reconcile current SQL academic data and obtain operator approval; never serve stale data silently.
- Do not drop the schema, delete audit history, delete subscriptions or destroy backups as an automatic rollback. Retention/deletion and database restore are separately approved operator procedures. New-term import is additive and does not replace the old term.

## Verified documentation references

Reviewed upstream on 2026-10-14, via GitHub official source docs: [PostgreSQL transactions](https://github.com/postgres/postgres/blob/master/doc/src/sgml/advanced.sgml), [node-postgres transactions](https://github.com/brianc/node-postgres/blob/master/docs/pages/features/transactions.mdx), [node-postgres TLS and URL-option warning](https://github.com/brianc/node-postgres/blob/master/docs/pages/features/ssl.mdx), [Node crypto](https://github.com/nodejs/node/blob/main/doc/api/crypto.md), and [GitHub REST workflow-dispatch schema](https://github.com/github/rest-api-description/blob/main/descriptions/api.github.com/api.github.com.json). Provider deployment, credentials and quotas are not verified by these references.
