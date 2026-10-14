# PR #2 acceptance evidence and remaining access requirements

Date: **2026-10-14**. Scope: **Ahmedamir21/Plan only**. PR: <https://github.com/Ahmedamir21/Plan/pull/2>. Branch: **`arena/cd36c549-plan`**. The PR stays open/draft; no merge or production deployment is authorized.

**Overall status: implementation and controlled verification advanced; real managed SQL/Vercel/source verification is still blocked on the specific authorization/configuration below. This is not an “everything works” or production-ready claim.**

## Repository reconciliation

The audited PR head at the start of this continuation was **`5a2eca97f773a31820bc5c6e794d112110cdab29`**. GitHub showed the PR open/draft and CI successful (optional AI security review was skipped). The restored worktree matched all **195** remote files byte-for-byte; only local Git metadata was behind. Metadata was fast-forwarded to that existing descendant without replacing files or rewriting history.

Every one of the original **103** PR file records was inventoried against main, along with the continuation changes. The normalized migration, checksum migrator, importer, DAL, run/lease/review/publication code, outbox, gates and tests are real committed implementations—not placeholders described only in a report. See [file-by-file review](PR2_FILE_REVIEW.md) and the PR's exact diff. Original academic JSON fixtures and nested planner directories are unchanged.

Implementation commit and latest hosted-run evidence are recorded below after push. No other repository was modified; no Planora project was configured.

## What this continuation adds/fixes

- Shared `runCatalogJob` used by both the actual worker CLI and controlled acceptance test; it stages but never publishes.
- Real Chromium + actual HTTP handlers + PostgreSQL E2E for all nine requested section/time-change conditions, plus original-catalog schedule building, persistence, admin login/private editing/undo.
- Preview provisioning/verification code with Plan repository/branch/SHA checks before mutations, empty-database and Redis binding guards, reviewed SQL bootstrap, restricted SQL-created runtime login and explicit non-overwrite behavior.
- Preview-only Vercel configuration/deployment, disabled production builds in the dedicated project, immutable Git source attestation, safe runtime `/api/deployment` SQL evidence and actual-URL browser smoke automation. Provider calls are mocked in tests; no real successful deployment is inferred from them.
- Optional protected manual job in the **existing** Planner CI workflow, so a premature merge is not needed just to register a deployment workflow. Normal CI never accesses managed-service secrets.
- Atomic outbox insertion now uses one SQL statement per academic event, not one database round trip per subscriber.
- Preview admin setup error wording no longer tells users to configure Production. The About-page repository link now targets Plan. Documentation's nonexistent date-filter claim was corrected to course/category/term filtering with dates displayed.
- Import path validation uses resolved paths inside the ignored private-export directory, rather than a substring check.

## Exact local commands/results

`P` is the unchanged planner package:

```text
Final_Fall_2026_ZewailCity/Templates-Final-Final-main/Zewail-City-Templates-arena-01a09711-zewail-city-templates/Final_Fall_2026_ZewailCity/Final_Fall_2026_Zewail
```

| Command | Executed result |
| --- | --- |
| `npm --prefix app ci`, `npm --prefix sync ci`, `npm --prefix "$P" ci` | Locked installations passed. |
| `npm --prefix app run typecheck` | Passed, including setup/E2E code. |
| `npm --prefix "$P" run typecheck` | Passed. |
| `npm --prefix app test` | **17/17 passed**, isolated PostgreSQL WASM. |
| `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/planora_test npm --prefix app test` | **17/17 passed**, real loopback-only PostgreSQL **16.14**. Includes actual provisioning/permissions/no-overwrite tests. This disposable local URL has no real credential. |
| `npm --prefix app run test:e2e` | Passed with real headless Chromium and SQL WASM; source/Redis/mail are controlled fixtures. |
| Same E2E command with the disposable `TEST_DATABASE_URL` above | Passed with **real PostgreSQL 16.14**, real browser, actual server handlers and both synthetic/original catalogs. |
| `npm --prefix sync run check && npm --prefix sync test` | Syntax checks and **7/7** reader safety tests passed. No real source access. |
| `npm --prefix app run build` | Passed wrapper and both student/admin production builds/service-worker stamp. Not a Vercel deployment. |
| All 19 planner `test:*` scripts listed below | **19/19 passed**, including the native-SQL admin regression. |
| `npm --prefix app run dev:seed` twice; `PLANORA_LOCAL_DB=true npm --prefix app run db:verify` | Original fixture import: **70 courses / 92 instructor groups / 287 sections / 0 rejected**; identical repeat is a no-op at revision 1; SQL checksum/count verification passed. Local only. |
| `npm --prefix app audit --audit-level=high` | Full backend/development audit: **0** findings. |
| Planner and sync `npm audit --omit=dev --audit-level=high` | **0 production** findings. Backend production included in the clean full audit. |
| Planner full `npm audit --audit-level=high` | Still **3 high dev-tooling findings**, one `singlefile → micromatch → braces` chain; documented, not force-downgraded. Not a clean full-tooling-audit claim. |
| Workflow YAML parsing, `git diff --check`, fixture no-diff/credential-pattern/ignored-file checks | Passed. Pattern scanning is not a comprehensive secret-scanning guarantee. |

Planner scripts:

