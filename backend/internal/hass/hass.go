// Package hass publishes Helsa's DAILY SUMMARIES to an MQTT broker in Home
// Assistant's discovery format, so that the entities appear on their own with no
// YAML to write and nothing to keep in step with Home Assistant releases.
//
// ⚠️ DAILY SUMMARIES ONLY — never raw samples. One day of an actively worn Apple
// Watch is five to fifteen thousand samples; pushing those at Home Assistant would
// write tens of thousands of state changes a day into its recorder database
// (SQLite by default), bloat it, make the history graphs useless and eventually
// slow the whole instance down — for data nobody would ever read there. Home
// Assistant is an automation surface; the health data store is the TimescaleDB
// behind Helsa. See ADR-0005 and docs/integrations/.
//
// The publisher runs INSIDE THE WORKER (cmd/worker) rather than as a service of
// its own. It is a handful of small queries a few times a day against a database
// the worker already has open; a separate process would mean another container,
// another set of credentials and another thing to notice had stopped — for a
// goroutine's worth of work. It shares the worker's lifetime, which is the right
// one: the worker is the always-on background half of Helsa.
//
// It is OFF unless HELSA_MQTT_URL is set, and it never takes the process down: a
// missing broker means a logged line and silence, not a failed start-up.
package hass

import (
	"context"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"log/slog"
	"net/url"
	"strings"
	"sync"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nordic-sys/helsa/backend/internal/config"
)

const (
	payloadOnline  = "online"
	payloadOffline = "offline"

	// How long a single publish or a graceful disconnect may take. Short, because a
	// round of publishes waits these out one after another when a broker goes away
	// mid-round.
	publishTimeout    = 5 * time.Second
	disconnectTimeout = 250 * time.Millisecond

	// One round of collecting is a few small aggregates; if the database cannot
	// answer in this time, something is wrong and the next tick can try again.
	collectTimeout = 30 * time.Second

	// How long the first round waits for the connection to come up. Long enough for
	// a local broker handshake, short enough that a restart is visible in Home
	// Assistant almost immediately.
	initialDelay = 3 * time.Second
)

// Publisher pushes summaries and the freshness heartbeat to the broker.
type Publisher struct {
	pool *pgxpool.Pool
	log  *slog.Logger
	cfg  config.MQTT
	top  topics

	client mqtt.Client

	// published remembers whose topics this process has put on the broker, so that
	// a member who switches publishing off — or is deleted — has them cleared rather
	// than left there retained (docs/36 §4.4, §4.6/4).
	mu        sync.Mutex
	published map[uuid.UUID]topics
}

// New builds a Publisher. It performs no I/O — nothing connects until Run.
func New(pool *pgxpool.Pool, log *slog.Logger, cfg config.MQTT) *Publisher {
	return &Publisher{
		pool: pool,
		log:  log.With("component", "hass"),
		cfg:  cfg,
		top:  topics{prefix: cfg.Prefix, discoveryPrefix: cfg.DiscoveryPrefix},

		published: map[uuid.UUID]topics{},
	}
}

// Run blocks until ctx is cancelled, publishing on two schedules.
//
// It returns an error ONLY for a configuration mistake it cannot recover from (a
// broker URL that is not a URL). A broker that is down is not that: paho keeps
// retrying in the background, and each tick simply finds nothing to publish to
// and says so. Whoever does not run MQTT gets one line at start-up and is never
// bothered again.
func (p *Publisher) Run(ctx context.Context) error {
	if !p.cfg.Enabled() {
		p.log.Info("home assistant publisher disabled", "reason", "HELSA_MQTT_URL is empty")
		return nil
	}

	opts, err := p.clientOptions()
	if err != nil {
		return err
	}
	p.client = mqtt.NewClient(opts)

	// Not waiting on the token on purpose: with ConnectRetry the token only
	// completes once a connection succeeds, so waiting would block for as long as
	// the broker is down — which is exactly the case that must NOT hold the worker
	// up.
	p.client.Connect()
	defer p.shutdown()

	p.log.Info("home assistant publisher started",
		"broker", redactBroker(p.cfg.URL),
		"prefix", p.cfg.Prefix,
		"discovery_prefix", p.cfg.DiscoveryPrefix,
		"summary_interval", p.cfg.Interval.String(),
		"freshness_interval", p.cfg.FreshnessPeriod.String())

	summary := time.NewTicker(p.cfg.Interval)
	defer summary.Stop()
	freshness := time.NewTicker(p.cfg.FreshnessPeriod)
	defer freshness.Stop()

	// The first round does not wait for a tick. Without this, a restart would leave
	// the freshness sensor silent for a quarter of an hour and the summaries stale
	// for six — and on a fresh install nothing at all would appear until then, which
	// reads as "it does not work".
	first := time.NewTimer(initialDelay)
	defer first.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-first.C:
			p.publishSummary(ctx)
			p.publishFreshness(ctx)
		case <-summary.C:
			p.publishSummary(ctx)
		case <-freshness.C:
			p.publishFreshness(ctx)
		}
	}
}

