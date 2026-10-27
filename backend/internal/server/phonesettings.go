package server

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/challenge"
	"github.com/nordic-sys/helsa/backend/internal/db"
)

// --- The phone's settings blocks in /v1/settings (docs/35) ---
//
// `challenge`, `hydration` and `journey` are decisions made on the phone: the
// milestones and rest days of the monthly challenge, the water goal, the
// virtual journey. The phone uploads them so the web can show the same thing
// the phone does instead of a guess (`thresholds_source: default`) or nothing.
//
// Three rules shape everything below:
//
//  1. **A block is replaced, never merged.** It is the phone's whole statement
//     about one feature, and "absent inside a sent block" means something —
//     `hydration: {}` is "no goal of my own", `journey: {}` is "no journey".
//     Merging field by field (the way notif_prefs is) would make clearing a goal
//     impossible to say.
//  2. **A block never sent stays absent on the way out.** "The phone has not
//     told this server" is a different fact from "the phone said: nothing", and
//     an older phone produces the first one forever. The `*_at` column carries
//     the difference.
//  3. **Validation guards the shape, not the phone's opinions.** The phone
//     already clamps and cleans these values; what is refused here is what the
//     phone cannot produce (a milestone of a billion steps, a goal outside its
//     own bracket, a route id that is not an id). A route id is NOT checked
//     against a list: the catalogue ships with the app, and a phone one version
//     ahead of this server must not have its journey refused.

// Limits on what the phone can plausibly send. Each is far above anything the
// app produces and exists only so a confused client cannot store a megabyte in
// a settings row.
const (
	// maxThresholds: the settings screen has a handful of milestone fields.
	maxThresholds = 50
	// maxThresholdSteps: ten million steps in a month is ~320 000 a day.
	maxThresholdSteps = 10_000_000
	// maxRestDays: the phone never prunes its rest-day ledger (one key is eleven
	// bytes, twenty years of it is a few kilobytes), so the cap is generous —
	// 20 000 days is 54 years of marking every single day.
	maxRestDays = 20_000
	// The phone's own water bracket (`HydrationGoal.minMilliliters/maxMilliliters`).
	// The phone clamps to it, so a value outside did not come from the phone.
	minGoalML = 500
	maxGoalML = 6000
	// maxRouteIDLen matches the contract's maxLength.
	maxRouteIDLen = 64
)

// routeIDPattern is the shape of every id in the app's catalogue
// (`balatoni-bringakorut`, `rpddk`): lower-case words joined by hyphens.
var routeIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// A day the phone could have marked. Not a calendar check (the date type does
// that) but a sanity bracket: a rest day in 1970 is a client bug, not a decision.
var (
	earliestDay = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	latestDay   = time.Date(2100, 12, 31, 0, 0, 0, 0, time.UTC)
)

// settingsError is a validation failure: a title for the problem and a detail
// the caller can act on.
type settingsError struct{ title, detail string }

func (e *settingsError) Error() string { return e.title + ": " + e.detail }

// challengeWrite is a validated `challenge` block, in the shape the query takes.
// `thresholds == nil` means "never set" and is stored as NULL; an empty non-nil
// slice means "deleted every milestone" and is stored as '{}'.
type challengeWrite struct {
	thresholds []int32
	restDays   []pgtype.Date
}

