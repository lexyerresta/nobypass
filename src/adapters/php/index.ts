import fs from 'node:fs';
import path from 'node:path';
import { Engine } from 'php-parser';
import type { Adapter, AdapterContext, PreparedAdapter } from '../types.js';
import { documentedCatchReason, emptyAnalysis } from '../types.js';
import type { Dependency, DependencyKind, FileAnalysis } from '../../core/types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

const BUILTIN_TYPES = new Set([
  'string', 'int', 'integer', 'float', 'double', 'bool', 'boolean', 'array', 'callable', 'iterable',
  'object', 'mixed', 'void', 'null', 'never', 'false', 'true', 'self', 'static', 'parent', 'resource',
]);

/** Base classes that make a class an Eloquent model. Lowercased FQCNs. */
const MODEL_BASES = new Set([
  'illuminate\\database\\eloquent\\model',
  'illuminate\\foundation\\auth\\user',
  'illuminate\\database\\eloquent\\relations\\pivot',
  'mongodb\\laravel\\eloquent\\model',
  'jenssegers\\mongodb\\eloquent\\model',
]);

const DB_FACADES = new Set(['illuminate\\support\\facades\\db', 'db']);

/** Doctrine (Symfony) types whose method calls are direct database access. Lowercased FQCNs. */
const DOCTRINE_HANDLES = new Set([
  'doctrine\\orm\\entitymanagerinterface',
  'doctrine\\orm\\entitymanager',
  'doctrine\\persistence\\objectmanager',
  'doctrine\\persistence\\managerregistry',
  'doctrine\\dbal\\connection',
]);

/** DB facade calls that read or write data. Transaction boundaries are deliberately excluded. */
const DB_DATA_METHODS = new Set([
  'table', 'select', 'selectone', 'scalar', 'insert', 'update', 'delete', 'statement', 'unprepared',
  'affectingstatement', 'cursor', 'query', 'raw', 'connection', 'selectresultsets',
]);

/** Static Eloquent entry points. Anything starting with `where`/`orWhere` also counts. */
const ELOQUENT_STATIC = new Set([
  'query', 'all', 'find', 'findorfail', 'findornew', 'findmany', 'findor', 'first', 'firstorfail',
  'firstornew', 'firstorcreate', 'firstwhere', 'create', 'forcecreate', 'insert', 'insertgetid',
  'insertorignore', 'update', 'updateorcreate', 'upsert', 'destroy', 'get', 'paginate',
  'simplepaginate', 'cursorpaginate', 'with', 'withcount', 'withsum', 'select', 'selectraw',
  'orderby', 'orderbydesc', 'latest', 'oldest', 'count', 'sum', 'avg', 'max', 'min', 'exists',
  'doesntexist', 'pluck', 'value', 'sole', 'chunk', 'chunkbyid', 'each', 'lazy', 'cursor', 'join',
  'leftjoin', 'groupby', 'having', 'limit', 'take', 'skip', 'offset', 'has', 'wherehas',
  'doesnthave', 'withtrashed', 'onlytrashed', 'truncate', 'on', 'fromquery', 'hydrate',
]);

function isEloquentStatic(method: string): boolean {
  const m = method.toLowerCase();
  return ELOQUENT_STATIC.has(m) || m.startsWith('where') || m.startsWith('orwhere');
}

interface ClassInfo {
  file: string;
  extends: string | null;
  /** For Laravel facades: the class returned by getFacadeAccessor(), when it is a class name. */
  facadeAccessor: string | null;
}

const FACADE_BASE = 'illuminate\\support\\facades\\facade';
/** Laravel real-time facades: `Facades\App\Services\Foo` proxies `App\Services\Foo`. */
const REALTIME_FACADE = /^facades\\/i;

