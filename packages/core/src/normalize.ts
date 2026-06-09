/**
 * Line-ending, Unicode and whitespace helpers shared by the tokenizer, the
 * segmenter and the content hash. This module has **zero imports** and uses only
 * plain string operations, so it ports verbatim to the future Kotlin core.
 *
 * Special whitespace characters are built from code points (not embedded as
 * literals) to keep the source pure ASCII and unambiguous.
 */

export type Eol = '\n' | '\r\n';

/** Full-width space (U+3000) and NBSP (U+00A0) — treated as token whitespace. */
const FULLWIDTH_SPACE = String.fromCharCode(0x3000);
const NBSP = String.fromCharCode(0x00a0);

/** Detect the dominant EOL style (first newline wins; LF is the default). */
export function detectEol(src: string): Eol {
  const i = src.indexOf('\n');
  if (i > 0 && src[i - 1] === '\r') return '\r\n';
  return '\n';
}

/** Normalize CRLF and lone CR to LF. */
export function toLf(src: string): string {
  return src.replace(/\r\n?/g, '\n');
}

/** Apply an EOL style to an LF-normalized string. */
export function applyEol(lf: string, eol: Eol): string {
  return eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
}

/** Unicode NFC — makes emoji + variation selectors compare equal. */
export function nfc(s: string): string {
  return s.normalize('NFC');
}

/** Trailing whitespace (ASCII space/tab, full-width space, NBSP) on one line. */
const TRAILING_WS_RE = new RegExp('[ \\t' + FULLWIDTH_SPACE + NBSP + ']+$');

/** Strip trailing spaces / tabs / full-width / NBSP from a single line. */
export function rstrip(line: string): string {
  return line.replace(TRAILING_WS_RE, '');
}

/**
 * A trailing Obsidian block id (`^id`) anchored to end of line and preceded by
 * whitespace. The id charset is restricted to lowercase base36 with a minimum
 * length so arbitrary prose ending in `^word` is not mistaken for an id (the
 * engine auto-assigns 6-char base36; the spec examples also use this shape).
 */
const TRAILING_ID_RE = /[ \t]+\^([0-9a-z]{3,32})$/;

/** Split a trailing `^id` off a single line. */
export function stripTrailingId(line: string): { text: string; id: string | null } {
  const m = TRAILING_ID_RE.exec(line);
  if (!m) return { text: line, id: null };
  return { text: line.slice(0, m.index), id: m[1] ?? null };
}

/** Split a trailing `^id` off the last non-blank line of a (multi-line) block. */
export function stripBlockId(raw: string): { text: string; id: string | null } {
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i];
    if (ln === undefined) continue;
    if (ln.trim() === '') continue;
    const { text, id } = stripTrailingId(ln);
    if (id !== null) {
      lines[i] = text;
      return { text: lines.join('\n'), id };
    }
    return { text: raw, id: null }; // last non-blank line carries no id
  }
  return { text: raw, id: null };
}
