package workouts

// "How much of it was hard" — minutes at or above heart-rate zone 3, the load
// line of the training-progress screen (docs/24 L1). GET /v1/workout-intensity.
//
// # Where the rules come from
//
// They are the phone's, value for value:
// `HelsaKit/Sources/HelsaKit/WorkoutProgress/WorkoutIntensity.swift` (the
// constants, `measuredMaximum`, `secondsAtOrAbove`) and
// `WorkoutProgressViewModel.loadIntensity` (one maximum per session, the
// look-back anchored at now, the window `[start, end ?? now]`). The tests in
// intensity_test.go are the Swift `WorkoutIntensityTests`, case for case. The
// phone and the web drawing two different numbers for the same week, with
// neither saying which one is right, is the failure this copy exists to prevent.
//
// The reasoning behind each rule is in the Swift file and is not repeated in
// full; in one line each:
//
//   - zones from the person's MEASURED maximum, never `220 − age` (docs/31 §4.3);
//   - the SECOND-highest per-session maximum, so one slipping-sensor spike does
//     not set the zones for a year;
//   - 100–230 bpm or it is a sensor error; fewer than five usable sessions and
//     there is no maximum ("three easy walks are not a ceiling");
//   - each sample stands for the time to the next one, capped at 60 s — a minute
//     of silence is missing data, not hard minutes.
//
// # Why the server, when the phone does it on the client
//
// The phone walks `/samples` once per workout, four at a time, and caches the
// answers for the life of the screen. The web's main view is a YEAR of weeks on
// one row: two hundred workouts × up to four pages each is a request storm over
// WireGuard on every visit. Here it is one query.
//
// # Heart rate is matched by time window, not by link
//
// A sample's `workout_id` is set only when the phone sent a
// `workout_source_uuid` for it and the worker could resolve it — a link not
// every reading carries (another app's strap writes heart rate with no workout
// attached), and nothing on the read side may assume it. Both clients' heart-
// rate curves use the window for that reason. So a workout's heart rate
// is every `heartRate` sample with `started_at ≤ ts ≤ ended_at`, from every
// source — exactly the phone's `WorkoutHeartRateLoader` window (it stretches the
// half-open `/samples` window by one second so the closing sample is in, then
// filters `ts ≤ end`).
//
// The per-session MAXIMUM is different on purpose: it is `max_heart_rate` as
// `/workouts` reports it (the linked samples), because that is the field the
// phone feeds into `measuredMaximum`. Taking the window maximum here would make
// the two surfaces disagree about the threshold itself.
//
// # ⚠️ The per-hour source merge (docs/25 F9) does NOT apply
//
// `internal/sourcemerge` exists because several apps write the same STEPS and a
// plain sum multiplies them. Heart rate is not summed: it is a set of discrete
// readings, and this count gives each reading the time until the next one. Two
// sources writing the same workout interleave, so each reading stands for a
// shorter slice and the total does not double — it is still bounded by the
// workout's length. Merging would mean throwing one source away per hour, which
// for an average-type metric the merge itself refuses to do (sourcemerge.go,
// last paragraph). The one residue, said honestly: if a wrist and a strap
// disagree around the threshold, the interleaved readings split the credit
// between them. The phone reads the same unmerged `/samples`, so both surfaces
// share that behaviour.

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

const (
	// Zone3Fraction: five zones at 50–60–70–80–90 % of the measured maximum;
	// "zone 3 or above" is 70 % and up.
	Zone3Fraction = 0.70
	// LookbackDays: long enough to include a hard race, short enough that a
	// maximum from ten years ago does not set today's zones.
	LookbackDays = 365
	// MinimumWorkouts with a usable maximum, or there is no maximum.
	MinimumWorkouts = 5
	// PlausibleMin / PlausibleMax: outside this band a reading is a sensor error.
	PlausibleMin = 100.0
	PlausibleMax = 230.0
	// MaxGap: a longer gap between two readings is not filled.
	MaxGap = 60 * time.Second
	// MaxWindow caps `[from, to)`. The web asks for at most a year of weeks
	// (53 weeks + the partial one); anything much longer is not a screen, it is
	// a scan.
	MaxWindow = 400 * 24 * time.Hour
)

