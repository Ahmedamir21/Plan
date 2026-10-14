-- PostgreSQL 15+. No destructive migration, external extension or public data API.
CREATE SCHEMA IF NOT EXISTS planora;
REVOKE ALL ON SCHEMA planora FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA planora REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA planora REVOKE ALL ON SEQUENCES FROM PUBLIC;

CREATE TABLE planora.terms (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE TABLE planora.catalogs (
  term_key text NOT NULL REFERENCES planora.terms(key) ON DELETE RESTRICT,
  key text NOT NULL CHECK (key IN ('courses', 'sch')),
  PRIMARY KEY (term_key, key)
);
CREATE TABLE planora.catalog_state (
  term_key text PRIMARY KEY REFERENCES planora.terms(key) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  content_hash text NOT NULL CHECK (length(content_hash) = 64),
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE planora.courses (
  id uuid PRIMARY KEY,
  term_key text NOT NULL,
  catalog_key text NOT NULL,
  legacy_id text NOT NULL CHECK (length(legacy_id) BETWEEN 1 AND 100),
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 80),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  palette smallint NOT NULL CHECK (palette BETWEEN 1 AND 7),
  credits numeric CHECK (credits BETWEEN 0 AND 21),
  course_group text,
  no_fixed_schedule boolean,
  awaiting_source boolean,
  source_id text,
  position integer NOT NULL CHECK (position >= 0),
  active boolean NOT NULL DEFAULT true,
  FOREIGN KEY (term_key, catalog_key) REFERENCES planora.catalogs(term_key, key) ON DELETE RESTRICT,
  UNIQUE (term_key, legacy_id),
  UNIQUE (term_key, catalog_key, code),
  UNIQUE (term_key, catalog_key, source_id),
  UNIQUE (id, term_key)
);
CREATE INDEX courses_term_catalog_active ON planora.courses(term_key, catalog_key, active);
CREATE INDEX courses_code ON planora.courses(code);
CREATE TABLE planora.instructor_groups (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES planora.courses(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position >= 0),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 300),
  note text,
  unassigned boolean,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (course_id, position),
  UNIQUE (id, course_id)
);
CREATE TABLE planora.sections (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES planora.courses(id) ON DELETE RESTRICT,
  instructor_group_id uuid NOT NULL,
  identity_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('Lecture', 'Lab', 'Tutorial')),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  source_id text,
  position integer NOT NULL CHECK (position >= 0),
  active boolean NOT NULL DEFAULT true,
  FOREIGN KEY (instructor_group_id, course_id) REFERENCES planora.instructor_groups(id, course_id) ON DELETE RESTRICT,
  UNIQUE (course_id, identity_key)
);
-- A label can be reused only after the previous source section is retired.
CREATE UNIQUE INDEX active_section_labels ON planora.sections(course_id, kind, label) WHERE active;
CREATE UNIQUE INDEX active_section_sources ON planora.sections(course_id, source_id) WHERE active AND source_id IS NOT NULL;
CREATE TABLE planora.meetings (
  section_id uuid NOT NULL REFERENCES planora.sections(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  weekday text NOT NULL CHECK (weekday IN ('Sun','Mon','Tue','Wed','Thu')),
  start_minute integer NOT NULL CHECK (start_minute >= 0),
  end_minute integer NOT NULL CHECK (end_minute <= 1440 AND end_minute > start_minute),
  room text NOT NULL,
  PRIMARY KEY (section_id, position)
);
CREATE TABLE planora.majors (
  term_key text NOT NULL REFERENCES planora.terms(key) ON DELETE RESTRICT,
  id text NOT NULL,
  position integer NOT NULL,
  title text NOT NULL,
  subtitle text NOT NULL,
  blurb text NOT NULL,
  PRIMARY KEY (term_key, id)
);
CREATE TABLE planora.year_plans (
  term_key text NOT NULL,
  major_id text NOT NULL,
  id text NOT NULL CHECK (id IN ('y1','y2','y3','y4')),
  position integer NOT NULL,
  label text NOT NULL,
  PRIMARY KEY (term_key, major_id, id),
  FOREIGN KEY (term_key, major_id) REFERENCES planora.majors(term_key, id) ON DELETE CASCADE
);
CREATE TABLE planora.year_plan_courses (
  term_key text NOT NULL,
  major_id text NOT NULL,
  year_id text NOT NULL,
  course_id uuid NOT NULL,
  position integer NOT NULL,
  PRIMARY KEY (term_key, major_id, year_id, course_id),
  FOREIGN KEY (term_key, major_id, year_id) REFERENCES planora.year_plans(term_key, major_id, id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, term_key) REFERENCES planora.courses(id, term_key) ON DELETE RESTRICT
);

CREATE TABLE planora.sync_runs (
  id uuid PRIMARY KEY,
  term_key text NOT NULL REFERENCES planora.terms(key) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('self-service','admin','import','recovery')),
  requested_by text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','validating','awaiting_review','applying','completed','completed_with_warnings','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  lease_until timestamptz,
  worker_token uuid,
  contract_hash text,
  base_revision integer,
  proposed_hash text,
  proposal jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  reviewed_by text,
  reviewed_at timestamptz,
  review_reason text,
  github_run_id text
);
-- Includes pending review: do not stage competing catalogs on the same base.
CREATE UNIQUE INDEX one_active_catalog_run ON planora.sync_runs(term_key)
  WHERE status IN ('queued','running','validating','awaiting_review','applying');
