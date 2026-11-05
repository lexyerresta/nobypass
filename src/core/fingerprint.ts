import { createHash } from 'node:crypto';

/**
 * Stable identity of a finding. Line numbers are deliberately excluded so unrelated edits
 * that shift code do not turn known violations into "new" ones.
 */
export function fingerprint(parts: {
  project: string;
  ruleId: string;
  file: string;
  symbol: string;
  sourceLayer: string | null;
  targetLayer: string | null;
}): string {
  const key = [parts.project, parts.ruleId, parts.file, parts.symbol, parts.sourceLayer ?? '', parts.targetLayer ?? '']
    .join('\u0000')
    .toLowerCase();
  return createHash('sha256').update(key).digest('hex').slice(0, 20);
}
