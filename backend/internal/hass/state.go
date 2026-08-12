package hass

import (
	"encoding/json"
	"strconv"
	"time"
)

// missingPayload is what goes on the wire when there is no measurement.
//
// ⚠️ This is not a stylistic choice and not a magic string of ours: Home
// Assistant's MQTT sensor documentation states that for a sensor expecting a
// numeric value, "a 'None' value will set the sensor to an `unknown` state"
// (while an empty payload is IGNORED and leaves the previous value in place).
//
// It matters because it is the one place where this codebase's rule — a missing
// measurement is missing, never zero — has to survive the trip out of the system.
// Publishing 0 would tell an automation "you walked nothing today" at one minute
// past midnight; leaving the topic alone would leave yesterday's step count on
// screen looking like today's. Both are lies. `unknown` is the truth.
const missingPayload = "None"

// stateValue renders a value for the state topic.
func stateValue(v *float64, decimals int) string {
	if v == nil {
		return missingPayload
	}
	return strconv.FormatFloat(*v, 'f', decimals, 64)
}

// attributesJSON is the `json_attributes_topic` payload of the freshness sensor.
//
// The attributes exist so that the clamp in freshnessFrom cannot hide anything:
// `future_skew_s` says out loud that a clock is wrong, and `newest_data` is the
// raw timestamp the hours were computed from, so the number can be checked by
// hand rather than trusted.
func attributesJSON(f Freshness, source string) ([]byte, error) {
	newest := "never"
	if !f.Newest.IsZero() {
		newest = f.Newest.UTC().Format(time.RFC3339)
	}
	return json.Marshal(map[string]any{
		"newest_data":   newest,
		"future_skew_s": int(f.FutureSkew.Seconds()),
		"source":        source,
	})
}
