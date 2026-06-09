/**
 * A narrow, owned CalDAV client (spec §4.1 "참고→포팅") over Node's global
 * `fetch`. It implements only the verbs the sync engine uses: ensure a calendar
 * collection, conditional PUT/DELETE (ETag), GET, and a PROPFIND listing. The
 * multistatus XML is parsed minimally — enough for href + getetag — rather than
 * pulling in a full WebDAV stack.
 */

export interface CalDavConfig {
  /** Server origin, e.g. `http://xandikos:8000`. */
  baseUrl: string;
  username?: string;
  password?: string;
}

export interface ResourceMeta {
  /** Server-absolute path, e.g. `/user/calendars/personal/todomd-x.ics`. */
  href: string;
  etag: string;
}

export interface SyncCollectionResult {
  /** Resources added or modified since the previous sync-token. */
  changed: ResourceMeta[];
  /** Hrefs of resources removed since the previous sync-token. */
  removed: string[];
  /** Opaque token to pass to the next incremental sync. */
  syncToken: string;
}

function authHeaders(cfg: CalDavConfig): Record<string, string> {
  if (cfg.username === undefined) return {};
  const token = Buffer.from(`${cfg.username}:${cfg.password ?? ''}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

function absolute(cfg: CalDavConfig, pathOrUrl: string): string {
  return new URL(pathOrUrl, cfg.baseUrl).toString();
}

/** Create the calendar collection if absent; existing collections are accepted. */
export async function ensureCalendar(cfg: CalDavConfig, calendarPath: string): Promise<void> {
  const res = await fetch(absolute(cfg, calendarPath), {
    method: 'MKCALENDAR',
    headers: authHeaders(cfg),
  });
  // 201 created; 405/409/403 → already exists / not allowed on existing.
  if (res.status === 201 || res.status === 405 || res.status === 409 || res.status === 403) {
    return;
  }
  if (!res.ok) throw new Error(`ensureCalendar(${calendarPath}) → HTTP ${res.status}`);
}

/** PUT a calendar resource. `etag` (If-Match) updates; its absence creates/overwrites. */
export async function putResource(
  cfg: CalDavConfig,
  resourcePath: string,
  ics: string,
  etag?: string,
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/calendar; charset=utf-8',
    ...authHeaders(cfg),
  };
  if (etag) headers['If-Match'] = etag;

  const res = await fetch(absolute(cfg, resourcePath), { method: 'PUT', headers, body: ics });
  if (!res.ok) throw new Error(`PUT(${resourcePath}) → HTTP ${res.status}`);

  const returned = res.headers.get('etag');
  return returned ?? (await headEtag(cfg, resourcePath));
}

/** GET a resource's body, or null if it does not exist (404). */
export async function getResource(cfg: CalDavConfig, resourcePath: string): Promise<string | null> {
  const res = await fetch(absolute(cfg, resourcePath), {
    method: 'GET',
    headers: authHeaders(cfg),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET(${resourcePath}) → HTTP ${res.status}`);
  return await res.text();
}

/** DELETE a resource. `etag` adds an If-Match guard. 404 is treated as success. */
export async function deleteResource(
  cfg: CalDavConfig,
  resourcePath: string,
  etag?: string,
): Promise<void> {
  const headers = authHeaders(cfg);
  if (etag) headers['If-Match'] = etag;
  const res = await fetch(absolute(cfg, resourcePath), { method: 'DELETE', headers });
  if (res.status === 404 || res.ok) return;
  throw new Error(`DELETE(${resourcePath}) → HTTP ${res.status}`);
}

/** List resources in a calendar (PROPFIND Depth 1), excluding the collection itself. */
export async function listResources(
  cfg: CalDavConfig,
  calendarPath: string,
): Promise<ResourceMeta[]> {
  const body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>';
  const res = await fetch(absolute(cfg, calendarPath), {
    method: 'PROPFIND',
    headers: { 'Content-Type': 'application/xml', Depth: '1', ...authHeaders(cfg) },
    body,
  });
  if (!res.ok) throw new Error(`PROPFIND(${calendarPath}) → HTTP ${res.status}`);
  return parseMultistatus(await res.text());
}

