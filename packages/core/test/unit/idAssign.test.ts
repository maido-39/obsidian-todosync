import type { TaskBlock } from '@todomd/shared-types';
import { describe, expect, it } from 'vitest';
import { assignMissingIds, parseDocument, seededIdGen, serializeDocument } from '@todomd/core';

describe('assignMissingIds', () => {
  it('is a no-op when every task already has an id', () => {
    const src = '## A\n\n- [ ] x ^a1b2c3\n';
    const { doc, assigned } = assignMissingIds(parseDocument(src));
    expect(assigned).toEqual([]);
    expect(serializeDocument(doc)).toBe(src);
  });

  it('assigns base36 ids that survive a re-parse with fields intact', () => {
    const src = '## A\n\n- [ ] alpha 📅 2026-06-10\n- [ ] beta #event\n';
    const { doc, assigned } = assignMissingIds(parseDocument(src), seededIdGen(42));
    expect(assigned).toHaveLength(2);
    for (const id of assigned) expect(id).toMatch(/^[0-9a-z]{6}$/);

    const reparsed = parseDocument(serializeDocument(doc));
    const tasks = reparsed.blocks.filter((b): b is TaskBlock => b.kind === 'task');
    expect(tasks.map((t) => t.id)).toEqual(assigned);
    expect(tasks[0]?.title).toBe('alpha');
    expect(tasks[0]?.due).toBe('2026-06-10');
    expect(tasks[1]?.title).toBe('beta');
    expect(tasks[1]?.tags).toEqual(['#event']);
  });

  it('is reproducible for a fixed seed', () => {
    const src = '- [ ] one\n- [ ] two\n';
    const a = assignMissingIds(parseDocument(src), seededIdGen(7)).assigned;
    const b = assignMissingIds(parseDocument(src), seededIdGen(7)).assigned;
    expect(a).toEqual(b);
  });

  it('re-renders only dirty tasks, preserving other blocks verbatim', () => {
    const src = '## A\n\nsome note paragraph\n\n- [ ] todo\n';
    const out = assignMissingIds(parseDocument(src), seededIdGen(1)).doc;
    const text = serializeDocument(out);
    expect(text).toContain('some note paragraph');
    expect(text).toMatch(/- \[ \] todo \^[0-9a-z]{6}\n$/);
  });
});
