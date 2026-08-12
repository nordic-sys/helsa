// Package sleep turns the raw HealthKit sleep segments into an OVERLAP-FREE
// timeline, and answers the only question the rest of the backend actually asks
// of them: how long was I asleep?
//
// ⚠️ Why this cannot be a `sum(ended_at - started_at)` in SQL. The segments
// overlap each other, in two ways at once:
//
//   - `inBed` is not a measurement but an ENVELOPE: it wraps the whole night, so
//     adding it to the stages counts every minute twice.
//   - Since a second source (the watch next to the phone) started writing stages
//     as well, two sources describe the SAME night, in their own words, at their
//     own boundaries.
//
// Summing the raw lengths therefore reports roughly one and a half times the
// real sleep — a confident, believable lie, of the kind that is worse than
// silence. Every caller that wants a duration must go through Resolve or
// Nights.
//
// The semantics here deliberately mirror the phone's
// (`HelsaKit/Health/UI/SleepAnalysis.swift`): the same night has to come out the
// same length on the phone, on the web and in an insight. Two implementations of
// one rule is one implementation too many, and the two ends drifting apart is
// how the same rule fires on the phone and stays silent on the web.
package sleep

import (
	"sort"
	"time"
)

// Stage is a NORMALIZED sleep stage.
//
// Normalizing is not tidiness. In the real database the HealthKit-flavoured
// `asleepCore`/`asleepDeep`/`asleepREM` names live side by side with the short
// legacy `core`/`deep`/`rem` ones — for the same nights, overlapping each other.
// A query that only knows one of the two spellings silently drops half the data
// and shows LESS sleep than what was recorded, without anything looking broken.
type Stage string

const (
	Deep Stage = "deep"
	REM  Stage = "rem"
	Core Stage = "core"
	// Unspecified is HealthKit's `asleepUnspecified`: sleep, only the source did
	// not break it into stages. Treating it as zero (as the first version of the
	// insights query did) throws away whole nights recorded by a source that does
	// not do staging.
	Unspecified Stage = "asleepUnspecified"
	Awake       Stage = "awake"
	InBed       Stage = "inBed"
)

// IsAsleep: was this time actually spent asleep? `inBed` is NOT — it is the
// envelope between going to bed and getting up, and it overlaps every other
// stage.
func (s Stage) IsAsleep() bool {
	switch s {
	case Deep, REM, Core, Unspecified:
		return true
	default:
		return false
	}
}

// priority resolves a conflict between overlapping stages — the SMALLER number
// wins. Two rules stand behind the order:
//
//  1. **`awake` beats everyone.** If one source says I was awake, claiming deep
//     sleep in its place would be the stronger claim in the more unpleasant
//     direction. Overestimating sleep is the worse error.
//  2. **`inBed` loses to everyone.** It is an envelope, not a measurement: if
//     anyone says anything more specific for a moment, that wins.
//
// Among the sleep stages the more specific classification goes first. That part
// is ARBITRARY when two sources contradict each other — but it does not move the
// total (that is the union, see Night.Asleep), only the split between stages.
func (s Stage) priority() int {
	switch s {
	case Awake:
		return 0
	case Deep:
		return 1
	case REM:
		return 2
	case Core:
		return 3
	case Unspecified:
		return 4
	case InBed:
		return 5
	default:
		return 6
	}
}

// Normalize resolves a raw `stage` string. The second return value is false for
// a name we do not know — the caller must decide what to do with it, but it must
// not be counted as sleep: a new HealthKit stage silently counted as sleep is
// exactly the "confidently wrong upwards" answer this package exists to prevent.
func Normalize(raw string) (Stage, bool) {
	switch lower(raw) {
	case "asleepdeep", "deep":
		return Deep, true
	case "asleeprem", "rem":
		return REM, true
	case "asleepcore", "core", "asleeplight", "light":
		return Core, true
	case "asleep", "asleepunspecified", "unspecified":
		return Unspecified, true
	case "awake", "awakened":
		return Awake, true
	case "inbed", "in_bed":
		return InBed, true
	}
	return "", false
}

// lower is an ASCII-only strings.ToLower: the stage names are HealthKit
// identifiers, so there is nothing here for Unicode case folding to do.
func lower(s string) string {
	b := []byte(s)
	for i := range b {
		if b[i] >= 'A' && b[i] <= 'Z' {
			b[i] += 'a' - 'A'
		}
	}
	return string(b)
}

// Span is one stage over an interval. The interval is half-open, [Start, End).
type Span struct {
	Start time.Time
	End   time.Time
	Stage Stage
}

// Duration is never negative: a reversed span (bad data) is 0 long, it does not
// subtract from the night.
func (s Span) Duration() time.Duration {
	if !s.End.After(s.Start) {
		return 0
	}
	return s.End.Sub(s.Start)
}

// Raw is a segment as it comes out of the database: the stage is still a
// free-text string.
type Raw struct {
	Start time.Time
	End   time.Time
	Stage string
}

// Spans normalizes the raw rows and sorts them by start time. The unrecognized
// stage names come back SEPARATELY rather than disappearing: a stage we cannot
// place is a gap in the picture, and the caller gets to say so out loud.
//
// Zero-length and reversed segments are dropped here — they carry no time, and
// they would only add cut points to Resolve.
func Spans(rows []Raw) (spans []Span, unknown []string) {
	seen := map[string]bool{}
	for _, r := range rows {
		stage, ok := Normalize(r.Stage)
		if !ok {
			if !seen[r.Stage] {
				seen[r.Stage] = true
				unknown = append(unknown, r.Stage)
			}
			continue
		}
		if !r.End.After(r.Start) {
			continue
		}
		spans = append(spans, Span{Start: r.Start, End: r.End, Stage: stage})
	}
	sort.Slice(spans, func(i, j int) bool { return spans[i].Start.Before(spans[j].Start) })
	sort.Strings(unknown)
	return spans, unknown
}

