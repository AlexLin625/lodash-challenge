import { Project, SyntaxKind } from 'ts-morph';
import type { Identifier, Node, SourceFile } from 'ts-morph';
import type * as morph from 'ts-morph';

export interface UnusedImportBinding {
  /** Local binding name (the alias when the import renames the binding). */
  binding: string;
  kind: 'default' | 'namespace' | 'named';
  moduleSpecifier: string;
  /** Full text of the import declaration the binding belongs to. */
  declarationText: string;
}

/**
 * Finds import bindings that are never referenced outside their own import
 * declaration (docs/design-v1.md §7 rule 6: no invalid value imports produced
 * by the transformation).
 *
 * A binding counts as referenced when its local name appears as an
 * expression or type-position identifier anywhere else in the file (parameter
 * defaults, decorators, type annotations and signatures all count). Text that
 * only occurs inside JSDoc comments does not count, and neither do syntactic
 * positions that merely reuse the same word (names after a dot,
 * non-computed object keys, qualified-type right-hand sides, enum member
 * names and labels).
 *
 * This is intentionally conservative: any local declaration shadowing the
 * binding name keeps the import (it is reported as referenced).
 */
export function findUnusedImportBindings(sourceText: string): UnusedImportBinding[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('/unused-imports.ts', sourceText, { overwrite: true });
  return findUnusedImportBindingsInSourceFile(sourceFile);
}

/** Same analysis as {@link findUnusedImportBindings} for an already-parsed file. */
export function findUnusedImportBindingsInSourceFile(sourceFile: SourceFile): UnusedImportBinding[] {
  const referenced = referencedIdentifierNames(sourceFile);
  const unused: UnusedImportBinding[] = [];

  for (const decl of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = decl.getModuleSpecifierValue();
    const declarationText = decl.getText().trim();

    const defaultImport = decl.getDefaultImport();
    if (defaultImport && !referenced.has(defaultImport.getText())) {
      unused.push({ binding: defaultImport.getText(), kind: 'default', moduleSpecifier, declarationText });
    }

    const namespaceImport = decl.getNamespaceImport();
    if (namespaceImport && !referenced.has(namespaceImport.getText())) {
      unused.push({ binding: namespaceImport.getText(), kind: 'namespace', moduleSpecifier, declarationText });
    }

    for (const spec of decl.getNamedImports()) {
      const localName = spec.getAliasNode()?.getText() ?? spec.getName();
      if (!referenced.has(localName)) {
        unused.push({ binding: localName, kind: 'named', moduleSpecifier, declarationText });
      }
    }
  }

  return unused;
}

/** Set of identifier texts occurring outside import declarations in real reference positions. */
function referencedIdentifierNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  sourceFile.forEachDescendant((node) => {
    if (!node.isKind(SyntaxKind.Identifier)) {
      return;
    }
    if (isInsideImportOrJsDoc(node, sourceFile) || isNonReferencePosition(node)) {
      return;
    }
    names.add(node.getText());
  });
  return names;
}

function isInsideImportOrJsDoc(node: Identifier, sourceFile: SourceFile): boolean {
  let current: Node | undefined = node.getParent();
  while (current && current !== sourceFile) {
    const kindName = current.getKindName();
    if (kindName === 'ImportDeclaration' || kindName === 'ImportEqualsDeclaration') {
      return true;
    }
    if (kindName.startsWith('JSDoc')) {
      return true;
    }
    current = current.getParent();
  }
  return false;
}

function nameNodeIs(node: Node, child: Node): boolean {
  const getter = (node as { getNameNode?: () => Node }).getNameNode;
  return typeof getter === 'function' && getter.call(node) === child;
}

/** True when the identifier is a member/property key rather than a reference. */
function isNonReferencePosition(node: Identifier): boolean {
  const parent = node.getParent();
  if (!parent) {
    return false;
  }
  switch (parent.getKind()) {
    case SyntaxKind.PropertyAccessExpression:
      return (parent as morph.PropertyAccessExpression).getNameNode() === node;
    case SyntaxKind.QualifiedName:
      return (parent as morph.QualifiedName).getRight() === node;
    case SyntaxKind.PropertyAssignment:
    case SyntaxKind.PropertySignature:
    case SyntaxKind.PropertyDeclaration:
    case SyntaxKind.MethodDeclaration:
    case SyntaxKind.MethodSignature:
    case SyntaxKind.EnumMember:
      return nameNodeIs(parent, node);
    case SyntaxKind.LabeledStatement:
      return (parent as morph.LabeledStatement).getLabel() === node;
    case SyntaxKind.BreakStatement:
    case SyntaxKind.ContinueStatement:
      return (parent as unknown as { label?: Node }).label === node;
    default:
      return false;
  }
}
