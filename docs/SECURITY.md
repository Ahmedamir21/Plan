# Security boundaries and known limits

Scope: Ahmedamir21/Plan only. No production SQL, university request, deployment configuration or live mail operation is authorized merely by merging code. See [SQL_SETUP.md](SQL_SETUP.md) for the explicit cutover gate/checklist and [sync safety](../sync/README.md) for the disabled source contract.

## Authentication and API controls

The existing two server-defined administrators, scrypt password hashes, HMAC-signed eight-hour Secure/HttpOnly/SameSite=Strict cookie, same-origin JSON writes, bounded bodies and atomic shared Redis login limits are retained. Academic writes also have distributed limits. The cookie binds the current credential hash version; rotating an account hash invalidates its existing sessions. HTML/button visibility is not authorization; every private API action verifies the server session. Public responses never include worker tokens, unpublished proposals, internal review notes or subscriber addresses.

This is the existing private server authentication, **not an externally managed identity provider**. Logout expires the browser cookie; it does not revoke a previously copied signed token before expiry. Rotate the affected password hash/session secret after suspected theft. Cookies require HTTPS (local development admin auth is deliberately not bypassed). Do not replace these controls with a public role flag or put secrets in VITE_ variables.

## SQL/data boundaries

- Runtime academic reads/writes use a centralized parameterized DAL and normalized PostgreSQL; no browser credentials/data API. PUBLIC schema/table access is revoked. Separate NOLOGIN runtime, worker and mailer privilege groups are supplied; deployment must actually use restricted LOGIN roles. Owner/migrator credentials are never a runtime configuration.
- Runtime snapshots/academic audit are insert/read-only, not erasable by the web role. The source worker can stage run rows but cannot publish catalog rows or read subscriptions. The mail worker cannot mutate the catalog or contact the university.
- Publication locks/checks the current revision and reviewed proposal, validates removals, and commits catalog/snapshot/audit/outbox atomically. Schema changes and seed imports are explicit commands, not startup/build behavior. Checksummed migrations fail on altered history.
- Source coverage, term identity and stable IDs are required. Missing optional values do not wipe known facts. Unknown/ambiguous source structures fail closed. Synthetic reader tests do not prove the university has the expected endpoint.
- Local schedule warnings compare downloaded committed academic facts with local saved section keys. No source-agent upload or automatic re-selection. Raw backups precede revision-related state normalization; autosave pauses if backup storage fails. Shared-link previews do not overwrite the existing plan until explicit confirmation. Legacy positional links cannot prove their original sections and show a caution.

## Email/privacy boundaries

New student email is disabled/test-only until specifically configured/approved. Explicit course interests, double opt-in, signed expiring verification, usable opt-out, unique outbox keys and bounded retries are documented in [NOTIFICATIONS.md](NOTIFICATIONS.md). Mocked is not delivered. Provider/network ambiguity is not described as exactly-once success. Student reports/feedback/security logs remain private Redis data; optional existing report/security mail remains separately opt-in.

Never log/store actual credentials, cookies, raw university responses, diagnostic screenshots/traces or tokens in Git/artifacts. Private exports/local SQL/diagnostic files are ignored. Source/auth/provider errors are redacted; public history has an explicit safe view. React renders academic text, not source HTML. API data is not cached by the PWA; cached SQL data can be opened only with an explicit stale-data warning, not a bundled JSON fallback.

## Dependencies (checked 2026-10-14)

Production dependency audits for app, planner and sync passed with **zero** findings. The app's full audit also passed. The frontend full tooling audit retains **three high-severity reports in one dev-only chain**: `vite-plugin-singlefile → micromatch → braces`, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). At review, registry `braces@3.0.3` had no patched release; npm proposed a breaking single-file-plugin downgrade. Do not blindly run `npm audit fix --force`.

The vulnerable glob parser is build tooling, not bundled client/runtime SQL code; build patterns are repository-controlled. Do not feed it untrusted glob patterns or expose a development build server as a production service. Full tooling audit is explicitly non-blocking in CI for this known issue; production audits are blocking. Recheck upstream and remove this exception with a compatible fix. Existing development-only source-map-js finding was eliminated by a pinned direct patched dependency.

## Operational limits and review

- Production build requires `PLANORA_SQL_CUTOVER_APPROVED=true` plus core config; passing it does not prove database permissions, import correctness, networking, provider quotas or actual deployment. A maintainer must verify those separately.
- Public fixture tests/PGlite are not proof of managed PostgreSQL deployment. CI additionally targets a disposable PostgreSQL 16 service, never a production database. Tests reject non-local/non-`planora_test` SQL URLs.
- Optional source read-only GET is not a guarantee about an undocumented remote server's side effects: endpoint review and authorization are mandatory. Challenges are not bypassed.
- Current schema/parser cannot silently reinterpret unsupported multi-meeting sections or additional source attributes; review and extend safely if verified source evidence requires them.
- Retention, delivery limits, backups and recovery drills are deployment responsibilities; no real-data deletion/automatic down migration is supplied.
- Existing optional same-repository Anthropic PR review requires a privately configured key. Its upstream prompt-injection caveat remains; do not enable it for untrusted PRs. A review/test suite cannot guarantee absence of vulnerabilities.

Check staged diffs and ignored paths before pushing. If credentials were exposed, rotate them privately; never paste them into an issue or chat. No other repository/project/account should be changed during this upgrade.
