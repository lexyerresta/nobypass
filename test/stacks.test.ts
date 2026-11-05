import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { discover, renderProposalYaml } from '../src/discovery/index.js';
import { parseContract } from '../src/core/config.js';
import { FIXTURES, check, project, rulesIn, tempDir } from './helpers.js';

const PRESETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'presets');
const preset = (name: string) => fs.readFileSync(path.join(PRESETS, `${name}.yml`), 'utf8');

const STACKS: Array<{ fixture: string; framework: string; violations: string[] }> = [
  { fixture: 'symfony', framework: 'symfony', violations: ['BND002', 'BND003', 'EXC001'] },
  { fixture: 'express', framework: 'express', violations: ['BND001', 'BND002', 'BND003', 'EXC001'] },
  { fixture: 'nextjs', framework: 'nextjs', violations: ['BND002', 'BND003'] },
  { fixture: 'django', framework: 'django', violations: ['BND002', 'BND003', 'EXC001'] },
  { fixture: 'fastapi', framework: 'fastapi', violations: ['BND001', 'BND002', 'EXC001'] },
  { fixture: 'spring', framework: 'spring', violations: ['BND002', 'BND003', 'EXC001'] },
];

describe('stack fixtures (contract = preset)', () => {
  it.each(STACKS.map((s) => [s.fixture, s] as const))('%s-valid passes and %s-violations fails with the planted rules', (_n, s) => {
    const valid = check(path.join(FIXTURES, `${s.fixture}-valid`));
    expect(valid.findings.filter((f) => f.status === 'new')).toEqual([]);
    expect(valid.exitCode).toBe(0);
    const bad = check(path.join(FIXTURES, `${s.fixture}-violations`));
    expect(bad.exitCode).toBe(1);
    expect([...new Set(rulesIn(bad))]).toEqual(s.violations);
  });

  it.each(STACKS.map((s) => [s.fixture, s] as const))('discovery detects %s and proposes a valid contract', (_n, s) => {
    const dir = tempDir();
    fs.cpSync(path.join(FIXTURES, `${s.fixture}-violations`), dir, { recursive: true });
    fs.rmSync(path.join(dir, '.nobypass.yml'));
    const result = discover(dir);
    expect(result.projects.map((p) => p.project.framework)).toEqual([s.framework]);
    expect(() => parseContract(renderProposalYaml(result), 'proposal')).not.toThrow();
    expect(result.projects[0].contradictions.length).toBeGreaterThan(0);
  });
});

describe('discovery precedence', () => {
  it('NestJS wins over its Express dependency', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { '@nestjs/core': '^10', express: '^4' } }));
    expect(discover(dir).projects[0].project.framework).toBe('nestjs');
  });
  it('Laravel wins over Symfony components', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'composer.json'), JSON.stringify({ require: { 'laravel/framework': '^11', 'symfony/framework-bundle': '^7' } }));
    expect(discover(dir).projects[0].project.framework).toBe('laravel');
  });
  it('Django and FastAPI in one manifest are ambiguous, not guessed', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'django==5.1\nfastapi==0.115\n');
    const r = discover(dir);
    expect(r.projects).toHaveLength(0);
    expect(r.undetermined[0].reason).toMatch(/both/);
  });
});

interface Case {
  name: string;
  file: string;
  code: string;
  expected: string[];
  extra?: Record<string, string>;
}

function suite(title: string, base: Record<string, string>, contract: string, cases: Case[]) {
  describe(title, () => {
    it.each(cases.map((c) => [c.name, c] as const))('%s', (_n, c) => {
      const dir = project({ ...base, ...(c.extra ?? {}), [c.file]: c.code }, contract);
      expect(rulesIn(check(dir), c.file)).toEqual([...c.expected].sort());
    });
  });
}

