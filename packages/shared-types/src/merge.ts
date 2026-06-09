import type { Block } from './block.js';

/**
 * Why a block-level 3-way merge produced a conflict (§5.4):
 * - `both-edited`  — changed differently on each side
 * - `edit-delete`  — edited locally, deleted remotely
 * - `delete-edit`  — deleted locally, edited remotely
 * - `add-add`      — added on both sides with different content under the same key
 */
export type ConflictReason = 'both-edited' | 'edit-delete' | 'delete-edit' | 'add-add';

/** A single unresolved block conflict, surfaced for the §5.4 resolution UI. */
export interface Conflict {
  /** Match key — the block id, or `hash:<contentHash>` for id-less blocks. */
  key: string;
  reason: ConflictReason;
  base?: Block;
  local?: Block;
  remote?: Block;
}

/** Result of a 3-way block merge: the merged list plus any conflicts. */
export interface MergeResult {
  /** Merged blocks; for conflicts the local side is kept as a provisional value. */
  merged: Block[];
  conflicts: Conflict[];
}
