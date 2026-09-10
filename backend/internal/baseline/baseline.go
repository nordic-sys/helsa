// Package baseline computes "your usual range": the middle of the person's own
// last 60 days for a metric, and where the period being looked at stands against
// it (GET /v1/baseline).
//
// ⚠️ **These rules are a SECOND COPY.** The same band is computed on the phone
// (`HelsaKit/Trends/TrendBaseline.swift`), because the app works with no server at
// all (ADR-0004). That duplication cannot be designed away; the silent divergence
// can, and the way this project keeps it honest is the rule that a formula changed
// on one side is carried to the other. A server that computes "your usual"
// differently from the phone is worse than a server that does not compute it at
// all: the two would disagree about the same person while using the same words.
//
// Nothing in this file reads the database. The daily values arrive as the buckets
// of /v1/summary (service.go), so the band rests on exactly the numbers a client
// would have received itself.
package baseline

import (
	"math"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

// The numbers that decide when a band may be drawn at all.
//
// They are gathered here for the same reason insights.Thresholds exists: a data
// minimum written into the middle of a function is a decision nobody can find
// later, and every one of these is a decision about WHEN WE ARE ALLOWED TO SPEAK.
const (
	// ReferenceDays is how far the reference window reaches back, in days.
	//
	// 60, not 30: the band has to describe the usual, and a 30-day reference under a
	// 30-day chart would be the chart describing itself (docs/31 §5).
	ReferenceDays = 60

	// MinReferenceDays is how many of those days must actually carry a measurement.
	//
	// ⚠️ **This is the number that keeps the band honest.** A mean and a deviation
	// can be computed from three days; they would just describe those three days.
	// Fourteen is the same floor the correlation rule uses, and for the same reason:
	// below it the scatter of the sample is mostly the scatter of the sampling.
	MinReferenceDays = 14

	// BandWidth is the half-width of the band, in standard deviations.
	//
	// One, so the band covers roughly the middle two thirds of the usual days. Two
	// would be so wide that nothing ever falls outside it — and a band that is never
	// left says nothing, just as one that is left every other day says nothing.
	BandWidth = 1.0

	// NearCut and FarCut are the cut points of the five-level standing, in standard
	// deviations.
	//
	// Deliberately NOT the edges of the band: the middle level has to be wider than a
	// hair, otherwise the label would flicker between "typical" and "above" on noise
	// alone. ±0.5 and ±1.5 give a broad middle and a narrow extreme.
	NearCut = 0.5
	FarCut  = 1.5
)

// The five levels, spelled as the contract spells them.
//
// ⚠️ **There is no good and no bad here, and there must not be.** More steps than
// usual is probably welcome; a higher resting heart rate than usual is probably
// not; a heavier body mass is whatever the person is working towards. The server
// cannot know which, so it states the position and stops.
//
// Written out as values rather than reached through the generated enum constants:
// the generator names those constants after what OTHER enums the contract happens
// to contain, so the name can change under us while the value cannot.
const (
	WellBelow api.MetricBaselineStanding = "wellBelow"
	Below     api.MetricBaselineStanding = "below"
	Typical   api.MetricBaselineStanding = "typical"
	Above     api.MetricBaselineStanding = "above"
	WellAbove api.MetricBaselineStanding = "wellAbove"
)

// Baseline is the person's own usual for one metric: the middle of the reference
// window and how much those days scattered around it.
type Baseline struct {
	// Mean of the measured reference days.
	Mean float64
	// SD is the SAMPLE standard deviation (n-1) of those days — the same choice, for
	// the same reason, the insight rules make: this is a sample of the usual, not the
	// whole population of it.
	SD float64
	// DayCount is how many reference days actually carried a measurement. A UI names
	// this number, because a band resting on 14 days and one resting on 60 are not
	// equally strong claims.
	DayCount int
}

func (b Baseline) Low() float64  { return b.Mean - b.SD*BandWidth }
func (b Baseline) High() float64 { return b.Mean + b.SD*BandWidth }

// ZScore is how far a value sits from the usual, in standard deviations.
func (b Baseline) ZScore(v float64) float64 { return (v - b.Mean) / b.SD }

// Standing is where a value stands against the band.
func (b Baseline) Standing(v float64) api.MetricBaselineStanding {
	return StandingForZ(b.ZScore(v))
}

// StandingForZ is the level belonging to a z-score. The near cut is inclusive on
// the way out: exactly +0.5 sigma is already "above".
func StandingForZ(z float64) api.MetricBaselineStanding {
	switch {
	case z <= -FarCut:
		return WellBelow
	case z <= -NearCut:
		return Below
	case z < NearCut:
		return Typical
	case z < FarCut:
		return Above
	default:
		return WellAbove
	}
}

// Make is the baseline of the measured reference days.
//
// It returns nil when there is not enough measured data, or when every measured
// day carried the identical value. A zero-width band is not a band — it is a line
// pretending to be one, and every single day would land outside it.
func Make(values []float64) *Baseline {
	if len(values) < MinReferenceDays {
		return nil
	}
	var sum float64
	for _, v := range values {
		sum += v
	}
	mean := sum / float64(len(values))

	var variance float64
	for _, v := range values {
		variance += (v - mean) * (v - mean)
	}
	variance /= float64(len(values) - 1)
	sd := math.Sqrt(variance)

	if !(sd > 0) || math.IsInf(sd, 0) || math.IsInf(mean, 0) || math.IsNaN(mean) {
		return nil
	}
	return &Baseline{Mean: mean, SD: sd, DayCount: len(values)}
}

// Average is the period's average measured day — the quantity a standing is taken
// of.
//
// ⚠️ **Not the total.** For a summed metric the total of a 7-day window and the
// total of a 30-day one are not comparable at all, while the average day of each
// is; for an averaged metric the two are the same number. This is the same
// quantity the band itself is built from, so all of it is in one unit.
//
// The second return value is false when the period holds no measurement at all —
// which is not a zero, and has no standing.
func Average(values []float64) (float64, bool) {
	if len(values) == 0 {
		return 0, false
	}
	var sum float64
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values)), true
}

// Anchor is the day the reference window ends on.
//
// ⚠️ **The window is anchored at the END OF THE PERIOD BEING LOOKED AT, not at
// today.** Browsing back to a month in 2024 and being told it was "above your
// usual" would otherwise mean "above what is usual for you NOW" — a comparison
// across two years wearing the words of one. Anchored here it reads as it should:
// usual *at the time*.
//
// periodEnd is the exclusive end of the period, as summary.Window returns it. A
// period that has not finished yet is anchored to today; there is nothing to
// measure beyond that.
func Anchor(periodEnd, now time.Time, loc *time.Location) time.Time {
	last := startOfDay(periodEnd.Add(-time.Nanosecond), loc)
	today := startOfDay(now, loc)
	if last.Before(today) {
		return last
	}
	return today
}

// ReferenceWindow is the day span the band is computed over: ReferenceDays days
// ending on the anchor day, INCLUSIVE at both ends (the shape /summary's from/to
// parameters take).
func ReferenceWindow(anchor time.Time, loc *time.Location) (from, to time.Time) {
	to = startOfDay(anchor, loc)
	from = to.AddDate(0, 0, -(ReferenceDays - 1))
	return from, to
}

func startOfDay(t time.Time, loc *time.Location) time.Time {
	d := t.In(loc)
	return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, loc)
}