// ---------------------------------------------------------------- Python
const DJANGO_BASE = {
  'requirements.txt': 'Django==5.1\n',
  'shop/__init__.py': '',
  'shop/models.py': 'from django.db import models\n\nclass Order(models.Model):\n    total = models.IntegerField()\n',
  'shop/services.py': 'from .models import Order\n\ndef open_orders():\n    return Order.objects.filter(total__gt=0)\n',
};
suite('Python adapter (Django)', DJANGO_BASE, preset('django'), [
  { name: 'view queries the ORM through a model', file: 'shop/views.py', code: 'from .models import Order\n\ndef index(request):\n    return Order.objects.all()\n', expected: ['BND002', 'BND003'] },
  { name: 'absolute import of the model module', file: 'shop/views.py', code: 'import shop.models\n\ndef index(request):\n    return shop.models.Order.objects.count()\n', expected: ['BND002', 'BND003'] },
  { name: 'raw SQL through django.db.connection', file: 'shop/views.py', code: 'from django.db import connection\n\ndef index(request):\n    with connection.cursor() as c:\n        c.execute("select 1")\n', expected: ['BND002'] },
  { name: 'undocumented except in a service', file: 'shop/services.py', code: 'def go():\n    try:\n        return 1\n    except Exception:\n        return 0\n', expected: ['EXC001'] },
  { name: 'unresolvable project import', file: 'shop/views.py', code: 'from shop.ghost import thing\n', expected: ['ANL001'] },
  { name: 'syntax error is never a silent pass', file: 'shop/views.py', code: 'def index(request:\n    return 1\n', expected: ['ANL001'] },
  { name: 'computed importlib module is unverified', file: 'shop/views.py', code: 'import importlib\n\ndef load(name):\n    return importlib.import_module(name)\n', expected: ['ANL001'] },
  { name: 'view calls a service (compliant)', file: 'shop/views.py', code: 'from . import services\n\ndef index(request):\n    return services.open_orders()\n', expected: [] },
  { name: 'service queries the ORM (compliant)', file: 'shop/services.py', code: 'from .models import Order\n\ndef total():\n    return Order.objects.count()\n', expected: [] },
  { name: 'TYPE_CHECKING import is type-only (compliant)', file: 'shop/views.py', code: 'from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    from .models import Order\n\ndef index(request, order: "Order"):\n    return order\n', expected: [] },
  { name: 'documented except (compliant)', file: 'shop/services.py', code: 'def go():\n    try:\n        return 1\n    except KeyError:  # nobypass-allow EXC001: missing key means no discount\n        return 0\n', expected: [] },
  { name: 'third-party packages are external (compliant)', file: 'shop/views.py', code: 'import requests\nfrom rest_framework.response import Response\n\ndef index(request):\n    return Response(requests.get("x").json())\n', expected: [] },
]);

const FASTAPI_BASE = {
  'requirements.txt': 'fastapi==0.115\nsqlalchemy==2.0\n',
  'app/models/user.py': 'class User:\n    pass\n',
  'app/repositories/users.py': 'from sqlalchemy.orm import Session\nfrom app.models.user import User\n\ndef all_users(db: Session):\n    return db.query(User).all()\n',
  'app/services/users.py': 'from app.repositories import users\n\ndef emails(db):\n    return [u.email for u in users.all_users(db)]\n',
  'app/db/session.py': 'def get_db():\n    yield None\n',
};
suite('Python adapter (FastAPI)', FASTAPI_BASE, preset('fastapi'), [
  { name: 'router queries an injected session', file: 'app/routers/users.py', code: 'from fastapi import Depends\nfrom sqlalchemy.orm import Session\nfrom app.db.session import get_db\n\ndef list_users(db: Session = Depends(get_db)):\n    return db.execute("select 1")\n', expected: ['BND002'] },
  { name: 'session from Depends(get_db) without a type hint', file: 'app/routers/users.py', code: 'from fastapi import Depends\nfrom app.db.session import get_db\n\ndef list_users(db=Depends(get_db)):\n    return db.query(1)\n', expected: ['BND002'] },
  { name: 'service opens its own session', file: 'app/services/users.py', code: 'from sqlalchemy.orm import Session\n\ndef go(engine):\n    with Session(engine) as session:\n        return session.scalars(1)\n', expected: ['BND002'] },
  { name: 'router imports a repository, skipping the service', file: 'app/routers/users.py', code: 'from app.repositories import users\n\ndef list_users():\n    return users\n', expected: ['BND003'] },
  { name: 'router passes the session to a service (compliant)', file: 'app/routers/users.py', code: 'from fastapi import Depends\nfrom sqlalchemy.orm import Session\nfrom app.db.session import get_db\nfrom app.services import users\n\ndef list_users(db: Session = Depends(get_db)):\n    return users.emails(db)\n', expected: [] },
]);

