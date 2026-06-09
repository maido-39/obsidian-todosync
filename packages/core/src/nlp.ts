import type { Component } from '@todomd/shared-types';

/**
 * Korean (and incidental English) natural-language quick-add (§3.5). Turns a
 * phrase like "내일 오후 3시 보고서 제출 #회사" into a structured Task preview.
 * It is intentionally conservative: when a time or date is ambiguous it sets
 * `confident: false` so the UI confirms the interpretation before committing
 * (§1.4 — never silently mis-convert).
 *
 * Pure date arithmetic only (a `today` reference is passed in), so it stays
 * platform-agnostic and is the Korean-NLP seam for a future port.
 */
export interface ParsedNL {
  title: string;
  due?: string;
  dueHasTime?: boolean;
  /** Recurrence as Obsidian/English text (e.g. "every monday") for core/rrule. */
  recurrence?: string;
  tags: string[];
  component: Component;
  /** False when a date/time was ambiguous or the title is empty — confirm first. */
  confident: boolean;
  warnings: string[];
}

const WEEKDAY_KO: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const WEEKDAY_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function parseNaturalLanguage(text: string, today: string): ParsedNL {
  const warnings: string[] = [];
  let rest = ` ${text.trim()} `;

  const tagResult = extractTags(rest);
  rest = tagResult.rest;
  const tags = tagResult.tags;

  const rec = extractRecurrence(rest);
  rest = rec.rest;

  const dateResult = extractDate(rest, today);
  rest = dateResult.rest;
  if (dateResult.warning) warnings.push(dateResult.warning);

  const timeResult = extractTime(rest);
  rest = timeResult.rest;

  const title = rest.replace(/\s+/g, ' ').trim();

  // Resolve the due date: explicit date, else a recurrence weekday anchor, else
  // (for a timed recurring item) today as the anchor.
  let date = dateResult.date;
  if (!date && rec.anchorWeekday !== undefined) date = nextWeekday(today, rec.anchorWeekday);
  if (!date && rec.recurrence && timeResult.time) date = today;

  let due: string | undefined;
  let dueHasTime = false;
  if (date && timeResult.time) {
    due = `${date}T${timeResult.time}`;
    dueHasTime = true;
  } else if (date) {
    due = date;
  }

  const component: Component = timeResult.time ? 'VEVENT' : 'VTODO';
  const confident =
    dateResult.confident && timeResult.confident && title.length > 0 && !(rec.recurrence && !date);
  if (title.length === 0) warnings.push('제목을 찾지 못했습니다');
  if (!timeResult.confident) warnings.push('시간이 오전/오후가 불분명합니다');

  const result: ParsedNL = { title, tags, component, confident, warnings };
  if (due !== undefined) result.due = due;
  if (dueHasTime) result.dueHasTime = true;
  if (rec.recurrence !== undefined) result.recurrence = rec.recurrence;
  return result;
}

// --- extractors ------------------------------------------------------------

function extractTags(text: string): { rest: string; tags: string[] } {
  const tags: string[] = [];
  const rest = text.replace(/[#@][^\s#@]+/g, (m) => {
    tags.push(m);
    return ' ';
  });
  return { rest, tags };
}

function extractRecurrence(text: string): {
  rest: string;
  recurrence?: string;
  anchorWeekday?: number;
} {
  const weekly = /매주\s*([월화수목금토일])요일/.exec(text);
  if (weekly) {
    const ko = weekly[1] ?? '월';
    return {
      rest: text.replace(weekly[0], ' '),
      recurrence: `every ${WEEKDAY_EN[WEEKDAY_KO[ko] ?? 1]}`,
      anchorWeekday: WEEKDAY_KO[ko],
    };
  }
  const monthly = /(?:매월|매달)\s*(\d{1,2})\s*일/.exec(text);
  if (monthly) {
    return {
      rest: text.replace(monthly[0], ' '),
      recurrence: `every month on the ${ordinal(Number(monthly[1]))}`,
    };
  }
  const simple: Array<[RegExp, string]> = [
    [/격주/, 'every 2 weeks'],
    [/(?:평일|주중|매평일)/, 'every weekday'],
    [/매주/, 'every week'],
    [/매일/, 'every day'],
    [/(?:매년|매해)/, 'every year'],
  ];
  for (const [re, en] of simple) {
    const m = re.exec(text);
    if (m) return { rest: text.replace(re, ' '), recurrence: en };
  }
  return { rest: text };
}

