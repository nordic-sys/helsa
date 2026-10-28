---
title: A household on one server
description: "Several people on one Helsa server — a couple or a family — each seeing only their own data: adding a member, connecting their phone, signing in a browser, and what the server's owner can and cannot see."
sidebar:
  order: 5
---
One Helsa server can hold a whole household: you and your partner, or a family. Every
member sees **only their own** data — on the phone, in the dashboard, and in Home
Assistant. Nobody's health data is shown to anybody else, the admin included.

A phone is always one person: the Health app belongs to one Apple ID, so there is no
user switcher in the app. A member may have several devices (an iPhone, an iPad, a
browser or two), each with its own token they can see and revoke.

## Roles

| | Can | Cannot |
|---|---|---|
| **admin** | add, disable, re-enable and delete members; make another member admin; give a code to a member who has no device yet; see who uploads from which device and when; retry stuck uploads | see a member's measurements, sleep, workouts or journal — there is no screen for it, and the database refuses it |
| **member** | see and export their own data; connect and revoke their own devices; sign in a browser; switch their Home Assistant publishing on or off; delete everything of theirs on the server | see anybody else's anything |

The first user of a server is its admin. There is always at least one enabled admin: the
last one cannot be demoted, disabled or deleted.

## Adding a member, end to end

**On your own computer** (the CA never leaves it — [TLS and mutual TLS](/getting-started/certificates/)):

```bash title="On your workstation, in deploy/pki"
make client NAME=nori-iphone      # one certificate per device: <handle>-<device>
```

Hand the `.p12` to the member (AirDrop), and its password separately.

**In the dashboard**, as admin: *Household ▸ New member* — a short handle (`nori`) and a
display name. Then *Connect a device*: a QR code and an eight-character code (`K7QM-4XPA`)
that lives 15 minutes and works once.

**On the member's phone**: *Helsa ▸ Your own server ▸ Sending ▸ Join with a QR code*. The app
first asks for the client certificate if it has none, then scans the code, asks for the
device's name, and connects. Nothing has to be typed, and the long-lived token is never on a
screen.

Without the dashboard — on the server:

```bash title="On the server"
make prod-user-add HANDLE=nori NAME="Nóri"
make prod-login-code HANDLE=nori     # a 10-minute code for the dashboard's sign-in page
```

## Signing in a browser

The dashboard has no passwords. The sign-in page asks for a one-time code, which a member
gets on their phone (*Your own server ▸ Sign in to the web dashboard*) — or, if they have no
device at all yet, from the admin. The browser then keeps a session cookie for 30 days, renewed
while it is used. *Sign out* ends it; any of a member's sessions can also be revoked from *My
account*, on the phone or from another browser.

The very first admin has nobody to get a code from: `make prod-login-code HANDLE=<you>` on the
server.

:::note[Why an admin cannot hand out codes freely]
A code signs in **as the member**. So an admin can give a code only to a member with no live
device or session — a new member, or one who has lost everything. A member who has a device asks
for their own. The only way around it is to revoke the member's devices first, which stops their
phone and shows in their account log.
:::

## What the server's owner can see

Said the same way in the app, in the dashboard and here:

> In Helsa, the server's owner sees your name, your connected devices and when you last
> uploaded — not your health data and not your journal. If they do something with your
> account (issue a code, revoke a device), it appears in your account log.
>
> The server runs on their machine, so they have technical access to the database itself. The
> log does not show that — only connect to a server whose owner you trust.

That is true of every self-hosted server. What Helsa adds:

- **The database keeps members apart, not only the application.** Every table with a person's
  rows has row-level security, and the API cannot read the raw samples at all — only through a
  view that shows the signed-in member's. A forgotten filter in a query returns nothing rather
  than somebody else's data ([hardening](/deployment/hardening/)).
- **The account log** — every code issued, device revoked, role changed — is the member's to
  read, under *My account*.

## Leaving

A member can export their data (*My account ▸ Export*) and delete everything of theirs on the
server (*Delete my account and data*). The phone and the Health app are not touched.

An admin can **disable** a member — every device of theirs is refused at once, and re-enabling
lets the same phone carry on — or **delete** them. A disabled member cannot sign in to export, so
ask first.

Deleting removes the member's rows, aggregates, cached summaries, Home Assistant entities and
stuck uploads from the live server. ⚠️ **Backups keep them until they expire** — the nightly dumps
for three days, a VM backup for as long as you keep it. After restoring an older backup, delete
the member again ([backups](/deployment/backups/#after-deleting-a-member)).

## Home Assistant

Each member decides for themselves whether their daily numbers go to Home Assistant (*My
account*), off by default — everything on the broker can be seen by anyone in the house with
access to Home Assistant. See [Home Assistant](/integrations/home-assistant/#several-people).

## If a phone is lost or compromised

Revoke its token (*My account*, or the admin under *Household*) — the token is refused from the
next request. The device's client certificate stays valid for the proxy; it cannot reach any data
or redeem anything without a live code, but to shut it out completely, issue a new CA and new
certificates for every device ([TLS and mutual TLS](/getting-started/certificates/)).
