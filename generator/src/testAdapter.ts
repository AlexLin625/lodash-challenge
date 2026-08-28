import { Project, SyntaxKind } from 'ts-morph';

export interface TestAdaptOptions {
  /** Relative posix path from the test file's directory to the emitted runtime shim. */
  runtimeRelativePath: string;
  /** Titles (exact or substring) of `it`/`test` cases to exclude. */
  excludedCases?: string[];
}

/**
 * Adapts an upstream Vitest test file for the internal jest-subset runtime:
 *
 *  - rewrites `import { ... } from 'vitest'` to the bundle's test-runtime module;
 *  - removes `it`/`test` cases whose title matches an excluded case.
 *
 * All other relative imports are left untouched (their modules are copied into
 * the bundle by the closure collector).
 */
export function adaptTestFile(content: string, options: TestAdaptOptions): string {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('/spec.ts', content, { overwrite: true });

  for (const decl of sourceFile.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() === 'vitest') {
      decl.setModuleSpecifier(options.runtimeRelativePath);
    }
  }

  if (options.excludedCases && options.excludedCases.length > 0) {
    excludeCases(sourceFile, options.excludedCases);
  }

  sourceFile.formatText({ indentSize: 2 });
  return sourceFile.getFullText();
}

function excludeCases(sourceFile: import('ts-morph').SourceFile, excluded: string[]): void {
  const toRemove: import('ts-morph').Statement[] = [];
  sourceFile.forEachDescendant((node) => {
    if (!node.isKind(SyntaxKind.CallExpression)) {
      return;
    }
    const call = node.asKind(SyntaxKind.CallExpression);
    const callee = call?.getExpression();
    if (!callee || !callee.isKind(SyntaxKind.Identifier)) {
      return;
    }
    const calleeName = callee.asKind(SyntaxKind.Identifier)?.getText();
    if (calleeName !== 'it' && calleeName !== 'test' && calleeName !== 'xit') {
      return;
    }
    const firstArg = call?.getArguments()[0];
    if (!firstArg || !firstArg.isKind(SyntaxKind.StringLiteral)) {
      return;
    }
    const title = firstArg.asKind(SyntaxKind.StringLiteral)?.getLiteralText();
    if (title != null && excluded.some((c) => c === title || (c.length > 3 && title.includes(c)))) {
      const statement =
        node.getFirstAncestorByKind(SyntaxKind.ExpressionStatement) ?? node.getFirstAncestorByKind(SyntaxKind.VariableStatement);
      if (statement) {
        toRemove.push(statement);
      }
    }
  });
  for (const node of toRemove) {
    node.remove();
  }
}
