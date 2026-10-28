// The household's small rules — the parts of the account pages that are logic
// rather than layout, kept here so they can be tested without rendering a page.
//
// docs/36 §5 is the design; §9 (the review) overrides it where they disagree,
// and the comments below name the finding each rule comes from.

import type { AccountEvent, TokenInfo } from '../api/types'
import type { UiKey } from '../i18n'

// --- Codes --------------------------------------------------------------------

/** Crockford base32: no I, L, O or U — so what a person misreads can be mapped back. */
const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{8}$/

/**
 * A code as typed → `XXXX-XXXX`, or null when it cannot be one.
 *
 * With or without the dash, any case, stray spaces — and the letters people
 * confuse read the way Crockford says (O → 0, I and L → 1), exactly as the
 * server hashes them (`backend/internal/auth/codes.go`, `normalizeCode`). The
 * check here only saves a round trip for an obvious typo; it does not decide
 * anything — the server's one 401 does (C7).
 */
export function normalizeCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (!CROCKFORD.test(s)) return null
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

/**
 * The address a PHONE uses to reach this server — what the connection QR and the
 * code dialog carry (docs/36 §3.2, A2).
 *
 * ⚠️ **This is not the address of this page.** The dashboard is served on the
 * web door (Caddy `:8443`, or the home proxy); the phone talks to the mTLS door
 * (`:443` by default, a different port behind NPM — e.g. `:48443` on Bob's
 * server). The two differ on every real install, so the address comes, in this
 * order, from:
 *
 *   1. the server (`device_endpoint` in GET /v1/me, from HELSA_DEVICE_ENDPOINT) —
 *      what a published image needs, since it is built once for everybody;
 *   2. a build setting, `VITE_HELSA_DEVICE_ENDPOINT=https://helsa.example.net:48443/v1`;
 *   3. a guess: this page's host on the default HTTPS port — the mTLS door of a
 *      stock `deploy/` install — with the `/v1` the app's base URL reaches to
 *      (`APIClient.baseURL`, helsa-apple).
 */
export function deviceEndpoint(
  loc: Pick<Location, 'hostname'> = window.location,
  configured: string | undefined = import.meta.env.VITE_HELSA_DEVICE_ENDPOINT,
  fromServer?: string,
): string {
  for (const v of [fromServer, configured]) {
    const set = v?.trim()
    if (set) return set.replace(/\/+$/, '')
  }
  return `https://${loc.hostname}/v1`
}

/** What the connection QR encodes: `helsa://enrol?e=<endpoint>&c=<code>` (docs/36 §3.2). */
export function enrolUrl(endpoint: string, code: string): string {
  return `helsa://enrol?e=${encodeURIComponent(endpoint)}&c=${encodeURIComponent(code.replace(/-/g, ''))}`
}

/** Whole seconds until `expiresAt`; never below zero. */
export function secondsLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000))
}

/** `14:05`-style countdown. */
export function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// --- Devices and sessions -----------------------------------------------------

/** A token that still lets somebody in: not revoked, not expired. The list from
 * the server also carries revoked rows, which belong in the log, not here. */
export function isLive(t: TokenInfo, now: number = Date.now()): boolean {
  return !t.revoked_at && Date.parse(t.expires_at) > now
}

/** The live ones, this browser first and then the most recently used. */
export function liveTokens(tokens: TokenInfo[] | undefined, now: number = Date.now()): TokenInfo[] {
  return (tokens ?? [])
    .filter((t) => isLive(t, now))
    .sort((a, b) => {
      if (!!a.current !== !!b.current) return a.current ? -1 : 1
      return (b.last_used_at ?? b.created_at).localeCompare(a.last_used_at ?? a.created_at)
    })
}

// --- The account log ----------------------------------------------------------

/**
 * Which sentence a log line is, and from whose side.
 *
 * Three ways to say who did it, because the same line is read by two people
 * (the member on My account, the admin on the member's page — "the same list
 * the member sees", openapi.yaml):
 *
 *   * `you`   — the owner did it, and the owner is reading: "You revoked …"
 *   * `named` — the owner did it, someone else is reading: "Nóri revoked …"
 *   * `by`    — somebody else did it: "Bob issued a code …"; with no actor at
 *               all it was the server's operator (the CLI), and says so.
 *
 * ⚠️ An unknown kind is printed as it came rather than dropped: a log that
 * silently skips what it does not understand is a log that hides things, which
 * is the one thing this one exists not to do (A16).
 */
export type LogLine = { key: UiKey; params: Record<string, string> } | { raw: string; actor?: string }

type Variants = { you: UiKey; named: UiKey; by: UiKey }

const same = (k: UiKey): Variants => ({ you: k, named: k, by: k })

const KINDS: Record<string, (d: Record<string, unknown>) => Variants> = {
  member_added: () => same('log.memberAdded'),
  role_changed: () => same('log.roleChanged'),
  disabled: () => same('log.disabled'),
  enabled: () => same('log.enabled'),
  token_revoked: () => ({
    you: 'log.tokenRevoked.you',
    named: 'log.tokenRevoked.by',
    by: 'log.tokenRevoked.by',
  }),
  code_issued: (d) =>
    d.purpose === 'web'
      ? { you: 'log.webCode.you', named: 'log.webCode.named', by: 'log.webCode.by' }
      : { you: 'log.deviceCode.you', named: 'log.deviceCode.named', by: 'log.deviceCode.by' },
  // The person redeeming is always the owner, and the sentence needs nobody.
  code_redeemed: (d) => same(d.purpose === 'web' ? 'log.redeemed.web' : 'log.redeemed.device'),
  ha_publish: (d) =>
    d.on
      ? { you: 'log.haOn.you', named: 'log.haOn.by', by: 'log.haOn.by' }
      : { you: 'log.haOff.you', named: 'log.haOff.by', by: 'log.haOff.by' },
}

/**
 * @param operator the words for "the server's operator", in the reader's language
 * @param roleName a role's display name ("admin" / "tag")
 */
export function logLine(
  ev: AccountEvent,
  viewerIsOwner: boolean,
  operator: string,
  roleName: (role: string) => string,
): LogLine {
  const d = ev.detail ?? {}
  const actor = ev.actor ?? operator
  const variants = KINDS[ev.kind]?.(d)
  if (!variants) return { raw: ev.kind, actor: ev.actor }
  const key = !ev.actor
    ? variants.by
    : ev.actor_is_self
      ? viewerIsOwner
        ? variants.you
        : variants.named
      : variants.by
  return {
    key,
    params: {
      actor,
      label: typeof d.label === 'string' ? d.label : '',
      role: typeof d.to === 'string' ? roleName(d.to) : '',
    },
  }
}