// cleanChallenge validates and tidies the block. The milestones go through the
// very cleanup the phone and the `thresholds` query parameter use
// (`challenge.NewThresholds`), so a row stored here can never read differently
// from the same row typed on the phone.
func cleanChallenge(in *api.ChallengeSettings) (challengeWrite, error) {
	var out challengeWrite
	if in.Thresholds != nil {
		raw := *in.Thresholds
		if len(raw) > maxThresholds {
			return out, &settingsError{"Invalid challenge thresholds",
				fmt.Sprintf("at most %d milestones", maxThresholds)}
		}
		for _, v := range raw {
			if v > maxThresholdSteps {
				return out, &settingsError{"Invalid challenge thresholds",
					fmt.Sprintf("%d is above the %d-step ceiling", v, maxThresholdSteps)}
			}
		}
		cleaned := challenge.NewThresholds(raw).Values
		// ⚠️ Non-nil even when empty: "deleted every milestone" must reach the
		// database as '{}', not as NULL ("never touched").
		out.thresholds = make([]int32, 0, len(cleaned))
		for _, v := range cleaned {
			out.thresholds = append(out.thresholds, int32(v)) // #nosec G115 -- bounded by maxThresholdSteps above
		}
	}
	if in.RestDays != nil {
		days := *in.RestDays
		if len(days) > maxRestDays {
			return out, &settingsError{"Invalid rest days",
				fmt.Sprintf("at most %d days", maxRestDays)}
		}
		seen := make(map[string]bool, len(days))
		keys := make([]string, 0, len(days))
		for _, d := range days {
			if d.Time.Before(earliestDay) || d.Time.After(latestDay) {
				return out, &settingsError{"Invalid rest days",
					fmt.Sprintf("%s is outside 2000–2100", d.Format("2006-01-02"))}
			}
			key := d.Format("2006-01-02")
			if seen[key] {
				continue
			}
			seen[key] = true
			keys = append(keys, key)
		}
		// Sorted, as the phone sorts its ledger on write: the stored list reads in
		// order and two uploads of the same set compare equal.
		sort.Strings(keys)
		out.restDays = make([]pgtype.Date, 0, len(keys))
		for _, k := range keys {
			t, _ := time.Parse("2006-01-02", k)
			out.restDays = append(out.restDays, pgtype.Date{Time: t, Valid: true})
		}
	}
	return out, nil
}

// cleanHydration validates the block. An absent goal is a legitimate value:
// the user has none of their own, and the phone offers a suggestion it never
// stores.
func cleanHydration(in *api.HydrationSettings) (*int32, error) {
	if in.GoalMl == nil {
		return nil, nil
	}
	g := *in.GoalMl
	if g < minGoalML || g > maxGoalML {
		return nil, &settingsError{"Invalid water goal",
			fmt.Sprintf("goal_ml must be within %d–%d", minGoalML, maxGoalML)}
	}
	v := int32(g) // #nosec G115 -- bounded by the check above
	return &v, nil
}

// journeyWrite is a validated `journey` block; both fields nil = no journey.
type journeyWrite struct {
	routeID   *string
	startedOn pgtype.Date
}

func cleanJourney(in *api.JourneySettings) (journeyWrite, error) {
	var out journeyWrite
	if (in.RouteId == nil) != (in.StartedOn == nil) {
		return out, &settingsError{"Invalid journey",
			"route_id and started_on come together, or neither (no journey running)"}
	}
	if in.RouteId == nil {
		return out, nil
	}
	id := *in.RouteId
	if len(id) == 0 || len(id) > maxRouteIDLen || !routeIDPattern.MatchString(id) {
		return out, &settingsError{"Invalid journey",
			fmt.Sprintf("%q is not a route id (lower-case letters, digits and hyphens, at most %d)", id, maxRouteIDLen)}
	}
	day := in.StartedOn.Time
	if day.Before(earliestDay) || day.After(latestDay) {
		return out, &settingsError{"Invalid journey",
			fmt.Sprintf("started_on %s is outside 2000–2100", in.StartedOn.Format("2006-01-02"))}
	}
	out.routeID = &id
	out.startedOn = pgtype.Date{Time: day, Valid: true}
	return out, nil
}

// phoneBlocks reads the stored blocks for the response. No row at all is the
// ordinary state of a server whose phone predates this feature: every block
// stays absent.
func phoneBlocks(ctx context.Context, q *db.Queries, uid pgtype.UUID) (phoneSettingsOut, error) {
	row, err := q.GetPhoneSettings(ctx, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return phoneSettingsOut{}, nil
	}
	if err != nil {
		return phoneSettingsOut{}, err
	}
	return phoneSettingsFromRow(row), nil
}

// phoneSettingsOut is the three blocks as the response carries them; a nil
// pointer is a block the phone has never sent.
type phoneSettingsOut struct {
	challenge *api.ChallengeSettings
	hydration *api.HydrationSettings
	journey   *api.JourneySettings
}

