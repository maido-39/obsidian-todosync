import { parseNaturalLanguage, type ParsedNL } from '@todomd/core';
import type { Component } from '@todomd/shared-types';

/**
 * Local-LLM fallback for natural-language quick-add (§3.5). Runs ONLY when the
 * rule parser is not confident. The LLM does language understanding only — it
 * extracts the title, a *normalized* date phrase, time and recurrence — and our
 * deterministic code resolves the actual date (LLMs are unreliable at date math)
 * and extracts tags by regex (LLMs hallucinate tags). Results are always returned
 * with `confident: false` so the UI confirms before committing.
 */
export interface LLMConfig {
  url: string;
  model: string;
  timeoutMs?: number;
}

interface LLMExtraction {
  title?: string;
  datePhrase?: string | null;
  time?: string | null;
  recurrence?: string | null;
}

const SYSTEM =
  `너는 한국어 할 일/일정 문장에서 정보를 뽑아 JSON으로만 출력하는 추출기다. 설명/여는말 금지.\n` +
  `출력: {"title": string, "datePhrase": string|null, "time": "HH:MM"|null, "recurrence": string|null}\n` +
  `규칙:\n` +
  `- title: 입력의 핵심만. 단어를 추가하거나 부풀리지 마라.\n` +
  `- datePhrase: 날짜 표현을 아래 표준형 중 하나로 정규화하라(직접 날짜를 계산하지 마라). 없으면 null.\n` +
  `  표준형: "오늘","내일","모레","어제","N일 뒤","이번 주 X요일","다음 주 X요일","X요일",` +
  `"이번 주 주말","다음 주 주말","이번 달 초","이번 달 중순","이번 달 말","다음 달 초","다음 달 중순","다음 달 말","M월 D일"\n` +
  `  예: "담주 화욜"→"다음 주 화요일", "낼"→"내일", "월말"→"이번 달 말", "다음달초"→"다음 달 초"\n` +
  `- time: 시계 시각이 있으면 24시간제 HH:MM. "저녁 7시"→"19:00". 없으면 null.\n` +
  `- recurrence: 반복이면 영어. "매주 수요일"→"every wednesday", "평일"→"every weekday". 없으면 null.`;

async function callOllama(text: string, cfg: LLMConfig): Promise<LLMExtraction | null> {
  try {
    const res = await fetch(`${cfg.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
        // Keep the model resident between quick-adds so a burst of edits stays
        // fast; it frees the RAM after 15 min idle. The first call after idle
        // still pays a cold load, hence the generous timeout.
        keep_alive: '15m',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: text },
        ],
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 90000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    const content = data.message?.content;
    return content ? (JSON.parse(content) as LLMExtraction) : null;
  } catch {
    return null;
  }
}

/** Combine an LLM extraction with deterministic date/tag resolution (pure). */
export function combineLLM(ext: LLMExtraction, text: string, today: string): ParsedNL {
  const tags = [...text.matchAll(/[#@][^\s#@]+/g)].map((m) => m[0]);

  let date: string | undefined;
  if (ext.datePhrase) {
    const resolved = parseNaturalLanguage(ext.datePhrase, today).due;
    if (resolved) date = resolved.includes('T') ? resolved.slice(0, 10) : resolved;
  }

  const time =
    ext.time && /^\d{1,2}:\d{2}$/.test(ext.time)
      ? `${String(Number(ext.time.split(':')[0])).padStart(2, '0')}:${ext.time.split(':')[1]}`
      : undefined;
  if (!date && time) date = today;

  let due: string | undefined;
  let dueHasTime = false;
  if (date && time) {
    due = `${date}T${time}`;
    dueHasTime = true;
  } else if (date) {
    due = date;
  }

  const title = (ext.title ?? '').trim() || text.replace(/[#@][^\s#@]+/g, '').trim();
  const component: Component = time ? 'VEVENT' : 'VTODO';

  const result: ParsedNL = {
    title,
    tags,
    component,
    confident: false, // LLM output is always confirmed via the preview
    warnings: ['제목·날짜가 맞는지 확인하세요'],
  };
  if (due !== undefined) result.due = due;
  if (dueHasTime) result.dueHasTime = true;
  if (ext.recurrence) result.recurrence = ext.recurrence;
  return result;
}

/** LLM-backed parse: call the model, then resolve deterministically. */
export async function llmParse(text: string, today: string, cfg: LLMConfig): Promise<ParsedNL | null> {
  const ext = await callOllama(text, cfg);
  if (!ext) return null;
  return combineLLM(ext, text, today);
}
