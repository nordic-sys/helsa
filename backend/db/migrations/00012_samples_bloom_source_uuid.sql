-- +goose Up
-- A bloom filter on samples.source_uuid in the compressed history, so a deletion
-- by HealthKit UUID can find its rows without decompressing all of them.
--
-- ⚠️ Why this exists: on 2026-11-09 the phone sent a day's deletions (1,136
-- UUIDs) and the worker's locate read decompressed the user's whole history —
-- four million samples — to answer it. The 4 GB server filled its memory, read
-- the disk at ~1.9 GB/s for an hour and stopped answering, even over ssh. The
-- read now asks a few UUIDs at a time (ingest.locateGroup) and this filter lets
-- each ask skip the batches that cannot hold them.
--
-- ⚠️ orderby loses source_uuid. Timescale's default was 'ts DESC, source_uuid'
-- (from the primary key), and a single-column bloom is not allowed on an orderby
-- column. Nothing reads the batches in source_uuid order.
--
-- The list is explicit, so it also keeps the two blooms Timescale had chosen on
-- its own from the indexes: (ts, source_uuid) for the primary key — an upsert of
-- late data into compressed history checks it — and workout_source_uuid for
-- idx_samples_unlinked_workout. Naming any sparse index replaces the defaults.
ALTER TABLE samples SET (
    timescaledb.orderby      = 'ts DESC',
    timescaledb.sparse_index = 'bloom(source_uuid), bloom(ts, source_uuid), bloom(workout_source_uuid)'
);

-- The setting applies only to chunks compressed from now on; the existing ones
-- are recompressed to carry it. Measured on four million samples (257 chunks):
-- 2.3 s, under 1 GB of memory.
-- +goose StatementBegin
SELECT count(compress_chunk(format('%I.%I', chunk_schema, chunk_name)::regclass, recompress => true))
FROM timescaledb_information.chunks
WHERE hypertable_name = 'samples' AND is_compressed;
-- +goose StatementEnd

-- +goose Down
-- The bloom goes first: the old orderby names source_uuid, which may not carry one.
ALTER TABLE samples RESET (timescaledb.sparse_index);
ALTER TABLE samples SET (timescaledb.orderby = 'ts DESC, source_uuid');
