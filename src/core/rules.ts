import { compileGlobs } from './files.js';
import { AllowedGraph, formatPath, type LayerMap } from './layers.js';
import { fingerprint } from './fingerprint.js';
import type { ProjectContract } from './config.js';
import type { FileAnalysis, Finding, RuleId, Severity, Confidence } from './types.js';

export interface RuleContext {
  project: ProjectContract;
  layers: LayerMap;
  allowed: AllowedGraph;
}

export const RULES: Record<RuleId, { title: string; description: string }> = {
  BND001: {
    title: 'Forbidden direct dependency',
    description:
      'A file depends directly on a layer that its own layer is not allowed to depend on (dependencies.allowed_direct).',
  },
  BND002: {
    title: 'Data access outside approved layer',
    description:
      'A file performs ORM / query-builder access in a layer listed in rules.direct_orm_access.deny_in.',
  },
  BND003: {
    title: 'Boundary bypass',
    description:
      'A file reaches a layer that is only approved through an intermediate layer, skipping that boundary (a specific form of BND001).',
  },
  BND004: {
    title: 'Layer dependency cycle',
    description: 'Static dependencies between configured layers form a cycle.',
  },
  EXC001: {
    title: 'Discouraged catch',
    description:
      'An exception is caught in a layer listed in rules.catch_policy.discourage_in without a documented purpose (`nobypass-allow EXC001: <reason>`).',
  },
  CFG001: {
    title: 'Unclassified or ambiguous file',
    description: 'An in-scope application file matches no layer, or matches more than one layer.',
  },
  ANL001: {
    title: 'Analysis failure',
    description:
      'A file could not be parsed or an application-level reference could not be resolved, so NoBypass cannot prove it follows the contract.',
  },
};

function make(
  ctx: RuleContext,
  f: Omit<Finding, 'fingerprint' | 'project'>,
  fingerprintFile = f.file,
): Finding {
  return {
    ...f,
    project: ctx.project.id,
    fingerprint: fingerprint({
      project: ctx.project.id,
      ruleId: f.ruleId,
      file: fingerprintFile,
      symbol: f.symbol,
      sourceLayer: f.sourceLayer,
      targetLayer: f.targetLayer,
    }),
  };
}

function label(layer: string | null): string {
  return layer ?? '(unclassified)';
}

