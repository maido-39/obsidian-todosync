import { deleteResource, ensureCalendar, putResource, syncCollection } from '@todomd/sync-engine';
import { describe, expect, it } from 'vitest';

const baseUrl = process.env.XANDIKOS_URL;

const ICS =
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\n' +
  'UID:todomd-syncaa@todomd.local\r\nDTSTAMP:20200101T000000Z\r\n' +
  'SUMMARY:sync probe\r\nDTSTART;VALUE=DATE:20260610\r\nDTEND;VALUE=DATE:20260611\r\n' +
  'END:VEVENT\r\nEND:VCALENDAR\r\n';

describe.skipIf(!baseUrl)('sync-collection REPORT against Xandikos', () => {
  const cfg = { baseUrl: baseUrl ?? '' };
  const path = '/user/calendars/synctest/';
  const href = `${path}todomd-syncaa.ics`;

  it('reports created then removed resources with advancing tokens', async () => {
    await ensureCalendar(cfg, path);
    const initial = await syncCollection(cfg, path);
    expect(initial.syncToken.length).toBeGreaterThan(0);

    await putResource(cfg, href, ICS);
    const afterPut = await syncCollection(cfg, path, initial.syncToken);
    expect(afterPut.changed.map((c) => c.href)).toContain(href);
    expect(afterPut.removed).not.toContain(href);

    await deleteResource(cfg, href);
    const afterDelete = await syncCollection(cfg, path, afterPut.syncToken);
    expect(afterDelete.removed).toContain(href);
  });
});
