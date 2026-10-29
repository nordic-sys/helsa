package server

import (
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/google/uuid"

	"github.com/nordic-sys/helsa/backend/internal/auth"
)

// contractOperations reads every "METHOD /path" out of the contract itself, so that
// the test does not trust a list somebody typed.
func contractOperations(t *testing.T) []string {
	t.Helper()
	doc, err := openapi3.NewLoader().LoadFromFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatalf("load openapi.yaml: %v", err)
	}
	var ops []string
	for path, item := range doc.Paths.Map() {
		for method := range item.Operations() {
			ops = append(ops, strings.ToUpper(method)+" "+path)
		}
	}
	sort.Strings(ops)
	return ops
}

// Every operation of the contract has a row, and every row is an operation of the
// contract. A new endpoint without a decision about who may call it fails here.
func TestEveryOperationHasAnAccessRule(t *testing.T) {
	ops := contractOperations(t)
	if len(ops) < 30 {
		t.Fatalf("read only %d operations from openapi.yaml — is the loader reading the right file?", len(ops))
	}
	inContract := map[string]bool{}
	for _, op := range ops {
		inContract[op] = true
		if _, ok := routes[op]; !ok {
			t.Errorf("%s is in openapi.yaml but has no row in authz.go — decide who may call it", op)
		}
	}
	for key := range routes {
		if !inContract[key] {
			t.Errorf("authz.go has a row for %s, which openapi.yaml does not define", key)
		}
	}
}

func TestEveryRuleSaysWhy(t *testing.T) {
	for _, table := range []map[string]rule{routes, handWired} {
		for key, r := range table {
			if r.Access == 0 {
				t.Errorf("%s: no Access", key)
			}
			if strings.TrimSpace(r.Why) == "" {
				t.Errorf("%s: no Why", key)
			}
			if r.Access == Subject && r.Scope == ScopeNone {
				t.Errorf("%s reads data but names no scope — F2's shares would have nothing to check", key)
			}
			if r.Access != Subject && r.Scope != ScopeNone {
				t.Errorf("%s has a scope but is not a Subject read", key)
			}
		}
	}
}

// Writes never go to the Subject (docs/36 §2.4): a non-GET operation is never a
// Subject read.
func TestNoWriteIsASubjectRead(t *testing.T) {
	for key, r := range routes {
		if !strings.HasPrefix(key, "GET ") && r.Access == Subject {
			t.Errorf("%s is a write marked Subject — writes act for the Principal only", key)
		}
	}
}

func TestRuleForMatchesTemplates(t *testing.T) {
	cases := map[string]Access{
		"GET /v1/workouts/" + uuid.NewString() + "/route": Subject,
		"GET /v1/workouts/" + uuid.NewString():            Subject,
		"POST /v1/ingest/dead-letter/redrive":             Admin,
		"POST /v1/auth/refresh":                           Public,
		"GET /v1/tiles/3/4/5":                             Principal,
	}
	for req, want := range cases {
		m, p, _ := strings.Cut(req, " ")
		r, ok := ruleFor(m, p)
		if !ok || r.Access != want {
			t.Errorf("%s → %+v, %v; want %v", req, r, ok, want)
		}
	}
	for _, req := range []string{"GET /v1/workouts//route", "GET /v1/nope", "DELETE /v1/settings", "GET /workouts"} {
		m, p, _ := strings.Cut(req, " ")
		if r, ok := ruleFor(m, p); ok {
			t.Errorf("%s matched %+v", req, r)
		}
	}
}

// The table is enforced, not only written: a member gets 403 on an Admin row and
// reaches the handler on the rest.
func TestRequireAccessEnforcesAdminRows(t *testing.T) {
	reached := false
	h := requireAccess(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached = true
		w.WriteHeader(http.StatusNoContent)
	}))
	call := func(role auth.Role, method, path string) int {
		reached = false
		ctx := auth.WithPrincipal(t.Context(), auth.Principal{UserID: uuid.New(), Role: role})
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(method, path, nil).WithContext(ctx))
		return rec.Code
	}
	if got := call(auth.RoleMember, http.MethodPost, "/v1/ingest/dead-letter/redrive"); got != http.StatusForbidden || reached {
		t.Errorf("member redrive: %d (reached handler: %v)", got, reached)
	}
	if got := call(auth.RoleAdmin, http.MethodPost, "/v1/ingest/dead-letter/redrive"); got != http.StatusNoContent || !reached {
		t.Errorf("admin redrive: %d", got)
	}
	if got := call(auth.RoleMember, http.MethodGet, "/v1/ingest/status"); got != http.StatusNoContent || !reached {
		t.Errorf("member status: %d", got)
	}
}

// Personal answers are never kept by an HTTP cache; the map tiles may be (S10).
func TestPersonalAnswersAreNotCached(t *testing.T) {
	h := noStore(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	for path, want := range map[string]string{"/v1/me": "no-store", "/v1/summary": "no-store", "/v1/tiles/1/2/3": "", "/healthz": ""} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if got := rec.Header().Get("Cache-Control"); got != want {
			t.Errorf("%s: Cache-Control %q, want %q", path, got, want)
		}
	}
}
