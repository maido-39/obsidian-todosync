import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename, dirname, relative } from 'node:path';
import {
  addTask,
  assignMissingIds,
  deleteTask,
  parseDocument,
  parseNaturalLanguage,
  parseTaskLine,
  serializeDocument,
  updateTask,
  type ICalOptions,
  type TaskInput,
} from '@todomd/core';
import type { Conflict, TaskBlock } from '@todomd/shared-types';
import { syncBidirectional } from './bidirectional.js';
import type { CalDavConfig } from './caldav.js';
import { commitSnapshot, history } from './gitVersion.js';
import { llmParse, type LLMConfig } from './llm.js';
import { loadState, saveState } from './state.js';

/**
 * Date/time hint vocabulary the LLM fallback watches for. When the rule parser
 * extracts no anchor (no due/recurrence) but the text matches one of these, the
 * text likely carries a date the rules couldn't parse (colloquial/typo forms),
 * so we let the LLM try. Deliberately omits bare 초/말/달 (false positives like
 * 초안/말일/달력) — those only count in compound forms like 월말/다음 달.
 */
const DATE_HINT =
  /(내일|모레|글피|어제|낼|담주|담달|다다음|다음\s*주|다음\s*달|이번\s*주|이번\s*달|주말|[월화수목금토일]요일|[월화수목금토일]욜|월말|월초|말일|매일|매주|매월|평일|격주|오전|오후|새벽|아침|점심|저녁|밤|정오|자정|\d+\s*시|\d+\s*[일주달]\s*(?:뒤|후)|\d+\s*개월)/;

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
  /** Local-LLM fallback for /parse when the rule parser is not confident (§3.5). */
  llm?: LLMConfig;
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
      // Rules first (fast, offline). Fall back to the local LLM (§3.5) when the
      // rule parser is ambiguous, OR when it found no anchor at all yet the text
      // clearly mentions a date/time it failed to parse (colloquial/typo forms
      // like "담주 화욜", "월말"). Only adopt the LLM result if it actually adds
      // an anchor (or rules were unsure) — never degrade a confident plain task.
      const ruleResult = parseNaturalLanguage(body.text, today);
      let preview = ruleResult;
      const noAnchor = !ruleResult.due && !ruleResult.recurrence;
      if (config.llm && (!ruleResult.confident || (noAnchor && DATE_HINT.test(body.text)))) {
        const llmResult = await llmParse(body.text, today, config.llm);
        if (llmResult && (llmResult.due || llmResult.recurrence || !ruleResult.confident)) {
          preview = llmResult;
        }
      }
      return sendJson(res, 200, { preview, engine: preview === ruleResult ? 'rules' : 'llm' });
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

    // Bulk upsert of dated tasks scanned from an Obsidian vault. Each task is
    // keyed by its `^id` (the plugin stamps every note line), so this is
    // idempotent: known id → update in place, new id → add under its date
    // heading (adopting the vault's id). One-way for now: it never deletes, so
    // a task removed from a note leaves its calendar event untouched. Run /sync
    // afterwards to push to CalDAV.
    if (method === 'POST' && path === '/vault/sync') {
      const body = (await readBody(req)) as {
        tasks?: { id?: string; raw?: string; note?: string }[];
      };
      const incoming = Array.isArray(body?.tasks) ? body.tasks : [];
      let doc = assignMissingIds(parseDocument(readMd())).doc;
      const ids = new Set<string>();
      for (const b of doc.blocks) if (b.kind === 'task' && b.id) ids.add(b.id);
      let added = 0;
      let updated = 0;
      let skipped = 0;
      for (const vt of incoming) {
        const input = vt.raw ? vaultLineToInput(vt.raw) : null;
        if (!input || !vt.id) {
          skipped += 1;
          continue;
        }
        if (ids.has(vt.id)) {
          const next = updateTask(doc, vt.id, input);
          if (next) {
            doc = next;
            updated += 1;
          } else skipped += 1;
        } else {
          const { doc: withTask, block } = addTask(doc, input);
          block.id = vt.id; // adopt the vault's ^id as the stable cross-surface key
          ids.add(vt.id);
          doc = withTask;
          added += 1;
        }
      }
      writeMd(serializeDocument(doc));
      await commit('vault sync');
      return sendJson(res, 200, { added, updated, skipped });
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

/**
 * Parse one raw vault task line (`- [ ] title 📅 … ^id`) into a TaskInput, using
 * the same tokenizer as the document parser so the format is identical. Returns
 * null for non-task lines and for tasks with no date (only dated tasks become
 * calendar entries). The task is filed under its date heading (due ▸ scheduled ▸
 * start) to match the engine's section grouping.
 */
export function vaultLineToInput(raw: string): TaskInput | null {
  const m = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(raw);
  if (!m) return null;
  const parsed = parseTaskLine((m[2] ?? '').trim());
  const date = parsed.due ?? parsed.scheduled ?? parsed.start;
  if (!date) return null;
  const input: TaskInput = {
    title: parsed.title,
    done: (m[1] ?? ' ') !== ' ',
    section: date.slice(0, 10),
    tags: parsed.tags,
    priority: parsed.priority,
  };
  if (parsed.due !== undefined) {
    input.due = parsed.due;
    input.dueHasTime = parsed.dueHasTime ?? false;
  }
  if (parsed.scheduled !== undefined) input.scheduled = parsed.scheduled;
  if (parsed.start !== undefined) input.start = parsed.start;
  if (parsed.recurrence?.raw) input.recurrence = parsed.recurrence.raw;
  return input;
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
