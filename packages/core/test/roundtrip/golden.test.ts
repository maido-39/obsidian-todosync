import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument, projectDocument, serializeDocument } from '@todomd/core';

// Repo-root corpus, shared with the future Kotlin port.
const casesDir = resolve(import.meta.dirname, '../../../../fixtures/golden/cases');
const cases = readdirSync(casesDir)
  .filter((d) => statSync(join(casesDir, d)).isDirectory())
  .sort();

describe('golden corpus', () => {
  it('discovers cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const name of cases) {
    describe(name, () => {
      const dir = join(casesDir, name);
      const input = readFileSync(join(dir, 'input.md'), 'utf8');
      const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
      const roundtrip = readFileSync(join(dir, 'roundtrip.md'), 'utf8');
      const doc = parseDocument(input);

      it('parse → projection matches expected.json', () => {
        expect(projectDocument(doc)).toEqual(expected);
      });

      it('serialize matches roundtrip.md', () => {
        expect(serializeDocument(doc)).toBe(roundtrip);
      });

      it('serialize∘parse is idempotent (== input)', () => {
        expect(serializeDocument(doc)).toBe(input);
      });

      it('parse∘serialize is semantically stable', () => {
        const reparsed = parseDocument(serializeDocument(doc));
        expect(projectDocument(reparsed)).toEqual(expected);
      });
    });
  }
});
