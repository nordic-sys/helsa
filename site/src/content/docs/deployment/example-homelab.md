---
title: "Worked example: MikroTik, Nginx Proxy Manager, Proxmox"
description: "One real home network, end to end: a Proxmox VM, a MikroTik router behind the ISP's box, Nginx Proxy Manager already holding 443 with a wildcard certificate, Cloudflare DNS — and every small thing that went wrong on the way."
sidebar:
  order: 6
  label: "Example: MikroTik + NPM + Proxmox"
---
The other Deployment pages say *what* has to be true. This one shows one network where it was
made true, step by step, with the commands. It was written while moving a real install from
"reachable on the LAN by IP" to "one name, at home and away". Your addresses will differ; the
shape and the traps will not.

## The network

| Piece | Role here |
|---|---|
| ISP box | In front of everything. The MikroTik's WAN side is a private address behind it (double NAT) |
| MikroTik router | DHCP, DNS for the LAN (`*.example.net` → the proxy), port forwards, firewall |
| Nginx Proxy Manager (NPM) | Already on `443` for a dozen internal services, with a Let's Encrypt wildcard for `*.example.net` |
| Proxmox | The Helsa VM, `192.168.10.46`, on the same subnet as everything else |
| Cloudflare | Public DNS for `example.net`; `gate.example.net` is the dynamic-DNS name of the home address |

The goal:

- **The phone** uses `https://helsa.example.net:48443/v1` everywhere — Wi-Fi at home, mobile data
  away. Mutual TLS end to end: nothing may decrypt between the phone and Helsa's Caddy.
- **The browser** uses `https://helsa.example.net` with the wildcard certificate NPM already has —
  no private CA to install on every laptop.

```
                 away                                  at home
  phone ──▶ gate.example.net:48443           phone ──▶ helsa.example.net:48443
          │  (ISP box ▶ MikroTik dst-nat)              │  (LAN DNS ▶ NPM)
          ▼                                            ▼
          Helsa VM :443  ◀────────────────  NPM stream 48443 (TCP, no decryption)
          (Caddy, mutual TLS)

  browser ──▶ helsa.example.net:443 ──▶ NPM proxy host (wildcard cert) ──▶ Helsa VM :8443
```

## 1. The VM: a fixed address, and it comes back after a power cut

**A static lease, by MAC only.** On a MikroTik a lease made static keeps the DHCP *client-id*
alongside the MAC, and a Debian or Ubuntu major upgrade changes the client-id — the VM then gets a
new address, and every forward and DNS record points at nothing. Clear it:

```bash title="On the router (RouterOS)"
/ip dhcp-server lease make-static [find address=192.168.10.46]
/ip dhcp-server lease set [find address=192.168.10.46] client-id="" comment="helsa"
```

**Start on boot.** A Proxmox VM created by hand has *Start at boot* off. Turn it on (VM →
Options → Start at boot, or `qm set <vmid> --onboot 1`); the stack itself already has
`restart: unless-stopped`, but only if the VM runs.

**Disk.** A first upload of several years is a few million rows; with the images and their old
versions the 20 GB root of the first install was at 61 %. 32 GB leaves room. Grow it in Proxmox,
then inside the VM:

```bash title="On the server"
sudo growpart /dev/sda 1 && sudo resize2fs /dev/sda1
docker image prune -f      # every `make prod-pull` leaves the previous images behind
```

**Renaming a cloud-init VM.** If the VM came from a cloud image, renaming it in Proxmox changes the
cloud-init data, and on the next boot cloud-init treats it as a *new* instance — it regenerates
the SSH host keys among other things. For a long-lived server switch cloud-init off once the VM is
set up, and set the hostname by hand:

```bash title="On the server"
sudo touch /etc/cloud/cloud-init.disabled
sudo hostnamectl set-hostname helsa
```

**A VM-level backup** on top of the database dumps of [Backups and restore](/deployment/backups/):
a Proxmox Backup Server job for the VM, nightly, kept for a week. The dumps are what you restore
data from; the VM backup is what you restore *the machine* from.

