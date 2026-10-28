package hass

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// The Home Assistant device every entity is grouped under. Sharing one device
// block is what makes the entities appear as a single "Helsa" device in the UI
// rather than as six unrelated sensors.
//
// `identifiers` is what ties them together, and it must stay stable: changing it
// makes Home Assistant create a second device and orphan the history of the first.
const deviceIdentifier = "helsa"

// device is the `device` block of every discovery payload. At least one of
// `identifiers`/`connections` plus a `name` is required by Home Assistant.
type device struct {
	Identifiers  []string `json:"identifiers"`
	Name         string   `json:"name"`
	Manufacturer string   `json:"manufacturer,omitempty"`
	Model        string   `json:"model,omitempty"`
}

// origin says which software produced the discovery message. Optional, but it is
// what tells somebody reading Home Assistant's MQTT debug page where a stray
// entity came from.
type origin struct {
	Name       string `json:"name"`
	SupportURL string `json:"support_url,omitempty"`
}

// discoveryPayload is a Home Assistant MQTT *sensor* discovery document.
//
// ⚠️ Every field name here is Home Assistant's, not ours. A misspelt key does not
// produce an error anywhere: the entity simply never appears, and nothing in
// either system says why. The names come from the MQTT sensor documentation
// (home-assistant.io/integrations/sensor.mqtt/).
type discoveryPayload struct {
	Name     string `json:"name"`
	UniqueID string `json:"unique_id"`
	// The entity ID Home Assistant gives the entity when it first sees it,
	// "sensor.helsa_steps". Since Home Assistant 2025.10 this is the field; the
	// older `object_id` is ignored, and without either the ID is made from the
	// device and entity names ("sensor.helsa_steps_today"), which is not what the
	// documentation and the automations name. It applies on first registration
	// only: an entity that already exists keeps its ID.
	DefaultEntityID     string  `json:"default_entity_id,omitempty"`
	StateTopic          string  `json:"state_topic"`
	UnitOfMeasurement   string  `json:"unit_of_measurement,omitempty"`
	DeviceClass         string  `json:"device_class,omitempty"`
	StateClass          string  `json:"state_class,omitempty"`
	Icon                string  `json:"icon,omitempty"`
	AvailabilityTopic   string  `json:"availability_topic,omitempty"`
	ExpireAfter         int     `json:"expire_after,omitempty"`
	JSONAttributesTopic string  `json:"json_attributes_topic,omitempty"`
	Device              device  `json:"device"`
	Origin              *origin `json:"origin,omitempty"`
}

// entity is one published sensor: where its value goes and how Home Assistant
// should read it.
type entity struct {
	objectID string // [a-zA-Z0-9_-] only — it is part of the discovery topic
	name     string
	suffix   string // topic suffix under the Helsa prefix, e.g. "daily/steps"
	unit     string
	class    string // device_class
	stateCls string // state_class
	icon     string
	decimals int // how many decimal places the state payload carries

	// expiring entities carry `expire_after` and deliberately have NO
	// availability topic — see the freshness entity below.
	expiring bool
	attrs    string // json_attributes_topic suffix, if any

	// retain: whether the STATE message is published retained. Discovery messages
	// are always retained; state is a per-entity decision.
	retain bool
}

// The entity set. Daily summaries only — see docs/integrations/index.md for why
// raw samples must never end up here.
//
// On the units and state classes:
//
//   - `total_increasing` is for values that count up through the day and restart at
//     midnight (steps, active energy). Home Assistant treats the drop back to zero
//     as a new cycle instead of as a meter running backwards.
//   - `measurement` is for values that simply are what they are (heart rate, hours
//     slept, rings closed).
//
// Getting this wrong breaks nothing visibly; it quietly corrupts long-term
// statistics.
//
// ⚠️ No `device_class: energy` on active energy, although Home Assistant does
// accept kcal for it. That device class marks a sensor as an energy meter and
// offers it to the Energy dashboard, where a number of dietary calories next to
// the electricity meter is simply wrong.
var entities = []entity{
	{
		objectID: "helsa_steps",
		name:     "Steps today",
		suffix:   "daily/steps",
		unit:     "steps",
		stateCls: "total_increasing",
		icon:     "mdi:walk",
		retain:   true,
	},
	{
		objectID: "helsa_active_energy",
		name:     "Active energy today",
		suffix:   "daily/active_energy",
		unit:     "kcal",
		stateCls: "total_increasing",
		icon:     "mdi:fire",
		retain:   true,
	},
	{
		objectID: "helsa_sleep_hours",
		name:     "Sleep last night",
		suffix:   "daily/sleep_hours",
		unit:     "h",
		class:    "duration",
		stateCls: "measurement",
		icon:     "mdi:sleep",
		decimals: 1,
		retain:   true,
	},
	{
		objectID: "helsa_resting_heart_rate",
		name:     "Resting heart rate",
		suffix:   "daily/resting_heart_rate",
		unit:     "bpm",
		stateCls: "measurement",
		icon:     "mdi:heart-pulse",
		retain:   true,
	},
	{
		objectID: "helsa_rings_closed",
		name:     "Rings closed",
		suffix:   "daily/rings_closed",
		stateCls: "measurement",
		icon:     "mdi:circle-slice-8",
		retain:   true,
	},
	{
		// The one entity that is not a convenience. Everything about it is chosen so
		// that SILENCE is loud:
		//
		//   - `expire_after`: Home Assistant marks it `unavailable` by itself when no
		//     message arrives. Nothing on the Helsa side has to notice its own death.
		//   - NO availability topic: our last will would mark the entity unavailable for
		//     a different reason, and that would mask the expiry — the very signal.
		//   - NOT retained: Home Assistant's own documentation warns that a retained
		//     state is replayed on restart, which would resurrect an expired sensor with
		//     a stale value. Home Assistant restores the state itself and keeps the
		//     remaining expiry time.
		objectID: "helsa_sync_freshness",
		// ⚠️ "Sync freshness", not "Helsa sync freshness". Home Assistant composes an
		// entity's displayed name as DEVICE NAME + entity name, and the device here is
		// already called Helsa — so the prefixed form came out as "Helsa Helsa sync
		// freshness", alone among the six. The other five never carried the prefix, which
		// is why only this one doubled. The `objectID` keeps its prefix: that one is not a
		// display name, it is part of the discovery topic and the entity id.
		name:     "Sync freshness",
		suffix:   "sync/freshness_hours",
		unit:     "h",
		stateCls: "measurement",
		icon:     "mdi:heart-pulse",
		decimals: 1,
		expiring: true,
		attrs:    "sync/attributes",
		retain:   false,
	},
}

