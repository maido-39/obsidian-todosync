# todomd

A markdown file as the **single source of truth (SSOT)** for a personal ToDo/calendar
system. This repository currently implements **Increment 1**: the canonical-format
**parser & serializer** (`@todomd/core`) plus its shared types, with round-trip
equivalence as the acceptance gate. See [`docs/`](docs/) and the project spec for the
full architecture and roadmap.

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

## Layout

```
packages/
  shared-types/   # platform-agnostic type definitions (§3.6)
  core/           # parser + serializer (the SSOT round-trip core)
fixtures/golden/  # language-neutral corpus: input.md + expected.json + roundtrip.md
                  # (shared by the TS core and the future Kotlin port)
```
