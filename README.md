# NoBypass

**Your AI said it followed your architecture. Check.**

Website: **https://nobypass.nodezio.com** · by [Nodezio](https://nodezio.com) · MIT

NoBypass is a command-line checker for Laravel and NestJS projects. You write down which layer may call which: for example controller → service → repository → model. NoBypass then fails the check, locally or in CI, when code skips that path. It runs offline with static analysis. It needs no LLM, API key or account.

It exists because AI coding agents (and tired humans) produce code that works but quietly ignores your architecture:

```php
class UserController extends Controller
{
    public function index()
    {
        return User::where('active', true)->get();   // works, passes tests, skips 2 layers
    }
}
```

```
✖ BND002 error  app/Http/Controllers/UserController.php:19
  controller performs data access: Eloquent query User::where()
  expected: Data access only in repository, reached via controller → service → repository
  fix:      Move the query into the repository layer and call it through controller → service → repository.
```

---

## Contents

- [Quick start (5 minutes)](#quick-start-5-minutes)
- [What happens at each step](#what-happens-at-each-step)
- [Everyday use](#everyday-use)
- [The contract file](#the-contract-file)
- [Presets: Laravel and NestJS](#presets-laravel-and-nestjs)
- [Rules](#rules)
- [CI setup](#ci-setup)
- [Using it with AI agents](#using-it-with-ai-agents)
- [Common questions](#common-questions)
- [Limits](#limits)
- [Contributing](#contributing)

---

## Quick start (5 minutes)

Requirements: Node.js 20 or newer, and a Laravel or NestJS project in a git repository.

```bash
# 1. Install into your project (npm release coming; install from GitHub until then)
npm install --save-dev github:lexyerresta/nobypass

# 2. Let NoBypass read your project and propose a contract
npx nobypass init

# 3. Read what it found
npx nobypass discovery show

# 4. Approve the contract (you, in a terminal, not CI and not an agent)
npx nobypass approve

# 5. Check
npx nobypass check
```

If your project already has violations, step 5 lists them. Either fix them, or record them once as known debt so that only new violations fail:

```bash
npx nobypass baseline create
npx nobypass check --since origin/main   # fail only on what is new on this branch
```

## What happens at each step

| Step | Command | What it does | Files it writes |
|---|---|---|---|
| 1 | `npm install -D …` | Adds the CLI to `devDependencies`. | `package.json`, lockfile |
| 2 | `init` | Detects Laravel (`laravel/framework` in `composer.json`) or NestJS (`@nestjs/core` in `package.json`), reads PSR-4 or `tsconfig` paths, starts from a preset and drops layers you don't have. | `.nobypass.proposed.yml`, `.nobypass/discovery.txt` |
| 3 | `discovery show` | Prints the evidence: layers, how many files each covers, unclassified or ambiguous files, and every place existing code contradicts the proposal. | nothing |
| 4 | `approve` | Validates the proposal, shows a summary and asks you to type `approve`. Refuses to run in CI. | `.nobypass.yml` |
| 5 | `check` | Analyzes the code against the approved contract. Read-only. | nothing |

`init` never touches your source code or agent instructions. If the proposal is wrong, edit `.nobypass.proposed.yml` before approving. It is plain YAML.

## Everyday use

| You want to | Run |
|---|---|
| Check the whole project | `npx nobypass check` |
| Check only what changed on this branch (including uncommitted files) | `npx nobypass check --since origin/main` |
| Understand a finding | `npx nobypass explain BND002 --file app/Http/Controllers/UserController.php` |
| Make warnings fail too | `npx nobypass check --strict` |
| Get machine-readable output | `npx nobypass check --format json` or `--format sarif --output nobypass.sarif` |
| Accept existing violations as reviewed debt | `npx nobypass baseline create` |
| Tell your AI agents about the contract | `npx nobypass agents generate --skill` |

Exit codes: `0` passed · `1` new violation · `2` invalid contract or a file that could not be analyzed · `3` no approved contract yet.

## The contract file

`.nobypass.yml` is the single source of truth. Commit it, and protect it with CODEOWNERS (see [CI setup](#ci-setup)).

```yaml
schema: 1
projects:
  - id: api
    root: .
    language: php                # php | typescript
    framework: laravel           # laravel | nestjs | generic
    layers:                      # name: globs ("!glob" excludes)
      controller: ["app/Http/Controllers/**/*.php"]
      service:    ["app/Services/**/*.php"]
      repository: ["app/Repositories/**/*.php"]
      model:      ["app/Models/**/*.php"]
      shared:     ["app/Http/Requests/**/*.php", "app/Providers/**/*.php", "app/Facades/**/*.php"]
    dependencies:
      allowed_direct:            # who may depend DIRECTLY on whom
        controller: [service]
        service:    [repository]
        repository: [model]
        model:      []
        shared:     ["*"]
      shared: [shared]           # every layer may use these
    rules:
      direct_orm_access:         # where database access is allowed
        deny_in:  [controller, service]
        allow_in: [repository]
      catch_policy:              # where try/catch needs a stated reason
        discourage_in: [service, repository]
        severity: warning
    exceptions:                  # reviewed, written-down exceptions
      - rule: BND002
        path: app/Services/LegacyImportService.php
        reason: "Legacy integration; refactor scheduled"
```

Three things to know:

1. **Direct only.** `allowed_direct` checks direct dependencies. A controller reaching the model *through* the service and repository is fine. A controller importing the model is not.
2. **Typos fail loudly.** Unknown keys and references to undeclared layers are errors, never silently ignored.
3. **Exceptions need a reason.** Error-level rules can only be waived here, in a reviewed file. The only inline waiver is for the warning-level catch rule: `// nobypass-allow EXC001: <reason>`.

The full schema is in [docs/rule-reference.md](docs/rule-reference.md#contract-schema).

## Presets: Laravel and NestJS

`init` starts from a preset, then adapts it to the folders you actually have.

**Laravel** uses the service-repository layering: controller → service → repository → model. It is built on two public patterns, Service Layer and Repository (Martin Fowler, *Patterns of Enterprise Application Architecture*). Repository interfaces bound to Eloquent implementations in a service provider are supported, as described in the Laravel docs.
- **Facades are understood.** A call through a custom facade (`getFacadeAccessor()` returning a class) or a real-time facade (`use Facades\App\...`) counts as a dependency on the class behind it, so a facade cannot hide a controller → repository call.
- **Database access** means static Eloquent calls (`User::where()`, `User::create()`, …), `new Model()` and `DB::table/select/insert/…`. `DB::transaction()` is allowed anywhere.
- **Framework glue** (requests, resources, middleware, providers, jobs, events, facades, helpers, enums, DTOs) goes in `shared`.

**NestJS**: controller → service → repository → persistence (Prisma/TypeORM clients). A ports-and-adapters preset is used automatically when `src/domain` plus `src/application` or `src/infrastructure` exist.
- **Database access** means calls through injected `PrismaService`/`PrismaClient`, TypeORM `Repository`/`EntityManager`/`DataSource`, `@InjectRepository`/`@InjectModel`, and `new PrismaClient()`.
- `tsconfig` path aliases are resolved. `import type` is reported as type-only.

Presets are starting points. Rename layers, add or drop layers (for example a `support` layer between controller and service), and use one project entry per app in a monorepo.

## Rules

| Rule | Catches | Default |
|---|---|---|
| `BND001` | A direct dependency the contract does not allow | error |
| `BND002` | Database or ORM access outside the allowed layers | error |
| `BND003` | Skipping exactly one layer (for example controller → repository when the route is controller → service → repository) | error |
| `BND004` | A dependency cycle between layers | error |
| `EXC001` | A `catch` where the contract discourages it, without a written reason | warning |
| `CFG001` | A file in scope that matches no layer, or several | warning |
| `ANL001` | A file that could not be parsed or a reference that could not be resolved. Never a silent pass. | error |

Every finding names the file, line, both layers, what was expected and how to fix it. Details are in [docs/rule-reference.md](docs/rule-reference.md).

## CI setup

```yaml
# .github/workflows/architecture.yml
name: architecture
on: pull_request
jobs:
  nobypass:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }          # --since needs the base branch
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci                        # installs nobypass from devDependencies
      - run: npx nobypass check --since origin/${{ github.base_ref }} --format sarif --output nobypass.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with: { sarif_file: nobypass.sarif }
```

Then:
1. Make the `architecture` check **required** in branch protection.
2. Protect the contract so that nobody, human or agent, can loosen it without review:
   ```
   # .github/CODEOWNERS
   /.nobypass.yml           @your-org/architects
   /.nobypass/baseline.json @your-org/architects
   ```

## Using it with AI agents

```bash
npx nobypass agents generate --skill
```

This adds a marked block to `AGENTS.md` (asking first if the file exists) and writes `.claude/skills/nobypass/SKILL.md`. The block tells agents to follow `.nobypass.yml`, to run `npx nobypass check --since origin/main` before saying a task is done, and never to edit the contract or baseline to make the check pass. Run it again after changing the contract, and it replaces only its own block.

Instructions can be ignored. The required CI check cannot. Use both.

## Common questions

**Will it fail on my existing code?** A plain `check` reports everything. Use `baseline create` once to record existing violations as reviewed debt, or use `--since origin/main` so only new violations fail. A second copy of an existing violation in the same file is still reported as new.

**Can an agent just edit `.nobypass.yml`?** Locally, yes. That is why the contract and baseline belong under CODEOWNERS, and why `check --since` prints a notice when either file changes in the diff. `approve` and `baseline create` also refuse to run in CI.

**What if it cannot understand a file?** It reports `ANL001` and fails (exit code 2). It never reports PASS for code it could not analyze. Dynamic calls such as `$class::where()` are reported as unverified warnings.

**Does my code leave my machine?** No. Analysis is local and static, and NoBypass never executes your project's code.

## Limits

NoBypass proves that *detectable* violations are absent, which is narrower than "the code is correct". It checks direct static dependencies, not runtime call flow. It does not see ORM calls on untyped variables such as `$user->save()`. Files that match no layer are only warned about (`CFG001`). The full list is in [docs/limitations.md](docs/limitations.md).

## Contributing

```bash
git clone https://github.com/lexyerresta/nobypass.git
cd nobypass
npm install          # also builds dist/
npm test             # 130 tests: rule cases for both adapters, fixtures, --since, discovery, CLI
node dist/cli/index.js check -C fixtures/laravel-violations
```

```
src/cli/                  commands
src/core/                 contract schema, layers, rules, fingerprints, baseline, git, check, explain
src/adapters/php/         PHP AST, PSR-4, Eloquent, DB facade, Laravel facades
src/adapters/typescript/  TS AST, imports and path aliases, Prisma/TypeORM
src/discovery/            project detection and proposal
src/agents/               AGENTS.md / SKILL.md generation
presets/                  laravel.yml, nestjs.yml, nestjs-hexagonal.yml
fixtures/                 valid and violating sample projects for both frameworks
site/                     landing page (static, deployed on Vercel with Root Directory = site)
```

To add a detector or rule, add a violating case and a compliant case to `test/laravel.test.ts` or `test/nestjs.test.ts` first. Adapters only produce normalized facts (dependencies, data-access operations, catch sites, unresolved references), and the rules live in `src/core/rules.ts`.

The landing page in `site/` was designed with the [anti-slop](https://github.com/miqdadbadjuber/anti-slop) rules by Miqdad Badjuber (MIT). Its direction is in [site/DESIGN.md](site/DESIGN.md) and its gate report in [site/DELIVERY-GATE.md](site/DELIVERY-GATE.md). It uses IBM Plex fonts (SIL OFL 1.1, see `site/fonts/OFL.txt`).

## License

MIT © Nodezio
