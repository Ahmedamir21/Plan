-- PostgreSQL-backed private key/value storage used by the admin audit and rate-limit adapter.
-- Idempotent so existing preview databases with the manually-applied table remain compatible.
CREATE TABLE IF NOT EXISTS planora.admin_kv_store (
  key text PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 512),
  kind text NOT NULL CHECK (kind IN ('string', 'list', 'hash')),
  value jsonb NOT NULL,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_kv_store_expiry
  ON planora.admin_kv_store (expires_at)
  WHERE expires_at IS NOT NULL;
REVOKE ALL ON planora.admin_kv_store FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'planora_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON planora.admin_kv_store TO planora_runtime;
  END IF;
END $$;
