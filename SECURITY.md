# Security

## Not a medical device

Helsa stores and summarises health data. It **diagnoses nothing**, it is not a
medical device, and nothing it shows should be the basis of a health decision. The
insight rules deliberately word themselves cautiously and say nothing at all when
there is too little data — an invented observation is worse than silence.

The warranty disclaimer in the [licence](LICENSE) applies. That said, the practical
protection is not the text but the defaults: this repository tries never to lead
anyone into a dangerous configuration, and it warns at the risky steps.

## What this project assumes about your deployment

Helsa was written for **one person on their own infrastructure**. If you run it,
the health data is on your machine and it is yours to protect. The defaults are
conservative:

- The base compose file **publishes no ports at all**; the data services are
  reachable only on the internal Docker network. The host ports come solely from the
  local development overlay.
- In the single-host overlay, only the reverse proxy faces outwards: the API behind
  **mandatory mTLS**, the dashboard behind network filtering on a port that is not
  forwarded.
- Migrations are a **separate, deliberate step**, never a start-up side effect.
- The signing material lives **outside the checkout**, so it can neither end up in
  the repository nor be swept away by a `git clean`.

⚠️ **Opening a port outwards is the riskiest step in the whole setup.** If you
change any of the above, change it knowingly.

## Things that fail silently

These are worth stating, because none of them announces itself — you find out weeks
later that data is missing:

- **An expired certificate.** The phone simply stops syncing; because the client
  buffers, no data is lost, and nothing tells you. Run `make expiry` in `deploy/pki`,
  and put the dates in a calendar.
- **A stale DDNS record, a dead worker, a full disk.** All the same shape. The one
  real alert in this system is the sync-freshness heartbeat
  (`deploy/scripts/sync-heartbeat.sh`), which is deliberately a dead man's switch:
  if the machine dies, the script stops running, and that absence is what raises the
  alarm.
- **A backup that has never been restored.** `deploy/scripts/RESTORE.md` includes a
  trial-restore procedure, and a place to record when it was last proven to work.
  TimescaleDB restores are not a plain `pg_restore`.

## Reporting a vulnerability

This is a personal project with no security team and no response-time commitment.
If you find something, open an issue — or, if it is sensitive, contact the
repository owner privately through their GitHub profile. Please do not open a public
issue containing exploit details for a problem that would affect other people's
running instances.
