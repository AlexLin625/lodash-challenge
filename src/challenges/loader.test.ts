import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChallengeLoadError,
  ChallengeLoader,
  buildAssetPaths,
  parseCatalog,
  parseManifest,
  parseUnsupportedReport,
} from './loader.ts';

const MANIFEST = {
  id: 'compat-array-compact',
  slug: 'compact',
  title: 'compact',
  category: 'array',
  difficulty: 'easy',
  upstream: {
    repository: 'toss/es-toolkit',
    commit: 'abc',
    sourcePath: 'src/compat/array/compact.ts',
    testPaths: ['src/compat/array/compact.spec.ts'],
  },
  generatorVersion: '0.1.0',
  challengeVersion: 'v1',
  targetExport: 'compact',
  entryFile: 'src/compat/array/compact.ts',
  editableFiles: ['src/compat/array/compact.ts'],
  readonlyFiles: ['runtime/test-runtime.ts', 'src/compat/array/compact.spec.ts'],
  description: 'Removes falsey values.',
  hints: [],
  runtime: { timeoutMs: 5000, testAdapter: 'jest-subset-v1', capabilities: ['jest-subset-v1'] },
  integrity: { configHash: 'a', starterHash: 'b', testsHash: 'c', manifestHash: 'd' },
};

test('parseManifest round-trips a valid manifest', () => {
  const manifest = parseManifest(JSON.stringify(MANIFEST));
  assert.equal(manifest.id, 'compat-array-compact');
  assert.equal(manifest.runtime.testAdapter, 'jest-subset-v1');
  assert.equal(manifest.runtime.timeoutMs, 5000);
  assert.deepEqual(manifest.editableFiles, ['src/compat/array/compact.ts']);
});

test('parseManifest rejects malformed JSON and bad shapes', () => {
  assert.throws(() => parseManifest('not json'), ChallengeLoadError);
  assert.throws(() => parseManifest(JSON.stringify({})), ChallengeLoadError);
  assert.throws(() => parseManifest(JSON.stringify({ ...MANIFEST, id: 42 })), ChallengeLoadError);
  assert.throws(() => parseManifest(JSON.stringify({ ...MANIFEST, readonlyFiles: 'nope' })), ChallengeLoadError);
});

test('parseCatalog builds the challenge list', () => {
  const catalog = {
    schemaVersion: 1,
    generatorVersion: '0.1.0',
    upstream: { repository: 'toss/es-toolkit', commit: 'c' },
    challenges: [MANIFEST],
  };
  const parsed = parseCatalog(JSON.stringify(catalog));
  assert.equal(parsed.challenges.length, 1);
  assert.equal(parsed.challenges[0].id, 'compat-array-compact');
  assert.throws(() => parseCatalog('nope'), ChallengeLoadError);
});

test('parseUnsupportedReport tolerates an empty report', () => {
  const report = { schemaVersion: 1, generatorVersion: '0.1.0', upstream: { repository: 'r', commit: 'c' }, unsupported: [] };
  const parsed = parseUnsupportedReport(JSON.stringify(report));
  assert.deepEqual(parsed.unsupported, []);
});

test('buildAssetPaths produces stable /generated URLs', () => {
  const paths = buildAssetPaths('/');
  assert.equal(paths.catalog, '/generated/catalog.json');
  assert.equal(paths.manifest('x'), '/generated/challenges/x/manifest.json');
  assert.equal(paths.file('x', 'src/a.ts'), '/generated/challenges/x/src/a.ts');
});

test('buildAssetPaths honors a base URL', () => {
  const paths = buildAssetPaths('/app/');
  assert.equal(paths.catalog, '/app/generated/catalog.json');
});

test('ChallengeLoader fetches the manifest and every bundle file', async () => {
  const requested: string[] = [];
  const loader = new ChallengeLoader({
    baseUrl: '/',
    fetcher: async (url) => {
      requested.push(url);
      if (url.endsWith('/manifest.json')) return JSON.stringify(MANIFEST);
      if (url.endsWith('/compact.ts')) return 'export function compact() {}';
      if (url.endsWith('/compact.spec.ts')) return 'describe("x", () => {});';
      if (url.endsWith('/test-runtime.ts')) return 'export {}';
      throw new Error(`unexpected request: ${url}`);
    },
  });

  const loaded = await loader.loadChallenge('compat-array-compact');
  assert.equal(loaded.manifest.id, 'compat-array-compact');
  assert.equal(loaded.files['src/compat/array/compact.ts'], 'export function compact() {}');
  assert.ok(loaded.files['runtime/test-runtime.ts']);
  assert.ok(requested.some((u) => u.endsWith('/challenges/compat-array-compact/manifest.json')));
  assert.ok(requested.some((u) => u.endsWith('/challenges/compat-array-compact/src/compat/array/compact.ts')));
});

test('ChallengeLoader.loadCatalog parses the catalog', async () => {
  const loader = new ChallengeLoader({
    baseUrl: '/',
    fetcher: async (url) => {
      assert.equal(url, '/generated/catalog.json');
      return JSON.stringify({ schemaVersion: 1, generatorVersion: '0.1.0', upstream: { repository: 'r', commit: 'c' }, challenges: [MANIFEST] });
    },
  });
  const catalog = await loader.loadCatalog();
  assert.equal(catalog.challenges.length, 1);
});

test('ChallengeLoader propagates fetch failures', async () => {
  const loader = new ChallengeLoader({
    baseUrl: '/',
    fetcher: async () => {
      throw new Error('network down');
    },
  });
  await assert.rejects(loader.loadCatalog(), /network down/);
  await assert.rejects(loader.loadChallenge('x'), /network down/);
});
