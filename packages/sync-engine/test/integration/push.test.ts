import { getResource, emptyState, pushToCalDav } from '@todomd/sync-engine';
import { describe, expect, it } from 'vitest';

// Runs only when a live Xandikos is reachable (set by `make itest`).
const baseUrl = process.env.XANDIKOS_URL;

const MD =
  '## 2026-06-10\n\n' +
  '- [ ] meeting 📅 2026-06-10 14:00 #event ^evtaaa\n' +
  '- [ ] buy milk 📅 2026-06-11 ^todbbb\n';

describe.skipIf(!baseUrl)('one-way push against Xandikos', () => {
  const cfg = { baseUrl: baseUrl ?? '' };
  const calendarPath = '/user/calendars/itest/';

  it('creates resources that are retrievable as VEVENT/VTODO', async () => {
    const { state, result } = await pushToCalDav(MD, emptyState(), cfg, {
      calendarPath,
      ical: { timezone: 'Asia/Seoul' },
    });
    expect([...result.created].sort()).toEqual(['evtaaa', 'todbbb']);
    expect(result.updated).toEqual([]);

    const eventIcs = await getResource(cfg, state.blocks.evtaaa?.href ?? '');
    expect(eventIcs).toContain('BEGIN:VEVENT');
    expect(eventIcs).toContain('SUMMARY:meeting');
    expect(eventIcs).toContain('DTSTART;TZID=Asia/Seoul:20260610T140000');

    const todoIcs = await getResource(cfg, state.blocks.todbbb?.href ?? '');
    expect(todoIcs).toContain('BEGIN:VTODO');
  });

  it('treats an unchanged re-push as a no-op', async () => {
    const first = await pushToCalDav(MD, emptyState(), cfg, { calendarPath });
    const second = await pushToCalDav(first.markdown, first.state, cfg, { calendarPath });
    expect(second.result.created).toEqual([]);
    expect(second.result.updated).toEqual([]);
    expect([...second.result.unchanged].sort()).toEqual(['evtaaa', 'todbbb']);
  });

  it('deletes resources removed from the document', async () => {
    const first = await pushToCalDav(MD, emptyState(), cfg, { calendarPath });
    const reduced = '## 2026-06-10\n\n- [ ] meeting 📅 2026-06-10 14:00 #event ^evtaaa\n';
    const second = await pushToCalDav(reduced, first.state, cfg, { calendarPath });
    expect(second.result.deleted).toEqual(['todbbb']);
    expect(await getResource(cfg, first.state.blocks.todbbb?.href ?? '')).toBeNull();
  });
});
