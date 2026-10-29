//go:build smoke

package smoke

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// # Two people, one server (docs/36 §4.7, tightened by the review §9, C18)
//
// The most important test of the household work: Bob's token must never bring back
// a single thing of Nóri's, and the other way round.
//
// How it avoids passing without testing anything:
//
//   - Every operation of openapi.yaml must have a case here, read from the contract
//     itself; an operation without one fails the test.
//   - A case calls the operation with VALID parameters and expects the status it
//     names — a templated path or a missing parameter would answer 400 and contain
//     nothing to leak, which is how a naive version passes.
//   - Where the fixture gives the endpoint something to say, the case names what of
//     the caller's OWN data must be in the answer. A read that comes back empty
//     proves nothing; one that shows mine and not yours does.
//   - The other person is looked for by VALUE, not only by id: the samples endpoint
//     deliberately carries no source UUIDs, and a leaked aggregate carries none
//     either. Every fixture value is distinctive enough to search for.
//   - Every read runs twice — cold, and with the summary cache warm.
//   - The export is read to its end.
//   - Writes are checked from the other side: what A deletes or changes, B still has.

type person struct {
	name    string
	sub     string
	token   string
	userID  uuid.UUID
	tz      string
	steps   float32 // one sample, so the day's total is exactly this
	hr      float32
	energy  float32 // activity ring
	goal    float32 // active-energy goal
	lat     float64 // the route's first point
	device  uuid.UUID
	workout uuid.UUID
	batch   uuid.UUID
}

// markers are the strings that identify this person's data in any response.
func (p *person) markers() []string {
	m := []string{
		p.sub, p.userID.String(), p.tz,
		fmt.Sprint(p.steps), fmt.Sprint(p.hr), fmt.Sprint(p.energy), fmt.Sprint(p.goal), fmt.Sprint(p.lat),
	}
	for _, id := range []uuid.UUID{p.device, p.workout, p.batch} {
		if id != uuid.Nil {
			m = append(m, id.String())
		}
	}
	return m
}

func addPerson(t *testing.T, e *env, name, tz string, steps, hr, energy, goal float32, lat float64) *person {
	t.Helper()
	ctx := context.Background()
	sub := fmt.Sprintf("iso-%s-%d", name, time.Now().UnixNano())
	u, err := db.New(e.store.DB).UpsertUserByHandle(ctx, db.UpsertUserByHandleParams{Handle: sub})
	must(t, err, "create "+name)
	sess, err := auth.New(e.cfg, e.store.DB, e.store.Redis).IssueDeviceToken(ctx, pgconv.ToUUID(u.ID), sub+"-tok", uuid.Nil)
	must(t, err, "token for "+name)
	return &person{name: name, sub: sub, token: sess.AccessToken, userID: pgconv.ToUUID(u.ID), tz: tz,
		steps: steps, hr: hr, energy: energy, goal: goal, lat: lat}
}

