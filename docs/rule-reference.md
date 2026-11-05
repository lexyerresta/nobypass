# Rule reference

Every finding has the same shape:

```json
{
  "ruleId": "BND002",
  "severity": "error",
  "file": "app/Http/Controllers/UserController.php",
  "line": 22,
  "sourceLayer": "controller",
  "targetLayer": "model",
  "symbol": "App\\Models\\User::where",
  "evidence": "controller performs data access: Eloquent query User::where()",
  "expected": "Data access only in repository, reached via controller → service → repository",
  "suggestion": "Move the query into the repository layer and call it through controller → service → repository.",
  "confidence": "high",
  "fingerprint": "2a6f1d65f8ff9d5a5847",
  "project": "api",
  "status": "new",
  "blocking": true
}
```

- `confidence` is the analyzer's certainty about what it saw. It is not the probability of a real defect. Type-only references are `medium`. Dynamic calls are `low`.
- `fingerprint` is a hash of the project, rule, file, symbol and edge. It excludes the line number, so unrelated edits don't turn known findings into new ones.
- `status` is `known` when the finding is covered by the baseline, or under `--since` by the base revision. Otherwise it is `new`. `blocking` is true for new errors, and for new warnings with `--strict`.

## BND001: forbidden direct dependency

A file in layer **A** directly depends on a file in layer **B**, and B is not in `dependencies.allowed_direct.A`, not in `dependencies.shared`, and not A itself (unless `same_layer: deny`).

These count as dependencies:

- **PHP:** `use` imports, constructor-injected types, `new X`, `X::method()`, `X::CONST`, `X::class`, `extends`, `implements`, traits, parameter/return/property types, `catch` types, `instanceof` and attributes. Constructor injection counts as a runtime dependency. Other type positions are *type-only*.
- **Python:** `import x.y`, `from x import y` (a submodule when one exists, otherwise the package), relative imports and `importlib.import_module("literal")`. Imports inside `if TYPE_CHECKING:` are type-only.
- **Java:** single-type, static and wildcard imports, plus classes from the same package referenced without an import. All Java dependencies are runtime dependencies.
- **Laravel facades:** calling a facade also counts as depending on the class it proxies. For a custom facade, that is the class returned by `getFacadeAccessor()` (`return Foo::class;` or a class-name string). For a real-time facade, `Facades\App\Services\Foo` resolves to `App\Services\Foo`. A facade therefore cannot hide a controller → repository call.
- **TypeScript:** `import`, `export … from`, `import x = require()`, `require()`, `import()` with a literal specifier. `import type` and all-`type` specifiers are *type-only*.

Type-only dependencies are enforced by default. Set `type_only: ignore` to allow them.

External symbols (vendor, `node_modules`, framework classes) are never layer dependencies.

## BND002: data access outside the approved layer

Reported for files in `rules.direct_orm_access.deny_in`. These count as data access:

| Laravel | NestJS |
|---|---|
| Static Eloquent entry points on model classes: `query`, `find*`, `first*`, `create`, `update*`, `where*`, `orWhere*`, `all`, `get`, `paginate`, `with`, `count`, `pluck`, … | Calls rooted at an injected ORM client: `this.prisma.user.findMany()`, `this.db.$queryRaw\`…\``, `this.repo.find()`, `this.em.query()` |
| `new Model()` (confidence: medium) | Module-level clients: `const prisma = new PrismaClient(); prisma.user…` |
| `DB::table/select/insert/update/delete/statement/raw/…` (the facade or the global `\DB` alias) | Runtime imports of ORM handles (`PrismaClient`, `DataSource`, `EntityManager`, `getRepository`, …) from ORM packages |

**Model classes** are classes in `model_layers`, which defaults to a layer named `model`. A class also counts as a model if it extends `Illuminate\Database\Eloquent\Model`, `Illuminate\Foundation\Auth\User` or `Pivot`, directly or through project base classes.

**ORM clients** are parameters or properties typed `PrismaClient`, `PrismaService`, `DataSource`, `EntityManager`, `Repository<T>`, `MongoRepository`, `TreeRepository` or `Knex`. Project classes that `extends PrismaClient | DataSource | EntityManager` also count, as does anything injected with `@InjectRepository`, `@InjectModel`, `@InjectDataSource`, `@InjectEntityManager`, `@InjectConnection` or `@InjectKnex`. Override the list with `rules.direct_orm_access.clients` and `.packages`.

