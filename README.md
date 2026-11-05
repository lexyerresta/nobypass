# NoBypass

**Your AI said it followed your architecture. Check.**

NoBypass is a local-first, AI-agnostic CLI that stops *architecture drift*: code that works but quietly breaks the architecture your team chose. A typical example is an agent that "fixes" a feature by calling `User::where()` straight from a Laravel controller, or by injecting `PrismaService` into a NestJS controller.

It runs offline with static analysis. It needs no LLM, no API key and no account. It ships adapters for **Laravel/PHP** and **NestJS/TypeScript**.

```
$ npx nobypass check          # output from fixtures/laravel-violations, abridged

✖ BND003 error app/Http/Controllers/UserController.php:14  Boundary bypass
  controller depends directly on service: App\Services\UserService
  expected: service is reached only through controller → support → service
  fix:      Call the support layer instead and let it reach service.

✖ BND002 error app/Http/Controllers/UserController.php:22  Data access outside approved layer
  controller performs data access: Eloquent query User::where()
  expected: Data access only in repository, reached via controller → support → service → repository
  fix:      Move the query into the repository layer and call it through controller → support → service → repository.

9 files analyzed · 7 new errors · 2 new warnings · 0 known (baseline/base)
✖ FAIL — 7 blocking findings. Run `nobypass explain <RULE> --file <path>` for details.
```

NoBypass proves that **detectable** architecture violations are absent. It does not prove the application is correct. See [docs/limitations.md](docs/limitations.md).

## Five-minute quick start

```bash
# 1. Explore. Writes only .nobypass.proposed.yml and .nobypass/discovery.txt.
npx nobypass init

# 2. Read the evidence: detected framework, layers, coverage, ambiguous files,
#    and the places where existing code contradicts the proposal.
npx nobypass discovery show

# 3. Edit .nobypass.proposed.yml if anything is wrong, then approve it.
#    Interactive only: a human approves the contract, never CI or an agent.
npx nobypass approve

# 4. Tell your agents about it (AGENTS.md block + optional SKILL.md).
npx nobypass agents generate --skill

# 5. Check.
npx nobypass check                      # full audit
npx nobypass check --since origin/main  # only fail on violations new to this branch
```

If existing code already violates the contract, either fix it or record it as reviewed debt with `npx nobypass baseline create`. After that, only *new* violations fail.

## How it works

**Discover → Review → Approve → Enforce → Explain → Recheck**

