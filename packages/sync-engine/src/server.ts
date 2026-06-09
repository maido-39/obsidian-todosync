import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename, dirname, relative } from 'node:path';
import {
  addTask,
  assignMissingIds,
  deleteTask,
  parseDocument,
  parseNaturalLanguage,
  serializeDocument,
  updateTask,
  type ICalOptions,
  type TaskInput,
} from '@todomd/core';
import type { Conflict, TaskBlock } from '@todomd/shared-types';
import { syncBidirectional } from './bidirectional.js';
import type { CalDavConfig } from './caldav.js';
import { commitSnapshot, history } from './gitVersion.js';
import { loadState, saveState } from './state.js';

/**
 * The sync-engine's single-user REST surface (§9.1) on Node's built-in http —
 * no web framework, matching the "use only what we need" philosophy. The `.md`
 * file is the source of truth; every route reads/writes it.
 */
export interface EngineConfig {
  markdownPath: string;
  statePath: string;
  caldav: CalDavConfig;
  calendarPath: string;
  ical?: ICalOptions;
  /** Optional bearer token; when set, all routes except /health require it. */
  token?: string;
  /** Commit the .md (+ state) to git on each change (§5.2). */
  git?: boolean;
}

export function createApp(config: EngineConfig): Server {
  let lastConflicts: Conflict[] = [];

  const readMd = (): string =>
    existsSync(config.markdownPath) ? readFileSync(config.markdownPath, 'utf8') : '';
  const writeMd = (md: string): void => writeFileSync(config.markdownPath, md);

  const repoDir = dirname(config.markdownPath);
  const stateRel = relative(repoDir, config.statePath);
  const commitFiles = stateRel.startsWith('..')
    ? [basename(config.markdownPath)]
    : [basename(config.markdownPath), stateRel];
  const commit = async (message: string): Promise<void> => {
    if (config.git) await commitSnapshot(repoDir, commitFiles, message).catch(() => undefined);
  };
  mkdirSync(repoDir, { recursive: true });

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (method === 'GET' && path === '/health') return sendJson(res, 200, { ok: true });

    if (config.token && req.headers.authorization !== `Bearer ${config.token}`) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    if (method === 'GET' && path === '/status') {
      const tasks = tasksOf(readMd());
      return sendJson(res, 200, {
        tasks: tasks.length,
        done: tasks.filter((t) => t.done).length,
        conflicts: lastConflicts.length,
      });
    }

    if (method === 'GET' && path === '/history') {
      return sendJson(res, 200, { commits: await history(repoDir) });
    }

    if (method === 'POST' && path === '/sync') {
      const result = await syncBidirectional(readMd(), loadState(config.statePath), config.caldav, {
        calendarPath: config.calendarPath,
        ...(config.ical ? { ical: config.ical } : {}),
      });
      writeMd(result.markdown);
      saveState(config.statePath, result.state);
      lastConflicts = result.conflicts;
      await commit('sync');
      return sendJson(res, 200, {
        conflicts: result.conflicts.map(conflictDTO),
        pulled: result.pulled,
        pushed: result.pushed,
      });
    }

    if (method === 'POST' && path === '/parse') {
      const body = (await readBody(req)) as { text?: string; today?: string };
      if (!body?.text) return sendJson(res, 400, { error: 'text is required' });
      const today = body.today ?? new Date().toISOString().slice(0, 10);
      return sendJson(res, 200, { preview: parseNaturalLanguage(body.text, today) });
    }

    if (method === 'GET' && path === '/tasks') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const tasks = tasksOf(readMd()).filter((t) => inRange(t.due, from, to));
      return sendJson(res, 200, { tasks: tasks.map(taskDTO) });
    }

    if (method === 'POST' && path === '/tasks') {
      const body = (await readBody(req)) as TaskInput;
      if (!body?.title) return sendJson(res, 400, { error: 'title is required' });
      const base = assignMissingIds(parseDocument(readMd())).doc;
      const { doc } = addTask(base, body);
      const { doc: withId, assigned } = assignMissingIds(doc);
      writeMd(serializeDocument(withId));
      await commit('add task');
      const created = withId.blocks.find((b) => b.kind === 'task' && b.id === assigned[0]);
      return sendJson(res, 201, { task: created ? taskDTO(created as TaskBlock) : null });
    }

    const taskId = matchParam(path, /^\/tasks\/([^/]+)$/);
    if (method === 'PATCH' && taskId) {
      const patch = (await readBody(req)) as Partial<TaskInput>;
      const doc = updateTask(parseDocument(readMd()), taskId, patch);
      if (!doc) return sendJson(res, 404, { error: 'task not found' });
      writeMd(serializeDocument(doc));
      await commit('edit task');
      const task = doc.blocks.find((b) => b.kind === 'task' && b.id === taskId);
      return sendJson(res, 200, { task: task ? taskDTO(task as TaskBlock) : null });
    }
    if (method === 'DELETE' && taskId) {
      const doc = deleteTask(parseDocument(readMd()), taskId);
      if (!doc) return sendJson(res, 404, { error: 'task not found' });
      writeMd(serializeDocument(doc));
      await commit('delete task');
      return sendJson(res, 200, { deleted: taskId });
    }

    if (method === 'GET' && path === '/conflicts') {
      return sendJson(res, 200, { conflicts: lastConflicts.map(conflictDTO) });
    }

    const resolveId = matchParam(path, /^\/conflicts\/([^/]+)\/resolve$/);
    if (method === 'POST' && resolveId) {
      const { choice } = (await readBody(req)) as { choice?: 'local' | 'remote' };
      const conflict = lastConflicts.find((c) => c.key === resolveId);
      if (!conflict) return sendJson(res, 404, { error: 'conflict not found' });
      if (choice === 'remote' && conflict.remote?.kind === 'task') {
        const doc = updateTask(parseDocument(readMd()), resolveId, patchFromTask(conflict.remote));
        if (doc) writeMd(serializeDocument(doc));
      }
      await commit('resolve conflict');
      lastConflicts = lastConflicts.filter((c) => c.key !== resolveId);
      return sendJson(res, 200, { resolved: resolveId, choice: choice ?? 'local' });
    }

    return sendJson(res, 404, { error: 'not found' });
  };

  return createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });
}