// upload puts the person's whole fixture onto the server through the API, the way
// a phone would.
func (p *person) upload(t *testing.T, c *apiClient, covered map[string]bool) {
	t.Helper()
	tz := p.tz
	expect := func(op string, got, want int) {
		t.Helper()
		covered[op] = true
		if got != want {
			t.Fatalf("%s as %s: %d, want %d", op, p.name, got, want)
		}
	}

	expect("PUT /settings", c.do(t, http.MethodPut, "/v1/settings", p.token, api.Settings{TimeZone: &tz}, nil), 200)

	var dev api.Device
	expect("POST /devices", c.do(t, http.MethodPost, "/v1/devices", p.token, api.Device{
		Platform: "ios", Model: ptr("iPhone17,1"), Name: ptr(p.sub + "-phone"), TimeZone: &tz,
	}, &dev), 200)
	p.device = uuid.UUID(*dev.Id)

	now := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Millisecond)
	wkSrc := p.sub + "-wk"
	hr := sample(p.sub, "heartRate", "count/min", now, p.hr, 2)
	hr.WorkoutSourceUuid = &wkSrc
	samples := []api.SampleIn{sample(p.sub, "stepCount", "count", now, p.steps, 1), hr}
	end := now.Add(30 * time.Minute)
	route := []api.RoutePoint{{Ts: now, Lat: p.lat, Lon: 19.0402}, {Ts: now.Add(time.Minute), Lat: p.lat + 0.001, Lon: 19.0410}}
	workouts := []api.WorkoutIn{{SourceUuid: wkSrc, ActivityType: "running", StartedAt: now, EndedAt: &end, Route: &route}}
	sleeps := []api.SleepSegmentIn{{SourceUuid: p.sub + "-sl", StartedAt: now.Add(-8 * time.Hour), EndedAt: now.Add(-7 * time.Hour), Stage: "asleepCore"}}
	// The person's own calendar day: a UTC date can be "tomorrow" in their zone (at
	// 03:00 in Budapest, the UTC day is already tomorrow in Chicago), and the
	// activity read rightly leaves a future day out.
	day := openapi_types.Date{Time: now.In(mustLoc(t, p.tz))}
	rings := []api.ActivitySummary{{Day: &day, ActiveEnergy: &p.energy}}
	var acc api.IngestAccepted
	expect("POST /ingest", c.do(t, http.MethodPost, "/v1/ingest", p.token, api.IngestBatch{
		DeviceId: dev.Id, TimeZone: &tz, Samples: &samples, Workouts: &workouts, SleepSegments: &sleeps, ActivitySummaries: &rings,
	}, &acc), 202)
	p.batch = uuid.UUID(*acc.BatchId)

	value := 2
	expect("POST /journal", c.do(t, http.MethodPost, "/v1/journal", p.token, api.JournalBatch{Entries: &[]api.JournalEntryIn{{
		SourceUuid: p.sub + "-j1", DataType: "headache", StartedAt: now, EndedAt: now, Value: &value,
	}}}, nil), 200)

	expect("PUT /goals", c.do(t, http.MethodPut, "/v1/goals", p.token, api.GoalUpdate{
		Metric: api.GoalUpdateMetricActiveEnergy, TargetValue: p.goal,
	}, nil), 200)

	expect("POST /achievements", c.do(t, http.MethodPost, "/v1/achievements", p.token, []api.AchievementInput{{
		Id: p.sub + "-badge", Code: p.sub + "-badge", Kind: "record", EarnedAt: now,
	}}, nil), 200)

	expect("PUT /push/prefs", c.do(t, http.MethodPut, "/v1/push/prefs", p.token, api.NotifPrefs{Insights: ptr(true)}, nil), 200)
	expect("POST /push/register", c.do(t, http.MethodPost, "/v1/push/register", p.token, api.PushRegister{
		Platform: "ios", Token: p.sub + "-apns", DeviceId: dev.Id,
	}, nil), 204)
}

// readCase is one read, called as `who`, with what must be in the answer.
type readCase struct {
	op     string // "METHOD /path" as the contract writes it
	path   func(p *person) string
	status int
	// own: at least one of these of the caller's must appear. Empty only with a
	// reason in `why` — an empty answer is otherwise a test that proves nothing.
	own func(p *person) []string
	why string
}

