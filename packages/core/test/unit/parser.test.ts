import type { DetailBlock, MemoBlock, TaskBlock } from '@todomd/shared-types';
import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from '@todomd/core';

// The canonical §3.1 example (frontmatter + hybrid block body).
const DOC = `---
todomd_version: 1
timezone: Asia/Seoul
default_calendar: personal
section_strategy: date
---

## 2026-06-10

- [ ] 보고서 제출 📅 2026-06-10 14:00 ⏫ #event @회사 ^a1b2c3
    - 1차 초안 기준으로 제출. 검토자 김OO.
- [ ] 헬스장 🔁 every weekday 🛫 2026-06-10 ^d4e5f6

> 오늘 회고: 오전 집중이 잘 됐다. 내일은 회의부터.   ^memo7

## 2026-06-11

- [ ] 장보기 📅 2026-06-11 ^g7h8i9

프로젝트 A 관련 참고 링크와 결정 사항 정리 (일정 아님, 상세 블록).
- 결정1: 디자인은 B안
- 결정2: 마감 6/20
`;

describe('parseDocument — §3.1 example', () => {
  const doc = parseDocument(DOC);

  it('reads frontmatter', () => {
    expect(doc.frontmatter.timezone).toBe('Asia/Seoul');
    expect(doc.frontmatter.section_strategy).toBe('date');
  });

  it('splits two date sections', () => {
    expect(doc.sections.map((s) => s.title)).toEqual(['2026-06-10', '2026-06-11']);
    expect(doc.sections.every((s) => s.kind === 'date')).toBe(true);
  });

  it('produces five blocks of the expected kinds', () => {
    expect(doc.blocks.map((b) => b.kind)).toEqual(['task', 'task', 'memo', 'task', 'detail']);
  });

  it('parses the timed event task (block 0)', () => {
    const b = doc.blocks[0] as TaskBlock;
    expect(b.title).toBe('보고서 제출');
    expect(b.due).toBe('2026-06-10T14:00');
    expect(b.dueHasTime).toBe(true);
    expect(b.priority).toBe('high');
    expect(b.tags).toEqual(['#event', '@회사']);
    expect(b.id).toBe('a1b2c3');
    expect(b.component).toBe('VEVENT');
    expect(b.section).toBe('2026-06-10');
    expect(b.notes).toContain('1차 초안');
  });

  it('parses the recurring task (block 1)', () => {
    const b = doc.blocks[1] as TaskBlock;
    expect(b.title).toBe('헬스장');
    expect(b.recurrence?.raw).toBe('every weekday');
    expect(b.start).toBe('2026-06-10');
    expect(b.id).toBe('d4e5f6');
  });

  it('parses the blockquote memo (block 2)', () => {
    const b = doc.blocks[2] as MemoBlock;
    expect(b.kind).toBe('memo');
    expect(b.id).toBe('memo7');
    expect(b.text).toBe('오늘 회고: 오전 집중이 잘 됐다. 내일은 회의부터.');
    expect(b.section).toBe('2026-06-10');
  });

  it('parses the pure todo (block 3) as VTODO', () => {
    const b = doc.blocks[3] as TaskBlock;
    expect(b.title).toBe('장보기');
    expect(b.due).toBe('2026-06-11');
    expect(b.component).toBe('VTODO');
    expect(b.section).toBe('2026-06-11');
  });

  it('groups paragraph + list into one detail block (block 4)', () => {
    const b = doc.blocks[4] as DetailBlock;
    expect(b.kind).toBe('detail');
    expect(b.text.startsWith('프로젝트 A')).toBe(true);
    expect(b.text).toContain('- 결정1: 디자인은 B안');
    expect(b.id).toBeUndefined();
  });

  it('round-trips byte-for-byte', () => {
    expect(serializeDocument(doc)).toBe(DOC);
  });
});
