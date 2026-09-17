# Virtual journey tracks — derived from OpenStreetMap, ODbL

The Helsa app has a *virtual journey*: the distance you walk and run moves you along a real
long-distance route. Each route is drawn as a line, and that line is **derived from
OpenStreetMap**.

**© OpenStreetMap contributors. This data is made available under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).**

## Why this folder exists

ODbL separates two things, and Helsa touches both:

- A **Produced Work** — something *rendered* from the database, such as the line drawn on the
  journey screen. That obliges attribution, and the app carries it on screen for every route
  that has a track.
- A **Derivative Database** — the derived data itself. Helsa does not only draw with these
  coordinates; it **computes** with them, working out where along the route you are. That makes
  what it ships data, not only a picture, and publicly using a derivative database obliges us to
  offer that database under ODbL.

So it is offered here. Nothing is asked in return; this is the obligation being met, not a
favour.

## What is in a file

One JSON per route, named by the route's id in the app.

| Field | |
|---|---|
| `osmRelationID` · `stitchedRelationIDs` | the OSM route relation(s) this came from. Several ids mean the route is a super-relation and the members were stitched in order |
| `fetchedOn` | the day the relation was read. OSM changes; a track without a date is a claim without a time |
| `coordinates` | `[latitude, longitude]`, 5 decimal places (about 1.1 m) |
| `toleranceMeters` | the Douglas–Peucker tolerance used to simplify. Every discarded point was within this distance of the kept line |
| `computedLengthMeters` | the length of **this** line |
| `publishedLengthMeters` | the length the route's operator publishes |
| `maxGapMeters` | the largest hole in the source relation, measured **before** simplification — a real gap in the mapping, drawn as a straight jump |
| `recipe` | the exact command that produced it |

## ⚠️ The two lengths are not the same, and neither is wrong

`computedLengthMeters` and `publishedLengthMeters` differ, sometimes by several percent. They
answer different questions: what the mapped geometry adds up to, versus what the operator
signposts. The app treats the **published** length as the route's length and never lets the
track redefine it — otherwise "100% complete" would silently mean "100% of whatever OSM maps
today", which changes whenever somebody edits a way.

The simplified line is shorter again: a 100 m tolerance cuts corners, and corners have length.
Each file carries both numbers so the difference is visible rather than surprising.

## ⚠️ A gap is a gap

`maxGapMeters` is not a rounding error. Some relations genuinely have holes — a ferry leg, an
unmapped stretch, a member that belongs to a different variant of the route. Where a gap exists,
the line jumps straight across it. That is honest and it is also wrong-looking, which is why the
number is published next to the data instead of being smoothed away.

Five of the app's routes have **no** track at all, and so do not appear here: their relations
could not be assembled into a line that is actually the route. A drawn line that looks like a
route and is not one is worse than no line.

## Regenerating

The source of truth is the generated Swift in the app repository; these files are an export of
it. The recipe in each file re-fetches the relation from the Overpass API.

⚠️ Overpass is a free, shared, rate-limited service. These queries were run once and their
results committed. Please do not put them in a loop.
