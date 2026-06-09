import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitSnapshot, history } from '@todomd/sync-engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('gitVersion', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'todomd-git-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('commits changes and records history newest-first', async () => {
    writeFileSync(join(dir, 'todo.md'), '# v1\n');
    const sha1 = await commitSnapshot(dir, ['todo.md'], 'first');
    expect(sha1).toMatch(/^[0-9a-f]{40}$/);

    writeFileSync(join(dir, 'todo.md'), '# v2\n');
    const sha2 = await commitSnapshot(dir, ['todo.md'], 'second');
    expect(sha2).toMatch(/^[0-9a-f]{40}$/);
    expect(sha2).not.toBe(sha1);

    expect((await history(dir)).map((c) => c.message)).toEqual(['second', 'first']);
  });

  it('skips a commit when nothing changed', async () => {
    writeFileSync(join(dir, 'todo.md'), '# same\n');
    await commitSnapshot(dir, ['todo.md'], 'first');
    expect(await commitSnapshot(dir, ['todo.md'], 'again')).toBeNull();
    expect(await history(dir)).toHaveLength(1);
  });
});
