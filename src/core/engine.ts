import fs from 'node:fs';
import path from 'node:path';
import { phpAdapter } from '../adapters/php/index.js';
import { typescriptAdapter } from '../adapters/typescript/index.js';
import type { Adapter, PreparedAdapter } from '../adapters/types.js';
import { defaultInclude, modelLayers, type ProjectContract } from './config.js';
import { compileGlobs, walkFiles } from './files.js';
import { AllowedGraph, LayerMap } from './layers.js';
import { applyExceptions, evaluateCycles, evaluateFile, type RuleContext } from './rules.js';
import type { FileAnalysis, Finding, Language } from './types.js';

export const ADAPTERS: Record<Language, Adapter> = {
  php: phpAdapter,
  typescript: typescriptAdapter,
};

const EXTENSIONS: Record<Language, RegExp> = {
  php: /\.php$/,
  typescript: /\.(ts|tsx|mts|cts)$/,
};

const ALWAYS_EXCLUDE: Record<Language, string[]> = {
  php: ['vendor/**', '**/*.blade.php'],
  typescript: ['node_modules/**', '**/*.d.ts', 'dist/**'],
};

export interface ProjectRun {
  project: ProjectContract;
  projectRoot: string;
  ctx: RuleContext;
  files: string[];
  analyses: Map<string, FileAnalysis>;
  adapter: PreparedAdapter;
  /** Re-runs per-file rules on arbitrary content (used for base revisions). */
  evaluateContent(file: string, content: string): { analysis: FileAnalysis; findings: Finding[] };
  /** Findings before contract exceptions are applied. */
  rawFindings: Finding[];
  findings: Finding[];
  suppressed: number;
}

export function inScopeFiles(projectRoot: string, project: ProjectContract): string[] {
  const include = compileGlobs(defaultInclude(project));
  const exclude = compileGlobs([...ALWAYS_EXCLUDE[project.language], ...project.exclude]);
  const ext = EXTENSIONS[project.language];
  return walkFiles(projectRoot, (rel) => ext.test(rel) && include(rel) && !exclude(rel));
}

export function analyzeProject(contractDir: string, project: ProjectContract, fileFilter?: (f: string) => boolean): ProjectRun {
  const projectRoot = path.resolve(contractDir, project.root);
  if (!fs.existsSync(projectRoot)) throw new Error(`project "${project.id}": root ${project.root} does not exist`);
  const layers = new LayerMap(project.layers);
  const allowed = new AllowedGraph(project);
  const ctx: RuleContext = { project, layers, allowed };
  const models = new Set(modelLayers(project));
  const files = inScopeFiles(projectRoot, project);
  const read = (file: string) => {
    const abs = path.resolve(projectRoot, file);
    if (!abs.startsWith(projectRoot)) return null;
    try {
      return fs.readFileSync(abs, 'utf8');
    } catch {
      return null;
    }
  };
  const adapter = ADAPTERS[project.language].prepare({
    projectRoot,
    project,
    files,
    layerOf: (f) => layers.assign(f).layer,
    isModelLayerFile: (f) => {
      const l = layers.assign(f).layer;
      return !!l && models.has(l);
    },
    read,
  });

  const analyses = new Map<string, FileAnalysis>();
  const raw: Finding[] = [];
  for (const file of files) {
    if (fileFilter && !fileFilter(file)) continue;
    const content = read(file);
    if (content == null) continue;
    const analysis = adapter.analyze(file, content);
    analyses.set(file, analysis);
    raw.push(...evaluateFile(ctx, analysis));
  }
  // Cycles need the whole graph; skip them when only a subset of files was analyzed.
  if (!fileFilter) raw.push(...evaluateCycles(ctx, analyses.values()));
  const [findings, suppressed] = applyExceptions(project, raw);

  return {
    project,
    projectRoot,
    ctx,
    files,
    analyses,
    adapter,
    rawFindings: raw,
    findings,
    suppressed,
    evaluateContent(file, content) {
      const analysis = adapter.analyze(file, content);
      const [kept] = applyExceptions(project, evaluateFile(ctx, analysis));
      return { analysis, findings: kept };
    },
  };
}
