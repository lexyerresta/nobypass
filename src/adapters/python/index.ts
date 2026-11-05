import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, AdapterContext, PreparedAdapter } from '../types.js';
import { documentedCatchReason, emptyAnalysis } from '../types.js';
import { createParser, firstSyntaxError, line, walkNamed, type SyntaxNode } from '../treesitter.js';
import type { Dependency, DependencyKind, FileAnalysis } from '../../core/types.js';

/** Type names whose values are database sessions (SQLAlchemy / SQLModel). */
const SESSION_TYPES = /(^|\.)(Session|AsyncSession|scoped_session|Connection|AsyncConnection)$/;
/** FastAPI dependency providers that conventionally yield a session. */
const SESSION_PROVIDERS = /^(get_db|get_session|get_async_session|get_db_session|get_async_db|db_session)$/;
/** Context-manager factories that open a session: `with Session(engine) as s`, `with SessionLocal() as db`. */
const SESSION_FACTORIES = /(Session|SessionLocal|session_scope|get_session|begin)$/;

function dotted(node: SyntaxNode | null): string {
  return node ? node.text.replace(/\s+/g, '') : '';
}

export const pythonAdapter: Adapter = {
  language: 'python',
  supportedRules: ['BND001', 'BND002', 'BND003', 'BND004', 'EXC001', 'CFG001', 'ANL001'],

  prepare(ctx: AdapterContext): PreparedAdapter {
    const parse = createParser('python');
    const rootAbs = path.resolve(ctx.projectRoot);
    const roots = ['', ...(fs.existsSync(path.join(rootAbs, 'src')) ? ['src'] : [])];
    const exists = new Map<string, boolean>();
    const isFile = (rel: string) => {
      let hit = exists.get(rel);
      if (hit === undefined) {
        hit = fs.existsSync(path.join(rootAbs, rel)) && fs.statSync(path.join(rootAbs, rel)).isFile();
        exists.set(rel, hit);
      }
      return hit;
    };
    // Top-level names that belong to this project: an import of `app.x` is internal when `app` is one of them.
    const topLevel = new Set<string>();
    for (const root of roots) {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(path.join(rootAbs, root), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.')) {
          const dir = path.join(rootAbs, root, e.name);
          if (fs.existsSync(path.join(dir, '__init__.py')) || fs.readdirSync(dir).some((f) => f.endsWith('.py'))) {
            topLevel.add(e.name);
          }
        } else if (e.isFile() && e.name.endsWith('.py')) {
          topLevel.add(e.name.slice(0, -3));
        }
      }
    }

    /** Resolves a dotted module (relative to the import roots, or to a base directory) to a project file. */
    const moduleFile = (parts: string[], base?: string): string | null => {
      const bases = base !== undefined ? [base] : roots;
      for (const b of bases) {
        const stem = [b, ...parts].filter(Boolean).join('/');
        if (!stem) continue;
        if (isFile(`${stem}.py`)) return `${stem}.py`;
        if (isFile(`${stem}/__init__.py`)) return `${stem}/__init__.py`;
      }
      return null;
    };

    return {
      analyze(file: string, content: string): FileAnalysis {
        const result = emptyAnalysis(file);
        let root: SyntaxNode;
        try {
          root = parse(content).rootNode;
        } catch (err) {
          result.parseError = (err as Error).message;
          return result;
        }
        const syntax = firstSyntaxError(root);
        if (syntax) {
          result.parseError = syntax;
          return result;
        }
        const lines = content.split(/\r?\n/);
        const deps = new Map<string, Dependency>();
        const fileDir = path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file);
        const ormHandles = new Map<string, string>(); // local name -> description

        const addModule = (moduleName: string, parts: string[], node: SyntaxNode, kind: DependencyKind, base?: string) => {
          const target = moduleFile(parts, base);
          const internalName = base !== undefined || topLevel.has(parts[0]);
          if (!target) {
            if (internalName && parts.length) {
              result.unresolved.push({
                symbol: moduleName,
                line: line(node),
                reason: 'unresolved',
                detail: `module ${moduleName} looks like part of this project but no file defines it`,
              });
            }
            return;
          }
          const existing = deps.get(target);
          if (existing) {
            if (kind === 'runtime' && existing.kind === 'type') {
              existing.kind = 'runtime';
              existing.line = line(node);
            }
            return;
          }
          deps.set(target, { target, symbol: moduleName, line: line(node), kind, external: false });
        };

        const relativeBase = (prefix: string): string => {
          const ups = prefix.length - 1;
          let dir = fileDir;
          for (let i = 0; i < ups; i++) dir = path.posix.dirname(dir) === '.' ? '' : path.posix.dirname(dir);
          return dir;
        };

        const handleImport = (n: SyntaxNode, kind: DependencyKind) => {
          if (n.type === 'import_statement') {
            for (const c of n.namedChildren) {
              if (!c) continue;
              const nameNode = c.type === 'aliased_import' ? c.childForFieldName('name') : c;
              const name = dotted(nameNode);
              if (name) addModule(name, name.split('.'), n, kind);
            }
            return;
          }
          // import_from_statement
          const moduleNode = n.childForFieldName('module_name');
          if (!moduleNode) return;
          const names = n.childrenForFieldName('name').filter((x): x is SyntaxNode => !!x).map((c) =>
            dotted(c.type === 'aliased_import' ? c.childForFieldName('name') : c),
          );
          const local = n.childrenForFieldName('name').filter((x): x is SyntaxNode => !!x).map((c) =>
            c.type === 'aliased_import' ? dotted(c.childForFieldName('alias')) : dotted(c).split('.').pop()!,
          );
          let modParts: string[];
          let base: string | undefined;
          let display: string;
          if (moduleNode.type === 'relative_import') {
            const prefix = moduleNode.namedChildren.find((c) => c?.type === 'import_prefix')?.text ?? '.';
            const rest = dotted(moduleNode.namedChildren.find((c) => c?.type === 'dotted_name') ?? null);
            base = relativeBase(prefix);
            modParts = rest ? rest.split('.') : [];
            display = `${prefix}${rest}`;
          } else {
            display = dotted(moduleNode);
            modParts = display.split('.');
          }
          // django.db.connection and friends are raw database handles.
          if (display === 'django.db') {
            names.forEach((nm, i) => {
              if (nm === 'connection' || nm === 'connections') ormHandles.set(local[i], `django.db.${nm}`);
            });
          }
          if (!names.length) {
            addModule(display, modParts, n, kind, base);
            return;
          }
          // `from pkg import name` imports a submodule when one exists, otherwise a name from pkg itself.
          let resolvedAny = false;
          for (const nm of names) {
            const sub = [...modParts, ...nm.split('.')];
            if (moduleFile(sub, base)) {
              addModule(`${display}${display.endsWith('.') ? '' : '.'}${nm}`, sub, n, kind, base);
              resolvedAny = true;
            }
          }
          if (!resolvedAny) addModule(display, modParts, n, kind, base);
        };

        const isTypeCheckingIf = (n: SyntaxNode) =>
          n.type === 'if_statement' && /^(typing\.)?TYPE_CHECKING$/.test(dotted(n.childForFieldName('condition')));

        walkNamed(root, (n) => {
          if (isTypeCheckingIf(n)) {
            const body = n.childForFieldName('consequence');
            if (body) walkNamed(body, (m) => {
              if (m.type === 'import_statement' || m.type === 'import_from_statement') {
                handleImport(m, 'type');
                return false;
              }
            });
            return false;
          }
          if (n.type === 'import_statement' || n.type === 'import_from_statement') {
            handleImport(n, 'runtime');
            return false;
          }

          // Session-typed parameters and FastAPI `Depends(get_db)` defaults.
          if (n.type === 'typed_parameter' || n.type === 'typed_default_parameter' || n.type === 'default_parameter') {
            const nameNode = n.type === 'typed_parameter' ? n.namedChildren.find((c) => c?.type === 'identifier') : n.childForFieldName('name');
            const typeText = dotted(n.childForFieldName('type'));
            const value = n.childForFieldName('value');
            const dependsOn = value?.type === 'call' && dotted(value.childForFieldName('function')) === 'Depends'
              ? dotted(value.childForFieldName('arguments')?.namedChildren[0] ?? null)
              : '';
            const bareType = typeText.replace(/^Annotated\[|\].*$/g, '').split(',')[0];
            if (nameNode && (SESSION_TYPES.test(bareType) || SESSION_PROVIDERS.test(dependsOn) || /Depends\((get_db|get_session|get_async_session)\)/.test(typeText))) {
              ormHandles.set(nameNode.text, `session ${nameNode.text}`);
            }
          }
          // with Session(engine) as session / with SessionLocal() as db
          if (n.type === 'as_pattern') {
            const value = n.namedChildren[0];
            const alias = n.childForFieldName('alias') ?? n.namedChildren[n.namedChildCount - 1];
            if (value?.type === 'call' && SESSION_FACTORIES.test(dotted(value.childForFieldName('function'))) && alias) {
              ormHandles.set(dotted(alias), `session ${dotted(alias)}`);
            }
          }
          // session = SessionLocal()
          if (n.type === 'assignment') {
            const left = n.childForFieldName('left');
            const right = n.childForFieldName('right');
            if (left?.type === 'identifier' && right?.type === 'call' && /(SessionLocal|Session|sessionmaker\(.*\))$/.test(dotted(right.childForFieldName('function')))) {
              ormHandles.set(left.text, `session ${left.text}`);
            }
          }

          if (n.type === 'try_statement') {
            for (const c of n.namedChildren) {
              if (c?.type !== 'except_clause' && c?.type !== 'except_group_clause') continue;
              const l = line(c);
              const caught = c.namedChildren.filter((x) => x && x.type !== 'block').map((x) => x!.text);
              result.catches.push({ line: l, caught: caught.length ? caught : ['BaseException'], documentedReason: documentedCatchReason(lines, l) });
            }
          }

          if (n.type === 'call') {
            const fn = n.childForFieldName('function');
            const fnText = dotted(fn);
            // importlib.import_module(name) / __import__(name) with a computed name.
            if (/^(importlib\.)?import_module$|^__import__$/.test(fnText)) {
              const arg = n.childForFieldName('arguments')?.namedChildren[0];
              if (arg && arg.type !== 'string') {
                result.unresolved.push({ symbol: `<dynamic ${fnText}>`, line: line(n), reason: 'dynamic', detail: 'module name is computed at runtime' });
              }
            }
            if (fn?.type === 'attribute') {
              const obj = fn.childForFieldName('object');
              // Django ORM: Model.objects.<method>(...) counted once per chain, at the manager call.
              if (obj?.type === 'attribute' && obj.childForFieldName('attribute')?.text === 'objects') {
                result.operations.push({ symbol: fnText, line: line(n), evidence: `Django ORM query ${fnText}()`, target: null, confidence: 'high' });
              } else if (obj?.type === 'identifier' && ormHandles.has(obj.text)) {
                result.operations.push({ symbol: fnText, line: line(n), evidence: `Database access through ${ormHandles.get(obj.text)} (${fnText})`, target: null, confidence: 'high' });
              }
            }
          }
        });

        result.dependencies = [...deps.values()].sort((a, b) => a.line - b.line);
        return result;
      },
    };
  },
};
