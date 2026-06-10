# All toolchain commands run inside the Node 22 dev container (compose.yaml).
# `./dc` wraps `docker compose` and tolerates a stale docker-group session.
DC := ./dc
RUN := $(DC) run --rm dev

.DEFAULT_GOAL := help

.PHONY: help image install build test test-watch golden itest up down web web-build shots plugin plugin-install shell clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

image: ## Build the dev container image
	$(DC) build

install: ## Install workspace dependencies (pnpm)
	$(RUN) pnpm install

build: ## Type-check & build all packages (tsc -b)
	$(RUN) pnpm run build

test: ## Run the full vitest suite
	$(RUN) pnpm run test

test-watch: ## Run vitest in watch mode
	$(RUN) pnpm run test:watch

golden: ## Regenerate golden-corpus expected.json/roundtrip.md (run after build)
	$(RUN) node scripts/gen-golden.mjs

itest: ## Run integration tests against the live service stack (Xandikos)
	$(DC) up -d --build xandikos
	@echo "waiting for xandikos to accept connections..."
	@for i in $$(seq 1 60); do curl -sf http://localhost:8000/ >/dev/null 2>&1 && { echo "ready"; break; }; sleep 1; done
	$(DC) run --rm -e XANDIKOS_URL=http://xandikos:8000 dev pnpm run test

up: ## Start the whole app in the background (dashboard + engine + CalDAV)
	$(DC) up -d --build xandikos engine web
	@echo ""
	@echo "  todomd is running:"
	@echo "    dashboard  →  http://localhost:5173"
	@echo "    engine API →  http://localhost:8787"
	@echo "    CalDAV     →  http://localhost:8000  (Xandikos)"
	@echo "  stop with: make down"

down: ## Stop the app
	$(DC) down

web-build: ## Type-check & bundle the web dashboard
	$(RUN) sh -lc 'cd packages/web-dashboard && pnpm run build'

web: ## Run the web dashboard + backend (browse http://localhost:5173)
	$(DC) up -d --build xandikos engine
	@for i in $$(seq 1 30); do curl -sf http://localhost:8000/ >/dev/null 2>&1 && break; sleep 1; done
	$(DC) run --rm -p 5173:5173 dev sh -lc 'cd packages/web-dashboard && pnpm dev --host 0.0.0.0'

plugin: ## Build the Obsidian plugin bundle (→ packages/obsidian-plugin/main.js)
	$(RUN) sh -lc 'cd packages/obsidian-plugin && pnpm build'

plugin-install: ## Copy the built plugin into a vault: make plugin-install VAULT=/path/to/vault
	@test -n "$(VAULT)" || { echo "usage: make plugin-install VAULT=/path/to/your/vault"; exit 1; }
	@test -f packages/obsidian-plugin/main.js || { echo "build it first: make plugin"; exit 1; }
	mkdir -p "$(VAULT)/.obsidian/plugins/todomd-calendar"
	cp packages/obsidian-plugin/main.js packages/obsidian-plugin/manifest.json packages/obsidian-plugin/styles.css "$(VAULT)/.obsidian/plugins/todomd-calendar/"
	@echo "installed → $(VAULT)/.obsidian/plugins/todomd-calendar/  (enable in Obsidian: Settings → Community plugins)"

shots: ## Capture dashboard screenshots into ./screenshots (Playwright)
	$(DC) up -d --build xandikos engine web
	@echo "waiting for web dev server..."
	@for i in $$(seq 1 90); do curl -sf http://localhost:5173/ >/dev/null 2>&1 && { echo ready; break; }; sleep 1; done
	$(DC) run --rm shot node scripts/shot.mjs

shell: ## Open a bash shell in the dev container
	$(RUN) bash

clean: ## Remove build outputs, node_modules, and the pnpm store
	$(RUN) bash -lc 'rm -rf packages/*/dist packages/*/*.tsbuildinfo node_modules packages/*/node_modules .pnpm-store'
