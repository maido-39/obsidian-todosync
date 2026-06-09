import {
  addTask,
  assignMissingIds,
  deleteTask,
  parseDocument,
  serializeDocument,
  updateTask,
} from '@todomd/core';
import { describe, expect, it } from 'vitest';

describe('addTask', () => {
  it('inserts into an existing section and keeps other blocks verbatim', () => {
    const src = '## 2026-06-10\n\n- [ ] existing ^aaa111\n';
    const { doc } = addTask(parseDocument(src), {
      title: 'new task',
      section: '2026-06-10',
      due: '2026-06-10',
    });
    const out = serializeDocument(assignMissingIds(doc).doc);
    expect(out).toContain('- [ ] existing ^aaa111');
    expect(out).toMatch(/- \[ \] new task 📅 2026-06-10 \^[0-9a-z]{6}/);
  });

  it('creates the section heading when it does not exist', () => {
    const { doc } = addTask(parseDocument(''), { title: 't', section: '2026-06-11' });
    const out = serializeDocument(assignMissingIds(doc).doc);
    expect(out).toContain('## 2026-06-11');
    expect(out).toContain('- [ ] t');
  });
});

describe('updateTask', () => {
  it('patches fields in place, re-rendering only that block', () => {
    const src = '## D\n\n- [ ] a ^aaa111\n- [ ] keep me ^bbb222\n';
    const doc = updateTask(parseDocument(src), 'aaa111', {
      title: 'a changed',
      done: true,
      due: '2026-06-10',
    });
    expect(doc).not.toBeNull();
    const out = serializeDocument(doc as NonNullable<typeof doc>);
    expect(out).toContain('- [x] a changed 📅 2026-06-10 ^aaa111');
    expect(out).toContain('- [ ] keep me ^bbb222');
  });

  it('returns null for an unknown id', () => {
    expect(updateTask(parseDocument('- [ ] x ^aaa111\n'), 'zzz999', { title: 'y' })).toBeNull();
  });
});

describe('deleteTask', () => {
  it('removes a task and preserves the rest verbatim', () => {
    const src = '## D\n\n- [ ] keep ^aaa111\n- [ ] gone ^bbb222\n';
    const doc = deleteTask(parseDocument(src), 'bbb222');
    expect(doc).not.toBeNull();
    const out = serializeDocument(doc as NonNullable<typeof doc>);
    expect(out).toContain('- [ ] keep ^aaa111');
    expect(out).not.toContain('gone');
  });

  it('returns null for an unknown id', () => {
    expect(deleteTask(parseDocument('- [ ] x ^aaa111\n'), 'zzz999')).toBeNull();
  });
});
