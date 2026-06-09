import type { Block, Conflict, MergeResult } from '@todomd/shared-types';

/**
 * Block-level 3-way merge (§5.3) — the data-safety core for bidirectional sync.
 *
 * Blocks are matched across the three versions by a stable key: the block `id`
 * for sync targets (tasks always have one), or `hash:<contentHash>` for id-less
 * memo/detail blocks. For each key a 3-way decision is made; unchanged,
 * one-sided, and convergent edits merge automatically, while divergent edits
 * become {@link Conflict}s (with the local side kept as a provisional value).
 *
 * Note: id-less blocks are identified by content, so an *edited* id-less block
 * looks like a delete + add rather than an edit — acceptable for memos/details,
 * which is exactly why tasks always carry ids.
 */
export function mergeBlocks(base: Block[], local: Block[], remote: Block[]): MergeResult {
  const baseMap = byKey(base);
  const localMap = byKey(local);
  const remoteMap = byKey(remote);

  const conflicts: Conflict[] = [];
  const merged: Block[] = [];
  const handled = new Set<string>();

  const decide = (key: string): Block | null => {
    const b = baseMap.get(key);
    const l = localMap.get(key);
    const r = remoteMap.get(key);

    // Present on both sides now.
    if (l && r) {
      if (same(l, r)) return l; // identical (incl. convergent edits)
      if (b && same(l, b)) return r; // only remote changed
      if (b && same(r, b)) return l; // only local changed
      conflicts.push({ key, reason: b ? 'both-edited' : 'add-add', base: b, local: l, remote: r });
      return l; // provisional
    }

    // Local only.
    if (l && !r) {
      if (b && !same(l, b)) {
        conflicts.push({ key, reason: 'edit-delete', base: b, local: l });
        return l;
      }
      if (b) return null; // unchanged locally, deleted remotely → delete
      return l; // added locally
    }

    // Remote only.
    if (!l && r) {
      if (b && !same(r, b)) {
        conflicts.push({ key, reason: 'delete-edit', base: b, remote: r });
        return r;
      }
      if (b) return null; // unchanged remotely, deleted locally → delete
      return r; // added remotely
    }

    return null; // base only → deleted on both sides
  };

  // Local order first, then remote-only additions, preserving authoring order.
  for (const block of local) {
    const k = key(block);
    if (handled.has(k)) continue;
    handled.add(k);
    const m = decide(k);
    if (m) merged.push(m);
  }
  for (const block of remote) {
    const k = key(block);
    if (handled.has(k)) continue;
    handled.add(k);
    const m = decide(k);
    if (m) merged.push(m);
  }

  return { merged, conflicts };
}

function key(b: Block): string {
  return b.id ?? `hash:${b.contentHash}`;
}

function byKey(blocks: Block[]): Map<string, Block> {
  const map = new Map<string, Block>();
  for (const b of blocks) map.set(key(b), b);
  return map;
}

function same(a: Block, b: Block): boolean {
  return a.kind === b.kind && a.contentHash === b.contentHash;
}
