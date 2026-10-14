# Plan-only Preview setup and deployed acceptance

**Status:** automation implemented and tested against isolated PostgreSQL and provider mocks. **No Neon account/database or real Vercel Preview has been provisioned/verified in this session.** No Vercel/Neon connector is available in Arena, no relevant credentials/local Vercel link were found, and GitHub lists no deployment records for Plan. An attempt to create the protected GitHub `plan-preview` environment was also denied with HTTP 403; owner configuration is required. Those observations do not prove that the owner has no provider account/project; they mean this agent has no verified access to one.

Only `Ahmedamir21/Plan`, PR **#2**, branch **`arena/cd36c549-plan`** is authorized. Do not import or configure Planora. Do not merge this PR, promote an alias, or approve production cutover to make Preview tests pass.

## Selected provider and settings

**Neon PostgreSQL** is the selected managed provider, using the application's existing `pg` driver and verified TLS. No ORM/provider-specific runtime API is introduced. The owner/migration URL must be a **direct** connection; a runtime URL can use the matching Neon pooler. They must point to the same database/endpoint family but different roles. Provider quotas/costs must be checked in the actual account; this is not a free-tier guarantee.

The Vercel project must be linked to **Ahmedamir21/Plan** (including GitHub's numeric repository ID), with:

| Setting | Required value |
| --- | --- |
| Root directory | `app` |
| Framework | Other / `null` |
| Install | `npm ci` |
| Build | `npm run build` |
| Output | `dist` |
| Node | `22.x` |
| Source outside root directory | enabled (the nested planner stays where it is) |
| Automatic system environment variables | enabled for deployment evidence |
| Ignored build step | `test "$VERCEL_ENV" = "production"` (skip production builds in this isolated project) |

The setup runner uses a specifically approved Plan Preview project ID if provided. Otherwise it looks for/creates `plan-<verified GitHub repository ID>-preview`. It **does not** import through Vercel's UI flow that might start an initial production deployment. Creation uses the documented project API, then deploys the exact PR commit through the Git deployment API with the Preview default, no aliases and no promotion. A project linked to Planora/another repository, unexpected settings, a production branch equal to the PR branch, or a changed PR head fails closed. Existing mismatched project settings are not silently changed.

## One-time owner actions — private settings, not chat

These are the unavoidable actions before the real setup runner can execute. Do not paste any value into this conversation, the repository, a PR or a log.

1. **Authorize Vercel for this repository only.** Install/authorize Vercel's GitHub integration for `Ahmedamir21/Plan`. Create a Vercel access token scoped to the intended account/team. Do not change the existing Planora project. If an approved **Plan Preview-only** project already exists, supply its actual project ID below; do not guess an ID from a similar project name.
2. **Supply an isolated Neon Preview database.** Create an empty database in a Plan-only project/branch (not a clone containing another application's production data), or use an already approved database bound by this setup runner to Plan Preview. Obtain the direct owner connection string. Prepare a separate runtime connection string for a new SQL role named `plan_preview_runtime` (or `plan_preview_<lowercase suffix>`), same database/endpoint, with a privately generated password of **24+ characters**. URI-encode the credentials. The runner creates this SQL login if absent; you do not need to use Neon's elevated console-role creator. Do not supply the default owner URL as the runtime URL.
3. **Supply a dedicated empty Upstash Redis database for Plan Preview.** This preserves the existing application authentication/rate-limit/report infrastructure without borrowing another project's store. The runner uses an atomic empty-store/Plan-binding fence and refuses nonempty unbound stores. Existing Planora Redis credentials must not be used.
4. In **Ahmedamir21/Plan → Settings → Environments**, create/configure protected environment **`plan-preview`**, require a maintainer review, and restrict deployment branches to **`arena/cd36c549-plan`**. Add the following environment secrets:

   | Secret name | Private value to configure |
   | --- | --- |
   | `VERCEL_TOKEN` | Account/team-scoped Vercel token authorized for the intended Plan Preview project |
   | `PLAN_PREVIEW_DATABASE_OWNER_URL` | Direct Neon owner/migrator URL for the isolated Preview DB |
   | `PLAN_PREVIEW_DATABASE_RUNTIME_URL` | Matching restricted runtime URL, username beginning `plan_preview_`, distinct from owner |
   | `PLAN_PREVIEW_REDIS_URL` | Dedicated Upstash HTTPS REST origin |
   | `PLAN_PREVIEW_REDIS_TOKEN` | Its REST token |
   | `PLAN_PREVIEW_ADMIN_PASSWORD` | A new **Preview app** password, 16+ characters, for `ahmed` |
   | `PLAN_PREVIEW_SECOND_ADMIN_PASSWORD` | A different new **Preview app** password, 16+ characters, for `youssef` |

   Optional non-secret environment variables: `VERCEL_TEAM_ID` for the actual authorized team; `PLAN_PREVIEW_VERCEL_PROJECT_ID` only for a specifically approved existing Plan Preview project. Passwords here are **not university passwords**. Reuse no production credentials. The runner hashes app passwords, generates a Preview session key, and stores only Preview/branch-scoped server variables in Vercel.
5. After the PR code is reviewed, run the existing **Planner CI** workflow on **`arena/cd36c549-plan`**, entering exactly **`Plan isolated preview only`** in `preview_setup_ack`, then approve the protected environment job. An authorized agent can dispatch the same workflow after the private setup is confirmed; if its GitHub integration cannot dispatch, use the Actions UI or:

   ```bash
   gh workflow run planner-ci.yml --repo Ahmedamir21/Plan \
     --ref arena/cd36c549-plan \
     -f preview_setup_ack='Plan isolated preview only'
   ```

This existing workflow already exists on main, so no premature merge is needed merely to register a new manual workflow. Normal pushes/PRs execute only disposable tests; they do **not** run the provider setup job.

## What the approved runner does

- Validates the repository, open PR number, branch and exact SHA against GitHub before provider operations and rechecks before deploying.
- Verifies project repository linkage before every mutation. It never edits another repository's Vercel project. A new dedicated project is configured with the settings above; an approved existing one must already satisfy the isolated settings.
- Uses `app/db/preview-guard.sql` to bind an **empty** DB to `Ahmedamir21/Plan`, purpose `preview`, a unique ID, runtime role and initial catalog hash. Foreign/unbound nonempty databases are rejected **before DDL**. No reset/drop/overwrite path exists.
- Applies the checksummed academic migration and imports only the unchanged repository catalog: **70 courses, 92 instructor groups, 287 sections**. A rerun is a no-op when identical; any changed existing SQL catalog is refused, not replaced. This is a Preview fixture import, **not** an export/reconciliation of live production Redis overrides.
- Applies reviewed role grants; creates a basic SQL runtime login only if absent, without resetting an existing password. Connects independently as runtime and proves it is not owner/superuser/CREATEROLE/BYPASSRLS, cannot read migration ownership data or alter/delete audit snapshots, and can read the expected catalog/binding.
- Writes only `target: [preview]`, `gitBranch: arena/cd36c549-plan` encrypted environment variables. Production cutover, live source collection, real academic mail and legacy report/security mail are forcibly off. No university credential or real mail key is required.
- Creates the Preview from the immutable Git source; polls readiness with bounded time. `READY` is accepted only when provider metadata matches the verified project/repository ID/branch/SHA and a non-production target.
- Creates a temporary official Vercel automation-protection capability scoped to this verified project for smoke tests, never forwards it to another origin, and revokes only its own capability in `finally`. This does not bypass university MFA/CAPTCHA or remove existing Vercel access protection.
- Checks the actual Preview's `/api/deployment` and `/api/catalog`: runtime Git metadata, SQL binding/hash/counts and disabled safeguards must agree. Configured URL alone is not connection evidence.
- Runs headless Chromium on the real Preview: catalog loads; anonymous private admin access is denied; actual UI course/section selection persists across reload; app admin login works; a private draft edit can be read and undone with revision guards; published catalog remains unchanged; live sync/mail remain disabled. Existing private drafts cause a stop instead of being overwritten.

The runner writes a safe evidence JSON to ignored `app/.data/evidence/deployed-preview.json` and an Actions step summary containing the **actual** Preview URL and Git/SQL verification. It logs no password/token/connection URL/raw provider response. It does not upload browser screenshots, traces, profiles, source responses or private exports. The evidence file does not exist until an actual successful run; mock tests are not substituted for it.

## Recovery

A failed setup leaves the already-known catalog intact. A first interrupted setup may leave a Preview binding/schema or restricted login so the same authorized run can safely resume. No other project's records are deleted. Do not change the initial fixture hash to conceal drift; inspect/review that database first. Do not reset an existing runtime password implicitly; rotate it privately and intentionally if necessary.

The smoke verifier undoes only its exact private draft revision. A concurrent administrator change is not overwritten; a cleanup conflict returns a specific failure requiring review. All private edit/undo history remains. Revoke a temporary automation capability from this Plan project's settings if an externally killed runner could not perform cleanup. No production rollback/down migration is performed; use the existing reviewed snapshot recovery procedures for academic data.

## Live university integration is separate

The shipped source contract remains unapproved. No actual endpoint/login has been verified. Supply an officially permitted academic-only endpoint/export specification, pagination/completeness semantics, supported fields/identities and a **sanitized academic-only sample**, plus authorization. Do not provide a password, cookies, Authorization header, unredacted Network dump, or personal schedule screenshot. An adapter must then be reviewed/tested against that evidence. Only after the safe boundary and explicit authorization exist can a supervised catalog-only test be offered. The runner above never enables or performs that access.

## References actually checked

Official source documentation reviewed on 2026-10-14:
- [Neon roles](https://github.com/neondatabase/website/blob/main/content/docs/manage/roles.md): Console/API roles receive elevated membership; basic runtime roles must be created through SQL.
- [Neon pooling](https://github.com/neondatabase/website/blob/main/content/docs/connect/connection-pooling.md): direct migration connection versus transaction-pooled serverless connection.
- [Official Vercel API specification](https://github.com/vercel/sdk/blob/main/vercel-spec.json): project creation/update, branch-scoped Preview environment variables, immutable Git deployment, `target` Preview default, deployment evidence and automation-protection lifecycle. These docs do not prove account authorization or an actual deployment succeeded.
