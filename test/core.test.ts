import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { mergeIntoInstructions, agentInstructions, skillMarkdown, BLOCK_START, BLOCK_END } from '../src/agents/index.js';
import { approveContract } from '../src/core/approve.js';
import { buildBaseline, writeBaseline } from '../src/core/baseline.js';
import { analyzeProject } from '../src/core/engine.js';
import { ContractError, parseContract } from '../src/core/config.js';
import { formatJson } from '../src/core/format.js';
import { explain } from '../src/core/explain.js';
import { discover, renderProposalYaml } from '../src/discovery/index.js';
import {
  FIXTURES,
  LARAVEL_BASE,
  NEST_BASE,
  check,
  git,
  initRepo,
  laravelContract,
  nestContract,
  project,
  rulesIn,
  tempDir,
  writeFiles,
} from './helpers.js';

const CONTROLLER_QUERY = `<?php
namespace App\\Http\\Controllers;
use App\\Models\\User;
class UserController { public function i() { return User::where("a", 1)->get(); } }
`;

function copyFixture(name: string): string {
  const dir = tempDir(`nobypass-${name}-`);
  fs.cpSync(path.join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else out[r] = fs.readFileSync(path.join(dir, r), 'utf8');
    }
  };
  walk('');
  return out;
}

describe('contract validation', () => {
  const base = YAML.parse(laravelContract());
  const parse = (mutate: (c: any) => void) => {
    const c = structuredClone(base);
    mutate(c);
    return () => parseContract(YAML.stringify(c), 'test.yml');
  };
  const issues = (fn: () => unknown): string => {
    try {
      fn();
    } catch (err) {
      return [(err as ContractError).message, ...((err as ContractError).issues ?? [])].join('\n');
    }
    return '';
  };

  it('accepts the example contract', () => {
    expect(parse(() => {})).not.toThrow();
  });
  it('rejects references to unknown layers', () => {
    expect(parse((c) => (c.projects[0].dependencies.allowed_direct.controller = ['nope']))).toThrow(ContractError);
  });
  it('requires an allowed_direct entry for every layer', () => {
    expect(issues(parse((c) => delete c.projects[0].dependencies.allowed_direct.model))).toMatch(/"model" has no dependencies.allowed_direct entry/);
  });
  it('requires a reason on every exception', () => {
    expect(parse((c) => (c.projects[0].exceptions = [{ rule: 'BND002', path: 'x', reason: '' }]))).toThrow(ContractError);
  });
  it('rejects layers that are both denied and allowed ORM access', () => {
    expect(issues(parse((c) => (c.projects[0].rules.direct_orm_access.allow_in = ['repository', 'service'])))).toMatch(/both denied and allowed ORM access: service/);
  });
  it('rejects unknown keys (typos are not silently ignored)', () => {
    expect(parse((c) => (c.projects[0].rulez = {}))).toThrow(ContractError);
  });
  it('rejects roots outside the repository', () => {
    expect(issues(parse((c) => (c.projects[0].root = '../elsewhere')))).toMatch(/inside the repository/);
  });
});

describe('exit codes', () => {
  it('3 when there is no contract', () => {
    const dir = tempDir();
    writeFiles(dir, LARAVEL_BASE);
    expect(check(dir).exitCode).toBe(3);
  });
  it('3 when only a proposal exists', () => {
    const dir = tempDir();
    writeFiles(dir, { ...LARAVEL_BASE, '.nobypass.proposed.yml': laravelContract() });
    const r = check(dir);
    expect(r.exitCode).toBe(3);
    expect(r.error).toMatch(/not been approved/);
  });
  it('2 for an invalid contract', () => {
    const dir = tempDir();
    writeFiles(dir, { ...LARAVEL_BASE, '.nobypass.yml': 'schema: 1\nprojects: []\n' });
    expect(check(dir).exitCode).toBe(2);
  });
  it('2 when analysis fails on a relevant file (no silent PASS)', () => {
    const dir = project({ ...LARAVEL_BASE, 'app/Services/Broken.php': '<?php class {' }, laravelContract());
    expect(check(dir).exitCode).toBe(2);
  });
  it('1 for new error-level violations, 0 when clean', () => {
    expect(check(project({ ...LARAVEL_BASE, 'app/Http/Controllers/UserController.php': CONTROLLER_QUERY }, laravelContract())).exitCode).toBe(1);
    expect(check(project(LARAVEL_BASE, laravelContract())).exitCode).toBe(0);
  });
  it('warnings only block with --strict', () => {
    const dir = project({ ...LARAVEL_BASE, 'app/Helpers/X.php': '<?php\nnamespace App\\Helpers;\nclass X {}\n' }, laravelContract());
    expect(check(dir).exitCode).toBe(0);
    expect(check(dir, { strict: true }).exitCode).toBe(1);
  });
});