// Resolve flattens overlapping spans into DISJOINT slices, and reports how much
// raw length the overlap had duplicated.
//
// Every stage boundary is a cut point; between two neighbouring cut points
// exactly one stage wins (see Stage.priority), and neighbouring slices of the
// same stage are merged so that the timeline does not fall apart at invisible
// cuts.
//
// The `overlap` is not a diagnostic curiosity: it is the difference between what
// the naive sum would have said and what we say, and it is the number to reach
// for when someone asks why the total is not the sum of the stages.
func Resolve(spans []Span) (slices []Span, overlap time.Duration) {
	if len(spans) == 0 {
		return nil, 0
	}

	cuts := cutPoints(spans)
	if len(cuts) < 2 {
		return nil, 0
	}

	var raw time.Duration
	for _, s := range spans {
		raw += s.Duration()
	}

	for i := 0; i+1 < len(cuts); i++ {
		from, to := cuts[i], cuts[i+1]
		winner, ok := covering(spans, from, to)
		if !ok {
			continue // a gap: not a single stage reaches here
		}
		if n := len(slices); n > 0 && slices[n-1].Stage == winner && slices[n-1].End.Equal(from) {
			slices[n-1].End = to
			continue
		}
		slices = append(slices, Span{Start: from, End: to, Stage: winner})
	}

	var union time.Duration
	for _, s := range slices {
		union += s.Duration()
	}
	if raw > union {
		overlap = raw - union
	}
	return slices, overlap
}

// cutPoints collects the deduplicated, ordered boundaries of the spans.
func cutPoints(spans []Span) []time.Time {
	seen := make(map[int64]time.Time, 2*len(spans))
	for _, s := range spans {
		seen[s.Start.UnixNano()] = s.Start
		seen[s.End.UnixNano()] = s.End
	}
	out := make([]time.Time, 0, len(seen))
	for _, t := range seen {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Before(out[j]) })
	return out
}

// covering picks the winning stage over the [from, to) interval: of the spans
// that cover it whole, the one with the smallest priority.
func covering(spans []Span, from, to time.Time) (Stage, bool) {
	var best Stage
	found := false
	for _, s := range spans {
		if s.Start.After(from) || s.End.Before(to) {
			continue
		}
		if !found || s.Stage.priority() < best.priority() {
			best, found = s.Stage, true
		}
	}
	return best, found
}

// AsleepDuration is the length of the time ACTUALLY spent asleep in the spans:
// the union of the sleep stages, so an overlap counts once, `awake` beats the
// sleep stage under it, and `inBed` counts only where nothing more specific
// covers it — that is, not at all.
func AsleepDuration(spans []Span) time.Duration {
	slices, _ := Resolve(spans)
	return asleep(slices)
}

func asleep(slices []Span) time.Duration {
	var total time.Duration
	for _, s := range slices {
		if s.Stage.IsAsleep() {
			total += s.Duration()
		}
	}
	return total
}

// NightGap: a break longer than this starts a new sleep session.
//
// Three hours: long enough that waking in the night does not cut the night in
// two, short enough that an afternoon nap ends up on its own. The same value
// lives in the phone's `SleepAnalysisBuilder.nightGapSeconds` and in the web's
// `lib/sleep.ts` — deliberately, so that all three say the same night.
const NightGap = 3 * time.Hour

// Night is one sleep session, already flattened.
type Night struct {
	// Slices are disjoint and ordered by time (`inBed` among them, wherever no
	// more specific stage covers it).
	Slices []Span
	// Overlap is how much the raw stages of this night covered each other.
	Overlap time.Duration
}

// Asleep is the time actually spent asleep.
func (n Night) Asleep() time.Duration { return asleep(n.Slices) }

// Onset is the start of the first SLEEP slice, Wake the end of the last one.
// `ok` is false for a session that holds no sleep at all (only awake / in bed):
// that night has no falling-asleep moment, and inventing one would be worse than
// leaving the timing rules without it.
func (n Night) Onset() (time.Time, bool) {
	for _, s := range n.Slices {
		if s.Stage.IsAsleep() {
			return s.Start, true
		}
	}
	return time.Time{}, false
}

func (n Night) Wake() (time.Time, bool) {
	for i := len(n.Slices) - 1; i >= 0; i-- {
		if n.Slices[i].Stage.IsAsleep() {
			return n.Slices[i].End, true
		}
	}
	return time.Time{}, false
}

// Nights threads the spans into sessions and flattens each one.
//
// The gap is measured against the RUNNING MAXIMUM end, not against the end of
// the previous span: `inBed` overlaps the whole night, so the stages after it
// start "earlier" than where the previous one ended.
func Nights(spans []Span, gap time.Duration) []Night {
	groups := group(spans, gap)
	out := make([]Night, 0, len(groups))
	for _, g := range groups {
		slices, overlap := Resolve(g)
		out = append(out, Night{Slices: slices, Overlap: overlap})
	}
	return out
}

// group splits the (start-ordered) spans into sessions.
func group(spans []Span, gap time.Duration) [][]Span {
	ordered := make([]Span, len(spans))
	copy(ordered, spans)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Start.Before(ordered[j].Start) })

	var out [][]Span
	var current []Span
	var runningEnd time.Time
	for _, s := range ordered {
		if len(current) > 0 && s.Start.Sub(runningEnd) > gap {
			out = append(out, current)
			current = nil
			runningEnd = time.Time{}
		}
		current = append(current, s)
		if s.End.After(runningEnd) {
			runningEnd = s.End
		}
	}
	if len(current) > 0 {
		out = append(out, current)
	}
	return out
}
