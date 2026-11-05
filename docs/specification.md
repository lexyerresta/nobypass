# NoBypass — MVP Product & Technical Specification

**Version:** 0.1 (initial MVP)  
**Status:** Design proposal, not an implemented product  
**Positioning:** *AI writes the code. Your architecture sets the rules.*  
**License target:** MIT  
**Primary deliverable:** Open-source, local-first, AI-agnostic CLI with Laravel/PHP and NestJS/TypeScript adapters.

## 1. Product objective

NoBypass prevents *architecture drift*: code that appears to work but violates the architecture a team explicitly selected. It complements tests, linters, and existing architecture checkers. It does not generate architectures or make subjective correctness guarantees.

**Core workflow:** **Discover → Review → Approve → Enforce → Explain → Recheck**.

**Primary user:** an engineering team using AI coding assistants in an existing Laravel or NestJS repository.

**MVP success moment:** a developer instructs an agent to add a feature; the agent introduces `User::query()` in a Laravel Controller; `nobypass check` identifies the exact forbidden access, points to the approved Controller → Support → Service → Repository → Model flow, and fails the PR until corrected.

## 2. MVP scope and explicit exclusions

| Dimension | In MVP (v0.1) | Later |
|---|---|---|
| Languages | PHP, TypeScript | Dart, Java, Python, Go, C# |
| Framework presets | Laravel, NestJS | Next.js, Flutter, Spring Boot, Symfony |
| Project detection | `composer.json`, `package.json`, `tsconfig.json`, PSR-4, directory structure, static imports | Learned runtime call graphs |
| Contracts | Configurable layers, allowed direct dependencies, configurable ORM/exception policies | Rich architectural DSL, cross-service constraints |
| Enforcement | Offline static analysis, CLI checks, changed-code baseline, CI | IDE diagnostics, server-side policy platform |
| Agent integration | Generate `AGENTS.md` guidance or standalone skill, generic CLI command | Native per-agent hooks and MCP |
| Auto-fixing | Suggested fix descriptions only | Safe suggested patches with approval |
| Storage/account | None; files committed to Git | Cloud dashboard/analytics |

**Non-goals:** generating business logic; proving end-to-end call sequences; detecting every business-logic violation; security certification; executing arbitrary AI-generated fixes; requiring an LLM/API key; changing code before the user approves a contract.

## 3. User journey and command contract

```bash
# Explore current repository without modifying source files
npx nobypass init

# See the proposed layers, path globs, and example dependencies
npx nobypass discovery show

# Explicitly accept/edit the proposed contract (interactive only)
npx nobypass approve

# Generate agent guidance from the approved contract
npx nobypass agents generate

# Run a full audit
npx nobypass check

# Block new architecture violations relative to the main branch
npx nobypass check --since origin/main

# Explain a violation, using its stable identifier
npx nobypass explain BND002 --file app/Http/Controllers/UserController.php

# Import existing violations into a reviewed baseline (separate approval)
npx nobypass baseline create
```

**Proposed command semantics:**

- `init` reads the project and writes **only** `.nobypass.proposed.yml` and a text discovery report; no source, Git hooks, or `AGENTS.md` changes.
- `discovery show` displays confidence, examples, and uncertainty. No confidence score means “proven correct”.
- `approve` is interactive, validates all layer patterns/rules, and writes `.nobypass.yml`. Refuse approval in non-interactive CI.
- `agents generate` writes a new agent guidance file, or adds a clearly delimited block to an existing file after asking consent; never silently overwrites instructions.
- `check` is read-only. Supports `--format text|json|sarif` as a stretch target (text/JSON required, SARIF optional).
- `baseline create` is a separate explicit action. CI never creates or refreshes baseline files.
- `--since origin/main` compares changed code and existing fingerprints, without ignoring newly added violations in previously noncompliant files.

Exit codes: `0` = no new blocking issues, `1` = new error-level violation, `2` = invalid contract/analysis failed, `3` = contract not yet approved. **No silent PASS on parsing or resolution failure.** Warnings do not block CI unless `--strict` is enabled.

## 4. Hybrid discovery and approval

