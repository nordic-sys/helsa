---
title: Insight test vectors
layout: default
parent: API
nav_order: 5
---

# Insight test vectors

The insight rules exist **twice**: in Go, for a server that anyone can run, and in
Swift, so the iOS app can produce them with no server at all. That duplication is
the price of being local-first while keeping the server optional — it cannot be
designed away.

What can be designed away is the *silent* divergence. Both implementations run the
same vectors, so a threshold changed on one side fails the other side's tests.
Without that, the two engines would disagree within a year, and a user would watch
their phone and their dashboard contradict each other about their own body.

## What the vectors pin, and what they do not

They pin **behaviour**: which rule fires, on which day, from which numbers.

They deliberately do **not** pin the rendered sentence. Go and Swift format numbers
through different libraries, and a shared string assertion would break on a
thousands separator rather than on a rule — noise where the signal should be. Each
side tests its own wording; the vectors test the decision.

## Format

One JSON file per case, in `backend/internal/insights/testdata/vectors/`.

```json
{
  "name": "resting-hr-elevated fires after three raised days",
  "today": "2026-08-11",
  "timezone": "Europe/Budapest",
  "daily": {
    "restingHeartRate": [
      { "day": "2026-07-14", "value": 55.0 }
    ]
  },
  "sleepHours": [
    { "day": "2026-07-14", "value": 7.2 }
  ],
  "sleepNights": [
    { "day": "2026-07-14", "start": "2026-07-14T23:10", "end": "2026-07-15T06:40" }
  ],
  "workouts": [
    { "day": "2026-07-14", "activityType": "running", "durationMin": 42.0,
      "distanceM": 7200.0, "avgHeartRate": 148.0, "energyKcal": 430.0 }
  ],
  "expect": [
    {
      "id": "resting-hr-elevated:2026-08-11",
      "kind": "anomaly",
      "metric": "restingHeartRate",
      "severity": "notice",
      "values": { "recent": 63.0, "baseline": 55.5, "deviation": 0.5 }
    }
  ],
  "silentFor": ["sleep-short"]
}
```

**Rules for the fields**

- `today` is the local calendar day the evaluation runs on; `timezone` names the
  zone it is read in. A day boundary is a timezone question, and a vector that
  omitted it would pass in Budapest and fail in London.
- `daily` maps a `data_type` to a dated series. Values are already aggregated the
  way the metric demands (sum for cumulative, average for discrete).
- **A missing day is missing, not zero.** Leave the entry out. A rule that treats a
  gap as a measured zero is a bug this project has hit repeatedly, and the vectors
  are the place to keep proving it.
- `expect` is the full expected output, in order (the engine sorts by `id`). An
  empty list is a legitimate expectation, and there should be vectors for it: most
  days there is nothing worth saying, and a rule that always finds something is
  worse than useless.
- `values` carries the numbers the rule computed, rounded to one decimal. This is
  what catches a drifting threshold — the fired/not-fired flag alone would not.
  The key set is matched exactly: a rule that quietly stops publishing one of its
  numbers, or starts publishing a new one, is a change the other implementation
  has to hear about.

  ⚠️ **These numbers are also what goes on the wire.** `GET /v1/insights` sends
  `rule` and `values` — data — and the client composes the sentence from them, in
  its own language; the server's Hungarian wording survives only as a fallback for
  a rule the client does not know (`openapi.yaml` → `Insight.values`). So a value
  set has a second job now: it must be **enough to word the rule's own sentence**.
  A rule publishing too little would read perfectly on the machine that computed
  it and go silent everywhere else, which is why the Swift suite checks that the
  composer can reproduce each fired insight from its values alone.
- Decoding is **strict** on both sides — an unknown field is an error. The failure
  that prevents is the nastiest one available here: a mistyped key silently
  dropping the very data the case was written to exercise, leaving a test that
  passes while testing nothing.

**Sleep comes in two fields, and neither is derivable from the other**

`sleepHours` is the sum of the `asleep*` segments; `sleepNights` is the period the
night spans. Waking at 3 a.m. for an hour shortens the first and leaves the second
alone. The duration rules read the first, the timing rules the second, and a
vector supplies whichever the case is about — often both, because "the length was
rock steady while the timing was all over the place" is precisely the pattern the
regularity rule exists to find.

`start` and `end` are **local wall-clock** times (`YYYY-MM-DDTHH:MM`) read in
`timezone`, matching how `day` already works. A night starting after midnight
carries the previous day's `day`: a night is keyed by the day it *began*, so that
a 23:50 bedtime and a 00:10 one land in the same night rather than 24 hours
apart. Do not place a vector's nights on a DST changeover — a wall clock is
ambiguous there, and the case would be testing the calendar rather than the rule.

