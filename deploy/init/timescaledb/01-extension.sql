-- Helsa — TimescaleDB extension bootstrap (runs in the helsa database, on first start)
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() (in core since PG13, but declared to be safe)
