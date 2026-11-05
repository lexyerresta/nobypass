import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { parseContract, type Contract, type ProjectContract } from '../core/config.js';
import { analyzeProject, inScopeFiles } from '../core/engine.js';
import { compileGlobs, toPosix } from '../core/files.js';
import { LayerMap } from '../core/layers.js';

export type PresetName = 'laravel' | 'symfony' | 'nestjs' | 'nestjs-hexagonal' | 'node-api' | 'nextjs' | 'django' | 'fastapi' | 'spring';

const PRESET_FOR: Record<Framework, PresetName> = {
  laravel: 'laravel',
  symfony: 'symfony',
  nestjs: 'nestjs',
  express: 'node-api',
  fastify: 'node-api',
  nextjs: 'nextjs',
  django: 'django',
  fastapi: 'fastapi',
  spring: 'spring',
};

export interface LayerStat {
  name: string;
  globs: string[];
  files: number;
  examples: string[];
}

export interface ProposedProject {
  project: ProjectContract;
  preset: PresetName;
  evidence: string[];
  layers: LayerStat[];
  removedLayers: string[];
  inScope: number;
  coverage: number;
  unclassified: string[];
  ambiguous: Array<{ file: string; layers: string[] }>;
  namingMismatches: Array<{ file: string; looksLike: string; assigned: string | null }>;
  /** Observed violations of the proposed contract in existing code, by rule and edge. */
  contradictions: Array<{ ruleId: string; edge: string; count: number; example: string }>;
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
}

export interface DiscoveryResult {
  root: string;
  projects: ProposedProject[];
  /** Directories where detection was ambiguous or unsupported. They were NOT proposed. */
  undetermined: Array<{ dir: string; reason: string }>;
}

const SAMPLE_LIMIT = 800;

export function presetsDir(): string {
  // Works from src/discovery (tests) and dist/discovery (published package).
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', 'presets');
}