func (p phoneSettingsOut) apply(s *api.Settings) {
	s.Challenge = p.challenge
	s.Hydration = p.hydration
	s.Journey = p.journey
}

func phoneSettingsFromRow(row db.GetPhoneSettingsRow) phoneSettingsOut {
	var out phoneSettingsOut
	if row.ChallengeAt.Valid {
		at := row.ChallengeAt.Time
		c := api.ChallengeSettings{UpdatedAt: &at}
		// NULL stays absent ("never touched", the phone uses its factory row);
		// '{}' goes out as an empty array ("deleted every milestone").
		if row.ChallengeThresholds != nil {
			values := make([]int, 0, len(row.ChallengeThresholds))
			for _, v := range row.ChallengeThresholds {
				values = append(values, int(v))
			}
			c.Thresholds = &values
		}
		days := make([]openapi_types.Date, 0, len(row.ChallengeRestDays))
		for _, d := range row.ChallengeRestDays {
			if d.Valid {
				days = append(days, openapi_types.Date{Time: d.Time})
			}
		}
		c.RestDays = &days
		out.challenge = &c
	}
	if row.HydrationAt.Valid {
		at := row.HydrationAt.Time
		h := api.HydrationSettings{UpdatedAt: &at}
		if row.HydrationGoalMl != nil {
			g := int(*row.HydrationGoalMl)
			h.GoalMl = &g
		}
		out.hydration = &h
	}
	if row.JourneyAt.Valid {
		at := row.JourneyAt.Time
		j := api.JourneySettings{UpdatedAt: &at}
		if row.JourneyRouteID != nil && row.JourneyStartedOn.Valid {
			id := *row.JourneyRouteID
			j.RouteId = &id
			j.StartedOn = &openapi_types.Date{Time: row.JourneyStartedOn.Time}
		}
		out.journey = &j
	}
	return out
}

// phoneSettingsWrite is every block of one PUT, validated before anything is
// written — a request with one bad block changes nothing, rather than half of
// what it asked for.
type phoneSettingsWrite struct {
	challenge *challengeWrite
	hydration **int32 // nil = block not sent; *nil = sent, no goal
	journey   *journeyWrite
}

func cleanPhoneSettings(body *api.Settings) (phoneSettingsWrite, error) {
	var w phoneSettingsWrite
	if body.Challenge != nil {
		c, err := cleanChallenge(body.Challenge)
		if err != nil {
			return w, err
		}
		w.challenge = &c
	}
	if body.Hydration != nil {
		g, err := cleanHydration(body.Hydration)
		if err != nil {
			return w, err
		}
		w.hydration = &g
	}
	if body.Journey != nil {
		j, err := cleanJourney(body.Journey)
		if err != nil {
			return w, err
		}
		w.journey = &j
	}
	return w, nil
}

func (w phoneSettingsWrite) empty() bool {
	return w.challenge == nil && w.hydration == nil && w.journey == nil
}

func (w phoneSettingsWrite) store(ctx context.Context, q *db.Queries, uid pgtype.UUID) error {
	if w.challenge != nil {
		if err := q.PutChallengeSettings(ctx, db.PutChallengeSettingsParams{
			UserID: uid, Thresholds: w.challenge.thresholds, RestDays: w.challenge.restDays,
		}); err != nil {
			return fmt.Errorf("challenge settings: %w", err)
		}
	}
	if w.hydration != nil {
		if err := q.PutHydrationSettings(ctx, db.PutHydrationSettingsParams{
			UserID: uid, GoalMl: *w.hydration,
		}); err != nil {
			return fmt.Errorf("hydration settings: %w", err)
		}
	}
	if w.journey != nil {
		if err := q.PutJourneySettings(ctx, db.PutJourneySettingsParams{
			UserID: uid, RouteID: w.journey.routeID, StartedOn: w.journey.startedOn,
		}); err != nil {
			return fmt.Errorf("journey settings: %w", err)
		}
	}
	return nil
}
