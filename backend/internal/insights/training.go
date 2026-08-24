// Workout rules: they read the sessions themselves, not the daily aggregates.
//
// Two families live here:
//
//   - **Training load** — the last 7 days against the last 28 (acute/chronic
//     ratio). ⚠️ This is a SPORT bookkeeping figure, not a medical one. The
//     literature it comes from is contested even within sport science, and the
//     wording here therefore never suggests an injury forecast: it says how much
//     you trained this week compared with your own recent normal, and stops.
//   - **Efficiency** — pace at a GIVEN heart rate, within the same activity.
//     Speed on its own only says you went harder; speed at an unchanged heart
//     rate is the interesting one, so the rule refuses to speak when the two
//     windows' heart rates are not comparable.

package insights

import (
	"fmt"
	"math"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

const (
	// --- training load ---

	// The two windows. 7 days is the "acute" load, 28 the "chronic" one, and the
	// chronic window CONTAINS the acute one — that is how the ratio is defined
	// where it comes from, and departing from it would make the number
	// incomparable with anything published.
	AcuteLoadDays   = 7
	ChronicLoadDays = 28
	// Every one of the four chronic weeks must hold at least this many sessions.
	//
	// This is the data minimum that matters here, and it is a subtle one: a week
	// with no workouts is indistinguishable from a week that never reached the
	// server. A rest week and a broken sync produce the same empty set, so a
	// chronic average computed across a gap would be too low, and the ratio
	// against it too high — the rule would announce a "jump" that is really a
	// missing upload. When a week is empty we cannot tell which it was, so we
	// stay silent.
	MinWorkoutsPerChronicWeek = 1
	// And at least this many sessions across the whole chronic window, so the
	// weekly average rests on a habit rather than on four lonely sessions.
	MinChronicWorkouts = 8
	// The acute week needs its own minimum: a single long session is an event,
	// not a week's training.
	MinAcuteWorkouts = 2
	// The ratio worth mentioning. 1.5 is the upper end of what is usually
	// described as a marked increase; below it a week simply varies.
	LoadRatioThreshold = 1.5
	// Absolute floor on the acute load, in minutes. Without it, going from 20 to
	// 40 minutes in a week would be a "2.0 ratio" — arithmetically true, humanly
	// nothing. The same defence the deviation rules use.
	MinAcuteLoadMinutes = 90

	// --- efficiency ---

	// Two consecutive 28-day windows: the recent one against the one before it.
	// A month is about the shortest span in which an endurance change shows at
	// all, and it gives a runner of 2-3 sessions a week enough material.
	EfficiencyWindowDays = 28
	// Sessions needed in EACH window. Four is thin, but demanding more would
	// silence the rule for anyone who trains twice a week — and the heart-rate
	// gate below already rejects the noisiest comparisons.
	MinEfficiencyWorkouts = 4
	// The two windows' average heart rate must be within this many bpm.
	//
	// This is the rule's real condition. "You are faster" is not efficiency if
	// you were also working harder; only pace at a comparable effort says
	// anything. Beyond 5 bpm the comparison is between two different intensities,
	// and the honest answer is silence.
	MaxEfficiencyHRDeltaBpm = 5
	// The change worth reporting: 5% and 5 m/min. 5% of a 10 km/h pace is about
	// 0.5 km/h, which a runner notices; the absolute floor keeps the percentage
	// from turning a stroll into news.
	MinEfficiencyRelChange   = 0.05
	MinEfficiencySpeedDeltaM = 5
	// A session shorter or slower than this tells us nothing about pace: a
	// 4-minute walk to the shop is not a data point about endurance.
	MinEfficiencyWorkoutMinutes = 10
	MinEfficiencyWorkoutMeters  = 1000
)

// --- Rule 6: training load jump ---

// loadMinutes is the load measure: session duration in minutes.
//
// Why not calories, which would weight intensity? Because `total_energy_kcal` is
// optional in the data — plenty of sessions arrive without it — and a load that
// silently ignores every session missing an estimate is worse than a cruder one
// that counts them all. Duration is present whenever the session ended, and the
// sentence says out loud that this is what "load" means here.
func loadMinutes(w Workout) float64 { return w.Duration.Minutes() }

func workoutsBetween(ws []Workout, from, to time.Time) []Workout {
	out := make([]Workout, 0, len(ws))
	for _, w := range ws {
		if !w.Day.Before(from) && w.Day.Before(to) {
			out = append(out, w)
		}
	}
	return out
}

func totalLoad(ws []Workout) float64 {
	var sum float64
	for _, w := range ws {
		sum += loadMinutes(w)
	}
	return sum
}

// trainingLoadJump compares this week's training time with the weekly average of
// the last four weeks.
func trainingLoadJump(in Input, now time.Time) *Result {
	chronicStart := in.Today.AddDate(0, 0, -ChronicLoadDays)
	chronic := workoutsBetween(in.Workouts, chronicStart, in.Today)
	if len(chronic) < MinChronicWorkouts {
		return nil
	}
	// Coverage: each of the four weeks has to hold something, otherwise an empty
	// week may be a sync gap rather than a rest week — see the constant.
	weeks := ChronicLoadDays / AcuteLoadDays
	for i := 0; i < weeks; i++ {
		start := chronicStart.AddDate(0, 0, i*AcuteLoadDays)
		if len(workoutsBetween(chronic, start, start.AddDate(0, 0, AcuteLoadDays))) < MinWorkoutsPerChronicWeek {
			return nil
		}
	}

	acute := workoutsBetween(in.Workouts, in.Today.AddDate(0, 0, -AcuteLoadDays), in.Today)
	if len(acute) < MinAcuteWorkouts {
		return nil
	}
	acuteLoad := totalLoad(acute)
	if acuteLoad < MinAcuteLoadMinutes {
		return nil
	}
	chronicWeekly := totalLoad(chronic) / float64(weeks)
	if chronicWeekly <= 0 {
		return nil
	}
	ratio := acuteLoad / chronicWeekly
	if ratio < LoadRatioThreshold {
		return nil
	}

	title := fmt.Sprintf("Az elmúlt hét edzésideje a szokásos %.1f-szerese", ratio)
	detail := fmt.Sprintf(
		"Az elmúlt %d nap %d edzése összesen %s, a megelőző %d nap heti átlaga %s — ez %.1f-szeres arány. "+
			"Ez sportolói terhelés-követés (akut/krónikus arány) a saját edzésidőidből, "+
			"NEM orvosi állítás és nem sérülés-előrejelzés: annyit mond, hogy ezen a héten "+
			"többet edzettél a magad szokásosánál.",
		AcuteLoadDays, len(acute), fmtVal(acuteLoad, "perc"),
		ChronicLoadDays, fmtVal(chronicWeekly, "perc"), ratio)

	// Deliberately `trend`/`info` rather than `anomaly`/`notice`: dressing a
	// training figure as an anomaly invites reading it as a health warning, which
	// is exactly what the wording above refuses to do.
	return insight("training-load-jump", in.Today, api.Trend, "workoutMinutes", title, detail, api.Info, now,
		map[string]float64{
			"acute": acuteLoad, "chronicWeekly": chronicWeekly, "ratio": ratio,
			// How many sessions the acute window held — the sentence names it.
			"acuteCount": float64(len(acute)),
		})
}

// --- Rule 7: efficiency trend ---

// efficiencyRule is one activity type. Pace only compares within a type — a
// slower cycling month says nothing about running — so each gets its own rule
// and its own identifier.
type efficiencyRule struct {
	activityType string
	// label opens the title, so it is capitalised and carries whatever suffix
	// Hungarian needs ("Futásnál", "Kerékpározásnál").
	label string
}

// The activity types where "pace at a given heart rate" means anything at all.
// A strength session has no distance, and its speed would be zero — which is not
// a slow pace, it is the absence of one.
var efficiencyRules = []efficiencyRule{
	{activityType: "running", label: "Futásnál"},
	{activityType: "cycling", label: "Kerékpározásnál"},
	{activityType: "walking", label: "Gyaloglásnál"},
	{activityType: "swimming", label: "Úszásnál"},
}

// paceSample is one usable session: how fast, at what heart rate.
type paceSample struct {
	speedMPerMin float64
	heartRate    float64
}

// usablePace keeps only the sessions that can answer the question. A workout
// without a distance or without an average heart rate is not a slow workout at
// an unknown pulse — it is simply not evidence here, and it drops out.
func usablePace(ws []Workout, activityType string) []paceSample {
	out := make([]paceSample, 0, len(ws))
	for _, w := range ws {
		if w.ActivityType != activityType || w.DistanceM == nil || w.AvgHeartRate == nil {
			continue
		}
		mins := w.Duration.Minutes()
		if mins < MinEfficiencyWorkoutMinutes || *w.DistanceM < MinEfficiencyWorkoutMeters {
			continue
		}
		out = append(out, paceSample{speedMPerMin: *w.DistanceM / mins, heartRate: *w.AvgHeartRate})
	}
	return out
}

func meanPace(samples []paceSample) (speed, hr float64) {
	sp := make([]float64, 0, len(samples))
	h := make([]float64, 0, len(samples))
	for _, s := range samples {
		sp = append(sp, s.speedMPerMin)
		h = append(h, s.heartRate)
	}
	return mean(sp), mean(h)
}

// kmh converts the internal metres-per-minute to the unit the sentence uses.
func kmh(mPerMin float64) float64 { return mPerMin * 60 / 1000 }

func (r efficiencyRule) eval(in Input, now time.Time) *Result {
	recentStart := in.Today.AddDate(0, 0, -EfficiencyWindowDays)
	prevStart := recentStart.AddDate(0, 0, -EfficiencyWindowDays)

	recent := usablePace(workoutsBetween(in.Workouts, recentStart, in.Today), r.activityType)
	prev := usablePace(workoutsBetween(in.Workouts, prevStart, recentStart), r.activityType)
	if len(recent) < MinEfficiencyWorkouts || len(prev) < MinEfficiencyWorkouts {
		return nil
	}

	recentSpeed, recentHR := meanPace(recent)
	prevSpeed, prevHR := meanPace(prev)
	if math.Abs(recentHR-prevHR) > MaxEfficiencyHRDeltaBpm {
		return nil // different effort: the pace difference would not be about efficiency
	}
	if prevSpeed <= 0 {
		return nil
	}
	delta := recentSpeed - prevSpeed
	rel := delta / prevSpeed
	if math.Abs(rel) < MinEfficiencyRelChange || math.Abs(delta) < MinEfficiencySpeedDeltaM {
		return nil
	}

	word := "gyorsabb"
	if delta < 0 {
		word = "lassabb"
	}
	title := fmt.Sprintf("%s ugyanazon a pulzuson %s vagy, mint egy hónapja", r.label, word)
	detail := fmt.Sprintf(
		"Az elmúlt %d nap %d edzésén az átlagsebesség %s, %s átlagpulzus mellett; "+
			"az azt megelőző %d napon %s, %s mellett (%d edzés). "+
			"A pulzus a két időszakban gyakorlatilag azonos, ezért a tempó eltérése "+
			"nem csak nagyobb erőfeszítés — de sok minden befolyásolja: terep, hőmérséklet, alvás, forma.",
		EfficiencyWindowDays, len(recent), fmtVal(kmh(recentSpeed), "km/h"), fmtVal(recentHR, "bpm"),
		EfficiencyWindowDays, fmtVal(kmh(prevSpeed), "km/h"), fmtVal(prevHR, "bpm"), len(prev))

	return insight("efficiency-trend-"+r.activityType, in.Today, api.Trend, "workoutSpeed", title, detail, api.Info, now,
		map[string]float64{
			"recentSpeed": recentSpeed, "previousSpeed": prevSpeed,
			"recentHr": recentHR, "previousHr": prevHR, "changePct": rel * 100,
			"recentCount": float64(len(recent)), "previousCount": float64(len(prev)),
		})
}