export function loadPreset(name: PresetName): ProjectContract {
  const file = path.join(presetsDir(), `${name}.yml`);
  return parseContract(fs.readFileSync(file, 'utf8'), `${name}.yml`).projects[0];
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export type Framework = 'laravel' | 'symfony' | 'nestjs' | 'express' | 'fastify' | 'nextjs' | 'django' | 'fastapi' | 'spring';

interface Detection {
  framework: Framework;
  evidence: string[];
}

const ORM_PACKAGES = ['@prisma/client', 'typeorm', 'mongoose', 'drizzle-orm', 'sequelize', 'knex'];

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** One detection per manifest; the most specific framework in a manifest wins (NestJS over Express, Laravel over Symfony parts). */
function detect(dir: string): { detections: Detection[] } {
  const detections: Detection[] = [];
  const composer = readJson(path.join(dir, 'composer.json'));
  if (composer) {
    const deps = { ...(composer.require ?? {}), ...(composer['require-dev'] ?? {}) };
    const psr4 = Object.entries(composer.autoload?.['psr-4'] ?? {}).map(([ns, d]) => `PSR-4: ${ns} → ${JSON.stringify(d)}`);
    const php = composer.require?.php ? [`composer.json requires php ${composer.require.php}`] : [];
    if (deps['laravel/framework']) {
      detections.push({ framework: 'laravel', evidence: [`composer.json requires laravel/framework ${deps['laravel/framework']}`, ...php, ...psr4] });
    } else if (deps['symfony/framework-bundle']) {
      const ev = [`composer.json requires symfony/framework-bundle ${deps['symfony/framework-bundle']}`, ...php, ...psr4];
      if (deps['doctrine/orm'] || deps['doctrine/doctrine-bundle']) ev.push('Doctrine ORM present');
      detections.push({ framework: 'symfony', evidence: ev });
    }
  }
  const pkg = readJson(path.join(dir, 'package.json'));
  if (pkg) {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const extra = [
      ...(deps.typescript ? [`typescript ${deps.typescript}`] : []),
      ...(fs.existsSync(path.join(dir, 'tsconfig.json')) ? ['tsconfig.json present'] : []),
      ...ORM_PACKAGES.filter((o) => deps[o]).map((o) => `ORM: ${o} ${deps[o]}`),
    ];
    const order: Array<[string, Framework]> = [['@nestjs/core', 'nestjs'], ['next', 'nextjs'], ['fastify', 'fastify'], ['express', 'express']];
    const hit = order.find(([dep]) => deps[dep]);
    if (hit) detections.push({ framework: hit[1], evidence: [`package.json depends on ${hit[0]} ${deps[hit[0]]}`, ...extra] });
  }
  const pyManifests = ['pyproject.toml', 'requirements.txt', 'requirements/base.txt', 'requirements/production.txt', 'Pipfile', 'setup.cfg', 'setup.py'];
  const py = pyManifests.map((m) => [m, readText(path.join(dir, m))] as const).filter(([, t]) => t);
  if (py.length) {
    const has = (re: RegExp) => py.find(([, t]) => re.test(t!));
    const django = has(/^\s*["']?django\b|["']django[<>=~! \]"']|\bDjango\b/im);
    const fastapi = has(/^\s*["']?fastapi\b|["']fastapi[<>=~! \]"']/im);
    if (django) detections.push({ framework: 'django', evidence: [`${django[0]} lists Django`, ...(fs.existsSync(path.join(dir, 'manage.py')) ? ['manage.py present'] : [])] });
    if (fastapi) detections.push({ framework: 'fastapi', evidence: [`${fastapi[0]} lists FastAPI`] });
  }
  for (const m of ['pom.xml', 'build.gradle', 'build.gradle.kts']) {
    const text = readText(path.join(dir, m));
    if (text && /spring-boot/.test(text)) {
      detections.push({ framework: 'spring', evidence: [`${m} uses Spring Boot`, ...(fs.existsSync(path.join(dir, 'src', 'main', 'java')) ? ['src/main/java present'] : [])] });
      break;
    }
  }
  return { detections };
}

function candidateRoots(root: string): string[] {
  const out = [root];
  const skip = new Set(['node_modules', 'vendor', '.git', 'dist', 'build', 'storage', 'public', 'fixtures', 'test', 'tests']);
  const scan = (dir: string, depth: number) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || skip.has(e.name)) continue;
      const sub = path.join(dir, e.name);
      out.push(sub);
      if (depth > 1 && ['apps', 'packages', 'services'].includes(e.name)) scan(sub, depth - 1);
    }
  };
  scan(root, 2);
  return out;
}

/** Removes a layer and connects its predecessors to its successors. */
function removeLayer(p: ProjectContract, name: string, notes: string[]) {
  const successors = (p.dependencies.allowed_direct[name] ?? []).filter((t) => t !== name);
  delete p.layers[name];
  delete p.dependencies.allowed_direct[name];
  for (const [from, targets] of Object.entries(p.dependencies.allowed_direct)) {
    if (!targets.includes(name)) continue;
    const next = [...new Set([...targets.filter((t) => t !== name), ...successors])].filter((t) => t !== from);
    p.dependencies.allowed_direct[from] = next;
  }
  p.dependencies.shared = p.dependencies.shared.filter((s) => s !== name);
  const orm = p.rules.direct_orm_access;
  if (orm) {
    if (orm.allow_in.includes(name)) {
      // Whoever used to delegate data access to the removed layer now owns it.
      const owners = Object.entries(p.dependencies.allowed_direct)
        .filter(([, targets]) => successors.some((s) => targets.includes(s)) && !targets.includes('*'))
        .map(([from]) => from)
        .filter((from) => orm.deny_in.includes(from) && !successors.includes(from));
      if (owners.length) {
        orm.deny_in = orm.deny_in.filter((l) => !owners.includes(l));
        orm.allow_in = [...new Set([...orm.allow_in, ...owners])];
        notes.push(`No ${name} layer found: ${owners.join(', ')} may access the ORM directly. Review this.`);
      }
    }
    orm.allow_in = orm.allow_in.filter((l) => l !== name);
    orm.deny_in = orm.deny_in.filter((l) => l !== name);
    if (orm.model_layers) orm.model_layers = orm.model_layers.filter((l) => l !== name);
  }
  const cp = p.rules.catch_policy;
  if (cp) cp.discourage_in = cp.discourage_in.filter((l) => l !== name);
}