describe('baseline', () => {
  it('turns reviewed legacy violations into known debt, but still catches new duplicates', () => {
    const dir = project({ ...LARAVEL_BASE, 'app/Http/Controllers/UserController.php': CONTROLLER_QUERY }, laravelContract());
    const contract = parseContract(fs.readFileSync(path.join(dir, '.nobypass.yml'), 'utf8'), 'c');
    const run = analyzeProject(dir, contract.projects[0]);
    writeBaseline(path.join(dir, '.nobypass/baseline.json'), buildBaseline(run.findings, 'test'));
    const known = check(dir);
    expect(known.exitCode).toBe(0);
    expect(known.findings.every((f) => f.status === 'known')).toBe(true);

    fs.writeFileSync(
      path.join(dir, 'app/Http/Controllers/UserController.php'),
      CONTROLLER_QUERY.replace('return User::where("a", 1)->get();', '$x = User::where("b", 2)->get(); return User::where("a", 1)->get();'),
    );
    const after = check(dir);
    expect(after.exitCode).toBe(1);
    expect(after.findings.filter((f) => f.status === 'new').map((f) => f.ruleId)).toEqual(['BND002']);
  });

  it('never baselines analysis failures', () => {
    const findings = check(project({ ...LARAVEL_BASE, 'app/Services/Broken.php': '<?php class {' }, laravelContract())).findings;
    expect(buildBaseline(findings).entries.find((e) => e.ruleId === 'ANL001')).toBeUndefined();
  });

  it('fingerprints ignore line numbers', () => {
    const a = check(project({ ...LARAVEL_BASE, 'app/Http/Controllers/UserController.php': CONTROLLER_QUERY }, laravelContract()));
    const b = check(project({ ...LARAVEL_BASE, 'app/Http/Controllers/UserController.php': '\n\n\n' + CONTROLLER_QUERY.replace('<?php\n', '<?php\n\n\n') }, laravelContract()));
    expect(a.findings.map((f) => f.fingerprint).sort()).toEqual(b.findings.map((f) => f.fingerprint).sort());
    expect(a.findings[0].line).not.toBe(b.findings[0].line);
  });
});

