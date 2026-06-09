import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('GET /status', async () => {
    const fn = mockFetch(200, { tasks: 2, done: 1, conflicts: 0 });
    expect((await api.status()).tasks).toBe(2);
    expect(fn).toHaveBeenCalledWith('/api/status', undefined);
  });

  it('POST /tasks sends a JSON body', async () => {
    const fn = mockFetch(201, { task: { id: 'x', title: 't' } });
    await api.addTask({ title: 't', due: '2026-06-10' });
    expect(fn).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({ method: 'POST' }));
    const init = fn.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ title: 't', due: '2026-06-10' });
  });

  it('builds query params for a task range', async () => {
    const fn = mockFetch(200, { tasks: [] });
    await api.tasks({ from: '2026-06-01', to: '2026-06-30' });
    expect(fn).toHaveBeenCalledWith('/api/tasks?from=2026-06-01&to=2026-06-30', undefined);
  });

  it('PATCH /tasks/:id', async () => {
    const fn = mockFetch(200, { task: {} });
    await api.updateTask('abc123', { done: true });
    expect(fn).toHaveBeenCalledWith('/api/tasks/abc123', expect.objectContaining({ method: 'PATCH' }));
  });

  it('DELETE /tasks/:id', async () => {
    const fn = mockFetch(200, { deleted: 'abc' });
    await api.deleteTask('abc');
    expect(fn).toHaveBeenCalledWith('/api/tasks/abc', expect.objectContaining({ method: 'DELETE' }));
  });

  it('POST /parse', async () => {
    const fn = mockFetch(200, {
      preview: { title: '회의', confident: true, tags: [], component: 'VEVENT', warnings: [] },
    });
    expect((await api.parse('내일 3시 회의')).preview.title).toBe('회의');
    expect(fn).toHaveBeenCalledWith('/api/parse', expect.objectContaining({ method: 'POST' }));
  });

  it('throws on a non-2xx response', async () => {
    mockFetch(500, { error: 'boom' });
    await expect(api.status()).rejects.toThrow(/500/);
  });
});
