// Pure progress projections backing the DAO getProgressSummary operation
// (docs/design-v1.md §9.5) and the catalog completion status shown by the
// UI (§10). These functions map solution/completion records into per
// challenge progress views without touching any storage API.

import type {
  AttemptResult,
  ChallengeKey,
  CompletionRecord,
  SolutionRecord,
} from './domain.ts';

export interface ChallengeProgress {
  key: ChallengeKey;
  completed: boolean;
  firstPassedAt?: number;
  updatedAt?: number;
  lastResult?: AttemptResult;
  runCount: number;
  attemptCount: number;
}

export interface ProgressSummaryInputs {
  solution: SolutionRecord | null;
  completion: CompletionRecord | null;
  attemptCount: number;
}

function normalizeCount(value: number): number {
  return Math.max(0, Math.floor(value));
}

export function summarizeChallenge(
  key: ChallengeKey,
  inputs: ProgressSummaryInputs
): ChallengeProgress {
  const progress: ChallengeProgress = {
    key,
    completed: inputs.completion !== null,
    runCount: inputs.solution?.runCount ?? 0,
    attemptCount: normalizeCount(inputs.attemptCount),
  };

  if (inputs.completion !== null) {
    progress.firstPassedAt = inputs.completion.firstPassedAt;
  }
  if (inputs.solution !== null) {
    progress.updatedAt = inputs.solution.updatedAt;
    if (inputs.solution.lastResult !== undefined) {
      progress.lastResult = inputs.solution.lastResult;
    }
  }

  return progress;
}

export interface ProgressTotals {
  total: number;
  completed: number;
}

export function aggregateProgress(
  progresses: readonly ChallengeProgress[]
): ProgressTotals {
  const completed = progresses.filter((progress) => progress.completed).length;
  return { total: progresses.length, completed };
}

// Catalog-facing map key: challengeId and challengeVersion joined by NUL,
// matching the grouping used by the attempts helpers. Unlike the tuple
// addressing key in keys.ts (a [challengeId, challengeVersion] pair), this
// form is an in-memory Map key only and is never persisted.
export function progressKeyOf(key: ChallengeKey): string {
  return `${key.challengeId}\u0000${key.challengeVersion}`;
}

export function indexProgressByChallenge(
  progresses: readonly ChallengeProgress[]
): Map<string, ChallengeProgress> {
  const index = new Map<string, ChallengeProgress>();
  for (const progress of progresses) {
    index.set(progressKeyOf(progress.key), progress);
  }
  return index;
}