const SUFFIX_HINTS: Array<[RegExp, string]> = [
  [/Controller\.(php|java)$|\.controller\.(ts|js)$/, 'controller'],
  [/Service(Impl)?\.(php|java)$|\.service\.(ts|js)$|(^|\/)services?\.py$/, 'service'],
  [/Repository\.(php|java)$|\.repository\.(ts|js)$/, 'repository'],
];

function proposeProject(repoRoot: string, dir: string, det: Detection, usedIds: Set<string>): ProposedProject {
  const notes: string[] = [];
  let preset: PresetName = PRESET_FOR[det.framework];
  if (
    det.framework === 'nestjs' &&
    fs.existsSync(path.join(dir, 'src', 'domain')) &&
    (fs.existsSync(path.join(dir, 'src', 'application')) || fs.existsSync(path.join(dir, 'src', 'infrastructure')))
  ) {
    preset = 'nestjs-hexagonal';
    notes.push('src/domain + src/application|infrastructure found: proposing the ports & adapters preset.');
  }
  const project: ProjectContract = structuredClone(loadPreset(preset));
  project.framework = det.framework;
  const rel = toPosix(path.relative(repoRoot, dir)) || '.';
  project.root = rel;
  let id = rel === '.' ? 'api' : path.basename(dir).toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
  while (usedIds.has(id)) id = `${id}-2`;
  usedIds.add(id);
  project.id = id;

  // Pull model / client classes that live outside the conventional folders into the right layer.
  const files = inScopeFiles(dir, project);
  let layerMap = new LayerMap(project.layers);
  for (const file of files) {
    if (layerMap.assign(file).layer) continue;
    let content = '';
    try {
      content = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch {
      continue;
    }
    if (det.framework === 'laravel' && project.layers.model && /class\s+\w+\s+extends\s+\\?(Model|Authenticatable|Illuminate\\Database\\Eloquent\\Model)\b/.test(content)) {
      project.layers.model.push(file);
      notes.push(`${file} extends an Eloquent model outside app/Models: added to the model layer.`);
    }
  }
  if (['nestjs', 'express', 'fastify'].includes(det.framework) && project.layers.persistence) {
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf8');
      if (/extends\s+PrismaClient\b/.test(content) && layerMap.assign(file).layer !== 'persistence') {
        project.layers.persistence.push(file);
        for (const l of Object.keys(project.layers)) if (l !== 'persistence') project.layers[l].push(`!${file}`);
        notes.push(`${file} extends PrismaClient: added to the persistence layer.`);
      }
    }
  }

  // Drop empty layers and unused shared globs.
  layerMap = new LayerMap(project.layers);
  const counts = new Map<string, string[]>();
  for (const file of files) {
    const l = layerMap.assign(file).layer;
    if (l) counts.set(l, [...(counts.get(l) ?? []), file]);
  }
  const removed: string[] = [];
  for (const name of Object.keys(project.layers)) {
    if (!counts.get(name)?.length) {
      removed.push(name);
      removeLayer(project, name, notes);
    }
  }
  for (const s of project.dependencies.shared) {
    project.layers[s] = project.layers[s].filter(
      (g) => {
        if (g.startsWith('!')) return true;
        const match = compileGlobs([g]);
        return files.some(match);
      },
    );
  }

  // Classification report.
  layerMap = new LayerMap(project.layers);
  const unclassified: string[] = [];
  const ambiguous: Array<{ file: string; layers: string[] }> = [];
  const namingMismatches: ProposedProject['namingMismatches'] = [];
  const byLayer = new Map<string, string[]>();
  for (const file of files) {
    const a = layerMap.assign(file);
    if (!a.layer) unclassified.push(file);
    else byLayer.set(a.layer, [...(byLayer.get(a.layer) ?? []), file]);
    if (a.matches.length > 1) ambiguous.push({ file, layers: a.matches });
    for (const [re, looksLike] of SUFFIX_HINTS) {
      if (re.test(file) && a.layer !== looksLike && looksLike in project.layers) {
        namingMismatches.push({ file, looksLike, assigned: a.layer });
      }
    }
  }
  const layers: LayerStat[] = Object.entries(project.layers).map(([name, globs]) => ({
    name,
    globs,
    files: byLayer.get(name)?.length ?? 0,
    examples: (byLayer.get(name) ?? []).slice(0, 3),
  }));
  const coverage = files.length ? (files.length - unclassified.length) / files.length : 0;

  // How does existing code compare with the proposal? (Never used to auto-approve anything.)
  const contradictions = new Map<string, { ruleId: string; edge: string; count: number; example: string }>();
  try {
    const sample = new Set(files.slice(0, SAMPLE_LIMIT));
    const run = analyzeProject(dir, { ...project, root: '.' }, (f) => sample.has(f));
    for (const f of run.findings) {
      if (!['BND001', 'BND002', 'BND003', 'EXC001'].includes(f.ruleId)) continue;
      const edge = f.ruleId === 'BND002' ? `${f.sourceLayer} → data access` : f.ruleId === 'EXC001' ? `catch in ${f.sourceLayer}` : `${f.sourceLayer} → ${f.targetLayer}`;
      const key = `${f.ruleId}|${edge}`;
      const cur = contradictions.get(key) ?? { ruleId: f.ruleId, edge, count: 0, example: `${f.file}${f.line ? `:${f.line}` : ''}` };
      cur.count++;
      contradictions.set(key, cur);
    }
    if (files.length > SAMPLE_LIMIT) notes.push(`Dependency sample limited to ${SAMPLE_LIMIT} of ${files.length} files.`);
  } catch (err) {
    notes.push(`Could not sample dependencies: ${(err as Error).message}`);
  }

  const confidence = coverage >= 0.8 && !ambiguous.length ? 'high' : coverage >= 0.5 ? 'medium' : 'low';
  return {
    project,
    preset,
    evidence: det.evidence,
    layers,
    removedLayers: removed,
    inScope: files.length,
    coverage,
    unclassified,
    ambiguous,
    namingMismatches,
    contradictions: [...contradictions.values()].sort((a, b) => b.count - a.count),
    confidence,
    notes,
  };
}

