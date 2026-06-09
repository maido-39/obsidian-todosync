import type { TodoDocument } from '@todomd/shared-types';
import { splitFrontmatter } from './frontmatter.js';
import { detectEol, toLf } from './normalize.js';
import { segment } from './segmentation.js';

/**
 * Parse a todomd source string into an immutable {@link TodoDocument}.
 *
 * The result is fully verbatim: every block carries its original `raw` slice and
 * `dirty: false`, so `serializeDocument(parseDocument(x))` reproduces `x` for any
 * consistent-EOL input. Mutators (e.g. `assignMissingIds`) are what mark blocks
 * dirty and trigger canonical re-rendering.
 */
export function parseDocument(src: string): TodoDocument {
  const eol = detectEol(src);
  const normalized = toLf(src);
  const { frontmatterRaw, frontmatter, body } = splitFrontmatter(normalized);
  const { sections, blocks, order, separators } = segment(body, frontmatter.section_strategy);

  return {
    frontmatter,
    sections,
    blocks,
    layout: {
      eol,
      frontmatterRaw,
      frontmatterDirty: false,
      order,
      separators,
    },
    raw: normalized,
  };
}
