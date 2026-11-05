# Known limitations (v0.1)

NoBypass claims to prevent **detectable** architecture violations. It never claims the application is correct. When it cannot analyze something, it says so (`ANL001`) instead of passing.

## What static analysis cannot see

- **Runtime call flow.** Only *direct* static dependencies are checked. NoBypass does not prove that every request travels through every layer.
- **Instance-level ORM calls on untyped values.** `$user->save()`, `$user->posts()->create()` and `repo.find()` called on a value whose type isn't visible in the file are not detected. Static Eloquent calls, `new Model`, `DB::` and calls through injected or module-level clients are detected.
- **Aliasing.** `$q = User::query()` inside a repository, passed to a controller and used there, is not tracked. Neither is `const users = this.prisma.user; users.findMany()`.
- **Container magic.** Custom facades (`getFacadeAccessor()` returning a class) and real-time facades (`Facades\App\...`) are resolved to the class behind them. Facades whose accessor is a string binding key (`'users'`), `app('users')` and `resolve()` with a string are not. `app(UserRepository::class)` is seen through its class reference. NestJS custom provider tokens (`@Inject('USERS')`) are not mapped to classes.
- **Dynamic code.** Dynamic ORM-style static calls (`$class::where()`) and computed `import(name)` / `require(name)` are reported as unverified (`ANL001` warning, confidence `low`). They are never treated as compliant.

## Configuration-related gaps

- **Unclassified files are not checked as a source layer.** An agent could move a query into `app/Helpers/Foo.php`. `CFG001` warns about the new file, and `--strict` turns that into a failure. Keep layer coverage high (`nobypass discovery show` reports it).
- **Excluded paths are not analyzed at all.** Review `exclude:` like any other part of the contract.
- **Ambiguous files resolve to the first matching layer.** Use `!pattern` exclusions.
- **Inline `nobypass-allow` exists only for `EXC001`.** Error-level rules can be waived only through contract `exceptions:`, which require a reason and should be protected with CODEOWNERS.

## Governance

- An agent can edit `.nobypass.yml` or the baseline locally. Protection comes from CODEOWNERS, branch protection and a required CI check, not from prompt instructions. `check --since` prints a notice when either file changes in the diff.
- `approve` and `baseline create` refuse to run in CI. That is a guard against automation mistakes, not a security boundary.

## `--since` semantics

- Changes are computed against `git merge-base <ref> HEAD` and include uncommitted and untracked files.
- For each changed file, findings are compared with the same file at the base. Duplicates are counted, so adding a second identical violation to an already non-compliant file is still new.
- Renames are treated as delete + add. A renamed legacy file's findings show up as new and need either a fix or a baseline update. This is intentional, so that renames get reviewed.
- Cycles (`BND004`) are compared against the base revision's whole-project graph.

## Language support

- **PHP** (Laravel, Symfony) is parsed by `php-parser` 3.x, with PHP 8 syntax enabled. Syntax the parser doesn't support produces `ANL001`.
- **TypeScript and JavaScript** (NestJS, Express, Fastify, Next.js) are parsed by the TypeScript compiler. Resolution uses the project's `tsconfig.json` (`paths`, `baseUrl`). Packages that are not installed are treated as external. Unresolvable relative and alias imports are `ANL001`.
- **Python** (Django, FastAPI) and **Java** (Spring Boot) are parsed by tree-sitter grammars compiled to WebAssembly, which ship in `grammars/`. Any syntax error in a file produces `ANL001`; the file is never half-checked.
  - **Python:** modules resolve from the project root and `src/`. Dynamic imports (`importlib.import_module(name)`) are unverified. Instance calls on ORM objects (`order.save()`) and sessions passed through untyped helpers are not detected.
  - **Java:** classes resolve from `**/src/main/java`. Wildcard imports are resolved only for classes the file actually references. Kotlin, Groovy and annotation-processor-generated sources are not analyzed.
- `framework: generic` works with hand-written contracts, but discovery won't propose one.

## Precision

The curated fixtures in `test/` are the precision target: 45 Laravel/NestJS violation cases and 36 compliant cases, 25 more violation and 15 compliant cases across Symfony, Express, Next.js, Django, FastAPI and Spring Boot, and a valid plus a violating fixture project for every stack, all passing. No precision figure is claimed for arbitrary production repositories.
