---
title: Reverse proxy
description: "The Caddy configuration for the two interfaces, what opening port 443 actually means, and how to validate before deploying."
sidebar:
  order: 2
---
The proxy is the only component that faces the internet. Everything else talks
over the internal Docker network and publishes nothing.

## Before you open a port

:::danger[What "forward port 443" actually means]
You are giving every host on the internet the ability to open a TCP connection to
a process running on your home network. Within minutes of the port becoming
reachable, automated scanners will find it and start trying known exploits. This
is not a hypothetical; it is what the background noise of the internet consists
of.

What makes it defensible here is that **the first thing behind that port demands
a client certificate you issued**. A scanner fails the TLS handshake and gets
nothing — no HTTP parsing, no application code, no version banner.

That guarantee holds only if:

- `mode require_and_verify` is set, **not** `request` or `verify_if_given`;
- the trust pool is *your* CA file only, with no public roots;
- port `443` is the **only** port you forward. Not 8443, not 5432, not 15672,
  not SSH.

If you are not confident about all three, do not forward anything. The system is
fully usable over LAN or a VPN, and that is a legitimate permanent choice — you
lose only syncing while away from home, and the app buffers until you get back.
:::

## The two interfaces

| Port | Serves | Gate | Forwarded |
|---|---|---|---|
| `443` | `/v1/*`, `/healthz`, `/readyz` | Mutual TLS, mandatory | Yes — the only one |
| `8443` | Dashboard and its API calls | Source IP must be in your LAN or VPN range | **No** |

## Configuration

`deploy/caddy/Caddyfile`:

```caddyfile
{
	# No automatic Let's Encrypt: this deployment uses a private CA.
	auto_https off
	admin off
}

# ---------------------------------------------------------------------------
# API — mutual TLS gate. Publicly routable.
# ---------------------------------------------------------------------------
https://:443 {
	tls /etc/caddy/pki/server.crt /etc/caddy/pki/server.key {
		client_auth {
			# require_and_verify: without a valid certificate signed by OUR CA
			# the TLS handshake fails. The request never reaches HTTP.
			mode require_and_verify
			trust_pool file {
				pem_file /etc/caddy/pki/ca.crt
			}
		}
	}

	handle /v1/* {
		reverse_proxy api:8080 {
			header_up X-Client-Cert-Subject {http.request.tls.client.subject}
			header_up X-Client-Cert-Serial {http.request.tls.client.serial}
		}
	}

	# Health endpoints stay trivial: no internal state in the response.
	# They are still behind mutual TLS — the gate covers the whole site.
	@health path /healthz /readyz
	handle @health {
		reverse_proxy api:8080
	}

	handle {
		respond "not found" 404
	}
}

# ---------------------------------------------------------------------------
# Web dashboard — LAN and VPN only. NOT forwarded on the router.
# ---------------------------------------------------------------------------
https://:8443 {
	tls /etc/caddy/pki/server.crt /etc/caddy/pki/server.key

	@allowed remote_ip {$LAN_SUBNET} {$WG_SUBNET}

	handle @allowed {
		handle /v1/* {
			reverse_proxy api:8080
		}
		handle {
			reverse_proxy web:80
		}
	}

	handle {
		respond "forbidden" 403
	}
}
```

`LAN_SUBNET` and `WG_SUBNET` come from `.env`, for example
`LAN_SUBNET=192.168.1.0/24` and `WG_SUBNET=10.100.0.0/24`.

:::note
**The source-IP rule is the second lock, not the first.** The primary reason
`8443` is unreachable from the internet is that the router does not forward it.
Keep both: a rule can be edited by mistake, and a router can be reconfigured by
mistake, but rarely on the same day.
:::

### Why the client certificate details are passed upstream

`X-Client-Cert-Subject` lets the API log which device is talking without having to
terminate TLS itself. It is useful for debugging a multi-device setup and for
correlating an upload with a device.

:::note
The application must never treat those headers as *authentication* — anything
able to reach the API directly could set them. They are proxy-supplied context,
and the authentication decision was already made at the handshake.
:::

## Validate before you deploy

:::danger
**An invalid Caddyfile crash-loops the proxy, which takes the whole API offline.**
Since the proxy is also the only way in, you will be fixing it over SSH. Validate
first, every time.
:::

```bash
cd helsa/deploy
docker run --rm -e LAN_SUBNET -e WG_SUBNET \
  -v "$PWD/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v /opt/helsa/pki:/etc/caddy/pki:ro \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

There is a `make` target for this. Use it as a reflex before `restart proxy`.

### The gotcha that will get you

`handle` takes **at most one** path argument. This is not a shorthand for two
routes:

```caddyfile
handle /healthz /readyz { … }   # ✗ parse error, proxy will not start
```

Use a named matcher:

```caddyfile
@health path /healthz /readyz   # ✓
handle @health { … }
```

## Acceptance test

Run these against the deployed server before you consider it done. The first one
is the important one.

| Test | Expected |
|---|---|
| `curl https://helsa.example.net/healthz` with **no** client certificate | TLS handshake **fails**. Not a 401, not a 403 — the connection does not complete. |
| Same, with a valid client certificate | `200` |
| `/readyz` with a valid certificate | `200` — database, Redis, and queue all reachable |
| `/v1/summary` with a certificate but **no token** | `401` — the application layer is a separate gate |
| An unknown path with a certificate | `404` |
| Dashboard on `:8443` from the LAN | Served |
| Dashboard on `:8443` from outside the allowed ranges | `403` |
| `:8443` from the internet | Connection times out — the router does not forward it |

With client certificates, `curl` looks like:

```bash
curl --cacert pki/out/ca/ca.crt \
     --cert pki/out/clients/iphone/iphone.crt \
     --key  pki/out/clients/iphone/iphone.key \
     https://helsa.example.net/healthz
```

## Dynamic DNS is now load-bearing

If the phone reaches the server through a dynamic DNS name, that name is on the
critical path for syncing. When the record goes stale — an expired API token in
the updater is the classic cause — **syncing stops silently**. The phone buffers,
so nothing is lost, but nothing arrives either.

- Put the expiry of any dynamic-DNS API token in your calendar.
- Rely on the [freshness alert](../integrations/home-assistant/#the-alert-that-matters)
  to catch it, since it catches every cause of "no new data" at once.

## Request size

The API enforces a limit on ingest chunk size and answers `413` above it. Consider
enforcing a body limit at the proxy as well: it makes an oversized request cheap
to reject, before it is buffered and parsed by the application.

## nginx instead of Caddy

The requirements are proxy-independent:

1. Client certificate **required**, not optional (`ssl_verify_client on`).
2. Trust anchor is your CA file alone (`ssl_client_certificate`), no public roots.
3. Pass the certificate subject upstream as a header.
4. `/healthz` may answer trivially; it must not expose internal state.
5. The dashboard route must not be served on the public interface.

Caddy is the documented choice mainly because the mutual-TLS block is short and
`caddy validate` catches mistakes before they take the service down.