describe('--since (changed-code enforcement)', () => {
  function legacyRepo() {
    const dir = project({ ...LARAVEL_BASE, 'app/Http/Controllers/UserController.php': CONTROLLER_QUERY }, laravelContract());
    initRepo(dir);
    return dir;
  }

  it('does not fail on violations that already exist at the base', () => {
    const dir = legacyRepo();
    const r = check(dir, { since: 'main' });
    expect(r.exitCode).toBe(0);
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings.every((f) => f.status === 'known')).toBe(true);
  });

  it('fails on a new violation in a previously non-compliant file (uncommitted edit)', () => {
    const dir = legacyRepo();
    fs.writeFileSync(
      path.join(dir, 'app/Http/Controllers/UserController.php'),
      CONTROLLER_QUERY.replace('class UserController {', 'use Illuminate\\Support\\Facades\\DB;\nclass UserController { public function j() { return DB::table("t")->get(); }'),
    );
    const r = check(dir, { since: 'main' });
    expect(r.exitCode).toBe(1);
    expect(r.findings.filter((f) => f.blocking).map((f) => f.symbol)).toEqual(['DB::table']);
  });

  it('fails on violations in new, untracked files', () => {
    const dir = legacyRepo();
    writeFiles(dir, {
      'app/Http/Controllers/Admin/StatsController.php': `<?php\nnamespace App\\Http\\Controllers\\Admin;\nuse Illuminate\\Support\\Facades\\DB;\nclass StatsController { public function i() { return DB::select("select 1"); } }\n`,
    });
    const r = check(dir, { since: 'main' });
    expect(r.exitCode).toBe(1);
    expect(rulesIn(r, 'app/Http/Controllers/Admin/StatsController.php')).toEqual(['BND002']);
  });

  it('works against committed branch changes', () => {
    const dir = legacyRepo();
    git(dir, 'checkout', '-q', '-b', 'feature');
    writeFiles(dir, { 'app/Services/UserService.php': LARAVEL_BASE['app/Services/UserService.php'].replace('class UserService', 'use Illuminate\\Support\\Facades\\DB;\nclass UserService').replace('public function all()', 'public function raw() { return DB::table("x")->get(); } public function all()') });
    git(dir, 'commit', '-qam', 'agent change');
    const r = check(dir, { since: 'main' });
    expect(r.exitCode).toBe(1);
    expect(rulesIn(r, 'app/Services/UserService.php')).toEqual(['BND002']);
  });

  it('reports a newly introduced cycle', () => {
    const dir = project(LARAVEL_BASE, laravelContract());
    initRepo(dir);
    fs.writeFileSync(
      path.join(dir, 'app/Repositories/UserRepository.php'),
      `<?php\nnamespace App\\Repositories;\nuse App\\Models\\User;\nuse App\\Services\\UserService;\nclass UserRepository { public function all(UserService $s) { return User::all(); } }\n`,
    );
    const r = check(dir, { since: 'main' });
    expect(rulesIn(r)).toEqual(['BND001', 'BND004']);
  });

  it('flags contract changes for human review', () => {
    const dir = legacyRepo();
    fs.appendFileSync(path.join(dir, '.nobypass.yml'), '\n# edited by an agent\n');
    expect(check(dir, { since: 'main' }).notices.join('\n')).toMatch(/contract changes require human review/);
  });

  it('exits 2 for an unknown ref', () => {
    const dir = legacyRepo();
    expect(check(dir, { since: 'does-not-exist' }).exitCode).toBe(2);
  });

  // Windows CI runners use 8.3 short temp paths (C:\Users\RUNNER~1) while git reports long paths.
  it.skipIf(process.platform !== 'win32')('matches changed files when the working directory is an 8.3 short path', () => {
    const dir = legacyRepo();
    const short = spawnSync('cmd', ['/d', '/s', '/c', `"for %I in ("${dir}") do @echo %~sI"`], {
      encoding: 'utf8',
      windowsVerbatimArguments: true,
    }).stdout.trim();
    expect(fs.existsSync(short)).toBe(true);
    fs.writeFileSync(
      path.join(dir, 'app/Http/Controllers/UserController.php'),
      CONTROLLER_QUERY.replace('class UserController {', 'use Illuminate\\Support\\Facades\\DB;\nclass UserController { public function j() { return DB::table("t")->get(); }'),
    );
    const r = check(short, { since: 'main' });
    expect(r.exitCode).toBe(1);
    expect(r.findings.filter((f) => f.blocking).map((f) => f.symbol)).toEqual(['DB::table']);
  });
});

describe('fixtures', () => {
  it.each([
    ['laravel-valid', 0],
    ['laravel-violations', 1],
    ['nestjs-valid', 0],
    ['nestjs-violations', 1],
  ] as const)('%s exits %i', (name, code) => {
    expect(check(path.join(FIXTURES, name)).exitCode).toBe(code);
  });

  it('laravel-violations reports the documented rules', () => {
    const r = check(path.join(FIXTURES, 'laravel-violations'));
    expect([...new Set(rulesIn(r))]).toEqual(['BND001', 'BND002', 'BND003', 'BND004', 'CFG001', 'EXC001']);
  });

  it('nestjs-violations reports the documented rules', () => {
    const r = check(path.join(FIXTURES, 'nestjs-violations'));
    expect([...new Set(rulesIn(r))]).toEqual(['BND001', 'BND002', 'BND003', 'EXC001']);
  });

  it('produces deterministic JSON with the full finding contract', () => {
    const a = formatJson(check(path.join(FIXTURES, 'laravel-violations')));
    const b = formatJson(check(path.join(FIXTURES, 'laravel-violations')));
    expect(a).toBe(b);
    const finding = JSON.parse(a).findings[0];
    for (const key of ['ruleId', 'severity', 'file', 'line', 'sourceLayer', 'targetLayer', 'symbol', 'evidence', 'expected', 'suggestion', 'confidence', 'fingerprint']) {
      expect(finding).toHaveProperty(key);
    }
  });

  it('explain points at the approved flow', () => {
    const res = explain(path.join(FIXTURES, 'laravel-violations'), 'BND002', 'app/Http/Controllers/UserController.php');
    expect(res.findings).toHaveLength(1);
    expect(res.text).toContain('controller → service → repository');
  });
});

