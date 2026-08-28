import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBootstrapCode } from './bootstrap.ts';

test('creates bootstrap with correct relative imports for the sandbox entry', () => {
  const code = createBootstrapCode({
    challengeId: 'compat-array-compact',
    runId: 'run-abc',
    testPaths: ['src/compat/array/compact.spec.ts'],
    runtimePath: 'runtime/test-runtime.ts',
  });
  assert.match(code, /import \{ __runTests \} from '\.\.\/\.\.\/runtime\/test-runtime\.ts';/);
  assert.match(code, /import '\.\.\/compat\/array\/compact\.spec\.ts';/);
  assert.ok(code.includes('"run-abc"'));
  assert.ok(code.includes('window.parent.postMessage'));
  assert.ok(code.includes('source: "lodash-challenge-runner"'));
  assert.ok(code.includes('version: 1'));
  assert.ok(code.includes('type: \'result\''));
});

test('bootstrap honors maxConsoleEntries and deep test paths', () => {
  const code = createBootstrapCode({
    challengeId: 'x',
    runId: 'r',
    testPaths: ['src/compat/array/dropWhile.spec.ts', 'src/compat/array/extra.spec.ts'],
    runtimePath: 'runtime/test-runtime.ts',
    maxConsoleEntries: 5,
  });
  assert.ok(code.includes('MAX_CONSOLE_ENTRIES = 5'));
  assert.ok(code.includes("import '../compat/array/dropWhile.spec.ts';"));
  assert.ok(code.includes("import '../compat/array/extra.spec.ts';"));
});
