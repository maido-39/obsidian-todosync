import {
  contentHash,
  defaultIdGen,
  mergeBlocks,
  parseDocument,
  rebuildDocument,
  serializeDocument,
  serializeTaskLine,
  taskToICal,
  type ICalOptions,
  type ResolvedUnit,
} from '@todomd/core';
import type { Block, Conflict, TaskBlock, TodoDocument, UnitRef } from '@todomd/shared-types';
import {
  type CalDavConfig,
  deleteResource,
  ensureCalendar,
  getResource,
  putResource,
  syncCollection,
} from './caldav.js';
import { parseICalTask, type ParsedICalTask } from './icalParse.js';
import type { MappingEntry, MappingState } from './state.js';

export interface SyncOptions {
  calendarPath: string;
  ical?: ICalOptions;
  idGen?: () => string;
}

export interface SyncResult {
  /** Merged markdown to write back to disk. */
  markdown: string;
  state: MappingState;
  conflicts: Conflict[];
  pulled: { changed: number; removed: number };
  pushed: { created: string[]; updated: string[]; deleted: string[] };
}

const isTask = (b: Block): b is TaskBlock => b.kind === 'task';
const keyOf = (b: Block): string => b.id ?? `hash:${b.contentHash}`;

/**
 * Full bidirectional sync cycle (§5.3). Pulls server changes since the last
 * sync-token, reverse-maps them, runs a block-level 3-way merge against the base
 * snapshot, reassembles the merged markdown (unchanged blocks verbatim, only
 * remote-changed blocks re-rendered), then pushes local-originated changes back.
 * Divergent edits are returned as `conflicts` with the local side kept.
 */
export async function syncBidirectional(
  localMarkdown: string,
  state: MappingState,
  cfg: CalDavConfig,
  opts: SyncOptions,
): Promise<SyncResult> {
  await ensureCalendar(cfg, opts.calendarPath);
  const calendarPath = opts.calendarPath.endsWith('/') ? opts.calendarPath : `${opts.calendarPath}/`;
  const host = opts.ical?.host ?? 'todomd.local';

  // 1) Pull remote changes since the last token. Resolve each resource to a
  //    block id: a `todomd-…` UID maps to that id; a previously-imported href
  //    maps to its existing id; anything else is a foreign event (created
  //    directly in the calendar) and gets a fresh id so it imports as a task.
  const pull = await syncCollection(cfg, opts.calendarPath, state.syncToken);
  const hrefToId = new Map<string, string>();
  for (const [id, mapEntry] of Object.entries(state.blocks)) hrefToId.set(mapEntry.href, id);
  const usedIds = new Set(Object.keys(state.blocks));
  const gen = opts.idGen ?? defaultIdGen;

  const remoteByBlockId = new Map<string, ParsedICalTask>();
  const pulledMeta = new Map<string, { href: string; etag: string; uid: string }>();
  for (const res of pull.changed) {
    const ics = await getResource(cfg, res.href);
    if (!ics) continue;
    const parsed = parseICalTask(ics);
    if (!parsed) continue;
    let blockId = parsed.blockId ?? hrefToId.get(res.href) ?? '';
    if (!blockId) {
      do {
        blockId = gen();
      } while (usedIds.has(blockId));
      usedIds.add(blockId);
    }
    remoteByBlockId.set(blockId, parsed);
    pulledMeta.set(blockId, { href: res.href, etag: res.etag, uid: parsed.uid });
  }
  const removedBlockIds = new Set<string>();
  for (const href of pull.removed) {
    for (const [id, entry] of Object.entries(state.blocks)) {
      if (entry.href === href) removedBlockIds.add(id);
    }
  }

  // 2) Build base / local / remote block lists.
  const baseDoc = parseDocument(state.base ?? localMarkdown);
  const localDoc = parseDocument(localMarkdown);
  const baseById = new Map(baseDoc.blocks.filter((b) => b.id).map((b) => [b.id as string, b]));

  const remoteBlocks: Block[] = [];
  for (const b of baseDoc.blocks) {
    if (b.id && removedBlockIds.has(b.id)) continue;
    const parsed = b.id ? remoteByBlockId.get(b.id) : undefined;
    remoteBlocks.push(parsed && isTask(b) ? remoteBlock(b, parsed) : b);
  }
  for (const [id, parsed] of remoteByBlockId) {
    if (!baseById.has(id)) remoteBlocks.push(remoteBlock(null, parsed, id));
  }

  // 3) 3-way merge and reassemble.
  const merge = mergeBlocks(baseDoc.blocks, localDoc.blocks, remoteBlocks);
  const mergedDoc = applyMerge(localDoc, merge.merged);
  const markdown = serializeDocument(mergedDoc);

  // 4) Push local-originated changes back.
  const remoteById = new Map(remoteBlocks.filter((b) => b.id).map((b) => [b.id as string, b]));
  const conflictIds = new Set(merge.conflicts.map((c) => c.key));
  const nextBlocks: Record<string, MappingEntry> = {};
  const pushed = { created: [] as string[], updated: [] as string[], deleted: [] as string[] };
  const entry = (uid: string, etag: string, href: string, task: TaskBlock): MappingEntry => ({
    uid,
    etag,
    href,
    lastSyncedHash: task.contentHash,
    component: task.component,
  });

  for (const task of mergedDoc.blocks.filter(isTask)) {
    const id = task.id;
    if (!id) continue;
    const existing = state.blocks[id];
    const meta = pulledMeta.get(id);

    // Unresolved conflict: keep mapping as-is and wait for resolution.
    if (conflictIds.has(id)) {
      if (existing) nextBlocks[id] = existing;
      continue;
    }
    // Remote-originated and the merge kept the remote value → server is current.
    if (meta && remoteById.get(id)?.contentHash === task.contentHash) {
      nextBlocks[id] = entry(meta.uid, meta.etag, meta.href, task);
      continue;
    }
    // Unchanged since the last sync → nothing to push.
    if (existing && existing.lastSyncedHash === task.contentHash) {
      nextBlocks[id] = { ...existing, lastSyncedHash: task.contentHash };
      continue;
    }
    // Local-originated create/update → push (preserving any foreign UID).
    const uid = existing?.uid ?? meta?.uid ?? `todomd-${id}@${host}`;
    const href = meta?.href ?? existing?.href ?? `${calendarPath}todomd-${id}.ics`;
    const etag = await putResource(cfg, href, taskToICal(task, { ...opts.ical, uid }), existing?.etag);
    nextBlocks[id] = entry(uid, etag, href, task);
    (existing ? pushed.updated : pushed.created).push(id);
  }

  // Deletions: tracked blocks no longer present after the merge.
  for (const [id, mapping] of Object.entries(state.blocks)) {
    if (nextBlocks[id]) continue;
    if (!removedBlockIds.has(id)) await deleteResource(cfg, mapping.href, mapping.etag);
    pushed.deleted.push(id);
  }

  return {
    markdown,
    state: { version: 1, syncToken: pull.syncToken, base: markdown, blocks: nextBlocks },
    conflicts: merge.conflicts,
    pulled: { changed: pull.changed.length, removed: pull.removed.length },
    pushed,
  };
}

