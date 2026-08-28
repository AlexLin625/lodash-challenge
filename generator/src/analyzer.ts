import path from 'node:path';
import fs from 'node:fs';
import { Project, SyntaxKind } from 'ts-morph';
import type { Node } from 'ts-morph';
import type { ChallengeGenerationConfig, FunctionInfo, HelperRef, ImportInfo, SourceAnalysis, TypeDeclarationInfo } from './types.ts';

export interface AnalysisInternal {
  sourceFile: import('ts-morph').SourceFile;
  targetImplementation: import('ts-morph').FunctionDeclaration | null;
  helpers: HelperRef[];
}

export interface AnalysisResult {
  analysis: SourceAnalysis;
  internal: AnalysisInternal;
}

/**
 * Runs the first-level deterministic source analysis described in
 * docs/design-v1.md §6.1: locate the target export, enumerate runtime
 * functions, type declarations and imports, and classify the file as
 * 'single-function' | 'function-with-helpers' | 'unsupported'.
 */
export function analyzeSource(config: ChallengeGenerationConfig, upstreamRoot: string): AnalysisResult {
  const sourcePath = config.sourcePath;
  const absoluteSourcePath = path.join(upstreamRoot, sourcePath);
  const sourceText = fs.readFileSync(absoluteSourcePath, 'utf8');

  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile(path.posix.join('/', sourcePath), sourceText);

  const unsupportedReasons: string[] = [];

  // ---- runtime functions (function declarations + bound function variables) ----
  const runtimeFunctions: FunctionInfo[] = [];
  const exportedNamesByFunction = new Map<string, string[]>();

  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name) {
      continue;
    }
    runtimeFunctions.push({
      name,
      kind: 'function-declaration',
      isExported: false,
      exportedNames: [],
      isTarget: false,
      hasOverloadSignatures: fn.getOverloads().length > 0,
      isGenerator: fn.isGenerator(),
      isAsync: fn.isAsync(),
      isRemovableByConfig: false,
    });
    for (const exportedName of exportedNamesFor(fn, sourceFile)) {
      const list = exportedNamesByFunction.get(name) ?? [];
      list.push(exportedName);
      exportedNamesByFunction.set(name, list);
    }
  }

  for (const variable of sourceFile.getVariableDeclarations()) {
    const initializer = variable.getInitializerIfKind(SyntaxKind.ArrowFunction) ?? variable.getInitializerIfKind(SyntaxKind.FunctionExpression);
    if (!initializer) {
      continue;
    }
    const name = variable.getName();
    if (!name) {
      continue;
    }
    runtimeFunctions.push({
      name,
      kind: initializer.isKind(SyntaxKind.ArrowFunction) ? 'arrow-variable' : 'function-expression-variable',
      isExported: false,
      exportedNames: [],
      isTarget: false,
      hasOverloadSignatures: false,
      isGenerator: false,
      isAsync: initializer.isAsync(),
      isRemovableByConfig: false,
    });
    for (const exportedName of exportedNamesFor(variable, sourceFile)) {
      const list = exportedNamesByFunction.get(name) ?? [];
      list.push(exportedName);
      exportedNamesByFunction.set(name, list);
    }
  }

  for (const fn of runtimeFunctions) {
    const exportedNames = exportedNamesByFunction.get(fn.name) ?? [];
    fn.isExported = exportedNames.length > 0;
    fn.exportedNames = exportedNames;
    fn.isTarget = fn.name === config.targetExport;
  }

  // ---- type declarations ----
  const typeDeclarations: TypeDeclarationInfo[] = [];
  for (const iface of sourceFile.getInterfaces()) {
    typeDeclarations.push({ name: iface.getName(), kind: 'interface', isExported: iface.isExported() });
  }
  for (const alias of sourceFile.getTypeAliases()) {
    typeDeclarations.push({ name: alias.getName(), kind: 'type-alias', isExported: alias.isExported() });
  }
  for (const enumDecl of sourceFile.getEnums()) {
    typeDeclarations.push({ name: enumDecl.getName(), kind: 'enum', isExported: enumDecl.isExported() });
  }

  // ---- imports ----
  const imports: ImportInfo[] = [];
  for (const decl of sourceFile.getImportDeclarations()) {
    const namedImports = decl.getNamedImports().map((spec) => ({
      name: spec.getName(),
      isTypeOnly: spec.isTypeOnly(),
    }));
    imports.push({
      moduleSpecifier: decl.getModuleSpecifierValue(),
      defaultImport: decl.getDefaultImport()?.getText() ?? null,
      namespaceImport: decl.getNamespaceImport()?.getText() ?? null,
      namedImports,
      isTypeOnly: decl.isTypeOnly(),
    });
  }

  // ---- locate target export ----
  const exported = sourceFile.getExportedDeclarations();
  const targetDecls = exported.get(config.targetExport) ?? [];
  const targetFunctionDecls = targetDecls.filter((d) => isRuntimeFunctionNode(d));
  const targetVariables = targetDecls.filter((d) => isRuntimeVariableNode(d));

  if (targetDecls.length === 0) {
    unsupportedReasons.push(`targetExport "${config.targetExport}" not found in source`);
  } else if (targetFunctionDecls.length === 0 && targetVariables.length === 0) {
    unsupportedReasons.push(`targetExport "${config.targetExport}" is not a runtime function`);
  }

  let targetImplementation: import('ts-morph').FunctionDeclaration | null = null;

  if (unsupportedReasons.length === 0 && targetDecls.length > 0) {
    const targetFnInfo = runtimeFunctions.find((f) => f.name === config.targetExport);
    const directExport = targetDecls.some((d) => {
      const name = 'getName' in d ? (d as { getName(): string }).getName() : null;
      return name === config.targetExport;
    });

    if (!directExport) {
      unsupportedReasons.push(`targetExport "${config.targetExport}" is an alias/re-export, not a direct export`);
    } else if (targetFnInfo && targetFnInfo.hasOverloadSignatures) {
      unsupportedReasons.push(`targetExport "${config.targetExport}" has overload signatures`);
    } else if (targetFnInfo && targetFnInfo.isGenerator) {
      unsupportedReasons.push(`targetExport "${config.targetExport}" is a generator function`);
    } else if (targetFnInfo && targetFnInfo.isAsync) {
      unsupportedReasons.push(`targetExport "${config.targetExport}" is an async function (not yet supported in the first batch)`);
    }

    if (unsupportedReasons.length === 0) {
      const fnDecl = targetFunctionDecls.find((d) => d.isKind(SyntaxKind.FunctionDeclaration)) as
        | import('ts-morph').FunctionDeclaration
        | undefined;
      if (!fnDecl) {
        unsupportedReasons.push(`targetExport "${config.targetExport}" is not a function declaration`);
      } else {
        targetImplementation = fnDecl;
        if (fnDecl.getReturnTypeNode() == null) {
          unsupportedReasons.push(`targetExport "${config.targetExport}" has no explicit return type annotation`);
        }
        const decorated = (fnDecl.compilerNode as { decorators?: readonly unknown[] }).decorators;
        if (decorated != null && decorated.length > 0) {
          unsupportedReasons.push(`targetExport "${config.targetExport}" uses decorators`);
        }
      }
    }
  }

  // ---- other public exports ----
  const removableExports = new Set(config.transform.removableExports ?? []);
  const otherPublicRuntimeExports: string[] = [];
  for (const [exportName, decls] of exported) {
    if (exportName === config.targetExport) {
      continue;
    }
    const hasRuntimeExport = decls.some((d) => isRuntimeFunctionNode(d) || isRuntimeVariableNode(d));
    if (hasRuntimeExport && !removableExports.has(exportName)) {
      otherPublicRuntimeExports.push(exportName);
    }
  }
  if (otherPublicRuntimeExports.length > 0) {
    unsupportedReasons.push(
      `multiple public exports: ${otherPublicRuntimeExports.sort().join(', ')} (add them to transform.removableExports to allow removal)`
    );
  }

  // ---- helpers (non-target runtime functions + removable exports) ----
  const helpers: HelperRef[] = [];
  for (const fn of runtimeFunctions) {
    if (fn.name === config.targetExport) {
      continue;
    }
    if (fn.isExported && !removableExports.has(fn.name)) {
      continue;
    }
    if (isPreserved(config, fn.name)) {
      continue;
    }
    helpers.push({ name: fn.name, kind: fn.kind, isExported: fn.isExported });
  }

  const classification: SourceAnalysis['classification'] =
    unsupportedReasons.length > 0
      ? 'unsupported'
      : helpers.length > 0
        ? 'function-with-helpers'
        : 'single-function';

  const analysis: SourceAnalysis = {
    sourcePath,
    targetExport: config.targetExport,
    runtimeFunctions,
    typeDeclarations,
    imports,
    classification,
    unsupportedReasons,
  };

  if (!targetImplementation) {
    return { analysis, internal: { sourceFile, targetImplementation: null, helpers } };
  }

  return { analysis, internal: { sourceFile, targetImplementation, helpers } };
}

function isPreserved(config: ChallengeGenerationConfig, name: string): boolean {
  return (config.transform.preserveNodes ?? []).includes(name);
}

function exportedNamesFor(node: Node, sourceFile: import('ts-morph').SourceFile): string[] {
  const names: string[] = [];
  for (const [exportName, decls] of sourceFile.getExportedDeclarations()) {
    if (decls.some((d) => d === node)) {
      names.push(exportName);
    }
  }
  return names;
}

function isRuntimeFunctionNode(node: Node): boolean {
  return node.isKind(SyntaxKind.FunctionDeclaration);
}

function isRuntimeVariableNode(node: Node): boolean {
  if (!node.isKind(SyntaxKind.VariableDeclaration)) {
    return false;
  }
  const variable = node as import('ts-morph').VariableDeclaration;
  return (
    variable.getInitializerIfKind(SyntaxKind.ArrowFunction) != null ||
    variable.getInitializerIfKind(SyntaxKind.FunctionExpression) != null
  );
}
