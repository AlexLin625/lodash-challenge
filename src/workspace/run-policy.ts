import type { RunStatus } from '../runner/protocol.ts';

const TEST_DECLARATION_RE = /\b(?:it|test|xit)\s*\(/g;

export function relaxedInitialTimeoutMs(timeoutMs: number): number {
  return Math.max(Math.round(timeoutMs * 1.35), timeoutMs + 2000);
}

export function estimateDeclaredTestCaseCount(
  files: Readonly<Record<string, string>>,
  testPaths: readonly string[]
): number {
  let total = 0;
  for (const path of testPaths) {
    const code = files[path];
    if (!code) {
      continue;
    }
    total += code.match(TEST_DECLARATION_RE)?.length ?? 0;
  }
  return total;
}

export function isPartialTestRun(executedCount: number, declaredCount: number): boolean {
  return declaredCount > 0 && executedCount < declaredCount;
}

export function shouldRetryAfterPartialFailure(input: {
  previousRunFailedPartially: boolean;
  status: RunStatus;
  executedCount: number;
  declaredCount: number;
}): boolean {
  return (
    input.previousRunFailedPartially &&
    input.status === 'passed' &&
    isPartialTestRun(input.executedCount, input.declaredCount)
  );
}

export function isFailedPartialRun(status: RunStatus, executedCount: number, declaredCount: number): boolean {
  return status !== 'passed' && isPartialTestRun(executedCount, declaredCount);
}