## 2. Isolation belongs to the hypervisor, not the router

The [hardening checklist](/deployment/hardening/#network) asks that the Helsa host cannot reach
the rest of the LAN. ⚠️ **On a flat home network the router cannot do this.** Hosts on the same
subnet talk to each other through the switch (or the router's bridge) without ever touching its
forward chain, so a router rule never sees the traffic.

The Proxmox firewall sits on the VM's virtual NIC and does see it. With the datacenter firewall
already on, the VM's rules:

| Direction | Action | Destination | Why |
|---|---|---|---|
| out | ACCEPT | `192.168.10.1` | the router: gateway, DHCP, DNS |
| out | ACCEPT | the LAN DNS server, udp/tcp 53 | name resolution |
| out | DROP | `192.168.10.0/24` | no new connections into the LAN |
| out | DROP | the VPN client range | nor to devices on the VPN |

Then VM → Firewall → Options: **Firewall on, input policy ACCEPT, output policy ACCEPT**, and tick
*Firewall* on the VM's network device. ⚠️ **Set the input policy explicitly** — Proxmox's default
for a VM is DROP, which would cut off SSH and the proxy the moment the firewall goes on. The rules
are stateful: replies to connections that come *in* (SSH from your laptop, NPM fetching the
dashboard) still pass; only connections the VM itself would open into the LAN are refused.

Check it from the VM: the internet and DNS work, a LAN host does not answer.

```bash title="On the server"
curl -s -o /dev/null -w "%{http_code}\n" https://ghcr.io/v2/      # 401 = reachable
timeout 4 bash -c "</dev/tcp/192.168.10.10/22" && echo "LAN reachable — not isolated" || echo "isolated"
```

If you later add the [Home Assistant](/integrations/home-assistant/) integration, the MQTT broker
is on the LAN: add an `out ACCEPT` rule for that one host and port, above the DROP.

## 3. The certificate, with the old name kept for now

Add the new name to `server.cnf` on the machine that holds the CA — and **keep the name the phone
uses today** until it has been switched over, so the phone does not drop off in between:

```ini title="deploy/pki/server.cnf"
[ dn ]
CN = helsa.example.net

[ alt ]
DNS.1 = helsa.example.net
DNS.2 = helsa.192.168.10.46.sslip.io   # the old name — remove at the next renewal
IP.1  = 192.168.10.46
```

Then `make server` (after moving the old `out/server/` aside) and install the pair as in
[Installing on the server](/getting-started/certificates/#installing-on-the-server). The CA does
not change, so **nothing new goes onto the phone** — it already trusts the CA and keeps its own
client certificate. The port plays no part in a certificate.

## 4. Nginx Proxy Manager: the dashboard as a proxy host, the API as a stream

**The dashboard** — Hosts → Proxy Hosts → Add:

- Domain `helsa.example.net`, scheme **https**, forward host `192.168.10.46`, port **8443**
- SSL: the existing wildcard certificate, *Force SSL*, HTTP/2
- Advanced, so the export streams instead of being buffered:

  ```nginx
  proxy_buffering off;
  proxy_read_timeout 300s;
  ```

Caddy's `remote_ip` rule on 8443 now sees NPM's address, which is inside `LAN_SUBNET`, so it lets
it through. That makes NPM the gate for the dashboard: keep it unreachable from the internet, as it
already is if the router forwards nothing to it. The browser still needs a
[device token](/dashboard/#how-to-reach-it) — and ⚠️ **a new address is a new origin**: a browser that
used the dashboard at `https://192.168.10.46:8443` has its token stored for that address only, and
has to be given it again at `https://helsa.example.net`.

**The phone's API** — NPM must *not* decrypt it, so not a proxy host but a stream: Streams → Add,
incoming port `48443`, forward host `192.168.10.46`, port `443`, TCP. ⚠️ **NPM runs in Docker, and
a stream port is only reachable if the NPM container publishes it.** Add it to NPM's Compose file
and recreate the container (every NPM-served site blinks for a few seconds):

```yaml title="NPM's docker-compose.yml"
    ports:
      - "80:80"
      - "443:443"
      - "81:81"
      - "48443:48443"   # Helsa phone API — a TCP stream, NOT terminated here
```

A stream on its own port is fine; what NPM streams cannot do is share 443 with the proxy hosts,
because they cannot choose by name. That is why the API gets a port of its own.

## 5. The router: one forward, and a limit on it

```bash title="On the router (RouterOS)"
/ip firewall nat add chain=dstnat in-interface-list=WAN protocol=tcp dst-port=48443 \
    action=dst-nat to-addresses=192.168.10.46 to-ports=443 comment="Helsa phone API"

# Before "defconf: drop invalid" (use its number in place-before):
/ip firewall filter add chain=forward action=drop connection-state=new in-interface-list=WAN \
    protocol=tcp dst-address=192.168.10.46 dst-port=443 src-address-list=helsa-blocked \
    comment="Helsa: drop sources over the limit"
/ip firewall filter add chain=forward action=add-src-to-address-list address-list=helsa-blocked \
    address-list-timeout=1h connection-state=new in-interface-list=WAN protocol=tcp \
    dst-address=192.168.10.46 dst-port=443 connection-limit=16,32 \
    comment="Helsa: over 16 concurrent connections from one IP -> blocked 1h"
```

The forward goes **straight to the VM**, not through NPM — from outside there is no reason for an
extra hop. The limit does not keep anyone *out* (the client certificate does that); it stops one
address from tying the server up with handshakes. A phone opens a handful of connections.

A high external port is not a defence — scanners try them all — but it keeps the noise out of the
logs. Mapping it onto the VM's `443` keeps the [one forwarded port](/deployment/reverse-proxy/#before-you-open-a-port)
rule intact.

**Double NAT.** If the router's WAN address is private (`192.168.x.x`, `10.x`), the ISP box in front
of it must pass the port on too — a forward, or the router as its DMZ host. A working VPN port
forward is a good sign that it already does. Prove it from outside rather than assume: any public
TCP port check against `your-public-address:48443` must connect.

## 6. DNS: two answers for one name

- **Inside**, the LAN's wildcard (`*.example.net` → NPM) already answers for `helsa.example.net`. At
  home the phone reaches NPM's stream on 48443 and the browser reaches NPM's proxy host on 443 —
  the same name for both.
- **Outside**, add one public record: `helsa` as a **CNAME to the dynamic-DNS name**
  (`gate.example.net`), so it follows the home address.

:::danger[Cloudflare: DNS only — the grey cloud]
Create the record with the proxy **off** (*DNS only*, grey cloud). With the orange cloud Cloudflare
terminates TLS itself, the phone's client certificate ends at Cloudflare, and mutual TLS is gone —
and 48443 is not a port Cloudflare's proxy forwards anyway, so the phone would simply fail.
:::

## 7. Test, from both sides

From a laptop at home — the browser path, then the API path with and without a client certificate:

```bash title="On your computer, at home"
curl -s -o /dev/null -w "%{http_code}\n" https://helsa.example.net/            # 200, Let's Encrypt
openssl s_client -connect helsa.example.net:48443 -servername helsa.example.net </dev/null 2>/dev/null \
  | openssl x509 -noout -issuer                                                # your own CA
curl --cacert out/ca/ca.crt --cert out/clients/iphone/iphone.crt --key out/clients/iphone/iphone.key \
  https://helsa.example.net:48443/healthz                                      # 200
curl --cacert out/ca/ca.crt https://helsa.example.net:48443/healthz            # fails at the handshake
```

Then the phone: change the endpoint to `https://helsa.example.net:48443/v1`, restart the app, sync on
Wi-Fi; then Wi-Fi off, sync on mobile data. Both must reach the server — the
[Sync queue](/dashboard/screens/#ingest-queue) page shows each batch arrive.