/** Returns the class named by `return X::class;` or `return 'App\X';` inside getFacadeAccessor(). */
function facadeAccessorOf(classNode: Node, scope: Scope): string | null {
  for (const member of classNode.body ?? []) {
    if (member.kind !== 'method' || member.name?.name?.toLowerCase() !== 'getfacadeaccessor') continue;
    for (const stmt of member.body?.children ?? []) {
      if (stmt.kind !== 'return' || !stmt.expr) continue;
      const e = stmt.expr;
      if (e.kind === 'staticlookup' && e.offset?.name === 'class' && e.what?.kind === 'name') return resolveName(e.what, scope);
      if (e.kind === 'string' && /\\/.test(e.value)) return String(e.value).replace(/^\\+/, '');
    }
  }
  return null;
}

interface Psr4Entry {
  prefix: string;
  dirs: string[];
}

function lineOf(node: Node): number {
  return node?.loc?.start?.line ?? 0;
}

function normalizeDir(d: string): string {
  return d.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

export function readPsr4(projectRoot: string): Psr4Entry[] {
  const file = path.join(projectRoot, 'composer.json');
  if (!fs.existsSync(file)) return [];
  let composer: any;
  try {
    composer = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  const out: Psr4Entry[] = [];
  for (const section of ['autoload', 'autoload-dev']) {
    const map = composer?.[section]?.['psr-4'] ?? {};
    for (const [prefix, dirs] of Object.entries(map)) {
      const list = (Array.isArray(dirs) ? dirs : [dirs]) as string[];
      out.push({ prefix: prefix.replace(/^\\+/, ''), dirs: list.map(normalizeDir) });
    }
  }
  // Longest prefix first so `App\Domain\` wins over `App\`.
  return out.sort((a, b) => b.prefix.length - a.prefix.length);
}

interface Scope {
  namespace: string;
  /** lowercase alias → FQCN */
  uses: Map<string, string>;
}

function createEngine(): Engine {
  return new Engine({
    parser: { php8: true, suppressErrors: false, extractDoc: false },
    ast: { withPositions: true },
  });
}

/** Builds class scopes for each namespace block in a program. */
function namespaceBlocks(program: Node): Array<{ scope: Scope; children: Node[] }> {
  const blocks: Array<{ scope: Scope; children: Node[] }> = [];
  const topLevel: Node[] = [];
  for (const child of program.children ?? []) {
    if (child.kind === 'namespace') {
      blocks.push({ scope: { namespace: child.name ?? '', uses: new Map() }, children: child.children ?? [] });
    } else {
      topLevel.push(child);
    }
  }
  if (topLevel.length) blocks.unshift({ scope: { namespace: '', uses: new Map() }, children: topLevel });
  for (const block of blocks) {
    for (const child of block.children) {
      if (child.kind !== 'usegroup') continue;
      const groupType = child.type;
      for (const item of child.items ?? []) {
        const type = item.type ?? groupType;
        if (type === 'function' || type === 'const') continue;
        const fqcn = (child.name ? `${child.name}\\${item.name}` : item.name).replace(/^\\+/, '');
        const alias = item.alias?.name ?? fqcn.split('\\').pop()!;
        block.scope.uses.set(alias.toLowerCase(), fqcn);
      }
    }
  }
  return blocks;
}

/** Resolves a `name` node to a FQCN (no leading backslash), or null for builtins/self. */
function resolveName(node: Node, scope: Scope): string | null {
  const raw: string = node.name ?? '';
  if (!raw) return null;
  if (node.resolution === 'fqn') return raw.replace(/^\\+/, '');
  if (BUILTIN_TYPES.has(raw.toLowerCase())) return null;
  if (node.resolution === 'rn') {
    const rest = raw.replace(/^namespace\\/i, '');
    return scope.namespace ? `${scope.namespace}\\${rest}` : rest;
  }
  const [first, ...rest] = raw.split('\\');
  const aliased = scope.uses.get(first.toLowerCase());
  if (aliased) return rest.length ? `${aliased}\\${rest.join('\\')}` : aliased;
  return scope.namespace ? `${scope.namespace}\\${raw}` : raw;
}

/** Walks every child node, passing the parent and the key under which the child was found. */
function walk(node: Node, visit: (n: Node, parent: Node | null, key: string, inType: boolean) => boolean | void) {
  const go = (n: Node, parent: Node | null, key: string, inType: boolean) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const c of n) go(c, parent, key, inType);
      return;
    }
    if (typeof n.kind !== 'string') return;
    if (visit(n, parent, key, inType) === false) return;
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'kind' || k === 'leadingComments' || k === 'trailingComments') continue;
      const v = n[k];
      if (v && typeof v === 'object') {
        const childInType =
          inType || k === 'type' || n.kind === 'uniontype' || n.kind === 'intersectiontype' || n.kind === 'nullable';
        go(v, n, k, childInType);
      }
    }
  };
  go(node, null, '', false);
}

