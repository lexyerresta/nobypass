import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { runCheck, type CheckResult } from '../src/core/check.js';

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export function tempDir(prefix = 'nobypass-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

export const LARAVEL_COMPOSER = JSON.stringify({
  require: { 'laravel/framework': '^11.0' },
  autoload: { 'psr-4': { 'App\\': 'app/' } },
});

export function laravelContract(overrides: Record<string, unknown> = {}): string {
  const project = {
    id: 'api',
    root: '.',
    language: 'php',
    framework: 'laravel',
    layers: {
      controller: ['app/Http/Controllers/**/*.php'],
      support: ['app/Support/**/*.php'],
      service: ['app/Services/**/*.php'],
      repository: ['app/Repositories/**/*.php'],
      model: ['app/Models/**/*.php'],
      shared: ['app/Http/Requests/**/*.php', 'app/DTOs/**/*.php'],
    },
    dependencies: {
      allowed_direct: {
        controller: ['support'],
        support: ['service'],
        service: ['repository'],
        repository: ['model'],
        model: [],
        shared: ['*'],
      },
      shared: ['shared'],
    },
    rules: {
      direct_orm_access: { enabled: true, deny_in: ['controller', 'support', 'service'], allow_in: ['repository'], severity: 'error' },
      catch_policy: { discourage_in: ['service', 'repository'], severity: 'warning' },
    },
    ...overrides,
  };
  return YAML.stringify({ schema: 1, projects: [project] });
}

export const NEST_PACKAGE = JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0', '@prisma/client': '^5.0.0' } });
export const NEST_TSCONFIG = JSON.stringify({
  compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] }, experimentalDecorators: true },
});

export function nestContract(overrides: Record<string, unknown> = {}): string {
  const project = {
    id: 'api',
    root: '.',
    language: 'typescript',
    framework: 'nestjs',
    layers: {
      controller: ['src/**/*.controller.ts'],
      service: ['src/**/*.service.ts', '!src/prisma/**'],
      repository: ['src/**/*.repository.ts'],
      persistence: ['src/prisma/**/*.ts'],
      shared: ['src/**/*.module.ts', 'src/**/dto/**/*.ts', 'src/main.ts'],
    },
    dependencies: {
      allowed_direct: {
        controller: ['service'],
        service: ['repository'],
        repository: ['persistence'],
        persistence: [],
        shared: ['*'],
      },
      shared: ['shared'],
    },
    rules: {
      direct_orm_access: { enabled: true, deny_in: ['controller', 'service'], allow_in: ['repository', 'persistence'], severity: 'error' },
      catch_policy: { discourage_in: ['service', 'repository'], severity: 'warning' },
    },
    ...overrides,
  };
  return YAML.stringify({ schema: 1, projects: [project] });
}

export const PRISMA_SERVICE = `import { PrismaClient } from '@prisma/client';
export class PrismaService extends PrismaClient {}
`;

/** A minimal Laravel model + repository so references resolve. */
export const LARAVEL_BASE: Record<string, string> = {
  'composer.json': LARAVEL_COMPOSER,
  'app/Models/User.php': `<?php
namespace App\\Models;
use Illuminate\\Database\\Eloquent\\Model;
class User extends Model {}
`,
  'app/Repositories/UserRepository.php': `<?php
namespace App\\Repositories;
use App\\Models\\User;
class UserRepository { public function all() { return User::all(); } }
`,
  'app/Services/UserService.php': `<?php
namespace App\\Services;
use App\\Repositories\\UserRepository;
class UserService { public function __construct(private UserRepository $r) {} public function all() { return $this->r->all(); } }
`,
  'app/Support/UserSupport.php': `<?php
namespace App\\Support;
use App\\Services\\UserService;
class UserSupport { public function __construct(private UserService $s) {} }
`,
};

export const NEST_BASE: Record<string, string> = {
  'package.json': NEST_PACKAGE,
  'tsconfig.json': NEST_TSCONFIG,
  'src/prisma/prisma.service.ts': PRISMA_SERVICE,
  'src/users/users.repository.ts': `import { PrismaService } from '../prisma/prisma.service';
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}
  all() { return this.prisma.user.findMany(); }
}
`,
  'src/users/users.service.ts': `import { UsersRepository } from './users.repository';
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}
  all() { return this.repo.all(); }
}
`,
};

export function project(files: Record<string, string>, contract: string): string {
  const dir = tempDir();
  writeFiles(dir, { ...files, '.nobypass.yml': contract });
  return dir;
}

export function check(dir: string, opts: { since?: string; strict?: boolean } = {}): CheckResult {
  return runCheck({ cwd: dir, ...opts });
}

/** Rule ids of new findings in a file (or all files). */
export function rulesIn(result: CheckResult, file?: string): string[] {
  return result.findings.filter((f) => f.status === 'new' && (!file || f.file === file)).map((f) => f.ruleId).sort();
}

export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', '-c', 'core.autocrlf=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
}

export function initRepo(dir: string): void {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
}
