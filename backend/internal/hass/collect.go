package hass

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nordic-sys/helsa/backend/internal/metrics"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// errNoTarget: there is nobody to publish for. Not a failure — a brand-new
// installation is in this state until the first sync.
var errNoTarget = errors.New("no user to publish for")

// target is who we publish about, and in whose timezone "today" is cut.
type target struct {
	userID uuid.UUID
	loc    *time.Location
}

// resolveTarget picks the user whose numbers go on the broker.
//
// ⚠️ Helsa is a single-user system, but the schema is not: `users` can hold more
// than one row (a second Apple account, a leftover smoke-test user). Publishing
// "the first" of several would silently put somebody else's health data on a
// broker that the whole house can read. So: exactly one user, or an explicit
// HELSA_MQTT_USER_ID. Ambiguity means we publish nothing.
func resolveTarget(ctx context.Context, pool *pgxpool.Pool, pinned string) (target, error) {
	if pinned != "" {
		id, err := uuid.Parse(pinned)
		if err != nil {
			return target{}, fmt.Errorf("HELSA_MQTT_USER_ID is not a uuid: %w", err)
		}
		var tz string
		err = pool.QueryRow(ctx, `SELECT time_zone FROM users WHERE id = $1`, pgconv.UUID(id)).Scan(&tz)
		if errors.Is(err, pgx.ErrNoRows) {
			return target{}, fmt.Errorf("HELSA_MQTT_USER_ID %s: %w", pinned, errNoTarget)
		}
		if err != nil {
			return target{}, fmt.Errorf("look up pinned user: %w", err)
		}
		return target{userID: id, loc: location(tz)}, nil
	}

	rows, err := pool.Query(ctx, `SELECT id, time_zone FROM users ORDER BY created_at, id LIMIT 2`)
	if err != nil {
		return target{}, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	var found []target
	for rows.Next() {
		var id pgtype.UUID
		var tz string
		if err := rows.Scan(&id, &tz); err != nil {
			return target{}, fmt.Errorf("scan user: %w", err)
		}
		found = append(found, target{userID: pgconv.ToUUID(id), loc: location(tz)})
	}
	if err := rows.Err(); err != nil {
		return target{}, err
	}

	switch len(found) {
	case 0:
		return target{}, errNoTarget
	case 1:
		return found[0], nil
	default:
		return target{}, fmt.Errorf("%d users in the database: set HELSA_MQTT_USER_ID to say which one to publish", len(found))
	}
}

func location(tz string) *time.Location {
	if loc, err := time.LoadLocation(tz); err == nil {
		return loc
	}
	return time.UTC
}

// Snapshot is one round of daily numbers. Every field is a pointer because
// "missing" and "zero" are different statements, and Home Assistant can represent
// both — see stateValue.
type Snapshot struct {
	Steps            *float64
	ActiveEnergy     *float64
	SleepHours       *float64
	RestingHeartRate *float64
	RingsClosed      *float64
}

// value returns the number belonging to a topic suffix.
func (s Snapshot) value(suffix string) *float64 {
	switch suffix {
	case "daily/steps":
		return s.Steps
	case "daily/active_energy":
		return s.ActiveEnergy
	case "daily/sleep_hours":
		return s.SleepHours
	case "daily/resting_heart_rate":
		return s.RestingHeartRate
	case "daily/rings_closed":
		return s.RingsClosed
	}
	return nil
}

// collectDaily gathers today's summary in the user's timezone.
func collectDaily(ctx context.Context, pool *pgxpool.Pool, t target, now time.Time) (Snapshot, error) {
	local := now.In(t.loc)
	dayStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, t.loc)
	dayEnd := dayStart.AddDate(0, 0, 1)

	var snap Snapshot
	sums, err := dailyMetrics(ctx, pool, t.userID, dayStart, dayEnd)
	if err != nil {
		return Snapshot{}, err
	}
	snap.Steps = sums["stepCount"]
	snap.ActiveEnergy = sums["activeEnergy"]
	snap.RestingHeartRate = sums["restingHeartRate"]

	snap.SleepHours, err = lastNightHours(ctx, pool, t.userID, now)
	if err != nil {
		return Snapshot{}, err
	}
	snap.RingsClosed, err = ringsClosed(ctx, pool, t.userID, dayStart)
	if err != nil {
		return Snapshot{}, err
	}
	return snap, nil
}

