import type { Block, Priority, TaskBlock, TodoDocument, UnitRef } from '@todomd/shared-types';
import { applyEol } from './normalize.js';

/**
 * Serialize a {@link TodoDocument} back to markdown.
 *
 * Round-trip strategy (§6 of the plan): a block that was parsed and is not dirty
 * is reproduced from its verbatim `raw`; dirty or freshly-created blocks are
 * canonically re-rendered. The body is rebuilt by interleaving
 * `layout.separators` with the ordered units, then the original EOL is reapplied.
 *
 * Invariants:
 *   - consistent-EOL input `x`:  `serialize(parse(x)) === x`
 *   - in-memory doc `b`:         `parse(serialize(b))` is semantically equal to `b`
 */
export function serializeDocument(doc: TodoDocument): string {
  const { frontmatterRaw, order, separators } = doc.layout;
  let out = frontmatterRaw ?? '';
  for (let i = 0; i < order.length; i++) {
    out += separators[i] ?? '';
    const ref = order[i];
    if (ref) out += renderUnit(doc, ref);
  }
  out += separators[order.length] ?? '';
  return applyEol(out, doc.layout.eol);
}

function renderUnit(doc: TodoDocument, ref: UnitRef): string {
  if (ref.type === 'heading') {
    return doc.sections[ref.index]?.raw ?? '';
  }
  const block = doc.blocks[ref.index];
  if (!block) return '';
  if (block.origin === 'parsed' && !block.dirty) return block.raw;
  return renderBlock(block);
}

/** Canonically render a block from its structured fields. */
export function renderBlock(block: Block): string {
  if (block.kind === 'task') return serializeTaskLine(block);
  if (block.kind === 'memo') {
    const quoted = block.text
      .split('\n')
      .map((l) => (l.length > 0 ? `> ${l}` : '>'))
      .join('\n');
    return appendId(quoted, block.id);
  }
  return appendId(block.text, block.id);
}

const PRIORITY_EMOJI: Record<Exclude<Priority, null>, string> = {
  highest: '🔺',
  high: '⏫',
  medium: '🔼',
  low: '🔽',
  lowest: '⏬',
};

/**
 * Canonical task line (§3.2 token order, Obsidian-Tasks compatible, single
 * spaces, id last): `- [ ] title [prio] [🔁 r] [🛫][⏳][📅][➕][✅][❌] [tags] [^id]`.
 */
export function serializeTaskLine(task: TaskBlock): string {
  const parts: string[] = [`- [${task.done ? 'x' : ' '}]`];
  if (task.title.length > 0) parts.push(task.title);
  if (task.priority) parts.push(PRIORITY_EMOJI[task.priority]);
  if (task.recurrence && task.recurrence.raw.length > 0) parts.push(`🔁 ${task.recurrence.raw}`);
  if (task.start) parts.push(`🛫 ${renderDate(task.start, task.startHasTime)}`);
  if (task.scheduled) parts.push(`⏳ ${renderDate(task.scheduled, task.scheduledHasTime)}`);
  if (task.due) parts.push(`📅 ${renderDate(task.due, task.dueHasTime)}`);
  if (task.createdAt) parts.push(`➕ ${renderDate(task.createdAt, task.createdAtHasTime)}`);
  if (task.completedAt) parts.push(`✅ ${renderDate(task.completedAt, task.completedAtHasTime)}`);
  if (task.cancelledAt) parts.push(`❌ ${renderDate(task.cancelledAt, task.cancelledAtHasTime)}`);
  for (const tag of task.tags) parts.push(tag);
  if (task.id) parts.push(`^${task.id}`);

  let line = parts.join(' ');
  if (task.notes && task.notes.length > 0) {
    const noteLines = task.notes.split('\n').map((l) => (l.length > 0 ? `    ${l}` : l));
    line += `\n${noteLines.join('\n')}`;
  }
  return line;
}

function renderDate(value: string, hasTime: boolean | undefined): string {
  return hasTime && value.includes('T') ? value.replace('T', ' ') : value;
}

function appendId(text: string, id: string | undefined): string {
  if (!id) return text;
  const lines = text.split('\n');
  let lastIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i];
    if (ln !== undefined && ln.trim() !== '') {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx < 0) return `${text} ^${id}`;
  lines[lastIdx] = `${lines[lastIdx] ?? ''} ^${id}`;
  return lines.join('\n');
}
