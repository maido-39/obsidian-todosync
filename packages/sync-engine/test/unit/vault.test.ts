import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, vaultLineToInput } from '@todomd/sync-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('vaultLineToInput', () => {
  it('parses a dated task line into a TaskInput filed under its date heading', () => {
    const input = vaultLineToInput('- [ ] 치과 예약 📅 2026-06-20 14:00 ^a1b2c3');
    expect(input).not.toBeNull();
    expect(input?.title).toBe('치과 예약');
    expect(input?.due).toBe('2026-06-20T14:00');
    expect(input?.dueHasTime).toBe(true);
    expect(input?.section).toBe('2026-06-20');
    expect(input?.done).toBe(false);
  });

  it('captures done state, recurrence and tags', () => {
    const input = vaultLineToInput('- [x] 월세 📅 2026-07-01 🔁 every month #돈 ^zzz999');
    expect(input?.done).toBe(true);
    expect(input?.recurrence).toBe('every month');
    expect(input?.tags).toContain('#돈');
  });

  it('files a scheduled-only task under its scheduled date', () => {
    const input = vaultLineToInput('- [ ] 보고서 초안 ⏳ 2026-06-18 ^sched1');
    expect(input?.scheduled).toBe('2026-06-18');
    expect(input?.section).toBe('2026-06-18');
    expect(input?.due).toBeUndefined();
  });

  it('returns null for a task with no date', () => {
    expect(vaultLineToInput('- [ ] 그냥 할일 #메모 ^nodate')).toBeNull();
  });

  it('returns null for a non-task line', () => {
    expect(vaultLineToInput('이건 그냥 문장 📅 2026-06-20')).toBeNull();
  });

  it('tolerates leading indentation (sub-tasks)', () => {
    const input = vaultLineToInput('    - [ ] 들여쓴 일정 📅 2026-06-21 ^ind001');
    expect(input?.title).toBe('들여쓴 일정');
    expect(input?.section).toBe('2026-06-21');
  });
});

describe('POST /vault/sync', () => {
  let dir: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'todomd-vault-'));
    writeFileSync(join(dir, 'todo.md'), '');
    server = createApp({
      markdownPath: join(dir, 'todo.md'),
      statePath: join(dir, 'state.json'),
      caldav: { baseUrl: 'http://localhost:1' },
      calendarPath: '/user/calendars/test/',
    });
    base = await new Promise<string>((r) =>
      server.listen(0, () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
    );
  });
  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const post = (path: string, body: unknown) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('adds new dated tasks under date headings, adopting their ^id', async () => {
    const res = await post('/vault/sync', {
      tasks: [
        { id: 'aaa111', raw: '- [ ] 치과 📅 2026-06-20 14:00 ^aaa111', note: 'Daily/2026-06-10.md' },
        { id: 'bbb222', raw: '- [ ] 회의 📅 2026-06-21 ^bbb222', note: 'Work.md' },
        { id: 'ccc333', raw: '- [ ] 날짜없음 ^ccc333', note: 'Work.md' },
      ],
    });
    const json = (await res.json()) as { added: number; updated: number; skipped: number };
    expect(json.added).toBe(2);
    expect(json.skipped).toBe(1);

    const md = readFileSync(join(dir, 'todo.md'), 'utf8');
    expect(md).toContain('## 2026-06-20');
    expect(md).toContain('치과');
    expect(md).toContain('^aaa111');
    expect(md).toContain('^bbb222');
    expect(md).not.toContain('날짜없음');
  });

  it('is idempotent — re-syncing updates in place, never duplicating an id', async () => {
    const res = await post('/vault/sync', {
      tasks: [
        {
          id: 'aaa111',
          raw: '- [x] 치과 완료 📅 2026-06-20 14:00 ^aaa111',
          note: 'Daily/2026-06-10.md',
        },
      ],
    });
    const json = (await res.json()) as { added: number; updated: number };
    expect(json.added).toBe(0);
    expect(json.updated).toBe(1);

    const md = readFileSync(join(dir, 'todo.md'), 'utf8');
    expect(md.match(/\^aaa111/g)?.length).toBe(1);
    expect(md).toContain('- [x] 치과 완료');
  });
});
