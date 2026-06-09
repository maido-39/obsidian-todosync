import type { Component, Priority, Section, TodoDocument, UnitRef, Block, TaskBlock } from '@todomd/shared-types';
import { contentHash } from './hash.js';
import { serializeTaskLine } from './serialize.js';

/** A unit of the document body resolved from the layout — a heading or a block. */
export interface ResolvedUnit {
  sep: string;
  section?: Section;
  block?: Block;
}

/** Explode a document's layout into an ordered unit list + trailing separator. */
export function resolveUnits(doc: TodoDocument): { units: ResolvedUnit[]; trailing: string } {
  const units: ResolvedUnit[] = [];
  doc.layout.order.forEach((ref: UnitRef, i: number) => {
    const sep = doc.layout.separators[i] ?? '';
    if (ref.type === 'heading') {
      units.push({ sep, section: doc.sections[ref.index] });
    } else {
      const block = doc.blocks[ref.index];
      if (block) units.push({ sep, block });
    }
  });
  const trailing = doc.layout.separators[doc.layout.order.length] ?? '\n';
  return { units, trailing };
}

/** Rebuild a document from a (possibly mutated) unit list. */
export function rebuildDocument(
  doc: TodoDocument,
  units: ResolvedUnit[],
  trailing: string,
): TodoDocument {
  const sections: Section[] = [];
  const blocks: Block[] = [];
  const order: UnitRef[] = [];
  const separators: string[] = [];
  for (const u of units) {
    separators.push(u.sep);
    if (u.section) {
      sections.push(u.section);
      order.push({ type: 'heading', index: sections.length - 1 });
    } else if (u.block) {
      blocks.push(u.block);
      order.push({ type: 'block', index: blocks.length - 1 });
    }
  }
  separators.push(trailing);
  return { ...doc, sections, blocks, layout: { ...doc.layout, order, separators } };
}

/** Fields a client may supply when creating or editing a task. */
export interface TaskInput {
  title: string;
  section?: string;
  done?: boolean;
  due?: string;
  dueHasTime?: boolean;
  scheduled?: string;
  start?: string;
  priority?: Priority;
  tags?: string[];
  recurrence?: string;
  component?: Component;
  notes?: string;
}

const DATE_HEADING_RE = /^\d{4}-\d{2}-\d{2}$/;

function deriveComponent(input: { tags?: string[]; dueHasTime?: boolean; component?: Component }): Component {
  if (input.component) return input.component;
  const tags = input.tags ?? [];
  if (tags.includes('#todo')) return 'VTODO';
  if (tags.includes('#event') || input.dueHasTime) return 'VEVENT';
  return 'VTODO';
}

function buildTaskBlock(input: TaskInput): TaskBlock {
  const block: TaskBlock = {
    kind: 'task',
    section: input.section ?? null,
    raw: '',
    contentHash: '',
    origin: 'created',
    dirty: true,
    title: input.title,
    done: input.done ?? false,
    component: deriveComponent(input),
    priority: input.priority ?? null,
    tags: input.tags ?? [],
  };
  if (input.due !== undefined) {
    block.due = input.due;
    block.dueHasTime = input.dueHasTime ?? false;
  }
  if (input.scheduled !== undefined) block.scheduled = input.scheduled;
  if (input.start !== undefined) block.start = input.start;
  if (input.notes !== undefined) block.notes = input.notes;
  if (input.recurrence !== undefined) {
    block.recurrence = { raw: input.recurrence, rrule: '', whenDone: /when\s+done\s*$/i.test(input.recurrence) };
  }
  block.raw = serializeTaskLine(block);
  block.contentHash = contentHash(block.raw);
  return block;
}

/**
 * Append a new (id-less) task to the document, into `input.section` — creating
 * that heading at the end if it does not exist, else inserting after the
 * section's existing blocks. Run `assignMissingIds` afterwards to assign its id.
 */
export function addTask(doc: TodoDocument, input: TaskInput): { doc: TodoDocument; block: TaskBlock } {
  const block = buildTaskBlock(input);
  const { units, trailing } = resolveUnits(doc);

  let insertAt = units.length;
  if (input.section !== undefined) {
    const headingIdx = units.findIndex((u) => u.section?.title === input.section);
    if (headingIdx >= 0) {
      let j = headingIdx + 1;
      while (j < units.length && !units[j]?.section) j++;
      insertAt = j;
    } else {
      const kind = DATE_HEADING_RE.test(input.section) ? 'date' : 'project';
      units.push({
        sep: units.length > 0 ? '\n\n' : '',
        section: { title: input.section, kind, raw: `## ${input.section}` },
      });
      insertAt = units.length;
    }
  }

  units.splice(insertAt, 0, { sep: insertAt === 0 ? '' : '\n\n', block });
  return { doc: rebuildDocument(doc, units, trailing), block };
}

/** Patch a task's fields in place (verbatim-preserving for every other block). */
export function updateTask(
  doc: TodoDocument,
  blockId: string,
  patch: Partial<TaskInput>,
): TodoDocument | null {
  const idx = doc.blocks.findIndex((b) => b.kind === 'task' && b.id === blockId);
  if (idx < 0) return null;
  const current = doc.blocks[idx] as TaskBlock;
  const updated: TaskBlock = { ...current, dirty: true };

  if (patch.title !== undefined) updated.title = patch.title;
  if (patch.done !== undefined) updated.done = patch.done;
  if (patch.priority !== undefined) updated.priority = patch.priority;
  if (patch.tags !== undefined) updated.tags = patch.tags;
  if (patch.notes !== undefined) updated.notes = patch.notes;
  if (patch.due !== undefined) {
    updated.due = patch.due;
    updated.dueHasTime = patch.dueHasTime ?? updated.dueHasTime ?? false;
  }
  if (patch.scheduled !== undefined) updated.scheduled = patch.scheduled;
  if (patch.start !== undefined) updated.start = patch.start;
  if (patch.recurrence !== undefined) {
    updated.recurrence = patch.recurrence
      ? { raw: patch.recurrence, rrule: '', whenDone: /when\s+done\s*$/i.test(patch.recurrence) }
      : undefined;
  }
  if (patch.component !== undefined) updated.component = patch.component;

  updated.raw = serializeTaskLine(updated);
  updated.contentHash = contentHash(updated.raw);

  const blocks = doc.blocks.slice();
  blocks[idx] = updated;
  return { ...doc, blocks };
}

/** Remove a task block from the document (verbatim-preserving for the rest). */
export function deleteTask(doc: TodoDocument, blockId: string): TodoDocument | null {
  const target = doc.blocks.find((b) => b.kind === 'task' && b.id === blockId);
  if (!target) return null;
  const { units, trailing } = resolveUnits(doc);
  return rebuildDocument(
    doc,
    units.filter((u) => u.block !== target),
    trailing,
  );
}