```text
test:platform test:data test:assistant test:admin test:completeness
test:admin-ui test:import test:patch test:patch-ui test:english
test:english-import test:audit test:ssr test:ui test:harness
test:catalog test:sync-ui test:notifications-ui test:production-ui
```

Retained detailed counts: data **2,463** checks plus original **2 missing-room warnings**; harness **136/136**; engine audit **16/16**; existing UI groups **35**, **15**, **33** plus timetable checks. Sign-in/report tests intentionally exercise sanitized failure logs. Initial new browser-test failures were test setup/selector issues (packaged browser libraries, existing Log out/year labels), corrected before recording the passing results.

## New section/time scenario — reproducible controlled evidence

See `app/e2e/catalog-flow.ts`, `app/e2e/fixture.ts` and [safe evidence JSON](evidence/controlled-catalog-flow.json).

| Acceptance condition | Verified result |
| --- | --- |
| Agent discovers new section | Two complete loopback HTTP pages; **Lab 02** is discovered. Shared real worker pipeline executes with the restricted worker role. |
| Time change appears in staged diff | Existing Lecture 01 changes **10:00–11:00 → 12:30–13:30 Monday** (600/660 → 750/810 minutes). Diff includes `start`/`end`; new lab is a separate addition. |
| Bad/incomplete source rejected | Inconsistent coverage and end-before-start source variants fail; published hash/revision remain unchanged. Existing reader tests cover redirects, auth/challenges, duplicates and other unsafe responses. |
| Approval and atomic SQL update | Anonymous publication denied; a real browser signs in, inspects the two-change proposal, enters a reason and explicitly confirms **Publish reviewed changes**. SQL/snapshot/audit/outbox commit together. |
| Saved selections preserved | Original selected UID strings and raw backup survive reload; no automatic time/section reassignment. |
| Correct conflict warning | Previously non-overlapping courses now overlap by 30 minutes; stable fixture source IDs produce the correct warning. No official-registration claim. |
| Audit/outbox exactly once | Two academic change records, two subscriber change-message entries, one new snapshot. Private admin review attribution recorded. |
| Idempotent repeated sync | Rerun is completed/unchanged; no new revision/change/outbox entries. |
| Failure preserves known-good catalog | Forced error after relational/snapshot/audit/outbox writes rolls back all of them; source failures never replace the committed catalog. |

Synthetic scope: **3 courses / 4 sections → 3 courses / 5 sections**, three instructor groups. Mail delivery: **2 mocked, 0 real**. A separate term holds the original **70/287/92** dataset for real-browser SQL loading, actual student controls, reload persistence and private admin edit/undo. All student selections remain in the browser. External Google Fonts requests are blocked during tests; no university site is opened. These are **controlled integration/E2E tests**, not tests of a university account, Neon account, real Upstash service or Vercel deployment.

## Real service status (not mocked into success)

| Area | Verified fact | Still unverified / blocked |
| --- | --- | --- |
| PostgreSQL provider | **Neon selected**, official SQL-role/pooling guidance reviewed; bootstrap/migration/import/runtime-permission tooling exists and passes real local PG tests. | No approved owner/runtime URL or provider authorization available; **no managed DB provisioning/import/connectivity result**. No production data accessed. |
| Vercel | Official current API schema reviewed; strict Plan-only project/commit/branch/Preview guards and browser verifier tested with controlled inputs. | Vercel connector unsupported; no token/project link found; **actual Preview URL: none**. No account project list, READY deployment, runtime connectivity or deployed smoke result claimed. |
| GitHub environment | Environment list returned empty. Attempt to create protected `plan-preview` returned **403 Resource not accessible by integration**. | Owner must create/protect/configure it, or reconnect GitHub with the required environment permission. No environment/secrets were silently provisioned. |
| University source | Actual reader/pipeline tested with an academic-only fixture and fail-closed guards. | **No verified permitted endpoint/export or real adapter contract**; `source-contract.json` remains unapproved/blank. No login, personal-panel access or real requests. |
| Notifications | Deduplication, consent, opt-out and mock delivery verified. | Real email/Telegram not enabled or sent; no provider quota/domain/sender verified. |

## Exact remaining owner action

Follow the single setup path in [PREVIEW_SETUP.md](PREVIEW_SETUP.md): authorize Vercel for **Plan only**; supply isolated Neon owner/runtime and dedicated Upstash credentials; create protected GitHub environment **`plan-preview`** with the **seven named secrets** and optional actual team/approved-project IDs; dispatch Planner CI on this PR branch with `preview_setup_ack=Plan isolated preview only` and approve the environment job. **Do not put credentials in chat.** This runs setup and genuine deployed verification in the authorized runner, where provider connectivity is available. If the integration cannot dispatch, the owner can use the documented Actions UI/CLI command.

Separately supply the university's permitted **academic-only** API/export specification and sanitized sample/coverage/identity evidence—not a password, cookie, private schedule or unredacted trace. That evidence is needed to implement/verify the actual source adapter safely. No supervised real source test is offered before that boundary and authorization are established.

Keep `PLANORA_SQL_CUTOVER_APPROVED` **unset/false**. No production promotion, live source access, publication of unreviewed real data or real notification is authorized by completing Preview setup. The PR remains for review.
