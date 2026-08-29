import path from 'node:path';
import { Project } from 'ts-morph';
import type { ChallengeGenerationConfig, ChallengeHint, ChallengeManifest, GeneratorConfigFile } from './types.ts';
import { configHashOfChallenge } from './config.ts';
import { canonicalJson, hashOfParts, sha256Hex } from './hash.ts';
import { documentationHints } from './docHints.ts';
import { CATALOG_SCHEMA_VERSION, DEFAULT_TIMEOUT_MS } from './paths.ts';

export interface ManifestInput {
  config: ChallengeGenerationConfig;
  upstream: GeneratorConfigFile['upstream'];
  generatorVersion: string;
  entryPath: string;
  testPaths: string[];
  readonlyFiles: string[];
  starterContent: string;
  adaptedTests: Map<string, string>;
  originalSourceText: string;
}

/**
 * Builds the challenge manifest and its integrity hashes. `challengeVersion`
 * is derived from upstream commit + generator version + config hash + starter
 * hash + tests hash (docs/design-v1.md §5.2).
 */
export function buildManifest(input: ManifestInput): ChallengeManifest {
  const configHash = configHashOfChallenge(input.config);
  const starterHash = sha256Hex(input.starterContent);
  const testsHash = hashOfParts(
    [...input.adaptedTests.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, c]) => `${p}\n${c}`)
  );

  const challengeVersion = hashOfParts([
    input.upstream.commit,
    input.generatorVersion,
    configHash,
    starterHash,
    testsHash,
  ]);

  const slug = path.posix.basename(input.entryPath).replace(/\.ts$/, '');
  const category = categoryFromSourcePath(input.entryPath);

  const manifest: ChallengeManifest = {
    id: input.config.id,
    slug,
    title: input.config.title ?? slug,
    category,
    difficulty: input.config.difficulty ?? 'easy',
    upstream: {
      repository: input.upstream.repository,
      commit: input.upstream.commit,
      sourcePath: input.entryPath,
      testPaths: [...input.testPaths].sort(),
    },
    generatorVersion: input.generatorVersion,
    challengeVersion,
    targetExport: input.config.targetExport,
    entryFile: input.entryPath,
    editableFiles: [input.entryPath],
    readonlyFiles: [...input.readonlyFiles].sort(),
    description: descriptionFromSource(input.originalSourceText, input.config.targetExport),
    hints: hintsForConfig(input.config, input.originalSourceText),
    runtime: {
      timeoutMs: input.config.overrides?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      testAdapter: 'jest-subset-v1',
      capabilities: ['jest-subset-v1'],
    },
    integrity: {
      configHash,
      starterHash,
      testsHash,
      manifestHash: '',
    },
  };

  manifest.integrity.manifestHash = sha256Hex(canonicalJson({ ...manifest, integrity: {} }));
  return manifest;
}

/** Builds the manifest hint list (ascending by level) for the configured hint mode. */
function hintsForConfig(config: ChallengeGenerationConfig, originalSourceText: string): ChallengeHint[] {
  if (config.hints.mode !== 'documentation') {
    return [];
  }
  return documentationHints(originalSourceText, config.targetExport, config.hints.maxLevel).sort((a, b) => a.level - b.level);
}

function categoryFromSourcePath(sourcePath: string): string {
  // src/compat/array/compact.ts -> array ; src/array/compact.ts -> array
  const segments = sourcePath.split('/');
  const compatIndex = segments.indexOf('compat');
  if (compatIndex !== -1 && segments[compatIndex + 1]) {
    return segments[compatIndex + 1];
  }
  if (segments[0] === 'src' && segments[1] && segments[1] !== 'index.ts') {
    return segments[1];
  }
  return 'misc';
}

/** Extracts the first JSDoc paragraph of the target export for the description field. */
function descriptionFromSource(sourceText: string, targetExport: string): string {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('/desc.ts', sourceText, { overwrite: true });
  const fn = sourceFile.getFunction(targetExport);
  if (!fn) {
    return '';
  }
  const jsDocs = fn.getJsDocs();
  if (jsDocs.length === 0) {
    return '';
  }
  // The JSDoc directly preceding the declaration (the last leading comment) is
  // the effective one; ignore stray commented-out blocks attached earlier.
  const jsDoc = jsDocs[jsDocs.length - 1];
  const description = jsDoc.getDescription().trim();
  if (!description) {
    return '';
  }
  const paragraph = description.split(/\n\s*\n/)[0] ?? '';
  return paragraph.trim();
}

export { CATALOG_SCHEMA_VERSION };
