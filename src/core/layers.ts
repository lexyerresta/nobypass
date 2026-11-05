import { compileGlobs } from './files.js';
import type { ProjectContract } from './config.js';

export interface LayerAssignment {
  layer: string | null;
  /** All layers whose globs matched; more than one means the file is ambiguous. */
  matches: string[];
}

export class LayerMap {
  private readonly matchers: Array<[string, (f: string) => boolean]>;
  readonly names: string[];

  constructor(layers: Record<string, string[]>) {
    this.names = Object.keys(layers);
    this.matchers = this.names.map((n) => [n, compileGlobs(layers[n])]);
  }

  /** Ambiguous files resolve to the first matching layer in declaration order (reported as CFG001). */
  assign(file: string): LayerAssignment {
    const matches = this.matchers.filter(([, m]) => m(file)).map(([n]) => n);
    return { layer: matches[0] ?? null, matches };
  }
}

/** Directed graph of allowed direct layer dependencies. */
export class AllowedGraph {
  constructor(private readonly p: ProjectContract) {}

  private targets(from: string): string[] {
    return this.p.dependencies.allowed_direct[from] ?? [];
  }

  allows(from: string, to: string): boolean {
    if (from === to) return this.p.dependencies.same_layer === 'allow';
    if (this.p.dependencies.shared.includes(to)) return true;
    const t = this.targets(from);
    return t.includes('*') || t.includes(to);
  }

  /** Shortest approved path from one layer to another (inclusive), or null when unreachable. */
  path(from: string, to: string): string[] | null {
    if (from === to) return [from];
    const prev = new Map<string, string>();
    const queue = [from];
    const seen = new Set([from]);
    while (queue.length) {
      const cur = queue.shift()!;
      const next = this.targets(cur).includes('*') ? Object.keys(this.p.layers) : this.targets(cur);
      for (const n of next) {
        if (seen.has(n)) continue;
        seen.add(n);
        prev.set(n, cur);
        if (n === to) {
          const out = [to];
          let c = to;
          while (prev.has(c)) {
            c = prev.get(c)!;
            out.unshift(c);
          }
          return out;
        }
        queue.push(n);
      }
    }
    return null;
  }

  /** Shortest approved path from `from` to any of `targets`. */
  pathToAny(from: string, targets: string[]): string[] | null {
    let best: string[] | null = null;
    for (const t of targets) {
      const p = this.path(from, t);
      if (p && (!best || p.length < best.length)) best = p;
    }
    return best;
  }
}

export function formatPath(p: string[]): string {
  return p.join(' → ');
}