// dailyMetrics runs the same aggregation the /v1/summary endpoint does, over one
// day and a fixed handful of types.
//
// It goes through metrics.Meta for BOTH the sum-vs-average choice and the wire
// scaling, so that a value published to Home Assistant cannot disagree with the
// same value on the dashboard. That divergence is exactly the bug the metrics
// package exists to prevent.
func dailyMetrics(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, from, to time.Time) (map[string]*float64, error) {
	const q = `
SELECT data_type, sum(value) AS sum_value, avg(value) AS avg_value
FROM samples
WHERE user_id = $1
  AND data_type = ANY($2::text[])
  AND ts >= $3 AND ts < $4
GROUP BY data_type`

	wanted := []string{"stepCount", "activeEnergy", "restingHeartRate"}
	rows, err := pool.Query(ctx, q, pgconv.UUID(userID), wanted,
		pgconv.Timestamptz(from), pgconv.Timestamptz(to))
	if err != nil {
		return nil, fmt.Errorf("daily aggregation: %w", err)
	}
	defer rows.Close()

	out := map[string]*float64{}
	for rows.Next() {
		var dataType string
		var sum, avg *float64
		if err := rows.Scan(&dataType, &sum, &avg); err != nil {
			return nil, fmt.Errorf("scan aggregate: %w", err)
		}
		chosen := avg
		if metrics.Meta(dataType).Agg == metrics.Sum {
			chosen = sum
		}
		out[dataType] = metrics.ToWirePtr(dataType, chosen)
	}
	return out, rows.Err()
}

// sleepGap: a break longer than this ends a sleep session. Deliberately the same
// three hours the web dashboard uses (web/src/lib/sleep.ts) — if the two drifted
// apart, "last night" would mean one thing on the dashboard and another in Home
// Assistant.
const sleepGap = 3 * time.Hour

// sleepSegment is the minimum a night needs.
type sleepSegment struct {
	start, end time.Time
	stage      string
}

