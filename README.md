# todomd

A markdown file as the **single source of truth (SSOT)** for a personal ToDo/calendar
system. This repository implements the canonical-format **parser & serializer**
(`@todomd/core`, round-trip equivalence as the acceptance gate), a **bidirectional
CalDAV sync engine** (`@todomd/sync-engine`), a **REST API**, and a **web dashboard**
(`@todomd/web-dashboard`). See [`docs/`](docs/) and the project spec for the full
architecture and roadmap.

## Toolchain (Docker)

Everything runs inside a Node 22 container — **you do not need Node, pnpm, or
TypeScript installed on the host**, only Docker.

```bash
make image      # build the dev container image
make install    # pnpm install (workspace deps)
make build      # tsc -b — type-check & build all packages
make test       # run the vitest suite
make shell      # drop into a bash shell in the container
```

### One-time Docker note

If you just added yourself to the `docker` group (`sudo usermod -aG docker $USER`),
your current login session does not yet have that membership, so the daemon socket is
unreachable. Either **log out and back in**, or rely on the bundled [`dc`](dc) wrapper
(used by the `Makefile`), which transparently runs `docker compose` under
`sg docker` until you re-login.

## Running the app

```bash
make up      # xandikos (CalDAV) + engine (REST API) + web dashboard, bound to 0.0.0.0
make down    # stop the stack
```

Dashboard `http://<lan-ip>:5173` · Engine API `:8787` · CalDAV `:8000`. The engine
deploys with `TODOMD_GIT=1`, versioning the `.md` on every change.

## Natural-language quick-add

The dashboard's quick-add box turns Korean like `내일 오후 3시 회의 #업무` into a
structured task. A fast, offline **rule parser** handles the common cases; when it
finds no date yet the text clearly mentions one in a colloquial/typo form
(`담주 화욜`, `월말까지`), the engine falls back to an **optional local LLM** that
normalizes the language — while our deterministic code still computes the actual
dates and extracts tags (LLMs are unreliable at date math and hallucinate tags).

Enable it with the `ollama` service (already in `compose.yaml`) and these engine vars:

```
TODOMD_LLM=1
OLLAMA_URL=http://ollama:11434
OLLAMA_MODEL=exaone3.5:2.4b   # Korean-specialized 2.4B (default); or qwen2.5:3b
```

Pull a model once: `docker compose exec ollama ollama pull exaone3.5:2.4b`. On CPU the
first request after ~15 min idle pays a one-time model load; subsequent quick-adds run
in ~10 s. Leave `TODOMD_LLM` unset to stay rules-only (fully offline, instant).

## Layout

```
packages/
  shared-types/   # platform-agnostic type definitions (§3.6)
  core/           # parser + serializer + rrule/mapper/differ/nlp (SSOT round-trip core)
  sync-engine/    # CalDAV client, bidirectional sync, REST API, git versioning, LLM fallback
  web-dashboard/  # Vite + Preact dashboard (quick-add, task list, sync, conflicts)
fixtures/golden/  # language-neutral corpus: input.md + expected.json + roundtrip.md
                  # (shared by the TS core and the future Kotlin port)
```
