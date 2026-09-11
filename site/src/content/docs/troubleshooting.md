---
title: When it does not work
description: "A symptom index: what you are seeing, and the page that explains it."
sidebar:
  order: 90
---
This page holds no explanations of its own. It exists because the explanations are
spread across six pages under six different headings, and a reader at midnight does not
know which one owns their symptom.

## Nothing arrives from the phone

| What you see | Where the answer is |
|---|---|
| Saved the server settings, and no device ever registers | ⚠️ **The app has to be restarted** — the connection is built at launch. [First sync](/getting-started/first-sync/#turn-on-sending) |
| The app reports a network error that is not a network error | The certificate installed but was never **trusted**. [TLS and mutual TLS](/deployment/tls-mtls/#installing-on-the-phone) |
| It worked, and one day quietly stopped | A certificate expired. [Expiry is a silent failure](/deployment/tls-mtls/#expiry-is-a-silent-failure) |
| The token is refused, and the body says it was revoked | It was. [Revoking](/getting-started/device-token/#revoking) |
| `503` on every call, with a healthy-looking server | The revocation deny-list is unreachable. [Authentication](/api/authentication/) |
| Uploads are rejected as too large | Chunking. [Ingest failure modes](/api/ingest/#failure-modes) |

## The numbers look wrong

| What you see | Where the answer is |
|---|---|
| Steps roughly doubled against the Health app | The server sums every source; HealthKit's merged statistics exist only on the phone. [First sync](/getting-started/first-sync/#when-it-does-not-work) |
| A figure that will not update | It is cached for 60 seconds and dropped when a batch lands. [Reading data](/api/reading-data/#summary) |
| An observation resting on very little | Every rule states what it needs first. [Reading data](/api/reading-data/#insights) |
| A Home Assistant sensor showing `unknown` | That is the design — a missing measurement is never a zero. [Home Assistant](/integrations/home-assistant/) |
| Sensors that went stale without anything saying so | The freshness sensor is the alarm. [The alert that matters](/integrations/home-assistant/#the-alert-that-matters) |

## The server itself

| What you see | Where the answer is |
|---|---|
| It answers on the LAN but not through the proxy | [The gotcha that will get you](/deployment/reverse-proxy/#the-gotcha-that-will-get-you) |
| You want to know whether it is really up | `/readyz`, not `/healthz`. [Quick start](/getting-started/quick-start/#confirm-it-answers) |
| Something went wrong and you are deciding what to do first | [If something does go wrong](/deployment/hardening/#if-something-does-go-wrong) |
| You need to get the data back | [Backups and restore](/deployment/backups/) |

## Still stuck

[Support](/support/) — and for the server, an issue in the repository is usually
faster, because the logs can be pasted in.
