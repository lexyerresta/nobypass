/**
 * Shared data types. Adapters produce normalized `FileAnalysis` records; the core
 * turns them into `Finding`s using the approved contract. Nothing here knows about
 * PHP or TypeScript syntax.
 */

export type RuleId =
  | 'BND001'
  | 'BND002'
  | 'BND003'
  | 'BND004'
  | 'EXC001'
  | 'CFG001'
  | 'ANL001';

export type Severity = 'error' | 'warning';
export type Confidence = 'high' | 'medium' | 'low';
export type Language = 'php' | 'typescript' | 'python' | 'java';

/** How a dependency is used. `type` = only in type positions (hints, `import type`). */
export type DependencyKind = 'runtime' | 'type';

export interface Dependency {
  /** Project-relative POSIX path of the resolved target file, when it is inside the project. */
  target: string | null;
  /** Fully qualified symbol or module specifier, e.g. `App\Models\User` or `@prisma/client`. */
  symbol: string;
  line: number;
  kind: DependencyKind;
  /** True for vendor / node_modules / framework symbols that do not resolve to project files. */
  external: boolean;
}

export interface DataAccessOperation {
  /** e.g. `App\Models\User::where`, `DB::table`, `prisma.user.findMany`. */
  symbol: string;
  line: number;
  /** Short human description of what was detected. */
  evidence: string;
  /** Project file that defines the accessed model/client, when known. */
  target: string | null;
  confidence: Confidence;
}

export interface CatchSite {
  line: number;
  /** Caught types as written/resolved, e.g. `\Throwable`. */
  caught: string[];
  /** Reason from an inline `nobypass-allow EXC001: <reason>` comment, if present. */
  documentedReason: string | null;
}

export interface UnresolvedReference {
  symbol: string;
  line: number;
  /** `unresolved` = app-level import that could not be mapped; `dynamic` = runtime-computed class. */
  reason: 'unresolved' | 'dynamic';
  detail: string;
}

export interface FileAnalysis {
  file: string;
  dependencies: Dependency[];
  operations: DataAccessOperation[];
  catches: CatchSite[];
  unresolved: UnresolvedReference[];
  /** Set when the file could not be parsed at all. */
  parseError: string | null;
}

export interface Finding {
  ruleId: RuleId;
  severity: Severity;
  file: string;
  line: number | null;
  sourceLayer: string | null;
  targetLayer: string | null;
  symbol: string;
  evidence: string;
  expected: string;
  suggestion: string;
  confidence: Confidence;
  fingerprint: string;
  /** Contract project id the finding belongs to. */
  project: string;
}

export type FindingStatus = 'new' | 'known';

export interface ClassifiedFinding extends Finding {
  status: FindingStatus;
  /** Whether this finding makes the check fail. */
  blocking: boolean;
  /** Why the finding is not blocking, when it is not. */
  note?: string;
}
