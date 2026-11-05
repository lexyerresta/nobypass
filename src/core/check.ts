import fs from 'node:fs';
import path from 'node:path';
import { CONTRACT_FILE, PROPOSED_FILE, ContractError, loadContractFile, type Contract } from './config.js';
import { NON_BASELINABLE, readBaseline } from './baseline.js';
import { analyzeProject, type ProjectRun } from './engine.js';
import { canonical, changesSince, GitError, type ChangeSet } from './git.js';
import { applyExceptions, evaluateCycles } from './rules.js';
import { toPosix } from './files.js';
import type { ClassifiedFinding, FileAnalysis, Finding } from './types.js';

export const EXIT = { OK: 0, VIOLATIONS: 1, INVALID: 2, NOT_APPROVED: 3 } as const;

export interface CheckOptions {
  /** Directory containing `.nobypass.yml` (or the explicit file via `config`). */
  cwd: string;
  config?: string;
  since?: string;
  strict?: boolean;
}

export interface CheckResult {
  exitCode: number;
  contractPath: string | null;
  findings: ClassifiedFinding[];
  suppressed: number;
  filesAnalyzed: number;
  notices: string[];
  /** Fatal problem that prevented checking (exit 2 or 3). */
  error: string | null;
  errorDetails: string[];
  base: string | null;
}

function failure(exitCode: number, error: string, details: string[] = [], contractPath: string | null = null): CheckResult {
  return {
    exitCode,
    contractPath,
    findings: [],
    suppressed: 0,
    filesAnalyzed: 0,
    notices: [],
    error,
    errorDetails: details,
    base: null,
  };
}

export function locateContract(cwd: string, config?: string): { path: string | null; proposed: boolean } {
  const file = config ? path.resolve(cwd, config) : path.join(cwd, CONTRACT_FILE);
  if (fs.existsSync(file)) return { path: file, proposed: false };
  return { path: null, proposed: fs.existsSync(path.join(cwd, PROPOSED_FILE)) };
}

export function loadApprovedContract(opts: { cwd: string; config?: string }):
  | { ok: true; contract: Contract; contractPath: string; contractDir: string }
  | { ok: false; result: CheckResult } {
  const located = locateContract(opts.cwd, opts.config);
  if (!located.path) {
    const msg = located.proposed
      ? `No approved contract. ${PROPOSED_FILE} exists but has not been approved — run \`nobypass approve\`.`
      : `No ${CONTRACT_FILE} found. Run \`nobypass init\`, review the proposal, then \`nobypass approve\`.`;
    return { ok: false, result: failure(EXIT.NOT_APPROVED, msg) };
  }
  try {
    const contract = loadContractFile(located.path);
    return { ok: true, contract, contractPath: located.path, contractDir: path.dirname(located.path) };
  } catch (err) {
    const e = err as ContractError;
    return { ok: false, result: failure(EXIT.INVALID, e.message, e.issues ?? [], located.path) };
  }
}

interface SinceContext {
  changes: ChangeSet;
  /** project-relative changed files */
  changedFiles: Set<string>;
  /** fingerprint → count of the same finding in the base revision of changed files */
  baseCounts: Map<string, number>;
  baseCycleFingerprints: Set<string>;
}

function gitRelative(changes: ChangeSet, abs: string): string {
  return toPosix(path.relative(changes.gitRoot, canonical(abs)));
}

function buildSinceContext(run: ProjectRun, changes: ChangeSet): SinceContext {
  const changedFiles = new Set<string>();
  for (const file of run.files) {
    if (changes.changed.has(gitRelative(changes, path.join(run.projectRoot, file)))) changedFiles.add(file);
  }
  const baseCounts = new Map<string, number>();
  const baseAnalyses = new Map<string, FileAnalysis>(run.analyses);
  for (const file of changedFiles) {
    const baseContent = changes.readAtBase(gitRelative(changes, path.join(run.projectRoot, file)));
    if (baseContent == null) {
      baseAnalyses.delete(file);
      continue;
    }
    const { analysis, findings } = run.evaluateContent(file, baseContent);
    baseAnalyses.set(file, analysis);
    for (const f of findings) baseCounts.set(f.fingerprint, (baseCounts.get(f.fingerprint) ?? 0) + 1);
  }
  const [baseCycles] = applyExceptions(run.project, evaluateCycles(run.ctx, baseAnalyses.values()));
  return { changes, changedFiles, baseCounts, baseCycleFingerprints: new Set(baseCycles.map((f) => f.fingerprint)) };
}

