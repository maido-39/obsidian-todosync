import { parseDocument, taskToICal, type ICalOptions } from '@todomd/core';
import type { TaskBlock } from '@todomd/shared-types';
import { parseICalTask } from '@todomd/sync-engine';
import { describe, expect, it } from 'vitest';

function task(src: string): TaskBlock {
  const t = parseDocument(src).blocks.find((b) => b.kind === 'task');
  if (!t || t.kind !== 'task') throw new Error('no task');
  return t;
}
function roundtrip(src: string, ical?: ICalOptions) {
  return parseICalTask(taskToICal(task(src), ical));
}

describe('parseICalTask — round-trip via the forward mapper', () => {
  it('recovers a timed event', () => {
    const r = roundtrip('- [ ] meeting 📅 2026-06-10 14:00 #event ^evt001', {
      timezone: 'Asia/Seoul',
    });
    expect(r?.component).toBe('VEVENT');
    expect(r?.title).toBe('meeting');
    expect(r?.blockId).toBe('evt001');
    expect(r?.start).toBe('2026-06-10T14:00');
    expect(r?.startHasTime).toBe(true);
  });

  it('recovers an all-day event', () => {
    const r = roundtrip('- [ ] holiday 📅 2026-06-10 #event ^evt002');
    expect(r?.component).toBe('VEVENT');
    expect(r?.start).toBe('2026-06-10');
    expect(r?.startHasTime).toBe(false);
  });

  it('recovers a todo with due date and priority', () => {
    const r = roundtrip('- [ ] pay rent 📅 2026-06-10 ⏫ ^td0001');
    expect(r?.component).toBe('VTODO');
    expect(r?.due).toBe('2026-06-10');
    expect(r?.priority).toBe('high');
  });

  it('recovers completion', () => {
    const r = roundtrip('- [x] done ✅ 2026-06-10 ^td0002');
    expect(r?.done).toBe(true);
    expect(r?.completedAt).toBe('2026-06-10');
  });

  it('recovers a recurrence (anchored)', () => {
    const r = roundtrip('- [ ] gym 🔁 every weekday 🛫 2026-06-10 ^td0003');
    expect(r?.component).toBe('VTODO');
    expect(r?.start).toBe('2026-06-10');
    expect(r?.rrule).toContain('FREQ=WEEKLY');
    expect(r?.recurrenceRaw).toBeDefined();
  });
});

describe('parseICalTask — raw ICS', () => {
  it('unescapes TEXT values', () => {
    const ics =
      'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:todomd-esc001@h\r\n' +
      'SUMMARY:a\\, b\\; c\r\nDESCRIPTION:line1\\nline2\r\n' +
      'DTSTART;VALUE=DATE:20260610\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const r = parseICalTask(ics);
    expect(r?.title).toBe('a, b; c');
    expect(r?.notes).toBe('line1\nline2');
    expect(r?.blockId).toBe('esc001');
  });

  it('unfolds continuation lines', () => {
    const ics =
      'BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:todomd-fld001@h\r\n' +
      'SUMMARY:Project\r\n Plan\r\nDUE;VALUE=DATE:20260610\r\n' +
      'END:VTODO\r\nEND:VCALENDAR\r\n';
    const r = parseICalTask(ics);
    expect(r?.component).toBe('VTODO');
    expect(r?.title).toBe('ProjectPlan');
    expect(r?.due).toBe('2026-06-10');
  });

  it('returns null when there is no VEVENT/VTODO', () => {
    expect(parseICalTask('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')).toBeNull();
  });
});
