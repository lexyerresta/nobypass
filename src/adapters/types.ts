import type { ProjectContract } from '../core/config.js';
import type { FileAnalysis, Language } from '../core/types.js';

export interface AdapterContext {
  /** Absolute project root. */
  projectRoot: string;
  project: ProjectContract;
  /** In-scope project files (POSIX, root-relative). */
  files: string[];
  /** Layer of a project file, or null when unclassified/out of scope. */
  layerOf(file: string): string | null;
  /** True when the file belongs to a layer configured as an ORM model layer. */
  isModelLayerFile(file: string): boolean;
  /** Reads a project file; adapters must not read outside the project root. */
  read(file: string): string | null;
}

export interface PreparedAdapter {
  /** Analyzes a file's content. `content` may differ from disk (e.g. base revision for --since). */
  analyze(file: string, content: string): FileAnalysis;
}

export interface Adapter {
  language: Language;
  /** Rules this adapter can produce evidence for. */
  supportedRules: readonly string[];
  /** Builds indexes (namespaces, path aliases, model classes) from the in-scope files. */
  prepare(ctx: AdapterContext): PreparedAdapter;
}

/** Reads `nobypass-allow EXC001: reason` from the catch line or the line above/below it. */
export function documentedCatchReason(lines: string[], line: number): string | null {
  for (const l of [line - 1, line, line + 1]) {
    const text = lines[l - 1];
    if (!text) continue;
    const m = /nobypass-allow\s+EXC001\s*[:\-–]\s*(\S.{2,}?)\s*(\*\/)?\s*$/.exec(text);
    if (m) return m[1].trim();
  }
  return null;
}

export function emptyAnalysis(file: string): FileAnalysis {
  return { file, dependencies: [], operations: [], catches: [], unresolved: [], parseError: null };
}