/**
 * Splits findings into known debt and new violations.
 * Duplicates of the same fingerprint are counted, so adding a second identical violation to a
 * file that already had one is still reported as new.
 */
export function classify(
  findings: Finding[],
  baseline: Map<string, number>,
  since: SinceContext | null,
  strict: boolean,
): ClassifiedFinding[] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) groups.set(f.fingerprint, [...(groups.get(f.fingerprint) ?? []), f]);
  const out: ClassifiedFinding[] = [];
  for (const [fp, group] of groups) {
    group.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    const first = group[0];
    const fromBaseline = NON_BASELINABLE.has(first.ruleId) ? 0 : baseline.get(fp) ?? 0;
    let fromBase = 0;
    let unchangedFile = false;
    if (since) {
      if (first.ruleId === 'BND004') fromBase = since.baseCycleFingerprints.has(fp) ? Infinity : 0;
      else if (!since.changedFiles.has(first.file)) {
        fromBase = Infinity;
        unchangedFile = true;
      } else fromBase = since.baseCounts.get(fp) ?? 0;
    }
    const known = Math.max(fromBaseline, fromBase);
    group.forEach((f, i) => {
      const isKnown = i < known;
      const blocking = !isKnown && (f.severity === 'error' || strict);
      let note: string | undefined;
      if (isKnown) {
        note = unchangedFile
          ? 'file unchanged since base'
          : fromBaseline > i
            ? 'in reviewed baseline'
            : 'already present at base';
      } else if (!blocking) note = 'warning (use --strict to block)';
      out.push({ ...f, status: isKnown ? 'known' : 'new', blocking, ...(note ? { note } : {}) });
    });
  }
  return out.sort((a, b) =>
    a.file === b.file ? (a.line ?? 0) - (b.line ?? 0) || a.ruleId.localeCompare(b.ruleId) : a.file < b.file ? -1 : 1,
  );
}

export function runCheck(opts: CheckOptions): CheckResult {
  const loaded = loadApprovedContract(opts);
  if (!loaded.ok) return loaded.result;
  const { contract, contractPath, contractDir } = loaded;
  const notices: string[] = [];

  let changes: ChangeSet | null = null;
  if (opts.since) {
    try {
      changes = changesSince(contractDir, opts.since);
    } catch (err) {
      const msg = err instanceof GitError ? err.message : String(err);
      return failure(EXIT.INVALID, `cannot compare against ${opts.since}`, [msg], contractPath);
    }
    if (changes.changed.has(gitRelative(changes, contractPath))) {
      notices.push(`${path.basename(contractPath)} changed in this diff — contract changes require human review (CODEOWNERS).`);
    }
  }

  const all: ClassifiedFinding[] = [];
  let suppressed = 0;
  let filesAnalyzed = 0;
  for (const project of contract.projects) {
    let run: ProjectRun;
    try {
      run = analyzeProject(contractDir, project);
    } catch (err) {
      return failure(EXIT.INVALID, `analysis failed for project "${project.id}"`, [(err as Error).message], contractPath);
    }
    filesAnalyzed += run.analyses.size;
    suppressed += run.suppressed;
    const baselinePath = path.resolve(contractDir, project.baseline);
    let baseline: Map<string, number>;
    try {
      baseline = readBaseline(baselinePath);
    } catch (err) {
      return failure(EXIT.INVALID, (err as Error).message, [], contractPath);
    }
    if (changes && changes.changed.has(gitRelative(changes, baselinePath))) {
      notices.push(`${project.baseline} changed in this diff — baseline changes require human review.`);
    }
    if (run.files.length === 0) {
      notices.push(`project "${project.id}": no in-scope files found — check include/exclude globs.`);
    }
    const since = changes ? buildSinceContext(run, changes) : null;
    all.push(...classify(run.findings, baseline, since, !!opts.strict));
  }

  const blocking = all.filter((f) => f.blocking);
  const exitCode = blocking.some((f) => f.ruleId === 'ANL001')
    ? EXIT.INVALID
    : blocking.length
      ? EXIT.VIOLATIONS
      : EXIT.OK;
  return {
    exitCode,
    contractPath,
    findings: all,
    suppressed,
    filesAnalyzed,
    notices: [...new Set(notices)],
    error: null,
    errorDetails: [],
    base: changes?.base ?? null,
  };
}
