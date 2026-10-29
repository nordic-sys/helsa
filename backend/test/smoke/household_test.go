//go:build smoke

package smoke

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
)

// householdOps are the operations TestHouseholdFlow exercises — the isolation test
// counts them as covered, and this test fails if it does not call every one.
var householdOps = []string{
	"PATCH /me", "DELETE /me", "DELETE /me/tokens/{id}", "POST /me/enrolment-codes", "POST /me/login-codes",
	"POST /enroll", "POST /auth/web/login", "POST /auth/web/logout",
	"GET /admin/users", "POST /admin/users", "GET /admin/users/{id}", "PATCH /admin/users/{id}",
	"DELETE /admin/users/{id}", "GET /admin/users/{id}/tokens", "DELETE /admin/users/{id}/tokens/{tokenId}",
	"GET /admin/users/{id}/events", "POST /admin/users/{id}/codes",
}

// call is one request with full control over headers, for the cookie rules.
type call struct {
	method, path, bearer, cookie, origin, listener string
	body                                           any
}

func (c *apiClient) send(t *testing.T, x call) (*http.Response, []byte) {
	t.Helper()
	var rdr io.Reader
	if x.body != nil {
		b, err := json.Marshal(x.body)
		must(t, err, "marshal")
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(x.method, c.base+x.path, rdr)
	must(t, err, "request")
	if x.body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if x.bearer != "" {
		req.Header.Set("Authorization", "Bearer "+x.bearer)
	}
	if x.cookie != "" {
		req.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: x.cookie})
	}
	if x.origin != "" {
		req.Header.Set("Origin", x.origin)
	}
	if x.listener != "" {
		req.Header.Set("X-Helsa-Listener", x.listener)
	}
	resp, err := c.hc.Do(req)
	must(t, err, "do")
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, b
}

func resetRedeemCounters(t *testing.T, e *env) {
	t.Helper()
	ctx := context.Background()
	keys, _ := e.store.Redis.Keys(ctx, "helsa:redeem:attempts:*").Result()
	if len(keys) > 0 {
		e.store.Redis.Del(ctx, keys...)
	}
}

