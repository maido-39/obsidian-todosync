import type {
  Block,
  Component,
  DetailBlock,
  MemoBlock,
  Section,
  SectionStrategy,
  TaskBlock,
  UnitRef,
} from '@todomd/shared-types';
import type { List, ListItem, Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { contentHash } from './hash.js';
import { stripBlockId } from './normalize.js';
import { parseTaskLine, type ParsedTaskLine } from './tokenizer.js';

// segmentation.ts is the sole importer of remark in the whole codebase.
const processor = unified().use(remarkParse).use(remarkGfm);

export interface SegmentResult {
  sections: Section[];
  blocks: Block[];
  order: UnitRef[];
  separators: string[];
}

interface Positioned {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/**
 * Segment a body string (frontmatter already removed) into sections + free
 * blocks, capturing each unit's verbatim source via mdast offsets and the exact
 * inter-unit whitespace as `separators` (§2 of the plan). Units (headings and
 * blocks) tile the body exactly, so the serializer can reproduce it byte-for-byte.
 */
export function segment(body: string, strategy: SectionStrategy): SegmentResult {
  const tree = processor.parse(body) as Root;
  const children = tree.children;

  const sections: Section[] = [];
  const blocks: Block[] = [];
  const order: UnitRef[] = [];
  const separators: string[] = [];

  let cursor = 0;
  let currentSection: string | null = null;

  const emit = (unit: UnitRef, start: number, end: number): void => {
    separators.push(body.slice(cursor, start));
    order.push(unit);
    cursor = end;
  };

  let i = 0;
  while (i < children.length) {
    const node = children[i];
    if (!node) {
      i++;
      continue;
    }

    // 1) `##` section heading.
    if (node.type === 'heading' && node.depth === 2) {
      const { start, end } = nodeRange(node);
      const raw = body.slice(start, end);
      const title = headingTitle(raw);
      sections.push({ title, kind: sectionKind(title, strategy), raw });
      emit({ type: 'heading', index: sections.length - 1 }, start, end);
      currentSection = title;
      i++;
      continue;
    }

    // 2) Task list → one TASK block per top-level item.
    if (node.type === 'list' && isTaskList(node)) {
      for (const item of node.children) {
        const block = buildTask(body, item, currentSection);
        blocks.push(block);
        const { start, end } = nodeRange(item);
        emit({ type: 'block', index: blocks.length - 1 }, start, end);
      }
      i++;
      continue;
    }

    // 3) Blockquote → MEMO block.
    if (node.type === 'blockquote') {
      const { start, end } = nodeRange(node);
      blocks.push(buildMemoOrDetail(body.slice(start, end), 'memo', currentSection));
      emit({ type: 'block', index: blocks.length - 1 }, start, end);
      i++;
      continue;
    }

    // 4) Otherwise accumulate a contiguous run (paragraph / non-task list / …)
    //    into one block. A blank line between nodes ends the run.
    let j = i;
    while (j + 1 < children.length) {
      const a = children[j];
      const b = children[j + 1];
      if (!a || !b) break;
      if (b.type === 'heading' && b.depth === 2) break;
      if (b.type === 'list' && isTaskList(b)) break;
      if (b.type === 'blockquote') break;
      if (!isContiguous(body, a, b)) break;
      j++;
    }
    const first = children[i];
    const last = children[j];
    if (!first || !last) {
      i = j + 1;
      continue;
    }
    const start = nodeRange(first).start;
    const end = nodeRange(last).end;
    const kind = i === j && first.type === 'paragraph' ? 'memo' : 'detail';
    blocks.push(buildMemoOrDetail(body.slice(start, end), kind, currentSection));
    emit({ type: 'block', index: blocks.length - 1 }, start, end);
    i = j + 1;
  }

  separators.push(body.slice(cursor));
  return { sections, blocks, order, separators };
}

function nodeRange(node: Positioned): { start: number; end: number } {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    throw new Error(`mdast node "${node.type}" is missing position offsets`);
  }
  return { start, end };
}

function isTaskList(node: List): boolean {
  const first = node.children[0];
  return first !== undefined && first.checked !== null && first.checked !== undefined;
}

const DATE_HEADING_RE = /^\d{4}-\d{2}-\d{2}$/;

function headingTitle(raw: string): string {
  return raw
    .replace(/^#{1,6}[ \t]+/, '')
    .replace(/[ \t]+#*[ \t]*$/, '')
    .trim();
}

function sectionKind(title: string, strategy: SectionStrategy): 'date' | 'project' {
  if (strategy === 'project') return 'project';
  return DATE_HEADING_RE.test(title) ? 'date' : 'project';
}

function isContiguous(body: string, a: Positioned, b: Positioned): boolean {
  const gap = body.slice(nodeRange(a).end, nodeRange(b).start);
  let newlines = 0;
  for (const ch of gap) if (ch === '\n') newlines++;
  return newlines <= 1;
}

function buildTask(body: string, item: ListItem, section: string | null): TaskBlock {
  const { start, end } = nodeRange(item);
  const raw = body.slice(start, end);
  const done = item.checked === true;

  const titlePara = item.children[0];
  let titleText = '';
  let titleEnd = start;
  if (titlePara && titlePara.type === 'paragraph') {
    const tr = nodeRange(titlePara);
    titleText = body.slice(tr.start, tr.end);
    titleEnd = tr.end;
  }
  const parsed = parseTaskLine(titleText);

  let notes: string | undefined;
  if (titleEnd < end) {
    const inner = body.slice(titleEnd, end).replace(/^\n+/, '').replace(/\s+$/, '');
    const ded = dedent(inner);
    if (ded.length > 0) notes = ded;
  }
  const hasSubtasks = item.children.some(
    (c) =>
      c.type === 'list' &&
      c.children.some((li) => li.checked !== null && li.checked !== undefined),
  );

  const block: TaskBlock = {
    kind: 'task',
    section,
    raw,
    contentHash: contentHash(raw),
    origin: 'parsed',
    dirty: false,
    title: parsed.title,
    done,
    component: deriveComponent(parsed),
    due: parsed.due,
    scheduled: parsed.scheduled,
    start: parsed.start,
    completedAt: parsed.completedAt,
    cancelledAt: parsed.cancelledAt,
    createdAt: parsed.createdAt,
    dueHasTime: parsed.dueHasTime,
    scheduledHasTime: parsed.scheduledHasTime,
    startHasTime: parsed.startHasTime,
    completedAtHasTime: parsed.completedAtHasTime,
    cancelledAtHasTime: parsed.cancelledAtHasTime,
    createdAtHasTime: parsed.createdAtHasTime,
    priority: parsed.priority,
    tags: parsed.tags,
  };
  if (parsed.id !== null) block.id = parsed.id;
  if (parsed.recurrence) block.recurrence = parsed.recurrence;
  if (notes !== undefined) block.notes = notes;
  if (hasSubtasks) block.hasSubtasks = true;
  if (parsed.warnings.length > 0) block.warnings = parsed.warnings;
  return block;
}

function deriveComponent(p: ParsedTaskLine): Component {
  if (p.tags.includes('#todo')) return 'VTODO';
  const hasTime = Boolean(
    p.dueHasTime ||
      p.scheduledHasTime ||
      p.startHasTime ||
      p.completedAtHasTime ||
      p.cancelledAtHasTime ||
      p.createdAtHasTime,
  );
  if (p.tags.includes('#event') || hasTime) return 'VEVENT';
  return 'VTODO';
}

function buildMemoOrDetail(
  raw: string,
  kind: 'memo' | 'detail',
  section: string | null,
): MemoBlock | DetailBlock {
  const { text: noId, id } = stripBlockId(raw);
  const text = kind === 'memo' ? unwrapBlockquote(noId) : noId;
  const block = {
    kind,
    section,
    raw,
    contentHash: contentHash(raw),
    origin: 'parsed' as const,
    dirty: false,
    text,
  } as MemoBlock | DetailBlock;
  if (id !== null) block.id = id;
  return block;
}

function unwrapBlockquote(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(/^ {0,3}>[ \t]?/, ''))
    .join('\n');
}

function dedent(s: string): string {
  const lines = s.split('\n');
  let min = Infinity;
  for (const ln of lines) {
    if (ln.trim() === '') continue;
    const m = /^[ \t]*/.exec(ln);
    const indent = m ? m[0].length : 0;
    if (indent < min) min = indent;
  }
  if (!Number.isFinite(min) || min === 0) return s;
  return lines.map((ln) => ln.slice(min)).join('\n');
}