These do **not** count as data access:

- `DB::transaction`, `beginTransaction`, `commit` and `rollBack`. Transaction boundaries often belong in services.
- `import type { User } from '@prisma/client'` and the `Prisma` namespace types.

## BND003: boundary bypass

This is a specific form of BND001. The target layer *is* reachable through the approved graph, but only via **exactly one** intermediate layer that the file skipped. Example: a controller injects a repository when the contract says `controller → service → repository`.

Reaching further down is reported as BND001, with the approved route in `expected`. An example is a controller importing the model two layers away.

## BND004: layer cycle

The layer graph built from direct dependencies contains a cycle, found with Tarjan's strongly connected components. Layers listed in `dependencies.shared` are excluded, since they may depend on anything by design. The finding points at the edge in the cycle that the contract does not allow. Its fingerprint is project-level, so it stays the same when the example file changes.

## EXC001: discouraged catch

There is a `try/catch` in a layer listed in `rules.catch_policy.discourage_in` and no documented purpose. The default severity is `warning`.

A catch is allowed when a comment on the `catch` line, or the line above or below it, documents its purpose:

```ts
} catch (error) { // nobypass-allow EXC001: translate unique-constraint error into a 409
```

Laravel exception handlers and NestJS exception filters (`catch(exception, host)` methods) are not `try/catch` and are never flagged. The rule detects where a catch is placed. It does not prove whether error handling is correct.

## CFG001: unclassified or ambiguous file

An in-scope file matches no layer glob, or matches several. Ambiguous files are treated as the **first** matching layer, in declaration order. Use `!pattern` exclusions to make the match unique. Unclassified files are not checked as a *source* layer, so the warning matters. Set `rules.unclassified: off` to silence it.

## ANL001: analysis failure

- The file did not parse. **error**. The file was not checked.
- An application-level reference does not resolve. This is a PHP class under a PSR-4 prefix that no file declares, or a relative / `tsconfig`-alias import that does not resolve. **error**.
- A dynamic reference: `$class::where()` or `import(name)`. **warning**, confidence `low`. The reference is unverified.

Error-level ANL001 makes `check` exit with code `2`. It can never be baselined. Under `--since`, ANL001 in unchanged files is reported as known and does not block.

## Contract schema

```yaml
schema: 1                         # required
approved_by: string               # written by `approve` (a record, not a security boundary)
approved_at: ISO-8601 string
projects:                         # one per application (monorepos: several)
  - id: string                    # [A-Za-z0-9_.-]
    root: string                  # relative, inside the repository (default ".")
    language: php | typescript
    framework: laravel | nestjs | generic
    include: [glob]               # default: app/**/*.php (Laravel), **/*.php, or src/**/*.ts
    layers: { <name>: [glob | "!glob"] }
    dependencies:
      allowed_direct: { <layer>: [<layer> | "*"] }   # every layer needs an entry
      shared: [<layer>]           # any layer may depend on these
      type_only: enforce | ignore # default enforce
      same_layer: allow | deny    # default allow
      detect_cycles: boolean      # default true
    rules:
      direct_orm_access:
        enabled: boolean          # default true
        deny_in: [<layer>]
        allow_in: [<layer>]
        severity: error | warning # default error
        model_layers: [<layer>]   # PHP; default: a layer named "model"
        clients: [TypeName]       # TS; replaces the default client type list
        packages: [package]       # TS; replaces the default ORM package list
      catch_policy:
        enabled: boolean          # default true
        discourage_in: [<layer>]
        severity: error | warning # default warning
      unclassified: warning | off # default warning
    exclude: [glob]
    exceptions:
      - rule: <RULE ID>
        path: glob
        symbol: string            # optional substring match
        reason: string            # required
    baseline: path                # default .nobypass/baseline.json
```

Unknown keys are rejected, so a typo cannot silently disable a rule. The semantic checks are: references to undeclared layers, a missing `allowed_direct` entry, a layer listed in both `deny_in` and `allow_in`, an exception without a reason, and a root outside the repository.
