import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PersistenceError } from './errors.ts';
import type {
  AttemptRecord,
  CompletionRecord,
  PreferenceRecord,
  SolutionRecord,
} from './domain.ts';
import type { ProgressExport } from './validate.ts';
import {
  asAttemptRecord,
  asChallengeKey,
  asCompletionRecord,
  asPreferenceRecord,
  asProgressExport,
  asSolutionRecord,
  isJsonValue,
} from './validate.ts';

function validSolution(): SolutionRecord {
  return {
    challengeId: 'debounce',
    challengeVersion: 'v1',
    files: { 'main.js': 'export default function debounce(fn) {}' },
    starterHash: 'aaa111',
    createdAt: 1000,
    updatedAt: 2000,
    lastRunAt: 2500,
    runCount: 3,
    lastResult: 'failed',
  };
}

function validCompletion(): CompletionRecord {
  return {
    challengeId: 'debounce',
    challengeVersion: 'v1',
    firstPassedAt: 3000,
    lastPassedAt: 4000,
    bestDurationMs: 812,
    passingSourceHash: 'bbb222',
    attemptCountAtFirstPass: 4,
  };
}

function validAttempt(): AttemptRecord {
  return {
    id: 'debounce:v1:5000',
    challengeId: 'debounce',
    challengeVersion: 'v1',
    startedAt: 5000,
    durationMs: 120,
    result: 'passed',
    passedTests: 12,
    totalTests: 12,
    sourceHash: 'ccc333',
  };
}

function validPreference(): PreferenceRecord {
  return { key: 'editor.theme', value: { dark: true, fontSize: 14 } };
}

function validExport(): ProgressExport {
  return {
    version: 1,
    exportedAt: 9000,
    solutions: [validSolution()],
    completions: [validCompletion()],
    attempts: [validAttempt()],
    preferences: [validPreference()],
  };
}

function validationErrorFrom(run: () => unknown): PersistenceError {
  try {
    const result = run();
    assert.notEqual(result, undefined, 'validator must not return undefined');
  } catch (error) {
    assert.ok(error instanceof PersistenceError, `expected PersistenceError, got ${String(error)}`);
    assert.equal(error.code, 'validation');
    assert.ok(typeof error.message === 'string' && error.message.length > 0);
    return error;
  }
  return assert.fail('expected a validation error to be thrown') as never;
}

test('isJsonValue accepts nested plain JSON structures', () => {
  assert.equal(isJsonValue(null), true);
  assert.equal(isJsonValue('draft'), true);
  assert.equal(isJsonValue(42), true);
  assert.equal(isJsonValue([1, 'a', null, [true, { n: 0 }]]), true);
  assert.equal(isJsonValue({ a: 1, b: { c: [2, { d: 'x' }] } }), true);
});

test('isJsonValue rejects NaN, Infinity and non-serializable values', () => {
  assert.equal(isJsonValue(Number.NaN), false);
  assert.equal(isJsonValue(Number.POSITIVE_INFINITY), false);
  assert.equal(isJsonValue(Number.NEGATIVE_INFINITY), false);
  assert.equal(isJsonValue(() => 1), false);
  assert.equal(isJsonValue(Symbol('s')), false);
  assert.equal(isJsonValue(undefined), false);
  assert.equal(isJsonValue({ nested: Number.NaN }), false);
  assert.equal(isJsonValue([1, () => 1]), false);
});

test('asChallengeKey returns a normalized key for valid input', () => {
  const input = { challengeId: 'debounce', challengeVersion: 'v1', extra: true };
  const key = asChallengeKey(input);

  assert.deepEqual(key, { challengeId: 'debounce', challengeVersion: 'v1' });
  assert.notEqual(key, input);
});

test('asChallengeKey rejects empty or non-string fields', () => {
  validationErrorFrom(() => asChallengeKey({ challengeId: '', challengeVersion: 'v1' }));
  validationErrorFrom(() => asChallengeKey({ challengeId: 'debounce', challengeVersion: 2 }));
  validationErrorFrom(() => asChallengeKey(['debounce', 'v1']));
});

test('asSolutionRecord accepts a full record and normalizes it', () => {
  const input = validSolution();
  const record = asSolutionRecord(input);

  assert.deepEqual(record, input);
  assert.notEqual(record, input);
  assert.notEqual(record.files, input.files);
});

test('asSolutionRecord accepts records without optional fields', () => {
  const input = validSolution();
  delete input.lastRunAt;
  delete input.lastResult;

  assert.deepEqual(asSolutionRecord(input), input);
});