// One household, end to end (docs/36 §3, §5): the admin adds Nóri, gives her a
// code, her phone joins, her browser signs in, the admin manages her devices and
// cannot take the last admin away, and finally deletes her.
func TestHouseholdFlow(t *testing.T) {
	e := newEnv(t)
	c := e.client
	resetRedeemCounters(t, e)
	t.Cleanup(func() { resetRedeemCounters(t, e) })
	called := map[string]bool{}
	expect := func(op string, resp *http.Response, body []byte, want int) {
		t.Helper()
		called[op] = true
		if resp.StatusCode != want {
			t.Fatalf("%s: %d, want %d — %s", op, resp.StatusCode, want, body)
		}
	}
	host := strings.TrimPrefix(c.base, "http://")
	origin := "http://" + host

	// The admin. Every other admin on this shared test database is demoted, so that
	// "the last admin" below means this one.
	_, err := e.store.DB.Exec(context.Background(), `UPDATE users SET role = 'member' WHERE role = 'admin'`)
	must(t, err, "demote the other admins")
	bob := addPerson(t, e, "bob", "Europe/Budapest", 1, 1, 1, 1, 1)
	setRole(t, e, bob, auth.RoleAdmin)

	// 1. A new member.
	handle := fmt.Sprintf("nori%d", time.Now().UnixNano()%1_000_000_000)
	resp, body := c.send(t, call{method: "POST", path: "/v1/admin/users", bearer: bob.token,
		body: api.MemberCreate{Handle: handle, DisplayName: ptr("Nóri")}})
	expect("POST /admin/users", resp, body, 201)
	var nori api.Member
	must(t, json.Unmarshal(body, &nori), "member")
	noriPath := "/v1/admin/users/" + nori.Id.String()
	resp, body = c.send(t, call{method: "POST", path: "/v1/admin/users", bearer: bob.token, body: api.MemberCreate{Handle: handle}})
	if resp.StatusCode != 409 {
		t.Errorf("the same handle twice: %d, want 409", resp.StatusCode)
	}

	// 2. A connection code for her phone; the phone redeems it.
	resp, body = c.send(t, call{method: "POST", path: noriPath + "/codes", bearer: bob.token, body: api.CodeRequest{Purpose: "device"}})
	expect("POST /admin/users/{id}/codes", resp, body, 201)
	var code api.CodeIssued
	must(t, json.Unmarshal(body, &code), "code")
	if len(code.Code) != 9 || code.Code[4] != '-' {
		t.Errorf("the code is not XXXX-XXXX: %q", code.Code)
	}
	// The web door refuses /enroll.
	resp, body = c.send(t, call{method: "POST", path: "/v1/enroll", listener: "web", body: api.EnrollRequest{Code: code.Code, Label: "x"}})
	if resp.StatusCode != 404 {
		t.Errorf("/enroll through the web door: %d, want 404", resp.StatusCode)
	}
	// Lower case and without the dash, as somebody might type it.
	typed := strings.ToLower(strings.ReplaceAll(code.Code, "-", ""))
	resp, body = c.send(t, call{method: "POST", path: "/v1/enroll", listener: "device", body: api.EnrollRequest{Code: typed, Label: "Nóri iPhone"}})
	expect("POST /enroll", resp, body, 201)
	var enrolled api.EnrollResult
	must(t, json.Unmarshal(body, &enrolled), "enrolled")
	if enrolled.User.Handle == nil || *enrolled.User.Handle != handle {
		t.Fatalf("enrolled as %+v, want %s", enrolled.User, handle)
	}
	phone := enrolled.AccessToken
	// Used once: the same code again is refused, like any bad code.
	resp, body = c.send(t, call{method: "POST", path: "/v1/enroll", body: api.EnrollRequest{Code: code.Code, Label: "again"}})
	if resp.StatusCode != 401 {
		t.Errorf("a used code: %d, want 401", resp.StatusCode)
	}

	// 3. Now that she has a device, the admin can no longer hand out codes for her (C2).
	resp, body = c.send(t, call{method: "POST", path: noriPath + "/codes", bearer: bob.token, body: api.CodeRequest{Purpose: "web"}})
	if resp.StatusCode != 409 {
		t.Errorf("an admin's code for a member with a device: %d, want 409 — %s", resp.StatusCode, body)
	}

	// 4. Her phone: who she is, her devices, her log.
	var me api.User
	if st := c.do(t, "GET", "/v1/me", phone, nil, &me); st != 200 || me.Handle == nil || *me.Handle != handle || me.Role == nil || *me.Role != "member" {
		t.Fatalf("/me as Nóri: %d %+v", st, me)
	}
	if me.Token == nil || me.Token.Label != "Nóri iPhone" || me.Capabilities == nil || me.Capabilities.CanDeleteSelf == nil || !*me.Capabilities.CanDeleteSelf {
		t.Errorf("/me token/capabilities: %+v %+v", me.Token, me.Capabilities)
	}
	resp, body = c.send(t, call{method: "PATCH", path: "/v1/me", bearer: phone, body: api.MePatch{DisplayName: ptr("Nóri B.")}})
	expect("PATCH /me", resp, body, 200)
	var events []api.AccountEvent
	c.do(t, "GET", "/v1/me/events", phone, nil, &events)
	kinds := eventKinds(events)
	for _, k := range []string{"member_added", "code_issued", "code_redeemed"} {
		if !contains(kinds, k) {
			t.Errorf("Nóri's log lacks %q: %v", k, kinds)
		}
	}
	for _, ev := range events {
		if ev.Kind == "code_issued" && (ev.Actor == nil || ev.ActorIsSelf == nil || *ev.ActorIsSelf) {
			t.Errorf("the admin's code should show the admin as actor: %+v", ev)
		}
	}
	// Members are not admins.
	if resp, _ := c.send(t, call{method: "GET", path: "/v1/admin/users", bearer: phone}); resp.StatusCode != 403 {
		t.Errorf("/admin/users as a member: %d, want 403", resp.StatusCode)
	}

	// 5. Her browser: a sign-in code from the phone, redeemed on the web door.
	resp, body = c.send(t, call{method: "POST", path: "/v1/me/login-codes", bearer: phone})
	expect("POST /me/login-codes", resp, body, 201)
	var login api.CodeIssued
	must(t, json.Unmarshal(body, &login), "login code")
	if time.Until(login.ExpiresAt) > 11*time.Minute {
		t.Errorf("a sign-in code lives %v, want 10 minutes", time.Until(login.ExpiresAt))
	}
	// Without an Origin: refused (login CSRF), and the code is not spent by it.
	resp, _ = c.send(t, call{method: "POST", path: "/v1/auth/web/login", body: api.WebLoginRequest{Code: login.Code}})
	if resp.StatusCode != 403 {
		t.Errorf("web login without Origin: %d, want 403", resp.StatusCode)
	}
	resp, body = c.send(t, call{method: "POST", path: "/v1/auth/web/login", origin: origin, listener: "web", body: api.WebLoginRequest{Code: login.Code}})
	expect("POST /auth/web/login", resp, body, 204)
	var session *http.Cookie
	for _, ck := range resp.Cookies() {
		if ck.Name == auth.SessionCookie {
			session = ck
		}
	}
	if session == nil || !session.HttpOnly || !session.Secure || session.SameSite != http.SameSiteStrictMode || session.Path != "/v1" || session.Domain != "" {
		t.Fatalf("the session cookie: %+v", session)
	}
	if resp, body := c.send(t, call{method: "GET", path: "/v1/me", cookie: session.Value, listener: "web"}); resp.StatusCode != 200 || !strings.Contains(string(body), `"kind":"web"`) {
		t.Errorf("/me with the cookie: %d %s", resp.StatusCode, body)
	}
	// The cookie's rules (C10, C11).
	if resp, _ := c.send(t, call{method: "GET", path: "/v1/me", cookie: session.Value, bearer: phone}); resp.StatusCode != 400 {
		t.Errorf("cookie and bearer together: %d, want 400", resp.StatusCode)
	}
	if resp, _ := c.send(t, call{method: "GET", path: "/v1/me", cookie: session.Value, listener: "device"}); resp.StatusCode != 401 {
		t.Errorf("cookie through the device door: %d, want 401", resp.StatusCode)
	}
	if resp, _ := c.send(t, call{method: "PATCH", path: "/v1/me", cookie: session.Value, origin: "https://evil.example", body: api.MePatch{DisplayName: ptr("x")}}); resp.StatusCode != 403 {
		t.Errorf("a cookie write from another origin: %d, want 403", resp.StatusCode)
	}
	if resp, _ := c.send(t, call{method: "GET", path: "/v1/me", bearer: session.Value}); resp.StatusCode != 401 {
		t.Errorf("the session token as a bearer: %d, want 401", resp.StatusCode)
	}

	// 6. The admin's view of her: metadata, never data.
	resp, body = c.send(t, call{method: "GET", path: "/v1/admin/users", bearer: bob.token})
	expect("GET /admin/users", resp, body, 200)
	resp, body = c.send(t, call{method: "GET", path: noriPath, bearer: bob.token})
	expect("GET /admin/users/{id}", resp, body, 200)
	var noriNow api.Member
	must(t, json.Unmarshal(body, &noriNow), "member")
	if noriNow.Devices == nil || *noriNow.Devices != 2 {
		t.Errorf("Nóri's live devices: %v, want 2 (phone + browser)", noriNow.Devices)
	}
	resp, body = c.send(t, call{method: "GET", path: noriPath + "/tokens", bearer: bob.token})
	expect("GET /admin/users/{id}/tokens", resp, body, 200)
	var noriTokens []api.TokenInfo
	must(t, json.Unmarshal(body, &noriTokens), "tokens")
	resp, body = c.send(t, call{method: "GET", path: noriPath + "/events", bearer: bob.token})
	expect("GET /admin/users/{id}/events", resp, body, 200)

	// Revoking: Bob's own token id under Nóri's path is 404, not a revocation of Bob (C4).
	var bobTokens []api.TokenInfo
	c.do(t, "GET", "/v1/me/tokens", bob.token, nil, &bobTokens)
	if resp, _ := c.send(t, call{method: "DELETE", path: noriPath + "/tokens/" + bobTokens[0].Id.String(), bearer: bob.token}); resp.StatusCode != 404 {
		t.Errorf("revoking another member's token through Nóri's path: %d, want 404", resp.StatusCode)
	}
	var webID string
	for _, tk := range noriTokens {
		if tk.Kind == "web" {
			webID = tk.Id.String()
		}
	}
	resp, body = c.send(t, call{method: "DELETE", path: noriPath + "/tokens/" + webID, bearer: bob.token})
	expect("DELETE /admin/users/{id}/tokens/{tokenId}", resp, body, 204)
	if resp, _ := c.send(t, call{method: "GET", path: "/v1/me", cookie: session.Value}); resp.StatusCode != 401 {
		t.Errorf("the revoked browser session: %d, want 401", resp.StatusCode)
	}

	// Nóri signs her browser in again, and logs it out herself.
	_, body = c.send(t, call{method: "POST", path: "/v1/me/login-codes", bearer: phone})
	must(t, json.Unmarshal(body, &login), "login code")
	resp, _ = c.send(t, call{method: "POST", path: "/v1/auth/web/login", origin: origin, body: api.WebLoginRequest{Code: login.Code}})
	for _, ck := range resp.Cookies() {
		if ck.Name == auth.SessionCookie {
			session = ck
		}
	}
	resp, body = c.send(t, call{method: "POST", path: "/v1/auth/web/logout", cookie: session.Value, origin: origin})
	expect("POST /auth/web/logout", resp, body, 204)
	if resp, _ := c.send(t, call{method: "GET", path: "/v1/me", cookie: session.Value}); resp.StatusCode != 401 {
		t.Errorf("a logged-out session: %d, want 401", resp.StatusCode)
	}

	// A second phone of hers, by her own code; then she revokes it.
	resp, body = c.send(t, call{method: "POST", path: "/v1/me/enrolment-codes", bearer: phone})
	expect("POST /me/enrolment-codes", resp, body, 201)
	must(t, json.Unmarshal(body, &code), "code")
	_, body = c.send(t, call{method: "POST", path: "/v1/enroll", body: api.EnrollRequest{Code: code.Code, Label: "Nóri iPad"}})
	var second api.EnrollResult
	must(t, json.Unmarshal(body, &second), "second")
	var mine []api.TokenInfo
	c.do(t, "GET", "/v1/me/tokens", phone, nil, &mine)
	var ipad string
	for _, tk := range mine {
		if tk.Label == "Nóri iPad" {
			ipad = tk.Id.String()
		}
	}
	resp, body = c.send(t, call{method: "DELETE", path: "/v1/me/tokens/" + ipad, bearer: phone})
	expect("DELETE /me/tokens/{id}", resp, body, 204)
	if st := c.do(t, "GET", "/v1/me", second.AccessToken, nil, nil); st != 401 {
		t.Errorf("the revoked iPad: %d, want 401", st)
	}

	// 7. The last admin stays (C3), and disabling is not revoking (A8).
	bobPath := "/v1/admin/users/" + bob.userID.String()
	resp, body = c.send(t, call{method: "PATCH", path: bobPath, bearer: bob.token, body: map[string]any{"role": "member"}})
	expect("PATCH /admin/users/{id}", resp, body, 409)
	if resp, _ := c.send(t, call{method: "DELETE", path: "/v1/me", bearer: bob.token, body: api.DeleteConfirm{Handle: bob.sub}}); resp.StatusCode != 409 {
		t.Errorf("the last admin deleting themselves: %d, want 409", resp.StatusCode)
	}
	called["DELETE /me"] = true
	c.send(t, call{method: "PATCH", path: noriPath, bearer: bob.token, body: map[string]any{"disabled": true}})
	if resp, body := c.send(t, call{method: "GET", path: "/v1/me", bearer: phone}); resp.StatusCode != 401 || !strings.Contains(string(body), "disabled") {
		t.Errorf("a disabled member's phone: %d %s", resp.StatusCode, body)
	}
	c.send(t, call{method: "PATCH", path: noriPath, bearer: bob.token, body: map[string]any{"disabled": false}})
	if st := c.do(t, "GET", "/v1/me", phone, nil, nil); st != 200 {
		t.Errorf("re-enabled, the same phone: %d, want 200", st)
	}

	// 8. The rate limit: five wrong codes from one address, then even a good one waits.
	resetRedeemCounters(t, e)
	for i := 0; i < 5; i++ {
		c.send(t, call{method: "POST", path: "/v1/enroll", body: api.EnrollRequest{Code: "ZZZZ-ZZZZ", Label: "x"}})
	}
	_, body = c.send(t, call{method: "POST", path: "/v1/me/enrolment-codes", bearer: phone})
	must(t, json.Unmarshal(body, &code), "code")
	if resp, _ := c.send(t, call{method: "POST", path: "/v1/enroll", body: api.EnrollRequest{Code: code.Code, Label: "x"}}); resp.StatusCode != 429 {
		t.Errorf("after five failures: %d, want 429", resp.StatusCode)
	}
	resetRedeemCounters(t, e)

	// 9. Deleting her: the handle confirms; she is disabled at once and the job queued.
	if resp, _ := c.send(t, call{method: "DELETE", path: noriPath, bearer: bob.token, body: api.DeleteConfirm{Handle: "nobody"}}); resp.StatusCode != 400 {
		t.Errorf("a deletion with the wrong handle: %d, want 400", resp.StatusCode)
	}
	resp, body = c.send(t, call{method: "DELETE", path: noriPath, bearer: bob.token, body: api.DeleteConfirm{Handle: handle}})
	expect("DELETE /admin/users/{id}", resp, body, 202)
	if st := c.do(t, "GET", "/v1/me", phone, nil, nil); st != 401 {
		t.Errorf("a member queued for deletion: %d, want 401", st)
	}
	var jobs int
	must(t, e.store.DB.QueryRow(context.Background(),
		`SELECT count(*) FROM deletion_jobs WHERE user_id = $1 AND done_at IS NULL`, nori.Id).Scan(&jobs), "jobs")
	if jobs != 1 {
		t.Errorf("open deletion jobs for Nóri: %d, want 1", jobs)
	}

	var skipped []string
	for _, op := range householdOps {
		if !called[op] {
			skipped = append(skipped, op)
		}
	}
	sort.Strings(skipped)
	if len(skipped) > 0 {
		t.Errorf("householdOps this test did not call: %v", skipped)
	}
}

