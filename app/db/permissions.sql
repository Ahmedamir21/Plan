-- DBA-only, after migrations. Does not create logins/passwords or grant PUBLIC access.
-- Create a distinct LOGIN in your provider console, grant this group to that login,
-- and configure its private URL in the server/worker. Do not use the migration owner.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='planora_runtime') THEN
    CREATE ROLE planora_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA planora FROM planora_runtime;
GRANT USAGE ON SCHEMA planora TO planora_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA planora TO planora_runtime;
REVOKE ALL ON planora.schema_migrations FROM planora_runtime;
GRANT INSERT, UPDATE ON planora.terms, planora.catalogs, planora.courses,
  planora.instructor_groups, planora.sections, planora.catalog_state,
  planora.sync_runs, planora.email_subscriptions, planora.notification_deliveries TO planora_runtime;
GRANT INSERT ON planora.catalog_changes, planora.catalog_snapshots, planora.admin_catalog_events TO planora_runtime;
GRANT INSERT, UPDATE, DELETE ON planora.meetings, planora.majors,
  planora.year_plans, planora.year_plan_courses, planora.admin_drafts,
  planora.subscription_courses TO planora_runtime;
-- Audit/snapshots: runtime cannot UPDATE/DELETE. No browser ever gets this role.
REVOKE ALL ON SCHEMA planora FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA planora FROM PUBLIC;

-- Separate Actions worker group: can read academic data and stage a job, but cannot
-- write the live catalog, published history, student subscriptions or mail queue.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='planora_worker') THEN
    CREATE ROLE planora_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA planora FROM planora_worker;
GRANT USAGE ON SCHEMA planora TO planora_worker;
GRANT SELECT ON planora.terms, planora.catalogs, planora.catalog_state,
  planora.courses, planora.instructor_groups, planora.sections, planora.meetings,
  planora.majors, planora.year_plans, planora.year_plan_courses, planora.sync_runs TO planora_worker;
GRANT UPDATE ON planora.sync_runs TO planora_worker;

-- Optional notification runner: no university credentials, no catalog mutation rights.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='planora_mailer') THEN
    CREATE ROLE planora_mailer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA planora FROM planora_mailer;
GRANT USAGE ON SCHEMA planora TO planora_mailer;
GRANT SELECT ON planora.email_subscriptions, planora.notification_deliveries, planora.catalog_changes TO planora_mailer;
GRANT UPDATE ON planora.notification_deliveries TO planora_mailer;
