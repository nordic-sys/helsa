// Rule 9: **sleep debt** — a rolling 14-day shortfall against your own usual
// night.
//
// # Why this is worth a rule at all
//
// Apple Health shows every night on its own, and every one of those nights is
// defensible: six and a half hours is not an event. What a per-night view cannot
// show is that the shortfall ACCUMULATES — thirteen nights forty minutes short is
// nine hours of sleep that did not happen, and no single night in that fortnight
// looked like anything.
//
// The other rules cannot see it either, and it is worth being precise about why.
// `sleep-short` (a deviationRule) needs three consecutive nights 1.5 sigmas below
// a trailing average, so an even, consistently slightly short fortnight never
// trips it. `sleep-weekly-trend` compares one week with the week before, so a
// fortnight that is uniformly short shows a change of zero.
//
// # Against your own usual, never against "8 hours"
//
// The measure is the person's **own median night** over the preceding three
// months, not a population figure. A number like "8 hours" would turn a rule about
// someone's own data into a piece of received wisdom about everyone's, and it
// would tell a genuine seven-hour sleeper that they carry an hour of debt every
// single night of their life.
//
// # The trap this rule is built around
//
// The tempting arithmetic is `sum of max(0, usual − actual)`: count only the short
// nights. It is wrong, and quietly so — half of anyone's nights fall below their
// own middle, so that sum is **always positive**, for everyone, for ever. A rule
// that can only ever report debt is not a measurement, it is a horoscope. So the
// sum is SIGNED: a long night pays back a short one, and what is left over is a
// real balance. This is the same failure mode the absolute thresholds guard
// against elsewhere — a statistic that is technically true of everybody.
//
// # It is one-sided, and that is not the same thing
//
// The rule speaks only about a deficit, never about a surplus: "you slept nine
// hours more than usual" is not a debt, and there is nothing for the reader to do
// with it. sleepRegularity takes the same shape, and for the same reason — silence
// is not a compliment, it is just silence.

package insights

import (
	"fmt"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

const (
	// The window the debt accumulates over: the last 14 nights, today excluded.
	//
	// A fortnight, because a week is short enough that one bad night dominates it,
	// and a month is long enough that a debt from its first half has usually been
	// paid back by its second — at which point summing across it says nothing
	// about how the person is sleeping now.
	SleepDebtWindowDays = 14
	// Measured nights required out of the 14. Ten, so that four unrecorded nights
	// are tolerated while a fortnight recorded four times cannot pass as one.
	MinSleepDebtNights = 10

	// The stretch behind the window that defines "usual": the 90 days ending where
	// the fortnight begins. It deliberately does NOT include the fortnight itself
	// — otherwise the very nights under examination would help set the standard
	// they are being measured against, and a bad fortnight would partly excuse
	// itself.
	SleepDebtBaselineDays = 90
	// Measured nights required in those 90. Half the window, the proportion every
	// other rule here asks of its baseline.
	MinSleepDebtBaselineNights = 45

	// How far back this rule needs the input to reach.
	SleepDebtHistoryDays = SleepDebtWindowDays + SleepDebtBaselineDays

	// The smallest accumulated shortfall worth a sentence, in hours. Five hours
	// over a fortnight is a bit over twenty minutes a night — under that, the
	// number is inside the noise of what a wrist device can even tell about sleep.
	MinSleepDebtHours = 5.0
	// And at least this share of the sleep those nights should have held. The
	// absolute floor alone would speak sooner to a long sleeper (five hours is a
	// smaller dent in nine-hour nights than in six-hour ones); the relative one
	// keeps the two comparable. The relative-plus-absolute pairing is the house
	// rule everywhere in this engine.
	MinSleepDebtRelative = 0.05
)

// sleepDebt is the accumulated difference between what the last fortnight's
// measured nights held and what the person's usual night would have given over the
// same nights.
func sleepDebt(in Input, now time.Time) *Result {
	if len(in.SleepHours) == 0 {
		return nil
	}

	// Today is left out: the night is either not over or not written yet, and
	// counting it would have this rule announce a growing debt every single
	// morning.
	windowEnd := in.Today
	windowStart := windowEnd.AddDate(0, 0, -SleepDebtWindowDays)
	baselineStart := windowStart.AddDate(0, 0, -SleepDebtBaselineDays)

	recent := in.SleepHours.between(windowStart, windowEnd).values()
	baseline := in.SleepHours.between(baselineStart, windowStart).values()
	if len(recent) < MinSleepDebtNights || len(baseline) < MinSleepDebtBaselineNights {
		return nil // we do not know this person's usual night yet, so there is nothing to owe
	}

	// The median, not the mean: see the note on median(). A fortnight of illness in
	// the baseline must not be allowed to redefine "usual" downwards and thereby
	// forgive the debt.
	usual := median(baseline)
	if usual <= 0 {
		return nil
	}

	// ⚠️ The expectation is scaled to the MEASURED nights, not to 14. Charging the
	// person for nights that never reached the server would be inventing data — and
	// it would make the debt grow every time the watch was left off the charger.
	expected := usual * float64(len(recent))
	var slept float64
	for _, v := range recent {
		slept += v
	}
	debt := expected - slept
	if debt < MinSleepDebtHours || debt < expected*MinSleepDebtRelative {
		return nil // in credit, or the shortfall is too small to be worth a sentence
	}

	title := fmt.Sprintf("Az elmúlt %d éjszakád összesen %s maradt el a szokásosodtól",
		SleepDebtWindowDays, fmtDelta(debt, "óra"))
	detail := fmt.Sprintf(
		"A %d mért éjszaka alatt %s alvás gyűlt össze; a szokásos éjszakáddal (%s) számolva "+
			"ugyanezeken az éjszakákon %s lett volna — a különbség %s. A szokásos éjszakád a "+
			"megelőző %d nap %d mért éjszakájának mediánja, nem egy általános 8 órás ajánlás. "+
			"Csak a mért éjszakák számítanak; a hiányzó éjszakát nem számoljuk se nullának, "+
			"se szokásosnak. Ez a saját szokásodhoz mért különbség, nem orvosi értékelés.",
		len(recent), fmtVal(slept, "óra"), fmtVal(usual, "óra"), fmtVal(expected, "óra"),
		fmtVal(debt, "óra"), SleepDebtBaselineDays, len(baseline))

	// A `pattern`: this is a property of ONE window — what a fortnight added up to
	// — and not a change from one window to the next. And `info`, not `notice`: an
	// accumulated shortfall is something to know, not something happening this
	// minute.
	return insight("sleep-debt", in.Today, api.Pattern, "sleepDuration", title, detail,
		api.Info, now,
		map[string]float64{
			"debtHours": debt, "usual": usual, "nights": float64(len(recent)),
			// What actually accumulated and what the usual night would have given. Both are
			// in the sentence, and neither can be recomputed from the three above without
			// repeating the rule's own arithmetic on the client.
			"slept": slept, "expected": expected,
			"baselineNights": float64(len(baseline)),
		})
}
