import fs from 'node:fs';
import path from 'node:path';
import { analyzeSource } from './analyzer.ts';
import { transformSource } from './transform.ts';
import { collectClosure } from './closure.ts';
import { adaptTestFile } from './testAdapter.ts';
import { buildManifest } from './bundle.ts';
import { validateChallenge } from './validate.ts';
import { buildCatalog, buildUnsupportedReport, writeFile, writeJson } from './catalog.ts';
import { hashOfParts } from './hash.ts';
import {
  ASSETS_DIR,
  DEFAULT_OUTPUT_DIR,
  DEFAULT_UPSTREAM_ROOT,
  ROOT,
  TEST_RUNTIME_BUNDLE_PATH,
} from './paths.ts';
import type { BuiltChallenge, ChallengeGenerationConfig, GeneratorConfigFile, UnsupportedEntry, ValidationResult } from './types.ts';

const TEST_RUNTIME_SOURCE = fs.readFileSync(path.join(ASSETS_DIR, 'test-runtime.ts'), 'utf8');

export interface BuildOptions {
  verify?: boolean;
  write?: boolean;
  /** When false (e.g. a targeted `--only` run), skip rewriting the aggregate files. */
  writeAggregates?: boolean;
}

export interface GenerationReport {
  built: BuiltChallenge[];
  unsupported: UnsupportedEntry[];
  outputDir: string;
}

/** Builds a single challenge in-memory (does not write anything). */
export async function buildChallenge(
  config: ChallengeGenerationConfig,
  upstream: GeneratorConfigFile['upstream'],
  generatorVersion: string,
  options: BuildOptions = {}
): Promise<BuiltChallenge> {
  const upstreamRoot = path.resolve(ROOT, upstream.root);
  const sourcePath = config.sourcePath;
  const originalSourceText = fs.readFileSync(path.join(upstreamRoot, sourcePath), 'utf8');

  const analysisResult = analyzeSource(config, upstreamRoot);

  if (analysisResult.analysis.classification === 'unsupported') {
    return {
      id: config.id,
      analysis: analysisResult.analysis,
      classification: 'unsupported',
      unsupportedReasons: analysisResult.analysis.unsupportedReasons,
      transformReport: { removedHelpers: [], removedImports: [], keptImports: [] },
      entryContent: '',
      files: new Map(),
      testPaths: config.tests.sourcePaths,
      runtimePath: TEST_RUNTIME_BUNDLE_PATH,
      manifest: null as never,
      validation: null,
      contentHash: '',
    };
  }

  const { content: starterText, report: transformReport } = transformSource(config, analysisResult);

  // Adapt upstream Vitest tests to the internal runtime.
  const adaptedTests = new Map<string, string>();
  for (const testPath of config.tests.sourcePaths) {
    const raw = fs.readFileSync(path.join(upstreamRoot, testPath), 'utf8');
    const runtimeRelativePath = path.posix.relative(path.posix.dirname(testPath), TEST_RUNTIME_BUNDLE_PATH);
    adaptedTests.set(testPath, adaptTestFile(raw, { runtimeRelativePath, excludedCases: config.tests.excludedCases }));
  }

  // Closure of the tests, with the transformed starter seeded in as the source
  // file. The bundle only ships what the starter + tests reference.
  const bundleClosure = collectClosure(upstreamRoot, config.tests.sourcePaths, new Map([[sourcePath, starterText]]));

  const bundleFiles = new Map<string, string>();
  for (const [filePath, content] of bundleClosure) {
    bundleFiles.set(filePath, content);
  }
  for (const [testPath, content] of adaptedTests) {
    bundleFiles.set(testPath, content);
  }
  bundleFiles.set(sourcePath, starterText);
  bundleFiles.set(TEST_RUNTIME_BUNDLE_PATH, TEST_RUNTIME_SOURCE);

  // Original run: closure of tests + original source (the original source's own
  // dependencies are required for the "original passes" validation run).
  const originalClosure = collectClosure(upstreamRoot, [...config.tests.sourcePaths, sourcePath]);
  const originalRunFiles = new Map(originalClosure);
  for (const [testPath, content] of adaptedTests) {
    originalRunFiles.set(testPath, content);
  }
  originalRunFiles.set(TEST_RUNTIME_BUNDLE_PATH, TEST_RUNTIME_SOURCE);

  let validation: ValidationResult | null = null;
  if (options.verify !== false) {
    validation = await validateChallenge({
      config,
      entryPath: sourcePath,
      testPaths: config.tests.sourcePaths,
      runtimePath: TEST_RUNTIME_BUNDLE_PATH,
      bundleFiles,
      originalFiles: originalRunFiles,
      originalSourceText,
      starterText,
      removedHelpers: transformReport.removedHelpers,
    });
  }

  const readonlyFiles = [...bundleFiles.keys()].filter((p) => p !== sourcePath);

  const manifest = buildManifest({
    config,
    upstream,
    generatorVersion,
    entryPath: sourcePath,
    testPaths: config.tests.sourcePaths,
    readonlyFiles,
    starterContent: starterText,
    adaptedTests,
    originalSourceText,
  });

  const contentHash = hashOfParts(
    [...bundleFiles.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, c]) => `${p}\n${c}`)
  );

  return {
    id: config.id,
    analysis: analysisResult.analysis,
    classification: analysisResult.analysis.classification,
    unsupportedReasons: [],
    transformReport,
    entryContent: starterText,
    files: bundleFiles,
    testPaths: config.tests.sourcePaths,
    runtimePath: TEST_RUNTIME_BUNDLE_PATH,
    manifest,
    validation,
    contentHash,
  };
}

