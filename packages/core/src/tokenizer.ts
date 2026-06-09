import type { Priority, RecurrenceRule } from '@todomd/shared-types';
import { nfc, stripTrailingId } from './normalize.js';

/**
 * The emoji-signifier tokenizer (§3.2) — the highest-risk algorithm and the
 * seam that will be ported verbatim to Kotlin. It uses only plain string
 * operations (no remark, no regex look-behind) so the port is mechanical.
 *
 * It extracts due/scheduled/start/done/created/cancelled dates, priority,
 * recurrence and tags from a task's title line, returning the cleaned title plus
 * structured fields. Tokens it does not recognize (including non-signifier
 * emoji) are preserved in the title — unparsed input is never silently dropped.
 */
export interface ParsedTaskLine {
  id: string | null;
  title: string;
  due?: string;
  scheduled?: string;
  start?: string;
  completedAt?: string;
  cancelledAt?: string;
  createdAt?: string;
  dueHasTime?: boolean;
  scheduledHasTime?: boolean;
  startHasTime?: boolean;
  completedAtHasTime?: boolean;
  cancelledAtHasTime?: boolean;
  createdAtHasTime?: boolean;
  priority: Priority;
  recurrence?: RecurrenceRule;
  tags: string[];
  warnings: string[];
}

type DateField = 'due' | 'scheduled' | 'start' | 'completedAt' | 'cancelledAt' | 'createdAt';

const DATE_SIGNIFIERS: Record<string, DateField> = {
  '📅': 'due',
  '⏳': 'scheduled',
  '🛫': 'start',
  '✅': 'completedAt',
  '➕': 'createdAt',
  '❌': 'cancelledAt',
};

const PRIORITY_SIGNIFIERS: Record<string, Exclude<Priority, null>> = {
  '🔺': 'highest',
  '⏫': 'high',
  '🔼': 'medium',
  '🔽': 'low',
  '⏬': 'lowest',
};

const RECUR_SIGNIFIER = '🔁';

// Special whitespace / variation selectors built from code points (pure-ASCII source).
const FULLWIDTH_SPACE = String.fromCharCode(0x3000);
const NBSP = String.fromCharCode(0x00a0);
const VS15 = String.fromCharCode(0xfe0e);
const VS16 = String.fromCharCode(0xfe0f);

const WS_SPLIT_RE = new RegExp('[ \\t' + FULLWIDTH_SPACE + NBSP + ']+');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const LEADING_MARKER_RE = /^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?/;
const WHEN_DONE_RE = /\bwhen\s+done\s*$/i;

/** Strip variation selectors so an emoji compares equal with or without VS15/16. */
function stripVariationSelectors(token: string): string {
  return token.split(VS15).join('').split(VS16).join('');
}

/** Normalize a token for signifier matching (NFC already applied upstream). */
function signifierKey(token: string): string {
  return stripVariationSelectors(token);
}

function normalizeKeys<V>(m: Record<string, V>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const k of Object.keys(m)) {
    const v = m[k];
    if (v !== undefined) out[stripVariationSelectors(k)] = v;
  }
  return out;
}

// VS-normalized lookup maps, so matching is robust whether the variation
// selector appears on the input token, the source literal, or neither.
const DATE_SIG = normalizeKeys(DATE_SIGNIFIERS);
const PRIO_SIG = normalizeKeys(PRIORITY_SIGNIFIERS);
const RECUR_KEY = stripVariationSelectors(RECUR_SIGNIFIER);

function isDate(s: string | undefined): s is string {
  return s !== undefined && DATE_RE.test(s);
}

function isTime(s: string | undefined): s is string {
  return s !== undefined && TIME_RE.test(s);
}

function isSignifier(token: string | undefined): boolean {
  if (token === undefined) return false;
  const key = signifierKey(token);
  return key === RECUR_KEY || key in DATE_SIG || key in PRIO_SIG;
}

function setDateField(r: ParsedTaskLine, field: DateField, value: string, hasTime: boolean): void {
  switch (field) {
    case 'due':
      r.due = value;
      r.dueHasTime = hasTime;
      break;
    case 'scheduled':
      r.scheduled = value;
      r.scheduledHasTime = hasTime;
      break;
    case 'start':
      r.start = value;
      r.startHasTime = hasTime;
      break;
    case 'completedAt':
      r.completedAt = value;
      r.completedAtHasTime = hasTime;
      break;
    case 'cancelledAt':
      r.cancelledAt = value;
      r.cancelledAtHasTime = hasTime;
      break;
    case 'createdAt':
      r.createdAt = value;
      r.createdAtHasTime = hasTime;
      break;
  }
}

/**
 * Parse a task title line into structured fields. `done` comes from the GFM
 * checkbox and is supplied separately by the caller; this handles only the text.
 */
export function parseTaskLine(titleLine: string): ParsedTaskLine {
  const { text: noId, id } = stripTrailingId(titleLine);
  const cleaned = nfc(noId).replace(LEADING_MARKER_RE, '');
  const tokens = cleaned.split(WS_SPLIT_RE).filter((t) => t.length > 0);

  const result: ParsedTaskLine = { id, title: '', priority: null, tags: [], warnings: [] };
  const titleParts: string[] = [];

  let k = 0;
  while (k < tokens.length) {
    const token = tokens[k];
    if (token === undefined) {
      k++;
      continue;
    }
    const key = signifierKey(token);

    const dateField = DATE_SIG[key];
    if (dateField !== undefined) {
      const dateTok = tokens[k + 1];
      if (isDate(dateTok)) {
        const timeTok = tokens[k + 2];
        const hasTime = isTime(timeTok);
        if (result[dateField] !== undefined) {
          result.warnings.push(`duplicate ${dateField}; last value kept`);
        }
        setDateField(result, dateField, hasTime ? `${dateTok}T${timeTok}` : dateTok, hasTime);
        k += hasTime ? 3 : 2;
        continue;
      }
      result.warnings.push(`dangling ${token}`);
      titleParts.push(token);
      k++;
      continue;
    }

    const prio = PRIO_SIG[key];
    if (prio !== undefined) {
      if (result.priority !== null) {
        result.warnings.push('duplicate priority; last value kept');
      }
      result.priority = prio;
      k++;
      continue;
    }

    if (key === RECUR_KEY) {
      const words: string[] = [];
      let j = k + 1;
      while (j < tokens.length && !isSignifier(tokens[j])) {
        const w = tokens[j];
        if (w !== undefined) {
          if (w.startsWith('#') || w.startsWith('@')) break; // tags end the recurrence run
          words.push(w);
        }
        j++;
      }
      const raw = words.join(' ');
      if (raw.length > 0) {
        result.recurrence = { raw, rrule: '', whenDone: WHEN_DONE_RE.test(raw) };
      } else {
        result.warnings.push('dangling recurrence');
        titleParts.push(token);
      }
      k = j;
      continue;
    }

    if (token.length > 1 && (token.startsWith('#') || token.startsWith('@'))) {
      result.tags.push(token);
      k++;
      continue;
    }

    titleParts.push(token);
    k++;
  }

  result.title = titleParts.join(' ').trim();
  return result;
}
