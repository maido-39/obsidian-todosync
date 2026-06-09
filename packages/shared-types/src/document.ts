import type { Block } from './block.js';

/** Authoring strategy for section headings (§3.1 frontmatter). */
export type SectionStrategy = 'date' | 'project';

/** Resolved kind of a parsed section. */
export type SectionKind = 'date' | 'project';

/** Line-ending style of a document. */
export type Eol = '\n' | '\r\n';

/** Parsed frontmatter (the single top-of-file YAML block). */
export interface Frontmatter {
  todomd_version: number;
  timezone: string;
  default_calendar: string;
  section_strategy: SectionStrategy;
  /** Preserved unknown keys (verbatim scalar text), in original order. */
  extra?: Record<string, string>;
}

/** A `##` section heading. */
export interface Section {
  /** Heading text (e.g. `"2026-06-10"` or a project name). */
  title: string;
  kind: SectionKind;
  /** Verbatim source of the heading line (no trailing newline). */
  raw: string;
}

/**
 * Reference into a {@link TodoDocument}'s ordered body stream — either a heading
 * (index into `sections`) or a block (index into `blocks`). Preamble blocks (before
 * the first heading) appear as `block` refs with no preceding `heading` ref.
 */
export interface UnitRef {
  type: 'heading' | 'block';
  index: number;
}

/** Everything the serializer needs to reproduce a document byte-for-byte. */
export interface DocumentLayout {
  eol: Eol;
  /** Verbatim frontmatter incl. both `---` fences and trailing newline, or null. */
  frontmatterRaw: string | null;
  /** Whether frontmatter values changed (=> re-render rather than emit verbatim). */
  frontmatterDirty: boolean;
  /** Body units (headings + blocks) in source order. */
  order: UnitRef[];
  /**
   * Inter-unit whitespace. `separators[i]` precedes `order[i]`;
   * `separators[order.length]` trails the last unit. Length = `order.length + 1`.
   */
  separators: string[];
}

/** A fully parsed todomd document. */
export interface TodoDocument {
  frontmatter: Frontmatter;
  sections: Section[];
  blocks: Block[];
  layout: DocumentLayout;
  /** The complete original source (EOL-normalized) — for diffing / safety. */
  raw: string;
}
