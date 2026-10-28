package server

import (
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/nordic-sys/helsa/backend/internal/auth"
)

// # Who may call what (docs/36 §9, C1)
//
// Every operation of the contract is in this table, once, with the answer to three
// questions:
//
//   - Access: is it public, does it act for the caller (Principal), does it read
//     somebody's data (Subject), or is it for admins only?
//   - Scope: for a Subject read, which kind of data it opens. On a v1 server every
//     read is of one's own data and the scope changes nothing; from F2 on a share is
//     "metrics" or "metrics_and_journal", and a read is allowed only if the share
//     covers its scope. It is written down now so that F2 cannot forget an endpoint.
//   - Why: one line, for the reader and for the review.
//
// ⚠️ The table is not documentation. authGate enforces Admin from it, and the test
// (authz_test.go) fails if an operation of openapi.yaml is missing here, or if a row
// here names an operation the contract does not have. A new endpoint therefore
// cannot ship without somebody deciding, in this file, who may call it.
type Access int

const (
	// Public: no token. Health probes and the retired refresh.
	Public Access = iota + 1
	// Principal: acts for the caller — their account, session, devices, settings,
	// and every WRITE. Never redirected to another user, not even in F2.
	Principal
	// Subject: reads data. v1: the caller's own; F2: a share or a guardianship may
	// make it somebody else's, within Scope.
	Subject
	// Admin: the server's admins only (auth.RequireAdmin).
	Admin
)

// Scope is the kind of data a Subject read opens.
type Scope int

const (
	ScopeNone    Scope = iota
	ScopeMetrics       // measurements: samples, workouts, sleep, rings, goals, badges
	ScopeJournal       // the journal: symptoms, moods, heart-rhythm alerts — the most sensitive
)

type rule struct {
	Access Access
	Scope  Scope
	Why    string
}

// routes is keyed "METHOD /path" with the path as the contract writes it, without
// the /v1 prefix.
var routes = map[string]rule{
	"GET /healthz":       {Public, ScopeNone, "liveness probe"},
	"GET /readyz":        {Public, ScopeNone, "readiness probe"},
	"POST /auth/refresh": {Public, ScopeNone, "retired, answers 410"},

	"POST /auth/logout":   {Principal, ScopeNone, "revokes the caller's own token"},
	"GET /me":             {Principal, ScopeNone, "the caller's own profile — never the viewed person's"},
	"GET /settings":       {Principal, ScopeNone, "the caller's own settings"},
	"PUT /settings":       {Principal, ScopeNone, "write"},
	"GET /devices":        {Principal, ScopeNone, "device management is the caller's own"},
	"POST /devices":       {Principal, ScopeNone, "write"},
	"POST /ingest":        {Principal, ScopeNone, "write: uploads go to the caller"},
	"POST /journal":       {Principal, ScopeNone, "write"},
	"DELETE /journal":     {Principal, ScopeNone, "write"},
	"PUT /goals":          {Principal, ScopeNone, "write"},
	"POST /achievements":  {Principal, ScopeNone, "write"},
	"PUT /push/prefs":     {Principal, ScopeNone, "write"},
	"POST /push/register": {Principal, ScopeNone, "write"},
	"POST /export":        {Principal, ScopeNone, "an export is the caller's own data, in full (§2.5) — not a shared read"},
	"GET /ingest/status":  {Principal, ScopeNone, "a member sees their own batches and the queue as numbers; an admin all"},

	"POST /ingest/dead-letter/redrive": {Admin, ScopeNone, "moves every member's stuck batches"},

	// The household (docs/36 F1). Account operations act for the caller; the admin
	// rows manage accounts and never read a member's data (and the database holds
	// them to that: the admin policies exist on the account tables only).
	"PATCH /me":                                 {Principal, ScopeNone, "the caller's own display name"},
	"DELETE /me":                                {Principal, ScopeNone, "the caller's own account; the last admin is refused"},
	"GET /me/tokens":                            {Principal, ScopeNone, "the caller's own devices and sessions"},
	"DELETE /me/tokens/{id}":                    {Principal, ScopeNone, "one of the caller's own; another's id is 404"},
	"POST /me/enrolment-codes":                  {Principal, ScopeNone, "a code for the caller's own next phone"},
	"POST /me/login-codes":                      {Principal, ScopeNone, "a code for the caller's own browser"},
	"GET /me/events":                            {Principal, ScopeNone, "the caller's own account log"},
	"POST /enroll":                              {Public, ScopeNone, "the code is the credential; mTLS port only; rate-limited"},
	"POST /auth/web/login":                      {Public, ScopeNone, "the code is the credential; web port and own Origin only; rate-limited"},
	"POST /auth/web/logout":                     {Principal, ScopeNone, "ends the caller's own browser session"},
	"GET /admin/users":                          {Admin, ScopeNone, "account metadata of every member, no health data"},
	"POST /admin/users":                         {Admin, ScopeNone, "add a member"},
	"GET /admin/users/{id}":                     {Admin, ScopeNone, "one member's account metadata"},
	"PATCH /admin/users/{id}":                   {Admin, ScopeNone, "role, disable, rename; keeps one enabled admin"},
	"DELETE /admin/users/{id}":                  {Admin, ScopeNone, "queue a member's deletion; keeps one enabled admin"},
	"GET /admin/users/{id}/tokens":              {Admin, ScopeNone, "a member's devices and sessions"},
	"DELETE /admin/users/{id}/tokens/{tokenId}": {Admin, ScopeNone, "revoke a member's device; the token must be theirs"},
	"GET /admin/users/{id}/events":              {Admin, ScopeNone, "the member's account log, as the member sees it"},
	"POST /admin/users/{id}/codes":              {Admin, ScopeNone, "only for a member with no live device (C2)"},

	"GET /achievements":        {Subject, ScopeMetrics, "badges"},
	"GET /activity":            {Subject, ScopeMetrics, "rings"},
	"GET /baseline":            {Subject, ScopeMetrics, "usual range"},
	"GET /challenge":           {Subject, ScopeMetrics, "monthly challenge"},
	"GET /coverage":            {Subject, ScopeMetrics, "which types arrive, from which sources"},
	"GET /export/{id}":         {Subject, ScopeMetrics, "always 404 today"},
	"GET /goals":               {Subject, ScopeMetrics, "goals"},
	"GET /insights":            {Subject, ScopeMetrics, "observations"},
	"GET /latest":              {Subject, ScopeMetrics, "newest value per type"},
	"GET /samples":             {Subject, ScopeMetrics, "raw series"},
	"GET /sleep":               {Subject, ScopeMetrics, "sleep"},
	"GET /summary":             {Subject, ScopeMetrics, "aggregates"},
	"GET /workout-intensity":   {Subject, ScopeMetrics, "heart-rate zones"},
	"GET /workouts":            {Subject, ScopeMetrics, "workouts"},
	"GET /workouts/{id}":       {Subject, ScopeMetrics, "one workout; another user's id is 404, not 403"},
	"GET /workouts/{id}/route": {Subject, ScopeMetrics, "a route; another user's id is 404, not 403"},
	"GET /journal":             {Subject, ScopeJournal, "the journal — only under a journal scope in F2"},
}