**Discovery inputs:**

1. Detect Laravel via `composer.json` dependency on `laravel/framework`; detect NestJS via `@nestjs/core` in `package.json`.
2. Read `composer.json` PSR-4 mappings, `tsconfig.json` path aliases, and project folder trees.
3. Extract import/use and constructor injection edges from a bounded sample of application files.
4. Infer candidate layers from path patterns, suffixes (`*Controller`, `*Service`, `*Repository`, `*Support`), and existing imports.
5. Suggest an architecture contract, display ambiguous and unclassified files separately.

**Review screen must show:** detected framework; root, language, version evidence; layer names/globs; suggested allowed edges; detected examples; policy severity; coverage (% of in-scope files assigned to a layer); ambiguous/unclassified files; and warning if existing code contradicts the proposed contract.

**Approval rules:** never treat the most frequent existing pattern as automatically correct. The operator can edit or reject suggestions, choose a preset, and explicitly approve. Approval is represented by a committed contract. In team repositories, protect changes to `.nobypass.yml` and `.nobypass/baseline.json` with CODEOWNERS/branch rules; a local `approved: true` flag is **not** a security boundary.

**Fail-closed:** if framework detection is ambiguous or the parser cannot analyze relevant changed files, report `unsupported/undetermined` and request intervention; do not claim those files passed.

## 5. Contract specification (example Laravel project)

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
    dependencies:
      allowed_direct:
        controller: [support]
        support: [service]
        service: [repository]
        repository: [model]
        model: []
      detect_cycles: true
    rules:
      direct_orm_access:
        enabled: true
        deny_in: [controller, support, service]
        allow_in: [repository]
        severity: error
      catch_policy:
        discourage_in: [service, repository]
        severity: warning
    exclude:
      - vendor/**
      - tests/**
      - database/migrations/**
      - database/seeders/**
    exceptions:
      - rule: BND002
        path: app/Services/LegacyImportService.php
        reason: "Legacy integration; scheduled for refactor"
    baseline: .nobypass/baseline.json
```

This is the **proposed v0.1 public schema**, subject to schema validation and fixtures before release. Paths/globs are project-specific. A project may remove the `support` layer, choose different names, and use separate contracts per project in a monorepo.

**Semantics:** `allowed_direct` controls **direct static dependencies**, not whether every controller request must traverse every layer. An indirect Controller → Model chain through properly configured layers is permitted. Direct `Controller → Model` or `Controller → Repository` is forbidden in the example contract. Framework types, DTOs, value objects, base classes, dependency injection tokens, tests, and infrastructure can have explicitly declared exceptions; do not blindly reject every imported symbol.

Example NestJS preset:

```yaml
layers:
  controller: ["src/**/*.controller.ts"]
  application: ["src/application/**/*.ts", "src/**/*.service.ts"]
  port: ["src/domain/ports/**/*.ts"]
  adapter: ["src/infrastructure/**/*.ts"]
allowed_direct:
  controller: [application]
  application: [port]
  adapter: [port]
