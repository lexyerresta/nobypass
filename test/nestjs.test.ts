import { describe, expect, it } from 'vitest';
import { NEST_BASE, check, nestContract, project, rulesIn } from './helpers.js';

interface Case {
  name: string;
  file: string;
  code: string;
  expected: string[];
  extra?: Record<string, string>;
  contract?: Record<string, unknown>;
}

const CTRL = 'src/users/users.controller.ts';
const SVC = 'src/users/users.service.ts';
const REPO = 'src/users/users.repository.ts';

const positive: Case[] = [
  {
    name: 'controller injects PrismaService and queries it',
    file: CTRL,
    code: `import { PrismaService } from '../prisma/prisma.service';
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}
  list() { return this.prisma.user.findMany(); }
}`,
    expected: ['BND001', 'BND002'],
  },
  {
    name: 'controller imports a repository, skipping the service',
    file: CTRL,
    code: `import { UsersRepository } from './users.repository';
export class UsersController { constructor(private readonly repo: UsersRepository) {} }`,
    expected: ['BND003'],
  },
  {
    name: 'controller reaches a repository through a tsconfig path alias',
    file: CTRL,
    code: `import { UsersRepository } from '@app/users/users.repository';
export class UsersController { constructor(private readonly repo: UsersRepository) {} }`,
    expected: ['BND003'],
  },
  {
    name: '`import type` of a repository under type_only: enforce',
    file: CTRL,
    code: `import type { UsersRepository } from './users.repository';
export class UsersController { describe(r: UsersRepository) { return r; } }`,
    expected: ['BND003'],
  },
  {
    name: 'service creates its own PrismaClient',
    file: SVC,
    code: `import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export class UsersService { all() { return prisma.user.findMany(); } }`,
    expected: ['BND002', 'BND002'],
  },
  {
    name: 'service injects a TypeORM repository',
    file: SVC,
    code: `import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}
  all() { return this.users.find(); }
}
class User {}`,
    expected: ['BND002'],
  },
  {
    name: 'service injects an EntityManager',
    file: SVC,
    code: `import type { EntityManager } from 'typeorm';
export class UsersService {
  constructor(private readonly em: EntityManager) {}
  raw() { return this.em.query('select 1'); }
}`,
    expected: ['BND002'],
  },
  {
    name: 'service uses $queryRaw through PrismaService',
    file: SVC,
    code: `import { PrismaService } from '../prisma/prisma.service';
export class UsersService {
  constructor(private readonly db: PrismaService) {}
  raw() { return this.db.$queryRaw\`select 1\`; }
}`,
    expected: ['BND002', 'BND003'],
  },
  {
    name: 'controller re-exports from persistence',
    file: CTRL,
    code: `export { PrismaService } from '../prisma/prisma.service';
export class UsersController {}`,
    expected: ['BND001'],
  },
  {
    name: 'controller dynamically imports persistence',
    file: CTRL,
    code: `export class UsersController { async go() { const m = await import('../prisma/prisma.service'); return m; } }`,
    expected: ['BND001'],
  },
  {
    name: 'controller requires persistence',
    file: CTRL,
    code: `const db = require('../prisma/prisma.service');
export class UsersController { go() { return db; } }`,
    expected: ['BND001'],
  },
  {
    name: 'unresolvable relative import',
    file: SVC,
    code: `import { Ghost } from './ghost';
export class UsersService { g = Ghost; }`,
    expected: ['ANL001'],
  },
  {
    name: 'unresolvable path alias',
    file: SVC,
    code: `import { Ghost } from '@app/ghost/ghost.service';
export class UsersService { g = Ghost; }`,
    expected: ['ANL001'],
  },
  {
    name: 'syntax error is never a silent pass',
    file: SVC,
    code: `export class UsersService { all( { return 1; } }`,
    expected: ['ANL001'],
  },
  {
    name: 'computed dynamic import is reported as unverified',
    file: SVC,
    code: `export class UsersService { async load(name: string) { return import(name); } }`,
    expected: ['ANL001'],
  },
  {
    name: 'undocumented catch in a service',
    file: SVC,
    code: `export class UsersService { go() { try { return 1; } catch (e) { return 0; } } }`,
    expected: ['EXC001'],
  },
  {
    name: 'repository depends on a service (forbidden + cycle)',
    file: REPO,
    code: `import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';
export class UsersRepository {
  constructor(private readonly prisma: PrismaService, private readonly s: UsersService) {}
  all() { return this.prisma.user.findMany(); }
}`,
    expected: ['BND001', 'BND004'],
  },
  {
    name: 'file outside every layer',
    file: 'src/utils/strings.ts',
    code: `export const upper = (s: string) => s.toUpperCase();`,
    expected: ['CFG001'],
  },
];