describe('discovery', () => {
  it('proposes a Laravel contract with evidence and leaves source untouched', () => {
    const dir = copyFixture('laravel-violations');
    fs.rmSync(path.join(dir, '.nobypass.yml'));
    const before = snapshot(dir);
    const result = discover(dir);
    expect(snapshot(dir)).toEqual(before);
    expect(result.projects).toHaveLength(1);
    const p = result.projects[0];
    expect(p.project.framework).toBe('laravel');
    expect(p.evidence.join('\n')).toContain('laravel/framework');
    expect(p.unclassified).toEqual([]);
    expect(p.layers.find((l) => l.name === 'shared')?.globs).toContain('app/Helpers/**/*.php');
    expect(p.project.dependencies.allowed_direct.controller).toEqual(['service']);
    expect(p.contradictions.length).toBeGreaterThan(0);
    // The proposal must be a valid contract.
    expect(() => parseContract(renderProposalYaml(result), 'proposal')).not.toThrow();
  });

  it('re-wires the chain when a layer does not exist and hands ORM access to the new owner', () => {
    const dir = tempDir();
    const files = { ...LARAVEL_BASE };
    delete files['app/Support/UserSupport.php'];
    delete files['app/Repositories/UserRepository.php'];
    writeFiles(dir, {
      ...files,
      'app/Services/UserService.php': '<?php\nnamespace App\\Services;\nuse App\\Models\\User;\nclass UserService { public function all() { return User::all(); } }\n',
      'app/Http/Controllers/UserController.php': '<?php\nnamespace App\\Http\\Controllers;\nuse App\\Services\\UserService;\nclass UserController { public function __construct(private UserService $s) {} }\n',
    });
    const p = discover(dir).projects[0];
    expect(p.project.dependencies.allowed_direct.controller).toEqual(['service']);
    expect(p.project.dependencies.allowed_direct.service).toEqual(['model']);
    expect(p.project.rules.direct_orm_access?.allow_in).toContain('service');
    expect(p.contradictions).toEqual([]);
  });

  it('finds Eloquent models outside app/Models', () => {
    const dir = tempDir();
    writeFiles(dir, { ...LARAVEL_BASE, 'app/User.php': '<?php\nnamespace App;\nuse Illuminate\\Foundation\\Auth\\User as Authenticatable;\nclass User extends Authenticatable {}\n' });
    expect(discover(dir).projects[0].project.layers.model).toContain('app/User.php');
  });

  it('proposes NestJS layers and detects Prisma clients', () => {
    const dir = tempDir();
    writeFiles(dir, { ...NEST_BASE, 'src/db/client.ts': "import { PrismaClient } from '@prisma/client';\nexport class Db extends PrismaClient {}\n" });
    const p = discover(dir).projects[0];
    expect(p.project.framework).toBe('nestjs');
    expect(p.project.layers.persistence).toContain('src/db/client.ts');
    expect(p.project.rules.direct_orm_access?.deny_in).toEqual(['service']);
  });

  it('refuses to guess when both frameworks share a directory', () => {
    const dir = tempDir();
    writeFiles(dir, { 'composer.json': LARAVEL_BASE['composer.json'], 'package.json': NEST_BASE['package.json'] });
    const r = discover(dir);
    expect(r.projects).toHaveLength(0);
    expect(r.undetermined[0].reason).toMatch(/both/);
  });

  it('detects projects in a monorepo', () => {
    const dir = tempDir();
    const prefix = (p: string, files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [`${p}/${k}`, v]));
    writeFiles(dir, { ...prefix('backend', LARAVEL_BASE), ...prefix('apps/api', NEST_BASE) });
    const r = discover(dir);
    expect(r.projects.map((p) => [p.project.root, p.project.framework]).sort()).toEqual([
      ['apps/api', 'nestjs'],
      ['backend', 'laravel'],
    ]);
  });
});

