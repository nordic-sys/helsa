package hass

import (
	"encoding/json"
	"regexp"
	"testing"
	"time"
)

func topicsForTest() topics {
	return topics{prefix: "helsa", discoveryPrefix: "homeassistant"}
}

// The discovery topic is <discovery_prefix>/<component>/<object_id>/config, and
// Home Assistant restricts node_id/object_id to [a-zA-Z0-9_-]. A character
// outside that class does not produce an error — the entity just never appears.
func TestDiscoveryTopicShape(t *testing.T) {
	top := topicsForTest()
	allowed := regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

	seen := map[string]bool{}
	for _, e := range entities {
		if !allowed.MatchString(e.objectID) {
			t.Errorf("object_id %q contains characters Home Assistant does not accept", e.objectID)
		}
		if seen[e.objectID] {
			t.Errorf("duplicate object_id %q: the second entity would overwrite the first", e.objectID)
		}
		seen[e.objectID] = true

		if got, want := top.discovery(e.objectID), "homeassistant/sensor/"+e.objectID+"/config"; got != want {
			t.Errorf("discovery topic = %q, want %q", got, want)
		}
	}
}

// Every payload must carry the keys Home Assistant needs to build a sensor, and
// the device block that groups them.
func TestDiscoveryPayloadRequiredKeys(t *testing.T) {
	top := topicsForTest()
	for _, e := range entities {
		buf, err := top.discoveryJSON(e, 90*time.Minute)
		if err != nil {
			t.Fatalf("%s: %v", e.objectID, err)
		}
		var got map[string]any
		if err := json.Unmarshal(buf, &got); err != nil {
			t.Fatalf("%s: payload is not valid JSON: %v", e.objectID, err)
		}
		for _, key := range []string{"name", "unique_id", "state_topic", "device"} {
			if _, ok := got[key]; !ok {
				t.Errorf("%s: discovery payload has no %q", e.objectID, key)
			}
		}
		dev, ok := got["device"].(map[string]any)
		if !ok {
			t.Fatalf("%s: device block is not an object", e.objectID)
		}
		if _, ok := dev["identifiers"]; !ok {
			t.Errorf("%s: device block needs identifiers, otherwise the entities do not group", e.objectID)
		}
		if _, ok := dev["name"]; !ok {
			t.Errorf("%s: device block needs a name", e.objectID)
		}
		if got["state_topic"] != "helsa/"+e.suffix {
			t.Errorf("%s: state_topic = %v, want helsa/%s", e.objectID, got["state_topic"], e.suffix)
		}
	}
}

// The dead man's switch is defined by what it does NOT have. If it ever grew an
// availability_topic, our own last will would mark it unavailable for the wrong
// reason and mask the expiry — the alert would go quiet exactly when it matters.
func TestFreshnessEntityCanExpire(t *testing.T) {
	top := topicsForTest()
	buf, err := top.discoveryJSON(freshnessEntity(), 90*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(buf, &got); err != nil {
		t.Fatal(err)
	}
	if got["expire_after"] != float64(5400) {
		t.Errorf("expire_after = %v, want 5400 (90 minutes)", got["expire_after"])
	}
	if _, ok := got["availability_topic"]; ok {
		t.Error("the freshness sensor must NOT have an availability_topic: it would mask the expiry")
	}
	if got["json_attributes_topic"] != "helsa/sync/attributes" {
		t.Errorf("json_attributes_topic = %v", got["json_attributes_topic"])
	}
	if freshnessEntity().retain {
		t.Error("the freshness state must not be retained: a replayed retained value resurrects an expired sensor")
	}
}

// Everything that is NOT the alert follows the publisher's last will, so a dead
// publisher greys the numbers out instead of leaving yesterday's on screen.
func TestConvenienceEntitiesFollowAvailability(t *testing.T) {
	top := topicsForTest()
	for _, e := range entities {
		if e.expiring {
			continue
		}
		p := top.discoveryFor(e, 90*time.Minute)
		if p.AvailabilityTopic != "helsa/status" {
			t.Errorf("%s: availability_topic = %q, want helsa/status", e.objectID, p.AvailabilityTopic)
		}
		if p.ExpireAfter != 0 {
			t.Errorf("%s: expire_after set on a non-alert entity", e.objectID)
		}
	}
}

// The prefixes are configurable, and every topic has to move with them together.
func TestTopicsHonourPrefixes(t *testing.T) {
	top := topics{prefix: "house/helsa", discoveryPrefix: "ha"}
	if got := top.state("daily/steps"); got != "house/helsa/daily/steps" {
		t.Errorf("state topic = %q", got)
	}
	if got := top.status(); got != "house/helsa/status" {
		t.Errorf("status topic = %q", got)
	}
	if got := top.discovery("helsa_steps"); got != "ha/sensor/helsa_steps/config" {
		t.Errorf("discovery topic = %q", got)
	}
	if got := top.haStatus(); got != "ha/status" {
		t.Errorf("home assistant status topic = %q", got)
	}
}

// State classes: summing a counter that resets at midnight needs
// total_increasing; a value that simply is what it is needs measurement. A wrong
// one breaks nothing visibly and quietly corrupts long-term statistics.
func TestStateClassesAreDeliberate(t *testing.T) {
	want := map[string]string{
		"helsa_steps":              "total_increasing",
		"helsa_active_energy":      "total_increasing",
		"helsa_sleep_hours":        "measurement",
		"helsa_resting_heart_rate": "measurement",
		"helsa_rings_closed":       "measurement",
		"helsa_sync_freshness":     "measurement",
	}
	for _, e := range entities {
		if w, ok := want[e.objectID]; !ok {
			t.Errorf("new entity %q: decide its state_class deliberately and add it here", e.objectID)
		} else if e.stateCls != w {
			t.Errorf("%s: state_class = %q, want %q", e.objectID, e.stateCls, w)
		}
	}
}