/** Evaluates all per-file rules for one analysis. Contract exceptions are applied later. */
export function evaluateFile(ctx: RuleContext, a: FileAnalysis): Finding[] {
  const { project, layers, allowed } = ctx;
  const out: Finding[] = [];
  const assignment = layers.assign(a.file);
  const source = assignment.layer;

  if (project.rules.unclassified !== 'off') {
    if (assignment.matches.length === 0) {
      out.push(
        make(ctx, {
          ruleId: 'CFG001',
          severity: 'warning',
          file: a.file,
          line: null,
          sourceLayer: null,
          targetLayer: null,
          symbol: '(unclassified)',
          evidence: 'File is in scope but matches no layer glob',
          expected: `Every in-scope file belongs to exactly one of: ${layers.names.join(', ')}`,
          suggestion: 'Move the file into a layer directory, add a glob for it, or add it to exclude.',
          confidence: 'high',
        }),
      );
    } else if (assignment.matches.length > 1) {
      out.push(
        make(ctx, {
          ruleId: 'CFG001',
          severity: 'warning',
          file: a.file,
          line: null,
          sourceLayer: source,
          targetLayer: null,
          symbol: `(ambiguous:${assignment.matches.join('|')})`,
          evidence: `File matches several layers: ${assignment.matches.join(', ')}; treated as "${source}"`,
          expected: 'Each file matches exactly one layer',
          suggestion: 'Narrow the layer globs, e.g. with a "!pattern" exclusion.',
          confidence: 'high',
        }),
      );
    }
  }

  if (a.parseError) {
    out.push(
      make(ctx, {
        ruleId: 'ANL001',
        severity: 'error',
        file: a.file,
        line: null,
        sourceLayer: source,
        targetLayer: null,
        symbol: '(parse)',
        evidence: `Parser failed: ${a.parseError}`,
        expected: 'File parses with the supported language version',
        suggestion: 'Fix the syntax error, or report unsupported syntax. The file was NOT checked.',
        confidence: 'high',
      }),
    );
    return out;
  }

  for (const u of a.unresolved) {
    out.push(
      make(ctx, {
        ruleId: 'ANL001',
        severity: u.reason === 'unresolved' ? 'error' : 'warning',
        file: a.file,
        line: u.line,
        sourceLayer: source,
        targetLayer: null,
        symbol: u.symbol,
        evidence: u.detail,
        expected:
          u.reason === 'unresolved'
            ? 'Application references resolve to project files'
            : 'Class references are statically resolvable',
        suggestion:
          u.reason === 'unresolved'
            ? 'Fix the import/namespace (or composer/tsconfig mapping). The reference was not checked.'
            : 'Use a concrete class reference so the boundary can be verified. Marked unverified.',
        confidence: u.reason === 'unresolved' ? 'high' : 'low',
      }),
    );
  }

  if (!source) return out;

  // BND001 / BND003 — direct dependencies.
  for (const d of a.dependencies) {
    if (!d.target || d.external) continue;
    if (d.kind === 'type' && project.dependencies.type_only === 'ignore') continue;
    const target = layers.assign(d.target).layer;
    if (!target || allowed.allows(source, target)) continue;
    const approved = allowed.path(source, target);
    // BND003 = skipping exactly one intermediate boundary (e.g. controller → service when the
    // contract says controller → support → service). Reaching further down is plain BND001.
    const bypass = !!approved && approved.length === 3;
    const allowedTargets = project.dependencies.allowed_direct[source] ?? [];
    out.push(
      make(ctx, {
        ruleId: bypass ? 'BND003' : 'BND001',
        severity: 'error',
        file: a.file,
        line: d.line,
        sourceLayer: source,
        targetLayer: target,
        symbol: d.symbol,
        evidence: `${source} depends directly on ${target}${d.kind === 'type' ? ' (type-only reference)' : ''}: ${d.symbol}`,
        expected: bypass
          ? `${target} is reached only through ${formatPath(approved!)}`
          : `${source} may depend directly on: ${allowedTargets.length ? allowedTargets.join(', ') : 'nothing'}${
              approved ? `; approved route to ${target}: ${formatPath(approved)}` : ''
            }`,
        suggestion: bypass
          ? `Call the ${approved![1]} layer instead and let it reach ${target}.`
          : `Remove the dependency or route it through an allowed layer${allowedTargets.length ? ` (${allowedTargets.join(', ')})` : ''}.`,
        confidence: d.kind === 'type' ? 'medium' : 'high',
      }),
    );
  }

  // BND002 — data access outside the approved layers.
  const orm = project.rules.direct_orm_access;
  if (orm?.enabled && orm.deny_in.includes(source) && !orm.allow_in.includes(source)) {
    const route = allowed.pathToAny(source, orm.allow_in);
    for (const op of a.operations) {
      out.push(
        make(ctx, {
          ruleId: 'BND002',
          severity: orm.severity,
          file: a.file,
          line: op.line,
          sourceLayer: source,
          targetLayer: op.target ? layers.assign(op.target).layer : null,
          symbol: op.symbol,
          evidence: `${source} performs data access: ${op.evidence}`,
          expected: `Data access only in ${orm.allow_in.join(', ') || '(no layer)'}${route ? `, reached via ${formatPath(route)}` : ''}`,
          suggestion: route
            ? `Move the query into the ${route[route.length - 1]} layer and call it through ${formatPath(route)}.`
            : `Move the query into one of: ${orm.allow_in.join(', ')}.`,
          confidence: op.confidence,
        }),
      );
    }
  }

  // EXC001 — discouraged catch placement.
  const cp = project.rules.catch_policy;
  if (cp?.enabled && cp.discourage_in.includes(source)) {
    for (const c of a.catches) {
      if (c.documentedReason) continue;
      out.push(
        make(ctx, {
          ruleId: 'EXC001',
          severity: cp.severity,
          file: a.file,
          line: c.line,
          sourceLayer: source,
          targetLayer: null,
          symbol: `catch(${c.caught.join('|')})`,
          evidence: `catch (${c.caught.join(' | ')}) in ${source} with no documented purpose`,
          expected: `Exceptions in ${source} propagate to the central handler unless the catch has a purpose`,
          suggestion:
            'Let it propagate, or document the purpose (retry, rollback, wrapping as a domain error, expected fallback) with a `nobypass-allow EXC001: <reason>` comment.',
          confidence: 'high',
        }),
      );
    }
  }
  return out;
}