describe('approve', () => {
  it('records who approved and validates the proposal', () => {
    const { contract, text } = approveContract(laravelContract(), { by: 'alice', at: new Date('2026-01-01T00:00:00Z') });
    expect(contract.approved_by).toBe('alice');
    expect(parseContract(text, 'x').approved_at).toBe('2026-01-01T00:00:00.000Z');
  });
  it('refuses an empty or invalid proposal', () => {
    expect(() => approveContract('schema: 1\nprojects: []\n', { by: 'a' })).toThrow(ContractError);
  });
});

describe('agent guidance', () => {
  const contract = parseContract(nestContract(), 'c');
  const body = agentInstructions(contract);

  it('describes the contract and the check command', () => {
    expect(body).toContain('npx nobypass check --since origin/main');
    expect(body).toContain('`controller` → `service`');
    expect(body).toMatch(/Never edit `.nobypass.yml`/);
  });
  it('creates, appends, replaces and leaves existing instructions intact', () => {
    expect(mergeIntoInstructions(null, body).action).toBe('create');
    const appended = mergeIntoInstructions('# Team rules\n', body);
    expect(appended.action).toBe('append');
    expect(appended.content.startsWith('# Team rules\n')).toBe(true);
    const replaced = mergeIntoInstructions(appended.content.replace('origin/main', 'old'), body);
    expect(replaced.action).toBe('replace');
    expect(replaced.content.split(BLOCK_START)).toHaveLength(2);
    expect(replaced.content.endsWith(`${BLOCK_END}\n`)).toBe(true);
    expect(mergeIntoInstructions(replaced.content, body).action).toBe('unchanged');
  });
  it('produces a valid Agent Skill', () => {
    const skill = skillMarkdown(contract);
    expect(skill).toMatch(/^---\nname: nobypass\ndescription: .+\n---\n/);
  });
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli', 'index.js');

describe.skipIf(!fs.existsSync(CLI))('CLI (built)', () => {
  const cli = (cwd: string, ...args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, CI: '1', NO_COLOR: '1' } });

  it('init writes only the proposal and the report', () => {
    const dir = copyFixture('nestjs-violations');
    fs.rmSync(path.join(dir, '.nobypass.yml'));
    const before = snapshot(dir);
    const res = cli(dir, 'init');
    expect(res.status).toBe(0);
    const after = snapshot(dir);
    const added = Object.keys(after).filter((k) => !(k in before)).sort();
    expect(added).toEqual(['.nobypass.proposed.yml', '.nobypass/discovery.txt']);
    for (const k of Object.keys(before)) expect(after[k]).toBe(before[k]);
  });

  it('approve refuses to run in CI', () => {
    const dir = copyFixture('nestjs-valid');
    fs.renameSync(path.join(dir, '.nobypass.yml'), path.join(dir, '.nobypass.proposed.yml'));
    const res = cli(dir, 'approve');
    expect(res.status).toBe(2);
    expect(fs.existsSync(path.join(dir, '.nobypass.yml'))).toBe(false);
  });

  it('baseline create refuses to run in CI', () => {
    const res = cli(copyFixture('laravel-violations'), 'baseline', 'create', '--yes');
    expect(res.status).toBe(2);
  });

  it('check exits non-zero with JSON output', () => {
    const res = cli(path.join(FIXTURES, 'laravel-violations'), 'check', '--format', 'json');
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).summary.blocking).toBe(7);
  });

  it('agents generate does not touch an existing file without consent', () => {
    const dir = copyFixture('laravel-valid');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Mine\n');
    const res = cli(dir, 'agents', 'generate');
    expect(res.status).toBe(2);
    expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toBe('# Mine\n');
  });
});

// Keep execFileSync referenced for environments where git is missing: fail loudly, not silently.
execFileSync('git', ['--version']);