// Maximum is the heart rate the zones are built on.
type Maximum struct {
	BPM float64
	// Workouts is how many sessions with a usable maximum it was taken from.
	Workouts int
}

// Zone3Threshold is the lower edge of zone 3.
func (m Maximum) Zone3Threshold() float64 { return m.BPM * Zone3Fraction }

// MeasuredMaximum is the second-highest plausible per-session maximum, or false
// below MinimumWorkouts of them.
func MeasuredMaximum(maxima []float64) (Maximum, bool) {
	usable := make([]float64, 0, len(maxima))
	for _, v := range maxima {
		if v >= PlausibleMin && v <= PlausibleMax {
			usable = append(usable, v)
		}
	}
	if len(usable) < MinimumWorkouts {
		return Maximum{}, false
	}
	sort.Sort(sort.Reverse(sort.Float64Slice(usable)))
	return Maximum{BPM: usable[1], Workouts: len(usable)}, true
}

// HRPoint is one heart-rate reading.
type HRPoint struct {
	T   time.Time
	BPM float64
}

// SecondsAtOrAbove is the time spent at or above `threshold` within one workout.
// Each reading stands for the time to the next one, capped at MaxGap; the last
// one for the time to `end`, under the same cap.
//
// It returns false when there are fewer than two readings — an unmeasured
// workout, not one with zero hard minutes.
func SecondsAtOrAbove(threshold float64, points []HRPoint, end time.Time) (float64, bool) {
	sorted := append([]HRPoint(nil), points...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].T.Before(sorted[j].T) })
	if len(sorted) < 2 {
		return 0, false
	}
	total := 0.0
	for i, p := range sorted {
		if p.BPM < threshold {
			continue
		}
		next := end
		if i+1 < len(sorted) {
			next = sorted[i+1].T
		}
		total += math.Min(math.Max(0, next.Sub(p.T).Seconds()), MaxGap.Seconds())
	}
	return total, true
}

// SessionMaxima is one maximum per session: the highest `MaxHR` among the
// session's recordings, and nothing for a session none of whose recordings has
// one (`group.all.compactMap(\.maxHeartRate).max()` on the phone).
func SessionMaxima(recs []Recording) []float64 {
	var out []float64
	for _, s := range GroupSessions(recs) {
		best := math.Inf(-1)
		for _, r := range s.All() {
			if r.MaxHR != nil && *r.MaxHR > best {
				best = *r.MaxHR
			}
		}
		if !math.IsInf(best, -1) {
			out = append(out, best)
		}
	}
	return out
}

// Intensity answers GET /v1/workout-intensity for `[from, to)`. `now` anchors
// the look-back and stands in for a missing end, as on the phone.
func (s *Service) Intensity(ctx context.Context, userID uuid.UUID, from, to, now time.Time) (api.WorkoutIntensity, error) {
	out := api.WorkoutIntensity{
		Zone3Fraction:   Zone3Fraction,
		LookbackDays:    LookbackDays,
		MinimumWorkouts: MinimumWorkouts,
		MaxGapSeconds:   float32(MaxGap.Seconds()),
		Workouts:        []api.WorkoutIntensityItem{},
	}

	history, err := s.recordingsSince(ctx, userID, now.Add(-LookbackDays*24*time.Hour), now)
	if err != nil {
		return out, err
	}
	maximum, ok := MeasuredMaximum(SessionMaxima(history))
	if !ok {
		return out, nil
	}
	out.Maximum = &api.HeartRateMaximum{
		Bpm:               float32(maximum.BPM),
		Workouts:          maximum.Workouts,
		Zone3ThresholdBpm: float32(maximum.Zone3Threshold()),
	}

	windows, points, err := s.heartRateByWorkout(ctx, userID, from, to, now)
	if err != nil {
		return out, err
	}
	threshold := maximum.Zone3Threshold()
	for _, w := range windows {
		item := api.WorkoutIntensityItem{Id: openapi_types.UUID(w.id)}
		// A workout whose end is not after its start has no window to read
		// (the phone's `guard end > workout.startedAt`): unmeasured.
		if w.end.After(w.start) {
			if secs, ok := SecondsAtOrAbove(threshold, points[w.id], w.end); ok {
				f := float32(secs)
				item.Seconds = &f
			}
		}
		out.Workouts = append(out.Workouts, item)
	}
	return out, nil
}