function extractDate(
  text: string,
  today: string,
): { rest: string; date?: string; confident: boolean; warning?: string } {
  const rel: Array<[RegExp, number]> = [
    [/모레/, 2],
    [/글피/, 3],
    [/내일/, 1],
    [/오늘/, 0],
    [/어제/, -1],
  ];
  for (const [re, offset] of rel) {
    const m = re.exec(text);
    if (m) {
      return {
        rest: text.replace(re, ' '),
        date: addDays(today, offset),
        confident: true,
        ...(offset < 0 ? { warning: '과거 날짜입니다' } : {}),
      };
    }
  }

  const inDays = /(\d{1,2})\s*일\s*(?:후|뒤|있다가)/.exec(text);
  if (inDays) {
    return { rest: text.replace(inDays[0], ' '), date: addDays(today, Number(inDays[1])), confident: true };
  }

  const wk = /(다음|담|이번|금)\s*주\s*([월화수목금토일])요일/.exec(text);
  if (wk) {
    const target = WEEKDAY_KO[wk[2] ?? '월'] ?? 1;
    const nextWeek = wk[1] === '다음' || wk[1] === '담';
    const base = nextWeek ? addDays(today, 7) : today;
    return { rest: text.replace(wk[0], ' '), date: weekdayInWeekOf(base, target), confident: true };
  }

  const bareWk = /([월화수목금토일])요일/.exec(text);
  if (bareWk) {
    const target = WEEKDAY_KO[bareWk[1] ?? '월'] ?? 1;
    return { rest: text.replace(bareWk[0], ' '), date: nextWeekday(today, target), confident: true };
  }

  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    return { rest: text.replace(iso[0], ' '), date: `${iso[1]}-${iso[2]}-${iso[3]}`, confident: true };
  }

  const md = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(text);
  if (md) {
    return { rest: text.replace(md[0], ' '), date: monthDay(today, Number(md[1]), Number(md[2])), confident: true };
  }

  return { rest: text, confident: true };
}

function extractTime(text: string): { rest: string; time?: string; confident: boolean } {
  if (/정오/.test(text)) return { rest: text.replace(/정오/, ' '), time: '12:00', confident: true };
  if (/자정/.test(text)) return { rest: text.replace(/자정/, ' '), time: '00:00', confident: true };

  const ampm = /(오전|오후)\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?/.exec(text);
  if (ampm) {
    let h = Number(ampm[2]) % 12;
    if (ampm[1] === '오후') h += 12;
    const min = ampm[3] ? Number(ampm[3]) : 0;
    return { rest: text.replace(ampm[0], ' '), time: `${p2(h)}:${p2(min)}`, confident: true };
  }

  const colon = /(\d{1,2}):(\d{2})/.exec(text);
  if (colon) {
    return { rest: text.replace(colon[0], ' '), time: `${p2(Number(colon[1]))}:${colon[2]}`, confident: true };
  }

  const bare = /(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?/.exec(text);
  if (bare) {
    const h = Number(bare[1]);
    const min = bare[2] ? Number(bare[2]) : 0;
    return { rest: text.replace(bare[0], ' '), time: `${p2(h)}:${p2(min)}`, confident: h >= 13 };
  }

  return { rest: text, confident: true };
}

// --- date helpers ----------------------------------------------------------

const p2 = (n: number): string => String(n).padStart(2, '0');

function ymdToUTC(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}
function utcToYmd(dt: Date): string {
  return `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;
}
function addDays(s: string, n: number): string {
  const dt = ymdToUTC(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return utcToYmd(dt);
}
/** Next occurrence of `target` weekday strictly after today (today+1 .. +7). */
function nextWeekday(today: string, target: number): string {
  const cur = ymdToUTC(today).getUTCDay();
  const diff = ((target - cur + 7) % 7) || 7;
  return addDays(today, diff);
}
/** The `target` weekday within the (Mon-anchored) week containing `base`. */
function weekdayInWeekOf(base: string, target: number): string {
  const cur = ymdToUTC(base).getUTCDay();
  return addDays(base, target - cur);
}
function monthDay(today: string, month: number, day: number): string {
  const year = ymdToUTC(today).getUTCFullYear();
  const candidate = `${year}-${p2(month)}-${p2(day)}`;
  return candidate < today ? `${year + 1}-${p2(month)}-${p2(day)}` : candidate;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}
