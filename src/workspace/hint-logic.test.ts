import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChallengeHint } from '../challenges/types.ts';
import {
  nextRevealedLevel,
  remainingHintCount,
  visibleHints,
} from './hint-logic.ts';

function hint(level: 1 | 2 | 3, text = `hint-${level}`): ChallengeHint {
  return { level, text, source: 'manual' };
}

const NO_HINTS: readonly ChallengeHint[] = [];
const ONE_HINT = [hint(1)];
const THREE_HINTS = [hint(1), hint(2), hint(3)];
const SHUFFLED_HINTS = [hint(3), hint(1), hint(2)];

test('empty hints never advance the level and reveal nothing', () => {
  assert.equal(nextRevealedLevel(NO_HINTS, 0), 0);
  assert.equal(nextRevealedLevel(NO_HINTS, 3), 3);
  assert.deepEqual(visibleHints(NO_HINTS, 3), []);
  assert.equal(remainingHintCount(NO_HINTS, 0), '');
});

test('a single hint advances one level then caps', () => {
  assert.equal(nextRevealedLevel(ONE_HINT, 0), 1);
  assert.equal(nextRevealedLevel(ONE_HINT, 1), 1);
  assert.equal(nextRevealedLevel(ONE_HINT, 2), 2);
  assert.deepEqual(visibleHints(ONE_HINT, 0), []);
  assert.deepEqual(visibleHints(ONE_HINT, 1), [ONE_HINT[0]]);
  assert.equal(remainingHintCount(ONE_HINT, 0), '1 more hint');
  assert.equal(remainingHintCount(ONE_HINT, 1), '');
});

test('three hints reveal one level at a time', () => {
  assert.equal(nextRevealedLevel(THREE_HINTS, 0), 1);
  assert.equal(nextRevealedLevel(THREE_HINTS, 1), 2);
  assert.equal(nextRevealedLevel(THREE_HINTS, 2), 3);
  assert.equal(visibleHints(THREE_HINTS, 0).length, 0);
  assert.equal(visibleHints(THREE_HINTS, 1).length, 1);
  assert.equal(visibleHints(THREE_HINTS, 2).length, 2);
  assert.equal(visibleHints(THREE_HINTS, 3).length, 3);
  assert.equal(remainingHintCount(THREE_HINTS, 0), '3 more hints');
  assert.equal(remainingHintCount(THREE_HINTS, 1), '2 more hints');
  assert.equal(remainingHintCount(THREE_HINTS, 2), '1 more hint');
  assert.equal(remainingHintCount(THREE_HINTS, 3), '');
});

test('the level caps at the highest available hint level', () => {
  assert.equal(nextRevealedLevel(THREE_HINTS, 3), 3);
  assert.equal(nextRevealedLevel(ONE_HINT, 3), 3);
});

test('out-of-order hint levels still advance in ascending order', () => {
  assert.equal(nextRevealedLevel(SHUFFLED_HINTS, 0), 1);
  assert.equal(nextRevealedLevel(SHUFFLED_HINTS, 1), 2);
  assert.deepEqual(
    visibleHints(SHUFFLED_HINTS, 3).map((h) => h.level),
    [1, 2, 3]
  );
  assert.deepEqual(
    visibleHints(SHUFFLED_HINTS, 2).map((h) => h.level),
    [1, 2]
  );
  assert.equal(remainingHintCount(SHUFFLED_HINTS, 2), '1 more hint');
});

test('visibleHints does not mutate its input', () => {
  const input = [hint(3), hint(2), hint(1)];
  visibleHints(input, 3);
  assert.deepEqual(
    input.map((h) => h.level),
    [3, 2, 1]
  );
});
