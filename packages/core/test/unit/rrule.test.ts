import { describe, expect, it } from 'vitest';
import {
  expandRRule,
  recurrenceToRRule,
  resolveRecurrence,
  rruleToText,
  validateRRule,
} from '@todomd/core';

describe('recurrenceToRRule', () => {
  it('maps common Obsidian-Tasks phrases', () => {
    expect(recurrenceToRRule('every day').rrule).toContain('FREQ=DAILY');
    expect(recurrenceToRRule('every week').rrule).toContain('FREQ=WEEKLY');
    expect(recurrenceToRRule('every month').rrule).toContain('FREQ=MONTHLY');
    expect(recurrenceToRRule('every year').rrule).toContain('FREQ=YEARLY');
  });

  it('maps intervals and weekdays', () => {
    const biweekly = recurrenceToRRule('every 2 weeks').rrule;
    expect(biweekly).toContain('FREQ=WEEKLY');
    expect(biweekly).toContain('INTERVAL=2');

    const weekday = recurrenceToRRule('every weekday').rrule;
    expect(weekday).toContain('FREQ=WEEKLY');
    expect(weekday).toContain('BYDAY=MO,TU,WE,TH,FR');

    expect(recurrenceToRRule('every friday').rrule).toContain('BYDAY=FR');
  });

  it('maps "on the Nth" to BYMONTHDAY', () => {
    const monthly = recurrenceToRRule('every month on the 15th').rrule;
    expect(monthly).toContain('FREQ=MONTHLY');
    expect(monthly).toContain('BYMONTHDAY=15');
  });

  it('detects "when done" and strips it before conversion', () => {
    const r = recurrenceToRRule('every friday when done');
    expect(r.whenDone).toBe(true);
    expect(r.rrule).toContain('BYDAY=FR');
  });

  it('returns an empty rrule with a warning for unrecognized text', () => {
    const r = recurrenceToRRule('every blue moon');
    expect(r.rrule).toBe('');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('resolveRecurrence', () => {
  it('fills rrule from raw when unconverted', () => {
    const out = resolveRecurrence({ raw: 'every weekday', rrule: '', whenDone: false });
    expect(out.rrule).toContain('BYDAY=MO,TU,WE,TH,FR');
  });

  it('leaves an already-converted rrule untouched', () => {
    const out = resolveRecurrence({ raw: 'every day', rrule: 'FREQ=MONTHLY', whenDone: false });
    expect(out.rrule).toBe('FREQ=MONTHLY');
  });
});

describe('rruleToText', () => {
  it('renders RRULE params back to natural language', () => {
    expect(rruleToText('FREQ=WEEKLY').toLowerCase()).toContain('week');
  });
});

describe('expandRRule', () => {
  it('expands a daily rule (date-only, floating)', () => {
    expect(expandRRule('FREQ=DAILY', '2026-06-10', 3)).toEqual([
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
    ]);
  });

  it('expands a weekly rule preserving the weekday', () => {
    expect(expandRRule('FREQ=WEEKLY', '2026-06-10', 2)).toEqual(['2026-06-10', '2026-06-17']);
  });

  it('preserves the time component', () => {
    expect(expandRRule('FREQ=DAILY', '2026-06-10T09:00', 2)).toEqual([
      '2026-06-10T09:00',
      '2026-06-11T09:00',
    ]);
  });

  it('returns [] for non-positive count', () => {
    expect(expandRRule('FREQ=DAILY', '2026-06-10', 0)).toEqual([]);
  });
});

describe('validateRRule (§2.3)', () => {
  it('warns when BYSETPOS is used with a non-MONTHLY frequency', () => {
    expect(validateRRule('FREQ=YEARLY;BYMONTH=8;BYDAY=FR;BYSETPOS=1').length).toBeGreaterThan(0);
  });

  it('accepts BYSETPOS with MONTHLY', () => {
    expect(validateRRule('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1')).toEqual([]);
  });
});