const negative: Case[] = [
  {
    name: 'repository uses PrismaService',
    file: REPO,
    code: NEST_BASE[REPO],
    expected: [],
  },
  {
    name: 'controller → service',
    file: CTRL,
    code: `import { UsersService } from './users.service';
export class UsersController { constructor(private readonly s: UsersService) {} list() { return this.s.all(); } }`,
    expected: [],
  },
  {
    name: 'controller → service via path alias',
    file: CTRL,
    code: `import { UsersService } from '@app/users/users.service';
export class UsersController { constructor(private readonly s: UsersService) {} }`,
    expected: [],
  },
  {
    name: 'DTO from the shared layer',
    file: CTRL,
    code: `import { CreateUserDto } from './dto/create-user.dto';
export class UsersController { create(dto: CreateUserDto) { return dto; } }`,
    extra: { 'src/users/dto/create-user.dto.ts': 'export class CreateUserDto { email!: string; }' },
    expected: [],
  },
  {
    name: 'module wires every layer',
    file: 'src/users/users.module.ts',
    code: `import { PrismaService } from '../prisma/prisma.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
export class UsersModule { static providers = [PrismaService, UsersRepository, UsersService]; }`,
    expected: [],
  },
  {
    name: '`import type` with type_only: ignore',
    file: CTRL,
    code: `import type { UsersRepository } from './users.repository';
export class UsersController { describe(r: UsersRepository) { return r; } }`,
    contract: {
      dependencies: {
        allowed_direct: { controller: ['service'], service: ['repository'], repository: ['persistence'], persistence: [], shared: ['*'] },
        shared: ['shared'],
        type_only: 'ignore',
      },
    },
    expected: [],
  },
  {
    name: 'documented catch in a service',
    file: SVC,
    code: `export class UsersService {
  go() {
    try { return 1; }
    catch (e) { // nobypass-allow EXC001: translate unique-constraint violation into 409
      throw new Error('conflict');
    }
  }
}`,
    expected: [],
  },
  {
    name: 'catch in a controller',
    file: CTRL,
    code: `export class UsersController { go() { try { return 1; } catch { return 0; } } }`,
    expected: [],
  },
  {
    name: 'framework packages are external',
    file: CTRL,
    code: `import { Controller, Get } from '@nestjs/common';
@Controller('u') export class UsersController { @Get() list() { return []; } }`,
    expected: [],
  },
  {
    name: 'Prisma model types in a service (`import type`)',
    file: SVC,
    code: `import type { User } from '@prisma/client';
export class UsersService { name(u: User) { return u.name; } }`,
    expected: [],
  },
  {
    name: 'Prisma namespace types in a service',
    file: SVC,
    code: `import { Prisma } from '@prisma/client';
export class UsersService { input(): Prisma.UserCreateInput { return { email: 'a' } as Prisma.UserCreateInput; } }`,
    expected: [],
  },
  {
    name: 'persistence layer calls its own client',
    file: 'src/prisma/prisma.service.ts',
    code: `import { PrismaClient } from '@prisma/client';
export class PrismaService extends PrismaClient { async onModuleInit() { await this.$connect(); } }`,
    expected: [],
  },
  {
    name: 'a method named catch is not a try/catch',
    file: SVC,
    code: `export class UsersService { catch(exception: unknown) { return exception; } }`,
    expected: [],
  },
  {
    name: 'spec files are excluded',
    file: 'src/users/users.controller.spec.ts',
    code: `import { PrismaService } from '../prisma/prisma.service';
const p = new PrismaService(); p.user.findMany();`,
    contract: { exclude: ['**/*.spec.ts'] },
    expected: [],
  },
];

function run(c: Case) {
  const dir = project({ ...NEST_BASE, ...(c.extra ?? {}), [c.file]: c.code }, nestContract(c.contract));
  return check(dir);
}

describe('NestJS adapter — violations are caught', () => {
  it.each(positive.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    expect(rulesIn(run(c), c.file)).toEqual([...c.expected].sort());
  });
});

describe('NestJS adapter — compliant code passes', () => {
  it.each(negative.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    const result = run(c);
    expect(rulesIn(result, c.file)).toEqual([]);
    expect(result.error).toBeNull();
  });
});

describe('NestJS base project', () => {
  it('is clean on its own', () => {
    const result = check(project(NEST_BASE, nestContract()));
    expect(rulesIn(result)).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});