1. **Discover.** `init` detects Laravel (`composer.json` → `laravel/framework`) and NestJS (`package.json` → `@nestjs/core`), including in monorepos. It reads PSR-4 mappings and `tsconfig` path aliases, starts from a preset, drops layers you don't have and re-wires the chain around them. It never treats the most common existing pattern as correct.
2. **Review and approve.** The proposal is not enforced until a human runs `approve`. Ambiguous projects are left unproposed.
3. **Enforce.** `check` is read-only. It parses PHP with [php-parser](https://github.com/glayzzle/php-parser) and TypeScript with the TypeScript compiler API. No project code is ever executed.
4. **Explain.** Every finding names the rule, the contract edge, the approved route and a fix.

### The contract (`.nobypass.yml`)

```yaml
schema: 1
projects:
  - id: api
    root: .
    language: php
    framework: laravel
    layers:
      controller: ["app/Http/Controllers/**/*.php"]
      support: ["app/Support/**/*.php"]
      service: ["app/Services/**/*.php"]
      repository: ["app/Repositories/**/*.php"]
      model: ["app/Models/**/*.php"]
      shared: ["app/Http/Requests/**/*.php", "app/Providers/**/*.php"]
    dependencies:
      allowed_direct:            # direct static dependencies only
        controller: [support]
        support: [service]
        service: [repository]
        repository: [model]
        model: []
        shared: ["*"]
      shared: [shared]           # layers every layer may use (DTOs, requests, wiring)
      type_only: enforce         # or "ignore" to allow type-only references
      detect_cycles: true
    rules:
      direct_orm_access:
        deny_in: [controller, support, service]
        allow_in: [repository]
        severity: error
      catch_policy:
        discourage_in: [service, repository]
        severity: warning
    exclude: [vendor/**, tests/**, database/migrations/**]
    exceptions:
      - rule: BND002
        path: app/Services/LegacyImportService.php
        reason: "Legacy integration; scheduled for refactor"
    baseline: .nobypass/baseline.json
```

`allowed_direct` controls **direct** dependencies only. A controller reaching a model *through* support → service → repository is fine. A controller importing the model directly is not. Layer globs accept `!pattern` exclusions. Full schema: [docs/rule-reference.md](docs/rule-reference.md#contract-schema).

### Rules

| Rule | Detects | Default |
|---|---|---|
| `BND001` | Forbidden direct dependency across layers | error |
| `BND002` | Data access (Eloquent, `DB::`, Prisma, TypeORM, …) outside the approved layers | error |
| `BND003` | Skipping exactly one intermediate boundary (controller → service when the route is controller → support → service) | error |
| `BND004` | Dependency cycle between layers | error |
| `EXC001` | `catch` in a layer where the contract discourages it, without a documented purpose | warning |
| `CFG001` | In-scope file that matches no layer, or several | warning |
| `ANL001` | Parse failure or unresolvable application reference. **Never a silent PASS.** | error |

Run `nobypass explain <RULE>` for details, or read [docs/rule-reference.md](docs/rule-reference.md).

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No new blocking findings |
| `1` | New error-level violation (or a new warning with `--strict`) |
| `2` | Invalid contract, bad `--since` ref, or analysis failure on a relevant file |
| `3` | No approved contract yet |

## CI

```yaml
# .github/workflows/architecture.yml
name: architecture
on: pull_request
jobs:
  nobypass:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }          # --since needs the base branch history
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx --yes nobypass@0.1.0 check --since origin/${{ github.base_ref }} --format sarif --output nobypass.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with: { sarif_file: nobypass.sarif }
```

Make the check required with branch protection. Then protect the contract itself:

```
# .github/CODEOWNERS
/.nobypass.yml           @your-org/architects
/.nobypass/baseline.json @your-org/architects
```

A local CLI cannot stop an agent from declaring itself done. Enforcement comes from CI plus branch protection, or from an agent hook you configure. The `approved_by` field in the contract is a record, not a security boundary. `check --since` prints a notice when the contract or baseline changes in the diff.

## Agents

`nobypass agents generate` writes a delimited block into `AGENTS.md`. It asks before touching an existing file and only replaces its own block on later runs. With `--skill`, it also writes a portable Agent Skill to `.claude/skills/nobypass/SKILL.md`. The guidance tells the agent to:

1. read `.nobypass.yml` and follow it;
2. run `npx nobypass check --since <base>` before reporting a task as done, and fix violations instead of working around them;
3. never edit the contract, the baseline or `exceptions:` to make the check pass.

Catches that serve a real purpose (retry, rollback, wrapping a domain error, an expected fallback) are documented inline:

```php
} catch (QueryException $e) { // nobypass-allow EXC001: wrap infrastructure error as a domain error
```

Inline allowances exist **only** for the warning-level `EXC001`. Error-level rules can be waived only through contract `exceptions:`, which go through code review.

## Development

```bash
npm install
npm run build
npm test            # 126 tests: 43 violation cases, 34 compliant cases, fixtures, --since, discovery, CLI
node dist/cli/index.js check -C fixtures/laravel-violations
```

```
src/
  cli/                  commands, TTY, output
  core/                 contract schema, layers, rules, fingerprints, baseline, git, check, explain
  adapters/php/         PHP AST, PSR-4, Laravel/Eloquent detectors
  adapters/typescript/  TS AST, imports/aliases, NestJS/Prisma/TypeORM detectors
  discovery/            evidence collection, proposal generator
  agents/               AGENTS.md / SKILL.md generation
presets/                laravel.yml, nestjs.yml, nestjs-hexagonal.yml
fixtures/               laravel-valid, laravel-violations, nestjs-valid, nestjs-violations
docs/                   specification.md, rule-reference.md, limitations.md
```

To add a rule or an ORM detector: add a fixture case to `test/laravel.test.ts` or `test/nestjs.test.ts` first, covering both a violation and a compliant variant. Adapters implement `prepare()` → `analyze(file, content)`. The core only sees normalized dependencies, data-access operations, catch sites and unresolved references.

New framework adapters are on hold until the two shipped adapters meet the same quality bar.

## License

MIT
