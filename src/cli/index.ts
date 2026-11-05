#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Command, Option } from 'commander';
import { agentInstructions, mergeIntoInstructions, readIfExists, skillMarkdown, writeFileSafe } from '../agents/index.js';
import { approveContract, isNonInteractive } from '../core/approve.js';
import { buildBaseline, writeBaseline } from '../core/baseline.js';
import { EXIT, loadApprovedContract, runCheck } from '../core/check.js';
import { CONTRACT_FILE, ContractError, PROPOSED_FILE } from '../core/config.js';
import { analyzeProject } from '../core/engine.js';
import { explain } from '../core/explain.js';
import { color, formatJson, formatSarif, formatText } from '../core/format.js';
import { gitUserName } from '../core/git.js';
import { discover, renderProposalYaml, renderReport } from '../discovery/index.js';

const VERSION = '0.1.0';
const REPORT_FILE = path.join('.nobypass', 'discovery.txt');

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function fail(message: string, code: number = EXIT.INVALID): never {
  process.stderr.write(color.red(`✖ ${message}\n`));
  process.exit(code);
}

const program = new Command();
program
  .name('nobypass')
  .description('AI writes the code. Your architecture sets the rules.')
  .version(VERSION)
  .option('-C, --cwd <dir>', 'repository directory', process.cwd());

const cwdOf = () => path.resolve(program.opts().cwd as string);

program
  .command('init')
  .description(`propose a contract from the repository (writes only ${PROPOSED_FILE} and ${REPORT_FILE})`)
  .action(() => {
    const cwd = cwdOf();
    const result = discover(cwd);
    writeFileSafe(path.join(cwd, PROPOSED_FILE), renderProposalYaml(result));
    const report = renderReport(result);
    writeFileSafe(path.join(cwd, REPORT_FILE), report + '\n');
    process.stdout.write(report + '\n\n');
    process.stdout.write(`Wrote ${PROPOSED_FILE} and ${REPORT_FILE.replace(/\\/g, '/')}. No source files or agent instructions were changed.\n`);
    if (fs.existsSync(path.join(cwd, CONTRACT_FILE))) {
      process.stdout.write(color.yellow(`Note: ${CONTRACT_FILE} already exists and is still the enforced contract.\n`));
    }
    if (!result.projects.length) process.exit(EXIT.NOT_APPROVED);
  });

program
  .command('discovery')
  .description('discovery commands')
  .command('show')
  .description('show detected framework, layers, evidence, coverage and uncertainty (read-only)')
  .action(() => {
    process.stdout.write(renderReport(discover(cwdOf())) + '\n');
  });

program
  .command('approve')
  .description(`review and approve ${PROPOSED_FILE} into the enforced ${CONTRACT_FILE} (interactive only)`)
  .option('--file <path>', 'proposal to approve', PROPOSED_FILE)
  .action(async (opts: { file: string }) => {
    const cwd = cwdOf();
    if (isNonInteractive()) {
      fail('approve is interactive only and refuses to run in CI or without a terminal. A human must approve the contract.');
    }
    const proposalPath = path.resolve(cwd, opts.file);
    if (!fs.existsSync(proposalPath)) fail(`${opts.file} not found — run \`nobypass init\` first.`, EXIT.NOT_APPROVED);
    let approved: ReturnType<typeof approveContract>;
    const by = gitUserName(cwd) ?? os.userInfo().username;
    try {
      approved = approveContract(fs.readFileSync(proposalPath, 'utf8'), { by });
    } catch (err) {
      const e = err as ContractError;
      process.stderr.write(color.red(`✖ ${e.message}\n`));
      for (const i of e.issues ?? []) process.stderr.write(`  - ${i}\n`);
      process.exit(EXIT.INVALID);
    }
    for (const p of approved.contract.projects) {
      const run = analyzeProject(cwd, p);
      const assigned = run.files.filter((f) => run.ctx.layers.assign(f).layer).length;
      const blocking = run.findings.filter((f) => f.severity === 'error').length;
      process.stdout.write(color.bold(`\nProject "${p.id}" (${p.framework}, root ${p.root})\n`));
      for (const [from, to] of Object.entries(p.dependencies.allowed_direct)) {
        process.stdout.write(`  ${from} → ${to.length ? to.join(', ') : '(nothing)'}\n`);
      }
      process.stdout.write(`  coverage: ${assigned}/${run.files.length} files assigned to a layer\n`);
      process.stdout.write(`  existing violations under this contract: ${blocking} error(s)\n`);
      if (blocking) process.stdout.write(color.yellow('  → after approving, fix them or run `nobypass baseline create` to record them as known debt.\n'));
    }
    const target = path.join(cwd, CONTRACT_FILE);
    if (fs.existsSync(target)) process.stdout.write(color.yellow(`\n${CONTRACT_FILE} already exists and will be replaced.\n`));
    const answer = await ask(`\nType "approve" to write ${CONTRACT_FILE} as ${by}: `);
    if (answer !== 'approve') fail('Not approved. Nothing was written.', EXIT.NOT_APPROVED);
    fs.writeFileSync(target, approved.text);
    process.stdout.write(color.green(`✔ Wrote ${CONTRACT_FILE}. Commit it and protect it with CODEOWNERS.\n`));
    process.stdout.write('Next: `nobypass agents generate`, then `nobypass check`.\n');
  });

