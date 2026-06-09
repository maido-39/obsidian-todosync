import type { Priority, TaskBlock } from '@todomd/shared-types';
import { resolveRecurrence } from './rrule.js';

/**
 * Task → iCalendar (VEVENT / VTODO) — the forward mapper for the Phase-1
 * ".md → calendar" path (§3.4). A narrow, owned RFC-5545 serializer: it emits
 * only the properties we need, with CRLF line endings and TEXT escaping.
 *
 * The component is taken from `task.component` (decided at parse time, §3.3).
 * Reverse parsing (calendar → Task, via node-ical) is a Phase-2 follow-up.
 *
 * Known simplification: TZID is referenced without an embedded VTIMEZONE, and
 * long lines are not folded — both are acceptable for DAVx5/sabre-dav and are
 * noted for later hardening.
 */
export interface ICalOptions {
  /** IANA timezone for timed values (default 'UTC' → emits a 'Z' suffix). */
  timezone?: string;
  /** UID host part (default 'todomd.local'). */
  host?: string;
  /** DTSTAMP source as 'YYYY-MM-DD[THH:MM]' (default deterministic constant). */
  dtstamp?: string;
  /** Duration in minutes for a timed VEVENT's DTEND (default 60). */
  defaultDurationMinutes?: number;
  prodId?: string;
  /** Override the UID (e.g. to preserve a foreign event's original UID). */
  uid?: string;
}

const CRLF = '\r\n';

const PRIORITY_ICAL: Record<Exclude<Priority, null>, number> = {
  highest: 1,
  high: 2,
  medium: 5,
  low: 8,
  lowest: 9,
};