// ---------------------------------------------------------------- Java
const J = 'src/main/java/com/acme';
const SPRING_BASE = {
  'pom.xml': '<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>\n',
  [`${J}/entity/Order.java`]: 'package com.acme.entity;\n\npublic class Order {}\n',
  [`${J}/repository/OrderRepository.java`]: 'package com.acme.repository;\n\nimport com.acme.entity.Order;\n\npublic interface OrderRepository {}\n',
  [`${J}/service/OrderService.java`]: 'package com.acme.service;\n\nimport com.acme.repository.OrderRepository;\n\npublic class OrderService { private final OrderRepository repo; public OrderService(OrderRepository repo) { this.repo = repo; } }\n',
};
const C = `${J}/controller/OrderController.java`;
suite('Java adapter (Spring Boot)', SPRING_BASE, preset('spring'), [
  { name: 'controller injects a repository', file: C, code: 'package com.acme.controller;\n\nimport com.acme.repository.OrderRepository;\n\npublic class OrderController { public OrderController(OrderRepository r) {} }\n', expected: ['BND003'] },
  { name: 'wildcard import still resolves the used class', file: C, code: 'package com.acme.controller;\n\nimport com.acme.repository.*;\n\npublic class OrderController { private OrderRepository r; }\n', expected: ['BND003'] },
  { name: 'fully used EntityManager in a controller', file: C, code: 'package com.acme.controller;\n\nimport jakarta.persistence.EntityManager;\n\npublic class OrderController { private final EntityManager em; public OrderController(EntityManager em) { this.em = em; } public Object all() { return this.em.createQuery("x").getResultList(); } }\n', expected: ['BND002'] },
  { name: 'JdbcTemplate in a service', file: `${J}/service/OrderService.java`, code: 'package com.acme.service;\n\nimport org.springframework.jdbc.core.JdbcTemplate;\n\npublic class OrderService { private final JdbcTemplate jdbc; public OrderService(JdbcTemplate jdbc) { this.jdbc = jdbc; } public Object go() { return jdbc.queryForList("select 1"); } }\n', expected: ['BND002'] },
  { name: 'undocumented catch in a service', file: `${J}/service/OrderService.java`, code: 'package com.acme.service;\n\npublic class OrderService { public int go() { try { return 1; } catch (RuntimeException e) { return 0; } } }\n', expected: ['EXC001'] },
  { name: 'unresolvable project import', file: C, code: 'package com.acme.controller;\n\nimport com.acme.ghost.Missing;\n\npublic class OrderController {}\n', expected: ['ANL001'] },
  { name: 'syntax error is never a silent pass', file: C, code: 'package com.acme.controller;\n\npublic class OrderController { public void x( { }\n', expected: ['ANL001'] },
  { name: 'controller uses a service (compliant)', file: C, code: 'package com.acme.controller;\n\nimport com.acme.service.OrderService;\n\npublic class OrderController { public OrderController(OrderService s) {} }\n', expected: [] },
  { name: 'repository uses the entity (compliant)', file: `${J}/repository/OrderRepository.java`, code: 'package com.acme.repository;\n\nimport com.acme.entity.Order;\n\npublic interface OrderRepository { Order find(); }\n', expected: [] },
  { name: 'documented catch (compliant)', file: `${J}/service/OrderService.java`, code: 'package com.acme.service;\n\npublic class OrderService { public int go() { try { return 1; } catch (IllegalStateException e) { // nobypass-allow EXC001: wrap as a domain error\n throw new IllegalArgumentException(e); } } }\n', expected: [] },
  { name: 'framework imports are external (compliant)', file: C, code: 'package com.acme.controller;\n\nimport org.springframework.web.bind.annotation.RestController;\nimport java.util.List;\n\n@RestController\npublic class OrderController { List<String> x; }\n', expected: [] },
]);

