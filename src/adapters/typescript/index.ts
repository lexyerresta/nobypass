import path from 'node:path';
import ts from 'typescript';
import type { Adapter, AdapterContext, PreparedAdapter } from '../types.js';
import { documentedCatchReason, emptyAnalysis } from '../types.js';
import type { Dependency, FileAnalysis } from '../../core/types.js';
import { toPosix } from '../../core/files.js';

export const DEFAULT_ORM_PACKAGES = [
  '@prisma/client',
  'typeorm',
  'mongoose',
  'sequelize',
  'sequelize-typescript',
  'drizzle-orm',
  'knex',
  '@mikro-orm/core',
];

/** Named imports from ORM packages that indicate direct data access (not just model types). */
const ORM_ACCESS_IMPORTS = new Set([
  'PrismaClient',
  'DataSource',
  'EntityManager',
  'getRepository',
  'getManager',
  'getConnection',
  'createConnection',
  'Sequelize',
  'MikroORM',
  'drizzle',
]);

/** Injected types whose methods are data access. */
export const DEFAULT_ORM_CLIENTS = [
  'PrismaClient',
  'PrismaService',
  'DataSource',
  'EntityManager',
  'Repository',
  'MongoRepository',
  'TreeRepository',
  'Knex',
];

/** Layer names whose exports are database clients (`export const db = drizzle(...)`, `export const prisma = new PrismaClient()`). */
const PERSISTENCE_LAYERS = new Set(['persistence', 'db', 'database']);
/** Conventional names for imported database clients. */
const CLIENT_NAMES = /^(prisma|db|knex|sequelize|pool|sql|drizzle|mongoose|dataSource|AppDataSource)$/;
/** Static model methods (Mongoose, Sequelize, Objection) that query the database. */
const MODEL_STATIC_OPS = new Set([
  'find', 'findOne', 'findById', 'findAll', 'findByPk', 'findAndCountAll', 'findOrCreate', 'create', 'insertMany',
  'bulkCreate', 'updateOne', 'updateMany', 'update', 'deleteOne', 'deleteMany', 'destroy', 'upsert', 'aggregate',
  'countDocuments', 'count', 'exists', 'findOneAndUpdate', 'findOneAndDelete', 'findByIdAndUpdate', 'findByIdAndDelete',
  'query', 'where', 'distinct',
]);

/** Decorators that inject ORM handles regardless of the declared type. */
const ORM_INJECT_DECORATORS = new Set([
  'InjectRepository',
  'InjectModel',
  'InjectDataSource',
  'InjectEntityManager',
  'InjectConnection',
  'InjectKnex',
]);

interface CompilerSetup {
  options: ts.CompilerOptions;
  aliasPatterns: RegExp[];
}

function loadCompilerSetup(projectRoot: string): CompilerSetup {
  const fallback: ts.CompilerOptions = {
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    allowJs: true,
  };
  const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
  let options = fallback;
  if (configPath && path.resolve(path.dirname(configPath)).startsWith(path.resolve(projectRoot))) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!read.error) {
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath));
      options = { ...fallback, ...parsed.options };
    }
  }
  const aliasPatterns = Object.keys(options.paths ?? {}).map(
    (key) => new RegExp(`^${key.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '.*')}$`),
  );
  return { options, aliasPatterns };
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** Name of a type reference without generics or qualification: `Repository<User>` → `Repository`. */
function typeName(type: ts.TypeNode | undefined): string | null {
  if (!type) return null;
  if (ts.isTypeReferenceNode(type)) {
    const n = type.typeName;
    return ts.isIdentifier(n) ? n.text : n.right.text;
  }
  return null;
}

function decoratorNames(node: ts.Node): string[] {
  const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
  return decorators
    .map((d) => {
      const e = d.expression;
      if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) return e.expression.text;
      if (ts.isIdentifier(e)) return e.text;
      return null;
    })
    .filter((x): x is string => !!x);
}

/** Returns the root identifier name of `this.x.y.z` (→ `x`, viaThis) or `x.y.z` (→ `x`). */
function chainRoot(expr: ts.Expression): { name: string; viaThis: boolean } | null {
  let cur: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur) || ts.isNonNullExpression(cur)) {
    const inner: ts.Expression = cur.expression;
    if (ts.isPropertyAccessExpression(cur) && inner.kind === ts.SyntaxKind.ThisKeyword) {
      return { name: cur.name.text, viaThis: true };
    }
    cur = inner;
  }
  if (ts.isIdentifier(cur)) return { name: cur.text, viaThis: false };
  return null;
}

function isRelativeOrAbsolute(spec: string): boolean {
  return spec.startsWith('.') || spec.startsWith('/');
}

