-- Helsa — the application's own database role (helsa_app). Idempotent.
--
-- The api, the worker and the token tool connect as helsa_app: a LOGIN role that
-- is not a superuser, owns nothing, and can read and write rows in Helsa's tables
-- and nothing else. The owner (POSTGRES_USER, the superuser the image creates)
-- keeps owning the schema and keeps running the migrations. A bug or an injected
-- statement in the application then fails as a permission error instead of
-- dropping a table, reading another database, or running a program on the host
-- (a superuser can: COPY … TO PROGRAM).
--
-- This one file runs in three places, always as the owner:
--   1. a FRESH install — the Postgres entrypoint runs it once, on first start,
--      before any table exists; the default privileges below then cover the
--      tables the first `make prod-migrate` creates;
--   2. an EXISTING install — `make prod-app-role` (the `app-role` tools service);
--   3. after every `make prod-migrate`, to put the grants back in step with what
--      the migration created.
--
-- The password comes from the HELSA_APP_DB_PASSWORD environment variable through
-- psql's \getenv, so it is never on a command line (`ps` shows argument lists, and
-- a container's processes are visible from the host). Statement logging is turned
-- off for this session, so it does not land in the server log either — not even
-- when a statement fails (log_min_error_statement).
--
-- Without HELSA_APP_DB_PASSWORD:
--   - and HELSA_APP_ROLE_REQUIRED set (the `app-role` service sets it): an error;
--   - and helsa_app already exists: its grants are refreshed, its password kept;
--   - otherwise nothing happens — local development connects as the owner.

\set ON_ERROR_STOP on
\set QUIET on

-- Keep the password out of the server log. All three are superuser-settable, and
-- this script always runs as the owner (a superuser in the -ha image).
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET log_min_duration_statement = -1;

\set app_password ''
\set app_role_required ''
\getenv app_password HELSA_APP_DB_PASSWORD
\getenv app_role_required HELSA_APP_ROLE_REQUIRED

SELECT (:'app_password' <> '')                                   AS have_password,
       (:'app_role_required' <> '')                              AS role_required,
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helsa_app') AS role_exists
\gset

\if :have_password
\elif :role_required
  DO $$ BEGIN
    RAISE EXCEPTION 'HELSA_APP_DB_PASSWORD is empty'
      USING HINT = 'Add HELSA_APP_DB_PASSWORD=$(openssl rand -hex 32) to deploy/.env, then run this again.';
  END $$;
\elif :role_exists
  \echo 'helsa_app: HELSA_APP_DB_PASSWORD is not set — keeping its password, refreshing its grants.'
\else
  \echo 'helsa_app: HELSA_APP_DB_PASSWORD is not set — no application role (local development connects as the owner).'
  \quit
\endif

BEGIN;

\if :role_exists
\else
  CREATE ROLE helsa_app;
\endif

-- Every attribute spelled out, every time: a role that somebody once made a
-- superuser "just to get it working" is put back here, not trusted.
ALTER ROLE helsa_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;

\if :have_password
  ALTER ROLE helsa_app WITH PASSWORD :'app_password';
\endif
\unset app_password

-- A membership would hand helsa_app every right of the role it is a member of —
-- the owner's included. Refuse rather than revoke silently: somebody made it on
-- purpose, and should hear about it.
DO $$
DECLARE granted text;
BEGIN
  SELECT string_agg(r.rolname, ', ') INTO granted
  FROM pg_auth_members m
  JOIN pg_roles r ON r.oid = m.roleid
  WHERE m.member = 'helsa_app'::regrole;
  IF granted IS NOT NULL THEN
    RAISE EXCEPTION 'helsa_app is a member of: % — it would inherit their rights', granted
      USING HINT = 'REVOKE <role> FROM helsa_app; then run this again.';
  END IF;
END $$;

DO $grants$
DECLARE
  rel record;
