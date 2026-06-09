import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '@todomd/sync-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

describe('REST API — CRUD', () => {
  let dir: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'todomd-api-'));
    writeFileSync(join(dir, 'todo.md'), '## 2026-06-10\n\n- [ ] seed task ^seed01\n');
    server = createApp({
      markdownPath: join(dir, 'todo.md'),
      statePath: join(dir, 'state.json'),
      caldav: { baseUrl: 'http://localhost:1' },
      calendarPath: '/user/calendars/test/',
    });
    base = await listen(server);
  });
  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const api = async (path: string, init?: RequestInit) => {
    const r = await fetch(base + path, init);
    return { status: r.status, body: (await r.json()) as Json };
  };
  const send = (method: string, path: string, data: unknown) =>
    api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

  it('GET /health', async () => {
    expect((await api('/health')).body.ok).toBe(true);
  });

  it('GET /status counts tasks', async () => {
    expect((await api('/status')).body.tasks).toBe(1);
  });

  it('GET /tasks lists the seed task', async () => {
    const r = await api('/tasks');
    expect(r.body.tasks).toHaveLength(1);
    expect(r.body.tasks[0].id).toBe('seed01');
  });

  it('POST /tasks creates a VEVENT task with an id', async () => {
    const r = await send('POST', '/tasks', {
      title: 'meeting',
      section: '2026-06-10',
      due: '2026-06-10',
      tags: ['#event'],
    });
    expect(r.status).toBe(201);
    expect(r.body.task.title).toBe('meeting');
    expect(r.body.task.id).toMatch(/^[0-9a-z]{6}$/);
    expect(r.body.task.component).toBe('VEVENT');
  });

  it('PATCH /tasks/:id updates fields', async () => {
    const r = await send('PATCH', '/tasks/seed01', { done: true, title: 'seed done' });
    expect(r.status).toBe(200);
    expect(r.body.task.done).toBe(true);
    expect(r.body.task.title).toBe('seed done');
  });

  it('PATCH unknown id → 404', async () => {
    expect((await send('PATCH', '/tasks/zzz999', { title: 'x' })).status).toBe(404);
  });

  it('GET /tasks?from&to filters by due date', async () => {
    const r = await api('/tasks?from=2026-06-10&to=2026-06-10');
    const ids = r.body.tasks.map((t: Json) => t.id);
    expect(ids).not.toContain('seed01');
    expect(r.body.tasks.some((t: Json) => t.due === '2026-06-10')).toBe(true);
  });

  it('POST /parse previews natural language without saving', async () => {
    const r = await send('POST', '/parse', { text: '내일 오후 3시 회의 #업무', today: '2026-06-09' });
    expect(r.status).toBe(200);
    expect(r.body.preview.title).toBe('회의');
    expect(r.body.preview.due).toBe('2026-06-10T15:00');
    expect(r.body.preview.tags).toEqual(['#업무']);
    expect(r.body.preview.component).toBe('VEVENT');
  });

  it('DELETE /tasks/:id removes a task', async () => {
    expect((await api('/tasks/seed01', { method: 'DELETE' })).status).toBe(200);
    const tasks = (await api('/tasks')).body.tasks;
    expect(tasks.find((t: Json) => t.id === 'seed01')).toBeUndefined();
  });

  it('DELETE unknown id → 404', async () => {
    expect((await api('/tasks/zzz999', { method: 'DELETE' })).status).toBe(404);
  });
});

describe('REST API — auth', () => {
  let dir: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'todomd-auth-'));
    writeFileSync(join(dir, 'todo.md'), '');
    server = createApp({
      markdownPath: join(dir, 'todo.md'),
      statePath: join(dir, 'state.json'),
      caldav: { baseUrl: 'http://localhost:1' },
      calendarPath: '/c/',
      token: 'secret',
    });
    base = await listen(server);
  });
  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects an unauthenticated request but allows /health', async () => {
    expect((await fetch(`${base}/status`)).status).toBe(401);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it('allows a request with the bearer token', async () => {
    const r = await fetch(`${base}/status`, { headers: { Authorization: 'Bearer secret' } });
    expect(r.status).toBe(200);
  });
});

describe('REST API — git versioning', () => {
  let dir: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'todomd-apigit-'));
    writeFileSync(join(dir, 'todo.md'), '');
    server = createApp({
      markdownPath: join(dir, 'todo.md'),
      statePath: join(dir, '.todomd', 'state.json'),
      caldav: { baseUrl: 'http://localhost:1' },
      calendarPath: '/c/',
      git: true,
    });
    base = await listen(server);
  });
  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('commits on task add and exposes /history', async () => {
    await fetch(`${base}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'first task', section: '2026-06-10' }),
    });
    const h = (await (await fetch(`${base}/history`)).json()) as Json;
    expect(h.commits.length).toBeGreaterThanOrEqual(1);
    expect(h.commits[0].message).toContain('add');
  });
});