// --- helpers ---------------------------------------------------------------

const tasksOf = (md: string): TaskBlock[] =>
  parseDocument(md).blocks.filter((b): b is TaskBlock => b.kind === 'task');

function taskDTO(t: TaskBlock): Record<string, unknown> {
  return {
    id: t.id ?? null,
    title: t.title,
    done: t.done,
    component: t.component,
    due: t.due ?? null,
    scheduled: t.scheduled ?? null,
    start: t.start ?? null,
    completedAt: t.completedAt ?? null,
    priority: t.priority,
    tags: t.tags,
    recurrence: t.recurrence?.raw ?? null,
    section: t.section,
    notes: t.notes ?? null,
  };
}

function conflictDTO(c: Conflict): Record<string, unknown> {
  return {
    key: c.key,
    reason: c.reason,
    local: c.local?.kind === 'task' ? taskDTO(c.local) : null,
    remote: c.remote?.kind === 'task' ? taskDTO(c.remote) : null,
  };
}

function patchFromTask(t: TaskBlock): Partial<TaskInput> {
  const patch: Partial<TaskInput> = {
    title: t.title,
    done: t.done,
    priority: t.priority,
    tags: t.tags,
    component: t.component,
  };
  if (t.due !== undefined) {
    patch.due = t.due;
    patch.dueHasTime = t.dueHasTime ?? false;
  }
  if (t.scheduled !== undefined) patch.scheduled = t.scheduled;
  if (t.start !== undefined) patch.start = t.start;
  if (t.notes !== undefined) patch.notes = t.notes;
  if (t.recurrence !== undefined) patch.recurrence = t.recurrence.raw;
  return patch;
}

function inRange(due: string | undefined, from: string | null, to: string | null): boolean {
  if (!from && !to) return true;
  if (!due) return false;
  const d = due.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function matchParam(path: string, re: RegExp): string | null {
  const m = re.exec(path);
  return m ? decodeURIComponent(m[1] ?? '') : null;
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.length > 0 ? JSON.parse(raw) : {};
}
