import {
  assignMissingIds,
  parseDocument,
  serializeDocument,
  taskToICal,
  type ICalOptions,
} from '@todomd/core';
import type { TaskBlock } from '@todomd/shared-types';
import { type CalDavConfig, deleteResource, ensureCalendar, putResource } from './caldav.js';
import { type MappingEntry, type MappingState } from './state.js';

export interface PushOptions {
  /** Target calendar collection, e.g. `/user/calendars/personal/`. */
  calendarPath: string;
  ical?: ICalOptions;
  /** Injectable id generator (deterministic in tests). */
  idGen?: () => string;
}

export interface PushResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  deleted: string[];
}

/**
 * One-way push: markdown → CalDAV (Phase-1 MVP, §7). Id-less tasks are assigned
 * stable ids first (returned in `markdown` for write-back), then each task is
 * converted to iCalendar and PUT to the calendar — created, updated (only when
 * its contentHash changed since the last sync), or left untouched. Resources for
 * blocks that vanished from the document are deleted. The bidirectional pull
 * (REPORT sync-token + 3-way merge) is the next increment.
 */
export async function pushToCalDav(
  markdown: string,
  state: MappingState,
  cfg: CalDavConfig,
  opts: PushOptions,
): Promise<{ markdown: string; state: MappingState; result: PushResult }> {
  await ensureCalendar(cfg, opts.calendarPath);

  const { doc } = assignMissingIds(parseDocument(markdown), opts.idGen);
  const outMarkdown = serializeDocument(doc);

  const calendarPath = opts.calendarPath.endsWith('/')
    ? opts.calendarPath
    : `${opts.calendarPath}/`;
  const host = opts.ical?.host ?? 'todomd.local';

  const tasks = doc.blocks.filter((b): b is TaskBlock => b.kind === 'task');
  const nextBlocks: Record<string, MappingEntry> = {};
  const result: PushResult = { created: [], updated: [], unchanged: [], deleted: [] };

  for (const task of tasks) {
    const id = task.id;
    if (!id) continue; // assignMissingIds guarantees an id; this satisfies the type
    const existing = state.blocks[id];

    if (existing && existing.lastSyncedHash === task.contentHash) {
      nextBlocks[id] = existing;
      result.unchanged.push(id);
      continue;
    }

    const href = existing?.href ?? `${calendarPath}todomd-${id}.ics`;
    const etag = await putResource(cfg, href, taskToICal(task, opts.ical), existing?.etag);
    nextBlocks[id] = {
      uid: `todomd-${id}@${host}`,
      etag,
      href,
      lastSyncedHash: task.contentHash,
      component: task.component,
    };
    (existing ? result.updated : result.created).push(id);
  }

  for (const [id, entry] of Object.entries(state.blocks)) {
    if (!nextBlocks[id]) {
      await deleteResource(cfg, entry.href, entry.etag);
      result.deleted.push(id);
    }
  }

  return { markdown: outMarkdown, state: { version: 1, blocks: nextBlocks }, result };
}