program
  .command('check')
  .description('check the repository against the approved contract (read-only)')
  .option('--since <ref>', 'only fail on violations that are new relative to this git ref (e.g. origin/main)')
  .addOption(new Option('--format <format>', 'output format').choices(['text', 'json', 'sarif']).default('text'))
  .option('--output <file>', 'also write the report to a file')
  .option('--strict', 'new warnings also fail the check')
  .option('--config <file>', `contract file (default ${CONTRACT_FILE})`)
  .action((opts: { since?: string; format: string; output?: string; strict?: boolean; config?: string }) => {
    const cwd = cwdOf();
    const result = runCheck({ cwd, since: opts.since, strict: opts.strict, config: opts.config });
    const roots: Record<string, string> = {};
    const loaded = result.contractPath ? loadApprovedContract({ cwd, config: opts.config }) : null;
    if (loaded?.ok) for (const p of loaded.contract.projects) roots[p.id] = p.root;
    const text =
      opts.format === 'json' ? formatJson(result) : opts.format === 'sarif' ? formatSarif(result, roots) : formatText(result, roots);
    process.stdout.write(text + '\n');
    if (opts.output) writeFileSafe(path.resolve(cwd, opts.output), text + '\n');
    process.exitCode = result.exitCode;
  });

program
  .command('explain <rule>')
  .description('explain a rule, or its findings in one file')
  .option('--file <path>', 'file to explain findings for')
  .option('--config <file>', `contract file (default ${CONTRACT_FILE})`)
  .action((rule: string, opts: { file?: string; config?: string }) => {
    const res = explain(cwdOf(), rule, opts.file, opts.config);
    process.stdout.write(res.text + '\n');
    process.exitCode = res.exitCode;
  });