export const phpAdapter: Adapter = {
  language: 'php',
  supportedRules: ['BND001', 'BND002', 'BND003', 'BND004', 'EXC001', 'CFG001', 'ANL001'],

  prepare(ctx: AdapterContext): PreparedAdapter {
    const engine = createEngine();
    const psr4 = readPsr4(ctx.projectRoot);
    const astCache = new Map<string, { content: string; ast: Node | null; error: string | null }>();

    const parse = (file: string, content: string): { ast: Node | null; error: string | null } => {
      const cached = astCache.get(file);
      if (cached && cached.content === content) return cached;
      let entry: { content: string; ast: Node | null; error: string | null };
      try {
        entry = { content, ast: engine.parseCode(content, file), error: null };
      } catch (err) {
        const e = err as Error & { lineNumber?: number };
        entry = { content, ast: null, error: `${e.message}${e.lineNumber ? ` (line ${e.lineNumber})` : ''}` };
      }
      astCache.set(file, entry);
      return entry;
    };

    // Index declared classes so references resolve even when a file breaks PSR-4 conventions.
    const classIndex = new Map<string, ClassInfo>();
    for (const file of ctx.files) {
      const content = ctx.read(file);
      if (content == null) continue;
      const { ast } = parse(file, content);
      if (!ast) continue;
      for (const { scope, children } of namespaceBlocks(ast)) {
        for (const child of children) {
          if (!['class', 'interface', 'trait', 'enum'].includes(child.kind) || !child.name?.name) continue;
          const fqcn = scope.namespace ? `${scope.namespace}\\${child.name.name}` : child.name.name;
          const ext = child.kind === 'class' && child.extends ? resolveName(child.extends, scope) : null;
          const facadeAccessor = child.kind === 'class' ? facadeAccessorOf(child, scope) : null;
          classIndex.set(fqcn.toLowerCase(), { file, extends: ext, facadeAccessor });
        }
      }
    }

    type Resolution = { status: 'internal'; file: string } | { status: 'external' } | { status: 'unresolved' };
    const resolutionCache = new Map<string, Resolution>();
    const resolveClass = (fqcn: string): Resolution => {
      const key = fqcn.toLowerCase();
      const hit = resolutionCache.get(key);
      if (hit) return hit;
      let res: Resolution = { status: 'external' };
      const indexed = classIndex.get(key);
      if (indexed) {
        res = { status: 'internal', file: indexed.file };
      } else {
        const entry = psr4.find((e) => key.startsWith(e.prefix.toLowerCase()));
        if (entry) {
          res = { status: 'unresolved' };
          const rel = fqcn.slice(entry.prefix.length).replace(/\\/g, '/');
          for (const dir of entry.dirs) {
            const candidate = dir ? `${dir}/${rel}.php` : `${rel}.php`;
            if (fs.existsSync(path.join(ctx.projectRoot, candidate))) {
              res = { status: 'internal', file: candidate };
              break;
            }
          }
        }
      }
      resolutionCache.set(key, res);
      return res;
    };

    /** The class a Laravel facade proxies, when the facade extends Illuminate's Facade and names a class. */
    const facadeTargetOf = (fqcn: string): string | null => {
      const info = classIndex.get(fqcn.toLowerCase());
      if (!info?.facadeAccessor) return null;
      const seen = new Set<string>();
      let cur: string | null = info.extends;
      while (cur && !seen.has(cur.toLowerCase())) {
        if (cur.toLowerCase() === FACADE_BASE) return info.facadeAccessor;
        seen.add(cur.toLowerCase());
        cur = classIndex.get(cur.toLowerCase())?.extends ?? null;
      }
      return null;
    };

    const isModelClass = (fqcn: string): boolean => {
      const seen = new Set<string>();
      let cur: string | null = fqcn;
      while (cur && !seen.has(cur.toLowerCase())) {
        const key = cur.toLowerCase();
        seen.add(key);
        if (MODEL_BASES.has(key)) return true;
        const info = classIndex.get(key);
        const res = resolveClass(cur);
        if (res.status === 'internal' && ctx.isModelLayerFile(res.file)) return true;
        cur = info?.extends ?? null;
      }
      return false;
    };

    return {
      analyze(file: string, content: string): FileAnalysis {
        const result = emptyAnalysis(file);
        const { ast, error } = parse(file, content);
        if (!ast) {
          result.parseError = error ?? 'unknown parse error';
          return result;
        }
        const lines = content.split(/\r?\n/);
        const deps = new Map<string, Dependency>();
        const unresolvedSeen = new Set<string>();
        const injected = new Set<Node>();

        const addDep = (fqcn: string, line: number, kind: DependencyKind, via?: string) => {
          // A real-time facade is a dependency on the class it proxies.
          if (REALTIME_FACADE.test(fqcn)) {
            addDep(fqcn.replace(REALTIME_FACADE, ''), line, kind, `real-time facade ${fqcn}`);
            return;
          }
          const res = resolveClass(fqcn);
          if (res.status === 'unresolved') {
            if (!unresolvedSeen.has(fqcn.toLowerCase())) {
              unresolvedSeen.add(fqcn.toLowerCase());
              result.unresolved.push({
                symbol: fqcn,
                line,
                reason: 'unresolved',
                detail: `class ${fqcn} matches a PSR-4 namespace but no file declares it`,
              });
            }
            return;
          }
          const key = fqcn.toLowerCase();
          const existing = deps.get(key);
          if (existing) {
            if (kind === 'runtime' && existing.kind === 'type') {
              existing.kind = 'runtime';
              existing.line = line;
            }
            return;
          }
          deps.set(key, {
            target: res.status === 'internal' ? res.file : null,
            symbol: via ? `${fqcn} (via ${via})` : fqcn,
            line,
            kind,
            external: res.status === 'external',
          });
          // Calling a facade is calling the class behind it, so that edge is checked too.
          const proxied = res.status === 'internal' ? facadeTargetOf(fqcn) : null;
          if (proxied && proxied.toLowerCase() !== key) addDep(proxied, line, kind, `facade ${fqcn}`);
        };

        for (const { scope, children } of namespaceBlocks(ast)) {
          // `use` imports count as (type-level) dependencies even if only referenced in docblocks.
          for (const child of children) {
            if (child.kind !== 'usegroup') continue;
            for (const item of child.items ?? []) {
              const type = item.type ?? child.type;
              if (type === 'function' || type === 'const') continue;
              const fqcn = (child.name ? `${child.name}\\${item.name}` : item.name).replace(/^\\+/, '');
              addDep(fqcn, lineOf(item) || lineOf(child), 'type');
            }
          }

          // Doctrine handles (Symfony): parameters and properties typed with an entity manager or DBAL connection.
          const doctrineHandles = new Map<string, string>();
          walk(children, (n) => {
            if ((n.kind === 'parameter' || n.kind === 'property') && n.type?.kind === 'name' && n.name?.name) {
              const fqcn = resolveName(n.type, scope);
              if (fqcn && DOCTRINE_HANDLES.has(fqcn.toLowerCase())) doctrineHandles.set(n.name.name, fqcn.split('\\').pop()!);
            }
          });

          walk(children, (n, parent, key, inType) => {
            if (n.kind === 'usegroup') return false;

            // $this->em->persist(...) or $em->flush() on a Doctrine handle is direct database access.
            if (n.kind === 'call' && n.what?.kind === 'propertylookup' && doctrineHandles.size) {
              const target = n.what.what;
              const method = n.what.offset?.kind === 'identifier' ? n.what.offset.name : '?';
              let handle: string | null = null;
              if (target?.kind === 'variable' && target.name !== 'this') handle = target.name;
              else if (target?.kind === 'propertylookup' && target.what?.kind === 'variable' && target.what.name === 'this' && target.offset?.kind === 'identifier') handle = target.offset.name;
              if (handle && doctrineHandles.has(handle)) {
                result.operations.push({
                  symbol: `${doctrineHandles.get(handle)}->${method}`,
                  line: lineOf(n),
                  evidence: `Doctrine access through ${doctrineHandles.get(handle)} ($${handle}->${method}())`,
                  target: null,
                  confidence: 'high',
                });
              }
            }

            // Constructor-injected types are resolved by the container at runtime.
            if (n.kind === 'method' && n.name?.name?.toLowerCase() === '__construct') {
              for (const arg of n.arguments ?? []) {
                walk(arg.type, (t) => {
                  if (t.kind === 'name') injected.add(t);
                });
              }
            }

            if (n.kind === 'try') {
              for (const c of n.catches ?? []) {
                const line = lineOf(c);
                const caught = (c.what ?? []).map((w: Node) => resolveName(w, scope) ?? w.name);
                result.catches.push({ line, caught, documentedReason: documentedCatchReason(lines, line) });
              }
            }

            if (n.kind === 'staticlookup' && parent?.kind === 'call' && key === 'what') {
              const method: string | undefined = n.offset?.kind === 'identifier' ? n.offset.name : undefined;
              if (!method) return;
              if (n.what?.kind === 'name') {
                const fqcn = resolveName(n.what, scope);
                if (!fqcn) return;
                const lower = fqcn.toLowerCase();
                if (DB_FACADES.has(lower) && DB_DATA_METHODS.has(method.toLowerCase())) {
                  result.operations.push({
                    symbol: `DB::${method}`,
                    line: lineOf(n),
                    evidence: `Query builder call DB::${method}()`,
                    target: null,
                    confidence: 'high',
                  });
                } else if (isEloquentStatic(method) && isModelClass(fqcn)) {
                  const res = resolveClass(fqcn);
                  result.operations.push({
                    symbol: `${fqcn}::${method}`,
                    line: lineOf(n),
                    evidence: `Eloquent query ${fqcn.split('\\').pop()}::${method}()`,
                    target: res.status === 'internal' ? res.file : null,
                    confidence: 'high',
                  });
                }
              } else if (
                n.what &&
                !['selfreference', 'staticreference', 'parentreference'].includes(n.what.kind) &&
                isEloquentStatic(method)
              ) {
                result.unresolved.push({
                  symbol: `<dynamic>::${method}`,
                  line: lineOf(n),
                  reason: 'dynamic',
                  detail: `dynamic static call ::${method}() — class cannot be resolved statically`,
                });
              }
            }

            if (n.kind !== 'name') return;
            // Function calls (`foo()`) and bare constants are not class references.
            if (parent?.kind === 'call' && key === 'what') return;
            const fqcn = resolveName(n, scope);
            if (!fqcn) return;
            const line = lineOf(n);
            const p = parent?.kind;
            let kind: DependencyKind | null = null;
            if (injected.has(n)) kind = 'runtime';
            else if (p === 'new' && key === 'what') kind = 'runtime';
            else if (p === 'staticlookup' && key === 'what') kind = 'runtime';
            else if ((p === 'class' || p === 'interface' || p === 'enum') && (key === 'extends' || key === 'implements')) kind = 'runtime';
            else if (p === 'traituse') kind = 'runtime';
            else if (p === 'catch' || p === 'attribute') kind = 'type';
            else if (p === 'instanceof' && key === 'right') kind = 'type';
            else if (inType) kind = 'type';
            if (!kind) return;
            addDep(fqcn, line, kind);
            if (p === 'new' && kind === 'runtime' && isModelClass(fqcn)) {
              const res = resolveClass(fqcn);
              result.operations.push({
                symbol: `new ${fqcn}`,
                line,
                evidence: `Instantiates Eloquent model ${fqcn.split('\\').pop()}`,
                target: res.status === 'internal' ? res.file : null,
                confidence: 'medium',
              });
            }
          });
        }

        result.dependencies = [...deps.values()].sort((a, b) => a.line - b.line);
        return result;
      },
    };
  },
};
