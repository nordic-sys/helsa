# The Helsa private PKI

The certificates behind mTLS access: issuing, installing, replacing. Plan: `docs/08-auth-hozzaferes.md`, decision: `ADR-0003`.

- [1. What this is and why openssl](#1-what-this-is-and-why-openssl)
- [2. Quick commands](#2-quick-commands)
- [3. What goes where — the installation map](#3-what-goes-where--the-installation-map)
- [4. Issuing](#4-issuing)
- [5. Replacement / rotation](#5-replacement--rotation)
- [6. Watching expiry](#6-watching-expiry)
- [7. Troubleshooting](#7-troubleshooting)

---

## 1. What this is and why openssl

The phone → API path sits behind **mutual TLS**: the proxy only accepts a connection if the client presents a certificate **signed by our own CA**. A scanner does not even reach the HTTP layer.

**Why not `step-ca`:** its main value is ACME automation for short-lived certificates; and short-lived certificates are used precisely to avoid the **revocation infrastructure** that we deliberately do not build (`docs/08` §6). With a single server and one or two clients that value evaporates, and in exchange `step-ca` is a running service that **has to keep the root key online**. With openssl the root key **can stay offline**, and only comes out when something is signed.

The key algorithm is **ECDSA P-256** everywhere.

---

## 2. Quick commands

```bash
make ca                       # root CA — ONCE, 10 years
make server                   # the server certificate for the proxy — 398 days
make client NAME=iphone-bob   # a client certificate + .p12 — 730 days
make show                     # the details of the issued certificates
make verify                   # chain verification
make expiry                   # how many days are left
```

The output goes under `out/`, which is **gitignored**. A key never goes into the repository — only the `Makefile` and the `.cnf` files are version-controlled.

---

## 3. What goes where — the installation map

**This is the most important table in this file.** If you issue a certificate but do not carry it to its place, nothing changes.

| Artefact | Where it has to go | What it is for there |
|---|---|---|
| `out/ca/ca.key` | **your password manager only** | the root of trust. On the machine only while you are signing a certificate |
| `out/ca/ca.crt` | ① into the VM's proxy ② onto the **iPhone** (as a profile, then **switched on** under *Settings → General → About → Certificate Trust Settings*) | ① verifying the client certificates ② authenticating the server on the phone |
| `out/server/server.crt` + `.key` | into the VM's proxy | the server's TLS certificate |
| `out/clients/<name>/<name>.p12` | into the **iPhone's Keychain** | this is what the client identifies itself with |
| `out/clients/<name>/p12-password.txt` | **password manager**, then delete the file | the password for importing the `.p12` |

### On the VM

```
/opt/helsa/pki/
├── ca.crt        (0644)  for verifying the client certificates
├── server.crt    (0644)
└── server.key    (0600)  only the proxy reads it
```

Copying them over and reloading the proxy:

```bash
scp out/ca/ca.crt out/server/server.crt out/server/server.key helsa:/tmp/
ssh <your-vm> 'sudo install -o root -g root -m 0644 /tmp/ca.crt /tmp/server.crt /opt/helsa/pki/ \
        && sudo install -o root -g root -m 0600 /tmp/server.key /opt/helsa/pki/ \
        && rm -f /tmp/ca.crt /tmp/server.crt /tmp/server.key \
        && cd /opt/helsa && sudo docker compose restart proxy'
```

> ⚠️ The exact proxy paths and the reload command are settled in **phase 0.4** (Caddy vs nginx, `docs/07` §10). The above is the planned layout; if 0.4 turns out differently, **this section is what needs updating**.

### On the iPhone

Two separate things have to be installed, and **both are required**:

1. **`ca.crt`** — this is what makes the phone trust our server. After installing it you have to **switch it on separately** in the *Certificate Trust Settings* menu; without that it installs but is not valid. This is the most common pitfall.
2. **`<name>.p12`** — this is what lets the phone *identify itself*. The import needs the password (from the password manager).

---

## 4. Issuing

### Root CA — once, for 10 years

```bash
make ca
```

If one already exists, the target **does not overwrite it** (a guard against accidental regeneration — that would invalidate every certificate). Immediately afterwards: `out/ca/ca.key` → password manager.

### Server certificate — 398 days

```bash
make server
```

The SAN list lives in the `[alt]` section of `server.cnf`: the public DDNS name, the internal name and the LAN IP. **If the hostname changes, rewrite it here** and run it again — the old certificate stays in place until you replace it on the proxy.

### Client certificate — 730 days

```bash
make client NAME=iphone-bob
make client NAME=ipad-bob      # for a further device
```

Every device should get **its own certificate**; they must not share one. That way, even if a single device is lost, you know which CN to shut out, and the proxy log shows which device was talking.

---

## 5. Replacement / rotation

Three scenarios, **in increasing order of danger**.

### 5.1 Replacing the server certificate — yearly, harmless

This is the routine case. **Nobody can get locked out**, because the phone trusts the *CA*, not the particular server certificate.

```bash
make server                      # a new certificate signed by the same CA
# → copy it to the VM and reload the proxy (see §3)
make expiry                      # check
```

Rolling back if something goes wrong: copy the old `server.crt`/`server.key` back and reload the proxy. **This is why it is worth keeping the old one** until the new one has proven itself.

### 5.2 Replacing a client certificate — every 2 years, or when a device is lost

```bash
make client NAME=iphone-bob      # overwrites the old one under out/
# → the .p12 onto the iPhone, the old identity can be deleted from the Keychain
```

⚠️ **Install the new `.p12` on the phone FIRST**, and only then delete the old one. Doing it the other way round, if the import stalls, leaves you with no working client certificate — and the phone cannot sync until you sort it out.

> If a device has been **lost**, the right move is not replacing the client certificate but the **5.3 CA rotation** — because without revocation the old certificate stays valid. See below.

### 5.3 Replacing the root CA — every 10 years, or on compromise ⚠️

**This is the one operation that can lock you out.** The order is not optional.

Why it is dangerous: if you switch the proxy over to the new CA before the phone has the new certificates, the phone cannot connect — and since it would have to receive the certificate over the network too, **there is no way back remotely**. (You still have SSH access to the VM and the hypervisor console, so the server side is always recoverable; it is the phone that gets stranded.)

**The correct order:**

1. **Generate the new CA** under a set-aside name — do not touch the old one yet:
   ```bash
   mv out/ca out/ca-old && make ca
   ```
2. **New server and client certificates** with the new CA:
   ```bash
   make server && make client NAME=iphone-bob
   ```
3. **Install the NEW `ca.crt` on the phone** — and switch the trust on. The new `.p12` goes up too. *At this point the phone still works with the old CA as well, because the proxy is still running the old one.*
4. **Now, and only now**, replace `ca.crt`, `server.crt` and `server.key` on the proxy, then reload.
5. **Verify from the phone:** a successful sync. If it does not work, roll back to the state before step 4 (`out/ca-old`).
6. Only after a successful test should you delete the old CA and the old identity from the phone.

> ⚠️ **This needs physical access.** Do the CA rotation when the phone is at hand and you are at home — not remotely, and not before a trip.

**In case of compromise** this operation takes the place of revocation: there is no CRL and no OCSP (`docs/08` §6); the old CA simply ceases to be accepted the moment you replace it on the proxy. With one or two clients, that is ten minutes.

---

## 6. Watching expiry

```bash
make expiry
```

It flags anything under 30 days as `URGENT` and anything under 90 days as `soon`.

⚠️ **Why this matters more than you would think:** an expired certificate kills **silently**. You do not get an error message; you get a phone that simply stops syncing — and because the data is buffered on the client, you may not notice for weeks. So:

- put the expiry dates in your **calendar** (`make server`/`make client` print them out),
- and let the sync-freshness alert (`docs/16` §2) catch the silent stop.

---

## 7. Troubleshooting

**The phone says "not a secure connection" for the server.** Most likely `ca.crt` installed but was not **switched on** in the *Certificate Trust Settings* menu. That is a separate step.

**The proxy rejects the client.** Check that the same CA signed both:
```bash
make verify
openssl verify -CAfile out/ca/ca.crt out/clients/iphone-bob/iphone-bob.crt
```

**iOS refuses the `.p12` import.** The Makefile uses AES-256-CBC, which is fine on modern iOS. For an older version, a legacy variant:
```bash
openssl pkcs12 -export -legacy \
  -out out/clients/iphone-bob/iphone-bob-legacy.p12 \
  -inkey out/clients/iphone-bob/iphone-bob.key \
  -in out/clients/iphone-bob/iphone-bob.crt \
  -certfile out/ca/ca.crt -name "Helsa iphone-bob" \
  -password file:out/clients/iphone-bob/p12-password.txt
```
⚠️ `-legacy` uses the old, weaker RC2/3DES encryption — only if you must.

**The `ca.key` is lost.** There is no way around it: a new CA is needed, with the full rotation from §5.3. That is why it lives in a password manager.
