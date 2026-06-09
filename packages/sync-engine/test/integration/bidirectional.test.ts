import { parseDocument, taskToICal } from '@todomd/core';
import type { TaskBlock } from '@todomd/shared-types';
import { emptyState, putResource, syncBidirectional } from '@todomd/sync-engine';
import { describe, expect, it } from 'vitest';

const baseUrl = process.env.XANDIKOS_URL;

function firstTask(src: string): TaskBlock {
  const t = parseDocument(src).blocks.find((b) => b.kind === 'task');
  if (!t || t.kind !== 'task') throw new Error('no task');
  return t;
}

describe.skipIf(!baseUrl)('bidirectional sync against Xandikos', () => {
  const cfg = { baseUrl: baseUrl ?? '' };

  it('pulls a remote modification into the markdown (no conflict)', async () => {
    const cal = `/user/calendars/bidi-mod-${Date.now()}/`;
    const md = '## 2026-06-10\n\n- [ ] meeting 📅 2026-06-10 #event ^bidaaa\n';

    const seed = await syncBidirectional(md, emptyState(), cfg, { calendarPath: cal });
    expect(seed.pushed.created).toContain('bidaaa');

    const href = seed.state.blocks.bidaaa?.href ?? '';
    const modified = taskToICal(firstTask('## D\n\n- [ ] meeting v2 📅 2026-06-12 #event ^bidaaa\n'));
    await putResource(cfg, href, modified, seed.state.blocks.bidaaa?.etag);

    const out = await syncBidirectional(md, seed.state, cfg, { calendarPath: cal });
    expect(out.conflicts).toHaveLength(0);
    expect(out.pulled.changed).toBeGreaterThanOrEqual(1);
    expect(out.markdown).toContain('meeting v2');
    expect(out.markdown).toContain('2026-06-12');
  });

  it('surfaces a conflict when both sides edit the same task', async () => {
    const cal = `/user/calendars/bidi-conf-${Date.now()}/`;
    const md = '## 2026-06-10\n\n- [ ] task 📅 2026-06-10 #event ^bidbbb\n';

    const seed = await syncBidirectional(md, emptyState(), cfg, { calendarPath: cal });
    expect(seed.pushed.created).toContain('bidbbb');

    const href = seed.state.blocks.bidbbb?.href ?? '';
    const remote = taskToICal(firstTask('## D\n\n- [ ] task remote 📅 2026-06-10 #event ^bidbbb\n'));
    await putResource(cfg, href, remote, seed.state.blocks.bidbbb?.etag);

    const localEdited = '## 2026-06-10\n\n- [ ] task local 📅 2026-06-10 #event ^bidbbb\n';
    const out = await syncBidirectional(localEdited, seed.state, cfg, { calendarPath: cal });
    expect(out.conflicts).toHaveLength(1);
    expect(out.conflicts[0]?.reason).toBe('both-edited');
    expect(out.markdown).toContain('task local');
  });

  it('re-sync with no changes pushes nothing', async () => {
    const cal = `/user/calendars/bidi-noop-${Date.now()}/`;
    const md = '## 2026-06-10\n\n- [ ] x 📅 2026-06-10 #event ^bidccc\n';
    const seed = await syncBidirectional(md, emptyState(), cfg, { calendarPath: cal });
    const again = await syncBidirectional(seed.markdown, seed.state, cfg, { calendarPath: cal });
    expect(again.conflicts).toHaveLength(0);
    expect(again.pushed.created).toEqual([]);
    expect(again.pushed.updated).toEqual([]);
    expect(again.pushed.deleted).toEqual([]);
  });
});