// topics derives every topic from the two configured prefixes — and, on a
// household server, from the member they are about (docs/36 §4.4, D8).
//
// ⚠️ The legacy member — HELSA_MQTT_USER_ID, or the only user of a one-person
// server — keeps EXACTLY the names a single-user Helsa always used: `helsa/daily/…`,
// `sensor.helsa_steps_today`, the device "Helsa". Home Assistant automations are
// built on those, and they must not break because a second person joined. Everyone
// else gets their handle in every name: `helsa/nori/daily/…`,
// `sensor.helsa_nori_steps_today`, the device "Helsa — Nóri". Legacy decides the
// NAMES only; whether anything is published at all is the member's own switch
// (users.ha_publish, §9 C25).
type topics struct {
	prefix          string
	discoveryPrefix string
	member          string // "" for the legacy member
	memberName      string // the device's name in Home Assistant, for a non-legacy member
}

// forMember is t for one member's entities.
func (t topics) forMember(handle, name string, legacy bool) topics {
	if legacy {
		return t
	}
	t.member = strings.ReplaceAll(handle, "-", "_")
	t.memberName = name
	if t.memberName == "" {
		t.memberName = handle
	}
	return t
}

func (t topics) state(suffix string) string {
	if t.member != "" {
		return t.prefix + "/" + t.member + "/" + suffix
	}
	return t.prefix + "/" + suffix
}

// status is the publisher's own availability topic — one for the whole process,
// whoever the entities are about: it says whether Helsa's worker is alive.
func (t topics) status() string              { return t.prefix + "/status" }
func (t topics) discovery(obj string) string { return t.discoveryPrefix + "/sensor/" + obj + "/config" }

// objectID is e's object id for this member: helsa_steps_today, or
// helsa_nori_steps_today.
func (t topics) objectID(e entity) string {
	if t.member == "" {
		return e.objectID
	}
	return strings.Replace(e.objectID, "helsa_", "helsa_"+t.member+"_", 1)
}

// haStatus is the topic Home Assistant publishes its own birth/will message on
// ("online"/"offline"). Seeing `online` there means Home Assistant has just
// restarted and is waiting for discovery messages — see Publisher.onMessage.
func (t topics) haStatus() string { return t.discoveryPrefix + "/status" }

// discoveryFor builds the discovery document for one entity.
func (t topics) discoveryFor(e entity, expireAfter time.Duration) discoveryPayload {
	id, devID, devName := t.objectID(e), deviceIdentifier, "Helsa"
	if t.member != "" {
		devID, devName = deviceIdentifier+"_"+t.member, "Helsa — "+t.memberName
	}
	p := discoveryPayload{
		Name:              e.name,
		UniqueID:          id,
		DefaultEntityID:   "sensor." + id,
		StateTopic:        t.state(e.suffix),
		UnitOfMeasurement: e.unit,
		DeviceClass:       e.class,
		StateClass:        e.stateCls,
		Icon:              e.icon,
		Device: device{
			Identifiers:  []string{devID},
			Name:         devName,
			Manufacturer: "Helsa",
			Model:        "Self-hosted health backend",
		},
		Origin: &origin{Name: "helsa", SupportURL: "https://github.com/nordic-sys/helsa"},
	}
	if e.expiring {
		p.ExpireAfter = int(expireAfter.Seconds())
	} else {
		// Everything except the dead man's switch follows the publisher's own
		// last-will topic, so a crashed publisher greys the values out instead of
		// leaving yesterday's number on screen looking current.
		p.AvailabilityTopic = t.status()
	}
	if e.attrs != "" {
		p.JSONAttributesTopic = t.state(e.attrs)
	}
	return p
}

func (t topics) discoveryJSON(e entity, expireAfter time.Duration) ([]byte, error) {
	buf, err := json.Marshal(t.discoveryFor(e, expireAfter))
	if err != nil {
		return nil, fmt.Errorf("marshal discovery for %s: %w", e.objectID, err)
	}
	return buf, nil
}