CREATE INDEX sync_runs_history ON planora.sync_runs(term_key, created_at DESC, id);
CREATE TABLE planora.catalog_snapshots (
  term_key text NOT NULL REFERENCES planora.terms(key) ON DELETE RESTRICT,
  revision integer NOT NULL,
  run_id uuid REFERENCES planora.sync_runs(id) ON DELETE RESTRICT,
  content_hash text NOT NULL,
  dataset jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (term_key, revision)
);
CREATE TABLE planora.catalog_changes (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES planora.sync_runs(id) ON DELETE RESTRICT,
  term_key text NOT NULL REFERENCES planora.terms(key) ON DELETE RESTRICT,
  catalog_key text,
  course_legacy_id text,
  course_code text,
  course_title text,
  section_key text,
  category text NOT NULL CHECK (category IN ('course_added','course_removed','course_modified','section_added','section_removed','section_modified','metadata_modified')),
  before_value jsonb,
  after_value jsonb,
  fields text[] NOT NULL,
  event_key text NOT NULL UNIQUE,
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_history ON planora.catalog_changes(term_key, published_at DESC, id);
CREATE INDEX change_course ON planora.catalog_changes(term_key, course_legacy_id);
-- Internal review reasons, admin identity, diagnostics and proposals are deliberately absent.
CREATE VIEW planora.public_changes AS SELECT
  id, term_key, catalog_key, course_legacy_id, course_code, course_title, section_key,
  category, before_value, after_value, fields, published_at
  FROM planora.catalog_changes;

CREATE TABLE planora.admin_drafts (
  term_key text NOT NULL REFERENCES planora.terms(key) ON DELETE RESTRICT,
  file text NOT NULL CHECK (file IN ('courses.json','sch.json','semester.json','majors.json')),
  content text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (term_key, file)
);
CREATE TABLE planora.admin_catalog_events (
  id uuid PRIMARY KEY,
  term_key text NOT NULL REFERENCES planora.terms(key) ON DELETE RESTRICT,
  admin_id text NOT NULL,
  admin_name text NOT NULL,
  action text NOT NULL,
  file text,
  reason text,
  before_content text,
  after_content text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_catalog_history ON planora.admin_catalog_events(term_key, created_at DESC);

CREATE TABLE planora.email_subscriptions (
  id uuid PRIMARY KEY,
  term_key text NOT NULL REFERENCES planora.terms(key) ON DELETE RESTRICT,
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  status text NOT NULL CHECK (status IN ('pending','active','unsubscribed')),
  token_version uuid NOT NULL,
  consent_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term_key, email)
);
CREATE TABLE planora.subscription_courses (
  subscription_id uuid NOT NULL REFERENCES planora.email_subscriptions(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES planora.courses(id) ON DELETE RESTRICT,
  PRIMARY KEY (subscription_id, course_id)
);
CREATE TABLE planora.notification_deliveries (
  id uuid PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES planora.email_subscriptions(id) ON DELETE CASCADE,
  event_id uuid REFERENCES planora.catalog_changes(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('verification','catalog_change')),
  event_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','mocked','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  first_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  error_code text,
  provider_id text
);
CREATE INDEX notification_queue ON planora.notification_deliveries(status, next_attempt_at);
REVOKE ALL ON ALL TABLES IN SCHEMA planora FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA planora FROM PUBLIC;
