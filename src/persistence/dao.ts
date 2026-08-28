// Deterministic progress DAO over a PersistencePort (docs/design-v1.md §9.5).
// Owns draft upsert, attempt recording with per-challenge pruning, the
// completion merge rules, summary projection, reset, and export/import
// with conflict policies. The clock is injectable so every timestamp is
// reproducible under test, and all storage failures are funneled through
// normalizePersistenceError.

import {
  DEFAULT_MAX_ATTEMPTS_PER_CHALLENGE,
  makeAttemptId,
  staleAttempts,
} from './attempts.ts';
import type {
  AttemptRecord,
  AttemptResult,
  ChallengeKey,
  CompletionRecord,
  PreferenceRecord,
  SolutionRecord,
} from './domain.ts';
import { normalizePersistenceError } from './errors.ts';
import { challengeKeyId } from './keys.ts';
import type { PersistencePort, PortKey } from './port.ts';
import { STORE_NAMES } from './schema.ts';
import { aggregateProgress, indexProgressByChallenge, summarizeChallenge } from './summary.ts';
import type { ChallengeProgress, ProgressTotals } from './summary.ts';
import {
  asAttemptRecord,
  asChallengeKey,
  asCompletionRecord,
  asProgressExport,
  asSolutionRecord,
} from './validate.ts';
import type { ProgressExport } from './validate.ts';

export interface SaveDraftInput {
  key: ChallengeKey;
  files: Record<string, string>;
  starterHash: string;
}

export interface AttemptInput {
  key: ChallengeKey;
  durationMs: number;
  result: AttemptResult;
  passedTests: number;
  totalTests: number;
  sourceHash: string;
  startedAt: number;
}

export interface CompletionInput {
  key: ChallengeKey;
  durationMs: number;
  sourceHash: string;
}

export interface ProgressSummary {
  totals: ProgressTotals;
  byChallenge: ReadonlyMap<string, ChallengeProgress>;
}

export interface ImportResult {
  importedSolutions: number;
  importedCompletions: number;
  importedAttempts: number;
  importedPreferences: number;
  skippedConflicts: number;
}

export interface ProgressDAO {
  getSolution(key: ChallengeKey): Promise<SolutionRecord | null>;
  saveDraft(input: SaveDraftInput): Promise<void>;
  recordAttempt(input: AttemptInput): Promise<void>;
  markCompleted(input: CompletionInput): Promise<void>;
  getProgressSummary(): Promise<ProgressSummary>;
  resetChallenge(key: ChallengeKey): Promise<void>;
  exportAll(): Promise<ProgressExport>;
  importAll(data: ProgressExport): Promise<ImportResult>;
}

export type DAOClock = { now(): number } | number;

function recordKeyId(record: {
  challengeId: string;
  challengeVersion: string;
}): string {
  return challengeKeyId({
    challengeId: record.challengeId,
    challengeVersion: record.challengeVersion,
  });
}

function parseChallengeKeyId(id: string): ChallengeKey {
  const [challengeId, challengeVersion] = JSON.parse(id) as [string, string];
  return { challengeId, challengeVersion };
}

function mergeCompletion(
  existing: CompletionRecord,
  incoming: CompletionRecord
): CompletionRecord {
  const first = existing.firstPassedAt <= incoming.firstPassedAt ? existing : incoming;
  const last = incoming.lastPassedAt >= existing.lastPassedAt ? incoming : existing;
  return {
    ...last,
    firstPassedAt: first.firstPassedAt,
    attemptCountAtFirstPass: first.attemptCountAtFirstPass,
    bestDurationMs: Math.min(existing.bestDurationMs, incoming.bestDurationMs),
  };
}

