# The Helsa private PKI — mTLS for the phone → API path.
#
# Plan: docs/08-auth-hozzaferes.md, decision: ADR-0003.
# Deliberately openssl + a Makefile, NOT step-ca: there is no revocation
# infrastructure (nor is one needed), there is a single server and one or two
# clients, and this way the ROOT KEY CAN STAY OFFLINE.
#
# The key algorithm is ECDSA P-256 everywhere (modern, Apple-friendly, small).
#
# USAGE
#   make ca                      root CA (once, 10 years)
#   make server                  the server certificate for the proxy (398 days)
#   make client NAME=iphone-bob  a client certificate + .p12 (730 days)
#   make show                    the details of the issued certificates
#   make verify                  chain verification
#   make expiry                  how many days are left (expiry is a SILENT failure!)
#
# The output goes under out/, which is gitignored. The ca.key and the .p12 password
# belong in a password manager — see the README.

SHELL := /bin/bash
OUT   := out
CADIR := $(OUT)/ca

CA_DAYS     := 3650
SERVER_DAYS := 398
CLIENT_DAYS := 730

# The SANs of the server certificate. If the final public hostname turns out
# different, rewrite it and run `make server` again — one command.
SERVER_CN   := helsa.example.com
NAME        ?= iphone-bob

.PHONY: help ca server client show verify expiry clean-csr

help:
	@sed -n '1,25p' $(MAKEFILE_LIST)

$(CADIR):
	@mkdir -p $(CADIR) $(OUT)/server $(OUT)/clients