export function taskToICal(task: TaskBlock, opts: ICalOptions = {}): string {
  if (!task.id) {
    throw new Error('taskToICal requires task.id — run assignMissingIds first');
  }
  const timezone = opts.timezone ?? 'UTC';
  const ctx = {
    uid: opts.uid ?? `todomd-${task.id}@${opts.host ?? 'todomd.local'}`,
    dtstamp: utcStamp(opts.dtstamp ?? '2020-01-01T00:00'),
    timezone,
    durationMin: opts.defaultDurationMinutes ?? 60,
  };

  const body =
    task.component === 'VEVENT' ? eventLines(task, ctx) : todoLines(task, ctx);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${opts.prodId ?? '-//todomd//core//EN'}`,
    'CALSCALE:GREGORIAN',
    ...body,
    'END:VCALENDAR',
  ];
  return lines.join(CRLF) + CRLF;
}

interface Ctx {
  uid: string;
  dtstamp: string;
  timezone: string;
  durationMin: number;
}

function eventLines(task: TaskBlock, ctx: Ctx): string[] {
  const primary = primaryEventDate(task);
  if (!primary) {
    throw new Error(`VEVENT task "${task.title}" has no date (due/scheduled/start)`);
  }
  const lines = [
    'BEGIN:VEVENT',
    `UID:${ctx.uid}`,
    `DTSTAMP:${ctx.dtstamp}`,
    `SUMMARY:${escapeText(task.title)}`,
    dtProp('DTSTART', primary.value, primary.hasTime, ctx.timezone),
  ];
  if (primary.hasTime) {
    lines.push(dtProp('DTEND', addMinutes(primary.value, ctx.durationMin), true, ctx.timezone));
  } else {
    lines.push(dtProp('DTEND', addDays(primary.value, 1), false, ctx.timezone));
  }
  pushRRule(lines, task, true); // VEVENT always has DTSTART
  if (task.notes) lines.push(`DESCRIPTION:${escapeText(task.notes)}`);
  lines.push('END:VEVENT');
  return lines;
}

function todoLines(task: TaskBlock, ctx: Ctx): string[] {
  const lines = [
    'BEGIN:VTODO',
    `UID:${ctx.uid}`,
    `DTSTAMP:${ctx.dtstamp}`,
    `SUMMARY:${escapeText(task.title)}`,
  ];
  if (task.scheduled) {
    lines.push(dtProp('DTSTART', task.scheduled, task.scheduledHasTime ?? false, ctx.timezone));
  } else if (task.start) {
    lines.push(dtProp('DTSTART', task.start, task.startHasTime ?? false, ctx.timezone));
  }
  if (task.due) {
    lines.push(dtProp('DUE', task.due, task.dueHasTime ?? false, ctx.timezone));
  }
  if (task.priority) lines.push(`PRIORITY:${PRIORITY_ICAL[task.priority]}`);
  pushRRule(lines, task, Boolean(task.due || task.scheduled || task.start));
  if (task.done || task.completedAt) {
    lines.push('STATUS:COMPLETED', 'PERCENT-COMPLETE:100');
    if (task.completedAt) lines.push(`COMPLETED:${utcStamp(task.completedAt)}`);
  }
  if (task.notes) lines.push(`DESCRIPTION:${escapeText(task.notes)}`);
  lines.push('END:VTODO');
  return lines;
}

function pushRRule(lines: string[], task: TaskBlock, hasAnchor: boolean): void {
  // A recurrence needs a date to anchor on; an anchorless RRULE is meaningless
  // (and crashes some clients), so we skip it. The 🔁 text stays in the .md.
  if (!task.recurrence || !hasAnchor) return;
  const { rrule } = resolveRecurrence(task.recurrence);
  if (rrule) lines.push(`RRULE:${rrule}`);
}

function primaryEventDate(task: TaskBlock): { value: string; hasTime: boolean } | null {
  if (task.due) return { value: task.due, hasTime: task.dueHasTime ?? false };
  if (task.scheduled) return { value: task.scheduled, hasTime: task.scheduledHasTime ?? false };
  if (task.start) return { value: task.start, hasTime: task.startHasTime ?? false };
  return null;
}

// --- RFC 5545 value formatting --------------------------------------------

/** Build a date/date-time property line. */
function dtProp(name: string, value: string, hasTime: boolean, tz: string): string {
  if (!hasTime) return `${name};VALUE=DATE:${formatDate(value)}`;
  if (tz === 'UTC') return `${name}:${formatDateTime(value)}Z`;
  return `${name};TZID=${tz}:${formatDateTime(value)}`;
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

const DT_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

function parts(value: string): { y: number; mo: number; d: number; hh: number; mm: number } {
  const m = DT_RE.exec(value);
  if (!m) throw new Error(`invalid date/datetime: ${value}`);
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    hh: Number(m[4] ?? 0),
    mm: Number(m[5] ?? 0),
  };
}

const p2 = (n: number): string => String(n).padStart(2, '0');

function formatDate(value: string): string {
  const { y, mo, d } = parts(value);
  return `${y}${p2(mo)}${p2(d)}`;
}

function formatDateTime(value: string): string {
  const { y, mo, d, hh, mm } = parts(value);
  return `${y}${p2(mo)}${p2(d)}T${p2(hh)}${p2(mm)}00`;
}

/** UTC stamp 'YYYYMMDDTHHMMSSZ' (date-only inputs default to 00:00). */
function utcStamp(value: string): string {
  const { y, mo, d, hh, mm } = parts(value);
  const date = new Date(Date.UTC(y, mo - 1, d, hh, mm, 0));
  return (
    `${date.getUTCFullYear()}${p2(date.getUTCMonth() + 1)}${p2(date.getUTCDate())}` +
    `T${p2(date.getUTCHours())}${p2(date.getUTCMinutes())}${p2(date.getUTCSeconds())}Z`
  );
}

function addDays(value: string, n: number): string {
  const { y, mo, d } = parts(value);
  const date = new Date(Date.UTC(y, mo - 1, d + n));
  return `${date.getUTCFullYear()}-${p2(date.getUTCMonth() + 1)}-${p2(date.getUTCDate())}`;
}

function addMinutes(value: string, n: number): string {
  const { y, mo, d, hh, mm } = parts(value);
  const date = new Date(Date.UTC(y, mo - 1, d, hh, mm + n));
  return (
    `${date.getUTCFullYear()}-${p2(date.getUTCMonth() + 1)}-${p2(date.getUTCDate())}` +
    `T${p2(date.getUTCHours())}:${p2(date.getUTCMinutes())}`
  );
}
