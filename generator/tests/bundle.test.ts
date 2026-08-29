import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, dedupeSorted } from '../src/bundle.ts';
import type { ManifestInput } from '../src/bundle.ts';
import type { GeneratorConfigFile } from '../src/types.ts';

const upstream = { repository: 'es-toolkit', commit: 'abc123', root: 'external/es-toolkit' } satisfies GeneratorConfigFile['upstream'];

function manifestInput(overrides: Partial<ManifestInput> = {}): ManifestInput {
  return {
    config: {
      id: 'demo',
      sourcePath: 'src/array/demo.ts',
      targetExport: 'demo',
      transform: { strategy: 'single-function' },
      tests: { sourcePaths: ['src/array/demo.spec.ts'] },
      hints: { mode: 'none', maxLevel: 1 },
    },
    upstream,
    generatorVersion: '0.0.0-test',
    entryPath: 'src/array/demo.ts',
    testPaths: ['src/array/demo.spec.ts'],
    readonlyFiles: ['runtime/test-runtime.ts', 'src/_internal/helper.ts'],
    starterContent: 'export function demo(): number { return 1; }',
    adaptedTests: new Map([['src/array/demo.spec.ts', 'test("demo", () => {});']]),
    originalSourceText: 'export function demo(): number {\n  return 1;\n}\n',
    ...overrides,
  };
}

test('dedupeSorted removes duplicates and sorts deterministically', () => {
  assert.deepEqual(dedupeSorted(['b', 'a', 'b', 'a', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(dedupeSorted([]), []);
  const paths = [
    'src/object/cloneDeep.ts',
    'src/compat/object/cloneDeep.ts',
    'runtime/test-runtime.ts',
    'src/object/cloneDeep.ts',
    'src/_internal/getTag.ts',
  ];
  assert.deepEqual(dedupeSorted(paths), [
    'runtime/test-runtime.ts',
    'src/_internal/getTag.ts',
    'src/compat/object/cloneDeep.ts',
    'src/object/cloneDeep.ts',
  ]);
});

test('manifest readonlyFiles is deduplicated', () => {
  const plain = buildManifest(manifestInput());
  const withDups = buildManifest(
    manifestInput({
      readonlyFiles: [
        'runtime/test-runtime.ts',
        'src/_internal/helper.ts',
        'src/_internal/helper.ts',
        'runtime/test-runtime.ts',
      ],
    })
  );
  assert.deepEqual(withDups.readonlyFiles, plain.readonlyFiles);
  assert.deepEqual(plain.readonlyFiles, ['runtime/test-runtime.ts', 'src/_internal/helper.ts']);
});

test('manifest testPaths is deduplicated', () => {
  const manifest = buildManifest(
    manifestInput({
      testPaths: ['src/array/demo.spec.ts', 'src/array/demo.spec.ts', 'src/array/extra.spec.ts'],
    })
  );
  assert.deepEqual(manifest.upstream.testPaths, ['src/array/demo.spec.ts', 'src/array/extra.spec.ts']);
});

test('duplicate list entries do not change integrity hashes', () => {
  const plain = buildManifest(manifestInput());
  const withDups = buildManifest(
    manifestInput({
      readonlyFiles: [...plain.readonlyFiles, ...plain.readonlyFiles],
    })
  );
  assert.equal(withDups.integrity.manifestHash, plain.integrity.manifestHash);
  assert.equal(withDups.challengeVersion, plain.challengeVersion);
});
