import path from 'node:path';
import type { CheckResult } from './check.js';
import { RULES } from './rules.js';
import type { ClassifiedFinding } from './types.js';

const useColor = () => !!process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (useColor() ? `\u001b[${code}m${s}\u001b[0m` : s);
export const color = {
  red: c('31'),
  yellow: c('33'),
  green: c('32'),
  dim: c('2'),
  bold: c('1'),
  cyan: c('36'),
};

function loc(f: ClassifiedFinding, root: string): string {
  const prefix = root && root !== '.' ? `${root.replace(/\/$/, '')}/` : '';
  return `${prefix}${f.file}${f.line ? `:${f.line}` : ''}`;
}

export function formatText(r: CheckResult, projectRoots: Record<string, string> = {}): string {
  const out: string[] = [];
  if (r.error) {
    out.push(color.red(`✖ ${r.error}`));
    for (const d of r.errorDetails) out.push(`  - ${d}`);
    return out.join('\n');
  }
  const header = `NoBypass check — ${r.contractPath ? path.basename(r.contractPath) : ''}${r.base ? ` (new vs ${r.base.slice(0, 10)})` : ''}`;
  out.push(color.bold(header));
  for (const n of r.notices) out.push(color.yellow(`⚠ ${n}`));

  const show = r.findings.filter((f) => f.status === 'new');
  const known = r.findings.filter((f) => f.status === 'known');
  for (const f of show) {
    const icon = f.blocking ? color.red('✖') : color.yellow('⚠');
    const sev = f.severity === 'error' ? color.red(f.severity) : color.yellow(f.severity);
    out.push('');
    out.push(`${icon} ${color.bold(f.ruleId)} ${sev} ${color.cyan(loc(f, projectRoots[f.project] ?? ''))}  ${color.dim(RULES[f.ruleId].title)}`);
    out.push(`  ${f.evidence}`);
    out.push(`  ${color.dim('expected:')} ${f.expected}`);
    out.push(`  ${color.dim('fix:')}      ${f.suggestion}`);
    if (f.note) out.push(`  ${color.dim(`(${f.note})`)}`);
  }

  const blocking = r.findings.filter((f) => f.blocking).length;
  const newErr = show.filter((f) => f.severity === 'error').length;
  const newWarn = show.filter((f) => f.severity === 'warning').length;
  out.push('');
  const parts = [
    `${r.filesAnalyzed} files analyzed`,
    `${newErr} new error${newErr === 1 ? '' : 's'}`,
    `${newWarn} new warning${newWarn === 1 ? '' : 's'}`,
    `${known.length} known (baseline/base)`,
  ];
  if (r.suppressed) parts.push(`${r.suppressed} covered by contract exceptions`);
  out.push(parts.join(' · '));
  if (blocking) {
    out.push(color.red(`✖ FAIL — ${blocking} blocking finding${blocking === 1 ? '' : 's'}. Run \`nobypass explain <RULE> --file <path>\` for details.`));
  } else {
    out.push(color.green('✔ PASS — no new blocking architecture violations.'));
  }
  return out.join('\n');
}

export function formatJson(r: CheckResult): string {
  const findings = r.findings.map((f) => ({
    ruleId: f.ruleId,
    severity: f.severity,
    file: f.file,
    line: f.line,
    sourceLayer: f.sourceLayer,
    targetLayer: f.targetLayer,
    symbol: f.symbol,
    evidence: f.evidence,
    expected: f.expected,
    suggestion: f.suggestion,
    confidence: f.confidence,
    fingerprint: f.fingerprint,
    project: f.project,
    status: f.status,
    blocking: f.blocking,
  }));
  return JSON.stringify(
    {
      tool: 'nobypass',
      version: 1,
      exitCode: r.exitCode,
      error: r.error,
      errorDetails: r.errorDetails,
      base: r.base,
      notices: r.notices,
      summary: {
        filesAnalyzed: r.filesAnalyzed,
        blocking: findings.filter((f) => f.blocking).length,
        new: findings.filter((f) => f.status === 'new').length,
        known: findings.filter((f) => f.status === 'known').length,
        suppressedByExceptions: r.suppressed,
      },
      findings,
    },
    null,
    2,
  );
}

export function formatSarif(r: CheckResult, projectRoots: Record<string, string> = {}): string {
  const rules = Object.entries(RULES).map(([id, rule]) => ({
    id,
    name: rule.title.replace(/(^|[^A-Za-z])([a-z])/g, (_m, _p, ch: string) => ch.toUpperCase()).replace(/[^A-Za-z]/g, ''),
    shortDescription: { text: rule.title },
    fullDescription: { text: rule.description },
  }));
  const results = r.findings
    .filter((f) => f.status === 'new')
    .map((f) => {
      const prefix = projectRoots[f.project] && projectRoots[f.project] !== '.' ? `${projectRoots[f.project].replace(/\/$/, '')}/` : '';
      return {
        ruleId: f.ruleId,
        level: f.severity === 'error' ? 'error' : 'warning',
        message: { text: `${f.evidence}. Expected: ${f.expected}. Fix: ${f.suggestion}` },
        partialFingerprints: { nobypass: f.fingerprint },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: `${prefix}${f.file}` },
              ...(f.line ? { region: { startLine: f.line } } : {}),
            },
          },
        ],
      };
    });
  return JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [{ tool: { driver: { name: 'NoBypass', rules } }, results }],
    },
    null,
    2,
  );
}
