// Rule 10: **social jetlag** — the standing difference between the weekday and
// the weekend sleep MIDPOINT, read as a habit that holds week after week.
//
// # What social jetlag is
//
// The name comes from chronobiology (Wittmann and Roenneberg): the difference
// between the middle of the night on free days and on work days. Someone whose
// sleep centres on 03:00 during the week and on 05:00 at the weekend is, in the
// body-clock sense, flying two time zones east every Monday morning and back again
// on Friday night. It is measurable from nothing but bedtimes, it is well
// documented, and no consumer app shows it.
//
// # How this differs from `sleep-midpoint-weekend`, which looks like the same thing
//
// It does look like the same thing, and the honest answer is that they measure the
// same quantity with different instruments — so it is worth saying exactly what
// each is for.
//
//   - `sleep-midpoint-weekend` (a weekendRule) pools every free night and every
//     work night of ONE 28-day window and compares the two averages, in either
//     direction, from an hour up. It answers "how did last month's weekends
//     differ?", and it will answer it on the strength of four weekends — one
//     holiday, one visit, one week of night shifts can carry it.
//   - This rule pairs each week's free nights with THAT SAME WEEK's work nights,
//     takes the median across eight weeks, and requires most of those weeks to
//     agree. It answers a different question: "is this a standing weekly habit?" —
//     which is the question the term social jetlag is actually about, since a body
//     clock is dragged by what repeats, not by one late Saturday.
//
// Both can fire on the same data, and when they do they do not contradict each
// other: the pooled shift is large and the weekly one is sustained. That is why
// this rule waits until 90 minutes rather than the literature's usual 60 — at an
// hour it would only be restating its neighbour in different words, and a second
// card that adds nothing is a card that costs the first one its attention.
//
// # It says what it saw
//
// The comparison to time zones is arithmetic, not medicine: one hour of shift, one
// zone. The text makes the shift and its consistency visible and stops there — the
// literature that links social jetlag to outcomes is about populations, and this
// app has exactly one user.

package insights

import (
	"fmt"
	"math"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

const (
	// Eight weeks. Long enough for "week after week" to mean something, short
	// enough that a habit which has since changed does not still dominate the
	// median.
	SocialJetlagWindowDays = 56
	// Weeks in which BOTH kinds of night were measured. Six out of eight — so two
	// weeks of travel, illness or a flat watch battery are tolerated.
	MinSocialJetlagWeeks = 6
	// What a single week needs before it may contribute: at least one free night
	// and at least three work nights. A week with a single work night would let
	// one Tuesday stand for the whole working week.
	MinSocialJetlagFreeNightsPerWeek = 1
	MinSocialJetlagWorkNightsPerWeek = 3

	// The median weekly shift worth a sentence, in minutes.
	//
	// 90, not the literature's customary 60, and the reason is not statistical: at
	// 60 the neighbouring `sleep-midpoint-weekend` already says the same thing
	// about the same nights. This rule earns its place only where it can say
	// something that one cannot — a shift big enough to be worth naming as a
	// time-zone difference, and sustained.
	MinSocialJetlagShiftMinutes = 90.0
	// A week "agrees" if its own shift reaches half an hour. Required of two
	// thirds of the usable weeks, so the median cannot be produced by three
	// enormous weekends and five weeks of nothing — which would be an occasional
	// habit, not a standing one.
	SocialJetlagAgreementMinutes = 30.0
)

// socialJetlag is the median weekly difference between the free-night and
// work-night sleep midpoints.
func socialJetlag(in Input, now time.Time) *Result {
	if len(in.SleepNights) == 0 {
		return nil
	}

	weekLength := TrendWindowDays
	weekCount := SocialJetlagWindowDays / weekLength
	windowStart := in.Today.AddDate(0, 0, -SocialJetlagWindowDays)

	// One entry per usable week: its free-night midpoint mean minus its work-night
	// midpoint mean, in minutes. Positive means the weekend runs later.
	var shifts []float64
	nightsUsed := 0
	for i := 0; i < weekCount; i++ {
		start := windowStart.AddDate(0, 0, i*weekLength)
		end := start.AddDate(0, 0, weekLength)

		// ⚠️ Split by the FREE-NIGHT rule, not by "Saturday and Sunday": a free
		// night is one that starts on a Friday or a Saturday, because those are the
		// nights one may sleep in after. The night before a Monday starts on Sunday
		// and is a work night — and that asymmetry is the whole of social jetlag,
		// not a detail of it (freeNight).
		var free, work []float64
		for _, n := range nightsBetween(in.SleepNights, start, end) {
			if freeNight(n.Day.Weekday()) {
				free = append(free, n.midpointMinutes())
			} else {
				work = append(work, n.midpointMinutes())
			}
		}
		if len(free) < MinSocialJetlagFreeNightsPerWeek ||
			len(work) < MinSocialJetlagWorkNightsPerWeek {
			// A week that cannot be paired contributes nothing. It is NOT a week with
			// zero jetlag: a missing measurement is missing, and counting it as
			// agreement would drag the median towards whatever we happened to record.
			continue
		}
		nightsUsed += len(free) + len(work)
		shifts = append(shifts, mean(free)-mean(work))
	}

	if len(shifts) < MinSocialJetlagWeeks {
		return nil
	}

	med := median(shifts)
	// One-sided on purpose. "Social jetlag" names the LATE shift — a weekend that
	// starts earlier than the working week is an unusual life, not a jetlag, and
	// calling it one would be using a borrowed term for something it does not mean.
	if med < MinSocialJetlagShiftMinutes {
		return nil
	}

	agreeing := 0
	for _, s := range shifts {
		if s >= SocialJetlagAgreementMinutes {
			agreeing++
		}
	}
	if 3*agreeing < 2*len(shifts) {
		return nil // a few big weekends, not a standing weekly habit
	}

	// One hour of shift, one time zone. The rounding is deliberate and stated as
	// approximate: "1.8 időzóna" would give an analogy the precision of a
	// measurement.
	zones := int(math.Round(med / 60))
	title := fmt.Sprintf("Szociális jetlag: a hétvégi alvásközeped %s későbbre csúszik",
		fmtDelta(med/60, "óra"))
	detail := fmt.Sprintf(
		"Az elmúlt %d nap %d hetéből %d hétben volt mérhető hétvégi és hétköznapi éjszaka is "+
			"(összesen %d éjszaka); a heti eltérések mediánja %s, és %d hétben érte el a fél órát. "+
			"Ez nagyjából %d időzónányi eltolódás minden héten, oda és vissza. A hétvégi és a "+
			"hétköznapi alvásközép különbségét hívják szociális jetlagnek; ez a saját éjszakáidból "+
			"számolt eltérés, nem orvosi értékelés.",
		SocialJetlagWindowDays, weekCount, len(shifts), nightsUsed,
		fmtVal(med, "perc"), agreeing, zones)

	// A `pattern`, like the other timing rules: it describes a property of one
	// window — a habit — rather than a change from one window to the next.
	return insight("social-jetlag", in.Today, api.Pattern, "sleepDuration", title, detail,
		api.Info, now,
		map[string]float64{
			"jetlagMinutes": med, "weeks": float64(len(shifts)), "nights": float64(nightsUsed),
		})
}
