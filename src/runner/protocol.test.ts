import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRunnerResultMessage,
  summarizeTests,
  statusFromTests,
  RUNNER_MESSAGE_SOURCE,
  RUNNER_MESSAGE_VERSION,
} from './protocol.ts';

function resultMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: RUNNER_MESSAGE_SOURCE,
    version: RUNNER_MESSAGE_VERSION,
    runId: 'run-1',
    type: 'result',
    payload: {
      status: 'failed',
      tests: [{ suite: 'compact', name: 'filters falsey', status: 'failed', error: 'boom' }],
      console: [{ method: 'log', args: ['hi'] }],
    },
    ...overrides,
  };
}

test('validates a well-formed runner result message', () => {
  assert.equal(isRunnerResultMessage(resultMessage()), true);
});

test('validates a passed message with empty arrays', () => {
  assert.equal(
    isRunnerResultMessage(
      resultMessage({ payload: { status: 'passed', tests: [], console: [] } })
    ),
    true
  );
});

test('rejects non-object / wrong source / wrong type', () => {
  assert.equal(isRunnerResultMessage(null), false);
  assert.equal(isRunnerResultMessage('str'), false);
  assert.equal(isRunnerResultMessage(resultMessage({ source: 'other' })), false);
  assert.equal(isRunnerResultMessage(resultMessage({ type: 'other' })), false);
});

test('rejects bad version and empty run id', () => {
  assert.equal(isRunnerResultMessage(resultMessage({ version: 99 })), false);
  assert.equal(isRunnerResultMessage(resultMessage({ runId: '' })), false);
  assert.equal(isRunnerResultMessage(resultMessage({ runId: 42 })), false);
});

test('rejects invalid payload shapes', () => {
  assert.equal(isRunnerResultMessage(resultMessage({ payload: { status: 'wat', tests: [], console: [] } })), false);
  assert.equal(isRunnerResultMessage(resultMessage({ payload: { status: 'passed', tests: 'nope', console: [] } })), false);
  assert.equal(
    isRunnerResultMessage(
      resultMessage({ payload: { status: 'passed', tests: [{ suite: 's', name: 'n', status: 'weird' }], console: [] } })
    ),
    false
  );
  assert.equal(
    isRunnerResultMessage(resultMessage({ payload: { status: 'passed', tests: [], console: [{ method: 'log', args: [1] }] } })),
    false
  );
  assert.equal(
    isRunnerResultMessage(resultMessage({ payload: { status: 'passed', tests: [], console: [], error: 42 } })),
    false
  );
});

test('summarizeTests counts passed / failed / skipped', () => {
  const summary = summarizeTests([
    { suite: 's', name: 'a', status: 'passed' },
    { suite: 's', name: 'b', status: 'failed', error: 'e' },
    { suite: 's', name: 'c', status: 'skipped' },
  ]);
  assert.deepEqual(summary, {
    total: 3,
    passed: 1,
    failed: 1,
    skipped: 1,
    failures: [{ name: 'b', error: 'e' }],
  });
});

test('summarizeTests is stable on empty input', () => {
  assert.deepEqual(summarizeTests([]), { total: 0, passed: 0, failed: 0, skipped: 0, failures: [] });
});

test('statusFromTests derives the sandbox status', () => {
  assert.equal(statusFromTests([{ suite: 's', name: 'a', status: 'passed' }]), 'passed');
  assert.equal(
    statusFromTests([
      { suite: 's', name: 'a', status: 'passed' },
      { suite: 's', name: 'b', status: 'failed' },
    ]),
    'failed'
  );
});
