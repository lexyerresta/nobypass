import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';

export const CONTRACT_FILE = '.nobypass.yml';
export const PROPOSED_FILE = '.nobypass.proposed.yml';
export const DEFAULT_BASELINE = '.nobypass/baseline.json';

const RULE_IDS = ['BND001', 'BND002', 'BND003', 'BND004', 'EXC001', 'CFG001', 'ANL001'] as const;
const layerName = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*$/, 'layer names must be lowercase identifiers (a-z, 0-9, _ or -)');
const glob = z.string().min(1);
const severity = z.enum(['error', 'warning']);

const directOrmAccess = z
  .object({
    enabled: z.boolean().default(true),
    deny_in: z.array(layerName).default([]),
    allow_in: z.array(layerName).default([]),
    severity: severity.default('error'),
    /** Layers whose classes count as ORM models (PHP). Defaults to a layer named `model`, if any. */
    model_layers: z.array(layerName).optional(),
    /** Type names treated as ORM clients when injected (TypeScript), e.g. PrismaService. */
    clients: z.array(z.string()).optional(),
    /** Packages whose import counts as direct data access (TypeScript). */
    packages: z.array(z.string()).optional(),
  })
  .strict();

const catchPolicy = z
  .object({
    enabled: z.boolean().default(true),
    discourage_in: z.array(layerName).default([]),
    severity: severity.default('warning'),
  })
  .strict();

const exception = z
  .object({
    rule: z.enum(RULE_IDS),
    path: glob,
    symbol: z.string().optional(),
    reason: z.string().trim().min(3, 'every exception needs a reason'),
  })
  .strict();

const project = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_.-]+$/),
    root: z.string().default('.'),
    language: z.enum(['php', 'typescript', 'python', 'java']),
    framework: z
      .enum(['laravel', 'symfony', 'nestjs', 'express', 'fastify', 'nextjs', 'django', 'fastapi', 'spring', 'generic'])
      .default('generic'),
    include: z.array(glob).optional(),
    layers: z.record(layerName, z.array(glob).min(1)),
    dependencies: z
      .object({
        allowed_direct: z.record(layerName, z.array(z.string())),
        shared: z.array(layerName).default([]),
        type_only: z.enum(['enforce', 'ignore']).default('enforce'),
        same_layer: z.enum(['allow', 'deny']).default('allow'),
        detect_cycles: z.boolean().default(true),
      })
      .strict(),
    rules: z
      .object({
        direct_orm_access: directOrmAccess.optional(),
        catch_policy: catchPolicy.optional(),
        unclassified: z.enum(['warning', 'off']).default('warning'),
      })
      .strict()
      .default({ unclassified: 'warning' }),
    exclude: z.array(glob).default([]),
    exceptions: z.array(exception).default([]),
    baseline: z.string().default(DEFAULT_BASELINE),
  })
  .strict();

export const contractSchema = z
  .object({
    schema: z.literal(1),
    approved_by: z.string().optional(),
    approved_at: z.string().optional(),
    projects: z.array(project).min(1, 'the contract must declare at least one project'),
  })
  .strict();

export type Contract = z.infer<typeof contractSchema>;
export type ProjectContract = z.infer<typeof project>;

export class ContractError extends Error {
  constructor(
    message: string,
    public readonly issues: string[] = [],
  ) {
    super(message);
  }
}

/** Semantic checks that a JSON schema cannot express. Returns human-readable problems. */
export function validateSemantics(contract: Contract): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const p of contract.projects) {
    const where = `projects[${p.id}]`;
    if (ids.has(p.id)) problems.push(`${where}: duplicate project id`);
    ids.add(p.id);
    const layers = new Set(Object.keys(p.layers));
    if (layers.size === 0) problems.push(`${where}: no layers declared`);
    const known = (name: string, ctx: string) => {
      if (!layers.has(name)) problems.push(`${where}: ${ctx} references unknown layer "${name}"`);
    };
    for (const layer of layers) {
      if (!(layer in p.dependencies.allowed_direct)) {
        problems.push(
          `${where}: layer "${layer}" has no dependencies.allowed_direct entry (use [] for none or ["*"] for any)`,
        );
      }
    }
    for (const [from, targets] of Object.entries(p.dependencies.allowed_direct)) {
      known(from, 'dependencies.allowed_direct key');
      for (const t of targets) if (t !== '*') known(t, `dependencies.allowed_direct.${from}`);
    }
    for (const s of p.dependencies.shared) known(s, 'dependencies.shared');
    const orm = p.rules.direct_orm_access;
    if (orm) {
      for (const l of orm.deny_in) known(l, 'rules.direct_orm_access.deny_in');
      for (const l of orm.allow_in) known(l, 'rules.direct_orm_access.allow_in');
      for (const l of orm.model_layers ?? []) known(l, 'rules.direct_orm_access.model_layers');
      const both = orm.deny_in.filter((l) => orm.allow_in.includes(l));
      if (both.length) problems.push(`${where}: layers both denied and allowed ORM access: ${both.join(', ')}`);
    }
    for (const l of p.rules.catch_policy?.discourage_in ?? []) known(l, 'rules.catch_policy.discourage_in');
    if (path.isAbsolute(p.root) || p.root.split(/[\\/]/).includes('..')) {
      problems.push(`${where}: root must be a relative path inside the repository`);
    }
  }
  return problems;
}

export function parseContract(text: string, source: string): Contract {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (err) {
    throw new ContractError(`${source}: invalid YAML: ${(err as Error).message}`);
  }
  const result = contractSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ContractError(`${source}: contract does not match schema 1`, issues);
  }
  const problems = validateSemantics(result.data);
  if (problems.length) throw new ContractError(`${source}: contract is inconsistent`, problems);
  return result.data;
}

export function loadContractFile(file: string): Contract {
  return parseContract(fs.readFileSync(file, 'utf8'), path.basename(file));
}

/** Default include globs used when a project does not declare `include`. */
export function defaultInclude(p: ProjectContract): string[] {
  if (p.include?.length) return p.include;
  if (p.language === 'php') {
    if (p.framework === 'laravel') return ['app/**/*.php'];
    if (p.framework === 'symfony') return ['src/**/*.php'];
    return ['**/*.php'];
  }
  if (p.language === 'python') return ['**/*.py'];
  if (p.language === 'java') return ['**/src/main/java/**/*.java'];
  return ['src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];
}

/** Model layers for the ORM rule: explicit, or a layer literally named `model`/`models`. */
export function modelLayers(p: ProjectContract): string[] {
  const explicit = p.rules.direct_orm_access?.model_layers;
  if (explicit) return explicit;
  return Object.keys(p.layers).filter((l) => l === 'model' || l === 'models');
}
