import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProgressSummary } from '../persistence/dao.ts';
import type { ChallengeKey } from '../persistence/domain.ts';
import type { ProgressTotals } from '../persistence/summary.ts';
import type { ChallengeProgress } from '../persistence/summary.ts';
import { completedChallengeIds, progressTotalsLabel } from './completion.ts';

function key(challengeId: string, challengeVersion: string): ChallengeKey {
  return { challengeId, challengeVersion };
}

function progress(
  challengeKey: ChallengeKey,
  completed: boolean
): ChallengeProgress {
  return {
    key: challengeKey,
    completed,
    runCount: completed ? 1 : 0,
    attemptCount: completed ? 1 : 0,
  };
}

function summaryOf(progresses: readonly ChallengeProgress[]): ProgressSummary {
  const byChallenge = new Map<string, ChallengeProgress>();
  for (const progressEntry of progresses) {
    byChallenge.set(
      `${progressEntry.key.challengeId}\u0000${progressEntry.key.challengeVersion}`,
      progressEntry
    );
  }
  return {
    totals: {
      total: progresses.length,
      completed: progresses.filter((entry) => entry.completed).length,
    },
    byChallenge,
  };
}

test('completedChallengeIds marks an id completed when any version is completed', () => {
  const summary = summaryOf([
    progress(key('compact', 'v1'), false),
    progress(key('compact', 'v2'), true),
    progress(key('chunk', 'v1'), false),
    progress(key('sum', 'v1'), true),
    progress(key('sum', 'v2'), true),
  ]);

  const completed = completedChallengeIds(summary);
  assert.deepEqual(
    [...completed].sort(),
    ['compact', 'sum']
  );
});

test('completedChallengeIds on an empty summary yields an empty set', () => {
  const completed = completedChallengeIds(summaryOf([]));
  assert.equal(completed.size, 0);
});

test('progressTotalsLabel formats completed over total', () => {
  const totals: ProgressTotals = { total: 20, completed: 3 };
  assert.equal(progressTotalsLabel(totals), '3 / 20 completed');
});

test('progressTotalsLabel returns an empty string when total is 0', () => {
  assert.equal(progressTotalsLabel({ total: 0, completed: 0 }), '');
});