```

NestJS example is schematic: adapters commonly implement ports, and dependency injection might bind them via modules. NoBypass should support **directional dependencies**, not enforce the example as a universal NestJS convention.

## 6. Deterministic MVP rules

| Rule ID | Detection | Default severity | Example |
|---|---|---|---|
| `BND001` | Forbidden direct dependency across layers | error | Controller imports Repository or Model |
| `BND002` | Prohibited data-access operation outside approved layer | error | `User::where()` / `DB::table()` in Laravel Controller or Prisma access in NestJS Controller |
| `BND003` | Direct dependency bypassing an intermediate required boundary | error | Controller injects Service where contract allows only Support (can be a specific classification of BND001) |
| `BND004` | Static dependency cycle between configured layers/modules | error | Application → Infrastructure → Application |
| `EXC001` | Exception catch where project policy discourages it | warning | `catch (\Throwable $e)` in a Service with no documented purpose |
| `CFG001` | Unclassified or ambiguous relevant application file | warning | Class outside all configured layer globs |
| `ANL001` | Parser or dependency resolution failure | error for changed relevant files | Unsupported syntax or unresolved app-level alias |

**PHP adapter:** use a PHP AST parser (`php-parser` for JS runtime), PSR-4 namespace resolution, and structural call detection. Detect Eloquent static query calls, instantiation of models/ORM builders where determinable, `DB::table()` and `DB::select()` in prohibited layers. Permit Eloquent/query builder in Repository and scoped framework exceptions. Do not mistake pure DTO/attribute imports for database operations. Report dynamic class calls as unverified when unresolved.

**TypeScript adapter:** use TypeScript compiler APIs for AST/symbols and `dependency-cruiser` or equivalent resolved dependency graph for imports and aliases. Detect direct Prisma/TypeORM calls in prohibited layers, with configurable ORM detection and whitelists. Don't confuse `import type` with a runtime dependency if the contract distinguishes them.

**Exception handling:** catching exceptions in a Service is *not universally wrong*. `EXC001` is a configurable advisory rule by default. Valid cases include retry, rollback/compensation, wrapping an infrastructure error as a domain error, or expected fallbacks. The initial version detects catch placement and may flag review candidates; it does not prove duplicate handling or that error propagation is correct. Central exception handlers and NestJS exception filters must remain valid patterns.

## 7. Violation data contract

Every finding must contain:

```json
{
  "ruleId": "BND002",
  "severity": "error",
  "file": "app/Http/Controllers/UserController.php",
  "line": 24,
  "sourceLayer": "controller",
  "targetLayer": "model",
  "symbol": "App\\Models\\User::where",
  "evidence": "Controller performs an Eloquent query",
  "expected": "Query inside Repository, invoked via Service and Support",
  "suggestion": "Move the query to UserRepository and call it through the approved layers",
  "confidence": "high",
  "fingerprint": "stable-hash-based-on-rule-file-symbol-and-edge"
}
```

`confidence` describes analyzer certainty, not probability of a real defect. Store path and symbol without line number in the fingerprint to reduce noise after unrelated edits. Issue explanations must refer to contract edges, not hallucinated code edits. Provide source location when parser supports it.

## 8. Enforcement and agent integration

**Local:** fast `nobypass check` after AI edits. Agent instruction: *Read `.nobypass.yml`; follow it. Before marking the task finished, run `npx nobypass check --since <base-ref>`. If it fails, fix violations and rerun. Do not modify the contract or baseline without explicit human review.*

**CI:** install package with pinned version, run read-only check against PR base; fail new errors and invalid/unsupported analysis. Upload a JSON artifact; optionally report line comments. Use GitHub branch protection so failed checks cannot be merged. A local CLI alone cannot stop agents from declaring themselves finished; enforceability comes from CI or an agent hook configured by the user.

**Codex/Claude:** generate `AGENTS.md` guidance that references the approved contract and uses explicit check commands. Offer Agent Skills format (`SKILL.md`) as a portable option. Native hooks are a later milestone; don't claim all agents support identical hook APIs.

**Legacy baseline:** users can baseline known violations with approval. Identical existing fingerprints remain visible as known debt but do not fail changed-code CI; newly introduced violations fail. CI never silently regenerates baseline. Renames and changes that affect fingerprints may require review, documented in output.

## 9. Internal implementation architecture

```text
nobypass/
  apps/
    cli/                   # commands, TTY, output
  packages/
    core/                  # config schema, layers, graph, rules, fingerprinting
    adapter-php/           # PHP AST, composer PSR-4, Laravel detectors
    adapter-typescript/    # TS AST, imports/aliases, NestJS detectors
    discovery/             # evidence collection, proposal generator
    agents/                # AGENTS.md / SKILL.md generation
  presets/
    laravel.yml
    nestjs.yml
  fixtures/
    laravel-valid/
    laravel-violations/
    nestjs-valid/
    nestjs-violations/
  docs/
    specification.md
    rule-reference.md
    limitations.md
