package server

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
	"github.com/nordic-sys/helsa/backend/internal/samples"
)

// --- GET /v1/activity — the daily rings (Move/Exercise/Stand), value + goal ---

func (s *Server) GetActivity(w http.ResponseWriter, r *http.Request, params api.GetActivityParams) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	loc := s.resolveLoc(r.Context(), uid, params.Tz)
	start, endExcl := dayWindow(loc, params.From, params.To, 7)

	rows, err := s.q.ListActivitySummary(r.Context(), db.ListActivitySummaryParams{
		UserID:  pgconv.UUID(uid),
		FromDay: pgconv.Date(start),
		ToDay:   pgconv.Date(endExcl), // half-open: day < endExcl
	})
	if err != nil {
		problem(w, http.StatusInternalServerError, "Query failed", err.Error())
		return
	}
	out := make([]api.ActivitySummary, 0, len(rows))
	for _, a := range rows {
		d := openapi_types.Date{Time: a.Day.Time}
		out = append(out, api.ActivitySummary{
			Day:              &d,
			ActiveEnergy:     f64to32(a.ActiveEnergy),
			ActiveEnergyGoal: f64to32(a.ActiveEnergyGoal),
			ExerciseMinutes:  f64to32(a.ExerciseMinutes),
			ExerciseGoal:     f64to32(a.ExerciseGoal),
			StandHours:       f64to32(a.StandHours),
			StandGoal:        f64to32(a.StandGoal),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// --- GET /v1/workouts (+ /{id}) — keyset-paginated workout list ---

func (s *Server) GetWorkouts(w http.ResponseWriter, r *http.Request, params api.GetWorkoutsParams) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	cursor := ""
	if params.Cursor != nil {
		cursor = *params.Cursor
	}
	limit := 0
	if params.Limit != nil {
		limit = *params.Limit
	}
	page, err := s.workouts.List(r.Context(), uid, cursor, limit)
	if err != nil {
		problem(w, http.StatusBadRequest, "Workouts failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) GetWorkoutsId(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	wk, err := s.workouts.Get(r.Context(), uid, uuid.UUID(id))
	if err != nil {
		problem(w, http.StatusInternalServerError, "Query failed", err.Error())
		return
	}
	if wk == nil {
		problem(w, http.StatusNotFound, "No such workout", "")
		return
	}
	writeJSON(w, http.StatusOK, *wk)
}

// --- GET /v1/samples — raw samples, keyset-paginated ---
//
// `data_type` is required on purpose: without a filter this endpoint would be a
// scan of the entire hypertable, and a stream of mixed-type samples tells the
// client nothing anyway.

func (s *Server) GetSamples(w http.ResponseWriter, r *http.Request, params api.GetSamplesParams) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	if params.DataType == "" {
		problem(w, http.StatusBadRequest, "Missing parameter", "data_type is required")
		return
	}
	if params.From != nil && params.To != nil && !params.To.After(*params.From) {
		problem(w, http.StatusBadRequest, "Invalid time span", "`to` must be later than `from`")
		return
	}
	q := samples.Query{DataType: params.DataType, From: params.From, To: params.To}
	if params.Cursor != nil {
		q.Cursor = *params.Cursor
	}
	if params.Limit != nil {
		q.Limit = *params.Limit
	}
	page, err := s.samples.List(r.Context(), uid, q)
	if err != nil {
		problem(w, http.StatusBadRequest, "Samples failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// --- GET /v1/sleep — sleep segments (timezone-aware window) ---

func (s *Server) GetSleep(w http.ResponseWriter, r *http.Request, params api.GetSleepParams) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	loc := s.resolveLoc(r.Context(), uid, params.Tz)
	start, endExcl := dayWindow(loc, params.From, params.To, 7)

	rows, err := s.q.ListSleepSegments(r.Context(), db.ListSleepSegmentsParams{
		UserID: pgconv.UUID(uid),
		FromTs: pgconv.Timestamptz(start),
		ToTs:   pgconv.Timestamptz(endExcl),
	})
	if err != nil {
		problem(w, http.StatusInternalServerError, "Query failed", err.Error())
		return
	}
	out := make([]api.SleepSegment, 0, len(rows))
	for _, sl := range rows {
		st, en, stage := sl.StartedAt.Time, sl.EndedAt.Time, sl.Stage
		out = append(out, api.SleepSegment{StartedAt: &st, EndedAt: &en, Stage: &stage})
	}
	writeJSON(w, http.StatusOK, out)
}

// --- GET/PUT /v1/goals — daily goals (steps + rings) ---

func (s *Server) GetGoals(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	rows, err := s.q.ListGoals(r.Context(), pgconv.UUID(uid))
	if err != nil {
		problem(w, http.StatusInternalServerError, "Query failed", err.Error())
		return
	}
	out := make([]api.Goal, 0, len(rows))
	for _, g := range rows {
		out = append(out, goalDTO(g))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) PutGoals(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	var body api.GoalUpdate
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Metric == "" {
		problem(w, http.StatusBadRequest, "Malformed request", "metric + target_value are required")
		return
	}
	source := "user"
	if body.Source != nil {
		source = string(*body.Source)
	}
	var hk *float64
	if body.HkValue != nil {
		v := float64(*body.HkValue)
		hk = &v
	}
	g, err := s.q.UpsertGoal(r.Context(), db.UpsertGoalParams{
		UserID:      pgconv.UUID(uid),
		Metric:      string(body.Metric),
		TargetValue: float64(body.TargetValue),
		Unit:        goalUnit(string(body.Metric)),
		Source:      source,
		HkValue:     hk,
	})
	if err != nil {
		problem(w, http.StatusInternalServerError, "Saving goal failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, goalDTO(g))
}

// --- read helpers ---

// resolveLoc resolves a time.Location in the order requested tz (param) →
// user.time_zone → UTC.
func (s *Server) resolveLoc(ctx context.Context, uid uuid.UUID, param *string) *time.Location {
	tz := ""
	if param != nil {
		tz = *param
	}
	if tz == "" {
		if u, err := s.q.GetUser(ctx, pgconv.UUID(uid)); err == nil && u.TimeZone != "" {
			tz = u.TimeZone
		}
	}
	if loc, err := time.LoadLocation(tz); err == nil {
		return loc
	}
	return time.UTC
}

// dayWindow returns a [start, endExclusive) day window in the given timezone;
// from/to override it. By default the last defaultDays days (today included).
func dayWindow(loc *time.Location, from, to *openapi_types.Date, defaultDays int) (start, endExcl time.Time) {
	now := time.Now().In(loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	start = today.AddDate(0, 0, -(defaultDays - 1))
	endExcl = today.AddDate(0, 0, 1)
	if from != nil {
		d := from.Time
		start = time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, loc)
	}
	if to != nil {
		d := to.Time
		endExcl = time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, 1)
	}
	return start, endExcl
}

func goalDTO(g db.Goal) api.Goal {
	metric := api.GoalMetric(g.Metric)
	source := api.GoalSource(g.Source)
	tv := float32(g.TargetValue)
	unit := g.Unit
	out := api.Goal{Metric: &metric, Source: &source, TargetValue: &tv, Unit: &unit, HkValue: f64to32(g.HkValue)}
	if g.UpdatedAt.Valid {
		t := g.UpdatedAt.Time
		out.UpdatedAt = &t
	}
	return out
}

// goalUnit is the SI unit belonging to the metric (docs/03 §2.1).
func goalUnit(metric string) string {
	switch metric {
	case "stepCount":
		return "count"
	case "activeEnergy":
		return "kcal"
	case "exerciseTime":
		return "min"
	case "standHours":
		return "hour"
	default:
		return ""
	}
}

func f64to32(v *float64) *float32 {
	if v == nil {
		return nil
	}
	f := float32(*v)
	return &f
}

// --- GET /v1/insights — rule-based observations ---
//
// No LLM: a rolling average, a z-score and a correlation (docs/20 B7, docs/22
// §2.2). An empty list is a full answer — it means there is not yet enough data
// for a statement, and in that case the correct behaviour is silence.

func (s *Server) GetInsights(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	loc := s.resolveLoc(r.Context(), uid, nil)
	out, err := s.insights.Compute(r.Context(), uid, loc)
	if err != nil {
		problem(w, http.StatusInternalServerError, "Insights failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}
