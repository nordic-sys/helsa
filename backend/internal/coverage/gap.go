package coverage

import (
	"math"
	"sort"
	"time"
)

// Gap detection — **the missing data is information too.**
//
// The state of a row answers "does anything arrive at all". That is not enough,
// because the two silences that matter most look identical there: a metric that
// never had a sensor behind it, and a metric that arrived every single day for
// months and then stopped. Both read as an empty stretch.
//
// This file separates them, and it is the ONE part of the completeness report
// where the server can say exactly what the phone says. Everything else here is
// narrower than the app's screen (permissions do not reach the server), but a
// rhythm is derived from the arrival days themselves — and the arrival days are
// precisely what the server has.
//
// ⚠️ **The thresholds are the app's, value for value** (`Coverage/MetricGap.swift`).
// They are not tuning knobs: a server that asked at 2× the interval while the
// phone asked at 3× would produce two different lists from one set of facts, and
// the user would have to decide which of their own devices to believe. If one
// side changes, the other changes with it in the same commit.
//
// The tone follows the app's as well: this is an observation, not an alarm. A
// flat battery, a holiday, a broken sensor and a deliberate break all look the
// same from here, and nothing in this file guesses which.

// The numbers that decide when a silence becomes worth reporting. **From little
// data we say NOTHING** — every one of these is a floor below which the detector
// stays quiet, and the quiet answer is the correct one, not a degraded one.
const (
	// minIntervals: this many intervals (so this many arrivals PLUS ONE) are needed
	// before we claim the metric has a rhythm at all.
	minIntervals = 6
	// minHistoryDays: …and the arrivals have to span at least this many days. Seven
	// measurements inside a single week describe a week, not a habit.
	minHistoryDays = 14
	// minSilenceDays: a silence shorter than this is never mentioned, whatever the
	// cadence. A daily metric skips a day all the time.
	minSilenceDays = 3
	// silenceFactor: the silence has to be at least this many times the typical
	// interval — three missed occasions, not one.
	silenceFactor = 3.0
	// maxTypicalIntervalDays: a cadence coarser than this is not judged; the window
	// cannot hold enough intervals for the median to mean anything.
	maxTypicalIntervalDays = 30.0
	// abandonedAfterDays: above this the metric is not silent, it is DISCONTINUED,
	// and we stop reporting. The row still carries `last_day`, so nothing is hidden.
	abandonedAfterDays = 90
)

// cadence is the rhythm a metric has settled into, as observed from this user's
// own history.
//
// ⚠️ Derived, never tabulated. A resting heart rate arrives daily and body mass
// does not — but that is a fact about the user's habits, not about the metric.
// Someone who steps on the scale every morning has a daily body mass. A hardcoded
// per-metric cadence table would be wrong for them, and wrong silently.
type cadence struct {
	// typicalIntervalDays is the MEDIAN of the observed intervals — the median and
	// not the mean, because one two-week holiday in an otherwise daily series would
	// drag a mean up by half a day and make the series look sparser than it is.
	typicalIntervalDays float64
	observedIntervals   int
	historyDays         int
}

// silenceThresholdDays: from how many silent days on the metric is worth
// reporting. Rounded UP — at a 2.5-day median the threshold is 8 days rather than
// 7.5, and nobody can be told they are "half a day" overdue for anything.
func (c cadence) silenceThresholdDays() int {
	return int(math.Ceil(math.Max(float64(minSilenceDays), c.typicalIntervalDays*silenceFactor)))
}

// gap is a metric that used to arrive and has stopped.
type gap struct {
	silentDays int
	cadence    cadence
}

// cadenceOf derives the rhythm from the days a measurement arrived on, or reports
// none — which is the ordinary answer, because most metrics never had a rhythm.
//
// The days are CIVIL dates (midnight UTC stand-ins for a day in the user's zone,
// which is how the `::date` cast hands them back), so the arithmetic below is
// plain division: no DST-length day can turn a one-day step into 0.96 of one.
func cadenceOf(days []time.Time) (cadence, bool) {
	arrivals := distinctSortedDays(days)
	if len(arrivals) < 2 {
		return cadence{}, false
	}

	intervals := make([]float64, 0, len(arrivals)-1)
	for i := 1; i < len(arrivals); i++ {
		step := daysBetween(arrivals[i-1], arrivals[i])
		if step <= 0 {
			continue
		}
		intervals = append(intervals, float64(step))
	}
	if len(intervals) < minIntervals {
		// Too few arrivals: whatever we computed would be a guess about a guess.
		return cadence{}, false
	}

	history := daysBetween(arrivals[0], arrivals[len(arrivals)-1])
	if history < minHistoryDays {
		return cadence{}, false
	}

	typical := median(intervals)
	if typical <= 0 || typical > maxTypicalIntervalDays {
		return cadence{}, false
	}
	return cadence{
		typicalIntervalDays: typical,
		observedIntervals:   len(intervals),
		historyDays:         history,
	}, true
}

// gapOf reports the broken rhythm of one metric, measured against `asOf` (the
// last day of the examined window).
//
// ⚠️ The trailing silence is **not** one of the intervals the cadence is built
// from: it is the thing being measured against them. Feeding it back in would let
// every long gap partly justify itself.
func gapOf(days []time.Time, asOf time.Time) (gap, bool) {
	cad, ok := cadenceOf(days)
	if !ok {
		return gap{}, false
	}
	arrivals := distinctSortedDays(days)
	last := arrivals[len(arrivals)-1]

	silent := daysBetween(last, civil(asOf))
	if silent < cad.silenceThresholdDays() || silent > abandonedAfterDays {
		return gap{}, false
	}
	return gap{silentDays: silent, cadence: cad}, true
}

// distinctSortedDays collapses duplicates: a metric measured five times a day
// still arrives on ONE day, and without this the median interval of a
// many-samples-per-day metric would come out as zero.
func distinctSortedDays(days []time.Time) []time.Time {
	seen := make(map[int64]struct{}, len(days))
	out := make([]time.Time, 0, len(days))
	for _, d := range days {
		day := civil(d)
		key := day.Unix()
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, day)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Before(out[j]) })
	return out
}

// civil strips a timestamp down to its calendar day, keeping the date the caller
// already resolved. The result is midnight UTC, which is what the `::date` cast
// produces as well — so the two paths cannot disagree.
func civil(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func daysBetween(from, to time.Time) int {
	return int(math.Round(to.Sub(from).Hours() / 24))
}

// median: the middle value; with an even count the average of the two middle ones.
func median(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	middle := len(sorted) / 2
	if len(sorted)%2 == 1 {
		return sorted[middle]
	}
	return (sorted[middle-1] + sorted[middle]) / 2
}
