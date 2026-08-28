// Challenge loader: fetches the generated catalog, per-challenge manifests and
// bundle files from the static `/generated` assets.
//
// The loader is dependency-free with respect to the browser: the network
// access is injected (`fetcher`), so the same code runs in Node tests with a
// fake fetcher and in the browser with `fetch`.

import type {
  ChallengeAssetPaths,
  ChallengeCatalog,
  ChallengeFileMap,
  ChallengeManifest,
  LoadedChallenge,
  UnsupportedReport,
} from './types.ts';
import { verifyChallengeIntegrity } from './integrity.ts';

export type Fetcher = (url: string, signal?: AbortSignal) => Promise<string>;

export interface ChallengeLoaderOptions {
  fetcher?: Fetcher;
  baseUrl?: string;
  /** Recompute and check the manifest's integrity hashes after loading. */
  verifyIntegrity?: boolean;
}

const DEFAULT_GENERATED_PREFIX = 'generated';

function baseUrlOf(options: ChallengeLoaderOptions): string {
  if (options.baseUrl !== undefined) {
    return options.baseUrl;
  }
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  return env?.BASE_URL ?? '/';
}

export function buildAssetPaths(baseUrl: string, prefix = DEFAULT_GENERATED_PREFIX): ChallengeAssetPaths {
  const root = joinUrl(baseUrl, prefix);
  return {
    catalog: joinUrl(root, 'catalog.json'),
    manifest: (id) => joinUrl(root, 'challenges', id, 'manifest.json'),
    file: (id, filePath) => joinUrl(root, 'challenges', id, filePath),
  };
}

function joinUrl(...segments: string[]): string {
  return segments
    .filter((s) => s.length > 0)
    .map((s, i) => {
      const trimmed = s.replace(/\/+$/, '');
      if (i === 0) {
        return trimmed;
      }
      return trimmed.replace(/^\/+/, '');
    })
    .join('/');
}

function defaultFetcher(url: string, signal?: AbortSignal): Promise<string> {
  return fetch(url, { signal }).then((res) => {
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }
    return res.text();
  });
}

export class ChallengeLoader {
  private readonly fetcher: Fetcher;
  private readonly baseUrl: string;
  private readonly paths: ChallengeAssetPaths;
  private readonly verifyIntegrity: boolean;

  constructor(options: ChallengeLoaderOptions = {}) {
    this.fetcher = options.fetcher ?? defaultFetcher;
    this.baseUrl = baseUrlOf(options);
    this.paths = buildAssetPaths(this.baseUrl);
    this.verifyIntegrity = options.verifyIntegrity ?? false;
  }

  async loadCatalog(signal?: AbortSignal): Promise<ChallengeCatalog> {
    const text = await this.fetcher(this.paths.catalog, signal);
    return parseCatalog(text);
  }

  async loadUnsupportedReport(signal?: AbortSignal): Promise<UnsupportedReport> {
    const text = await this.fetcher(joinUrl(this.paths.catalog.replace(/\/catalog\.json$/, ''), 'unsupported.json'), signal);
    return parseUnsupportedReport(text);
  }

  async loadChallenge(id: string, signal?: AbortSignal): Promise<LoadedChallenge> {
    const manifestUrl = this.paths.manifest(id);
    const manifestText = await this.fetcher(manifestUrl, signal);
    const manifest = parseManifest(manifestText);

    const filePaths = [...manifest.readonlyFiles, ...manifest.editableFiles];
    const unique = [...new Set(filePaths)];
    const files: ChallengeFileMap = {};
    for (const filePath of unique) {
      files[filePath] = await this.fetcher(this.paths.file(id, filePath), signal);
    }

    if (this.verifyIntegrity) {
      const result = await verifyChallengeIntegrity(
        { ...manifest, testPaths: manifest.upstream.testPaths },
        files,
        manifestText
      );
      if (!result.ok) {
        throw new ChallengeIntegrityError(manifest.id, result.checks);
      }
    }
    return { manifest, files };
  }
}

export class ChallengeLoadError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ChallengeLoadError';
    this.cause = cause;
  }
}

export class ChallengeIntegrityError extends Error {
  readonly checks: Array<{ name: string; passed: boolean; detail?: string }>;
  constructor(id: string, checks: Array<{ name: string; passed: boolean; detail?: string }>) {
    super(`Challenge integrity check failed for ${id}`);
    this.name = 'ChallengeIntegrityError';
    this.checks = checks;
  }
}

// ---------------------------------------------------------------------------
// Pure validation helpers (testable without a browser)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ChallengeLoadError(`Invalid ${label}: expected an object`);
  }
  return value;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ChallengeLoadError(`Invalid ${label}: expected a non-empty string`);
  }
  return value;
}

function expectStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new ChallengeLoadError(`Invalid ${label}: expected a string array`);
  }
  return value;
}

