// Domain types for the challenge catalog and bundles.
//
// These mirror the generated asset schema produced by the challenge generator
// (see generator/src/types.ts and docs/design-v1.md §5.2). They are declared
// here, app-side, so the application does not depend on the generator's node
// module graph.

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

export interface UnsupportedReport {
  schemaVersion: number;
  generatorVersion: string;
  upstream: { repository: string; commit: string };
  unsupported: Array<{ id: string; sourcePath: string; targetExport: string; reasons: string[] }>;
}

/**
 * A challenge's files keyed by bundle-relative path (no leading slash),
 * e.g. `src/compat/array/compact.ts`.
 */
export type ChallengeFileMap = Record<string, string>;

export interface LoadedChallenge {
  manifest: ChallengeManifest;
  files: ChallengeFileMap;
}

export interface ChallengeAssetPaths {
  catalog: string;
  manifest: (id: string) => string;
  file: (id: string, filePath: string) => string;
}