test('asSolutionRecord rejects bad files maps and timestamps', () => {
  const badFiles = validSolution();
  badFiles.files = { 'main.js': 7 as unknown as string };
  validationErrorFrom(() => asSolutionRecord(badFiles));

  const badTimestamp = validSolution();
  badTimestamp.updatedAt = Number.NaN as unknown as number;
  validationErrorFrom(() => asSolutionRecord(badTimestamp));
});

test('asSolutionRecord rejects unknown lastResult values', () => {
  const input = validSolution();
  input.lastResult = 'skipped' as unknown as SolutionRecord['lastResult'];
  validationErrorFrom(() => asSolutionRecord(input));
});

test('asCompletionRecord accepts a valid record', () => {
  const input = validCompletion();
  const record = asCompletionRecord(input);

  assert.deepEqual(record, input);
  assert.notEqual(record, input);
});

test('asCompletionRecord rejects non-finite numbers and bad hashes', () => {
  const badDuration = validCompletion();
  badDuration.bestDurationMs = Number.POSITIVE_INFINITY;
  validationErrorFrom(() => asCompletionRecord(badDuration));

  const badHash = validCompletion();
  badHash.passingSourceHash = undefined as unknown as string;
  validationErrorFrom(() => asCompletionRecord(badHash));
});

test('asAttemptRecord accepts a valid record', () => {
  const input = validAttempt();
  const record = asAttemptRecord(input);

  assert.deepEqual(record, input);
  assert.notEqual(record, input);
});

test('asAttemptRecord rejects out-of-enum results and bad durations', () => {
  const badResult = validAttempt();
  badResult.result = 'flaky' as unknown as AttemptRecord['result'];
  validationErrorFrom(() => asAttemptRecord(badResult));

  const badDuration = validAttempt();
  badDuration.durationMs = '120' as unknown as number;
  validationErrorFrom(() => asAttemptRecord(badDuration));
});

test('asPreferenceRecord accepts JSON-compatible values', () => {
  const input = validPreference();
  const record = asPreferenceRecord(input);

  assert.deepEqual(record, input);
  assert.notEqual(record, input);
});

test('asPreferenceRecord rejects non-JSON values and empty keys', () => {
  const badValue = validPreference();
  badValue.value = (() => 1) as unknown as PreferenceRecord['value'];
  validationErrorFrom(() => asPreferenceRecord(badValue));

  const nestedBadValue = validPreference();
  nestedBadValue.value = { theme: Number.NaN };
  validationErrorFrom(() => asPreferenceRecord(nestedBadValue));

  const emptyKey = validPreference();
  emptyKey.key = '';
  validationErrorFrom(() => asPreferenceRecord(emptyKey));
});

test('asProgressExport accepts a full export and keeps records', () => {
  const input: ProgressExport = validExport();
  const result: ProgressExport = asProgressExport(input);

  assert.deepEqual(result, input);
  assert.equal(result.version, 1);
  assert.notEqual(result, input);
});

test('asProgressExport rejects a wrong version and missing collections', () => {
  const badVersion = validExport();
  badVersion.version = 2 as unknown as 1;
  validationErrorFrom(() => asProgressExport(badVersion));

  const missingCollection = validExport();
  delete (missingCollection as Partial<ProgressExport>).attempts;
  validationErrorFrom(() => asProgressExport(missingCollection));
});

test('asProgressExport reports the failing item path', () => {
  const input = validExport();
  input.solutions.push(validSolution());
  input.solutions[1].files = { 'main.js': 42 as unknown as string };

  const error = validationErrorFrom(() => asProgressExport(input));
  assert.equal(error.message, 'solutions[1]: files must be Record<string, string>');
});

test('asProgressExport nests item errors for attempts and preferences', () => {
  const attemptCase = validExport();
  attemptCase.attempts[0].result = 'skipped' as unknown as AttemptRecord['result'];
  const attemptError = validationErrorFrom(() => asProgressExport(attemptCase));
  assert.match(attemptError.message, /^attempts\[0\]: result must be one of/);

  const preferenceCase = validExport();
  preferenceCase.preferences[0].value = undefined as unknown as ProgressExport['preferences'][number]['value'];
  const preferenceError = validationErrorFrom(() => asProgressExport(preferenceCase));
  assert.equal(preferenceError.message, 'preferences[0]: value must be a JSON-compatible value');
});