**Workouts** carry `durationMin` always; `distanceM`, `avgHeartRate` and
`energyKcal` are optional and **must be left out when absent**. A session recorded
without a heart-rate strap has no average heart rate, and writing `0` would state
that the wearer's heart had stopped.

**`silentFor` names the rules a vector proves stay quiet.** An empty `expect` says
nothing about *which* rule was exercised — `silentFor` says it out loud, and the
suite holds every rule to having at least one vector of each kind. List a rule
here only when the data actually approached its conditions: the claim worth making
is "this rule looked at real, nearly-qualifying data and still had the discipline
to say nothing", not "there was no data at all".

## The rules, and what each vector set has to cover

| Rule (identifier stem) | Fires on | `values` |
|---|---|---|
| `resting-hr-elevated`, `hrv-depressed`, `sleep-short` | 3 recent days ≥1.5σ from a 28-day baseline, plus an absolute floor | `recent`, `baseline`, `deviation`, `baselineDays` |
| `steps-weekly-trend`, `sleep-weekly-trend` | two 7-day windows, ≥10% apart plus an absolute floor | `current`, `previous`, `changePct`, `currentDays`, `previousDays` |
| `steps-sleep-correlation` | ≥14 paired days, \|r\| ≥ 0.5 | `r`, `pairs` |
| `sleep-regularity` | midpoint scatter ≥60 min over ≥14 nights | `midpoint`, `midpointSd`, `nights` |
| `sleep-midpoint-weekend`, `sleep-weekend-duration`, `steps-weekend` | free days against work days, ≥4 and ≥10 measured respectively | `free`, `work`, `delta`, `freeCount`, `workCount` |
| `training-load-jump` | 7-day load ≥1.5× the 28-day weekly average | `acute`, `chronicWeekly`, `ratio`, `acuteCount` |
| `efficiency-trend-<activity>` | pace ≥5% apart at a heart rate within 5 bpm | `recentSpeed`, `previousSpeed`, `recentHr`, `previousHr`, `changePct`, `recentCount`, `previousCount` |
| `baseline-drift-<metric>` | the last 28 days against days 90–120 back: Welch t ≥ 2.5 **and** an absolute floor, ≥14 measured days per window (8 for `bodyMass`) | `recent`, `older`, `drift`, `t`, `recentDays`, `olderDays` |
| `sleep-debt` | the last 14 nights against the median of the preceding 90: ≥5 hours owed **and** ≥5% of what those nights should have held | `debtHours`, `usual`, `nights`, `slept`, `expected`, `baselineNights` |
| `social-jetlag` | median weekly free-vs-work midpoint shift ≥90 min over ≥6 usable weeks of 8, two thirds of them ≥30 min | `jetlagMinutes`, `weeks`, `nights`, `weekCount`, `agreeing` |

⚠️ **The `…Days` / `…Count` keys are data, not constants.** `baselineDays` is how
many of the 28 baseline days actually HAD data — `BaselineDays` is how far we
looked, this is how much we found — and the sentence names it. What is
deliberately **absent**: labels, units, caveats, and the direction a rule points
in. Those are properties of the rule, and a client that knows the rule knows them
already; sending them would put one fact in two places and let a server's copy
contradict the app's own screens. A trend's direction is the sign of `changePct`,
and `social-jetlag` does not send its time-zone count because that is the median
rounded to hours — a number both sides can derive, and therefore one they could
round differently.

`kind` is one of `trend`, `anomaly`, `correlation`, `pattern`. A `pattern`
describes a property of one window — how much bedtime scatters, how the weekend
differs from the week, what a fortnight of sleep added up to — which is not a
change over time, and so is not a `trend`.

Two of these overlap on purpose, and a vector pins the boundary between them:
`sleep-midpoint-weekend` pools one 28-day window and speaks from 60 minutes up,
while `social-jetlag` pairs each week with itself and waits for 90 — so at 75
minutes exactly one of them says anything, and at 120 both may, without
contradicting each other.

⚠️ `baseline-drift` reads two series no other rule asks for (`respiratoryRate`,
`bodyMass`) and reaches four months back. A rule whose days or metrics never
arrive returns nothing — which is indistinguishable from a rule with nothing to
say, so the read window and the metric list are part of the port, not an
afterthought (`LookbackDays`, `neededMetrics`).

## Adding a rule

1. Write the vectors first, including the negative cases: just below the threshold,
   and just under the data minimum.
2. Implement on both sides until both vector suites pass.
3. Word the sentence separately on each side, tested locally.

A rule that has no vector for "should stay silent" is not finished. Every rule here
has a data minimum, and the failure mode that matters is not a wrong number — it is
a confident statement made from too little evidence. The Go suite enforces exactly
that: a rule appearing in no `expect`, or in no `silentFor`, fails the build.
