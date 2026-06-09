import type { RecurrenceRule } from './recurrence.js';

/** iCalendar component a task maps to. */
export type Component = 'VEVENT' | 'VTODO';

/** Task priority, highest → lowest, or null when unset. */
export type Priority = 'highest' | 'high' | 'medium' | 'low' | 'lowest' | null;

/** Free-block classification within a section (§3.1). */
export type BlockKind = 'task' | 'memo' | 'detail';

/** Provenance of a block — drives the serializer's verbatim-vs-render choice. */
export type BlockOrigin = 'parsed' | 'created';

export interface BlockBase {
  /**
   * Obsidian-style block id (`^id`); a 6-char base36 string once assigned.
   * Required for sync/calendar targets (tasks); optional for memo/detail blocks,
   * which are otherwise tracked by {@link BlockBase.contentHash}.
   */
  id?: string;
  kind: BlockKind;
  /** Owning section title (heading text), or `null` for pre-first-heading preamble. */
  section: string | null;
  /** Verbatim source slice of this block — the unit of lossless round-trip. */
  raw: string;
  /**
   * `sha256:<hex>` over a normalized form of the block (id stripped; EOL, Unicode
   * form and trailing/blank whitespace canonicalized) — stable across
   * insignificant edits, changes on real ones (§5 of the plan).
   */
  contentHash: string;
  /** Serializer bookkeeping (excluded from semantic equality). */
  origin: BlockOrigin;
  /** Whether the block was mutated since parse (=> canonical re-render). */
  dirty: boolean;
  /** Non-fatal parse notices (dangling signifier, duplicate priority, …). */
  warnings?: string[];
}

/** A blockquote or a single plain paragraph (§3.1). */
export interface MemoBlock extends BlockBase {
  kind: 'memo';
  /** Visible text with any trailing `^id` removed. */
  text: string;
}

/** Free paragraph(s) + non-task list(s) — a note that is not a schedule item. */
export interface DetailBlock extends BlockBase {
  kind: 'detail';
  /** Visible text with any trailing `^id` removed. */
  text: string;
}

/** A checkbox task line, optionally with indented notes / sub-bullets. */
export interface TaskBlock extends BlockBase {
  kind: 'task';
  /** Title with list marker, checkbox, signifiers and `^id` stripped. */
  title: string;
  done: boolean;
  /**
   * Provisional iCalendar component: timed or `#event` ⇒ VEVENT, else VTODO (§3.3).
   * The authoritative mapping is the later `core/mapper` increment, which may overwrite.
   */
  component: Component;
  /**
   * Local wall-clock date or date-time — `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`.
   * Zone resolution (frontmatter `timezone`) is deferred to the mapper, keeping the
   * tokenizer locale-free and portable.
   */
  due?: string;
  scheduled?: string;
  start?: string;
  completedAt?: string;
  cancelledAt?: string;
  createdAt?: string;
  /** Whether the corresponding date carried a `HH:MM` time component. */
  dueHasTime?: boolean;
  scheduledHasTime?: boolean;
  startHasTime?: boolean;
  completedAtHasTime?: boolean;
  cancelledAtHasTime?: boolean;
  createdAtHasTime?: boolean;
  priority: Priority;
  recurrence?: RecurrenceRule;
  /** Tags & mentions with prefix retained (`#event`, `@회사`), in original order. */
  tags: string[];
  /** Raw inner content beneath the title line (indented notes / sub-bullets). */
  notes?: string;
  /** True when the task had nested checkbox items (kept in `notes` for now). */
  hasSubtasks?: boolean;
}

export type Block = MemoBlock | DetailBlock | TaskBlock;