// ---------------------------------------------------------------- PHP (Symfony)
const SYM_BASE = {
  'composer.json': JSON.stringify({ require: { 'symfony/framework-bundle': '^7' }, autoload: { 'psr-4': { 'App\\': 'src/' } } }),
  'src/Entity/Order.php': '<?php\nnamespace App\\Entity;\nclass Order {}\n',
  'src/Repository/OrderRepository.php': '<?php\nnamespace App\\Repository;\nclass OrderRepository {}\n',
};
suite('PHP adapter (Symfony / Doctrine)', SYM_BASE, preset('symfony'), [
  { name: 'controller flushes through an injected EntityManager', file: 'src/Controller/OrderController.php', code: '<?php\nnamespace App\\Controller;\nuse Doctrine\\ORM\\EntityManagerInterface;\nclass OrderController { public function __construct(private EntityManagerInterface $em) {} public function save() { $this->em->flush(); } }\n', expected: ['BND002'] },
  { name: 'method-injected EntityManager in a service', file: 'src/Service/OrderService.php', code: '<?php\nnamespace App\\Service;\nuse Doctrine\\ORM\\EntityManagerInterface;\nclass OrderService { public function save(EntityManagerInterface $em) { $em->persist(1); } }\n', expected: ['BND002'] },
  { name: 'DBAL connection in a controller', file: 'src/Controller/OrderController.php', code: '<?php\nnamespace App\\Controller;\nuse Doctrine\\DBAL\\Connection;\nclass OrderController { public function __construct(private Connection $db) {} public function n() { return $this->db->fetchOne("select 1"); } }\n', expected: ['BND002'] },
  { name: 'service creates an entity (compliant: entities are plain objects)', file: 'src/Service/OrderService.php', code: '<?php\nnamespace App\\Service;\nuse App\\Entity\\Order;\nclass OrderService { public function make() { return new Order(); } }\n', expected: [] },
  { name: 'repository uses the EntityManager (compliant)', file: 'src/Repository/OrderRepository.php', code: '<?php\nnamespace App\\Repository;\nuse Doctrine\\ORM\\EntityManagerInterface;\nclass OrderRepository { public function __construct(private EntityManagerInterface $em) {} public function save() { $this->em->flush(); } }\n', expected: [] },
]);

// ---------------------------------------------------------------- TypeScript / JavaScript (Express, Next.js)
const EXP_BASE = {
  'package.json': JSON.stringify({ type: 'module', dependencies: { express: '^4', mongoose: '^8' } }),
  'src/models/order.js': "import mongoose from 'mongoose';\nexport const Order = mongoose.model('Order', new mongoose.Schema({}));\n",
  'src/repositories/orderRepository.js': "import { Order } from '../models/order.js';\nexport const all = () => Order.find();\n",
  'src/services/orderService.js': "import { all } from '../repositories/orderRepository.js';\nexport const list = () => all();\n",
};
suite('TS/JS adapter (Express + Mongoose)', EXP_BASE, preset('node-api'), [
  { name: 'controller queries a Mongoose model', file: 'src/controllers/orderController.js', code: "import { Order } from '../models/order.js';\nexport const index = async (req, res) => res.json(await Order.find({}));\n", expected: ['BND001', 'BND002'] },
  { name: 'CommonJS require of a repository from a route', file: 'src/routes/orders.js', code: "const repo = require('../repositories/orderRepository.js');\nmodule.exports = repo;\n", expected: ['BND001'] },
  { name: 'controller calls a service (compliant)', file: 'src/controllers/orderController.js', code: "import { list } from '../services/orderService.js';\nexport const index = async (req, res) => res.json(await list());\n", expected: [] },
  { name: 'repository queries the model (compliant)', file: 'src/repositories/orderRepository.js', code: "import { Order } from '../models/order.js';\nexport const count = () => Order.countDocuments();\n", expected: [] },
]);

const NEXT_BASE = {
  'package.json': JSON.stringify({ dependencies: { next: '^15', 'drizzle-orm': '^0.33' } }),
  'tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'preserve', baseUrl: 'src', paths: { '@/*': ['./*'] } } }),
  'src/db/index.ts': "export const db = { select: () => ({ from: (t: unknown) => [t] }) };\n",
  'src/data/orders.ts': "import { db } from '@/db';\nexport const orders = () => db.select().from('orders');\n",
};
suite('TS adapter (Next.js with src/ and a Data Access Layer)', NEXT_BASE, preset('nextjs'), [
  { name: 'server component queries the database client', file: 'src/app/orders/page.tsx', code: "import { db } from '@/db';\nexport default function Page() { return <pre>{JSON.stringify(db.select())}</pre>; }\n", expected: ['BND002', 'BND003'] },
  { name: 'route handler imports the client module', file: 'src/app/api/orders/route.ts', code: "import { db } from '@/db';\nexport const GET = () => Response.json(db.select().from('orders'));\n", expected: ['BND002', 'BND003'] },
  { name: 'page uses the Data Access Layer (compliant)', file: 'src/app/orders/page.tsx', code: "import { orders } from '@/data/orders';\nexport default function Page() { return <pre>{JSON.stringify(orders())}</pre>; }\n", expected: [] },
]);
