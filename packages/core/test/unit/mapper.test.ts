import type { TaskBlock } from '@todomd/shared-types';
import { describe, expect, it } from 'vitest';
import { parseDocument, taskToICal } from '@todomd/core';

function firstTask(src: string): TaskBlock {
  const t = parseDocument(src).blocks.find((b) => b.kind === 'task');
  if (!t || t.kind !== 'task') throw new Error('no task parsed');
  return t;
}

describe('taskToICal — VEVENT', () => {
  it('emits a timed event with TZID and a default-duration DTEND', () => {
    const ics = taskToICal(firstTask('- [ ] meeting 📅 2026-06-10 14:00 #event ^evt001'), {
      timezone: 'Asia/Seoul',
    });
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:todomd-evt001@todomd.local');
    expect(ics).toContain('SUMMARY:meeting');
    expect(ics).toContain('DTSTART;TZID=Asia/Seoul:20260610T140000');
    expect(ics).toContain('DTEND;TZID=Asia/Seoul:20260610T150000');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toMatch(/\r\n/);
  });

  it('emits an all-day event as VALUE=DATE with next-day DTEND', () => {
    const ics = taskToICal(firstTask('- [ ] holiday 📅 2026-06-10 #event ^evt002'));
    expect(ics).toContain('DTSTART;VALUE=DATE:20260610');
    expect(ics).toContain('DTEND;VALUE=DATE:20260611');
  });

  it('emits UTC datetimes with a Z suffix when timezone is UTC', () => {
    const ics = taskToICal(firstTask('- [ ] u 📅 2026-06-10 09:00 #event ^evt003'), {
      timezone: 'UTC',
    });
    expect(ics).toContain('DTSTART:20260610T090000Z');
    expect(ics).toContain('DTEND:20260610T100000Z');
  });

  it('escapes TEXT values', () => {
    const ics = taskToICal(firstTask('- [ ] a, b; c #event 📅 2026-06-10 ^evt004'));
    expect(ics).toContain('SUMMARY:a\\, b\\; c');
  });
});

describe('taskToICal — VTODO', () => {
  it('emits DUE and PRIORITY for a pure todo', () => {
    const ics = taskToICal(firstTask('- [ ] pay rent 📅 2026-06-10 ⏫ ^td0001'));
    expect(ics).toContain('BEGIN:VTODO');
    expect(ics).toContain('DUE;VALUE=DATE:20260610');
    expect(ics).toContain('PRIORITY:2');
  });

  it('marks completion', () => {
    const ics = taskToICal(firstTask('- [x] done ✅ 2026-06-10 ^td0002'));
    expect(ics).toContain('STATUS:COMPLETED');
    expect(ics).toContain('PERCENT-COMPLETE:100');
    expect(ics).toContain('COMPLETED:20260610T000000Z');
  });

  it('emits RRULE from a recurrence and DTSTART from start', () => {
    const ics = taskToICal(firstTask('- [ ] gym 🔁 every weekday 🛫 2026-06-10 ^td0003'));
    expect(ics).toContain('BEGIN:VTODO');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260610');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  });
});

describe('taskToICal — guards', () => {
  it('throws when the task has no id', () => {
    expect(() => taskToICal(firstTask('- [ ] no id here #event 📅 2026-06-10'))).toThrow(/id/);
  });

  it('uses a deterministic DTSTAMP by default', () => {
    const a = taskToICal(firstTask('- [ ] x 📅 2026-06-10 #event ^det001'));
    const b = taskToICal(firstTask('- [ ] x 📅 2026-06-10 #event ^det001'));
    expect(a).toBe(b);
    expect(a).toContain('DTSTAMP:20200101T000000Z');
  });
});