export function discover(repoRoot: string): DiscoveryResult {
  const root = path.resolve(repoRoot);
  const projects: ProposedProject[] = [];
  const undetermined: DiscoveryResult['undetermined'] = [];
  const usedIds = new Set<string>();
  const claimed: string[] = [];
  for (const dir of candidateRoots(root)) {
    // Nested candidates inside an already detected project are part of that project.
    if (claimed.some((c) => dir.startsWith(c + path.sep))) continue;
    const { detections } = detect(dir);
    if (detections.length === 0) continue;
    const rel = toPosix(path.relative(root, dir)) || '.';
    if (detections.length > 1) {
      undetermined.push({ dir: rel, reason: `both ${detections.map((d) => d.framework).join(' and ')} detected in the same directory` });
      continue;
    }
    projects.push(proposeProject(root, dir, detections[0], usedIds));
    claimed.push(dir); // a project claims every directory below it
  }
  if (!projects.length && !undetermined.length) {
    undetermined.push({ dir: '.', reason: 'no Laravel (composer.json → laravel/framework) or NestJS (package.json → @nestjs/core) project found' });
  }
  return { root, projects, undetermined };
}

export function proposalContract(result: DiscoveryResult): Contract | null {
  if (!result.projects.length) return null;
  return { schema: 1, projects: result.projects.map((p) => p.project) };
}

