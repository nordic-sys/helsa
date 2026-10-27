package config

import (
	"errors"
	"net/url"
	"strings"
)

// Connection URLs with a password in them, and the two ways that goes wrong.
//
// The production compose file builds HELSA_DATABASE_URL and HELSA_RABBITMQ_URL by
// pasting the password straight into `scheme://user:PASSWORD@host`. That is fine
// for `helsa_local_dev` and broken for a password made the way the documentation
// said to make one (`openssl rand -base64 36`): base64 brings `/` and `+`, and a
// `/` ends the authority part of a URL. The RabbitMQ client then refused to parse
// it (`invalid port ":ab+c" after host`) and the api and the worker crash-looped.
//
// ⚠️ Worse than the crash is the case that does NOT crash. A password that starts
// with digits before its first `/` — `123/x…` — parses "successfully" as host
// `user`, port `123`, and a path that swallows the real host. Nothing fails at
// parse time; the connection goes somewhere else. So the rule below is not "if
// url.Parse fails, repair it" but "if the userinfo holds a character that cannot
// be in a userinfo, it was meant literally".
//
// The second way it goes wrong is the error message. Both the AMQP client and
// Go's url.Parse quote the WHOLE string they could not parse, password included,
// and `docker compose logs` is the thing people are asked to paste into an issue.
// RedactURL and Redact are the answer to that.

// NormalizeConnURL re-encodes the user and password of a `scheme://user:pass@host…`
// URL when they were pasted in raw, and returns every other string unchanged.
//
// The userinfo is taken to run up to the LAST `@` after the scheme, because a raw
// password may itself contain `@` and a host never does. The limit this buys: a
// path or query that contains `@` would be misread — none of Helsa's connection
// URLs has one.
//
// A userinfo that is already valid — `%2F` for a slash, or no special characters
// at all — is left alone, so an operator who encoded the password by hand does not
// get it encoded twice.
func NormalizeConnURL(raw string) string {
	scheme, userinfo, rest, ok := splitUserinfo(raw)
	if !ok || !needsEncoding(raw, userinfo) {
		return raw
	}
	user, pass, hasPass := strings.Cut(userinfo, ":")
	var ui *url.Userinfo
	if hasPass {
		ui = url.UserPassword(user, pass)
	} else {
		ui = url.User(user)
	}
	return scheme + "://" + ui.String() + "@" + rest
}

// RedactURL returns raw with its password replaced by "xxxxx". It works on a
// string url.Parse refuses too, which is exactly the string an error message
// would otherwise quote whole.
func RedactURL(raw string) string {
	scheme, userinfo, rest, ok := splitUserinfo(raw)
	if !ok {
		return raw
	}
	user, _, hasPass := strings.Cut(userinfo, ":")
	if !hasPass {
		return raw
	}
	return scheme + "://" + user + ":xxxxx@" + rest
}

// splitUserinfo cuts `scheme://userinfo@rest` into its three parts. ok is false
// when there is no scheme or no userinfo.
func splitUserinfo(raw string) (scheme, userinfo, rest string, ok bool) {
	scheme, after, found := strings.Cut(raw, "://")
	if !found || scheme == "" {
		return "", "", "", false
	}
	at := strings.LastIndex(after, "@")
	if at < 0 {
		return "", "", "", false
	}
	return scheme, after[:at], after[at+1:], true
}

// needsEncoding reports whether a userinfo was pasted in raw: it holds a character
// that ends the authority (`/`, `?`, `#`), a second `@`, or the whole URL does not
// parse — a stray `%` or a space, say.
func needsEncoding(raw, userinfo string) bool {
	if strings.ContainsAny(userinfo, "/?#@") {
		return true
	}
	_, err := url.Parse(raw)
	return err != nil
}

// passwordOf returns the password in a connection URL as it would be used — the
// percent-decoded form when the URL is valid, the raw form when it is not — and
// the raw form as written. Either may appear in an error message.
func passwordOf(raw string) []string {
	_, userinfo, _, ok := splitUserinfo(raw)
	if !ok {
		return nil
	}
	_, pass, hasPass := strings.Cut(userinfo, ":")
	if !hasPass || pass == "" {
		return nil
	}
	out := []string{pass}
	if dec, err := url.PathUnescape(pass); err == nil && dec != pass {
		out = append(out, dec)
	}
	return out
}

// Secrets lists every secret in the configuration that a connection error could
// echo: the passwords inside the database, RabbitMQ and MQTT URLs (in every
// spelling they exist in), the Redis password, and the JWT secret.
func (c *Config) Secrets() []string {
	var out []string
	for _, raw := range []string{c.DatabaseURL, c.RabbitMQURL, c.MQTT.URL} {
		out = append(out, urlSecrets(raw)...)
	}
	if c.RedisPassword != "" {
		out = append(out, c.RedisPassword)
	}
	if c.JWTSecret != "" {
		out = append(out, c.JWTSecret)
	}
	return out
}

// Redact returns err with every occurrence of the given secrets replaced by
// "xxxxx", or err itself if none occurs (or err is nil).
//
// ⚠️ The cleaned error deliberately does NOT unwrap to the original. An Unwrap
// would keep errors.Is working, and would also hand the secret back to anybody
// who printed the chain — and nothing that calls this needs errors.Is.
func Redact(err error, secrets ...string) error {
	if err == nil {
		return nil
	}
	msg := err.Error()
	clean := msg
	for _, s := range secrets {
		// The whole secret first, then its pieces between the characters that end
		// a part of a URL. ⚠️ The pieces are not paranoia: when url.Parse trips over
		// a raw `/`, its "invalid port" message quotes the password UP TO that
		// slash — a fragment no whole-string match would ever find.
		for _, piece := range append([]string{s}, strings.FieldsFunc(s, isURLDelimiter)...) {
			// A one- to three-character piece would blank out ordinary letters of
			// the message (and an empty one would loop); a leak that short is not a
			// usable part of a 48-character password.
			if len(piece) < 4 {
				continue
			}
			clean = strings.ReplaceAll(clean, piece, "xxxxx")
		}
	}
	if clean == msg {
		return err
	}
	return errors.New(clean)
}

// RedactURLError is Redact for the one URL an error was produced from: the
// password in it, in every spelling, is blanked out of err's message.
func RedactURLError(err error, raw string) error {
	return Redact(err, urlSecrets(raw)...)
}

// urlSecrets is the password of a connection URL in the spellings an error can
// quote: as written, decoded, and — when NormalizeConnURL would change the URL —
// in its escaped form, which is what a client handed the repaired URL would echo.
func urlSecrets(raw string) []string {
	out := passwordOf(raw)
	if n := NormalizeConnURL(raw); n != raw {
		out = append(out, passwordOf(n)...)
	}
	return out
}

func isURLDelimiter(r rune) bool {
	return strings.ContainsRune(":/?#@", r)
}
