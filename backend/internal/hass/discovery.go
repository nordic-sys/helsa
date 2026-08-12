package hass

import (
	"encoding/json"
	"fmt"
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
	Name                string  `json:"name"`
	UniqueID            string  `json:"unique_id"`
	ObjectID            string  `json:"object_id,omitempty"`
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
		name:     "Helsa sync freshness",
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

// topics derives every topic from the two configured prefixes.
type topics struct {
	prefix          string
	discoveryPrefix string
}

func (t topics) state(suffix string) string  { return t.prefix + "/" + suffix }
func (t topics) status() string              { return t.prefix + "/status" }
func (t topics) discovery(obj string) string { return t.discoveryPrefix + "/sensor/" + obj + "/config" }

// haStatus is the topic Home Assistant publishes its own birth/will message on
// ("online"/"offline"). Seeing `online` there means Home Assistant has just
// restarted and is waiting for discovery messages — see Publisher.onMessage.
func (t topics) haStatus() string { return t.discoveryPrefix + "/status" }

// discoveryFor builds the discovery document for one entity.
func (t topics) discoveryFor(e entity, expireAfter time.Duration) discoveryPayload {
	p := discoveryPayload{
		Name:              e.name,
		UniqueID:          e.objectID,
		ObjectID:          e.objectID,
		StateTopic:        t.state(e.suffix),
		UnitOfMeasurement: e.unit,
		DeviceClass:       e.class,
		StateClass:        e.stateCls,
		Icon:              e.icon,
		Device: device{
			Identifiers:  []string{deviceIdentifier},
			Name:         "Helsa",
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
