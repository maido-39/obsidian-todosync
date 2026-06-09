import type { Block, TaskBlock, TodoDocument } from '@todomd/shared-types';
import { GOLDEN_SCHEMA_VERSION } from '@todomd/shared-types';

/**
 * The semantic projection of a document used by the language-neutral golden
 * corpus (`fixtures/golden/`). It drops serializer bookkeeping (`raw`, `origin`,
 * `dirty`, `layout`) and undefined fields, but keeps `contentHash` so the future
 * Kotlin port's hashing must match byte-for-byte. Both the fixture generator and
 * the golden test import this — there is one definition of the contract.
 */
export interface GoldenDocument {
  schemaVersion: number;
  frontmatter: TodoDocument['frontmatter'];
  sections: Array<{ title: string; kind: string }>;
  blocks: Array<Record<string, unknown>>;
}

const DATE_FIELDS = ['due', 'scheduled', 'start', 'completedAt', 'cancelledAt', 'createdAt'] as const;
const HAS_TIME_FIELDS = [
  'dueHasTime',
  'scheduledHasTime',
  'startHasTime',
  'completedAtHasTime',
  'cancelledAtHasTime',
  'createdAtHasTime',
] as const;

export function projectDocument(doc: TodoDocument): GoldenDocument {
  return {
    schemaVersion: GOLDEN_SCHEMA_VERSION,
    frontmatter: doc.frontmatter,
    sections: doc.sections.map((s) => ({ title: s.title, kind: s.kind })),
    blocks: doc.blocks.map(projectBlock),
  };
}

function projectBlock(b: Block): Record<string, unknown> {
  const o: Record<string, unknown> = {
    kind: b.kind,
    section: b.section,
    contentHash: b.contentHash,
  };
  if (b.id !== undefined) o.id = b.id;
  if (b.warnings !== undefined) o.warnings = b.warnings;

  if (b.kind === 'task') {
    const t: TaskBlock = b;
    o.title = t.title;
    o.done = t.done;
    o.component = t.component;
    o.priority = t.priority;
    o.tags = t.tags;
    for (const f of DATE_FIELDS) if (t[f] !== undefined) o[f] = t[f];
    for (const f of HAS_TIME_FIELDS) if (t[f] !== undefined) o[f] = t[f];
    if (t.recurrence !== undefined) o.recurrence = t.recurrence;
    if (t.notes !== undefined) o.notes = t.notes;
    if (t.hasSubtasks) o.hasSubtasks = true;
  } else {
    o.text = b.text;
  }
  return o;
}