// clientOptions turns the configured URL into paho options, including the last
// will that greys the convenience entities out when this process dies.
func (p *Publisher) clientOptions() (*mqtt.ClientOptions, error) {
	u, err := url.Parse(p.cfg.URL)
	if err != nil {
		// ⚠️ url.Parse quotes the whole string it refused — password included.
		return nil, fmt.Errorf("HELSA_MQTT_URL: %w", config.RedactURLError(err, p.cfg.URL))
	}
	if u.Host == "" {
		return nil, fmt.Errorf("HELSA_MQTT_URL %q has no host", redactBroker(p.cfg.URL))
	}

	opts := mqtt.NewClientOptions()
	if u.User != nil {
		opts.SetUsername(u.User.Username())
		if pw, ok := u.User.Password(); ok {
			opts.SetPassword(pw)
		}
		// The credentials go in the options, not in the broker URL: paho does not read
		// userinfo, and leaving it in means the password is printed in its logs.
		u.User = nil
	}
	opts.AddBroker(u.String())
	opts.SetClientID(p.cfg.ClientID)
	opts.SetOrderMatters(false)
	opts.SetAutoReconnect(true)
	opts.SetConnectRetry(true)
	opts.SetConnectRetryInterval(30 * time.Second)
	opts.SetKeepAlive(30 * time.Second)
	// A clean session: this publisher holds no subscription worth surviving a
	// restart, and the retained discovery messages live on the broker anyway.
	opts.SetCleanSession(true)

	// The last will. Retained, so that a client connecting later still learns the
	// publisher is gone rather than seeing nothing at all.
	opts.SetWill(p.top.status(), payloadOffline, 1, true)

	opts.SetOnConnectHandler(p.onConnect)
	opts.SetConnectionLostHandler(func(_ mqtt.Client, err error) {
		p.log.Warn("mqtt connection lost", "err", err)
	})
	return opts, nil
}

// onConnect runs on every (re)connection: announce ourselves, republish the
// discovery documents, and start listening for Home Assistant's birth message.
func (p *Publisher) onConnect(c mqtt.Client) {
	p.log.Info("mqtt connected", "broker", redactBroker(p.cfg.URL))

	p.publishRaw(c, p.top.status(), payloadOnline, true)
	p.publishDiscoveryAll(context.Background(), c)

	// Home Assistant announces its own start-up on <discovery_prefix>/status with
	// "online". Its documentation asks publishers to treat that as the cue to send
	// their discovery payloads again.
	//
	// The retained discovery messages already cover the ordinary restart; this
	// covers the case where somebody has cleared them, or where Home Assistant
	// started before its subscription was in place. Cheap, and the failure it
	// prevents is the silent one: entities that never come back.
	tok := c.Subscribe(p.top.haStatus(), 1, p.onHAStatus)
	switch {
	case !tok.WaitTimeout(publishTimeout):
		p.log.Warn("subscribe to home assistant status timed out", "topic", p.top.haStatus())
	case tok.Error() != nil:
		p.log.Warn("subscribe to home assistant status failed", "topic", p.top.haStatus(), "err", tok.Error())
	}
}

func (p *Publisher) onHAStatus(c mqtt.Client, m mqtt.Message) {
	if strings.TrimSpace(string(m.Payload())) != payloadOnline {
		return
	}
	p.log.Info("home assistant restarted, republishing discovery")
	p.publishRaw(c, p.top.status(), payloadOnline, true)
	p.publishDiscoveryAll(context.Background(), c)
}