func TestTwoPeopleSeeOnlyTheirOwnData(t *testing.T) {
	e := newEnv(t)
	c := e.client
	covered := map[string]bool{}

	a := addPerson(t, e, "a", "Europe/Budapest", 412347, 61.37, 451.5, 1234.5, 47.1111)
	b := addPerson(t, e, "b", "America/Chicago", 523459, 87.29, 612.75, 2345.5, 46.2222)
	a.upload(t, c, covered)
	b.upload(t, c, covered)
	waitForSteps(t, e, a)
	waitForSteps(t, e, b)

	// The workout ids exist only after the worker has written them.
	for _, p := range []*person{a, b} {
		var page api.WorkoutPage
		if st := c.do(t, http.MethodGet, "/v1/workouts?limit=10", p.token, nil, &page); st != 200 || page.Items == nil || len(*page.Items) != 1 {
			t.Fatalf("workouts of %s: %d %+v", p.name, st, page)
		}
		p.workout = uuid.UUID(*(*page.Items)[0].Id)
	}

	today := func(p *person) string { return time.Now().In(mustLoc(t, p.tz)).AddDate(0, 0, -3).Format("2006-01-02") }
	since := func(p *person) string { return time.Now().UTC().Add(-48 * time.Hour).Format(time.RFC3339) }
	until := func(p *person) string { return time.Now().UTC().Add(time.Hour).Format(time.RFC3339) }
	none := func(*person) []string { return nil }

	reads := []readCase{
		{op: "GET /healthz", path: func(*person) string { return "/v1/healthz" }, status: 200, own: none, why: "a probe"},
		{op: "GET /readyz", path: func(*person) string { return "/v1/readyz" }, status: 200, own: none, why: "a probe"},
		{op: "GET /me", path: func(*person) string { return "/v1/me" }, status: 200,
			own: func(p *person) []string { return []string{p.userID.String()} }},
		{op: "GET /settings", path: func(*person) string { return "/v1/settings" }, status: 200,
			own: func(p *person) []string { return []string{p.tz} }},
		{op: "GET /devices", path: func(*person) string { return "/v1/devices" }, status: 200,
			own: func(p *person) []string { return []string{p.device.String()} }},
		{op: "GET /achievements", path: func(*person) string { return "/v1/achievements" }, status: 200,
			own: func(p *person) []string { return []string{p.sub + "-badge"} }},
		{op: "GET /activity", path: func(p *person) string { return "/v1/activity?from=" + today(p) + "&tz=" + p.tz }, status: 200,
			own: func(p *person) []string { return []string{fmt.Sprint(p.energy)} }},
		{op: "GET /goals", path: func(*person) string { return "/v1/goals" }, status: 200,
			own: func(p *person) []string { return []string{fmt.Sprint(p.goal)} }},
		{op: "GET /latest", path: func(p *person) string { return "/v1/latest?metrics=stepCount,heartRate&tz=" + p.tz }, status: 200,
			own: func(p *person) []string { return []string{fmt.Sprint(p.steps)} }},
		{op: "GET /samples", path: func(*person) string { return "/v1/samples?data_type=stepCount&limit=50" }, status: 200,
			own: func(p *person) []string { return []string{fmt.Sprint(p.steps)} }},
		{op: "GET /summary", path: func(p *person) string { return "/v1/summary?range=week&metrics=stepCount,heartRate&tz=" + p.tz }, status: 200,
			own: func(p *person) []string { return []string{fmt.Sprint(p.steps)} }},
		{op: "GET /sleep", path: func(p *person) string { return "/v1/sleep?from=" + today(p) + "&tz=" + p.tz }, status: 200,
			own: none, why: "nothing distinctive to search for; checked by COUNT below (exactly the caller's one segment)"},
		{op: "GET /journal", path: func(p *person) string { return "/v1/journal?from=" + today(p) + "&tz=" + p.tz }, status: 200,
			own: func(p *person) []string { return []string{p.sub + "-j1"} }},
		{op: "GET /workouts", path: func(*person) string { return "/v1/workouts?limit=10" }, status: 200,
			own: func(p *person) []string { return []string{p.workout.String()} }},
		{op: "GET /workouts/{id}", path: func(p *person) string { return "/v1/workouts/" + p.workout.String() }, status: 200,
			own: func(p *person) []string { return []string{p.workout.String()} }},
		{op: "GET /workouts/{id}/route", path: func(p *person) string { return "/v1/workouts/" + p.workout.String() + "/route" }, status: 200,
			own: func(p *person) []string { return []string{fmt.Sprint(p.lat)} }},
		{op: "GET /workout-intensity", path: func(p *person) string { return "/v1/workout-intensity?from=" + since(p) + "&to=" + until(p) }, status: 200,
			own: none, why: "zone minutes from two heart-rate samples are not distinctive; the leak check still runs"},
		{op: "GET /coverage", path: func(p *person) string { return "/v1/coverage?from=" + today(p) + "&tz=" + p.tz }, status: 200,
			own: none, why: "lists data types, which both fixtures share; the leak check still runs"},
		{op: "GET /challenge", path: func(p *person) string { return "/v1/challenge?tz=" + p.tz }, status: 200,
			own: func(p *person) []string { return []string{fmt.Sprint(p.steps)} }},
		{op: "GET /baseline", path: func(p *person) string { return "/v1/baseline?range=month&metrics=stepCount&tz=" + p.tz }, status: 200,
			own: none, why: "a baseline needs weeks of history the fixture does not have"},
		{op: "GET /insights", path: func(*person) string { return "/v1/insights" }, status: 200,
			own: none, why: "the rules need weeks of history the fixture does not have"},
		{op: "GET /ingest/status", path: func(*person) string { return "/v1/ingest/status" }, status: 200,
			own: none, why: "the queue is empty by now; a member's view is checked for the other's batch id"},
		{op: "GET /me/tokens", path: func(*person) string { return "/v1/me/tokens" }, status: 200,
			own: func(p *person) []string { return []string{p.sub + "-tok"} }},
		{op: "GET /me/events", path: func(*person) string { return "/v1/me/events" }, status: 200,
			own: none, why: "the fixture's accounts have no events; TestHouseholdFlow reads a member's log with entries"},
		{op: "GET /export/{id}", path: func(*person) string { return "/v1/export/" + uuid.NewString() }, status: 404,
			own: none, why: "always 404 — the export is synchronous (POST /export)"},
	}

	for _, label := range []string{"cold", "warm"} {
		for _, rc := range reads {
			covered[rc.op] = true
			for _, pair := range [][2]*person{{a, b}, {b, a}} {
				me, other := pair[0], pair[1]
				body, _, st := c.raw(t, http.MethodGet, rc.path(me), me.token, nil)
				if st != rc.status {
					t.Errorf("[%s] %s as %s: %d, want %d — %.200s", label, rc.op, me.name, st, rc.status, body)
					continue
				}
				checkNoLeak(t, fmt.Sprintf("[%s] %s as %s", label, rc.op, me.name), string(body), other)
				if own := rc.own(me); len(own) > 0 && !containsAny(string(body), own) {
					t.Errorf("[%s] %s as %s: none of the caller's own %v in the answer — the case proves nothing: %.300s",
						label, rc.op, me.name, own, body)
				} else if len(own) == 0 && rc.why == "" {
					t.Errorf("%s has no own-data check and no reason why", rc.op)
				}
			}
		}
	}

	// The export, read to its end and decoded whole: a document cut short after the
	// samples would otherwise pass on what it did contain (Codex R6).
	covered["POST /export"] = true
	for _, pair := range [][2]*person{{a, b}, {b, a}} {
		me, other := pair[0], pair[1]
		body, _, st := c.raw(t, http.MethodPost, "/v1/export", me.token, map[string]any{"format": "json"})
		if st != 200 {
			t.Fatalf("export as %s: %d %.200s", me.name, st, body)
		}
		checkNoLeak(t, "POST /export as "+me.name, string(body), other)
		var doc map[string]json.RawMessage
		if err := json.Unmarshal(body, &doc); err != nil {
			t.Fatalf("export as %s is not one complete JSON document: %v", me.name, err)
		}
		for section, want := range map[string]string{"samples": fmt.Sprint(me.steps), "workouts": me.sub + "-wk"} {
			if !strings.Contains(string(doc[section]), want) {
				t.Errorf("export as %s: section %q lacks the caller's own %q", me.name, section, want)
			}
		}
		// An exported sleep segment carries no id (start, end, stage), so: by count.
		var sleep []json.RawMessage
		if err := json.Unmarshal(doc["sleep_segments"], &sleep); err != nil || len(sleep) != 1 {
			t.Errorf("export as %s: %d sleep segments (%v), want exactly their own one", me.name, len(sleep), err)
		}
	}

	// The summary cache, asked the SAME question by both — identical range, metrics and
	// timezone — in both warming orders. Different timezones would keep their cache
	// keys apart even if the key forgot the user (Codex R5).
	same := "/v1/summary?range=week&metrics=stepCount&tz=UTC"
	for _, order := range [][2]*person{{a, b}, {b, a}, {a, b}} {
		for _, me := range order {
			other := a
			if me == a {
				other = b
			}
			body, _, st := c.raw(t, http.MethodGet, same, me.token, nil)
			if st != 200 || !strings.Contains(string(body), fmt.Sprint(me.steps)) {
				t.Errorf("same-key summary as %s: %d, own steps missing — %.200s", me.name, st, body)
			}
			checkNoLeak(t, "same-key summary as "+me.name, string(body), other)
		}
	}

	// Sleep, by count: each fixture has exactly one segment, and the DTO has nothing
	// distinctive to search for (Codex R4).
	for _, me := range []*person{a, b} {
		var segs []api.SleepSegment
		if st := c.do(t, http.MethodGet, "/v1/sleep?from="+today(me)+"&tz="+me.tz, me.token, nil, &segs); st != 200 || len(segs) != 1 {
			t.Errorf("sleep as %s: %d segments (status %d), want exactly their own one", me.name, len(segs), st)
		}
	}

	// Another person's ids answer 404, not 403: whether it exists is not for the
	// caller to learn.
	for _, path := range []string{"/v1/workouts/" + b.workout.String(), "/v1/workouts/" + b.workout.String() + "/route"} {
		if body, _, st := c.raw(t, http.MethodGet, path, a.token, nil); st != http.StatusNotFound {
			t.Errorf("a's token on b's %s: %d, want 404 — %.200s", path, st, body)
		}
	}

	// Writes act for the caller only: what a deletes or changes, b still has.
	covered["DELETE /journal"] = true
	if st := c.do(t, http.MethodDelete, "/v1/journal", a.token, nil, nil); st != 200 {
		t.Fatalf("DELETE /journal as a: %d", st)
	}
	if body, _, _ := c.raw(t, http.MethodGet, "/v1/journal?from="+today(b)+"&tz="+b.tz, b.token, nil); !strings.Contains(string(body), b.sub+"-j1") {
		t.Errorf("a's DELETE /journal removed b's journal: %.300s", body)
	}
	if st := c.do(t, http.MethodPut, "/v1/goals", a.token, api.GoalUpdate{Metric: api.GoalUpdateMetricActiveEnergy, TargetValue: 999.5}, nil); st != 200 {
		t.Fatalf("PUT /goals as a: %d", st)
	}
	if body, _, _ := c.raw(t, http.MethodGet, "/v1/goals", b.token, nil); !strings.Contains(string(body), fmt.Sprint(b.goal)) || strings.Contains(string(body), "999.5") {
		t.Errorf("a's PUT /goals reached b's goals: %.300s", body)
	}

	// The admin-only row, enforced: a member is refused, an admin is not.
	covered["POST /ingest/dead-letter/redrive"] = true
	if st := c.do(t, http.MethodPost, "/v1/ingest/dead-letter/redrive", a.token, nil, nil); st != http.StatusForbidden {
		t.Errorf("redrive as a member: %d, want 403", st)
	}
	setRole(t, e, b, auth.RoleAdmin)
	if st := c.do(t, http.MethodPost, "/v1/ingest/dead-letter/redrive", b.token, map[string]any{"max": 1}, nil); st == http.StatusForbidden {
		t.Errorf("redrive as an admin: 403")
	}

	// A disabled member is refused on every route; enabled again, the same token works.
	setDisabled(t, e, a, true)
	if st := c.do(t, http.MethodGet, "/v1/me", a.token, nil, nil); st != http.StatusUnauthorized {
		t.Errorf("a disabled member's /me: %d, want 401", st)
	}
	setDisabled(t, e, a, false)
	if st := c.do(t, http.MethodGet, "/v1/me", a.token, nil, nil); st != 200 {
		t.Errorf("re-enabled member's /me: %d, want 200", st)
	}

	covered["POST /auth/refresh"] = true
	if st := c.do(t, http.MethodPost, "/v1/auth/refresh", "", map[string]any{"refresh_token": "x"}, nil); st != http.StatusGone {
		t.Errorf("refresh: %d, want 410", st)
	}

	// Logging out ends one's own token and nobody else's.
	covered["POST /auth/logout"] = true
	if st := c.do(t, http.MethodPost, "/v1/auth/logout", a.token, nil, nil); st != http.StatusNoContent {
		t.Fatalf("logout as a: %d", st)
	}
	if st := c.do(t, http.MethodGet, "/v1/me", a.token, nil, nil); st != http.StatusUnauthorized {
		t.Errorf("a's token after logout: %d, want 401", st)
	}
	if st := c.do(t, http.MethodGet, "/v1/me", b.token, nil, nil); st != 200 {
		t.Errorf("b's token after a's logout: %d, want 200", st)
	}

	// Nothing of the contract went untested.
	// The household's own operations are exercised by TestHouseholdFlow, which fails
	// if it skips any of householdOps.
	for _, op := range householdOps {
		covered[op] = true
	}
	var missing []string
	for _, op := range contractOperations(t) {
		if !covered[op] {
			missing = append(missing, op)
		}
	}
	if len(missing) > 0 {
		t.Errorf("operations of openapi.yaml with no isolation case: %v — add one here", missing)
	}
}