# --- Root CA -----------------------------------------------------------------
# The ca.key LEAVES this machine: copy it into a password manager, and keep this
# copy only for as long as you are issuing certificates. If it is lost, EVERY
# certificate has to be reissued.
#
# ⚠️ It REFUSES to run on what looks like the server — a checkout with a configured `../.env`, or
# a host running the Helsa containers. The docs said "do this on your own computer" in a callout,
# and the first person to follow them on a real VM did it on the server anyway (helsa docs/34): a
# sentence is easy to scroll past, a refusal is not. `ON_SERVER=yes-i-know` overrides it, for a
# throwaway test box.
ca: | $(CADIR)
	@if [ -f $(CADIR)/ca.key ]; then echo "The CA already exists ($(CADIR)/ca.key) — not overwriting it."; exit 0; fi
	@if [ "$(ON_SERVER)" != "yes-i-know" ] && { [ -f ../.env ] || docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^helsa-'; }; then \
		echo "⛔ This looks like the SERVER (a configured ../.env, or Helsa containers running here)."; \
		echo "   The root key must never be on the server: whoever has it can mint a client certificate"; \
		echo "   for your API. Clone the repository on your own computer and run 'make ca' there."; \
		echo "   (A throwaway test box: ON_SERVER=yes-i-know make ca)"; \
		exit 1; fi
	openssl ecparam -name prime256v1 -genkey -noout -out $(CADIR)/ca.key
	chmod 600 $(CADIR)/ca.key
	openssl req -x509 -new -key $(CADIR)/ca.key -sha256 -days $(CA_DAYS) \
		-out $(CADIR)/ca.crt -config ca.cnf -extensions v3_ca
	@echo
	@echo ">> Root CA ready: $(CADIR)/ca.crt"
	@echo ">> TODO: put a COPY of $(CADIR)/ca.key into your password manager. This is the root of trust."

# --- Server certificate ------------------------------------------------------
# 398 days: Apple's platforms cap the lifetime of server certificates, and 398 days
# is the value at which the question never even comes up. A once-a-year
# `make server` plus a proxy reload.
#
# ⚠️ It REFUSES to sign the example names. The docs said "set the hostnames before `make server`"
# in one sentence, and the first person to follow them shipped a certificate for
# helsa.example.com and 192.168.1.10 (helsa docs/34) — which the phone then rejects with an error
# that does not mention the name. Edit server.cnf first.
server: | $(CADIR)
	@if grep -qE '^(CN|DNS\.[0-9]+) *= *(helsa\.example\.com|api\.helsa\.example\.com)$$|^IP\.[0-9]+ *= *192\.168\.1\.10$$' server.cnf; then \
		echo "⛔ server.cnf still holds the example names (helsa.example.com / 192.168.1.10)."; \
		echo "   Put in the name the phone will use — and the public name, if it will come from outside —"; \
		echo "   plus the server's LAN address, under CN, DNS.n and IP.n. Then run 'make server' again."; \
		echo "   Current SANs:"; sed -n '/^\[ alt \]/,$$p' server.cnf | grep -E '^(DNS|IP)' | sed 's/^/     /'; \
		exit 1; fi
	openssl ecparam -name prime256v1 -genkey -noout -out $(OUT)/server/server.key
	chmod 600 $(OUT)/server/server.key
	openssl req -new -key $(OUT)/server/server.key -out $(OUT)/server/server.csr -config server.cnf
	openssl x509 -req -in $(OUT)/server/server.csr \
		-CA $(CADIR)/ca.crt -CAkey $(CADIR)/ca.key -CAcreateserial \
		-out $(OUT)/server/server.crt -days $(SERVER_DAYS) -sha256 \
		-extfile server.cnf -extensions v3_req
	@rm -f $(OUT)/server/server.csr
	@echo ">> Server certificate ready ($(SERVER_DAYS) days): $(OUT)/server/server.crt"
	@echo ">> Expires: $$(openssl x509 -enddate -noout -in $(OUT)/server/server.crt | cut -d= -f2) — put it in your calendar."

# --- Client certificate ------------------------------------------------------
# 730 days is DELIBERATELY long: if the phone stays offline longer than the
# certificate's lifetime, it cannot renew and locks itself out (ADR-0003).
client: | $(CADIR)
	@mkdir -p $(OUT)/clients/$(NAME)
	openssl ecparam -name prime256v1 -genkey -noout -out $(OUT)/clients/$(NAME)/$(NAME).key
	chmod 600 $(OUT)/clients/$(NAME)/$(NAME).key
	openssl req -new -key $(OUT)/clients/$(NAME)/$(NAME).key \
		-out $(OUT)/clients/$(NAME)/$(NAME).csr -config client.cnf -subj "/CN=$(NAME)/O=Helsa"
	openssl x509 -req -in $(OUT)/clients/$(NAME)/$(NAME).csr \
		-CA $(CADIR)/ca.crt -CAkey $(CADIR)/ca.key -CAcreateserial \
		-out $(OUT)/clients/$(NAME)/$(NAME).crt -days $(CLIENT_DAYS) -sha256 \
		-extfile client.cnf -extensions v3_client
	@rm -f $(OUT)/clients/$(NAME)/$(NAME).csr
	@openssl rand -base64 24 > $(OUT)/clients/$(NAME)/p12-password.txt
	@chmod 600 $(OUT)/clients/$(NAME)/p12-password.txt
	openssl pkcs12 -export \
		-out $(OUT)/clients/$(NAME)/$(NAME).p12 \
		-inkey $(OUT)/clients/$(NAME)/$(NAME).key \
		-in $(OUT)/clients/$(NAME)/$(NAME).crt \
		-certfile $(CADIR)/ca.crt \
		-name "Helsa $(NAME)" \
		-keypbe AES-256-CBC -certpbe AES-256-CBC -macalg SHA256 \
		-password file:$(OUT)/clients/$(NAME)/p12-password.txt
	@echo
	@echo ">> Client certificate ready ($(CLIENT_DAYS) days): $(OUT)/clients/$(NAME)/$(NAME).p12"
	@echo ">> The .p12 password is in $(OUT)/clients/$(NAME)/p12-password.txt — move it to your password manager, then delete the file."
	@echo ">> Expires: $$(openssl x509 -enddate -noout -in $(OUT)/clients/$(NAME)/$(NAME).crt | cut -d= -f2) — INTO THE CALENDAR (a silent failure!)."
	@echo ">> If iOS refuses the .p12 import, try the legacy variant (see the README)."

show:
	@for f in $(CADIR)/ca.crt $(OUT)/server/server.crt $(OUT)/clients/*/*.crt; do \
		[ -f "$$f" ] || continue; \
		echo "=== $$f"; \
		openssl x509 -noout -subject -issuer -dates \
			-ext basicConstraints,keyUsage,extendedKeyUsage,subjectAltName -in "$$f" 2>/dev/null | sed 's/^/    /'; \
	done

verify:
	@openssl verify -CAfile $(CADIR)/ca.crt $(OUT)/server/server.crt
	@for c in $(OUT)/clients/*/*.crt; do [ -f "$$c" ] && openssl verify -CAfile $(CADIR)/ca.crt "$$c"; done

# Expiry is a silent failure: when it happens, syncing stops and it is not obvious
# why. Worth running now and then (or watching from Home Assistant).
expiry:
	@now=$$(date +%s); \
	for f in $(CADIR)/ca.crt $(OUT)/server/server.crt $(OUT)/clients/*/*.crt; do \
		[ -f "$$f" ] || continue; \
		end=$$(openssl x509 -enddate -noout -in "$$f" | cut -d= -f2); \
		ends=$$(date -j -f "%b %e %T %Y %Z" "$$end" +%s 2>/dev/null || date -d "$$end" +%s 2>/dev/null); \
		days=$$(( (ends - now) / 86400 )); \
		cn=$$(openssl x509 -noout -subject -in "$$f" | sed 's/.*CN *= *//; s/,.*//'); \
		if [ $$days -lt 30 ]; then flag="  <<< URGENT"; elif [ $$days -lt 90 ]; then flag="  <-- soon"; else flag=""; fi; \
		printf "%-22s %5d days  (%s)%s\n" "$$cn" "$$days" "$$end" "$$flag"; \
	done