export interface Edge {
  from: string;
  to: string;
  file: string;
  line: number;
  symbol: string;
}

/** BND004 — cycles in the layer graph. Shared layers are excluded since they may depend on anything. */
export function evaluateCycles(ctx: RuleContext, analyses: Iterable<FileAnalysis>): Finding[] {
  const { project, layers, allowed } = ctx;
  if (!project.dependencies.detect_cycles) return [];
  const shared = new Set(project.dependencies.shared);
  const edges = new Map<string, Edge>();
  for (const a of analyses) {
    const from = layers.assign(a.file).layer;
    if (!from || shared.has(from)) continue;
    for (const d of a.dependencies) {
      if (!d.target || d.external) continue;
      if (d.kind === 'type' && project.dependencies.type_only === 'ignore') continue;
      const to = layers.assign(d.target).layer;
      if (!to || to === from || shared.has(to)) continue;
      const key = `${from}\u0000${to}`;
      const prev = edges.get(key);
      const cand = { from, to, file: a.file, line: d.line, symbol: d.symbol };
      if (!prev || cand.file < prev.file || (cand.file === prev.file && cand.line < prev.line)) edges.set(key, cand);
    }
  }
  const adj = new Map<string, string[]>();
  for (const e of edges.values()) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);

  // Tarjan's strongly connected components.
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const sccs: string[][] = [];
  const strong = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) sccs.push(comp.sort());
    }
  };
  for (const v of [...adj.keys()].sort()) if (!idx.has(v)) strong(v);

  return sccs.map((comp) => {
    const inComp = [...edges.values()]
      .filter((e) => comp.includes(e.from) && comp.includes(e.to))
      .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
    // Point at the edge the contract does not allow, if any: that is usually the one to remove.
    const culprit = inComp.find((e) => !allowed.allows(e.from, e.to)) ?? inComp[0];
    const cycle = comp.join(' ↔ ');
    return make(
      ctx,
      {
        ruleId: 'BND004',
        severity: 'error' as Severity,
        file: culprit.file,
        line: culprit.line,
        sourceLayer: culprit.from,
        targetLayer: culprit.to,
        symbol: `cycle:${comp.join(',')}`,
        evidence: `Layers ${cycle} depend on each other; e.g. ${culprit.from} → ${culprit.to} via ${culprit.symbol}`,
        expected: 'Layer dependencies are acyclic',
        suggestion: `Break the cycle, typically by removing the ${culprit.from} → ${culprit.to} dependency or introducing an interface in the lower layer.`,
        confidence: 'high' as Confidence,
      },
      '(project)',
    );
  });
}

/** Drops findings covered by `exceptions:` in the contract. Returns [kept, suppressedCount]. */
export function applyExceptions(project: ProjectContract, findings: Finding[]): [Finding[], number] {
  if (!project.exceptions.length) return [findings, 0];
  const compiled = project.exceptions.map((e) => ({ ...e, match: compileGlobs([e.path]) }));
  const kept: Finding[] = [];
  let suppressed = 0;
  for (const f of findings) {
    const hit = compiled.some(
      (e) =>
        e.rule === f.ruleId &&
        e.match(f.file) &&
        (!e.symbol || f.symbol.toLowerCase().includes(e.symbol.toLowerCase())),
    );
    if (hit) suppressed++;
    else kept.push(f);
  }
  return [kept, suppressed];
}