export function renderProposalYaml(result: DiscoveryResult): string {
  const contract = proposalContract(result);
  const header = [
    '# NoBypass PROPOSED contract — generated by `nobypass init`.',
    '# This file is NOT enforced. Review it (see .nobypass/discovery.txt), edit what is wrong,',
    '# then run `nobypass approve` to write the enforced .nobypass.yml.',
    '# Discovery never treats the most frequent existing pattern as correct: it starts from a preset.',
    '',
  ].join('\n');
  if (!contract) return `${header}# No supported project was detected; nothing to propose.\nschema: 1\nprojects: []\n`;
  return header + YAML.stringify(contract, { lineWidth: 0 });
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function renderReport(result: DiscoveryResult): string {
  const out: string[] = ['NoBypass discovery report', '========================', ''];
  for (const u of result.undetermined) out.push(`UNDETERMINED ${u.dir}: ${u.reason}. Nothing proposed here — configure it manually.`);
  if (result.undetermined.length) out.push('');
  for (const p of result.projects) {
    const pr = p.project;
    out.push(`Project "${pr.id}" — ${pr.framework} (${pr.language}), root ${pr.root}`);
    out.push(`  preset: ${p.preset} · confidence: ${p.confidence} (confidence is not proof of correctness)`);
    out.push('  evidence:');
    for (const e of p.evidence) out.push(`    - ${e}`);
    out.push(`  coverage: ${pct(p.coverage)} of ${p.inScope} in-scope files assigned to a layer`);
    out.push('  layers:');
    for (const l of p.layers) {
      out.push(`    ${l.name.padEnd(12)} ${String(l.files).padStart(4)} files  ${l.globs.slice(0, 4).join(', ')}${l.globs.length > 4 ? `, … (+${l.globs.length - 4})` : ''}`);
      for (const ex of l.examples) out.push(`${' '.repeat(23)}e.g. ${ex}`);
    }
    if (p.removedLayers.length) out.push(`  layers dropped (no files): ${p.removedLayers.join(', ')}`);
    out.push('  proposed allowed direct dependencies:');
    for (const [from, to] of Object.entries(pr.dependencies.allowed_direct)) {
      out.push(`    ${from} → ${to.length ? to.join(', ') : '(nothing)'}`);
    }
    if (pr.dependencies.shared.length) out.push(`    (any layer may use: ${pr.dependencies.shared.join(', ')})`);
    const orm = pr.rules.direct_orm_access;
    if (orm?.enabled) out.push(`  data access: allowed in [${orm.allow_in.join(', ')}], denied in [${orm.deny_in.join(', ')}] (${orm.severity})`);
    const cp = pr.rules.catch_policy;
    if (cp?.enabled) out.push(`  catch policy: discouraged in [${cp.discourage_in.join(', ')}] (${cp.severity})`);
    if (p.contradictions.length) {
      out.push('  ⚠ existing code contradicts the proposal (baseline it or change the contract):');
      for (const c of p.contradictions.slice(0, 15)) out.push(`    ${c.ruleId} ${c.edge}: ${c.count}× (e.g. ${c.example})`);
    } else {
      out.push('  existing code is consistent with the proposal (in the sampled files).');
    }
    if (p.ambiguous.length) {
      out.push('  ambiguous files (match several layers):');
      for (const a of p.ambiguous.slice(0, 15)) out.push(`    ${a.file}: ${a.layers.join(', ')}`);
    }
    if (p.namingMismatches.length) {
      out.push('  naming hints that disagree with placement:');
      for (const m of p.namingMismatches.slice(0, 15)) out.push(`    ${m.file}: named like ${m.looksLike}, assigned to ${m.assigned ?? '(none)'}`);
    }
    if (p.unclassified.length) {
      out.push(`  unclassified files (${p.unclassified.length}):`);
      for (const f of p.unclassified.slice(0, 20)) out.push(`    ${f}`);
      if (p.unclassified.length > 20) out.push(`    … and ${p.unclassified.length - 20} more`);
    }
    for (const n of p.notes) out.push(`  note: ${n}`);
    out.push('');
  }
  out.push('Next: edit .nobypass.proposed.yml if needed, then run `nobypass approve`.');
  return out.join('\n');
}
