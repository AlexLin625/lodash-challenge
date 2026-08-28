import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChallengeKey, CompletionRecord, SolutionRecord } from './domain.ts';
import {
  aggregateProgress,
  indexProgressByChallenge,
  progressKeyOf,
  summarizeChallenge,
} from './summary.ts';
import type { ChallengeProgress } from './summary.ts';

const key: ChallengeKey = { challengeId: 'chunk', challengeVersion: 'v1' };

function solution(overrides: Partial<SolutionRecord> = {}): SolutionRecord {
  return {
    challengeId: 'chunk',
    challengeVersion: 'v1',
    files: { 'index.ts': 'export {}' },
    starterHash: 'starter',
    createdAt: 1000,
    updatedAt: 2000,
    runCount: 3,
    lastResult: 'failed',
    ...overrides,
  };
}

function completion(overrides: Partial<CompletionRecord> = {}): CompletionRecord {
  return {
    challengeId: 'chunk',
    challengeVersion: 'v1',
    firstPassedAt: 1500,
    lastPassedAt: 1900,
    bestDurationMs: 42,
    passingSourceHash: 'pass',
    attemptCountAtFirstPass: 2,
    ...overrides,
  };
}

test('summarizeChallenge yields safe defaults for null inputs', () => {
  const progress = summarizeChallenge(key, {
    solution: null,
    completion: null,
    attemptCount: 0,
  });

  assert.deepEqual(progress, {
    key,
    completed: false,
    runCount: 0,
    attemptCount: 0,
  });
});

test('summarizeChallenge maps a full solution and completion', () => {
  const progress = summarizeChallenge(key, {
    solution: solution({ updatedAt: 2500, runCount: 7, lastResult: 'passed' }),
    completion: completion({ firstPassedAt: 1234 }),
    attemptCount: 9,
  });

  assert.equal(progress.completed, true);
  assert.equal(progress.firstPassedAt, 1234);
  assert.equal(progress.updatedAt, 2500);
  assert.equal(progress.lastResult, 'passed');
  assert.equal(progress.runCount, 7);
  assert.equal(progress.attemptCount, 9);
});

test('summarizeChallenge normalizes negative and fractional attempt counts', () => {
  const negative = summarizeChallenge(key, { solution: null, completion: null, attemptCount: -3 });
  const fractional = summarizeChallenge(key, { solution: null, completion: null, attemptCount: 2.7 });

  assert.equal(negative.attemptCount, 0);
  assert.equal(fractional.attemptCount, 2);
});

test('summarizeChallenge keeps an undefined lastResult as absent', () => {
  const progress = summarizeChallenge(key, {
    solution: solution({ lastResult: undefined }),
    completion: null,
    attemptCount: 1,
  });

  assert.equal(progress.updatedAt, 2000);
  assert.equal(progress.runCount, 3);
  assert.equal('lastResult' in progress, false);
});

function progress(challengeId: string, completed: boolean): ChallengeProgress {
  return {
    key: { challengeId, challengeVersion: 'v1' },
    completed,
    runCount: completed ? 1 : 0,
    attemptCount: completed ? 2 : 0,
  };
}

test('aggregateProgress counts an empty list as zero', () => {
  assert.deepEqual(aggregateProgress([]), { total: 0, completed: 0 });
});

test('aggregateProgress counts completed challenges', () => {
  const progresses = [
    progress('chunk', true),
    progress('join', false),
    progress('pick', true),
    progress('omit', false),
  ];

  assert.deepEqual(aggregateProgress(progresses), { total: 4, completed: 2 });
});

test('progressKeyOf joins the key components with NUL', () => {
  assert.equal(progressKeyOf(key), 'chunk\u0000v1');
  assert.notEqual(
    progressKeyOf({ challengeId: 'chunk', challengeVersion: 'v2' }),
    progressKeyOf(key)
  );
});

test('indexProgressByChallenge indexes each entry under its progress key', () => {
  const chunk = progress('chunk', true);
  const join = progress('join', false);
  const index = indexProgressByChallenge([chunk, join]);

  assert.equal(index.size, 2);
  assert.equal(index.get(progressKeyOf(chunk.key)), chunk);
  assert.equal(index.get(progressKeyOf(join.key)), join);
});

test('indexProgressByChallenge lets the last duplicate key win', () => {
  const first = progress('chunk', false);
  const second = progress('chunk', true);
  const index = indexProgressByChallenge([first, second]);

  assert.equal(index.size, 1);
  assert.equal(index.get(progressKeyOf(key)), second);
});

test('summarizeChallenge does not mutate frozen inputs', () => {
  const frozenSolution = Object.freeze(solution());
  const frozenCompletion = Object.freeze(completion());
  const frozenKey = Object.freeze({ ...key });

  const progress = summarizeChallenge(frozenKey, {
    solution: frozenSolution,
    completion: frozenCompletion,
    attemptCount: 5,
  });

  assert.equal(progress.completed, true);
  assert.equal(progress.firstPassedAt, 1500);
  assert.equal(progress.updatedAt, 2000);
  assert.equal(progress.lastResult, 'failed');
  assert.equal(progress.runCount, 3);
  assert.equal(progress.attemptCount, 5);
  assert.equal(progress.key, frozenKey);
});
