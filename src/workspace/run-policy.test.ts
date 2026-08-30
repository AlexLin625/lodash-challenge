import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  estimateDeclaredTestCaseCount,
  isFailedPartialRun,
  isPartialTestRun,
  relaxedInitialTimeoutMs,
  shouldRetryAfterPartialFailure,
} from './run-policy.ts';

test('relaxedInitialTimeoutMs adds a moderate first-run grace window', () => {
  assert.equal(relaxedInitialTimeoutMs(5000), 7000);
  assert.equal(relaxedInitialTimeoutMs(12000), 16200);
});

test('estimateDeclaredTestCaseCount counts test declarations from manifest test paths only', () => {
  const count = estimateDeclaredTestCaseCount(
    {
      'src/a.spec.ts': 'it("a", () => {}); test("b", () => {}); xit("c", () => {});',
      'src/b.spec.ts': 'describe("x", () => { it("d", () => {}); });',
      'src/ignored.ts': 'it("no", () => {});',
    },
    ['src/a.spec.ts', 'src/b.spec.ts']
  );
  assert.equal(count, 4);
});

test('isPartialTestRun reports partial runs only when declared count is known', () => {
  assert.equal(isPartialTestRun(2, 3), true);
  assert.equal(isPartialTestRun(3, 3), false);
  assert.equal(isPartialTestRun(0, 0), false);
});

test('shouldRetryAfterPartialFailure only retries after a previous partial failure', () => {
  assert.equal(
    shouldRetryAfterPartialFailure({
      previousRunFailedPartially: true,
      status: 'passed',
      executedCount: 2,
      declaredCount: 4,
    }),
    true
  );
  assert.equal(
    shouldRetryAfterPartialFailure({
      previousRunFailedPartially: false,
      status: 'passed',
      executedCount: 2,
      declaredCount: 4,
    }),
    false
  );
  assert.equal(
    shouldRetryAfterPartialFailure({
      previousRunFailedPartially: true,
      status: 'failed',
      executedCount: 2,
      declaredCount: 4,
    }),
    false
  );
});

test('isFailedPartialRun marks only non-passed partial runs', () => {
  assert.equal(isFailedPartialRun('timeout', 0, 5), true);
  assert.equal(isFailedPartialRun('failed', 5, 5), false);
  assert.equal(isFailedPartialRun('passed', 1, 5), false);
});
