package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"github.com/redis/go-redis/v9"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// # The household (docs/36 F1)
//
// Accounts, devices, codes and the admin's Household page. Nothing here reads a
// member's health data: the admin's views are account metadata only, and the
// database enforces that too — the admin policies exist on the account tables
// alone (00015).

// --- who am I -------------------------------------------------------------

func (s *Server) GetMe(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFrom(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	u, err := s.q.GetUser(r.Context(), pgconv.UUID(p.UserID))
	if err != nil {
		problem(w, http.StatusNotFound, "No such user", "")
		return
	}
	out, err := s.userDTO(r.Context(), u, p)
	if err != nil {
		problem(w, http.StatusInternalServerError, "Reading settings failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) userDTO(ctx context.Context, u db.User, p auth.Principal) (api.User, error) {
	id := openapi_types.UUID(pgconv.ToUUID(u.ID))
	created := u.CreatedAt.Time
	set := settingsDTO(u.TimeZone, u.Locale, u.UnitSystem, u.NotifPrefs)
	// The same blocks GET /v1/settings carries, so the two views of one user's
	// settings cannot disagree about what the phone has said.
	phone, err := phoneBlocks(ctx, s.q, u.ID)
	if err != nil {
		return api.User{}, err
	}
	phone.apply(&set)
	role := api.UserRole(u.Role)
	handle := u.Handle
	household := true
	canDelete := true
	if u.Role == string(auth.RoleAdmin) {
		others, err := s.q.CountOtherEnabledAdmins(ctx, pgconv.UUID(p.UserID))
		if err != nil {
			return api.User{}, err
		}
		canDelete = others > 0
	}
	out := api.User{
		Id: &id, Handle: &handle, DisplayName: u.DisplayName, Role: &role, CreatedAt: &created, Settings: &set,
		HaPublish: &u.HaPublish,
		Capabilities: &api.Capabilities{Household: &household, CanDeleteSelf: &canDelete},
	}
	if p.TokenID != uuid.Nil {
		kind := api.TokenInfoKind(p.Kind)
		cur := true
		out.Token = &api.TokenInfo{Id: openapi_types.UUID(p.TokenID), Label: p.Label, Kind: kind, ExpiresAt: p.ExpiresAt, Current: &cur}
	}
	return out, nil
}

func (s *Server) PatchMe(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var body api.MePatch
	if !decodeBody(w, r, &body, "Invalid profile") {
		return
	}
	if body.HaPublish != nil {
		if err := s.q.SetHAPublish(r.Context(), db.SetHAPublishParams{ID: pgconv.UUID(p.UserID), HaPublish: *body.HaPublish}); err != nil {
			problem(w, http.StatusInternalServerError, "Saving failed", "")
			return
		}
		s.event(r.Context(), p.UserID, p.UserID, "ha_publish", map[string]any{"on": *body.HaPublish})
	}
	if body.DisplayName == nil {
		s.GetMe(w, r)
		return
	}
	name := strings.TrimSpace(*body.DisplayName)
	if name == "" || len([]rune(name)) > 64 {
		problem(w, http.StatusBadRequest, "Invalid profile", "display_name must be 1–64 characters")
		return
	}
	if _, err := s.q.UpdateDisplayName(r.Context(), db.UpdateDisplayNameParams{ID: pgconv.UUID(p.UserID), DisplayName: &name}); err != nil {
		problem(w, http.StatusInternalServerError, "Saving failed", "")
		return
	}
	s.GetMe(w, r)
}

func (s *Server) DeleteMe(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var body api.DeleteConfirm
	if !decodeBody(w, r, &body, "Invalid confirmation") {
		return
	}
	s.queueDeletion(w, r, p, p.UserID, body.Handle)
}

// --- my tokens, codes and events ------------------------------------------

func (s *Server) GetMeTokens(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	s.writeTokens(w, r, p, p.UserID)
}

func (s *Server) DeleteMeTokensId(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	p, _ := auth.PrincipalFrom(r.Context())
	s.revokeToken(w, r, p, p.UserID, uuid.UUID(id))
}

func (s *Server) PostMeEnrolmentCodes(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	s.issueCode(w, r, p, p.UserID, auth.PurposeDevice, 0)
}

func (s *Server) PostMeLoginCodes(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	s.issueCode(w, r, p, p.UserID, auth.PurposeWeb, 0)
}

func (s *Server) GetMeEvents(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	s.writeEvents(w, r, p, p.UserID)
}

// --- the admin's household --------------------------------------------------

func (s *Server) GetAdminUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.q.ListMembers(r.Context())
	if err != nil {
		problem(w, http.StatusInternalServerError, "Reading members failed", "")
		return
	}
	out := make([]api.Member, 0, len(rows))
	for _, m := range rows {
		out = append(out, memberDTO(m))
	}
	writeJSON(w, http.StatusOK, out)
}

func memberDTO(m db.ListMembersRow) api.Member {
	disabled, deleting := m.DisabledAt.Valid, m.Deleting
	n := int(m.LiveTokens)
	out := api.Member{
		Id: openapi_types.UUID(pgconv.ToUUID(m.ID)), Handle: m.Handle, DisplayName: m.DisplayName,
		Role: api.MemberRole(m.Role), Disabled: &disabled, Deleting: &deleting, CreatedAt: m.CreatedAt.Time, Devices: &n,
	}
	if m.LastUploadAt.Valid {
		t := m.LastUploadAt.Time
		out.LastUploadAt = &t
	}
	return out
}

func (s *Server) member(ctx context.Context, id uuid.UUID) (api.Member, bool, error) {
	rows, err := s.q.ListMembers(ctx)
	if err != nil {
		return api.Member{}, false, err
	}
	for _, m := range rows {
		if pgconv.ToUUID(m.ID) == id {
			return memberDTO(m), true, nil
		}
	}
	return api.Member{}, false, nil
}

func (s *Server) PostAdminUsers(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var body api.MemberCreate
	if !decodeBody(w, r, &body, "Invalid member") {
		return
	}
	handle := strings.TrimSpace(body.Handle)
	if !validHandle(handle) {
		problem(w, http.StatusBadRequest, "Invalid member", "handle: 1–32 of a–z, 0–9, - and _, starting with a letter or digit")
		return
	}
	role := auth.RoleMember
	if body.Role != nil {
		role = auth.Role(*body.Role)
	}
	if role != auth.RoleAdmin && role != auth.RoleMember {
		problem(w, http.StatusBadRequest, "Invalid member", "role: admin or member")
		return
	}
	var name *string
	if body.DisplayName != nil && strings.TrimSpace(*body.DisplayName) != "" {
		n := strings.TrimSpace(*body.DisplayName)
		name = &n
	}
	u, err := s.q.CreateMember(r.Context(), db.CreateMemberParams{Handle: handle, DisplayName: name, Role: string(role)})
	if isUniqueViolation(err) {
		problem(w, http.StatusConflict, "Handle taken", "there is already a member called "+handle)
		return
	}
	if err != nil {
		problem(w, http.StatusInternalServerError, "Adding the member failed", "")
		return
	}
	uid := pgconv.ToUUID(u.ID)
	s.event(r.Context(), uid, p.UserID, "member_added", map[string]any{"role": role})
	m, _, _ := s.member(r.Context(), uid)
	writeJSON(w, http.StatusCreated, m)
}

func (s *Server) GetAdminUsersId(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	m, ok, err := s.member(r.Context(), uuid.UUID(id))
	switch {
	case err != nil:
		problem(w, http.StatusInternalServerError, "Reading the member failed", "")
	case !ok:
		problem(w, http.StatusNotFound, "No such member", "")
	default:
		writeJSON(w, http.StatusOK, m)
	}
}

// PatchAdminUsersId changes a role, disables or re-enables, renames.
//
// ⚠️ "At least one enabled admin" is checked under an advisory lock, in the same
// transaction as the change: two admins demoting themselves at the same moment
// would otherwise each see the other and leave nobody (docs/36 §9, C3).
func (s *Server) PatchAdminUsersId(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	p, _ := auth.PrincipalFrom(r.Context())
	target := uuid.UUID(id)
	var body api.MemberPatch
	if !decodeBody(w, r, &body, "Invalid change") {
		return
	}
	if body.Role != nil && *body.Role != api.MemberPatchRoleAdmin && *body.Role != api.MemberPatchRoleMember {
		problem(w, http.StatusBadRequest, "Invalid change", "role: admin or member")
		return
	}
	var events []struct {
		kind   string
		detail map[string]any
	}
	err := pgx.BeginFunc(r.Context(), s.store.DB, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		if err := q.LockAdmins(r.Context()); err != nil {
			return err
		}
		u, err := q.GetUser(r.Context(), pgconv.UUID(target))
		if err != nil {
			return err
		}
		demote := body.Role != nil && *body.Role == api.MemberPatchRoleMember && u.Role == string(auth.RoleAdmin)
		disable := body.Disabled != nil && *body.Disabled && !u.DisabledAt.Valid && u.Role == string(auth.RoleAdmin)
		if demote || disable {
			others, err := q.CountOtherEnabledAdmins(r.Context(), pgconv.UUID(target))
			if err != nil {
				return err
			}
			if others == 0 {
				return errLastAdmin
			}
		}
		if body.Role != nil && string(*body.Role) != u.Role {
			if err := q.SetUserRole(r.Context(), db.SetUserRoleParams{ID: pgconv.UUID(target), Role: string(*body.Role)}); err != nil {
				return err
			}
			events = append(events, struct {
				kind   string
				detail map[string]any
			}{"role_changed", map[string]any{"from": u.Role, "to": string(*body.Role)}})
		}
		if body.Disabled != nil && *body.Disabled != u.DisabledAt.Valid {
			if err := q.SetUserDisabled(r.Context(), db.SetUserDisabledParams{ID: pgconv.UUID(target), Disabled: *body.Disabled}); err != nil {
				return err
			}
			kind := "enabled"
			if *body.Disabled {
				kind = "disabled"
			}
			events = append(events, struct {
				kind   string
				detail map[string]any
			}{kind, nil})
		}
		if body.DisplayName != nil {
			name := strings.TrimSpace(*body.DisplayName)
			if name == "" || len([]rune(name)) > 64 {
				return errBadName
			}
			if _, err := q.UpdateDisplayName(r.Context(), db.UpdateDisplayNameParams{ID: pgconv.UUID(target), DisplayName: &name}); err != nil {
				return err
			}
		}
		return nil
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		problem(w, http.StatusNotFound, "No such member", "")
		return
	case errors.Is(err, errLastAdmin):
		problem(w, http.StatusConflict, "The last admin", "this server must keep at least one enabled admin")
		return
	case errors.Is(err, errBadName):
		problem(w, http.StatusBadRequest, "Invalid change", "display_name must be 1–64 characters")
		return
	case err != nil:
		problem(w, http.StatusInternalServerError, "Saving failed", "")
		return
	}
	for _, e := range events {
		s.event(r.Context(), target, p.UserID, e.kind, e.detail)
	}
	s.GetAdminUsersId(w, r, id)
}

var (
	errLastAdmin = errors.New("last admin")
	errBadName   = errors.New("bad display name")
)

func (s *Server) DeleteAdminUsersId(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	p, _ := auth.PrincipalFrom(r.Context())
	var body api.DeleteConfirm
	if !decodeBody(w, r, &body, "Invalid confirmation") {
		return
	}
	s.queueDeletion(w, r, p, uuid.UUID(id), body.Handle)
}

func (s *Server) GetAdminUsersIdTokens(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	p, _ := auth.PrincipalFrom(r.Context())
	if !s.memberExists(w, r, uuid.UUID(id)) {
		return
	}
	s.writeTokens(w, r, p, uuid.UUID(id))
}

func (s *Server) DeleteAdminUsersIdTokensTokenId(w http.ResponseWriter, r *http.Request, id openapi_types.UUID, tokenId openapi_types.UUID) {
	p, _ := auth.PrincipalFrom(r.Context())
	s.revokeToken(w, r, p, uuid.UUID(id), uuid.UUID(tokenId))
}

func (s *Server) GetAdminUsersIdEvents(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	p, _ := auth.PrincipalFrom(r.Context())
	if !s.memberExists(w, r, uuid.UUID(id)) {
		return
	}
	s.writeEvents(w, r, p, uuid.UUID(id))
}

// PostAdminUsersIdCodes: an admin gives a member a code — but only a member with no
// live token at all (docs/36 §9, C2, Bob's decision 2026-10-28). Otherwise an admin
// could quietly redeem a code and be the member; this way the only route is to
// revoke the member's devices first, which stops their phone and shows in their log.
func (s *Server) PostAdminUsersIdCodes(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	p, _ := auth.PrincipalFrom(r.Context())
	target := uuid.UUID(id)
	var body api.CodeRequest
	if !decodeBody(w, r, &body, "Invalid code request") {
		return
	}
	if !s.memberExists(w, r, target) {
		return
	}
	if target != p.UserID {
		live, err := s.q.CountLiveTokens(r.Context(), pgconv.UUID(target))
		if err != nil {
			problem(w, http.StatusInternalServerError, "Checking the member failed", "")
			return
		}
		if live > 0 {
			problem(w, http.StatusConflict, "The member has a device",
				"a member who has a live device or session asks for their own code; revoke their devices first if they have lost them")
			return
		}
	}
	var ttl time.Duration
	if body.TtlMinutes != nil {
		ttl = time.Duration(*body.TtlMinutes) * time.Minute
	}
	s.issueCode(w, r, p, target, auth.Purpose(body.Purpose), ttl)
}

func (s *Server) memberExists(w http.ResponseWriter, r *http.Request, id uuid.UUID) bool {
	if _, err := s.q.GetUser(r.Context(), pgconv.UUID(id)); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			problem(w, http.StatusNotFound, "No such member", "")
		} else {
			problem(w, http.StatusInternalServerError, "Reading the member failed", "")
		}
		return false
	}
	return true
}

