export type JsonPrimitive = null | boolean | number | string;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ChallengeKey {
  challengeId: string;
  challengeVersion: string;
}

export type AttemptResult = 'passed' | 'failed' | 'timeout' | 'runtime-error';

export interface SolutionRecord {
  challengeId: string;
  challengeVersion: string;
  files: Record<string, string>;
  starterHash: string;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  runCount: number;
  lastResult?: AttemptResult;
}

export interface CompletionRecord {
  challengeId: string;
  challengeVersion: string;
  firstPassedAt: number;
  lastPassedAt: number;
  bestDurationMs: number;
  passingSourceHash: string;
  attemptCountAtFirstPass: number;
}

export interface AttemptRecord {
  id: string;
  challengeId: string;
  challengeVersion: string;
  startedAt: number;
  durationMs: number;
  result: AttemptResult;
  passedTests: number;
  totalTests: number;
  sourceHash: string;
}

export interface PreferenceRecord {
  key: string;
  value: JsonValue;
}
