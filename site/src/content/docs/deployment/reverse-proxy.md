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
  not SSH. (The number on the router's outside does not have to be 443: an
  external port such as `8444` mapped onto the Helsa host's `443` is the same
  single port — see [A reverse proxy already runs on your network](#a-reverse-proxy-already-runs-on-your-network).)

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

## A reverse proxy already runs on your network

Many home networks already have one — Nginx Proxy Manager, Traefik, HAProxy, a router's
own — holding port 443 and a wildcard certificate for every service. **Do not put Helsa
behind it as an ordinary proxy host.**

:::danger[Why it breaks]
An ordinary proxy host **terminates TLS** with the proxy's own certificate. The phone's
client certificate is presented to that proxy and ends there; the connection the proxy
then opens to Helsa's Caddy carries no client certificate at all. Caddy, set to
`require_and_verify`, refuses it — or, if someone "fixes" that by relaxing the mode, the
one gate that makes the open port defensible is gone.
:::

The phone has to reach Helsa's Caddy **directly**, with nothing that decrypts in between.
Two ways:

1. **A dedicated external port, straight to the Helsa host.** On the router forward one
   port — pick an unused one, for example `8444` — to the Helsa host's `443`. The existing
   proxy keeps 443 for everything else. The phone's endpoint then carries the port:
   `https://helsa.example.net:8444/v1`.
2. **TCP passthrough in the existing proxy**, if it can route by name without decrypting:
   Traefik's TCP router with `tls.passthrough: true`, nginx's `stream` module with
   `ssl_preread`, HAProxy in `mode tcp` with an SNI rule. ⚠️ Nginx Proxy Manager's
   *Streams* forward a whole port and cannot choose by name, so on 443 they would take the
   port away from every other service — for NPM use option 1.

Whichever you choose:

- **The name.** Inside the network a wildcard record (`*.example.net`) usually points at
  the existing proxy. Add a specific record for Helsa that points at the Helsa host's LAN
  address; the specific name wins over the wildcard, so the same name works at home and
  away. From outside, the name must resolve to your public address (a CNAME to your
  dynamic-DNS name is enough).
- **The certificate.** `server.cnf` needs the name, plus the LAN address if anything uses
  it — the port plays no part in a certificate: [Issuing](/getting-started/certificates/#issuing--on-your-own-computer).
- **The test.** From outside, a request without a client certificate must fail at the
  handshake, and the server must present the Helsa certificate, not the wildcard one:

  ```bash title="On your computer, off your home network"
  openssl s_client -connect helsa.example.net:8444 -servername helsa.example.net </dev/null 2>/dev/null \
    | openssl x509 -noout -subject -issuer
  ```

  The issuer has to be your own CA. If it names Let's Encrypt or the proxy, the traffic is
  still going through the proxy.

## Dynamic DNS is now load-bearing

If the phone reaches the server through a dynamic DNS name, that name is on the
critical path for syncing. When the record goes stale — an expired API token in
the updater is the classic cause — **syncing stops silently**. The phone buffers,
so nothing is lost, but nothing arrives either.

- Put the expiry of any dynamic-DNS API token in your calendar.
- Rely on the [freshness alert](/integrations/home-assistant/#the-alert-that-matters)
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