// recordingsSince loads every recording that started in `[since, now]`, with
// the same `max_heart_rate` the list endpoint reports.
func (s *Service) recordingsSince(ctx context.Context, userID uuid.UUID, since, now time.Time) ([]Recording, error) {
	q := baseSelect + `
WHERE w.user_id = $1 AND w.started_at >= $2 AND w.started_at <= $3`
	rows, err := s.pool.Query(ctx, q, pgconv.UUID(userID), pgconv.Timestamptz(since), pgconv.Timestamptz(now))
	if err != nil {
		return nil, fmt.Errorf("intensity history query: %w", err)
	}
	defer rows.Close()
	var out []Recording
	for rows.Next() {
		w, start, id, err := scanWorkout(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, recordingOf(w, start, id))
	}
	return out, rows.Err()
}

func recordingOf(w api.Workout, start time.Time, id uuid.UUID) Recording {
	r := Recording{ID: id.String(), Start: start, End: w.EndedAt}
	if w.ActivityType != nil {
		r.ActivityType = *w.ActivityType
	}
	r.EnergyKcal = f32to64(w.TotalEnergyKcal)
	r.DistanceM = f32to64(w.TotalDistanceM)
	r.AvgHR = f32to64(w.AvgHeartRate)
	r.MaxHR = f32to64(w.MaxHeartRate)
	r.HasMetadata = w.Metadata != nil && len(*w.Metadata) > 0
	return r
}

func f32to64(v *float32) *float64 {
	if v == nil {
		return nil
	}
	f := float64(*v)
	return &f
}

type workoutWindow struct {
	id         uuid.UUID
	start, end time.Time
}

// heartRateQuery returns, for every workout that started in `[$2, $3)` and not
// after `$4` (now), its window, then its heart-rate readings — one row per
// workout with NULL reading columns when it has none (the LEFT JOIN), so a
// workout with no heart rate still comes back and is answered with `null`.
//
// ⚠️ The window is `ts BETWEEN started_at AND COALESCE(ended_at, now)` —
// inclusive at both ends, as the phone's loader is. The lateral subquery rides
// the (user_id, data_type, ts) index per workout.
const heartRateQuery = `
SELECT w.id, w.started_at, COALESCE(w.ended_at, $4) AS ends_at, hr.ts, hr.value
FROM workouts w
LEFT JOIN LATERAL (
    SELECT s.ts, s.value
    FROM samples s
    WHERE s.user_id = w.user_id
      AND s.data_type = 'heartRate'
      AND s.value > 0
      AND s.ts >= w.started_at
      AND s.ts <= COALESCE(w.ended_at, $4)
) hr ON true
WHERE w.user_id = $1
  AND w.started_at >= $2 AND w.started_at < $3
  AND w.started_at <= $4
ORDER BY w.started_at, w.id, hr.ts`

func (s *Service) heartRateByWorkout(ctx context.Context, userID uuid.UUID, from, to, now time.Time) ([]workoutWindow, map[uuid.UUID][]HRPoint, error) {
	rows, err := s.pool.Query(ctx, heartRateQuery, pgconv.UUID(userID),
		pgconv.Timestamptz(from), pgconv.Timestamptz(to), pgconv.Timestamptz(now))
	if err != nil {
		return nil, nil, fmt.Errorf("intensity heart-rate query: %w", err)
	}
	defer rows.Close()

	var windows []workoutWindow
	points := map[uuid.UUID][]HRPoint{}
	for rows.Next() {
		var (
			id           pgtype.UUID
			start, endAt pgtype.Timestamptz
			ts           pgtype.Timestamptz
			value        *float64
		)
		if err := rows.Scan(&id, &start, &endAt, &ts, &value); err != nil {
			return nil, nil, fmt.Errorf("scan heart rate: %w", err)
		}
		gid := pgconv.ToUUID(id)
		if len(windows) == 0 || windows[len(windows)-1].id != gid {
			windows = append(windows, workoutWindow{id: gid, start: start.Time, end: endAt.Time})
		}
		if ts.Valid && value != nil {
			points[gid] = append(points[gid], HRPoint{T: ts.Time, BPM: *value})
		}
	}
	return windows, points, rows.Err()
}
