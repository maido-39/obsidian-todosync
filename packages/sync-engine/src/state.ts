import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Component } from '@todomd/shared-types';

/** One row of the mapping store (§5.2): block id ↔ CalDAV resource. */
export interface MappingEntry {
  uid: string;
  etag: string;
  /** Server-absolute href of the .ics resource. */
  href: string;
  /** contentHash at last successful sync — drives change detection. */
  lastSyncedHash: string;
  component: Component;
}

/** The persisted sidecar (`.todomd/state.json`), keyed by block id. */
export interface MappingState {
  version: number;
  /** WebDAV-Sync token from the last pull (RFC 6578). */
  syncToken?: string;
  /** Last-synced markdown — the 3-way merge common ancestor (§5.2 base.md). */
  base?: string;
  blocks: Record<string, MappingEntry>;
}

export function emptyState(): MappingState {
  return { version: 1, blocks: {} };
}

/** Load the mapping store, or an empty state if the file is missing/invalid. */
export function loadState(path: string): MappingState {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as MappingState;
    return parsed.blocks ? parsed : emptyState();
  } catch {
    return emptyState();
  }
}

export function saveState(path: string, state: MappingState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}