/** Overlay a reverse-mapped calendar resource onto its base task (or create one). */
function remoteBlock(base: TaskBlock | null, p: ParsedICalTask, idOverride?: string): TaskBlock {
  // Group an imported foreign event under its date (date-strategy sections).
  const dateForSection = p.component === 'VEVENT' ? (p.start ?? p.due) : (p.due ?? p.start);
  const task: TaskBlock = {
    kind: 'task',
    section: base?.section ?? (dateForSection ? dateForSection.slice(0, 10) : null),
    raw: '',
    contentHash: '',
    origin: base ? 'parsed' : 'created',
    dirty: true,
    title: p.title,
    done: p.done,
    component: base?.component ?? p.component,
    priority: p.priority,
    tags: base?.tags ?? [],
  };
  const id = base?.id ?? p.blockId ?? idOverride;
  if (id) task.id = id;

  if (p.component === 'VEVENT') {
    if (p.start !== undefined) {
      task.due = p.start;
      task.dueHasTime = p.startHasTime;
    }
  } else {
    if (p.due !== undefined) {
      task.due = p.due;
      task.dueHasTime = p.dueHasTime;
    }
    if (p.start !== undefined) {
      task.scheduled = p.start;
      task.scheduledHasTime = p.startHasTime;
    }
  }
  if (p.completedAt !== undefined) task.completedAt = p.completedAt;
  if (p.recurrenceRaw !== undefined) {
    task.recurrence = { raw: p.recurrenceRaw, rrule: p.rrule ?? '', whenDone: base?.recurrence?.whenDone ?? false };
  } else if (base?.recurrence) {
    task.recurrence = base.recurrence;
  }
  if (p.notes !== undefined) task.notes = p.notes;
  else if (base?.notes !== undefined) task.notes = base.notes;

  task.raw = serializeTaskLine(task);
  task.contentHash = contentHash(task.raw);
  return task;
}

// --- document reassembly ---------------------------------------------------

/**
 * Rebuild the local document from merged blocks: unchanged blocks keep their
 * verbatim unit, remote-changed blocks re-render canonically (dirty), removed
 * blocks drop out, and remote additions append at the end.
 */
function applyMerge(localDoc: TodoDocument, merged: Block[]): TodoDocument {
  const mergedByKey = new Map(merged.map((b) => [keyOf(b), b]));
  const consumed = new Set<string>();
  const units: ResolvedUnit[] = [];

  localDoc.layout.order.forEach((ref: UnitRef, i: number) => {
    const sep = localDoc.layout.separators[i] ?? '';
    if (ref.type === 'heading') {
      units.push({ sep, section: localDoc.sections[ref.index] });
      return;
    }
    const local = localDoc.blocks[ref.index];
    if (!local) return;
    const m = mergedByKey.get(keyOf(local));
    if (!m) return; // deleted by the merge
    consumed.add(keyOf(local));
    units.push({ sep, block: m.contentHash === local.contentHash ? local : { ...m, dirty: true } });
  });

  for (const m of merged) {
    if (consumed.has(keyOf(m))) continue;
    units.push({ sep: '\n\n', block: { ...m, dirty: true } });
  }

  const trailing = localDoc.layout.separators[localDoc.layout.order.length] ?? '\n';
  return rebuildDocument(localDoc, units, trailing);
}
