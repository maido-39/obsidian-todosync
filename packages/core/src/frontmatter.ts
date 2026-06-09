import type { Frontmatter, SectionStrategy } from '@todomd/shared-types';

/** Defaults applied when a key is absent or the file has no frontmatter (§3.1). */
const DEFAULTS: Required<Omit<Frontmatter, 'extra'>> = {
  todomd_version: 1,
  timezone: 'UTC',
  default_calendar: 'personal',
  section_strategy: 'date',
};

export interface SplitFrontmatterResult {
  /** Verbatim frontmatter incl. both fences and trailing newline, or null. */
  frontmatterRaw: string | null;
  frontmatter: Frontmatter;
  /** Body after the frontmatter. Invariant: `(frontmatterRaw ?? '') + body === input`. */
  body: string;
}

// Opening `---` line, optional content, then a closing `---` line (+ optional
// trailing spaces and the line's newline / EOF). Only matches at the very top.
const FRONTMATTER_RE = /^---\n([\s\S]*?\n)?---[ \t]*(?:\n|$)/;

/**
 * Owned frontmatter splitter (§3.1). Recognizes only a fence at the very top of
 * the file; a `---` anywhere in the body is left untouched. Parses the four known
 * scalar keys with a minimal key:value reader (no YAML dependency) and preserves
 * unknown keys in `extra`.
 */
export function splitFrontmatter(normalized: string): SplitFrontmatterResult {
  const m = FRONTMATTER_RE.exec(normalized);
  if (!m) {
    return { frontmatterRaw: null, frontmatter: { ...DEFAULTS }, body: normalized };
  }
  const frontmatterRaw = m[0];
  const body = normalized.slice(frontmatterRaw.length);
  const frontmatter = parseScalars(m[1] ?? '');
  return { frontmatterRaw, frontmatter, body };
}

function parseScalars(content: string): Frontmatter {
  const fm: Frontmatter = { ...DEFAULTS };
  const extra: Record<string, string> = {};

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const ci = line.indexOf(':');
    if (ci === -1) continue;
    const key = line.slice(0, ci).trim();
    const value = unquote(line.slice(ci + 1).trim());

    switch (key) {
      case 'todomd_version': {
        const n = Number(value);
        fm.todomd_version = Number.isFinite(n) ? n : DEFAULTS.todomd_version;
        break;
      }
      case 'timezone':
        fm.timezone = value;
        break;
      case 'default_calendar':
        fm.default_calendar = value;
        break;
      case 'section_strategy':
        fm.section_strategy = value === 'project' ? 'project' : ('date' as SectionStrategy);
        break;
      default:
        extra[key] = value;
    }
  }

  if (Object.keys(extra).length > 0) fm.extra = extra;
  return fm;
}

function unquote(v: string): string {
  if (v.length >= 2) {
    const a = v[0];
    const b = v[v.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return v.slice(1, -1);
    }
  }
  return v;
}
