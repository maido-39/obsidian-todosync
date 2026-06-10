import { combineLLM } from '@todomd/sync-engine';
import { describe, expect, it } from 'vitest';

const TODAY = '2026-06-09'; // a Tuesday

describe('combineLLM (LLM extraction → deterministic resolution)', () => {
  it('resolves a normalized date phrase via the rule resolver (not the LLM)', () => {
    const r = combineLLM(
      { title: '세금 신고', datePhrase: '다음 달 초', time: null, recurrence: null },
      '다음달초 세금 신고',
      TODAY,
    );
    expect(r.title).toBe('세금 신고');
    expect(r.due).toBe('2026-07-01');
    expect(r.component).toBe('VTODO');
    expect(r.confident).toBe(false); // LLM results are always confirmed in the UI
  });

  it('combines a normalized weekday phrase + time into a VEVENT', () => {
    const r = combineLLM(
      { title: '영화 보기', datePhrase: '다음 주 화요일', time: '19:00', recurrence: null },
      '담주 화욜 저녁 7시 영화 보기',
      TODAY,
    );
    expect(r.due).toBe('2026-06-16T19:00');
    expect(r.dueHasTime).toBe(true);
    expect(r.component).toBe('VEVENT');
  });

  it('extracts tags from the ORIGINAL text — never from the LLM (no hallucination)', () => {
    const r = combineLLM(
      { title: '약속', datePhrase: '내일', time: '19:00', recurrence: null },
      '내일 저녁 7시 약속 #회사 @지민',
      TODAY,
    );
    expect(r.tags).toEqual(['#회사', '@지민']);
    expect(r.due).toBe('2026-06-10T19:00');
  });

  it('zero-pads a single-digit hour from the model', () => {
    const r = combineLLM(
      { title: '치과', datePhrase: '오늘', time: '9:30', recurrence: null },
      '오늘 9시 30분 치과',
      TODAY,
    );
    expect(r.due).toBe('2026-06-09T09:30');
  });

  it('anchors a time-only task to today', () => {
    const r = combineLLM(
      { title: '스탠드업', datePhrase: null, time: '10:00', recurrence: null },
      '10시 스탠드업',
      TODAY,
    );
    expect(r.due).toBe('2026-06-09T10:00');
    expect(r.component).toBe('VEVENT');
  });

  it('passes recurrence through and strips tags from a fallback title', () => {
    const r = combineLLM(
      { title: '', datePhrase: null, time: null, recurrence: 'every weekday' },
      '평일 #건강',
      TODAY,
    );
    expect(r.recurrence).toBe('every weekday');
    expect(r.title).toBe('평일');
    expect(r.tags).toEqual(['#건강']);
  });

  it('ignores a malformed time and yields a date-only VTODO', () => {
    const r = combineLLM(
      { title: '정산 마무리', datePhrase: '이번 달 말', time: 'noon', recurrence: null },
      '월말까지 정산 마무리',
      TODAY,
    );
    expect(r.due).toBe('2026-06-30');
    expect(r.dueHasTime).toBeUndefined();
    expect(r.component).toBe('VTODO');
  });
});
