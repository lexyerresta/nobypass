import path from 'node:path';
import { loadApprovedContract } from './check.js';
import { analyzeProject } from './engine.js';
import { toPosix } from './files.js';
import { RULES } from './rules.js';
import type { Finding, RuleId } from './types.js';

export interface ExplainResult {
  exitCode: number;
  text: string;
  findings: Finding[];
}

const RULE_GUIDE: Record<RuleId, string> = {
  BND001:
    'The contract lists, per layer, which layers it may import/inject/call directly. This file reaches a layer outside that list. Indirect chains through approved layers are fine; only the direct edge is checked.',
  BND002:
    'Queries (Eloquent static calls, DB:: facade, injected Prisma/TypeORM clients, ORM handle imports) belong in the layers listed in rules.direct_orm_access.allow_in. Calling them elsewhere bypasses the data-access boundary even if the code works.',
  BND003:
    'The target layer is approved, but only through an intermediate layer. Calling it directly skips that boundary (for example a Controller injecting a Service when the contract routes Controllers through Support).',
  BND004:
    'Two or more layers depend on each other. Cycles make the layering meaningless: changes ripple both ways and boundaries cannot be enforced. Shared layers are excluded from cycle detection.',
  EXC001:
    'Catching in this layer is discouraged by the contract because errors should reach the central handler (Laravel exception handler / Nest exception filters). Legitimate catches (retry, rollback, wrapping, expected fallback) are fine — document them with `nobypass-allow EXC001: <reason>`.',
  CFG001:
    'Files that belong to no layer are not checked as a source layer, so architecture rules do not apply to them. Ambiguous files match several layers and are treated as the first one declared.',
  ANL001:
    'NoBypass could not parse the file or resolve an application-level reference. It refuses to report PASS for code it could not analyze.',
};

export function explain(cwd: string, ruleId: string, file?: string, config?: string): ExplainResult {
  const id = ruleId.toUpperCase() as RuleId;
  if (!(id in RULES)) {
    return { exitCode: 2, text: `Unknown rule ${ruleId}. Known rules: ${Object.keys(RULES).join(', ')}`, findings: [] };
  }
  const rule = RULES[id];
  const head = [`${id} — ${rule.title}`, '', rule.description, '', RULE_GUIDE[id]];
  if (!file) return { exitCode: 0, text: head.join('\n'), findings: [] };

  const loaded = loadApprovedContract({ cwd, config });
  if (!loaded.ok) return { exitCode: loaded.result.exitCode, text: loaded.result.error ?? 'contract error', findings: [] };
  const abs = path.resolve(cwd, file);
  for (const project of loaded.contract.projects) {
    const root = path.resolve(loaded.contractDir, project.root);
    const rel = toPosix(path.relative(root, abs));
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    // BND004 needs the whole graph; everything else can be evaluated for one file.
    const run = analyzeProject(loaded.contractDir, project, id === 'BND004' ? undefined : (f) => f === rel);
    if (!run.files.includes(rel)) {
      return { exitCode: 0, text: [...head, '', `${rel} is not in scope for project "${project.id}" (include/exclude).`].join('\n'), findings: [] };
    }
    const layer = run.ctx.layers.assign(rel).layer;
    const findings = run.findings.filter((f) => f.ruleId === id && f.file === rel);
    const out = [...head, '', `File: ${rel}`, `Layer: ${layer ?? '(unclassified)'}`];
    if (layer) {
      const allowed = project.dependencies.allowed_direct[layer] ?? [];
      out.push(`Contract: ${layer} may depend directly on ${allowed.length ? allowed.join(', ') : 'nothing'}`);
    }
    if (!findings.length) out.push('', `No ${id} findings in this file.`);
    for (const f of findings) {
      out.push(
        '',
        `• line ${f.line ?? '-'}: ${f.evidence}`,
        `  symbol:     ${f.symbol}`,
        `  expected:   ${f.expected}`,
        `  suggestion: ${f.suggestion}`,
        `  confidence: ${f.confidence} (analyzer certainty, not defect probability)`,
        `  fingerprint: ${f.fingerprint}`,
      );
    }
    return { exitCode: 0, text: out.join('\n'), findings };
  }
  return { exitCode: 2, text: `${file} is not inside any project root declared in the contract.`, findings: [] };
}