/** Builds every configured challenge and writes the bundle/catalog to disk. */
export async function generateAll(
  configFile: GeneratorConfigFile,
  options: BuildOptions & { outputDir?: string } = {}
): Promise<GenerationReport> {
  const outputDir = path.resolve(ROOT, options.outputDir ?? DEFAULT_OUTPUT_DIR);
  const challengesDir = path.join(outputDir, 'challenges');
  const built: BuiltChallenge[] = [];
  const unsupported: UnsupportedEntry[] = [];

  for (const config of configFile.challenges) {
    const challenge = await buildChallenge(config, configFile.upstream, configFile.generatorVersion, options);
    built.push(challenge);
    if (challenge.classification === 'unsupported') {
      unsupported.push({
        id: challenge.id,
        sourcePath: config.sourcePath,
        targetExport: config.targetExport,
        reasons: challenge.unsupportedReasons,
      });
      continue;
    }
    if (options.write !== false) {
      const challengeDir = path.join(challengesDir, config.id);
      fs.rmSync(challengeDir, { recursive: true, force: true });
      writeJson(path.join(challengeDir, 'manifest.json'), challenge.manifest);
      for (const [filePath, content] of challenge.files) {
        writeFile(path.join(challengeDir, filePath), content);
      }
    }
  }

  const supported = built.filter((b) => b.classification !== 'unsupported');

  if (options.write !== false && options.writeAggregates !== false) {
    writeJson(
      path.join(outputDir, 'catalog.json'),
      buildCatalog(configFile.generatorVersion, configFile.upstream, supported.map((b) => b.manifest))
    );
    writeJson(
      path.join(outputDir, 'unsupported.json'),
      buildUnsupportedReport(configFile.generatorVersion, configFile.upstream, unsupported)
    );
    writeFile(path.join(outputDir, 'determinism.txt'), determinismSummary(supported) + '\n');
  }

  return { built, unsupported, outputDir };
}

/** A single digest over all generated manifests and file contents, for reproducibility checks. */
export function determinismSummary(challenges: BuiltChallenge[]): string {
  const parts: string[] = [];
  for (const challenge of [...challenges].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(`# ${challenge.id}`);
    parts.push(`challengeVersion=${challenge.manifest.challengeVersion}`);
    parts.push(`contentHash=${challenge.contentHash}`);
  }
  return parts.join('\n');
}

export { DEFAULT_UPSTREAM_ROOT };