BEGIN
  -- PostgreSQL hands CONNECT and TEMPORARY on every new database to PUBLIC. Here
  -- CONNECT goes to helsa_app by name, and nobody but the owner gets TEMPORARY:
  -- a temporary table is DDL too, and the application never makes one.
  EXECUTE format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM helsa_app', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO helsa_app', current_database());
  GRANT USAGE ON SCHEMA public TO helsa_app;
  -- PostgreSQL 15+ already withholds CREATE on public from PUBLIC; said here so an
  -- install that came up through an older major version gets the same answer.
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  REVOKE CREATE ON SCHEMA public FROM helsa_app;

  -- Rows in, rows out: tables (the samples hypertable included — Timescale
  -- carries a hypertable's grants to its chunks and compressed chunks).
  -- Views and continuous aggregates: read only.
  FOR rel IN
    SELECT c.oid::regclass AS name, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND c.relname <> 'goose_db_version'
  LOOP
    -- ⛔ The raw samples and the aggregates over them are NOT the API's: it reads
    -- them through my_samples, which shows only the request's user (00014, docs/36
    -- §4.8.8). TimescaleDB allows no row security on the compressed hypertable, so
    -- this missing grant IS the database's line for samples. Revoked every run, so
    -- an install that had the old grants loses them.
    IF rel.name::text IN ('samples', 'samples_hourly', 'samples_daily', 'samples_weekly') THEN
      EXECUTE format('REVOKE ALL ON TABLE %s FROM helsa_app', rel.name);
      CONTINUE;
    END IF;
    IF rel.relkind IN ('r', 'p') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO helsa_app', rel.name);
    ELSE
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE %s FROM helsa_app', rel.name);
      EXECUTE format('GRANT SELECT ON TABLE %s TO helsa_app', rel.name);
    END IF;
  END LOOP;

  -- Nothing beyond DML, even if an earlier hand-made grant said otherwise.
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM helsa_app;

  -- The migration tool's bookkeeping is the owner's business alone: the
  -- application has no reason to read it and no right to rewrite it.
  IF to_regclass('public.goose_db_version') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.goose_db_version FROM helsa_app;
  END IF;

  -- No table uses a sequence today (UUID keys); a future SERIAL/IDENTITY will.
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO helsa_app;

  -- What the NEXT migrations create. Only objects created BY the owner are
  -- covered — which is every object, as long as migrations run as the owner.
  -- ⚠️ Default privileges cannot tell a view from a table: a future view gets
  -- INSERT/UPDATE/DELETE too until the next run of this file (which follows every
  -- `make prod-migrate`) narrows it to SELECT.
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
                    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO helsa_app', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
                    GRANT USAGE, SELECT ON SEQUENCES TO helsa_app', current_user);
END $grants$;

COMMIT;

\echo 'helsa_app: role and grants are in place.'

-- ===========================================================================
-- helsa_worker — the worker's and the token tool's role (docs/36 §4.8.8)
-- ===========================================================================
--
-- The API reads through policies and the my_samples view; the worker WRITES the
-- raw tables — ingest, HealthKit deletions, the Home Assistant publisher, and later
-- the member-deletion job — and the token tool registers tokens for any user.
--
-- ⚠️ BYPASSRLS, deliberately. Row-level security here is the second line on the
-- API's READ path, against a forgotten `WHERE user_id = …` in a request handler.
-- The worker takes no request input but the queued message, whose user the API set
-- from the verified token, and every write it makes is keyed on that user; and its
-- bulk route insert is a COPY, which PostgreSQL refuses under row security. The
-- view still filters on helsa.user_id for it too, so where it READS through
-- my_samples (the Home Assistant sums) it reads as one user at a time.
--
-- Password: HELSA_WORKER_DB_PASSWORD, through \getenv like the one above. Without it
-- the same three cases as for helsa_app.

\set worker_password ''
\getenv worker_password HELSA_WORKER_DB_PASSWORD

SELECT (:'worker_password' <> '')                                   AS have_worker_password,
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helsa_worker') AS worker_exists
\gset

\if :have_worker_password
\elif :role_required
  DO $$ BEGIN
    RAISE EXCEPTION 'HELSA_WORKER_DB_PASSWORD is empty'
      USING HINT = 'Add HELSA_WORKER_DB_PASSWORD=$(openssl rand -hex 32) to deploy/.env, then run this again.';
  END $$;
\elif :worker_exists
  \echo 'helsa_worker: HELSA_WORKER_DB_PASSWORD is not set — keeping its password, refreshing its grants.'
\else
  \echo 'helsa_worker: HELSA_WORKER_DB_PASSWORD is not set — no worker role (local development connects as the owner).'
  \quit
\endif

BEGIN;

\if :worker_exists
\else
  CREATE ROLE helsa_worker;
\endif

ALTER ROLE helsa_worker WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS INHERIT;

\if :have_worker_password
  ALTER ROLE helsa_worker WITH PASSWORD :'worker_password';
\endif
\unset worker_password

DO $$
DECLARE granted text;
BEGIN
  SELECT string_agg(r.rolname, ', ') INTO granted
  FROM pg_auth_members m
  JOIN pg_roles r ON r.oid = m.roleid
  WHERE m.member = 'helsa_worker'::regrole;
  IF granted IS NOT NULL THEN
    RAISE EXCEPTION 'helsa_worker is a member of: % — it would inherit their rights', granted
      USING HINT = 'REVOKE <role> FROM helsa_worker; then run this again.';
  END IF;
END $$;

DO $grants$
DECLARE
  rel record;
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM helsa_worker', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO helsa_worker', current_database());
  GRANT USAGE ON SCHEMA public TO helsa_worker;
  REVOKE CREATE ON SCHEMA public FROM helsa_worker;
  FOR rel IN
    SELECT c.oid::regclass AS name, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND c.relname <> 'goose_db_version'
  LOOP
    IF rel.relkind IN ('r', 'p') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO helsa_worker', rel.name);
    ELSE
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE %s FROM helsa_worker', rel.name);
      EXECUTE format('GRANT SELECT ON TABLE %s TO helsa_worker', rel.name);
    END IF;
  END LOOP;
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM helsa_worker;
  IF to_regclass('public.goose_db_version') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.goose_db_version FROM helsa_worker;
  END IF;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO helsa_worker;
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
                    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO helsa_worker', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
                    GRANT USAGE, SELECT ON SEQUENCES TO helsa_worker', current_user);
END $grants$;

COMMIT;

\echo 'helsa_worker: role and grants are in place.'
