import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '@todomd/sync-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseUrl = process.env.XANDIKOS_URL;

describe.skipIf(!baseUrl)('REST /sync against Xandikos', () => {
  let dir: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'todomd-apisync-'));
    writeFileSync(join(dir, 'todo.md'), '## 2026-06-10\n\n- [ ] api meeting 📅 2026-06-10 #event ^apiaaa\n');
    server = createApp({
      markdownPath: join(dir, 'todo.md'),
      statePath: join(dir, 'state.json'),
      caldav: { baseUrl: baseUrl ?? '' },
      calendarPath: `/user/calendars/api-${Date.now()}/`,
      ical: { timezone: 'Asia/Seoul' },
    });
    base = await new Promise<string>((resolve) => {
      server.listen(0, () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
    });
  });
  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('POST /sync pushes tasks to the calendar', async () => {
    const r = await fetch(`${base}/sync`, { method: 'POST' });
    const body = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(body.pushed.created).toContain('apiaaa');
    expect(body.conflicts).toEqual([]);
  });

  it('GET /status reflects the synced task', async () => {
    const r = await fetch(`${base}/status`);
    expect(((await r.json()) as any).tasks).toBe(1);
  });
});
