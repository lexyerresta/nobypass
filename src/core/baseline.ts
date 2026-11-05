import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Finding } from './types.js';

const entry = z.object({
  fingerprint: z.string(),
  ruleId: z.string(),
  project: z.string(),
  file: z.string(),
  symbol: z.string(),
  count: z.number().int().positive(),
});

const baselineSchema = z.object({
  schema: z.literal(1),
  created_at: z.string(),
  created_by: z.string().optional(),
  entries: z.array(entry),
});

export type Baseline = z.infer<typeof baselineSchema>;

/** Rules that can never be baselined: an analysis failure is not "known debt", it is unknown. */
export const NON_BASELINABLE = new Set(['ANL001']);

export function buildBaseline(findings: Finding[], createdBy?: string): Baseline {
  const map = new Map<string, z.infer<typeof entry>>();
  for (const f of findings) {
    if (NON_BASELINABLE.has(f.ruleId)) continue;
    const e = map.get(f.fingerprint);
    if (e) e.count++;
    else
      map.set(f.fingerprint, {
        fingerprint: f.fingerprint,
        ruleId: f.ruleId,
        project: f.project,
        file: f.file,
        symbol: f.symbol,
        count: 1,
      });
  }
  const entries = [...map.values()].sort((a, b) =>
    a.file === b.file ? (a.fingerprint < b.fingerprint ? -1 : 1) : a.file < b.file ? -1 : 1,
  );
  return { schema: 1, created_at: new Date().toISOString(), ...(createdBy ? { created_by: createdBy } : {}), entries };
}

export function readBaseline(file: string): Map<string, number> {
  const counts = new Map<string, number>();
  if (!fs.existsSync(file)) return counts;
  const parsed = baselineSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!parsed.success) throw new Error(`${path.basename(file)} is not a valid NoBypass baseline`);
  for (const e of parsed.data.entries) counts.set(e.fingerprint, (counts.get(e.fingerprint) ?? 0) + e.count);
  return counts;
}

export function writeBaseline(file: string, baseline: Baseline): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(baseline, null, 2) + '\n');
}
