import YAML from 'yaml';
import { parseContract, type Contract } from './config.js';

/**
 * Turns a reviewed proposal into the enforced contract text. Pure: callers handle the
 * interactive confirmation and file writes. Throws ContractError when the proposal is invalid.
 */
export function approveContract(proposalText: string, meta: { by: string; at?: Date }): { contract: Contract; text: string } {
  const parsed = parseContract(proposalText, '.nobypass.proposed.yml');
  const contract: Contract = {
    schema: 1,
    approved_by: meta.by,
    approved_at: (meta.at ?? new Date()).toISOString(),
    projects: parsed.projects,
  };
  const header = [
    '# NoBypass architecture contract — ENFORCED.',
    '# Changes to this file must be reviewed by a human (protect it with CODEOWNERS / branch rules).',
    '# `approved_by` is a record, not a security boundary.',
    '',
  ].join('\n');
  return { contract, text: header + YAML.stringify(contract, { lineWidth: 0 }) };
}

export function isNonInteractive(): boolean {
  return !process.stdin.isTTY || !process.stdout.isTTY || !!process.env.CI;
}
