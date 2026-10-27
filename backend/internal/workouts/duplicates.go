package workouts

// The same session, recorded twice — the server's copy of the phone's
// `WorkoutDuplicates` (HelsaKit/Sources/HelsaKit/Workouts/WorkoutDuplicates.swift)
// and of the web's `groupSessions` (web/src/lib/workouts.ts).
//
// # Why the server needs it at all
//
// Everywhere else the fold is the CLIENT's job: `/workouts` returns every
// recording and the list decides what to show. The zone maximum is the one
// figure computed here that depends on it. The phone takes "one maximum per
// SESSION" (`WorkoutProgressViewModel.loadIntensity`): two recordings of the same
// run must not count as two workouts towards the five-workout minimum, nor be
// the "second highest" of each other — and with the second-highest rule that is
// not a detail. A watch and a chest strap recording the same race would give the
// race's peak twice, and the second-highest would be the race again rather than
// the next-hardest session; the spike filter the rule exists for would be gone.
//
// So the comparison below is the phone's, constant for constant. It is narrow on
// purpose (same activity type, overlap ÷ union ≥ 0.7): a missed duplicate costs
// a doubled entry, a false merge costs a workout.
//
// ⚠️ Only the grouping is ported, not the `sameNumbers` comparison — nothing on
// the server words a row.

import (
	"sort"
	"strings"
	"time"
)

const (
	// MinimumOverlap is shared time ÷ total time covered. Not "how much of the
	// shorter one is covered": a twenty-minute run inside a three-hour hike would
	// score 1.0 on that and merge two separate workouts.
	MinimumOverlap = 0.7
	// StartTolerance: when a recording has no usable span, only the starts can be
	// compared.
	StartTolerance = 5 * time.Minute
)

// Recording is one workout row, as much of it as the fold needs.
type Recording struct {
	ID           string
	ActivityType string
	Start        time.Time
	End          *time.Time
	EnergyKcal   *float64
	DistanceM    *float64
	AvgHR        *float64
	MaxHR        *float64
	HasMetadata  bool
}

// Session is one session and every recording of it; Primary is the most
// complete one, the recording the list shows.
type Session struct {
	Primary Recording
	Others  []Recording
}

// All returns every recording, the primary first.
func (s Session) All() []Recording {
	return append([]Recording{s.Primary}, s.Others...)
}

// IsSameSession says whether two recordings are of the same session.
func IsSameSession(a, b Recording) bool {
	if a.ID == b.ID {
		return false
	}
	if a.ActivityType != b.ActivityType {
		return false
	}
	startsMatch := absDur(a.Start.Sub(b.Start)) <= StartTolerance
	if a.End == nil || b.End == nil {
		return startsMatch
	}
	aLen := a.End.Sub(a.Start)
	bLen := b.End.Sub(b.Start)
	if aLen <= 0 || bLen <= 0 {
		return startsMatch
	}
	overlap := minTime(*a.End, *b.End).Sub(maxTime(a.Start, b.Start))
	if overlap <= 0 {
		return false
	}
	union := maxTime(*a.End, *b.End).Sub(minTime(a.Start, b.Start))
	if union <= 0 {
		return false
	}
	return overlap.Seconds()/union.Seconds() >= MinimumOverlap
}

// GroupSessions folds recordings into sessions.
//
// ⚠️ The comparison is against the group's PRIMARY, not pairwise: a chain (A
// overlaps B, B overlaps C, A and C do not) would otherwise merge three sessions,
// and a long walk containing two short ones is exactly that shape. The primary
// is re-chosen after every addition, as on the phone, so the anchor is the same
// recording the phone would compare against.
func GroupSessions(recs []Recording) []Session {
	ordered := append([]Recording(nil), recs...)
	sort.SliceStable(ordered, func(i, j int) bool {
		if !ordered[i].Start.Equal(ordered[j].Start) {
			return ordered[i].Start.Before(ordered[j].Start)
		}
		return ordered[i].ID < ordered[j].ID
	})

	var buckets [][]Recording
	for _, r := range ordered {
		placed := false
		for i := range buckets {
			if IsSameSession(buckets[i][0], r) {
				buckets[i] = append(buckets[i], r)
				sort.SliceStable(buckets[i], func(x, y int) bool {
					return isMoreComplete(buckets[i][x], buckets[i][y])
				})
				placed = true
				break
			}
		}
		if !placed {
			buckets = append(buckets, []Recording{r})
		}
	}

	out := make([]Session, 0, len(buckets))
	for _, members := range buckets {
		others := append([]Recording(nil), members[1:]...)
		sort.SliceStable(others, func(i, j int) bool { return others[i].Start.Before(others[j].Start) })
		out = append(out, Session{Primary: members[0], Others: others})
	}
	return out
}

// isMoreComplete: which recording has more to say. The tie-breaks make the same
// list always produce the same primary.
func isMoreComplete(a, b Recording) bool {
	ca, cb := completeness(a), completeness(b)
	if ca != cb {
		return ca > cb
	}
	if !a.Start.Equal(b.Start) {
		return a.Start.Before(b.Start)
	}
	return strings.Compare(a.ID, b.ID) < 0
}

func completeness(r Recording) int {
	score := 0
	for _, present := range []bool{
		r.End != nil, r.DistanceM != nil, r.EnergyKcal != nil,
		r.AvgHR != nil, r.MaxHR != nil, r.HasMetadata,
	} {
		if present {
			score++
		}
	}
	return score
}

func absDur(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
