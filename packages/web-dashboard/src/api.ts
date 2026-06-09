// Typed client for the sync-engine REST API (§9.1). All requests go to the
// same-origin `/api` prefix, which Vite proxies to the engine in dev.

export interface TaskDTO {
  id: string | null;
  title: string;
  done: boolean;
  component: 'VEVENT' | 'VTODO';
  due: string | null;
  scheduled: string | null;
  start: string | null;
  completedAt: string | null;
  priority: string | null;
  tags: string[];
  recurrence: string | null;
  section: string | null;
  notes: string | null;
}

export interface StatusDTO {
  tasks: number;
  done: number;
  conflicts: number;
}

export interface ConflictDTO {
  key: string;
  reason: string;
  local: TaskDTO | null;
  remote: TaskDTO | null;
}

export interface SyncResultDTO {
  conflicts: ConflictDTO[];
  pulled: { changed: number; removed: number };
  pushed: { created: string[]; updated: string[]; deleted: string[] };
}

export interface NewTask {
  title: string;
  section?: string;
  due?: string;
  dueHasTime?: boolean;
  tags?: string[];
  component?: 'VEVENT' | 'VTODO';
  priority?: string | null;
  recurrence?: string;
}

export interface ParsePreview {
  title: string;
  due?: string;
  dueHasTime?: boolean;
  recurrence?: string;
  tags: string[];
  component: 'VEVENT' | 'VTODO';
  confident: boolean;
  warnings: string[];
}

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`);
  }
  return (await res.json()) as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  status: () => request<StatusDTO>('/status'),
  tasks: (range?: { from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (range?.from) q.set('from', range.from);
    if (range?.to) q.set('to', range.to);
    const qs = q.toString();
    return request<{ tasks: TaskDTO[] }>(`/tasks${qs ? `?${qs}` : ''}`);
  },
  parse: (text: string) => request<{ preview: ParsePreview }>('/parse', jsonInit('POST', { text })),
  addTask: (input: NewTask) => request<{ task: TaskDTO }>('/tasks', jsonInit('POST', input)),
  updateTask: (id: string, patch: Partial<NewTask> & { done?: boolean }) =>
    request<{ task: TaskDTO }>(`/tasks/${encodeURIComponent(id)}`, jsonInit('PATCH', patch)),
  deleteTask: (id: string) =>
    request<{ deleted: string }>(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  sync: () => request<SyncResultDTO>('/sync', { method: 'POST' }),
  conflicts: () => request<{ conflicts: ConflictDTO[] }>('/conflicts'),
  resolve: (key: string, choice: 'local' | 'remote') =>
    request<{ resolved: string; choice: string }>(
      `/conflicts/${encodeURIComponent(key)}/resolve`,
      jsonInit('POST', { choice }),
    ),
};
