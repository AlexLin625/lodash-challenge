import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AttemptRecord } from './domain.ts';
import {
  DEFAULT_MAX_ATTEMPTS_PER_CHALLENGE,
  makeAttemptId,
  pruneAttempts,
  staleAttempts,
} from './attempts.ts';

let counter = 0;

function attempt(
  challengeId: string,
  startedAt: number,
  challengeVersion = 'v1'
): AttemptRecord {
  return {
    id: `${challengeId}:${challengeVersion}:${startedAt}#${counter++}`,
    challengeId,
    challengeVersion,
    startedAt,
    durationMs: 10,
    result: 'passed',
    passedTests: 5,
    totalTests: 5,
    sourceHash: 'hash',
  };
}

function ids(records: readonly AttemptRecord[]): string[] {
  return records.map((record) => record.id);
}

test('makeAttemptId is deterministic and follows the documented format', () => {
  const key = { challengeId: 'chunk', challengeVersion: 'v2' };

  assert.equal(makeAttemptId(key, 123), 'chunk:v2:123');
  assert.equal(makeAttemptId(key, 123), makeAttemptId(key, 123));
  assert.notEqual(makeAttemptId(key, 123), makeAttemptId(key, 124));
});

test('pruneAttempts keeps the newest attempt per group at limit 1', () => {
  const a = attempt('chunk', 100);
  const b = attempt('chunk', 300);
  const c = attempt('chunk', 200);
  const d = attempt('join', 50);

  assert.deepEqual(ids(pruneAttempts([a, b, c, d], 1)), [b.id, d.id]);
});

test('pruneAttempts keeps the two newest attempts per group', () => {
  const records = [100, 300, 200, 400].map((startedAt) => attempt('chunk', startedAt));

  assert.deepEqual(
    ids(pruneAttempts(records, 2)),
    [records[1].id, records[3].id]
  );
});

test('different challenge versions are pruned independently', () => {
  const v1a = attempt('chunk', 100, 'v1');
  const v1b = attempt('chunk', 200, 'v1');
  const v2a = attempt('chunk', 50, 'v2');

  assert.deepEqual(ids(pruneAttempts([v1a, v1b, v2a], 1)), [v1b.id, v2a.id]);
});

test('ties on startedAt keep the later occurrence in the input', () => {
  const first = attempt('chunk', 100);
  const second = attempt('chunk', 100);
  const third = attempt('chunk', 100);

  assert.deepEqual(ids(pruneAttempts([first, second, third], 2)), [second.id, third.id]);
  assert.deepEqual(ids(pruneAttempts([first, second, third], 1)), [third.id]);
});

test('pruneAttempts preserves the relative order of the input', () => {
  const records = [900, 100, 800, 200, 700].map((startedAt) => attempt('chunk', startedAt));
  const kept = new Set(ids(pruneAttempts(records, 3)));

  assert.deepEqual(
    ids(pruneAttempts(records, 3)),
    records.filter((record) => kept.has(record.id)).map((record) => record.id)
  );
});

test('staleAttempts is the exact complement of pruneAttempts', () => {
  const records = [
    attempt('chunk', 100),
    attempt('chunk', 300),
    attempt('chunk', 200),
    attempt('join', 400),
    attempt('join', 150),
  ];
  const limit = 1;

  const kept = pruneAttempts(records, limit);
  const stale = staleAttempts(records, limit);
  const keptIds = new Set(ids(kept));

  assert.equal(kept.length + stale.length, records.length);
  for (const record of stale) {
    assert.ok(!keptIds.has(record.id));
  }
  assert.deepEqual(
    ids(stale),
    records.filter((record) => !keptIds.has(record.id)).map((record) => record.id)
  );
});

test('pruneAttempts defaults to the twenty newest attempts', () => {
  assert.equal(DEFAULT_MAX_ATTEMPTS_PER_CHALLENGE, 20);

  const records = Array.from({ length: 21 }, (_, i) => attempt('chunk', i * 10));
  const kept = pruneAttempts(records);
  const expected = records.slice(1);

  assert.equal(kept.length, 20);
  assert.deepEqual(ids(kept), ids(expected));
  assert.deepEqual(ids(staleAttempts(records)), [records[0].id]);
});

test('helpers do not mutate the input', () => {
  const frozen = Object.freeze(
    Array.from({ length: 25 }, (_, i) => Object.freeze(attempt('chunk', i * 10)))
  );
  const before = ids(frozen);

  const kept = pruneAttempts(frozen);
  const stale = staleAttempts(frozen);

  assert.deepEqual(ids(frozen), before);
  assert.equal(frozen.length, 25);
  assert.notEqual(kept, frozen);
  assert.notEqual(stale, frozen);
});
