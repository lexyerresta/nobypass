import fs from 'node:fs';
import path from 'node:path';
import type { Contract } from '../core/config.js';
import { AllowedGraph, formatPath } from '../core/layers.js';

export const BLOCK_START = '<!-- nobypass:start -->';
export const BLOCK_END = '<!-- nobypass:end -->';

function contractSummary(contract: Contract): string[] {
  const out: string[] = [];
  for (const p of contract.projects) {
    const prefix = contract.projects.length > 1 ? `### Project \`${p.id}\` (${p.framework}, root \`${p.root}\`)\n\n` : '';
    const lines: string[] = [];
    lines.push('Layers:');
    for (const [name, globs] of Object.entries(p.layers)) lines.push(`- \`${name}\`: ${globs.map((g) => `\`${g}\``).join(', ')}`);
    lines.push('', 'Allowed direct dependencies (anything else is a violation):');
    for (const [from, to] of Object.entries(p.dependencies.allowed_direct)) {
      lines.push(`- \`${from}\` → ${to.length ? to.map((t) => (t === '*' ? 'any layer' : `\`${t}\``)).join(', ') : 'nothing'}`);
    }
    if (p.dependencies.shared.length) lines.push(`- Every layer may use: ${p.dependencies.shared.map((s) => `\`${s}\``).join(', ')}`);
    const orm = p.rules.direct_orm_access;
    if (orm?.enabled) {
      const g = new AllowedGraph(p);
      lines.push('', `Database / ORM access is only allowed in ${orm.allow_in.map((l) => `\`${l}\``).join(', ')}.`);
      for (const l of orm.deny_in) {
        const route = g.pathToAny(l, orm.allow_in);
        if (route) lines.push(`- From \`${l}\`, go through ${formatPath(route.map((r) => `\`${r}\``))}.`);
      }
    }
    const cp = p.rules.catch_policy;
    if (cp?.enabled && cp.discourage_in.length) {
      lines.push(
        '',
        `Do not catch exceptions in ${cp.discourage_in.map((l) => `\`${l}\``).join(', ')} unless the catch has a purpose (retry, rollback, wrapping into a domain error, expected fallback). Document it on the catch line: \`// nobypass-allow EXC001: <reason>\`.`,
      );
    }
    out.push(prefix + lines.join('\n'));
  }
  return out;
}

export function agentInstructions(contract: Contract, opts: { baseRef?: string } = {}): string {
  const base = opts.baseRef ?? 'origin/main';
  return [
    '## Architecture contract (NoBypass)',
    '',
    'This repository enforces an approved architecture contract in `.nobypass.yml`. Read it before changing code and follow it.',
    '',
    ...contractSummary(contract),
    '',
    'Before you report a task as finished:',
    '',
    `1. Run \`npx nobypass check --since ${base}\`.`,
    '2. If it fails, fix the reported violations (move code to the approved layer; do not work around the rule) and run it again.',
    '3. Use `npx nobypass explain <RULE> --file <path>` when a finding is unclear.',
    '',
    'Never edit `.nobypass.yml`, `.nobypass/baseline.json` or add contract `exceptions:` to make the check pass. Those changes need explicit human review — ask instead.',
  ].join('\n');
}

export function wrapBlock(body: string): string {
  return `${BLOCK_START}\n${body}\n${BLOCK_END}`;
}

export type MergeAction = 'create' | 'append' | 'replace' | 'unchanged';

/** Computes the new content of an instructions file without writing it. */
export function mergeIntoInstructions(existing: string | null, body: string): { action: MergeAction; content: string } {
  const block = wrapBlock(body);
  if (existing == null) return { action: 'create', content: `${block}\n` };
  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END);
  if (start !== -1 && end > start) {
    const next = existing.slice(0, start) + block + existing.slice(end + BLOCK_END.length);
    return { action: next === existing ? 'unchanged' : 'replace', content: next };
  }
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  return { action: 'append', content: `${existing}${sep}${block}\n` };
}

export function skillMarkdown(contract: Contract, opts: { baseRef?: string } = {}): string {
  const body = agentInstructions(contract, opts).replace(/^## Architecture contract \(NoBypass\)\n\n/, '');
  return [
    '---',
    'name: nobypass',
    'description: Follow and verify this repository\'s approved architecture contract (.nobypass.yml). Use whenever adding or changing application code, before declaring a coding task done, or when `nobypass check` reports a BND/EXC/CFG/ANL finding.',
    '---',
    '',
    '# NoBypass architecture contract',
    '',
    body,
    '',
  ].join('\n');
}

export function readIfExists(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

export function writeFileSafe(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
