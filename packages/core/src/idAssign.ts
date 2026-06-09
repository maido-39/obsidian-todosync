import type { TodoDocument } from '@todomd/shared-types';
import { contentHash } from './hash.js';
import { serializeTaskLine } from './serialize.js';

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Default id generator: a random 6-char base36 string. */
export function defaultIdGen(): string {
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += BASE36.charAt(Math.floor(Math.random() * 36));
  }
  return s;
}

/**
 * Create a deterministic id generator from a seed — useful for tests and the
 * golden corpus (so checked-in `expected-after-id.md` is reproducible).
 */
export function seededIdGen(seed: number): () => string {
  let state = (seed >>> 0) || 1;
  const next = (): number => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  return () => {
    let s = '';
    for (let i = 0; i < 6; i++) s += BASE36.charAt(next() % 36);
    return s;
  };
}

/**
 * Assign a 6-char base36 id to every id-less sync target (tasks, in Increment 1),
 * returning a new document. Touched blocks are cloned, marked `dirty: true` (so
 * the serializer renders them canonically with the id), and their `contentHash`
 * is recomputed from the canonical line. Ids are unique within the document.
 *
 * This is a serialize-time concern — `parseDocument` never invents ids.
 */
export function assignMissingIds(
  doc: TodoDocument,
  gen: () => string = defaultIdGen,
): { doc: TodoDocument; assigned: string[] } {
  const used = new Set<string>();
  for (const b of doc.blocks) {
    if (b.id) used.add(b.id);
  }

  const assigned: string[] = [];
  const blocks = doc.blocks.map((b) => {
    if (b.kind !== 'task' || b.id) return b;

    let id = gen();
    let guard = 0;
    while (used.has(id)) {
      id = gen();
      if (++guard > 10000) throw new Error('exhausted id generation attempts');
    }
    used.add(id);
    assigned.push(id);

    const updated = { ...b, id, dirty: true };
    updated.contentHash = contentHash(serializeTaskLine(updated));
    return updated;
  });

  return { doc: { ...doc, blocks }, assigned };
}
