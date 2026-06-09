import * as fs from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import git from 'isomorphic-git';

/**
 * File versioning for the SSOT (§5.2). Commits the `.md` (and sidecar state) to a
 * git repo on each meaningful change, giving history and recovery. Uses
 * `isomorphic-git` — pure JS, no git binary required (the slim Node image has none).
 */
const AUTHOR = { name: 'todomd', email: 'todomd@localhost' };

export async function ensureRepo(dir: string): Promise<void> {
  if (!existsSync(join(dir, '.git'))) {
    await git.init({ fs, dir, defaultBranch: 'main' });
  }
}

/** Stage `files` and commit if anything changed; returns the new sha or null. */
export async function commitSnapshot(
  dir: string,
  files: string[],
  message: string,
): Promise<string | null> {
  await ensureRepo(dir);

  let staged = false;
  for (const file of files) {
    if (existsSync(join(dir, file))) {
      await git.add({ fs, dir, filepath: file });
      staged = true;
    }
  }
  if (!staged || !(await hasStagedChanges(dir, files))) return null;

  return git.commit({ fs, dir, message, author: AUTHOR });
}

export interface CommitInfo {
  sha: string;
  message: string;
  timestamp: number;
}

export async function history(dir: string, depth = 50): Promise<CommitInfo[]> {
  if (!existsSync(join(dir, '.git'))) return [];
  const log = await git.log({ fs, dir, depth });
  return log.map((entry) => ({
    sha: entry.oid,
    message: entry.commit.message.trim(),
    timestamp: entry.commit.author.timestamp,
  }));
}

/** True if any of `files` differs from HEAD (or is newly added). */
async function hasStagedChanges(dir: string, files: string[]): Promise<boolean> {
  const matrix = await git.statusMatrix({ fs, dir, filepaths: files });
  // Row = [filepath, headStatus, workdirStatus, stageStatus]; unchanged = 1,1,1.
  return matrix.some(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1));
}