program
  .command('agents')
  .description('agent integration')
  .command('generate')
  .description('write agent guidance (AGENTS.md block and/or SKILL.md) from the approved contract')
  .option('--file <path>', 'instructions file to create or update', 'AGENTS.md')
  .option('--skill [dir]', 'also write a portable Agent Skill (SKILL.md)', false)
  .option('--base <ref>', 'base ref agents should check against', 'origin/main')
  .option('--stdout', 'print the guidance instead of writing files')
  .option('-y, --yes', 'do not ask before modifying an existing instructions file')
  .action(async (opts: { file: string; skill: string | boolean; base: string; stdout?: boolean; yes?: boolean }) => {
    const cwd = cwdOf();
    const loaded = loadApprovedContract({ cwd });
    if (!loaded.ok) fail(loaded.result.error ?? 'no contract', loaded.result.exitCode);
    const body = agentInstructions(loaded.contract, { baseRef: opts.base });
    if (opts.stdout) {
      process.stdout.write(body + '\n');
      return;
    }
    const target = path.resolve(cwd, opts.file);
    const existing = readIfExists(target);
    const merged = mergeIntoInstructions(existing, body);
    if (merged.action === 'unchanged') {
      process.stdout.write(`${opts.file} is already up to date.\n`);
    } else {
      if (existing != null && !opts.yes) {
        if (isNonInteractive()) {
          process.stdout.write(body + '\n');
          fail(`${opts.file} exists; refusing to modify it without consent. Re-run with --yes, or paste the block above.`, EXIT.INVALID);
        }
        const verb = merged.action === 'replace' ? 'replace the NoBypass block in' : 'append a delimited NoBypass block to';
        const answer = await ask(`${opts.file} exists. ${verb} it? [y/N] `);
        if (!/^y(es)?$/i.test(answer)) fail('Nothing written.', EXIT.OK);
      }
      writeFileSafe(target, merged.content);
      process.stdout.write(color.green(`✔ ${merged.action === 'create' ? 'Created' : 'Updated'} ${opts.file}\n`));
    }
    if (opts.skill) {
      const dir = typeof opts.skill === 'string' ? opts.skill : path.join('.claude', 'skills', 'nobypass');
      const skillFile = path.resolve(cwd, dir, 'SKILL.md');
      if (fs.existsSync(skillFile) && !opts.yes) {
        if (isNonInteractive()) fail(`${skillFile} exists; re-run with --yes to overwrite.`, EXIT.INVALID);
        const answer = await ask(`${path.relative(cwd, skillFile)} exists. Overwrite? [y/N] `);
        if (!/^y(es)?$/i.test(answer)) fail('Skill not written.', EXIT.OK);
      }
      writeFileSafe(skillFile, skillMarkdown(loaded.contract, { baseRef: opts.base }));
      process.stdout.write(color.green(`✔ Wrote ${path.relative(cwd, skillFile).replace(/\\/g, '/')}\n`));
    }
  });

program
  .command('baseline')
  .description('legacy violation baseline')
  .command('create')
  .description('record current violations as reviewed known debt (separate, explicit approval)')
  .option('-y, --yes', 'skip the confirmation prompt (never allowed in CI)')
  .action(async (opts: { yes?: boolean }) => {
    const cwd = cwdOf();
    if (process.env.CI) fail('baseline create is refused in CI. Baselines must be created and reviewed by a human.');
    const loaded = loadApprovedContract({ cwd });
    if (!loaded.ok) fail(loaded.result.error ?? 'no contract', loaded.result.exitCode);
    const byFile = new Map<string, ReturnType<typeof analyzeProject>['findings']>();
    let analysisFailures = 0;
    for (const p of loaded.contract.projects) {
      const run = analyzeProject(loaded.contractDir, p);
      const target = path.resolve(loaded.contractDir, p.baseline);
      byFile.set(target, [...(byFile.get(target) ?? []), ...run.findings]);
      analysisFailures += run.findings.filter((f) => f.ruleId === 'ANL001' && f.severity === 'error').length;
    }
    const total = [...byFile.values()].reduce((n, f) => n + f.filter((x) => x.ruleId !== 'ANL001').length, 0);
    process.stdout.write(`${total} finding(s) would be recorded as known debt.\n`);
    if (analysisFailures) {
      process.stdout.write(color.yellow(`${analysisFailures} analysis failure(s) (ANL001) cannot be baselined and will keep failing.\n`));
    }
    if (!opts.yes) {
      if (isNonInteractive()) fail('Refusing to create a baseline without confirmation. Re-run in a terminal or pass --yes.');
      const answer = await ask('Record them in the baseline? Review the file before committing. [y/N] ');
      if (!/^y(es)?$/i.test(answer)) fail('Nothing written.', EXIT.OK);
    }
    const by = gitUserName(cwd) ?? os.userInfo().username;
    for (const [file, findings] of byFile) {
      const baseline = buildBaseline(findings, by);
      writeBaseline(file, baseline);
      process.stdout.write(color.green(`✔ Wrote ${path.relative(cwd, file).replace(/\\/g, '/')} (${baseline.entries.length} entries)\n`));
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  fail((err as Error).stack ?? String(err));
});
