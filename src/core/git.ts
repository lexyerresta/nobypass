import { execFileSync } from 'node:child_process';
import path from 'node:path';

export class GitError extends Error {}

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new GitError(`git ${args.join(' ')} failed: ${(e.stderr || e.message).trim()}`);
  }
}

export function gitRoot(cwd: string): string {
  return path.resolve(git(cwd, ['rev-parse', '--show-toplevel']).trim());
}

export interface ChangeSet {
  /** Commit the working tree is compared against (merge-base of ref and HEAD). */
  base: string;
  gitRoot: string;
  /** Changed or added paths relative to the git root (POSIX). Deleted files are omitted. */
  changed: Set<string>;
  /** Reads a path (git-root relative) at the base commit, or null when it did not exist. */
  readAtBase(gitPath: string): string | null;
}

/**
 * Files changed between the merge-base of `ref` and the current working tree, including
 * uncommitted and untracked files — an agent's unfinished edits count as changes.
 * Renames are treated as delete + add, so renamed files are re-reviewed.
 */
export function changesSince(cwd: string, ref: string): ChangeSet {
  const root = gitRoot(cwd);
  let base: string;
  try {
    base = git(root, ['merge-base', ref, 'HEAD']).trim();
  } catch {
    // Allow refs that are not ancestors-compatible (e.g. a plain commit) by verifying them directly.
    base = git(root, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  }
  const changed = new Set<string>();
  const diff = git(root, ['diff', '--name-only', '--no-renames', '--diff-filter=ACMRT', base, '--']);
  for (const line of diff.split('\n')) if (line.trim()) changed.add(line.trim());
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']);
  for (const line of untracked.split('\n')) if (line.trim()) changed.add(line.trim());
  const existsAtBase = new Set(
    git(root, ['ls-tree', '-r', '--name-only', base])
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );
  return {
    base,
    gitRoot: root,
    changed,
    readAtBase(gitPath: string) {
      if (!existsAtBase.has(gitPath)) return null;
      return git(root, ['show', `${base}:${gitPath}`]);
    },
  };
}

export function gitUserName(cwd: string): string | null {
  try {
    return git(cwd, ['config', 'user.name']).trim() || null;
  } catch {
    return null;
  }
}
