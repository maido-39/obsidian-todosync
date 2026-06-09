import { rruleToText } from '@todomd/core';
import type { Component, Priority } from '@todomd/shared-types';

/**
 * A narrow, owned iCalendar reader for the reverse mapper (calendar → Task).
 *
 * It extracts only the fields the sync engine reconciles, reading **raw
 * wall-clock values** (no timezone conversion or recurrence expansion). This was
 * chosen over `node-ical` after probing showed node-ical crashes on valid
 * recurring VTODOs lacking DTSTART and returns tz-converted `Date`s we'd have to
 * undo. It handles RFC-5545 line unfolding, property parameters, and TEXT
 * unescaping; it intentionally ignores VTIMEZONE/EXDATE/RECURRENCE-ID.
 */
export interface ParsedICalTask {
  uid: string;
  /** Block id from a `todomd-<id>@host` UID, else null. */
  blockId: string | null;
  component: Component;
  title: string;
  start?: string;
  startHasTime?: boolean;
  due?: string;
  dueHasTime?: boolean;
  completedAt?: string;
  done: boolean;
  priority: Priority;
  /** Raw RRULE params (e.g. `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`). */
  rrule?: string;
  /** Natural-language recurrence via rrule's toText (best effort). */
  recurrenceRaw?: string;
  notes?: string;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

export function parseICalTask(ics: string): ParsedICalTask | null {
  const props: Prop[] = [];
  let component: Component | null = null;
  let inside = false;

  for (const line of unfold(ics)) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN' && (p.value === 'VEVENT' || p.value === 'VTODO') && !inside) {
      inside = true;
      component = p.value;
      continue;
    }
    if (p.name === 'END' && p.value === component) break;
    if (inside) props.push(p);
  }
  if (!component) return null;

  const get = (name: string): Prop | undefined => props.find((p) => p.name === name);
  const uid = get('UID')?.value ?? '';
  const completed = get('COMPLETED');
  const status = get('STATUS')?.value.toUpperCase();
  const rrule = get('RRULE');
  const description = get('DESCRIPTION');
  const summary = get('SUMMARY');

  const result: ParsedICalTask = {
    uid,
    blockId: extractBlockId(uid),
    component,
    title: summary ? unescapeText(summary.value) : '',
    done: status === 'COMPLETED' || completed !== undefined,
    priority: priorityToLevel(get('PRIORITY')?.value),
  };

  const dtstart = get('DTSTART');
  if (dtstart) {
    const d = parseICalDate(dtstart);
    result.start = d.value;
    result.startHasTime = d.hasTime;
  }
  const due = get('DUE');
  if (due) {
    const d = parseICalDate(due);
    result.due = d.value;
    result.dueHasTime = d.hasTime;
  }
  if (completed) result.completedAt = parseICalDate(completed).value.slice(0, 10);
  if (rrule) {
    result.rrule = rrule.value;
    try {
      result.recurrenceRaw = rruleToText(rrule.value);
    } catch {
      /* leave recurrenceRaw undefined on unparseable rules */
    }
  }
  if (description) result.notes = unescapeText(description.value);
  return result;
}

// --- parsing helpers -------------------------------------------------------

function unfold(ics: string): string[] {
  const raw = ics.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseLine(line: string): Prop | null {
  if (line.trim() === '') return null;
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const segments = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i] ?? '';
    const eq = seg.indexOf('=');
    if (eq > 0) params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1);
  }
  return { name: (segments[0] ?? '').toUpperCase(), params, value: line.slice(colon + 1) };
}

function parseICalDate(p: Prop): { value: string; hasTime: boolean } {
  const v = p.value.trim();
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}Z?$/.exec(v);
  if (dt && p.params.VALUE !== 'DATE') {
    return { value: `${dt[1]}-${dt[2]}-${dt[3]}T${dt[4]}:${dt[5]}`, hasTime: true };
  }
  const d = /^(\d{4})(\d{2})(\d{2})/.exec(v);
  if (d) return { value: `${d[1]}-${d[2]}-${d[3]}`, hasTime: false };
  return { value: v, hasTime: false };
}

function priorityToLevel(raw: string | undefined): Priority {
  if (raw === undefined) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n === 1) return 'highest';
  if (n <= 4) return 'high';
  if (n === 5) return 'medium';
  if (n <= 8) return 'low';
  return 'lowest';
}

function extractBlockId(uid: string): string | null {
  const m = /^todomd-([0-9a-z]{3,32})@/.exec(uid);
  return m ? (m[1] ?? null) : null;
}

function unescapeText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === 'n' || next === 'N') {
        out += '\n';
        i++;
      } else if (next === '\\' || next === ';' || next === ',') {
        out += next;
        i++;
      } else {
        out += s[i];
      }
    } else {
      out += s[i];
    }
  }
  return out;
}
