// Bridge from the workspace ProgressSeam to the ProgressDAO.
//
// Implements the app data flow of docs/design-v1.md §10 on top of the DAO
// contract of §9.5: every seam call is fire-and-forget, serialized on an
// internal promise chain, and failures surface through onError as
// PersistenceError instead of throwing back into the workspace UI.

import type { RunStatus } from '../runner/protocol.ts';
import type {
  AttemptRecord as WorkspaceAttemptRecord,
  ChallengeKey as WorkspaceChallengeKey,
  ProgressReader,
  ProgressSeam,
} from '../workspace/progress.ts';
import type { ProgressDAO } from './dao.ts';
import type { AttemptResult, ChallengeKey } from './domain.ts';
import { normalizePersistenceError } from './errors.ts';
import type { PersistenceError } from './errors.ts';

export interface WorkspaceProgressServiceDeps {
  dao: ProgressDAO;
  maxAttemptsPerChallenge?: number;
  onError?: (error: PersistenceError) => void;
  clock?: () => number;
}

export interface FlushableProgressSeam extends ProgressSeam, ProgressReader {
  // Redeclared to narrow the optional seam member to a required one.
  getSolutionDraft(key: WorkspaceChallengeKey): Promise<Record<string, string> | null>;
  /** Resolves once every operation enqueued before the call has settled. */
  flush(): Promise<void>;
}

// Reads share the fire-and-forget write queue's tail so they observe every
// write enqueued before them (open-time restore sees the seed, if any) and
// are covered by flush(). Failures normalize through onError and resolve to
// the fallback instead of rejecting into the UI.

// dao.saveDraft overwrites starterHash on existing records (dao.ts merges it
// unconditionally), so the service re-reads the solution and replays the
// stored starterHash to keep the open-time seed intact.
function toAttemptResult(status: RunStatus): AttemptResult {
  switch (status) {
    case 'passed':
    case 'failed':
    case 'timeout':
    case 'runtime-error':
      return status;
    default:
      return 'failed';
  }
}

function toDomainKey(key: WorkspaceChallengeKey): ChallengeKey {
  return { challengeId: key.challengeId, challengeVersion: key.challengeVersion };
}

export function createWorkspaceProgressService(
  deps: WorkspaceProgressServiceDeps
): FlushableProgressSeam {
  const { dao, onError } = deps;
  const clock = deps.clock ?? Date.now;

  let tail: Promise<void> = Promise.resolve();

  function notifyError(error: unknown): void {
    if (onError === undefined) {
      return;
    }
    try {
      onError(normalizePersistenceError(error));
    } catch {
      // A broken onError callback must never stall the queue.
    }
  }

  function enqueue(operation: () => Promise<void>): void {
    const step = async (): Promise<void> => {
      try {
        await operation();
      } catch (error) {
        notifyError(error);
      }
    };
    tail = tail.then(step, step);
  }

  function enqueueResult<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    const step = async (): Promise<T> => {
      try {
        return await operation();
      } catch (error) {
        notifyError(error);
        return fallback;
      }
    };
    const result = tail.then(step, step);
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  return {
    challengeOpened(key: WorkspaceChallengeKey, starterFiles: Record<string, string>): void {
      enqueue(async () => {
        const domainKey = toDomainKey(key);
        if ((await dao.getSolution(domainKey)) === null) {
          await dao.saveDraft({ key: domainKey, files: starterFiles, starterHash: '' });
        }
      });
    },

    saveDraft(key: WorkspaceChallengeKey, files: Record<string, string>): void {
      enqueue(async () => {
        const domainKey = toDomainKey(key);
        const existing = await dao.getSolution(domainKey);
        await dao.saveDraft({
          key: domainKey,
          files,
          starterHash: existing?.starterHash ?? '',
        });
      });
    },

    recordAttempt(attempt: WorkspaceAttemptRecord): void {
      enqueue(async () => {
        await dao.recordAttempt({
          key: toDomainKey(attempt.key),
          durationMs: attempt.durationMs,
          result: toAttemptResult(attempt.result),
          passedTests: attempt.passedTests,
          totalTests: attempt.totalTests,
          sourceHash: attempt.sourceHash,
          startedAt: clock() - attempt.durationMs,
        });
      });
    },

    markCompleted(key: WorkspaceChallengeKey, attempt: WorkspaceAttemptRecord): void {
      enqueue(async () => {
        await dao.markCompleted({
          key: toDomainKey(key),
          durationMs: attempt.durationMs,
          sourceHash: attempt.sourceHash,
        });
      });
    },

    getSolutionDraft(key: WorkspaceChallengeKey): Promise<Record<string, string> | null> {
      return enqueueResult(async () => {
        const existing = await dao.getSolution(toDomainKey(key));
        return existing?.files ?? null;
      }, null);
    },

    async flush(): Promise<void> {
      await tail;
    },
  };
}