export function createProgressDAO(
  port: PersistencePort,
  deps: DAOClock,
  maxAttemptsPerChallenge: number = DEFAULT_MAX_ATTEMPTS_PER_CHALLENGE
): ProgressDAO {
  const clock = typeof deps === 'number' ? { now: (): number => deps } : deps;
  const limit = Math.max(0, Math.floor(maxAttemptsPerChallenge));

  async function attemptsFor(key: ChallengeKey): Promise<AttemptRecord[]> {
    const all = await port.list<AttemptRecord>(STORE_NAMES.attempts);
    return all.filter(
      (attempt) =>
        attempt.challengeId === key.challengeId &&
        attempt.challengeVersion === key.challengeVersion
    );
  }

  return {
    async getSolution(key: ChallengeKey): Promise<SolutionRecord | null> {
      try {
        const solutionKey = asChallengeKey(key);
        const record = await port.get<SolutionRecord>(
          STORE_NAMES.solutions,
          challengeKeyId(solutionKey)
        );
        return record ?? null;
      } catch (error) {
        throw normalizePersistenceError(error);
      }
    },

    async saveDraft(input: SaveDraftInput): Promise<void> {
      try {
        const key = asChallengeKey(input.key);
        const id = challengeKeyId(key);
        const existing = await port.get<SolutionRecord>(STORE_NAMES.solutions, id);
        const stamp = clock.now();
        const record: SolutionRecord = existing
          ? {
              ...existing,
              files: input.files,
              starterHash: input.starterHash,
              updatedAt: stamp,
            }
          : {
              challengeId: key.challengeId,
              challengeVersion: key.challengeVersion,
              files: input.files,
              starterHash: input.starterHash,
              createdAt: stamp,
              updatedAt: stamp,
              runCount: 0,
            };
        await port.put(STORE_NAMES.solutions, id, asSolutionRecord(record));
      } catch (error) {
        throw normalizePersistenceError(error);
      }
    },

    async recordAttempt(input: AttemptInput): Promise<void> {
      try {
        const key = asChallengeKey(input.key);
        const stamp = clock.now();
        const attempt = asAttemptRecord({
          id: makeAttemptId(key, input.startedAt),
          challengeId: key.challengeId,
          challengeVersion: key.challengeVersion,
          startedAt: input.startedAt,
          durationMs: input.durationMs,
          result: input.result,
          passedTests: input.passedTests,
          totalTests: input.totalTests,
          sourceHash: input.sourceHash,
        });
        await port.put(STORE_NAMES.attempts, attempt.id, attempt);

        const stale = staleAttempts(await attemptsFor(key), limit);
        if (stale.length > 0) {
          await port.deleteMany(
            STORE_NAMES.attempts,
            stale.map((record) => record.id)
          );
        }

        const solutionId = challengeKeyId(key);
        const solution = await port.get<SolutionRecord>(STORE_NAMES.solutions, solutionId);
        if (solution !== undefined) {
          await port.put(
            STORE_NAMES.solutions,
            solutionId,
            asSolutionRecord({
              ...solution,
              runCount: solution.runCount + 1,
              lastRunAt: stamp,
              lastResult: input.result,
            })
          );
        }
      } catch (error) {
        throw normalizePersistenceError(error);
      }
    },

    async markCompleted(input: CompletionInput): Promise<void> {
      try {
        const key = asChallengeKey(input.key);
        const stamp = clock.now();
        const id = challengeKeyId(key);
        const existing = await port.get<CompletionRecord>(STORE_NAMES.completions, id);
        const record: CompletionRecord = existing
          ? {
              ...existing,
              firstPassedAt: Math.min(existing.firstPassedAt, stamp),
              lastPassedAt: Math.max(existing.lastPassedAt, stamp),
              bestDurationMs: Math.min(existing.bestDurationMs, input.durationMs),
              passingSourceHash: input.sourceHash,
            }
          : {
              challengeId: key.challengeId,
              challengeVersion: key.challengeVersion,
              firstPassedAt: stamp,
              lastPassedAt: stamp,
              bestDurationMs: input.durationMs,
              passingSourceHash: input.sourceHash,
              attemptCountAtFirstPass: (await attemptsFor(key)).length,
            };
        await port.put(STORE_NAMES.completions, id, asCompletionRecord(record));
      } catch (error) {
        throw normalizePersistenceError(error);
      }
    },

    async getProgressSummary(): Promise<ProgressSummary> {
      try {
        const solutions = await port.list<SolutionRecord>(STORE_NAMES.solutions);
        const completions = await port.list<CompletionRecord>(STORE_NAMES.completions);
        const attempts = await port.list<AttemptRecord>(STORE_NAMES.attempts);

        const solutionById = new Map(solutions.map((record) => [recordKeyId(record), record]));
        const completionById = new Map(
          completions.map((record) => [recordKeyId(record), record])
        );
        const attemptCountById = new Map<string, number>();
        for (const attempt of attempts) {
          const id = recordKeyId(attempt);
          attemptCountById.set(id, (attemptCountById.get(id) ?? 0) + 1);
        }

        const orderedIds = [
          ...new Set([...solutionById.keys(), ...completionById.keys(), ...attemptCountById.keys()]),
        ];
        const progresses = orderedIds.map((id) =>
          summarizeChallenge(parseChallengeKeyId(id), {
            solution: solutionById.get(id) ?? null,
            completion: completionById.get(id) ?? null,
            attemptCount: attemptCountById.get(id) ?? 0,
          })
        );

        return {
          totals: aggregateProgress(progresses),
          byChallenge: indexProgressByChallenge(progresses),
        };
      } catch (error) {
        throw normalizePersistenceError(error);
      }
    },

    async resetChallenge(key: ChallengeKey): Promise<void> {
      try {
        const resetKey = asChallengeKey(key);
        const staleAttemptIds = (await attemptsFor(resetKey)).map((attempt) => attempt.id);
        const id = challengeKeyId(resetKey);
        await port.delete(STORE_NAMES.solutions, id);
        await port.delete(STORE_NAMES.completions, id);
        if (staleAttemptIds.length > 0) {
          await port.deleteMany(STORE_NAMES.attempts, staleAttemptIds);
        }
      } catch (error) {
        throw normalizePersistenceError(error);
      }
    },

    async exportAll(): Promise<ProgressExport> {
      try {
        const solutions = await port.list<SolutionRecord>(STORE_NAMES.solutions);
        const completions = await port.list<CompletionRecord>(STORE_NAMES.completions);
        const attempts = await port.list<AttemptRecord>(STORE_NAMES.attempts);
        const preferences = await port.list<PreferenceRecord>(STORE_NAMES.preferences);
        return asProgressExport({
          version: 1,
          exportedAt: clock.now(),
          solutions,
          completions,
          attempts,
          preferences,
        });
      } catch (error) {
        throw normalizePersistenceError(error);
      }
    },

    async importAll(data: ProgressExport): Promise<ImportResult> {
      try {
        const exp = asProgressExport(data);

        const existingSolutions = await port.list<SolutionRecord>(STORE_NAMES.solutions);
        const existingCompletions = await port.list<CompletionRecord>(STORE_NAMES.completions);
        const existingAttempts = await port.list<AttemptRecord>(STORE_NAMES.attempts);

        const solutionById = new Map(
          existingSolutions.map((record) => [recordKeyId(record), record])
        );
        const completionById = new Map(
          existingCompletions.map((record) => [recordKeyId(record), record])
        );

        let skippedConflicts = 0;

        const solutionEntries: (readonly [PortKey, SolutionRecord])[] = [];
        for (const incoming of exp.solutions) {
          const id = recordKeyId(incoming);
          const current = solutionById.get(id);
          if (current !== undefined && current.updatedAt > incoming.updatedAt) {
            skippedConflicts += 1;
            continue;
          }
          solutionById.set(id, incoming);
          solutionEntries.push([id, incoming]);
        }

        const completionEntries: (readonly [PortKey, CompletionRecord])[] = [];
        for (const incoming of exp.completions) {
          const id = recordKeyId(incoming);
          const merged = completionById.has(id)
            ? mergeCompletion(completionById.get(id)!, incoming)
            : incoming;
          completionById.set(id, merged);
          completionEntries.push([id, merged]);
        }

        const incomingIds = new Set(exp.attempts.map((attempt) => attempt.id));
        const mergedAttempts = [
          ...existingAttempts.filter((attempt) => !incomingIds.has(attempt.id)),
          ...exp.attempts,
        ];
        const staleIds = new Set(staleAttempts(mergedAttempts, limit).map((a) => a.id));
        const attemptEntries: (readonly [PortKey, AttemptRecord])[] = exp.attempts
          .filter((attempt) => !staleIds.has(attempt.id))
          .map((attempt) => [attempt.id, attempt]);

        const preferenceEntries: (readonly [PortKey, PreferenceRecord])[] = exp.preferences.map(
          (preference) => [preference.key, preference]
        );

        await port.putMany(STORE_NAMES.solutions, solutionEntries);
        await port.putMany(STORE_NAMES.completions, completionEntries);
        if (staleIds.size > 0) {
          await port.deleteMany(STORE_NAMES.attempts, [...staleIds]);
        }
        await port.putMany(STORE_NAMES.attempts, attemptEntries);
        await port.putMany(STORE_NAMES.preferences, preferenceEntries);

        return {
          importedSolutions: solutionEntries.length,
          importedCompletions: completionEntries.length,
          importedAttempts: attemptEntries.length,
          importedPreferences: preferenceEntries.length,
          skippedConflicts,
        };
      } catch (error) {
        throw normalizePersistenceError(error);
      }
    },
  };
}
