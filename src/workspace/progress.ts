// Persistence seam for the challenge workspace.
//
// The workspace drives the editor and runner but never touches IndexedDB
// directly. Instead it reports events through `ProgressSeam`. The first
// version ships a `NoopProgressService`; a later DAO (docs/design-v1.md §9)
// implements the same interface and is injected at the app root, so the
// workspace code does not change.

import type { RunStatus } from '../runner/protocol.ts';

export interface ChallengeKey {
  challengeId: string;
  challengeVersion: string;
}

export interface AttemptRecord {
  key: ChallengeKey;
  result: RunStatus;
  passedTests: number;
  totalTests: number;
  durationMs: number;
  sourceHash: string;
}

export interface ProgressReader {
  /** The stored draft files for this exact [challengeId, challengeVersion], or null. */
  getSolutionDraft(key: ChallengeKey): Promise<Record<string, string> | null>;
}

export interface ProgressSeam {
  /** A challenge was opened and its starter files are known. */
  challengeOpened(key: ChallengeKey, starterFiles: Record<string, string>): void;
  /** User edited the solution (debounced by the caller). */
  saveDraft(key: ChallengeKey, files: Record<string, string>): void;
  /** A run finished with a structured outcome. */
  recordAttempt(attempt: AttemptRecord): void;
  /** A run passed every test. */
  markCompleted(key: ChallengeKey, attempt: AttemptRecord): void;
  /**
   * Optional read-only capability (docs/design-v1.md §10): DAO-backed
   * services also expose the last stored draft so the workspace can restore
   * it on open. Absent on the noop service, which keeps the old behavior.
   */
  getSolutionDraft?(key: ChallengeKey): Promise<Record<string, string> | null>;
}

export class NoopProgressService implements ProgressSeam {
  challengeOpened(_key: ChallengeKey, _starterFiles: Record<string, string>): void {}
  saveDraft(_key: ChallengeKey, _files: Record<string, string>): void {}
  recordAttempt(_attempt: AttemptRecord): void {}
  markCompleted(_key: ChallengeKey, _attempt: AttemptRecord): void {}
}

export const noopProgressService: ProgressSeam = new NoopProgressService();