export const typescriptAdapter: Adapter = {
  language: 'typescript',
  supportedRules: ['BND001', 'BND002', 'BND003', 'BND004', 'EXC001', 'CFG001', 'ANL001'],

  prepare(ctx: AdapterContext): PreparedAdapter {
    const { options, aliasPatterns } = loadCompilerSetup(ctx.projectRoot);
    const rootAbs = path.resolve(ctx.projectRoot);
    const ormConfig = ctx.project.rules.direct_orm_access;
    const ormPackages = new Set(ormConfig?.packages ?? DEFAULT_ORM_PACKAGES);
    const clientTypes = new Set(ormConfig?.clients ?? DEFAULT_ORM_CLIENTS);
    const moduleCache = ts.createModuleResolutionCache(rootAbs, (s) => s.toLowerCase(), options);
    const clientClassFiles = new Map<string, string>();

    const sourceFile = (file: string, content: string) =>
      ts.createSourceFile(
        file,
        content,
        ts.ScriptTarget.Latest,
        true,
        /\.tsx$/.test(file)
          ? ts.ScriptKind.TSX
          : /\.jsx$/.test(file)
            ? ts.ScriptKind.JSX
            : /\.[mc]?js$/.test(file)
              ? ts.ScriptKind.JS
              : ts.ScriptKind.TS,
      );

    // Project classes extending an ORM client (e.g. `class PrismaService extends PrismaClient`) are clients too.
    for (const file of ctx.files) {
      const content = ctx.read(file);
      if (content == null || !/extends\s+(PrismaClient|DataSource|EntityManager)\b/.test(content)) continue;
      const sf = sourceFile(file, content);
      sf.forEachChild((node) => {
        if (!ts.isClassDeclaration(node) || !node.name) return;
        for (const clause of node.heritageClauses ?? []) {
          if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
          for (const t of clause.types) {
            const base = ts.isIdentifier(t.expression) ? t.expression.text : null;
            if (base && clientTypes.has(base)) {
              clientTypes.add(node.name.text);
              clientClassFiles.set(node.name.text, file);
            }
          }
        }
      });
    }

    const resolve = (spec: string, fromFile: string) => {
      const abs = path.join(rootAbs, fromFile);
      const res = ts.resolveModuleName(spec, abs, options, ts.sys, moduleCache).resolvedModule;
      if (!res) return null;
      const resolvedAbs = path.resolve(res.resolvedFileName);
      const rel = path.relative(rootAbs, resolvedAbs);
      const inside = !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.split(path.sep).includes('node_modules');
      return { file: inside ? toPosix(rel) : null, external: !inside || !!res.isExternalLibraryImport };
    };

    return {
      analyze(file: string, content: string): FileAnalysis {
        const result = emptyAnalysis(file);
        const sf = sourceFile(file, content);
        const diagnostics = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
        if (diagnostics.length) {
          const d = diagnostics[0];
          const line = d.start != null ? sf.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
          result.parseError = `${ts.flattenDiagnosticMessageText(d.messageText, '\n')} (line ${line})`;
          return result;
        }
        const lines = content.split(/\r?\n/);
        const deps = new Map<string, Dependency>();

        const addImport = (spec: string, node: ts.Node, typeOnly: boolean) => {
          const line = lineOf(sf, node);
          const res = resolve(spec, file);
          if (!res) {
            const looksInternal = isRelativeOrAbsolute(spec) || aliasPatterns.some((r) => r.test(spec));
            if (looksInternal) {
              result.unresolved.push({
                symbol: spec,
                line,
                reason: 'unresolved',
                detail: `import "${spec}" does not resolve to a project file`,
              });
            } else if (!deps.has(spec)) {
              deps.set(spec, { target: null, symbol: spec, line, kind: typeOnly ? 'type' : 'runtime', external: true });
            }
            return;
          }
          const key = res.file ?? spec;
          const existing = deps.get(key);
          if (existing) {
            if (!typeOnly && existing.kind === 'type') {
              existing.kind = 'runtime';
              existing.line = line;
            }
            return;
          }
          deps.set(key, {
            target: res.external ? null : res.file,
            symbol: res.external ? spec : res.file ?? spec,
            line,
            kind: typeOnly ? 'type' : 'runtime',
            external: res.external,
          });
        };

        const packageOf = (spec: string) => {
          const parts = spec.split('/');
          return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
        };

        // Names (this.x or local x) bound to ORM clients in this file.
        const clientNames = new Map<string, string>();
        // Imported model classes (Mongoose / Sequelize style): static query methods are data access.
        const modelNames = new Map<string, string>();

        const visit = (node: ts.Node) => {
          if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const spec = node.moduleSpecifier.text;
            const clause = node.importClause;
            const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : [];
            const typeOnly =
              !!clause?.isTypeOnly ||
              (!!clause && !clause.name && named.length > 0 && named.every((e) => e.isTypeOnly));
            addImport(spec, node, typeOnly);
            if (!typeOnly && clause) {
              const locals = [
                ...(clause.name ? [clause.name.text] : []),
                ...named.filter((e) => !e.isTypeOnly).map((e) => e.name.text),
                ...(clause.namedBindings && ts.isNamespaceImport(clause.namedBindings) ? [clause.namedBindings.name.text] : []),
              ];
              const res = resolve(spec, file);
              if (res?.file && !res.external) {
                const layer = ctx.layerOf(res.file);
                for (const local of locals) {
                  if (ctx.isModelLayerFile(res.file)) modelNames.set(local, `${local} from ${spec}`);
                  else if ((layer && PERSISTENCE_LAYERS.has(layer)) || CLIENT_NAMES.test(local)) clientNames.set(local, `${local} from ${spec}`);
                }
              }
            }
            if (!typeOnly && ormPackages.has(packageOf(spec))) {
              for (const el of named) {
                const imported = (el.propertyName ?? el.name).text;
                if (!el.isTypeOnly && ORM_ACCESS_IMPORTS.has(imported)) {
                  result.operations.push({
                    symbol: `${spec}#${imported}`,
                    line: lineOf(sf, node),
                    evidence: `Imports ORM handle ${imported} from ${spec}`,
                    target: null,
                    confidence: 'high',
                  });
                }
              }
            }
          } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            addImport(node.moduleSpecifier.text, node, node.isTypeOnly);
          } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            const e = node.moduleReference.expression;
            if (ts.isStringLiteral(e)) addImport(e.text, node, node.isTypeOnly);
          } else if (ts.isCallExpression(node)) {
            const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
            const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
            if (isDynamicImport || isRequire) {
              const arg = node.arguments[0];
              if (arg && ts.isStringLiteralLike(arg)) addImport(arg.text, node, false);
              else if (arg)
                result.unresolved.push({
                  symbol: `<dynamic ${isRequire ? 'require' : 'import'}>`,
                  line: lineOf(sf, node),
                  reason: 'dynamic',
                  detail: 'module specifier is computed at runtime',
                });
            }
          } else if (ts.isTryStatement(node) && node.catchClause) {
            const line = lineOf(sf, node.catchClause);
            const t = node.catchClause.variableDeclaration?.type;
            result.catches.push({
              line,
              caught: [t ? t.getText(sf) : 'unknown'],
              documentedReason: documentedCatchReason(lines, line),
            });
          }

          // Collect ORM client bindings: constructor params, properties, `new PrismaClient()`.
          if (ts.isParameter(node) || ts.isPropertyDeclaration(node)) {
            const name = ts.isIdentifier(node.name) ? node.name.text : null;
            const tName = typeName(node.type);
            const injected = decoratorNames(node).some((d) => ORM_INJECT_DECORATORS.has(d));
            if (name && ((tName && clientTypes.has(tName)) || injected)) clientNames.set(name, tName ?? 'injected');
          }
          if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            const init = node.initializer;
            if (ts.isNewExpression(init) && ts.isIdentifier(init.expression) && clientTypes.has(init.expression.text)) {
              clientNames.set(node.name.text, init.expression.text);
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(sf);

        // Second pass: calls rooted at a client binding are data access.
        if (clientNames.size || modelNames.size) {
          const visitCalls = (node: ts.Node) => {
            const callee = ts.isCallExpression(node)
              ? node.expression
              : ts.isTaggedTemplateExpression(node)
                ? node.tag
                : null;
            if (callee && (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))) {
              const root = chainRoot(callee);
              if (root && clientNames.has(root.name)) {
                const type = clientNames.get(root.name)!;
                const text = callee.getText(sf).replace(/\s+/g, '');
                result.operations.push({
                  symbol: text,
                  line: lineOf(sf, node),
                  evidence: `Direct ORM access through ${type} (${text})`,
                  target: clientClassFiles.get(type) ?? null,
                  confidence: 'high',
                });
                return; // don't double-count inner calls of the same chain
              }
              if (
                ts.isPropertyAccessExpression(callee) &&
                ts.isIdentifier(callee.expression) &&
                modelNames.has(callee.expression.text) &&
                MODEL_STATIC_OPS.has(callee.name.text)
              ) {
                const text = `${callee.expression.text}.${callee.name.text}`;
                result.operations.push({
                  symbol: text,
                  line: lineOf(sf, node),
                  evidence: `Model query ${text}() on ${modelNames.get(callee.expression.text)}`,
                  target: null,
                  confidence: 'high',
                });
                return;
              }
            }
            ts.forEachChild(node, visitCalls);
          };
          visitCalls(sf);
        }

        result.dependencies = [...deps.values()].sort((a, b) => a.line - b.line);
        return result;
      },
    };
  },
};
