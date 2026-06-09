import { describe, expect, it } from 'vitest';
import { parseTaskLine } from '@todomd/core';

describe('parseTaskLine — dates', () => {
  it('extracts a date-only due', () => {
    const r = parseTaskLine('보고서 제출 📅 2026-06-10');
    expect(r.title).toBe('보고서 제출');
    expect(r.due).toBe('2026-06-10');
    expect(r.dueHasTime).toBe(false);
  });

  it('extracts a due with time and a tag', () => {
    const r = parseTaskLine('회의 📅 2026-06-10 14:00 #event');
    expect(r.due).toBe('2026-06-10T14:00');
    expect(r.dueHasTime).toBe(true);
    expect(r.tags).toEqual(['#event']);
    expect(r.title).toBe('회의');
  });

  it('collects all six date signifiers', () => {
    const r = parseTaskLine(
      't 📅 2026-01-01 ⏳ 2026-01-02 🛫 2026-01-03 ✅ 2026-01-04 ➕ 2026-01-05 ❌ 2026-01-06',
    );
    expect(r.due).toBe('2026-01-01');
    expect(r.scheduled).toBe('2026-01-02');
    expect(r.start).toBe('2026-01-03');
    expect(r.completedAt).toBe('2026-01-04');
    expect(r.createdAt).toBe('2026-01-05');
    expect(r.cancelledAt).toBe('2026-01-06');
    expect(r.title).toBe('t');
  });

  it('keeps a dangling date emoji in the title with a warning', () => {
    const r = parseTaskLine('🎉 파티 📅');
    expect(r.title).toBe('🎉 파티 📅');
    expect(r.due).toBeUndefined();
    expect(r.warnings).toContain('dangling 📅');
  });
});

describe('parseTaskLine — priority', () => {
  it('maps a priority emoji', () => {
    expect(parseTaskLine('a ⏫').priority).toBe('high');
    expect(parseTaskLine('a 🔺').priority).toBe('highest');
    expect(parseTaskLine('a ⏬').priority).toBe('lowest');
  });

  it('keeps the last of duplicate priorities and warns', () => {
    const r = parseTaskLine('a ⏫ ⏬');
    expect(r.priority).toBe('lowest');
    expect(r.warnings).toContain('duplicate priority; last value kept');
  });
});

describe('parseTaskLine — recurrence', () => {
  it('captures the raw run and stops at the next signifier', () => {
    const r = parseTaskLine('x 🔁 every month on the 15th 📅 2026-06-20');
    expect(r.recurrence?.raw).toBe('every month on the 15th');
    expect(r.recurrence?.whenDone).toBe(false);
    expect(r.recurrence?.rrule).toBe('');
    expect(r.due).toBe('2026-06-20');
    expect(r.title).toBe('x');
  });

  it('detects "when done"', () => {
    const r = parseTaskLine('y 🔁 every friday when done');
    expect(r.recurrence?.raw).toBe('every friday when done');
    expect(r.recurrence?.whenDone).toBe(true);
  });
});

describe('parseTaskLine — ids & tags', () => {
  it('splits a trailing block id but does not put it in the title', () => {
    const r = parseTaskLine('task ^a1b2c3');
    expect(r.id).toBe('a1b2c3');
    expect(r.title).toBe('task');
  });

  it('keeps Korean mentions and tag order', () => {
    const r = parseTaskLine('업무 #event @회사 #todo');
    expect(r.tags).toEqual(['#event', '@회사', '#todo']);
  });

  it('does not treat short ^x as an id', () => {
    const r = parseTaskLine('see ^x');
    expect(r.id).toBeNull();
    expect(r.title).toBe('see ^x');
  });
});

describe('parseTaskLine — whitespace', () => {
  const FW = String.fromCharCode(0x3000); // full-width space

  it('treats a full-width space as a token separator', () => {
    const r = parseTaskLine(`회의${FW}📅${FW}2026-06-10`);
    expect(r.title).toBe('회의');
    expect(r.due).toBe('2026-06-10');
  });
});
