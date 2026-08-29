import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { Project, SyntaxKind } from 'ts-morph';
import { GENERATOR_DIR } from './paths.ts';
import { findUnusedImportBindings } from './unusedImports.ts';
import type { ChallengeGenerationConfig, ValidationResult } from './types.ts';
import { runTests } from './testRunner.ts';

export interface ValidateInput {
  config: ChallengeGenerationConfig;
  entryPath: string;
  testPaths: string[];
  runtimePath: string;
  /** Bundle files (starter + adapted tests + runtime shim + test helper closure). */
  bundleFiles: Map<string, string>;
  /** Files with the ORIGINAL upstream source (for "original passes" check). */
  originalFiles: Map<string, string>;
  originalSourceText: string;
  starterText: string;
  removedHelpers: string[];
}

export async function validateChallenge(input: ValidateInput): Promise<ValidationResult> {
  const checks: ValidationResult['checks'] = [];
  const typecheckErrors = typecheckFiles(input.bundleFiles);

  const starterErrors = typecheckErrors.filter((e) => e.includes(input.entryPath));
  checks.push({
    name: 'starter compiles',
    passed: starterErrors.length === 0,
    detail: starterErrors.slice(0, 10).join('\n') || undefined,
  });

  const allFileErrors = typecheckErrors.filter((e) => !e.includes('.d.ts'));
  checks.push({
    name: 'bundle files compile',
    passed: allFileErrors.length === 0,
    detail: allFileErrors.slice(0, 10).join('\n') || undefined,
  });

  const originalSummary = await runTests(input.originalFiles, input.testPaths, input.runtimePath);
  checks.push({
    name: 'original upstream implementation passes all selected tests',
    passed: originalSummary.failed === 0,
    detail:
      originalSummary.failed === 0
        ? `${originalSummary.passed}/${originalSummary.total} passed`
        : `failures: ${originalSummary.failures.slice(0, 5).map((f) => f.name).join(', ')}`,
  });

  const stubSummary = await runTests(input.bundleFiles, input.testPaths, input.runtimePath);
  checks.push({
    name: 'starter stub fails at least one selected test (not an empty challenge)',
    passed: stubSummary.failed > 0,
    detail: stubSummary.failed > 0 ? `${stubSummary.failed} failing test(s)` : `all ${stubSummary.total} tests passed against the stub`,
  });

  const signatureMatch = signaturePreserved(input.originalSourceText, input.starterText, input.config.targetExport);
  checks.push({ name: 'public signature preserved', passed: signatureMatch, detail: signatureMatch ? undefined : 'signature changed' });

  const implLeak = originalImplementationLeaked(input.originalSourceText, input.starterText);
  checks.push({ name: 'original implementation not present in starter', passed: !implLeak, detail: implLeak ? 'original body statements found in starter' : undefined });

  const helperRefs = unresolvedHelperRefs(input.starterText, input.removedHelpers);
  checks.push({ name: 'no references to removed helpers', passed: helperRefs.length === 0, detail: helperRefs.length ? `found: ${helperRefs.join(', ')}` : undefined });

  const unusedImports = findUnusedImportBindings(input.starterText);
  checks.push({
    name: 'starter has no unused imports',
    passed: unusedImports.length === 0,
    detail: unusedImports.length ? `unused: ${unusedImports.map((u) => `${u.binding} (${u.moduleSpecifier})`).join(', ')}` : undefined,
  });

  const internalImports = internalImportSpecifiers(input.starterText);
  checks.push({
    name: 'starter imports no _internal modules (type-only imports must be inlined)',
    passed: internalImports.length === 0,
    detail: internalImports.length ? `found: ${internalImports.join(', ')}` : undefined,
  });

  const nodeApis = nodeApiUsage(input.testPaths.map((p) => input.bundleFiles.get(p) ?? ''));
  checks.push({ name: 'selected tests avoid Node-only APIs', passed: nodeApis.length === 0, detail: nodeApis.length ? `found: ${nodeApis.join(', ')}` : undefined });

  const ok = checks.every((c) => c.passed);
  return {
    ok,
    checks,
    typecheckErrors,
    originalSummary,
    stubSummary,
  };
}

