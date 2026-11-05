import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser, type Node as TsNode, type Tree } from 'web-tree-sitter';

export type SyntaxNode = TsNode;

/** Grammars ship as WebAssembly in `grammars/` (MIT, see grammars/LICENSES.txt). No native build is needed. */
function grammarsDir(): string {
  // Works from src/adapters (tests) and dist/adapters (published package).
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', 'grammars');
}

await Parser.init();

const languages = {
  python: await Language.load(fs.readFileSync(path.join(grammarsDir(), 'tree-sitter-python.wasm'))),
  java: await Language.load(fs.readFileSync(path.join(grammarsDir(), 'tree-sitter-java.wasm'))),
};

export function createParser(language: keyof typeof languages): (source: string) => Tree {
  const parser = new Parser();
  parser.setLanguage(languages[language]);
  return (source: string) => {
    const tree = parser.parse(source);
    if (!tree) throw new Error('parser returned no tree');
    return tree;
  };
}

export function line(node: SyntaxNode): number {
  return node.startPosition.row + 1;
}

/** First syntax error in a tree, as "message (line N)", or null when the tree is clean. */
export function firstSyntaxError(root: SyntaxNode): string | null {
  if (!root.hasError) return null;
  const stack: SyntaxNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.isError || n.isMissing) {
      return `${n.isMissing ? `missing ${n.type}` : 'unexpected syntax'} (line ${line(n)})`;
    }
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i);
      if (c && c.hasError) stack.push(c);
      else if (c && (c.isError || c.isMissing)) stack.push(c);
    }
  }
  return 'syntax error';
}

/** Depth-first walk over named nodes. Return false from `visit` to skip a subtree. */
export function walkNamed(root: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  const stack: SyntaxNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (visit(n) === false) continue;
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i);
      if (c) stack.push(c);
    }
  }
}