// handWired are the /v1 routes outside the contract (server.go wires them itself).
// They are in the table for the same reason as the rest: nothing is reachable
// without a row.
var handWired = map[string]rule{
	"GET /tiles/{z}/{x}/{y}": {Principal, ScopeNone, "map tiles; no health data"},
}

// ruleFor finds the rule of a request. path is the full URL path, /v1 included.
func ruleFor(method, path string) (rule, bool) {
	p, ok := strings.CutPrefix(path, "/v1")
	if !ok {
		return rule{}, false
	}
	for _, table := range []map[string]rule{routes, handWired} {
		for key, r := range table {
			m, tmpl, _ := strings.Cut(key, " ")
			if m == method && matchTemplate(tmpl, p) {
				return r, true
			}
		}
	}
	return rule{}, false
}

// matchTemplate matches "/workouts/{id}/route" against "/workouts/abc/route".
func matchTemplate(tmpl, path string) bool {
	ts := strings.Split(strings.Trim(tmpl, "/"), "/")
	ps := strings.Split(strings.Trim(path, "/"), "/")
	if len(ts) != len(ps) {
		return false
	}
	for i, t := range ts {
		if strings.HasPrefix(t, "{") && strings.HasSuffix(t, "}") {
			if ps[i] == "" {
				return false
			}
			continue
		}
		if t != ps[i] {
			return false
		}
	}
	return true
}

// requireAccess enforces the table on an authenticated request: an Admin row goes
// through auth.RequireAdmin, the rest pass. A path with no row passes too — the
// router behind answers it with 404, as before; the test makes sure every real
// operation HAS a row.
func requireAccess(next http.Handler) http.Handler {
	admin := auth.RequireAdmin(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if rl, ok := ruleFor(r.Method, r.URL.Path); ok && rl.Access == Admin {
			admin.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// principalID is the caller of a Principal operation (an account action or a
// write). It is a separate helper from auth.UserID — which is the Subject of a
// read — so that a handler says which one it means, and F2 can turn the Subject
// into somebody else without a write following it there.
func principalID(r *http.Request) (uuid.UUID, bool) {
	p, ok := auth.PrincipalFrom(r.Context())
	return p.UserID, ok
}
