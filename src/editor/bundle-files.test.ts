import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTestBundlePath, partitionBundleFiles } from './bundle-files.ts';

test('isTestBundlePath hides spec files and runtime/ harness paths', () => {
  const cases: Array<[string, boolean]> = [
    ['src/compat/array/chunk.spec.ts', true],
    ['chunk.spec.ts', true],
    ['runtime/test-runtime.ts', true],
    ['runtime/bootstrap.js', true],
    ['src/compat/array/chunk.ts', false],
    ['src/compat/_internal/args.ts', false],
    ['runtime-extra/helper.ts', false],
    ['src/deep/spec/chunk.spec.tsx', false],
    ['src/notes.spec.txt', false],
    ['', false],
  ];
  for (const [path, expected] of cases) {
    assert.equal(isTestBundlePath(path), expected, `isTestBundlePath(${JSON.stringify(path)})`);
  }
});

test('partitionBundleFiles splits a bundle without losing or duplicating files', () => {
  const bundle = {
    'src/compat/array/chunk.ts': 'export function chunk() {}',
    'src/compat/array/chunk.spec.ts': "describe('chunk', ...)",
    'runtime/test-runtime.ts': 'export const it = ...',
    'src/compat/_internal/args.ts': 'export const args = ...',
  };
  const { editorFiles, testFiles } = partitionBundleFiles(bundle);

  assert.deepEqual(Object.keys(testFiles).sort(), ['runtime/test-runtime.ts', 'src/compat/array/chunk.spec.ts']);
  assert.deepEqual(Object.keys(editorFiles).sort(), [
    'src/compat/_internal/args.ts',
    'src/compat/array/chunk.ts',
  ]);
  assert.deepEqual({ ...testFiles, ...editorFiles }, bundle);
});

test('run file composition keeps hidden originals and lets editor contents win', () => {
  const { editorFiles, testFiles } = partitionBundleFiles({
    'src/compat/array/chunk.ts': 'starter',
    'src/compat/array/chunk.spec.ts': 'starter suite',
  });
  const edited: Record<string, string> = { ...editorFiles, 'src/compat/array/chunk.ts': 'user solution' };
  const runFiles: Record<string, string> = { ...testFiles, ...edited };

  assert.equal(runFiles['src/compat/array/chunk.ts'], 'user solution');
  assert.equal(runFiles['src/compat/array/chunk.spec.ts'], 'starter suite');
});