// lastNightHours returns the length of the most recent sleep SESSION, in hours.
//
// Not "sleep on today's date": sleep crosses midnight, so a calendar-day cut
// would split one night into two half-nights on two different days. Sessions are
// threaded by proximity instead, exactly as on the dashboard.
func lastNightHours(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, now time.Time) (*float64, error) {
	const q = `
SELECT started_at, ended_at, stage
FROM sleep_segments
WHERE user_id = $1 AND ended_at >= $2 AND started_at <= $3
ORDER BY started_at`

	// 36 hours back: enough to hold last night plus a late nap, without dragging in
	// the night before.
	rows, err := pool.Query(ctx, q, pgconv.UUID(userID),
		pgconv.Timestamptz(now.Add(-36*time.Hour)), pgconv.Timestamptz(now))
	if err != nil {
		return nil, fmt.Errorf("sleep segments: %w", err)
	}
	defer rows.Close()

	var segs []sleepSegment
	for rows.Next() {
		var s sleepSegment
		if err := rows.Scan(&s.start, &s.end, &s.stage); err != nil {
			return nil, fmt.Errorf("scan sleep segment: %w", err)
		}
		segs = append(segs, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return latestSessionHours(segs), nil
}

// latestSessionHours is the pure half of lastNightHours: group into sessions,
// take the latest, and sum the time actually spent asleep.
func latestSessionHours(segs []sleepSegment) *float64 {
	if len(segs) == 0 {
		return nil
	}
	sort.Slice(segs, func(i, j int) bool { return segs[i].start.Before(segs[j].start) })

	var session []sleepSegment
	var lastEnd time.Time
	for _, s := range segs {
		if len(session) > 0 && s.start.Sub(lastEnd) > sleepGap {
			session = nil
			lastEnd = time.Time{}
		}
		session = append(session, s)
		if s.end.After(lastEnd) {
			lastEnd = s.end
		}
	}

	// Time asleep, not time in bed: of the contract's five stages (inBed,
	// asleepCore, asleepDeep, asleepREM, awake) two are wakefulness, and counting
	// them would report eight hours of sleep for a night spent staring at the
	// ceiling. Excluding rather than listing the asleep stages is deliberate: a new
	// HealthKit sleep stage would then count as sleep, which is the safer default.
	var asleep time.Duration
	for _, s := range session {
		if s.stage == "awake" || s.stage == "inBed" {
			continue
		}
		if d := s.end.Sub(s.start); d > 0 {
			asleep += d
		}
	}
	if asleep == 0 {
		return nil
	}
	h := asleep.Hours()
	return &h
}

// ringsClosed counts how many of today's three Apple activity rings are closed.
func ringsClosed(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, day time.Time) (*float64, error) {
	const q = `
SELECT active_energy, active_energy_goal, exercise_minutes, exercise_goal, stand_hours, stand_goal
FROM activity_summary
WHERE user_id = $1 AND day = $2`

	var energy, energyGoal, exercise, exerciseGoal, stand, standGoal *float64
	err := pool.QueryRow(ctx, q, pgconv.UUID(userID), pgconv.Date(day)).
		Scan(&energy, &energyGoal, &exercise, &exerciseGoal, &stand, &standGoal)
	if errors.Is(err, pgx.ErrNoRows) {
		// No activity row for today yet. Missing, not "zero rings closed".
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("activity summary: %w", err)
	}
	n := countClosed(
		ringPair{energy, energyGoal}, ringPair{exercise, exerciseGoal}, ringPair{stand, standGoal},
	)
	return n, nil
}

type ringPair struct{ value, goal *float64 }

// countClosed is the pure half of ringsClosed.
//
// ⚠️ A ring with no goal is not a closed ring and not an open one — it is
// unknown, and the whole count then means nothing. Reporting "0 of 3 closed" to
// somebody who simply never set a Move goal would be a lie the automation would
// act on.
func countClosed(rings ...ringPair) *float64 {
	var closed float64
	for _, r := range rings {
		if r.goal == nil || *r.goal <= 0 {
			return nil
		}
		if r.value != nil && *r.value >= *r.goal {
			closed++
		}
	}
	return &closed
}

// Freshness is the dead man's switch payload: how old the newest data is.
type Freshness struct {
	// Hours is nil when nothing has ever arrived.
	Hours *float64
	// Newest is the timestamp the age was computed from; zero when there is none.
	Newest time.Time
	// FutureSkew is by how much the newest data is dated AHEAD of now.
	FutureSkew time.Duration
}

// collectFreshness computes the age of the newest data.
//
// The newer of two things counts: the last sample and the last check-in of the
// UPLOADING device. Ingest is itself a heartbeat, but a quiet day with no new
// HealthKit data is not a fault, so the device check-in has to count too.
//
// ⚠️ Only `ios` devices. The iPad and the Mac also check in while uploading
// nothing (the phone is the only uploader), so counting them would keep this
// looking healthy through weeks of a phone that had stopped syncing — precisely
// the failure the metric exists to catch.
func collectFreshness(ctx context.Context, pool *pgxpool.Pool, t target, now time.Time) (Freshness, error) {
	const q = `
SELECT GREATEST(
         COALESCE((SELECT max(ts) FROM samples WHERE user_id = $1), 'epoch'::timestamptz),
         COALESCE((SELECT max(last_seen_at) FROM devices WHERE user_id = $1 AND platform = 'ios'), 'epoch'::timestamptz)
       )`
	var newest time.Time
	if err := pool.QueryRow(ctx, q, pgconv.UUID(t.userID)).Scan(&newest); err != nil {
		return Freshness{}, fmt.Errorf("freshness query: %w", err)
	}
	return freshnessFrom(newest, now), nil
}

// epochYear: anything at or before this is the COALESCE fallback, i.e. "never".
const epochYear = 1971

// freshnessFrom is the pure half of collectFreshness.
func freshnessFrom(newest, now time.Time) Freshness {
	if newest.IsZero() || newest.Year() < epochYear {
		return Freshness{}
	}
	age := now.Sub(newest)
	f := Freshness{Newest: newest}

	// ⚠️ DATA FROM THE FUTURE. A wrong clock on the phone, a mishandled timezone in
	// the ingest, or seeded demo data can date a sample ahead of now. The age then
	// goes negative — and a negative age never crosses an "above 12 hours"
	// threshold, so the alert is silently switched off for as long as the skew
	// lasts. Clamp it to zero.
	//
	// The clamp must not hide the cause, though: for the duration of the skew the
	// real staleness is hidden too (data dated two hours ahead swallows two hours of
	// standstill). That is what the `future_skew_s` attribute is for.
	if age < 0 {
		f.FutureSkew = -age
		age = 0
	}
	h := age.Hours()
	f.Hours = &h
	return f
}
