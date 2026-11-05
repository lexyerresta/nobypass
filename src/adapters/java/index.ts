import type { Adapter, AdapterContext, PreparedAdapter } from '../types.js';
import { documentedCatchReason, emptyAnalysis } from '../types.js';
import { createParser, firstSyntaxError, line, walkNamed, type SyntaxNode } from '../treesitter.js';
import type { Dependency, FileAnalysis } from '../../core/types.js';

/** Injected types whose method calls are direct database access (JPA, Spring JDBC, Mongo, R2DBC, jOOQ, Hibernate, MyBatis). */
const DB_TYPES = new Set([
  'EntityManager',
  'EntityManagerFactory',
  'JdbcTemplate',
  'NamedParameterJdbcTemplate',
  'JdbcClient',
  'DataSource',
  'MongoTemplate',
  'ReactiveMongoTemplate',
  'R2dbcEntityTemplate',
  'DatabaseClient',
  'DSLContext',
  'Session',
  'SqlSession',
]);

const SOURCE_ROOT = /^(.*\/)?src\/main\/java\//;

function baseType(typeText: string): string {
  return typeText.replace(/<.*$/s, '').split('.').pop()!.trim();
}

export const javaAdapter: Adapter = {
  language: 'java',
  supportedRules: ['BND001', 'BND002', 'BND003', 'BND004', 'EXC001', 'CFG001', 'ANL001'],

  prepare(ctx: AdapterContext): PreparedAdapter {
    const parse = createParser('java');
    // Class index from the standard Maven/Gradle layout: <module>/src/main/java/<package path>/<Class>.java.
    const byFqcn = new Map<string, string>();
    const byPackage = new Map<string, Map<string, string>>();
    const prefixes = new Set<string>();
    for (const file of ctx.files) {
      const m = SOURCE_ROOT.exec(file);
      if (!m) continue;
      const rel = file.slice(m[0].length).replace(/\.java$/, '');
      const fqcn = rel.split('/').join('.');
      byFqcn.set(fqcn, file);
      const pkg = fqcn.includes('.') ? fqcn.slice(0, fqcn.lastIndexOf('.')) : '';
      const simple = fqcn.split('.').pop()!;
      if (!byPackage.has(pkg)) byPackage.set(pkg, new Map());
      byPackage.get(pkg)!.set(simple, file);
      const segs = fqcn.split('.');
      if (segs.length > 2) prefixes.add(segs.slice(0, 2).join('.'));
    }
    const isProjectPackage = (fqcn: string) => [...prefixes].some((p) => fqcn === p || fqcn.startsWith(`${p}.`));
    /** Resolves a class name, walking up for nested classes (`a.b.Outer.Inner` -> Outer.java). */
    const resolve = (fqcn: string): string | null => {
      let cur = fqcn;
      while (cur.includes('.')) {
        const hit = byFqcn.get(cur);
        if (hit) return hit;
        cur = cur.slice(0, cur.lastIndexOf('.'));
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
        const add = (target: string, symbol: string, l: number) => {
          if (target === file || deps.has(target)) return;
          deps.set(target, { target, symbol, line: l, kind: 'runtime', external: false });
        };

        let pkg = '';
        const imported = new Map<string, string>(); // simple name -> fqcn
        const wildcards: string[] = [];
        const dbHandles = new Map<string, string>(); // variable/field name -> type
        const typeUses: Array<{ name: string; line: number }> = [];

        walkNamed(root, (n) => {
          switch (n.type) {
            case 'package_declaration':
              pkg = n.namedChildren.find((c) => c && (c.type === 'scoped_identifier' || c.type === 'identifier'))?.text ?? '';
              return false;
            case 'import_declaration': {
              const name = n.namedChildren.find((c) => c && (c.type === 'scoped_identifier' || c.type === 'identifier'))?.text ?? '';
              const isStatic = n.children.some((c) => c?.type === 'static');
              const isWildcard = n.namedChildren.some((c) => c?.type === 'asterisk');
              if (isWildcard && !isStatic) {
                wildcards.push(name);
                return false;
              }
              const target = resolve(name);
              if (target) {
                add(target, name, line(n));
                if (!isStatic) imported.set(name.split('.').pop()!, name);
              } else if (isProjectPackage(name)) {
                result.unresolved.push({ symbol: name, line: line(n), reason: 'unresolved', detail: `import ${name} is in this project's packages but no source file declares it` });
              }
              return false;
            }
            case 'type_identifier':
              typeUses.push({ name: n.text, line: line(n) });
              return;
            case 'method_invocation': {
              const obj = n.childForFieldName('object');
              const method = n.childForFieldName('name')?.text ?? '';
              let handle: string | null = null;
              if (obj?.type === 'identifier') handle = obj.text;
              else if (obj?.type === 'field_access' && obj.childForFieldName('object')?.type === 'this') handle = obj.childForFieldName('field')?.text ?? null;
              if (handle && dbHandles.has(handle)) {
                result.operations.push({
                  symbol: `${handle}.${method}`,
                  line: line(n),
                  evidence: `Direct database access through ${dbHandles.get(handle)} (${handle}.${method})`,
                  target: null,
                  confidence: 'high',
                });
              }
              // Static calls on a class name count as uses of that class.
              if (obj?.type === 'identifier' && /^[A-Z]/.test(obj.text)) typeUses.push({ name: obj.text, line: line(n) });
              return;
            }
            case 'field_declaration':
            case 'formal_parameter':
            case 'local_variable_declaration': {
              const type = n.childForFieldName('type');
              const t = type ? baseType(type.text) : '';
              if (DB_TYPES.has(t)) {
                if (n.type === 'formal_parameter') {
                  const nm = n.childForFieldName('name')?.text;
                  if (nm) dbHandles.set(nm, t);
                } else {
                  for (const d of n.namedChildren) {
                    if (d?.type === 'variable_declarator') {
                      const nm = d.childForFieldName('name')?.text;
                      if (nm) dbHandles.set(nm, t);
                    }
                  }
                }
              }
              return;
            }
            case 'catch_clause': {
              const l = line(n);
              const param = n.namedChildren.find((c) => c?.type === 'catch_formal_parameter');
              const caught = param?.namedChildren.find((c) => c?.type === 'catch_type')?.text ?? 'Throwable';
              result.catches.push({ line: l, caught: caught.split('|').map((s) => s.trim()), documentedReason: documentedCatchReason(lines, l) });
              return;
            }
            default:
              return;
          }
        });

        // Resolve type uses: explicit imports first, then the same package, then wildcard imports.
        const samePackage = byPackage.get(pkg);
        for (const use of typeUses) {
          if (imported.has(use.name)) continue;
          const local = samePackage?.get(use.name);
          if (local) {
            add(local, pkg ? `${pkg}.${use.name}` : use.name, use.line);
            continue;
          }
          for (const w of wildcards) {
            const hit = byPackage.get(w)?.get(use.name);
            if (hit) {
              add(hit, `${w}.${use.name}`, use.line);
              break;
            }
          }
        }

        result.dependencies = [...deps.values()].sort((a, b) => a.line - b.line);
        return result;
      },
    };
  },
};
