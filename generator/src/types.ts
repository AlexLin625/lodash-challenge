// Shared type definitions for the challenge generator.
//
// These mirror the shapes in docs/design-v1.md §5 (generation config and
// manifest) and §6.1 (source analysis), plus the internal working types used
// by the pipeline.

import type { TypeInlineWarning } from './typeInline.ts';

export type Classification = 'single-function' | 'function-with-helpers' | 'unsupported';

export interface UpstreamConfig {
  repository: string;
  commit: string;
  root: string;
}

export interface TransformConfig {
  strategy: 'single-function' | 'remove-helpers';
  removableExports?: string[];
  preserveNodes?: string[];
}

export interface TestsConfig {
  sourcePaths: string[];
  excludedCases?: string[];
}

export interface HintsConfig {
  mode: 'none' | 'documentation' | 'llm-assisted';
  maxLevel: 1 | 2 | 3;
}

export interface ChallengeOverrides {
  returnType?: string;
  timeoutMs?: number;
  unsupportedReason?: string;
}

export interface ChallengeGenerationConfig {
  id: string;
  sourcePath: string;
  targetExport: string;
  title?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  transform: TransformConfig;
  tests: TestsConfig;
  hints: HintsConfig;
  overrides?: ChallengeOverrides;
}

export interface GeneratorConfigFile {
  upstream: UpstreamConfig;
  generatorVersion: string;
  challenges: ChallengeGenerationConfig[];
}

export interface FunctionInfo {
  name: string;
  kind: 'function-declaration' | 'arrow-variable' | 'function-expression-variable';
  isExported: boolean;
  exportedNames: string[];
  isTarget: boolean;
  hasOverloadSignatures: boolean;
  isGenerator: boolean;
  isAsync: boolean;
  isRemovableByConfig: boolean;
}

export interface ImportInfo {
  moduleSpecifier: string;
  defaultImport: string | null;
  namespaceImport: string | null;
  namedImports: Array<{ name: string; isTypeOnly: boolean }>;
  isTypeOnly: boolean;
}

export interface TypeDeclarationInfo {
  name: string;
  kind: 'interface' | 'type-alias' | 'enum' | 'class';
  isExported: boolean;
}

export interface SourceAnalysis {
  sourcePath: string;
  targetExport: string;
  runtimeFunctions: FunctionInfo[];
  typeDeclarations: TypeDeclarationInfo[];
  imports: ImportInfo[];
  classification: Classification;
  unsupportedReasons: string[];
}

export type HelperKind = 'function-declaration' | 'arrow-variable' | 'function-expression-variable';

export interface HelperRef {
  name: string;
  kind: HelperKind;
  isExported: boolean;
}

export interface ChallengeHint {
  level: 1 | 2 | 3;
  text: string;
  source: 'documentation' | 'helper-analysis' | 'manual';
}

export interface ChallengeManifest {
  id: string;
  slug: string;
  title: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';

  upstream: {
    repository: string;
    commit: string;
    sourcePath: string;
    testPaths: string[];
  };

  generatorVersion: string;
  challengeVersion: string;
  targetExport: string;

  entryFile: string;
  editableFiles: string[];
  readonlyFiles: string[];

  description: string;
  hints: ChallengeHint[];

  runtime: {
    timeoutMs: number;
    testAdapter: 'jest-subset-v1';
    capabilities: string[];
  };

  integrity: {
    configHash: string;
    starterHash: string;
    testsHash: string;
    manifestHash: string;
  };
}

export interface ChallengeCatalog {
  schemaVersion: number;
  generatorVersion: string;
  upstream: { repository: string; commit: string };
  challenges: ChallengeManifest[];
}

export interface UnsupportedEntry {
  id: string;
  sourcePath: string;
  targetExport: string;
  reasons: string[];
}

export interface UnsupportedReport {
  schemaVersion: number;
  generatorVersion: string;
  upstream: { repository: string; commit: string };
  unsupported: UnsupportedEntry[];
}

export interface TransformReport {
  removedHelpers: string[];
  removedImports: string[];
  keptImports: string[];
  /** Type names inlined into the starter (topological injection order). */
  inlinedTypes: string[];
  /** Type-only imports that could not be inlined and were preserved. */
  typeInlineWarnings: TypeInlineWarning[];
}

export interface TestCaseResult {
  suite: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  error?: string;
}

export interface TestRunSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: Array<{ name: string; error: string }>;
}

export interface ValidationResult {
  ok: boolean;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  typecheckErrors: string[];
  originalSummary: TestRunSummary | null;
  stubSummary: TestRunSummary | null;
}

export interface BuiltChallenge {
  id: string;
  analysis: SourceAnalysis;
  classification: Classification;
  unsupportedReasons: string[];
  transformReport: TransformReport;
  entryContent: string;
  files: Map<string, string>;
  testPaths: string[];
  runtimePath: string;
  manifest: ChallengeManifest;
  validation: ValidationResult | null;
  contentHash: string;
}
