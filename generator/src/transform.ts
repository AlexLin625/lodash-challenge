import { SyntaxKind } from 'ts-morph';
import type { SourceFile, ParameterDeclaration, FunctionDeclaration } from 'ts-morph';
import type { ChallengeGenerationConfig, TransformReport } from './types.ts';
import type { AnalysisResult } from './analyzer.ts';

export interface TransformResult {
  content: string;
  report: TransformReport;
}

/**
 * Deterministic AST transformation (docs/design-v1.md §6.1):
 *
 * A. single-function: clear the target body, emit `void <param>` for every
 *    usable parameter and `return undefined as unknown as <ReturnType>` for
 *    non-void return types.
 * B. function-with-helpers: additionally delete private runtime helpers
 *    (function declarations, bound arrow/function-expression variables) and
 *    remove value imports that became unused.
 *
 * The public signature (name, type parameters, parameters, return type, JSDoc)
 * is preserved from the original source.
 */
export function transformSource(config: ChallengeGenerationConfig, result: AnalysisResult): TransformResult {
  const { sourceFile, targetImplementation, helpers } = result.internal;
  const analysis = result.analysis;
  const removedHelpers: string[] = [];
  const removedImports: string[] = [];
  const keptImports: string[] = [];

  if (analysis.classification === 'unsupported') {
    throw new Error(`[transform] ${config.id} is unsupported: ${analysis.unsupportedReasons.join('; ')}`);
  }
  if (!targetImplementation) {
    throw new Error(`[transform] ${config.id}: target implementation not found`);
  }

  clearTargetBody(targetImplementation, config);

  for (const helper of helpers) {
    removeHelper(sourceFile, helper.name, removedHelpers);
  }

  cleanupImports(sourceFile, removedImports, keptImports);

  sourceFile.formatText({ indentSize: 2 });

  return {
    content: sourceFile.getFullText(),
    report: {
      removedHelpers,
      removedImports,
      keptImports: keptImports.sort(),
    },
  };
}

/** Clears the target function body, keeping signature + JSDoc and adding void/return placeholders. */
function clearTargetBody(target: FunctionDeclaration, config: ChallengeGenerationConfig): void {
  const body = target.getBody();
  if (!body || !body.isKind(SyntaxKind.Block)) {
    throw new Error(`[transform] ${config.id}: target function has no block body`);
  }

  const statements: string[] = [];
  for (const param of target.getParameters()) {
    for (const name of bindingIdentifiersOf(param)) {
      statements.push(`void ${name};`);
    }
  }

  const returnTypeNode = target.getReturnTypeNode();
  if (returnTypeNode) {
    const returnTypeText = returnTypeNode.getText();
    const isVoidish = returnTypeText === 'void' || returnTypeText === 'undefined';
    if (!isVoidish) {
      const override = config.overrides?.returnType;
      statements.push(`return undefined as unknown as ${override ?? returnTypeText};`);
    }
  }

  const existingStatements = body.getStatements();
  for (const statement of existingStatements) {
    statement.remove();
  }
  body.addStatements(statements);
}

/**
 * Returns the binding identifier names of a parameter:
 *  - simple/rest/default identifier: its name
 *  - destructuring pattern: every nested binding identifier
 *  - `this` parameter: nothing
 */
function bindingIdentifiersOf(param: ParameterDeclaration): string[] {
  const nameNode = param.getNameNode();
  if (!nameNode) {
    return [];
  }
  if (isThisParameter(param)) {
    return [];
  }
  const result: string[] = [];
  if (nameNode.getKind() === SyntaxKind.Identifier) {
    result.push(nameNode.getText());
  } else {
    // Destructuring pattern: every identifier inside the pattern is a binding.
    nameNode.forEachDescendant((desc) => {
      if (desc.isKind(SyntaxKind.Identifier)) {
        result.push(desc.getText());
      }
    });
  }
  return result;
}

function isThisParameter(param: ParameterDeclaration): boolean {
  const text = param.getText();
  return text === 'this' || text.startsWith('this:') || text.startsWith('this :');
}

function removeHelper(sourceFile: SourceFile, name: string, removedHelpers: string[]): void {
  let removed = false;
  for (const fn of sourceFile.getFunctions()) {
    if (fn.getName() === name) {
      fn.remove();
      removed = true;
    }
  }
  for (const variable of sourceFile.getVariableDeclarations()) {
    if (variable.getName() === name) {
      const initializer = variable.getInitializerIfKind(SyntaxKind.ArrowFunction) ?? variable.getInitializerIfKind(SyntaxKind.FunctionExpression);
      if (initializer) {
        variable.remove();
        removed = true;
      }
    }
  }
  if (!removed) {
    throw new Error(`[transform] helper "${name}" not found`);
  }
  removedHelpers.push(name);
}

/** Removes imports/bindings that are no longer referenced after transformation. */
function cleanupImports(sourceFile: SourceFile, removedImports: string[], keptImports: string[]): void {
  const usage = new Map<string, number>();

  sourceFile.forEachDescendant((desc) => {
    if (!desc.isKind(SyntaxKind.Identifier)) {
      return;
    }
    let current: import('ts-morph').Node | undefined = desc;
    while (current) {
      if (current.isKind(SyntaxKind.ImportDeclaration)) {
        return;
      }
      current = current.getParent();
    }
    usage.set(desc.getText(), (usage.get(desc.getText()) ?? 0) + 1);
  });

  for (const decl of sourceFile.getImportDeclarations()) {
    const before = decl.getText();

    // Remove unused named specifiers. Unused default/namespace imports that
    // coexist with used bindings are intentionally kept (dead but harmless);
    // removing them requires rewriting the whole declaration and is deferred.
    for (const spec of decl.getNamedImports()) {
      // The local binding is the alias when present (`{ compact as compactToolkit }`).
      const localName = spec.getAliasNode()?.getText() ?? spec.getName();
      if (!usage.has(localName)) {
        spec.remove();
      }
    }

    const hasDefault = decl.getDefaultImport() != null;
    const hasNamespace = decl.getNamespaceImport() != null;
    const namedImports = decl.getNamedImports();

    if (!hasDefault && !hasNamespace && namedImports.length === 0) {
      decl.remove();
      removedImports.push(before.trim());
    } else {
      keptImports.push(decl.getText().trim());
    }
  }
}
