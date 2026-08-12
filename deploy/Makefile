# Helsa — deployment conveniences.
#
# Two modes, two compose combinations:
#   make up        LOCAL dev — base + dev overlay (ports published to the host)
#   make prod-up   HOME VM   — base + prod overlay (app + proxy, ZERO data ports)
#
# Plan: docs/07-infra-deployment.md
.DEFAULT_GOAL := help
ENV_FILE := .env

DEV  := docker compose -f docker-compose.yml -f docker-compose.dev.yml
PROD := docker compose -f docker-compose.yml -f docker-compose.prod.yml
# Building from source is the SECOND path: the app services default to the images
# published to GHCR. `pull_policy` is what switches between them, so the build
# targets set it explicitly rather than relying on whatever .env happens to say.
FROM_SOURCE := HELSA_PULL_POLICY=build
# The DEV VM runs the same thing as production, minus the mTLS gate
# (docker-compose.devvm.yml).
DEVVM := docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.devvm.yml

.PHONY: help up down restart logs ps psql redis-cli rabbit reset migrate mqtt-up mqtt-down mqtt-watch \
        prod-up prod-down prod-logs prod-ps prod-build prod-pull prod-up-source prod-migrate prod-caddy-check \
        devvm-up devvm-down devvm-logs devvm-ps devvm-build devvm-migrate

help: ## List the commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

$(ENV_FILE):
	@cp .env.example .env && echo "Created .env from .env.example (edit it as needed)."

up: $(ENV_FILE) ## [local] Start (in the background)
	$(DEV) up -d
	@echo "Waiting for the services..." && sleep 3 && $(DEV) ps

down: ## [local] Stop (the data survives)
	$(DEV) down

reset: ## [local] Stop + DELETE THE DATA (the volumes)
	$(DEV) down -v

restart: down up ## [local] Restart

logs: ## [local] Follow the logs
	$(DEV) logs -f

ps: ## [local] Service status
	$(DEV) ps

migrate: ## [local] Apply the schema by hand (idempotent)
	cat init/timescaledb/*.sql | $(DEV) exec -T timescaledb psql -U $${POSTGRES_USER:-helsa} -d $${POSTGRES_DB:-helsa} -v ON_ERROR_STOP=1

psql: ## [local] psql into TimescaleDB
	$(DEV) exec timescaledb psql -U $${POSTGRES_USER:-helsa} -d $${POSTGRES_DB:-helsa}

redis-cli: ## [local] redis-cli into Redis
	$(DEV) exec redis redis-cli --no-auth-warning -a $${REDIS_PASSWORD:-helsa_local_dev}

rabbit: ## [local] Open the RabbitMQ management UI
	open http://localhost:$${RABBITMQ_MGMT_PORT:-15672}

# --- MQTT (Home Assistant publisher testing) ---------------------------------
# Behind a profile: `make up` does NOT start a broker. Helsa needs none, and the
# publisher stays off unless HELSA_MQTT_URL is set.

mqtt-up: ## [local] Start a throwaway MQTT broker on 127.0.0.1:1883
	$(DEV) --profile mqtt up -d mosquitto

mqtt-down: ## [local] Stop the throwaway MQTT broker
	$(DEV) --profile mqtt rm -sf mosquitto

mqtt-watch: ## [local] Print everything on the broker (needs mosquitto-clients)
	mosquitto_sub -h 127.0.0.1 -p $${MQTT_HOST_PORT:-1883} -t '#' -v

# --- HOME VM (phase 0.3–0.4) -------------------------------------------------
# These run on the VM:  ssh <your-vm> && cd /opt/helsa/helsa/deploy

prod-up: ## [VM] Start the full stack (app + proxy)
	$(PROD) up -d

prod-down: ## [VM] Stop (the data survives)
	$(PROD) down

prod-pull: ## [VM] Pull the published images from GHCR (needs a docker login while the repo is private)
	$(PROD) pull

prod-build: ## [VM] Build the images from THIS checkout instead of pulling
	$(FROM_SOURCE) $(PROD) build

prod-up-source: ## [VM] Start from locally built images (after prod-build)
	$(FROM_SOURCE) $(PROD) up -d

prod-ps: ## [VM] Service status
	$(PROD) ps

prod-logs: ## [VM] Follow the logs
	$(PROD) logs -f

prod-migrate: ## [VM] Migration — a SEPARATE, DELIBERATE step (docs/07 §3.1)
	$(PROD) --profile tools run --rm migrate up

prod-token: ## [VM] Issue a device token (SUBJECT=bob-web)
	$(PROD) --profile tools run --rm token -subject $${SUBJECT:-bob}

prod-caddy-check: ## [VM] Validate the Caddyfile BEFORE DEPLOYING (handle takes ONE path!)
	docker run --rm -e LAN_SUBNET -e WG_SUBNET \
	  -v $(PWD)/caddy/Caddyfile:/etc/caddy/Caddyfile:ro -v /opt/helsa/pki:/etc/caddy/pki:ro \
	  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# --- DEV VM ---------------------------------------------------------------
# The same steps as in production, so the two environments do not drift apart.

devvm-build: ## [DEV VM] Build the images from this checkout
	$(FROM_SOURCE) $(DEVVM) build

devvm-migrate: ## [DEV VM] Migration
	$(FROM_SOURCE) $(DEVVM) --profile tools run --rm migrate up

devvm-up: ## [DEV VM] Start the stack from this checkout (web+API on :8443, WITHOUT mTLS)
	$(FROM_SOURCE) $(DEVVM) up -d

devvm-down: ## [DEV VM] Stop the stack
	$(DEVVM) down

devvm-ps: ## [DEV VM] Containers
	$(DEVVM) ps

devvm-logs: ## [DEV VM] Logs
	$(DEVVM) logs -f --tail=100