// --- shared halves ----------------------------------------------------------

func (s *Server) writeTokens(w http.ResponseWriter, r *http.Request, p auth.Principal, owner uuid.UUID) {
	rows, err := s.q.ListDeviceTokens(r.Context(), pgconv.UUID(owner))
	if err != nil {
		problem(w, http.StatusInternalServerError, "Reading devices failed", "")
		return
	}
	out := make([]api.TokenInfo, 0, len(rows))
	for _, t := range rows {
		cur := pgconv.ToUUID(t.ID) == p.TokenID
		info := api.TokenInfo{
			Id: openapi_types.UUID(pgconv.ToUUID(t.ID)), Label: t.Label, Kind: api.TokenInfoKind(t.Kind),
			CreatedAt: t.CreatedAt.Time, ExpiresAt: t.ExpiresAt.Time, Current: &cur,
		}
		if t.CreatedBy.Valid {
			by := openapi_types.UUID(pgconv.ToUUID(t.CreatedBy))
			info.CreatedBy = &by
		}
		info.LastUsedAt = tsPtr(t.LastUsedAt)
		info.RevokedAt = tsPtr(t.RevokedAt)
		out = append(out, info)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) revokeToken(w http.ResponseWriter, r *http.Request, p auth.Principal, owner, token uuid.UUID) {
	label, err := s.auth.RevokeToken(r.Context(), owner, token)
	if errors.Is(err, pgx.ErrNoRows) {
		// Not theirs, not there, or already revoked — one answer for all three: a
		// token id of somebody else's must not be confirmed by a different status.
		problem(w, http.StatusNotFound, "No such device", "")
		return
	}
	if err != nil {
		problem(w, http.StatusInternalServerError, "Revoking failed", "")
		return
	}
	s.event(r.Context(), owner, p.UserID, "token_revoked", map[string]any{"label": label, "token_id": token})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) issueCode(w http.ResponseWriter, r *http.Request, p auth.Principal, owner uuid.UUID, purpose auth.Purpose, ttl time.Duration) {
	if purpose != auth.PurposeDevice && purpose != auth.PurposeWeb {
		problem(w, http.StatusBadRequest, "Invalid code request", "purpose: device or web")
		return
	}
	code, exp, err := s.auth.IssueCode(r.Context(), owner, purpose, ttl, p.UserID)
	if err != nil {
		problem(w, http.StatusInternalServerError, "Issuing the code failed", "")
		return
	}
	s.event(r.Context(), owner, p.UserID, "code_issued", map[string]any{"purpose": purpose, "expires_at": exp})
	writeJSON(w, http.StatusCreated, api.CodeIssued{Code: code, Purpose: api.CodeIssuedPurpose(purpose), ExpiresAt: exp})
}

func (s *Server) writeEvents(w http.ResponseWriter, r *http.Request, p auth.Principal, owner uuid.UUID) {
	rows, err := s.q.ListAccountEvents(r.Context(), pgconv.UUID(owner))
	if err != nil {
		problem(w, http.StatusInternalServerError, "Reading the log failed", "")
		return
	}
	out := make([]api.AccountEvent, 0, len(rows))
	for _, e := range rows {
		ev := api.AccountEvent{Kind: e.Kind, At: e.At.Time}
		if e.ActorID.Valid {
			self := pgconv.ToUUID(e.ActorID) == owner
			ev.ActorIsSelf = &self
			switch {
			case e.ActorName != nil && *e.ActorName != "":
				ev.Actor = e.ActorName
			case e.ActorHandle != nil:
				ev.Actor = e.ActorHandle
			}
		}
		if len(e.Detail) > 0 {
			var d map[string]any
			if json.Unmarshal(e.Detail, &d) == nil && len(d) > 0 {
				ev.Detail = &d
			}
		}
		out = append(out, ev)
	}
	writeJSON(w, http.StatusOK, out)
}

// queueDeletion disables the account now and queues its deletion for the worker
// (docs/36 §4.6, §9 C20). The handle is the confirmation; the last enabled admin
// cannot be deleted.
func (s *Server) queueDeletion(w http.ResponseWriter, r *http.Request, p auth.Principal, target uuid.UUID, confirm string) {
	err := pgx.BeginFunc(r.Context(), s.store.DB, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		if err := q.LockAdmins(r.Context()); err != nil {
			return err
		}
		u, err := q.GetUser(r.Context(), pgconv.UUID(target))
		if err != nil {
			return err
		}
		if !strings.EqualFold(strings.TrimSpace(confirm), u.Handle) {
			return errConfirm
		}
		if u.Role == string(auth.RoleAdmin) {
			others, err := q.CountOtherEnabledAdmins(r.Context(), pgconv.UUID(target))
			if err != nil {
				return err
			}
			if others == 0 {
				return errLastAdmin
			}
		}
		if err := q.SetUserDisabled(r.Context(), db.SetUserDisabledParams{ID: pgconv.UUID(target), Disabled: true}); err != nil {
			return err
		}
		_, err = q.InsertDeletionJob(r.Context(), db.InsertDeletionJobParams{
			UserID: pgconv.UUID(target), Handle: u.Handle, RequestedBy: pgconv.UUID(p.UserID),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // already queued
		}
		return err
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		problem(w, http.StatusNotFound, "No such member", "")
	case errors.Is(err, errConfirm):
		problem(w, http.StatusBadRequest, "Not confirmed", "type the account's handle to confirm")
	case errors.Is(err, errLastAdmin):
		problem(w, http.StatusConflict, "The last admin", "this server must keep at least one enabled admin")
	case err != nil:
		problem(w, http.StatusInternalServerError, "Queuing the deletion failed", "")
	default:
		slog.Info("member deletion queued", "user_id", target, "by", p.UserID)
		w.WriteHeader(http.StatusAccepted)
	}
}

var errConfirm = errors.New("handle does not match")

// event writes the account log. A failure is a log line, not a failed request: the
// action itself has happened.
func (s *Server) event(ctx context.Context, user, actor uuid.UUID, kind string, detail map[string]any) {
	if detail == nil {
		detail = map[string]any{}
	}
	b, _ := json.Marshal(detail)
	var a pgtype.UUID
	if actor != uuid.Nil {
		a = pgconv.UUID(actor)
	}
	if err := s.q.InsertAccountEvent(ctx, db.InsertAccountEventParams{UserID: pgconv.UUID(user), ActorID: a, Kind: kind, Detail: b}); err != nil {
		slog.Warn("account event", "kind", kind, "user_id", user, "err", err)
	}
}

// --- redeeming codes: /enroll and /auth/web/login ---------------------------

// PostEnroll: a phone redeems a connection code for its device token. Device door
// only — the proxy also answers 404 for it on the web port.
func (s *Server) PostEnroll(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Helsa-Listener") == "web" {
		problem(w, http.StatusNotFound, "Not found", "")
		return
	}
	var body api.EnrollRequest
	if !decodeBody(w, r, &body, "Invalid enrolment") {
		return
	}
	label := strings.TrimSpace(body.Label)
	if label == "" || len([]rune(label)) > 64 {
		problem(w, http.StatusBadRequest, "Invalid enrolment", "label: the device's name, 1–64 characters")
		return
	}
	sess, ok := s.redeem(w, r, body.Code, auth.PurposeDevice, label)
	if !ok {
		return
	}
	u, err := s.q.GetUser(r.Context(), pgconv.UUID(sess.UserID))
	if err != nil {
		problem(w, http.StatusInternalServerError, "Reading the account failed", "")
		return
	}
	out := api.EnrollResult{AccessToken: sess.AccessToken, ExpiresAt: sess.ExpiresAt}
	uid := openapi_types.UUID(sess.UserID)
	out.User.Id, out.User.Handle, out.User.DisplayName = &uid, &u.Handle, u.DisplayName
	writeJSON(w, http.StatusCreated, out)
}

// PostAuthWebLogin: a browser redeems a sign-in code for its session cookie. Web
// door only, and only from a recognised Origin — a page elsewhere must not be able to
// sign this browser in to somebody's account (login CSRF).
func (s *Server) PostAuthWebLogin(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Helsa-Listener") == "device" {
		problem(w, http.StatusNotFound, "Not found", "")
		return
	}
	if !s.auth.OriginAllowed(r) {
		problem(w, http.StatusForbidden, "Wrong origin", "this request's origin is not this server's")
		return
	}
	var body api.WebLoginRequest
	if !decodeBody(w, r, &body, "Invalid sign-in") {
		return
	}
	sess, ok := s.redeem(w, r, body.Code, auth.PurposeWeb, browserLabel(r))
	if !ok {
		return
	}
	auth.SetSessionCookie(w, sess.AccessToken, sess.ExpiresAt)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) PostAuthWebLogout(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFrom(r.Context())
	if !ok || p.Via != auth.ViaWebSession {
		problem(w, http.StatusBadRequest, "Not a browser session", "a device logs out with POST /v1/auth/logout")
		return
	}
	if err := s.auth.EndSession(r.Context(), p); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		problem(w, http.StatusServiceUnavailable, "Not logged out", "the session could not be revoked")
		return
	}
	auth.ClearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

