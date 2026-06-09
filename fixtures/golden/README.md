# Golden corpus

Language-neutral fixtures that pin the canonical-format **parser/serializer
contract**. Both the TypeScript core (`@todomd/core`) and the future Kotlin port
must satisfy them, so the corpus lives at the repo root — not inside a package —
and is read by `packages/core/test/roundtrip/golden.test.ts`.

## Layout

```
cases/NNNN-name/
  input.md       # the source document
  expected.json  # semantic projection of parse(input.md)
  roundtrip.md   # serialize(parse(input.md)) — byte-exact reproduction
manifest.json    # index of cases + per-case stats
```

## Contract (`GOLDEN_SCHEMA_VERSION = 1`)

`expected.json` is `projectDocument(parseDocument(input.md))` (see
`packages/core/src/golden.ts`). The projection:

- drops serializer bookkeeping (`raw`, `origin`, `dirty`, `layout`);
- **keeps `contentHash`** (sha256) so a port's hashing must match byte-for-byte;
- omits `undefined` fields.

A conforming implementation must, for every case:

1. `parse(input.md)` then project → deep-equals `expected.json`;
2. `serialize(parse(input.md))` === `roundtrip.md` (and === `input.md` for these
   LF fixtures, i.e. parse∘serialize is a no-op on canonical input).

## Regenerating

After changing the parser/serializer or adding a case:

```
make build && make golden
```

This rewrites `expected.json` / `roundtrip.md` / `manifest.json` from the parser.
The unit tests under `packages/core/test/unit` assert correctness independently,
so regeneration is a snapshot refresh — not the source of truth for behavior.

## Covered elsewhere (not in this corpus)

- CRLF EOL handling → `packages/core/test/unit/smoke.test.ts`
- full-width-space tokenizing → `packages/core/test/unit/tokenizer.test.ts`
- `assignMissingIds` determinism → `packages/core/test/unit/idAssign.test.ts`