/** Typechecks every file in the map using a scratch directory on disk. */
export function typecheckFiles(files: Map<string, string>): string[] {
  fs.mkdirSync(path.join(GENERATOR_DIR, '.tmp'), { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(GENERATOR_DIR, '.tmp', 'verify-'));
  const rootNames: string[] = [];
  try {
    for (const [relPath, content] of files) {
      const abs = path.join(tmpRoot, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      rootNames.push(abs);
    }

    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      moduleDetection: ts.ModuleDetectionKind.Force,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    };

    const program = ts.createProgram(rootNames, options);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    return diagnostics
      .filter((d) => d.file != null)
      .map((d) => {
        const fileName = d.file && d.file.fileName.startsWith(tmpRoot) ? d.file.fileName.slice(tmpRoot.length + 1) : (d.file?.fileName ?? '');
        const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
        const loc = pos ? `${fileName}:${pos.line + 1}:${pos.character + 1}` : fileName;
        const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
        return `${loc} - TS${d.code}: ${message}`;
      });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

/** Compares the public signature of the target export before/after transformation. */
function signaturePreserved(originalText: string, starterText: string, targetExport: string): boolean {
  const originalDescriptor = signatureDescriptor(originalText, targetExport);
  const starterDescriptor = signatureDescriptor(starterText, targetExport);
  return originalDescriptor !== null && originalDescriptor === starterDescriptor;
}

function signatureDescriptor(sourceText: string, targetExport: string): string | null {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('/sig.ts', sourceText, { overwrite: true });
  const fn = sourceFile.getFunction(targetExport);
  if (!fn) {
    return null;
  }
  const parts: string[] = [
    fn.getName() ?? '',
    fn.getTypeParameters().map((tp) => tp.getText()).join(','),
    fn.getParameters().map((p) => p.getText()).join(','),
    fn.getReturnTypeNode()?.getText() ?? '',
  ];
  return parts.join('|');
}

/** Heuristically detects whether original body statements survive into the starter. */
function originalImplementationLeaked(originalText: string, starterText: string): boolean {
  const project = new Project({ useInMemoryFileSystem: true });
  const originalSf = project.createSourceFile('/orig.ts', originalText, { overwrite: true });
  const statements: string[] = [];
  for (const fn of originalSf.getFunctions()) {
    const body = fn.getBody();
    if (body && body.isKind(SyntaxKind.Block)) {
      for (const statement of body.getStatements()) {
        statements.push(statement.getText());
      }
    }
  }
  for (const stmt of statements) {
    if (stmt.length > 0 && starterText.includes(stmt)) {
      return true;
    }
  }
  return false;
}

/** Module specifiers in the starter that point into a `_internal/` directory. */
export function internalImportSpecifiers(starterText: string): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('/validate-internal.ts', starterText, { overwrite: true });
  const found: string[] = [];
  for (const decl of sourceFile.getImportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (/(^|[\\/])_internal[\\/]/.test(specifier)) {
      found.push(specifier);
    }
  }
  return found;
}

function unresolvedHelperRefs(starterText: string, removedHelpers: string[]): string[] {
  const found: string[] = [];
  for (const helper of removedHelpers) {
    if (new RegExp(`\\b${escapeRegExp(helper)}\\b`).test(starterText)) {
      found.push(helper);
    }
  }
  return found;
}

function nodeApiUsage(testContents: string[]): string[] {
  const found = new Set<string>();
  const patterns: Array<[RegExp, string]> = [
    [/from\s+['"]node:/g, 'node: imports'],
    [/\bprocess\./g, 'process.*'],
    [/\brequire\s*\(/g, 'require('],
    [/__dirname|__filename/g, '__dirname/__filename'],
  ];
  for (const content of testContents) {
    for (const [re, label] of patterns) {
      if (re.test(content)) {
        found.add(label);
      }
    }
  }
  return [...found];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
