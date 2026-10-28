-- Synthetic data for the RLS measurement (docs/36 §4.8.5). NOT real data: two
-- invented users, invented values. Run against the throwaway database helsa_rls
-- only (see README.md), as the owner.
--
-- Shape: user A ≈ 3.5 million samples, user B ≈ 0.5 million, both spread over
-- three years and twenty data types, two sources each — roughly a long-time user
-- and a newer household member. Older than 30 days is compressed, exactly as the
-- compression policy (00002) would leave it.
\set ON_ERROR_STOP on
\timing on

INSERT INTO users (id, apple_sub, role) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'bench-a', 'admin'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'bench-b', 'member')
ON CONFLICT DO NOTHING;

-- The twenty types and the spacing: A every 27 s → 3.5 M over ~3 years; B every 189 s.
INSERT INTO samples (user_id, ts, data_type, value, unit, source_uuid, source_bundle)
SELECT 'aaaaaaaa-0000-0000-0000-00000000000a',
       now() - (i * interval '27 seconds'),
       (ARRAY['stepCount','heartRate','activeEnergyBurned','basalEnergyBurned','distanceWalkingRunning',
              'flightsClimbed','restingHeartRate','heartRateVariabilitySDNN','respiratoryRate','oxygenSaturation',
              'walkingSpeed','walkingStepLength','appleExerciseTime','appleStandTime','environmentalAudioExposure',
              'headphoneAudioExposure','walkingHeartRateAverage','vo2Max','bodyMass','dietaryWater'])[1 + i % 20],
       (random() * 120)::double precision, 'count', 'a-' || i,
       CASE WHEN i % 3 = 0 THEN 'com.apple.health.watch' ELSE 'com.apple.health.phone' END
FROM generate_series(1, 3500000) AS i;

INSERT INTO samples (user_id, ts, data_type, value, unit, source_uuid, source_bundle)
SELECT 'bbbbbbbb-0000-0000-0000-00000000000b',
       now() - (i * interval '189 seconds'),
       (ARRAY['stepCount','heartRate','activeEnergyBurned','basalEnergyBurned','distanceWalkingRunning',
              'flightsClimbed','restingHeartRate','heartRateVariabilitySDNN','respiratoryRate','oxygenSaturation',
              'walkingSpeed','walkingStepLength','appleExerciseTime','appleStandTime','environmentalAudioExposure',
              'headphoneAudioExposure','walkingHeartRateAverage','vo2Max','bodyMass','dietaryWater'])[1 + i % 20],
       (random() * 120)::double precision, 'count', 'b-' || i,
       CASE WHEN i % 2 = 0 THEN 'com.apple.health.watch' ELSE 'com.apple.health.phone' END
FROM generate_series(1, 500000) AS i;

-- Small tables: workouts (≈ one a day for A) and sleep (≈ ten segments a night).
INSERT INTO workouts (user_id, source_uuid, activity_type, started_at, ended_at)
SELECT 'aaaaaaaa-0000-0000-0000-00000000000a', 'a-wk-' || i, 'running',
       now() - (i * interval '1 day'), now() - (i * interval '1 day') + interval '40 minutes'
FROM generate_series(1, 1100) AS i;
INSERT INTO workouts (user_id, source_uuid, activity_type, started_at, ended_at)
SELECT 'bbbbbbbb-0000-0000-0000-00000000000b', 'b-wk-' || i, 'walking',
       now() - (i * interval '3 days'), now() - (i * interval '3 days') + interval '30 minutes'
FROM generate_series(1, 300) AS i;
INSERT INTO sleep_segments (user_id, source_uuid, started_at, ended_at, stage)
SELECT u, left(u::text, 1) || '-sl-' || i,
       now() - (i * interval '144 minutes'), now() - (i * interval '144 minutes') + interval '40 minutes', 'asleepCore'
FROM (VALUES ('aaaaaaaa-0000-0000-0000-00000000000a'::uuid), ('bbbbbbbb-0000-0000-0000-00000000000b'::uuid)) v(u),
     generate_series(1, 11000) AS i;

SELECT count(*) AS compressed FROM (
  SELECT compress_chunk(c, if_not_compressed => true) FROM show_chunks('samples', older_than => interval '30 days') c
) x;
ANALYZE;
SELECT user_id, count(*) FROM samples GROUP BY 1;
