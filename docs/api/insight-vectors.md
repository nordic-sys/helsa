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
  "expect": [
    {
      "id": "resting-hr-elevated:2026-08-11",
      "kind": "anomaly",
      "metric": "restingHeartRate",
      "severity": "notice",
      "values": { "recent": 63.0, "baseline": 55.5, "deviation": 0.5 }
    }
  ]
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
- `expect` is the full expected output, in order. An empty list is a legitimate
  expectation, and there should be vectors for it: most days there is nothing worth
  saying, and a rule that always finds something is worse than useless.
- `values` carries the numbers the rule computed, rounded to one decimal. This is
  what catches a drifting threshold — the fired/not-fired flag alone would not.

## Adding a rule

1. Write the vectors first, including the negative cases: just below the threshold,
   and just under the data minimum.
2. Implement on both sides until both vector suites pass.
3. Word the sentence separately on each side, tested locally.

A rule that has no vector for "should stay silent" is not finished. Every rule here
has a data minimum, and the failure mode that matters is not a wrong number — it is
a confident statement made from too little evidence.
