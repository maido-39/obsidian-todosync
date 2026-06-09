// Byte-identical round-trip checker for arbitrary markdown files.
// Usage (after `make build`):
//   docker compose run --rm dev node scripts/roundtrip-check.mjs path/to/file.md ...
// Exits non-zero on the first file whose serialize(parse(x)) !== x.
import { readFileSync } from 'node:fs';
import { parseDocument, serializeDocument } from '../packages/core/dist/index.js';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: roundtrip-check.mjs <file.md> [...]');
  process.exit(2);
}

let failures = 0;
for (const file of files) {
  const input = readFileSync(file, 'utf8');
  const output = serializeDocument(parseDocument(input));
  if (output === input) {
    console.log(`OK   ${file}  (${input.length} chars, byte-identical)`);
    continue;
  }
  failures++;
  let i = 0;
  while (i < Math.min(output.length, input.length) && output[i] === input[i]) i++;
  console.error(`FAIL ${file}: round-trip differs at index ${i}`);
  console.error(`  input : ${JSON.stringify(input.slice(i, i + 48))}`);
  console.error(`  output: ${JSON.stringify(output.slice(i, i + 48))}`);
}

process.exit(failures > 0 ? 1 : 0);
