package server

import (
	"encoding/json"
	"testing"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

func TestNotifPrefsFromJSONAppliesContractDefaults(t *testing.T) {
	// Empty jsonb (the default of users.notif_prefs) → the client gets a complete
	// object.
	got := notifPrefsFromJSON([]byte(`{}`))
	assertPrefs(t, got, true, true, false, false)

	// The stored value overrides the default; a missing field stays on the default.
	got = notifPrefsFromJSON([]byte(`{"sync_errors":false,"insights":true}`))
	assertPrefs(t, got, false, true, false, true)

	// Corrupted jsonb → the default, not a panic.
	got = notifPrefsFromJSON([]byte(`{not json`))
	assertPrefs(t, got, true, true, false, false)

	// Nil (in principle impossible, because the column is NOT NULL) → the default.
	assertPrefs(t, notifPrefsFromJSON(nil), true, true, false, false)
}

func TestMergeNotifPrefsKeepsUntouchedFlags(t *testing.T) {
	stored := []byte(`{"sync_errors":false,"weekly_summary":true}`)

	raw, err := mergeNotifPrefs(stored, &api.NotifPrefs{Insights: boolPtr(true)})
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	var got api.NotifPrefs
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.SyncErrors == nil || *got.SyncErrors {
		t.Errorf("the patch overwrote sync_errors=false: %+v", got.SyncErrors)
	}
	if got.WeeklySummary == nil || !*got.WeeklySummary {
		t.Errorf("the patch lost weekly_summary=true: %+v", got.WeeklySummary)
	}
	if got.Insights == nil || !*got.Insights {
		t.Errorf("the patch did not take effect: insights=%+v", got.Insights)
	}
	// The defaults are deliberately NOT written to the database: the untouched
	// goal_nudges must stay empty.
	if got.GoalNudges != nil {
		t.Errorf("the merge wrote a default into the database: goal_nudges=%+v", got.GoalNudges)
	}
}

func TestValidTimeZone(t *testing.T) {
	for _, tz := range []string{"Europe/Budapest", "UTC", "America/New_York"} {
		if !validTimeZone(tz) {
			t.Errorf("%q should be a valid tz", tz)
		}
	}
	// The empty string would be UTC for time.LoadLocation — in a setting that is not
	// what anyone means.
	for _, tz := range []string{"", "Nowhere/Neverland", "Budapest"} {
		if validTimeZone(tz) {
			t.Errorf("%q must NOT be a valid tz", tz)
		}
	}
}

func TestSettingsDTO(t *testing.T) {
	got := settingsDTO("Europe/Budapest", "hu", "metric", []byte(`{"goal_nudges":true}`))
	if got.TimeZone == nil || *got.TimeZone != "Europe/Budapest" {
		t.Errorf("time_zone: %+v", got.TimeZone)
	}
	if got.Locale == nil || *got.Locale != api.SettingsLocale("hu") {
		t.Errorf("locale: %+v", got.Locale)
	}
	if got.UnitSystem == nil || *got.UnitSystem != api.SettingsUnitSystem("metric") {
		t.Errorf("unit_system: %+v", got.UnitSystem)
	}
	if got.NotifPrefs == nil {
		t.Fatal("notif_prefs is missing")
	}
	assertPrefs(t, *got.NotifPrefs, true, true, true, false)
}

func assertPrefs(t *testing.T, p api.NotifPrefs, syncErrors, weekly, nudges, insights bool) {
	t.Helper()
	for _, c := range []struct {
		name string
		got  *bool
		want bool
	}{
		{"sync_errors", p.SyncErrors, syncErrors},
		{"weekly_summary", p.WeeklySummary, weekly},
		{"goal_nudges", p.GoalNudges, nudges},
		{"insights", p.Insights, insights},
	} {
		if c.got == nil {
			t.Errorf("%s: nil (expected %v)", c.name, c.want)
			continue
		}
		if *c.got != c.want {
			t.Errorf("%s = %v (expected %v)", c.name, *c.got, c.want)
		}
	}
}
