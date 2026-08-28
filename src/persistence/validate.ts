// Runtime validation for records crossing the persistence boundary.
//
// DAO write paths and importAll (docs/design-v1.md §9.5) may receive
// malformed stored or imported objects. These pure asserters normalize
// valid input and throw PersistenceError('validation') naming the field.

import { PersistenceError } from './errors.ts';
import type {
  AttemptRecord,
  AttemptResult,
  ChallengeKey,
  CompletionRecord,
  JsonValue,
  PreferenceRecord,
  SolutionRecord,
} from './domain.ts';

export interface ProgressExport {
  version: 1;
  exportedAt: number;
  solutions: SolutionRecord[];
  completions: CompletionRecord[];
  attempts: AttemptRecord[];
  preferences: PreferenceRecord[];
}

const ATTEMPT_RESULTS: ReadonlySet<string> = new Set([
  'passed',
  'failed',
  'timeout',
  'runtime-error',
]);

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) {
    return true;
  }

  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (Array.isArray(value)) {
        return value.every(isJsonValue);
      }
      return Object.values(value as Record<string, unknown>).every(isJsonValue);
    }
    default:
      return false;
  }
}

export function asChallengeKey(input: unknown): ChallengeKey {
  const record = asRecordObject(input, 'challenge key', '');
  return {
    challengeId: requireNonEmptyStringField(record, '', 'challengeId'),
    challengeVersion: requireNonEmptyStringField(record, '', 'challengeVersion'),
  };
}

export function asSolutionRecord(input: unknown): SolutionRecord {
  return toSolutionRecord(input, '');
}

export function asCompletionRecord(input: unknown): CompletionRecord {
  return toCompletionRecord(input, '');
}

export function asAttemptRecord(input: unknown): AttemptRecord {
  return toAttemptRecord(input, '');
}

export function asPreferenceRecord(input: unknown): PreferenceRecord {
  return toPreferenceRecord(input, '');
}

export function asProgressExport(input: unknown): ProgressExport {
  const record = asRecordObject(input, 'progress export', '');
  if (record.version !== 1) {
    prefixedFail('', 'version must be 1');
  }

  return {
    version: 1,
    exportedAt: requireFiniteNumberField(record, '', 'exportedAt'),
    solutions: toRecordList(record.solutions, 'solutions', toSolutionRecord),
    completions: toRecordList(record.completions, 'completions', toCompletionRecord),
    attempts: toRecordList(record.attempts, 'attempts', toAttemptRecord),
    preferences: toRecordList(record.preferences, 'preferences', toPreferenceRecord),
  };
}

function toSolutionRecord(input: unknown, context: string): SolutionRecord {
  const record = asRecordObject(input, 'solution', context);
  const solution: SolutionRecord = {
    challengeId: requireNonEmptyStringField(record, context, 'challengeId'),
    challengeVersion: requireNonEmptyStringField(record, context, 'challengeVersion'),
    files: requireStringMapField(record, context, 'files'),
    starterHash: requireStringField(record, context, 'starterHash'),
    createdAt: requireFiniteNumberField(record, context, 'createdAt'),
    updatedAt: requireFiniteNumberField(record, context, 'updatedAt'),
    runCount: requireFiniteNumberField(record, context, 'runCount'),
  };

  if (record.lastRunAt !== undefined) {
    solution.lastRunAt = requireFiniteNumberField(record, context, 'lastRunAt');
  }
  if (record.lastResult !== undefined) {
    solution.lastResult = requireAttemptResultField(record, context, 'lastResult');
  }

  return solution;
}

