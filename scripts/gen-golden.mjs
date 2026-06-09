// Regenerate the golden corpus expected outputs from the (validated) parser.
// Run after `make build`:  docker compose run --rm dev node scripts/gen-golden.mjs
// (or `make golden`). sha256 content hashes cannot be authored by hand, so the
// expected.json / roundtrip.md files are generated and checked in; the unit
// tests in packages/core/test independently assert correctness.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  GOLDEN_SCHEMA_VERSION,
  parseDocument,
  projectDocument,
  serializeDocument,
} from '../packages/core/dist/index.js';

const root = resolve('fixtures/golden');
const casesDir = join(root, 'cases');

const dirs = readdirSync(casesDir)
  .filter((d) => statSync(join(casesDir, d)).isDirectory())
  .sort();

const manifest = {
  schemaVersion: GOLDEN_SCHEMA_VERSION,
  cases: [],
};

for (const name of dirs) {
  const dir = join(casesDir, name);
  const input = readFileSync(join(dir, 'input.md'), 'utf8');
  const doc = parseDocument(input);
  const expected = projectDocument(doc);
  const roundtrip = serializeDocument(doc);

  writeFileSync(join(dir, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
  writeFileSync(join(dir, 'roundtrip.md'), roundtrip);

  manifest.cases.push({
    name,
    sections: doc.sections.length,
    blocks: doc.blocks.length,
    roundTripExact: roundtrip === input,
  });
  console.log(
    `${name}: ${doc.sections.length} sections, ${doc.blocks.length} blocks, ` +
      `roundtrip ${roundtrip === input ? 'exact' : 'DIFFERS'}`,
  );
}

writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nWrote ${dirs.length} cases + manifest.json`);