// publishDiscovery sends one retained config message per entity. Retained is what
// makes the entities survive a Home Assistant restart without us being awake for
// it.
func (p *Publisher) publishDiscovery(c mqtt.Client, top topics) bool {
	for _, e := range entities {
		buf, err := top.discoveryJSON(e, p.cfg.ExpireAfter)
		if err != nil {
			p.log.Error("build discovery", "entity", e.objectID, "err", err)
			continue
		}
		if !p.publishRaw(c, top.discovery(top.objectID(e)), string(buf), true) {
			return false
		}
	}
	return true
}

func (p *Publisher) publishDiscoveryAll(ctx context.Context, c mqtt.Client) {
	ctx, cancel := context.WithTimeout(ctx, collectTimeout)
	defer cancel()
	for _, t := range p.targets(ctx) {
		if !p.publishDiscovery(c, p.topicsFor(t)) {
			return
		}
	}
}

func (p *Publisher) topicsFor(t target) topics { return p.top.forMember(t.handle, t.name, t.legacy) }

// sync records the current targets, publishes discovery for any that are new, and
// clears the topics of any that were published before and no longer are.
func (p *Publisher) sync(ts []target) {
	want := map[uuid.UUID]topics{}
	for _, t := range ts {
		want[t.userID] = p.topicsFor(t)
	}
	p.mu.Lock()
	var gone []topics
	var fresh []topics
	for id, top := range p.published {
		if _, ok := want[id]; !ok {
			gone = append(gone, top)
		}
	}
	for id, top := range want {
		if old, ok := p.published[id]; !ok || old != top {
			fresh = append(fresh, top)
			if ok {
				gone = append(gone, old) // renamed (legacy changed): clear the old names
			}
		}
	}
	p.published = want
	p.mu.Unlock()
	for _, top := range gone {
		p.clear(top)
	}
	for _, top := range fresh {
		p.publishDiscovery(p.client, top)
	}
}

// clear removes a member's entities: an empty retained message on each discovery
// topic (Home Assistant deletes the entity) and on each retained state topic (the
// broker forgets the last value). ⚠️ What Home Assistant already recorded in its
// own history stays there — that is Home Assistant's database, not ours.
func (p *Publisher) clear(top topics) bool {
	for _, e := range entities {
		if !p.publishRaw(p.client, top.discovery(top.objectID(e)), "", true) {
			return false
		}
		if e.retain {
			if !p.publishRaw(p.client, top.state(e.suffix), "", true) {
				return false
			}
		}
	}
	return true
}

// ForgetUser clears a member's retained topics — the member-deletion job's MQTT
// stage (internal/deletion). With the publisher off there is nothing to clear; with
// it on but the broker unreachable, it is an error, and the job retries.
func (p *Publisher) ForgetUser(_ context.Context, user uuid.UUID, handle string) error {
	if !p.cfg.Enabled() {
		return nil
	}
	if !p.connected() {
		return errors.New("mqtt broker not connected")
	}
	p.mu.Lock()
	top, ok := p.published[user]
	delete(p.published, user)
	p.mu.Unlock()
	if !ok {
		// Not published by this process (it restarted): clear the non-legacy names,
		// which are the only ones a deleted member can have had unless they were the
		// pinned user — and then their legacy names are the pinned user's, cleared below.
		top = p.top.forMember(handle, handle, false)
	}
	if !p.clear(top) {
		return errors.New("mqtt publish failed while clearing")
	}
	return nil
}

// publishSummary collects and publishes the daily numbers.
func (p *Publisher) publishSummary(ctx context.Context) {
	if !p.connected() {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, collectTimeout)
	defer cancel()

	ts := p.targets(ctx)
	p.sync(ts)
	for _, t := range ts {
		top := p.topicsFor(t)
		snap, err := collectDaily(ctx, p.pool, t, time.Now())
		if err != nil {
			p.log.Error("collect daily summary", "member", t.handle, "err", err)
			continue
		}
		for _, e := range entities {
			if e.expiring {
				continue // the heartbeat has its own schedule
			}
			// Stop at the first failure. If the broker has gone away mid-round, the
			// remaining topics would each sit out the whole timeout for nothing, and a
			// shutdown asked for in the meantime would have to wait for all of them.
			if !p.publishRaw(p.client, top.state(e.suffix), stateValue(snap.value(e.suffix), e.decimals), e.retain) {
				return
			}
		}
		// The numbers are health data: not in the log on a server several people share.
		p.log.Info("published daily summary", "member", t.handle)
	}
}

