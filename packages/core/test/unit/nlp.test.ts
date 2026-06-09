import { parseNaturalLanguage } from '@todomd/core';
import { describe, expect, it } from 'vitest';

const TODAY = '2026-06-09'; // a Tuesday

describe('parseNaturalLanguage (Korean)', () => {
  it('내일 오후 3시 보고서 제출 #회사', () => {
    const r = parseNaturalLanguage('내일 오후 3시 보고서 제출 #회사', TODAY);
    expect(r.title).toBe('보고서 제출');
    expect(r.due).toBe('2026-06-10T15:00');
    expect(r.dueHasTime).toBe(true);
    expect(r.tags).toEqual(['#회사']);
    expect(r.component).toBe('VEVENT');
    expect(r.confident).toBe(true);
  });

  it('매주 월요일 9시 팀미팅 (anchors to next Monday)', () => {
    const r = parseNaturalLanguage('매주 월요일 9시 팀미팅', TODAY);
    expect(r.title).toBe('팀미팅');
    expect(r.recurrence).toBe('every monday');
    expect(r.due).toBe('2026-06-15T09:00');
    expect(r.component).toBe('VEVENT');
    expect(r.confident).toBe(false); // bare "9시" is am/pm-ambiguous
  });

  it('다음주 화요일 회의', () => {
    const r = parseNaturalLanguage('다음주 화요일 회의', TODAY);
    expect(r.title).toBe('회의');
    expect(r.due).toBe('2026-06-16');
    expect(r.dueHasTime).toBeUndefined();
    expect(r.component).toBe('VTODO');
  });

  it('이번주 금요일 점심', () => {
    expect(parseNaturalLanguage('이번주 금요일 점심', TODAY).due).toBe('2026-06-12');
  });

  it('매일 운동', () => {
    const r = parseNaturalLanguage('매일 운동', TODAY);
    expect(r.title).toBe('운동');
    expect(r.recurrence).toBe('every day');
    expect(r.due).toBeUndefined();
  });

  it('오늘 오전 10시 30분 치과', () => {
    const r = parseNaturalLanguage('오늘 오전 10시 30분 치과', TODAY);
    expect(r.title).toBe('치과');
    expect(r.due).toBe('2026-06-09T10:30');
    expect(r.dueHasTime).toBe(true);
  });

  it('6월 20일 마감', () => {
    const r = parseNaturalLanguage('6월 20일 마감', TODAY);
    expect(r.title).toBe('마감');
    expect(r.due).toBe('2026-06-20');
    expect(r.component).toBe('VTODO');
  });

  it('평일 아침 스트레칭', () => {
    const r = parseNaturalLanguage('평일 아침 스트레칭', TODAY);
    expect(r.recurrence).toBe('every weekday');
    expect(r.title).toBe('아침 스트레칭');
  });

  it('매월 15일 → BYMONTHDAY; 3일 후 → relative', () => {
    expect(parseNaturalLanguage('매월 15일 월세 내기', TODAY).recurrence).toBe(
      'every month on the 15th',
    );
    expect(parseNaturalLanguage('3일 후 약속', TODAY).due).toBe('2026-06-12');
  });

  it('flags low confidence on a bare time with no title', () => {
    expect(parseNaturalLanguage('3시', TODAY).confident).toBe(false);
  });

  it('이번 주 주말 → this Saturday', () => {
    const r = parseNaturalLanguage('이번 주 주말 HP 프로젝트', TODAY);
    expect(r.title).toBe('HP 프로젝트');
    expect(r.due).toBe('2026-06-13');
    expect(r.component).toBe('VTODO');
  });

  it('다음 주 주말 → next Saturday', () => {
    expect(parseNaturalLanguage('다음 주 주말 등산', TODAY).due).toBe('2026-06-20');
  });

  it('다음 달 초/말 → first/last day of next month', () => {
    expect(parseNaturalLanguage('다음 달 초 세금 신고', TODAY).due).toBe('2026-07-01');
    expect(parseNaturalLanguage('다음 달 말 정산', TODAY).due).toBe('2026-07-31');
  });

  it('strips trailing particles (금요일까지 → 보고서)', () => {
    const r = parseNaturalLanguage('금요일까지 보고서', TODAY);
    expect(r.title).toBe('보고서');
    expect(r.due).toBe('2026-06-12');
  });

  it('저녁 7시 → 19:00 (PM)', () => {
    const r = parseNaturalLanguage('내일 저녁 7시 약속', TODAY);
    expect(r.due).toBe('2026-06-10T19:00');
    expect(r.title).toBe('약속');
    expect(r.component).toBe('VEVENT');
  });
});
