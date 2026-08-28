// Deterministic attempt-record helpers for the persistence layer.
//
// The attempts store keeps only the most recent attempts per challenge
// version (docs/design-v1.md §9.3). These pure functions define the id
// format and the trimming rules a future DAO will use, without any
// storage API.

import type { AttemptRecord, ChallengeKey } from './domain.ts';

export const DEFAULT_MAX_ATTEMPTS_PER_CHALLENGE = 20;

export function makeAttemptId(key: ChallengeKey, startedAt: number): string {
  return `${key.challengeId}:${key.challengeVersion}:${startedAt}`;
}

function partitionAttempts(
  attempts: readonly AttemptRecord[],
  limit: number
): [AttemptRecord[], AttemptRecord[]] {
  const groups = new Map<string, number[]>();
  attempts.forEach((attempt, index) => {
    const groupKey = `${attempt.challengeId}\u0000${attempt.challengeVersion}`;
    const indices = groups.get(groupKey);
    if (indices) {
      indices.push(index);
    } else {
      groups.set(groupKey, [index]);
    }
  });

  const keptIndices = new Set<number>();
  for (const indices of groups.values()) {
    const ranked = [...indices].sort(
      (a, b) => attempts[b].startedAt - attempts[a].startedAt || b - a
    );
    for (const index of ranked.slice(0, limit)) {
      keptIndices.add(index);
    }
  }

  const kept: AttemptRecord[] = [];
  const stale: AttemptRecord[] = [];
  attempts.forEach((attempt, index) => {
    if (keptIndices.has(index)) {
      kept.push(attempt);
    } else {
      stale.push(attempt);
    }
  });

  return [kept, stale];
}

export function pruneAttempts(
  attempts: readonly AttemptRecord[],
  maxPerChallenge = DEFAULT_MAX_ATTEMPTS_PER_CHALLENGE
): AttemptRecord[] {
  return partitionAttempts(attempts, Math.max(0, maxPerChallenge))[0];
}

export function staleAttempts(
  attempts: readonly AttemptRecord[],
  maxPerChallenge = DEFAULT_MAX_ATTEMPTS_PER_CHALLENGE
): AttemptRecord[] {
  return partitionAttempts(attempts, Math.max(0, maxPerChallenge))[1];
}