func checkNoLeak(t *testing.T, where, body string, other *person) {
	t.Helper()
	for _, m := range other.markers() {
		if strings.Contains(body, m) {
			t.Errorf("%s: the answer contains %q of %s's data — %.300s", where, m, other.name, body)
		}
	}
}

func containsAny(s string, subs []string) bool {
	for _, x := range subs {
		if strings.Contains(s, x) {
			return true
		}
	}
	return false
}

// waitForSteps waits for the worker by asking the database, not the API: an API
// read used for waiting would be part of what the test examines, and a leak in it
// would show up as a timeout instead of as the leak it is.
func waitForSteps(t *testing.T, e *env, p *person) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		err := e.store.DB.QueryRow(context.Background(),
			`SELECT count(*) FROM workouts WHERE user_id = $1`, p.userID).Scan(&n)
		if err == nil && n == 1 {
			return
		}
		time.Sleep(300 * time.Millisecond)
	}
	t.Fatalf("the worker never wrote %s's batch", p.name)
}

func setRole(t *testing.T, e *env, p *person, role auth.Role) {
	t.Helper()
	must(t, db.New(e.store.DB).SetUserRole(context.Background(), db.SetUserRoleParams{ID: pgconv.UUID(p.userID), Role: string(role)}), "set role")
}

func setDisabled(t *testing.T, e *env, p *person, disabled bool) {
	t.Helper()
	q := `UPDATE users SET disabled_at = NULL WHERE id = $1`
	if disabled {
		q = `UPDATE users SET disabled_at = now() WHERE id = $1`
	}
	_, err := e.store.DB.Exec(context.Background(), q, p.userID)
	must(t, err, "set disabled")
}

func mustLoc(t *testing.T, tz string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(tz)
	must(t, err, "tz")
	return loc
}

func contractOperations(t *testing.T) []string {
	t.Helper()
	doc, err := openapi3.NewLoader().LoadFromFile("../../api/openapi.yaml")
	must(t, err, "load openapi.yaml")
	var ops []string
	for path, item := range doc.Paths.Map() {
		for method := range item.Operations() {
			ops = append(ops, strings.ToUpper(method)+" "+path)
		}
	}
	sort.Strings(ops)
	if len(ops) < 30 {
		t.Fatalf("read only %d operations from openapi.yaml", len(ops))
	}
	return ops
}
