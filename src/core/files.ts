import fs from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';

/** Directories never walked, regardless of contract. */
const ALWAYS_SKIP = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.next', 'coverage', '.nobypass']);

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Compiles a list of globs where entries starting with `!` exclude.
 * A path matches when it matches at least one positive glob and no negative glob.
 */
export function compileGlobs(globs: string[]): (file: string) => boolean {
  const pos = globs.filter((g) => !g.startsWith('!'));
  const neg = globs.filter((g) => g.startsWith('!')).map((g) => g.slice(1));
  const isPos = pos.length ? picomatch(pos, { dot: true }) : () => false;
  const isNeg = neg.length ? picomatch(neg, { dot: true }) : () => false;
  return (file) => isPos(file) && !isNeg(file);
}

/** Recursively lists files under `root` (POSIX, root-relative), skipping vendor-like directories. */
export function walkFiles(root: string, accept: (rel: string) => boolean, limit = Infinity): string[] {
  const out: string[] = [];
  const stack = [''];
  while (stack.length && out.length < limit) {
    const rel = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? 1 : -1));
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!ALWAYS_SKIP.has(e.name)) stack.push(childRel);
      } else if (e.isFile() && accept(childRel)) {
        out.push(childRel);
        if (out.length >= limit) break;
      }
    }
  }
  return out.sort();
}