function toCompletionRecord(input: unknown, context: string): CompletionRecord {
  const record = asRecordObject(input, 'completion', context);
  return {
    challengeId: requireNonEmptyStringField(record, context, 'challengeId'),
    challengeVersion: requireNonEmptyStringField(record, context, 'challengeVersion'),
    firstPassedAt: requireFiniteNumberField(record, context, 'firstPassedAt'),
    lastPassedAt: requireFiniteNumberField(record, context, 'lastPassedAt'),
    bestDurationMs: requireFiniteNumberField(record, context, 'bestDurationMs'),
    passingSourceHash: requireStringField(record, context, 'passingSourceHash'),
    attemptCountAtFirstPass: requireFiniteNumberField(
      record,
      context,
      'attemptCountAtFirstPass'
    ),
  };
}

function toAttemptRecord(input: unknown, context: string): AttemptRecord {
  const record = asRecordObject(input, 'attempt', context);
  return {
    id: requireStringField(record, context, 'id'),
    challengeId: requireNonEmptyStringField(record, context, 'challengeId'),
    challengeVersion: requireNonEmptyStringField(record, context, 'challengeVersion'),
    startedAt: requireFiniteNumberField(record, context, 'startedAt'),
    durationMs: requireFiniteNumberField(record, context, 'durationMs'),
    result: requireAttemptResultField(record, context, 'result'),
    passedTests: requireFiniteNumberField(record, context, 'passedTests'),
    totalTests: requireFiniteNumberField(record, context, 'totalTests'),
    sourceHash: requireStringField(record, context, 'sourceHash'),
  };
}

function toPreferenceRecord(input: unknown, context: string): PreferenceRecord {
  const record = asRecordObject(input, 'preference', context);
  const key = requireNonEmptyStringField(record, context, 'key');
  const value: unknown = record.value;

  if (!isJsonValue(value)) {
    prefixedFail(context, 'value must be a JSON-compatible value');
  }

  return { key, value };
}

function toRecordList<T>(
  value: unknown,
  collection: string,
  toItem: (item: unknown, context: string) => T
): T[] {
  if (!Array.isArray(value)) {
    prefixedFail('', `${collection} must be an array`);
  }
  return value.map((item, index) => toItem(item, `${collection}[${index}]`));
}

function asRecordObject(input: unknown, label: string, context: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    prefixedFail(context, `${label} must be an object`);
  }
  return input as Record<string, unknown>;
}

function requireStringField(
  record: Record<string, unknown>,
  context: string,
  field: string
): string {
  const value: unknown = record[field];
  if (typeof value !== 'string') {
    prefixedFail(context, `${field} must be a string`);
  }
  return value;
}

function requireNonEmptyStringField(
  record: Record<string, unknown>,
  context: string,
  field: string
): string {
  const value = requireStringField(record, context, field);
  if (value === '') {
    prefixedFail(context, `${field} must be a non-empty string`);
  }
  return value;
}

function requireFiniteNumberField(
  record: Record<string, unknown>,
  context: string,
  field: string
): number {
  const value: unknown = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    prefixedFail(context, `${field} must be a finite number`);
  }
  return value;
}

function requireAttemptResultField(
  record: Record<string, unknown>,
  context: string,
  field: string
): AttemptResult {
  const value: unknown = record[field];
  if (typeof value !== 'string' || !ATTEMPT_RESULTS.has(value)) {
    prefixedFail(context, `${field} must be one of: passed, failed, timeout, runtime-error`);
  }
  return value as AttemptResult;
}

function requireStringMapField(
  record: Record<string, unknown>,
  context: string,
  field: string
): Record<string, string> {
  const candidate: unknown = record[field];
  const message = `${field} must be Record<string, string>`;

  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    prefixedFail(context, message);
  }

  const result: Record<string, string> = {};
  for (const [name, content] of Object.entries(candidate)) {
    if (typeof content !== 'string') {
      prefixedFail(context, message);
    }
    result[name] = content;
  }
  return result;
}

function prefixedFail(context: string, message: string): never {
  validationFailure(context === '' ? message : `${context}: ${message}`);
}

function validationFailure(message: string): never {
  throw new PersistenceError('validation', message);
}
