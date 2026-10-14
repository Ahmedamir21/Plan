-- Bootstrap ONLY after the setup runner proves the target database is empty.
-- Separate from the academic migration ledger so a foreign populated DB is rejected first.
-- No secret/URL/password is persisted in this binding. Never used for production cutover.
CREATE SCHEMA plan_preview_guard;
REVOKE ALL ON SCHEMA plan_preview_guard FROM PUBLIC;
CREATE TABLE plan_preview_guard.binding (
  singleton boolean PRIMARY KEY CHECK (singleton),
  id uuid NOT NULL,
  repository text NOT NULL CHECK (repository = 'Ahmedamir21/Plan'),
  purpose text NOT NULL CHECK (purpose = 'preview'),
  runtime_role text NOT NULL CHECK (runtime_role ~ '^plan_preview_[a-z0-9_]{1,32}$'),
  fixture_hash text NOT NULL CHECK (length(fixture_hash) = 64),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON plan_preview_guard.binding FROM PUBLIC;
