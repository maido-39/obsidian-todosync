import { describe, expect, it } from 'vitest';
import { contentHash, parseDocument, serializeDocument } from '@todomd/core';

const ROUND_TRIP_CASES = [
  '',
  'hello world\n',
  '## 2026-06-10\n\n- [ ] 보고서 제출 📅 2026-06-10 ^a1b2c3\n',
  '---\ntodomd_version: 1\ntimezone: Asia/Seoul\n---\n\n## P\n\n- [x] done ✅ 2026-06-10\n',
];

describe('skeleton round-trip (raw preservation)', () => {
  for (const src of ROUND_TRIP_CASES) {
    it(`reproduces ${JSON.stringify(src)}`, () => {
      expect(serializeDocument(parseDocument(src))).toBe(src);
    });
  }

  it('restores CRLF input', () => {
    const crlf = '## A\r\n\r\n- [ ] x\r\n';
    expect(serializeDocument(parseDocument(crlf))).toBe(crlf);
  });
});

describe('frontmatter parsing', () => {
  it('reads known scalars and preserves unknown keys', () => {
    const doc = parseDocument(
      '---\ntimezone: Asia/Seoul\nsection_strategy: project\nfoo: bar\n---\n\nbody\n',
    );
    expect(doc.frontmatter.timezone).toBe('Asia/Seoul');
    expect(doc.frontmatter.section_strategy).toBe('project');
    expect(doc.frontmatter.todomd_version).toBe(1);
    expect(doc.frontmatter.extra).toEqual({ foo: 'bar' });
  });

  it('applies defaults when frontmatter is absent', () => {
    const doc = parseDocument('no frontmatter here\n');
    expect(doc.frontmatter.section_strategy).toBe('date');
    expect(doc.layout.frontmatterRaw).toBeNull();
  });

  it('does not treat a mid-body --- as frontmatter', () => {
    const doc = parseDocument('intro\n\n---\n\nafter\n');
    expect(doc.layout.frontmatterRaw).toBeNull();
    expect(serializeDocument(doc)).toBe('intro\n\n---\n\nafter\n');
  });
});

describe('contentHash', () => {
  it('is stable across trailing whitespace and blank-line runs', () => {
    expect(contentHash('- [ ] task  \n')).toBe(contentHash('- [ ] task\n\n\n'));
  });

  it('changes when meaningful content changes', () => {
    expect(contentHash('- [ ] task a\n')).not.toBe(contentHash('- [ ] task b\n'));
  });

  it('ignores a trailing block id', () => {
    expect(contentHash('- [ ] task ^a1b2c3\n')).toBe(contentHash('- [ ] task\n'));
  });
});
