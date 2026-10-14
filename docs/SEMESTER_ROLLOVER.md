# Semester rollover with SQL

The nested directory names are historical and must **not** be renamed or duplicated for a new semester. The live catalog and term metadata now come from PostgreSQL; changing a bundled JSON file no longer publishes anything. Original `src/semester/*.json` files remain preserved migration/test fixtures.

## Prepare a new term

1. Obtain complete authorized academic-only facts. Start a **private reviewed export** in the existing four-part `semester`, `courses`, `sch`, `majors` shape. The existing `semester-template/` is a shape reference, not live data. Do not guess credits, rooms, instructor names, stable identities or academic-year requirements.
2. Use a new unique semester key (for example `spring-2027-main`). Keep stable legacy course IDs where appropriate within that term; codes alone are not global identity. Preserve section labels including leading zeros. Fill explicit term/session/year, verification date and valid calendar dates. Never change `LEGACY_UNTAGGED_SEMESTER_KEY`: it permanently identifies original Fall 2026 untagged state/links.
3. Validate the complete new dataset. Both established catalogs must be nonempty; no missing course/year references, duplicate IDs/source sections, invalid component/day/time/credit values, or contradictory fixed-schedule flags. Known unpublished rooms/instructors remain warnings, not invented values. Unsupported source shapes require a reviewed adapter/schema change.
4. Back up the SQL database, then explicitly import the new key into an isolated preview database first. The importer is additive by term and refuses overwriting a different existing catalog. See [SQL_SETUP.md](SQL_SETUP.md); do not run tests against production or drop the previous term.
5. Select the new term through the preview's server-only `PLANORA_TERM_KEY`. The SQL API hydrates all frontend term facts before mounting. Do not hard-code new facts in adapters or revive a runtime JSON fallback.
6. Review study plans, source identity, original saved plans, share compatibility and all student/admin functionality before authorizing a production cutover. If a separately retained hostname is desired for the old term, its creation/promotion is a separately authorized deployment task, not performed by a directory or metadata rename.

## Student data compatibility

Saved state and links are term-tagged. v6 links preserve exact meeting facts; v3–v5 links remain readable only for their intended term, with positional-section uncertainty disclosed. A future term cannot silently reinterpret an old term's choices. Before state normalization, the browser preserves raw old state locally; it pauses autosaving if that backup fails. It does not upload the old plan. Term-scoped locks and assistant constraints are resolved after SQL hydration.

New-term enrollment/notification consent is not automatically inferred from a previous term's interests. Source contract term and active SQL term must agree before a worker can run. Do not enable actual university access or live mail as a side effect of rolling over a term.

## Minimum review

Exercise Years 1–4, each major, cross-year addition, SCH elective, optional English shell, multiple/unassigned instructors, no-fixed-schedule course, a real overlap, Best Schedule, old/new share links, image/calendar export, course/section locks, AI preview/validation, admin draft publication/removal/recovery, public history, SQL failure/stale cache, and saved-state backup. Run all original/new tests and both production builds. Confirm deployment/database readiness separately; green fixture tests alone do not authorize a live cutover.
