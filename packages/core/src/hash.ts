import { createHash } from 'node:crypto';
import { nfc, rstrip, stripTrailingId, toLf } from './normalize.js';

/** Remove a trailing `^id` from the first and last non-blank lines of a block.
 *  (A task's id sits on its title line; a memo/detail's id sits on its last line.) */
function stripIdFromEnds(raw: string): string {
  const lines = raw.split('\n');
  const firstIdx = lines.findIndex((l) => l.trim() !== '');
  let lastIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i];
    if (ln !== undefined && ln.trim() !== '') {
      lastIdx = i;
      break;
    }
  }
  for (const idx of firstIdx === lastIdx ? [firstIdx] : [firstIdx, lastIdx]) {
    if (idx < 0) continue;
    const ln = lines[idx];
    if (ln !== undefined) lines[idx] = stripTrailingId(ln).text;
  }
  return lines.join('\n');
}

/**
 * Stable content hash used to track id-less blocks and to detect real edits
 * (§5 of the plan). Normalization removes only *insignificant* whitespace —
 * EOL style, Unicode form, trailing whitespace and blank-line runs — while
 * preserving meaningful structure (indentation, internal single spaces, list
 * markers). The block id is excluded so assigning an id never changes identity.
 *
 * sha256 is isolated here so the Kotlin port can swap in `MessageDigest`.
 */
export function contentHash(raw: string): string {
  const lines = nfc(stripIdFromEnds(toLf(raw))).split('\n').map(rstrip);

  // Collapse runs of blank lines to a single blank line.
  const collapsed: string[] = [];
  let prevBlank = false;
  for (const ln of lines) {
    const blank = ln.length === 0;
    if (blank && prevBlank) continue;
    collapsed.push(ln);
    prevBlank = blank;
  }
  // Trim leading / trailing blank lines.
  while (collapsed.length > 0 && collapsed[0] === '') collapsed.shift();
  while (collapsed.length > 0 && collapsed[collapsed.length - 1] === '') collapsed.pop();

  const normalized = collapsed.join('\n');
  return 'sha256:' + createHash('sha256').update(normalized, 'utf8').digest('hex');
}