// publishFreshness publishes the dead man's switch.
//
// ⚠️ It publishes STATE and nothing else. Whether the silence has lasted too long
// is Home Assistant's to decide, through `expire_after` and an automation. If
// Helsa decided it, the most important case — Helsa itself being dead — would
// produce no alert at all, because a system cannot announce its own death.
func (p *Publisher) publishFreshness(ctx context.Context) {
	if !p.connected() {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, collectTimeout)
	defer cancel()

	ts := p.targets(ctx)
	p.sync(ts)
	e := freshnessEntity()
	for _, t := range ts {
		top := p.topicsFor(t)
		f, err := collectFreshness(ctx, p.pool, t, time.Now())
		if err != nil {
			p.log.Error("collect freshness", "member", t.handle, "err", err)
			continue
		}
		if attrs, err := attributesJSON(f, "helsa-worker"); err == nil {
			p.publishRaw(p.client, top.state(e.attrs), string(attrs), false)
		} else {
			p.log.Error("build freshness attributes", "err", err)
		}
		p.publishRaw(p.client, top.state(e.suffix), stateValue(f.Hours, e.decimals), e.retain)

		if f.FutureSkew > 0 {
			p.log.Warn("newest data is dated in the future; freshness clamped to zero",
				"member", t.handle, "skew", f.FutureSkew.String(), "newest", f.Newest)
		}
	}
}

// targets resolves who to publish for, turning "nobody yet" into a quiet skip.
func (p *Publisher) targets(ctx context.Context) []target {
	ts, err := resolveTargets(ctx, p.pool, p.cfg.UserID)
	if err != nil && ctx.Err() != nil {
		// The process is shutting down; a cancelled query is the expected outcome, not
		// something worth an error line in the log on every restart.
		return nil
	}
	if errors.Is(err, errNoTarget) {
		p.log.Debug("nothing to publish yet", "reason", err)
		return nil
	}
	if err != nil {
		p.log.Error("resolve publish targets", "err", err)
		return nil
	}
	return ts
}

// connected asks whether there is an OPEN connection right now.
//
// ⚠️ Not IsConnected(). With ConnectRetry set, paho reports a client that is
// still trying to reach a broker as "connected", so that guard let publishes
// through to a broker that was not there: each one then sat out the full publish
// timeout, and a stack with no broker spent a minute of every round timing out
// and another minute refusing to shut down. IsConnectionOpen is the one that
// means what it says.
func (p *Publisher) connected() bool {
	if p.client == nil || !p.client.IsConnectionOpen() {
		p.log.Debug("skipping publish: no open connection to the broker")
		return false
	}
	return true
}

// publishRaw sends one message at QoS 1 and logs a failure rather than returning
// it: a publish that did not land is worth a line in the log, but it must not
// stop the remaining topics from being sent.
func (p *Publisher) publishRaw(c mqtt.Client, topic, payload string, retained bool) bool {
	tok := c.Publish(topic, 1, retained, payload)
	if !tok.WaitTimeout(publishTimeout) {
		p.log.Warn("mqtt publish timed out", "topic", topic)
		return false
	}
	if err := tok.Error(); err != nil {
		p.log.Warn("mqtt publish failed", "topic", topic, "err", err)
		return false
	}
	return true
}

// shutdown says goodbye politely. The last will covers the impolite exits; this
// covers the ordinary one, so a planned restart does not look like a crash.
func (p *Publisher) shutdown() {
	if !p.connected() {
		if p.client != nil {
			// #nosec G115 -- disconnectTimeout is a constant (250ms), so the int64 → uint
			// conversion is 250 on every build; no request-derived value reaches here.
			p.client.Disconnect(uint(disconnectTimeout.Milliseconds()))
		}
		return
	}
	p.publishRaw(p.client, p.top.status(), payloadOffline, true)
	// #nosec G115 -- see above: a constant 250, not an attacker-influenced number.
	p.client.Disconnect(uint(disconnectTimeout.Milliseconds()))
	p.log.Info("home assistant publisher stopped")
}

// freshnessEntity returns the one entity that carries expire_after.
func freshnessEntity() entity {
	for _, e := range entities {
		if e.expiring {
			return e
		}
	}
	panic("hass: no expiring entity defined") // unreachable: the table above is a constant
}

// redactBroker strips the password from a broker URL so it can be logged.
func redactBroker(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "<unparseable>"
	}
	if u.User != nil {
		u.User = url.User(u.User.Username())
	}
	return u.String()
}