// browserLabel names a web session in the device list from the User-Agent — a hint
// for the person, never used for a decision.
func browserLabel(r *http.Request) string {
	ua := r.UserAgent()
	browser := "Browser"
	for _, b := range []string{"Edg/", "Firefox/", "Chrome/", "Safari/"} {
		if strings.Contains(ua, b) {
			browser = map[string]string{"Edg/": "Edge", "Firefox/": "Firefox", "Chrome/": "Chrome", "Safari/": "Safari"}[b]
			break
		}
	}
	for _, os := range []string{"Macintosh", "Windows", "iPhone", "iPad", "Android", "Linux"} {
		if strings.Contains(ua, os) {
			if os == "Macintosh" {
				os = "Mac"
			}
			return browser + " on " + os
		}
	}
	return browser
}

// # The rate limit on redeeming (docs/36 §3.2, §9 C8)
//
// Counted in Redis, per client address and for the whole server, over a 15-minute
// window: 5 failures from one address, or 30 in all, and every redemption is refused
// with 429 until the window passes. The global budget is what makes 40 bits enough:
// an attacker rotating addresses still gets 30 guesses a quarter-hour.
//
// The address is the one the proxy saw (X-Real-IP, set by Caddy and never passed
// through). ⚠️ Behind another proxy (NPM) that is the proxy's address, so a
// household shares one per-address budget; the global one is the protection.
//
// Fails CLOSED: without Redis no code is redeemed (503).
const (
	redeemWindow     = 15 * time.Minute
	redeemPerAddress = 5
	redeemGlobal     = 30
)