/**
 * WebDAV-Sync REPORT (RFC 6578): collect resources changed/removed since
 * `syncToken` (omit it for an initial full sync) and return the next token.
 */
export async function syncCollection(
  cfg: CalDavConfig,
  calendarPath: string,
  syncToken?: string,
): Promise<SyncCollectionResult> {
  const tokenXml = syncToken ? `<d:sync-token>${escapeXml(syncToken)}</d:sync-token>` : '<d:sync-token/>';
  const body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<d:sync-collection xmlns:d="DAV:">${tokenXml}` +
    '<d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>';
  const res = await fetch(absolute(cfg, calendarPath), {
    method: 'REPORT',
    headers: { 'Content-Type': 'application/xml', Depth: '1', ...authHeaders(cfg) },
    body,
  });
  if (!res.ok) throw new Error(`REPORT sync-collection(${calendarPath}) → HTTP ${res.status}`);
  return parseSyncResponse(await res.text());
}

async function headEtag(cfg: CalDavConfig, resourcePath: string): Promise<string> {
  const res = await fetch(absolute(cfg, resourcePath), {
    method: 'HEAD',
    headers: authHeaders(cfg),
  });
  return res.headers.get('etag') ?? '';
}

// --- minimal multistatus parsing -------------------------------------------

const RESPONSE_RE = /<(?:\w+:)?response\b[^>]*>([\s\S]*?)<\/(?:\w+:)?response>/gi;
const HREF_RE = /<(?:\w+:)?href\b[^>]*>([\s\S]*?)<\/(?:\w+:)?href>/i;
const ETAG_RE = /<(?:\w+:)?getetag\b[^>]*>([\s\S]*?)<\/(?:\w+:)?getetag>/i;
const STATUS_RE = /<(?:\w+:)?status\b[^>]*>([\s\S]*?)<\/(?:\w+:)?status>/i;
const SYNC_TOKEN_RE = /<(?:\w+:)?sync-token\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sync-token>/i;

export function parseMultistatus(xml: string): ResourceMeta[] {
  const out: ResourceMeta[] = [];
  for (const m of xml.matchAll(RESPONSE_RE)) {
    const block = m[1] ?? '';
    const hrefMatch = HREF_RE.exec(block);
    const etagMatch = ETAG_RE.exec(block);
    if (!hrefMatch || !etagMatch) continue;
    const href = decodeHref(hrefMatch[1] ?? '');
    if (href.endsWith('/')) continue; // skip the collection itself
    out.push({ href, etag: (etagMatch[1] ?? '').trim() });
  }
  return out;
}

export function parseSyncResponse(xml: string): SyncCollectionResult {
  const changed: ResourceMeta[] = [];
  const removed: string[] = [];
  for (const m of xml.matchAll(RESPONSE_RE)) {
    const block = m[1] ?? '';
    const href = decodeHref(HREF_RE.exec(block)?.[1] ?? '');
    if (!href || href.endsWith('/')) continue;
    const status = STATUS_RE.exec(block)?.[1] ?? '';
    const etag = (ETAG_RE.exec(block)?.[1] ?? '').trim();
    if (/\b2\d\d\b/.test(status) && etag) changed.push({ href, etag });
    else if (/\b404\b/.test(status)) removed.push(href);
  }
  const syncToken = (SYNC_TOKEN_RE.exec(xml)?.[1] ?? '').trim();
  return { changed, removed, syncToken };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeHref(raw: string): string {
  const trimmed = raw.trim();
  try {
    // hrefs may be absolute URLs or paths; keep just the path, decoded.
    return decodeURIComponent(new URL(trimmed, 'http://x').pathname);
  } catch {
    return trimmed;
  }
}
