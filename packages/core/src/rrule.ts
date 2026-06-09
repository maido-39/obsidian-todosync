import type { RecurrenceRule } from '@todomd/shared-types';
import * as rrulelib from 'rrule';

/**
 * Recurrence ↔ RRULE conversion, instance expansion, and the §2.3 limitation
 * validator (core/rrule, §10 step 3).
 *
 * The Obsidian-Tasks 🔁 text is parsed with the `rrule` library's natural-language
 * support — the same engine Obsidian Tasks uses — so our RRULE output matches it.
 * This module is **server-side TypeScript only**: the Android Kotlin parser keeps
 * the recurrence as `raw` text (round-trip) and never converts, so the golden
 * corpus's `rrule: ""` sentinel is intentionally left unconverted by the parser.
 */

const { RRule, rrulestr } = rrulelib;

const WHEN_DONE_RE = /\bwhen\s+done\s*$/i;

/** Convert 🔁 natural-language text to RRULE params (no `RRULE:` prefix). */
export function recurrenceToRRule(raw: string): {
  rrule: string;
  whenDone: boolean;
  warnings: string[];
} {
  const whenDone = WHEN_DONE_RE.test(raw);
  const text = raw.replace(WHEN_DONE_RE, '').trim();
  if (text.length === 0) {
    return { rrule: '', whenDone, warnings: ['empty recurrence text'] };
  }
  try {
    const params = toRRuleParams(RRule.fromText(text));
    return { rrule: params, whenDone, warnings: validateRRule(params) };
  } catch {
    return { rrule: '', whenDone, warnings: [`unrecognized recurrence: "${text}"`] };
  }
}

/** Fill a {@link RecurrenceRule}'s `rrule` from its `raw` text if not already set. */
export function resolveRecurrence(rec: RecurrenceRule): RecurrenceRule {
  if (rec.rrule.length > 0) return { ...rec };
  const { rrule, whenDone } = recurrenceToRRule(rec.raw);
  return { raw: rec.raw, rrule, whenDone };
}

/** Convert RRULE params back to natural language (for CalDAV → .md). */
export function rruleToText(rruleParams: string): string {
  return RRule.fromString(`RRULE:${stripPrefix(rruleParams)}`).toText();
}

/**
 * Expand an RRULE into the next `count` occurrences from `dtstart`, using
 * floating local-time semantics (no zone): occurrences carry the same wall-clock
 * components as `dtstart`. Returns `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` strings.
 */
export function expandRRule(rruleParams: string, dtstart: string, count: number): string[] {
  if (count <= 0) return [];
  const { date, hasTime } = toFloatingUTC(dtstart);
  const rule = rrulestr(`RRULE:${stripPrefix(rruleParams)}`, { dtstart: date });
  const occurrences = rule.all((_, i) => i < count);
  return occurrences.map((d) => formatFloatingUTC(d, hasTime));
}

/**
 * §2.3 limitation checks for Android + DAVx5. Currently flags BYSETPOS used with
 * a non-MONTHLY frequency (only MONTHLY is reliable there).
 */
export function validateRRule(rruleParams: string): string[] {
  const params = parseParams(rruleParams);
  const warnings: string[] = [];
  if (params.BYSETPOS !== undefined && params.FREQ !== 'MONTHLY') {
    warnings.push('BYSETPOS is only reliable with FREQ=MONTHLY on Android+DAVx5 (§2.3)');
  }
  return warnings;
}

// --- helpers ---------------------------------------------------------------

function toRRuleParams(rule: rrulelib.RRule): string {
  const s = rule.toString();
  const m = /RRULE:([^\n\r]*)/.exec(s);
  return (m ? m[1] : s.replace(/^RRULE:/i, '')) ?? '';
}

function stripPrefix(rruleParams: string): string {
  return rruleParams.replace(/^RRULE:/i, '').trim();
}

function parseParams(rruleParams: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of stripPrefix(rruleParams).split(';')) {
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq).toUpperCase()] = pair.slice(eq + 1);
  }
  return out;
}

const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

function toFloatingUTC(s: string): { date: Date; hasTime: boolean } {
  const m = DATETIME_RE.exec(s);
  if (!m) throw new Error(`invalid date/datetime: ${s}`);
  const hasTime = m[4] !== undefined;
  const date = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)),
  );
  return { date, hasTime };
}

function formatFloatingUTC(d: Date, hasTime: boolean): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  return hasTime ? `${date}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : date;
}