export function parseCatalog(text: string): ChallengeCatalog {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ChallengeLoadError('Invalid catalog JSON', err);
  }
  const root = expectRecord(parsed, 'catalog');
  const challenges = root.challenges;
  if (!Array.isArray(challenges)) {
    throw new ChallengeLoadError('Invalid catalog: missing "challenges" array');
  }
  return {
    schemaVersion: typeof root.schemaVersion === 'number' ? root.schemaVersion : 1,
    generatorVersion: expectString(root.generatorVersion, 'catalog.generatorVersion'),
    upstream: expectUpstream(root.upstream),
    challenges: challenges.map(validateManifest),
  };
}

export function parseUnsupportedReport(text: string): UnsupportedReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ChallengeLoadError('Invalid unsupported report JSON', err);
  }
  const root = expectRecord(parsed, 'unsupported report');
  return {
    schemaVersion: typeof root.schemaVersion === 'number' ? root.schemaVersion : 1,
    generatorVersion: expectString(root.generatorVersion, 'unsupported.generatorVersion'),
    upstream: expectUpstream(root.upstream),
    unsupported: Array.isArray(root.unsupported) ? root.unsupported.map((entry) => {
      const e = expectRecord(entry, 'unsupported entry');
      return {
        id: expectString(e.id, 'unsupported.id'),
        sourcePath: expectString(e.sourcePath, 'unsupported.sourcePath'),
        targetExport: expectString(e.targetExport, 'unsupported.targetExport'),
        reasons: expectStringArray(e.reasons, 'unsupported.reasons'),
      };
    }) : [],
  };
}

export function parseManifest(text: string): ChallengeManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ChallengeLoadError('Invalid manifest JSON', err);
  }
  return validateManifest(parsed);
}

export function validateManifest(value: unknown): ChallengeManifest {
  const root = expectRecord(value, 'manifest');
  const runtime = expectRecord(root.runtime, 'manifest.runtime');
  const integrity = expectRecord(root.integrity, 'manifest.integrity');

  return {
    id: expectString(root.id, 'manifest.id'),
    slug: expectString(root.slug, 'manifest.slug'),
    title: expectString(root.title, 'manifest.title'),
    category: expectString(root.category, 'manifest.category'),
    difficulty: root.difficulty === 'medium' || root.difficulty === 'hard' ? root.difficulty : 'easy',
    upstream: expectManifestUpstream(root.upstream),
    generatorVersion: expectString(root.generatorVersion, 'manifest.generatorVersion'),
    challengeVersion: expectString(root.challengeVersion, 'manifest.challengeVersion'),
    targetExport: expectString(root.targetExport, 'manifest.targetExport'),
    entryFile: expectString(root.entryFile, 'manifest.entryFile'),
    editableFiles: expectStringArray(root.editableFiles, 'manifest.editableFiles'),
    readonlyFiles: expectStringArray(root.readonlyFiles, 'manifest.readonlyFiles'),
    description: typeof root.description === 'string' ? root.description : '',
    hints: Array.isArray(root.hints) ? root.hints.map(parseHint) : [],
    runtime: {
      timeoutMs: typeof runtime.timeoutMs === 'number' ? runtime.timeoutMs : 5000,
      testAdapter: runtime.testAdapter === 'jest-subset-v1' ? 'jest-subset-v1' : 'jest-subset-v1',
      capabilities: expectStringArray(runtime.capabilities, 'manifest.runtime.capabilities'),
    },
    integrity: {
      configHash: expectString(integrity.configHash, 'manifest.integrity.configHash'),
      starterHash: expectString(integrity.starterHash, 'manifest.integrity.starterHash'),
      testsHash: expectString(integrity.testsHash, 'manifest.integrity.testsHash'),
      manifestHash: expectString(integrity.manifestHash, 'manifest.integrity.manifestHash'),
    },
  };
}

function parseHint(value: unknown): ChallengeManifest['hints'][number] {
  const hint = expectRecord(value, 'hint');
  const level = hint.level;
  return {
    level: level === 2 || level === 3 ? level : 1,
    text: expectString(hint.text, 'hint.text'),
    source: hint.source === 'helper-analysis' || hint.source === 'manual' ? hint.source : 'documentation',
  };
}

function expectUpstream(value: unknown): { repository: string; commit: string } {
  const upstream = expectRecord(value, 'upstream');
  return {
    repository: expectString(upstream.repository, 'upstream.repository'),
    commit: expectString(upstream.commit, 'upstream.commit'),
  };
}

function expectManifestUpstream(value: unknown): { repository: string; commit: string; sourcePath: string; testPaths: string[] } {
  const upstream = expectRecord(value, 'manifest.upstream');
  return {
    repository: expectString(upstream.repository, 'manifest.upstream.repository'),
    commit: expectString(upstream.commit, 'manifest.upstream.commit'),
    sourcePath: expectString(upstream.sourcePath, 'manifest.upstream.sourcePath'),
    testPaths: expectStringArray(upstream.testPaths, 'manifest.upstream.testPaths'),
  };
}