```

**Suggested stack:** Node.js LTS, TypeScript, pnpm workspaces, `zod` for schema validation, a YAML parser, `php-parser`, TypeScript compiler API, dependency-cruiser, Vitest, and GitHub Actions. No database, hosted LLM, or remote service. Prefer adapter interfaces such as `discoverProject()`, `extractDependencies()`, `analyzeOperations()` and `getSupportedRules()`; the core consumes normalized project graphs and findings.

**Safety/privacy:** by default process source code locally, do not upload repository content, do not execute arbitrary source project code during discovery/check, exclude secrets and generated/vendor directories, and make telemetry opt-in only (or omit telemetry for the MVP).

## 10. Acceptance criteria / Definition of Done

1. Laravel and NestJS test fixtures are detected correctly, with evidence shown and ambiguous projects left unapproved.
2. `init` never changes application source or existing agent instructions; config is unusable for enforcement until reviewed/approved.
3. Laravel: `Controller → Model` and `Controller → Repository` imports are caught; Eloquent operations in Controller/Service are caught; permitted repository query is not flagged.
4. NestJS: prohibited Controller → persistence and direct Prisma access are caught; approved Controller → Application → Port dependencies pass.
5. `EXC001` flags Service catch only when configured; default is warning, with an explicit exception mechanism.
6. Both adapters produce consistent file/line/rule/explanation/fingerprint records and deterministic JSON.
7. `nobypass check --since origin/main` fails on a new blocking finding but does not fail solely on approved preexisting violations.
8. Parse failures/unresolved changed application dependencies never produce a misleading PASS.
9. Unit and integration fixtures cover **at least 30 positive and 30 negative cases**, including type-only imports, PHP aliases, PSR-4 mappings, DI, allowed exception handling, legacy findings, and unclassified files. Set an initial target of **≥95% precision on these curated fixtures**, with no requirement to claim the same rate in real production repos.
10. CI test succeeds on supported sample repositories without network access after dependencies are installed; README includes a five-minute quick start, example output, known limitations, and contributor instructions.

## 11. Recommended implementation order

- **Milestone 1 — Contract + CLI:** schemas, `init`, review/approve, no-op check, sample presets, validation.
- **Milestone 2 — PHP/Laravel:** AST, Composer namespaces, direct dependency and ORM checks, examples from a consented/sanitized project.
- **Milestone 3 — TypeScript/NestJS:** resolved dependency graph, Prisma/ORM checks, consistent findings.
- **Milestone 4 — CI/Agent:** baseline, changed-code enforcement, AGENTS.md / SKILL.md generator, demo and benchmark fixtures.

Stop expanding framework support until the two shipped adapters pass the same quality bar.

## 12. Launch/demo requirements

Create a reproducible demo repository with two branches:

- **Bad AI implementation:** Laravel Controller directly uses `User::where()`, Service includes redundant catch, and NestJS Controller accesses Prisma.
- **NoBypass-compliant implementation:** the queries are relocated to approved layers; the warning behavior is controlled by contract.

README headline: **"Your AI said it followed your architecture. Check."**

Show a single terminal command and a before/after CI failure. The claim is **prevention of detectable architecture violations**, never proof that the application is fully correct.

## 13. Essential decisions and open risks

- **Do we require exact path-through-every-layer?** No for v0.1. We enforce direct dependency boundaries and known disallowed operations; runtime call flow is not statically provable in general.
- **Where does Support live?** Team-configurable. Some Laravel codebases do not use it, and frameworks differ.
- **What about catch in Services?** Allowed when justified, policy-driven; no unconditional ban.
- **What about existing violations?** Reviewable baseline and new-violations-only CI.
- **Can AI overwrite the contract?** It could edit files locally. Governance depends on protected CI/config ownership, not prompt instructions alone.
- **What if detection is wrong?** Never auto-approve; show evidence and let a human edit/reject.
- **What if dependencies are dynamic?** Mark unverified and report coverage rather than asserting compliance.

---

### Useful technical references

- [php-parser](https://github.com/glayzzle/php-parser) — Node.js PHP AST parser.
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) — TypeScript/JavaScript dependency rules and graph.
- [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) — repository-level instructions.
- [Agent Skills specification](https://agentskills.io/specification) — portable skill packaging.
- [Claude Code hooks](https://claude.com/blog/how-to-configure-hooks) — optional future integration.
