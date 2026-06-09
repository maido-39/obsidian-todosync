import { describe, expect, it } from 'vitest';
import { parseMultistatus, parseSyncResponse } from '@todomd/sync-engine';

describe('parseMultistatus', () => {
  it('extracts resource hrefs + etags, skipping the collection itself', () => {
    const xml =
      '<ns0:multistatus xmlns:ns0="DAV:">' +
      '<ns0:response><ns0:href>/user/calendars/personal/</ns0:href>' +
      '<ns0:propstat><ns0:prop><ns0:getetag>"coll"</ns0:getetag></ns0:prop></ns0:propstat></ns0:response>' +
      '<ns0:response><ns0:href>/user/calendars/personal/todomd-evt001.ics</ns0:href>' +
      '<ns0:propstat><ns0:prop><ns0:getetag>"cf96"</ns0:getetag></ns0:prop></ns0:propstat></ns0:response>' +
      '</ns0:multistatus>';
    expect(parseMultistatus(xml)).toEqual([
      { href: '/user/calendars/personal/todomd-evt001.ics', etag: '"cf96"' },
    ]);
  });

  it('handles namespace-less XML and empty input', () => {
    expect(parseMultistatus('')).toEqual([]);
    const xml =
      '<multistatus><response><href>/c/a.ics</href>' +
      '<propstat><prop><getetag>"e"</getetag></prop></propstat></response></multistatus>';
    expect(parseMultistatus(xml)).toEqual([{ href: '/c/a.ics', etag: '"e"' }]);
  });
});

describe('parseSyncResponse', () => {
  it('separates changed/removed and extracts the sync-token', () => {
    const xml =
      '<ns0:multistatus xmlns:ns0="DAV:">' +
      '<ns0:response><ns0:href>/c/changed.ics</ns0:href><ns0:propstat>' +
      '<ns0:status>HTTP/1.1 200 OK</ns0:status>' +
      '<ns0:prop><ns0:getetag>"e1"</ns0:getetag></ns0:prop></ns0:propstat></ns0:response>' +
      '<ns0:response><ns0:href>/c/gone.ics</ns0:href>' +
      '<ns0:status>HTTP/1.1 404 Not Found</ns0:status></ns0:response>' +
      '<ns0:sync-token>tok-123</ns0:sync-token></ns0:multistatus>';
    const r = parseSyncResponse(xml);
    expect(r.changed).toEqual([{ href: '/c/changed.ics', etag: '"e1"' }]);
    expect(r.removed).toEqual(['/c/gone.ics']);
    expect(r.syncToken).toBe('tok-123');
  });
});
