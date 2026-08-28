import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSandboxSetup,
  buildSandboxFromChallenge,
  sandboxPath,
  toRunResult,
  formatSandpackError,
} from './run.ts';
import type { ChallengeManifest } from '../challenges/types.ts';
import {
  RUNNER_MESSAGE_SOURCE,
  RUNNER_MESSAGE_VERSION,
  type RunnerResultMessage,
} from './protocol.ts';

test('sandboxPath adds the leading slash', () => {
  assert.equal(sandboxPath('src/compat/array/compact.ts'), '/src/compat/array/compact.ts');
  assert.equal(sandboxPath('/already/absolute.ts'), '/already/absolute.ts');
});

test('buildSandboxSetup assembles files, bootstrap, package.json and template', () => {
  const setup = buildSandboxSetup({
    challengeId: 'compat-array-compact',
    runId: 'run-1',
    testPaths: ['src/compat/array/compact.spec.ts'],
    runtimePath: 'runtime/test-runtime.ts',
    files: {
      'src/compat/array/compact.ts': 'export function compact() {}',
      'src/compat/array/compact.spec.ts': 'describe("x", () => {})',
    },
  });

  assert.equal(setup.template, 'vanilla-ts');
  assert.equal(setup.entry, '/src/runner/bootstrap.ts');
  assert.equal(setup.files['/src/compat/array/compact.ts'].code, 'export function compact() {}');
  assert.ok(setup.files['/src/runner/bootstrap.ts'].code.includes('run-1'));
  assert.ok(setup.files['/src/runner/bootstrap.ts'].hidden);
  assert.ok(setup.files['/package.json']);
  assert.ok(setup.files['/index.html']);
  const pkg = JSON.parse(setup.files['/package.json'].code) as { main: string };
  assert.equal(pkg.main, '/src/runner/bootstrap.ts');
});

test('buildSandboxFromChallenge uses the manifest metadata', () => {
  const manifest: ChallengeManifest = {
    id: 'compat-array-compact',
    slug: 'compact',
    title: 'compact',
    category: 'array',
    difficulty: 'easy',
    upstream: {
      repository: 'toss/es-toolkit',
      commit: 'c',
      sourcePath: 'src/compat/array/compact.ts',
      testPaths: ['src/compat/array/compact.spec.ts'],
    },
    generatorVersion: '0.1.0',
    challengeVersion: 'v',
    targetExport: 'compact',
    entryFile: 'src/compat/array/compact.ts',
    editableFiles: ['src/compat/array/compact.ts'],
    readonlyFiles: ['src/compat/array/compact.spec.ts'],
    description: '',
    hints: [],
    runtime: { timeoutMs: 5000, testAdapter: 'jest-subset-v1', capabilities: ['jest-subset-v1'] },
    integrity: { configHash: '', starterHash: '', testsHash: '', manifestHash: '' },
  };
  const setup = buildSandboxFromChallenge(manifest, { 'src/compat/array/compact.ts': 'x' }, 'run-2');
  const bootstrap = setup.files['/src/runner/bootstrap.ts'].code;
  assert.ok(bootstrap.includes('compat-array-compact'));
  assert.ok(bootstrap.includes('run-2'));
  assert.ok(bootstrap.includes("import '../compat/array/compact.spec.ts';"));
});

function message(overrides: Partial<RunnerResultMessage['payload']> = {}): RunnerResultMessage {
  return {
    source: RUNNER_MESSAGE_SOURCE,
    version: RUNNER_MESSAGE_VERSION,
    runId: 'r',
    type: 'result',
    payload: {
      status: 'passed',
      tests: [{ suite: 's', name: 't', status: 'passed' }],
      console: [{ method: 'log', args: ['a'] }],
      ...overrides,
    },
  };
}

test('toRunResult passes through a successful sandbox result', () => {
  const startedAt = Date.now();
  const result = toRunResult({ runId: 'r', startedAt, sandboxMessage: message() });
  assert.equal(result.status, 'passed');
  assert.equal(result.tests.length, 1);
  assert.equal(result.console.length, 1);
  assert.ok(result.durationMs >= 0);
});

test('toRunResult maps a failed sandbox result', () => {
  const result = toRunResult({
    runId: 'r',
    startedAt: Date.now(),
    sandboxMessage: message({ status: 'failed', tests: [{ suite: 's', name: 't', status: 'failed', error: 'x' }] }),
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.error, undefined);
});

test('toRunResult maps a runtime-error with message', () => {
  const result = toRunResult({
    runId: 'r',
    startedAt: Date.now(),
    sandboxMessage: message({ status: 'runtime-error', tests: [], error: 'boom' }),
  });
  assert.equal(result.status, 'runtime-error');
  assert.equal(result.error, 'boom');
});

test('toRunResult gives timeout priority over other inputs', () => {
  const result = toRunResult({ runId: 'r', startedAt: Date.now(), sandboxMessage: message(), timedOut: true });
  assert.equal(result.status, 'timeout');
});

test('toRunResult maps compile errors', () => {
  const result = toRunResult({ runId: 'r', startedAt: Date.now(), sandboxMessage: null, compileError: 'TS error' });
  assert.equal(result.status, 'compile-error');
  assert.equal(result.error, 'TS error');
});

test('toRunResult reports a missing sandbox result as runtime-error', () => {
  const result = toRunResult({ runId: 'r', startedAt: Date.now(), sandboxMessage: null });
  assert.equal(result.status, 'runtime-error');
  assert.equal(result.error, 'Sandbox did not report a result');
});

test('formatSandpackError builds a readable message', () => {
  assert.equal(formatSandpackError({ message: 'Cannot find module' }), 'Cannot find module');
  assert.equal(
    formatSandpackError({ message: 'nope', title: 'TS', path: '/src/a.ts', line: 3, column: 5 }),
    'TS: /src/a.ts:3:5: nope'
  );
});
