import type { Block } from '@todomd/shared-types';
import { describe, expect, it } from 'vitest';
import { mergeBlocks, parseDocument } from '@todomd/core';

const blocks = (src: string): Block[] => parseDocument(src).blocks;
const titles = (bs: Block[]): string[] => bs.map((b) => (b.kind === 'task' ? b.title : b.kind));

describe('mergeBlocks', () => {
  const base = blocks('## D\n\n- [ ] a v1 ^aaa001\n');

  it('no changes → identical, no conflicts', () => {
    const r = mergeBlocks(base, base, base);
    expect(r.conflicts).toHaveLength(0);
    expect(titles(r.merged)).toEqual(['a v1']);
  });

  it('takes a local-only edit', () => {
    const local = blocks('## D\n\n- [ ] a v2 ^aaa001\n');
    const r = mergeBlocks(base, local, base);
    expect(r.conflicts).toHaveLength(0);
    expect(titles(r.merged)).toEqual(['a v2']);
  });

  it('takes a remote-only edit', () => {
    const remote = blocks('## D\n\n- [ ] a v2 ^aaa001\n');
    const r = mergeBlocks(base, base, remote);
    expect(r.conflicts).toHaveLength(0);
    expect(titles(r.merged)).toEqual(['a v2']);
  });

  it('merges convergent identical edits cleanly', () => {
    const v2 = blocks('## D\n\n- [ ] a v2 ^aaa001\n');
    const r = mergeBlocks(base, v2, v2);
    expect(r.conflicts).toHaveLength(0);
    expect(titles(r.merged)).toEqual(['a v2']);
  });

  it('flags divergent edits and keeps local provisional', () => {
    const local = blocks('## D\n\n- [ ] a v2 ^aaa001\n');
    const remote = blocks('## D\n\n- [ ] a v3 ^aaa001\n');
    const r = mergeBlocks(base, local, remote);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]?.reason).toBe('both-edited');
    expect(titles(r.merged)).toEqual(['a v2']);
  });

  it('unions additions from both sides', () => {
    const local = blocks('## D\n\n- [ ] a v1 ^aaa001\n- [ ] b ^bbb001\n');
    const remote = blocks('## D\n\n- [ ] a v1 ^aaa001\n- [ ] c ^ccc001\n');
    const r = mergeBlocks(base, local, remote);
    expect(r.conflicts).toHaveLength(0);
    expect(titles(r.merged)).toEqual(['a v1', 'b', 'c']);
  });

  it('applies a deletion that is unchanged on the other side', () => {
    const baseAB = blocks('## D\n\n- [ ] a ^aaa001\n- [ ] b ^bbb001\n');
    const local = blocks('## D\n\n- [ ] a ^aaa001\n');
    const r = mergeBlocks(baseAB, local, baseAB);
    expect(r.conflicts).toHaveLength(0);
    expect(titles(r.merged)).toEqual(['a']);
  });

  it('flags edit-vs-delete', () => {
    const baseAB = blocks('## D\n\n- [ ] a ^aaa001\n- [ ] b v1 ^bbb001\n');
    const local = blocks('## D\n\n- [ ] a ^aaa001\n- [ ] b v2 ^bbb001\n');
    const remote = blocks('## D\n\n- [ ] a ^aaa001\n');
    const r = mergeBlocks(baseAB, local, remote);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]?.reason).toBe('edit-delete');
    expect(titles(r.merged)).toEqual(['a', 'b v2']);
  });
});
