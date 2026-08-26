---
title: Authentication
description: "Two layers: a client certificate at the proxy and a bearer device token at the application."
sidebar:
  order: 1
---
## Two independent layers

```
client ──TLS handshake──▶ proxy          layer 1: client certificate
                            │                     signed by your private CA
                            ▼
                          api            layer 2: Authorization: Bearer <token>
```

| Layer | Where | Failure looks like |
|---|---|---|
| Client certificate | Reverse proxy, during the TLS handshake | The connection does not complete. No HTTP status, because there is no HTTP. |
| Device token | The API | `401` with a problem document. |

Both are required on the public interface. The browser dashboard, reachable only
over LAN or VPN, presents the token alone — there the network is the first layer.

## The token

A JWT signed with `HELSA_JWT_SECRET`, issued on the server by an operator command:

```bash
docker compose --profile tools run --rm token -subject iphone
```

There is deliberately **no HTTP endpoint that issues tokens**. An endpoint that
mints credentials is an endpoint an attacker can call; a command on the host is
not.

Send it on every request:

```http
GET /v1/summary?range=day&metrics=stepCount HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

Lifetime is long by design. The reasoning — and the revocation options — are on the
[Device token](../getting-started/device-token/) page.

## `/v1/auth/refresh` and `/v1/auth/logout`

These exist for the browser session, which uses a short access token plus a refresh
token in an `httpOnly` cookie.

- `POST /v1/auth/refresh` — exchange a refresh token for a new session. No bearer
  token needed.
- `POST /v1/auth/logout` — revoke the refresh token, adding it to the Redis
  deny-list. `204`.

Native clients normally use their long-lived device token and never touch either.

## Client certificate details reaching the application

The proxy forwards the certificate subject and serial as headers so the API can
record which device is talking:

```
X-Client-Cert-Subject: CN=iphone,O=Helsa
X-Client-Cert-Serial:  ...
```

:::note
These are **context, not authentication**. The authentication decision was made
at the handshake, by the proxy. Anything that could reach the API directly could
set these headers itself, which is why the API must never treat them as proof of
anything — and why nothing but the proxy may be able to reach the API.
:::

## Writing your own client

```bash
curl --cacert ca.crt \
     --cert client.crt --key client.key \
     -H "Authorization: Bearer $HELSA_TOKEN" \
     'https://helsa.example.net/v1/summary?range=week&metrics=stepCount&tz=Europe/Budapest'
```

In code:

1. Load the client identity — a PKCS#12 bundle or a certificate/key pair — into
   your TLS configuration.
2. **Pin your CA** rather than using the system trust store. The server certificate
   is not signed by a public authority, and pinning also rules out a rogue public
   CA.
3. Send the bearer token on every request.
4. Treat `401` as "get a new token" and a TLS failure as "fix the certificate".
   They are different problems with different fixes.

## Error responses

RFC 9457 problem documents:

```json
{
  "type": "about:blank",
  "title": "unauthorized",
  "status": 401,
  "detail": "missing or invalid bearer token"
}
```

| Status | Meaning |
|---|---|
| `401` | No token, malformed token, wrong signing secret, or revoked. |
| `404` | Unknown route, or a resource that does not exist. |
| `413` | Ingest chunk too large. Split it and retry. |
| `501` | In the contract but not implemented — currently only PDF export. |
| `503` | `/readyz` when a dependency is unreachable. |