func eventKinds(es []api.AccountEvent) []string {
	var out []string
	for _, e := range es {
		out = append(out, e.Kind)
	}
	return out
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

// A member deletes their own account (S1 — this used to fail on row security), and
// an admin's second, held-back code is dead once the member has a device (S2).
func TestSelfDeletionAndHeldBackAdminCodes(t *testing.T) {
	e := newEnv(t)
	c := e.client
	resetRedeemCounters(t, e)
	t.Cleanup(func() { resetRedeemCounters(t, e) })
	admin := addPerson(t, e, "adm", "Europe/Budapest", 1, 1, 1, 1, 1)
	setRole(t, e, admin, auth.RoleAdmin)

	handle := fmt.Sprintf("kid%d", time.Now().UnixNano()%1_000_000_000)
	_, body := c.send(t, call{method: "POST", path: "/v1/admin/users", bearer: admin.token, body: api.MemberCreate{Handle: handle}})
	var m api.Member
	must(t, json.Unmarshal(body, &m), "member")
	path := "/v1/admin/users/" + m.Id.String() + "/codes"

	var first, held api.CodeIssued
	_, body = c.send(t, call{method: "POST", path: path, bearer: admin.token, body: api.CodeRequest{Purpose: "device"}})
	must(t, json.Unmarshal(body, &first), "first code")
	_, body = c.send(t, call{method: "POST", path: path, bearer: admin.token, body: api.CodeRequest{Purpose: "device"}})
	must(t, json.Unmarshal(body, &held), "held code")

	resp, body := c.send(t, call{method: "POST", path: "/v1/enroll", body: api.EnrollRequest{Code: first.Code, Label: "phone"}})
	if resp.StatusCode != 201 {
		t.Fatalf("the member's code: %d %s", resp.StatusCode, body)
	}
	var enrolled api.EnrollResult
	must(t, json.Unmarshal(body, &enrolled), "enrolled")
	if resp, _ := c.send(t, call{method: "POST", path: "/v1/enroll", body: api.EnrollRequest{Code: held.Code, Label: "admin's laptop"}}); resp.StatusCode != 401 {
		t.Errorf("the admin's held-back code after the member joined: %d, want 401", resp.StatusCode)
	}
	var tokens []api.TokenInfo
	c.do(t, "GET", "/v1/me/tokens", enrolled.AccessToken, nil, &tokens)
	if len(tokens) != 1 {
		t.Errorf("the member has %d tokens, want only their phone: %+v", len(tokens), tokens)
	}

	resp, body = c.send(t, call{method: "DELETE", path: "/v1/me", bearer: enrolled.AccessToken, body: api.DeleteConfirm{Handle: handle}})
	if resp.StatusCode != 202 {
		t.Fatalf("a member deleting themselves: %d %s", resp.StatusCode, body)
	}
	if st := c.do(t, "GET", "/v1/me", enrolled.AccessToken, nil, nil); st != 401 {
		t.Errorf("after self-deletion: %d, want 401", st)
	}
	var jobs int
	must(t, e.store.DB.QueryRow(context.Background(), `SELECT count(*) FROM deletion_jobs WHERE user_id = $1 AND done_at IS NULL`, m.Id).Scan(&jobs), "jobs")
	if jobs != 1 {
		t.Errorf("open deletion jobs: %d, want 1", jobs)
	}
}