func (s *Server) redeem(w http.ResponseWriter, r *http.Request, code string, purpose auth.Purpose, label string) (*auth.Session, bool) {
	ctx := r.Context()
	addr := clientAddr(r)
	keyAddr, keyAll := "helsa:redeem:fail:addr:"+addr, "helsa:redeem:fail:all"
	counts, err := s.store.Redis.MGet(ctx, keyAddr, keyAll).Result()
	if err != nil {
		problem(w, http.StatusServiceUnavailable, "Try again later", "the attempt counter cannot be read")
		return nil, false
	}
	if atoiAny(counts[0]) >= redeemPerAddress || atoiAny(counts[1]) >= redeemGlobal {
		w.Header().Set("Retry-After", fmt.Sprint(int(redeemWindow.Seconds())))
		problem(w, http.StatusTooManyRequests, "Too many attempts", "wait a quarter of an hour, then ask for a new code")
		return nil, false
	}
	sess, err := s.auth.Redeem(ctx, code, purpose, label)
	if errors.Is(err, auth.ErrBadCode) {
		pipe := s.store.Redis.TxPipeline()
		pipe.Incr(ctx, keyAddr)
		pipe.Expire(ctx, keyAddr, redeemWindow)
		pipe.Incr(ctx, keyAll)
		pipe.Expire(ctx, keyAll, redeemWindow)
		if _, perr := pipe.Exec(ctx); perr != nil && !errors.Is(perr, redis.Nil) {
			slog.Warn("redeem: count the failure", "err", perr)
		}
		problem(w, http.StatusUnauthorized, "Code not accepted",
			"the code has expired, has been used, or was mistyped — ask for a new one")
		return nil, false
	}
	if err != nil {
		problem(w, http.StatusServiceUnavailable, "Try again later", "the code could not be checked")
		return nil, false
	}
	return sess, true
}

func clientAddr(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func atoiAny(v any) int {
	str, ok := v.(string)
	if !ok {
		return 0
	}
	n := 0
	for _, c := range str {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
	}
	return n
}

func validHandle(h string) bool {
	if len(h) < 1 || len(h) > 32 {
		return false
	}
	for i, c := range h {
		switch {
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9':
		case (c == '-' || c == '_') && i > 0:
		default:
			return false
		}
	}
	return true
}

func tsPtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

func isUniqueViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}
