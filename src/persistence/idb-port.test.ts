// Unit tests for the IndexedDB PersistencePort adapter (docs/design-v1.md §9).
// Pure helpers run everywhere; the open/put/get/list/delete/clear
// round-trip needs a real IndexedDB, so it is skipped under node where no
// indexedDB global exists (§8.5 keeps such failures out of persisted data).

import assert from 'node:assert/strict';
import test from 'node:test';
import { PersistenceError } from './errors.ts';
import {
  isIndexedDBAvailable,
  openChallengeDatabase,
  planUpgrade,
  storeDescriptor,
  toIdbKey,
  createIDBPersistencePort,
} from './idb-port.ts';
import type { StoreName } from './port.ts';
import { SCHEMA_V1, STORE_NAMES } from './schema.ts';

function validationError(error: unknown): boolean {
  return error instanceof PersistenceError && error.code === 'validation';
}

function existingIndexes(
  entries: readonly (readonly [string, readonly string[]])[]
): Map<string, Set<string>> {
  return new Map(entries.map(([store, indexes]) => [store, new Set(indexes)] as const));
}

test('isIndexedDBAvailable reports a boolean and matches the ambient global', () => {
  assert.equal(typeof isIndexedDBAvailable(), 'boolean');
  assert.equal(isIndexedDBAvailable(), typeof indexedDB !== 'undefined');
});

test('toIdbKey passes single string and number keys through unchanged', () => {
  assert.equal(toIdbKey('k'), 'k');
  assert.equal(toIdbKey(7), 7);
});

test('toIdbKey copies readonly composite keys into fresh mutable arrays', () => {
  const key: readonly (string | number)[] = Object.freeze(['c', 'v1']);
  const copy = toIdbKey(key);
  assert.deepEqual(copy, ['c', 'v1']);
  assert.notEqual(copy, key);
  assert.ok(Array.isArray(copy));
});

test('toIdbKey rejects empty composite keys as validation errors', () => {
  assert.throws(() => toIdbKey([]), validationError);
});

test('storeDescriptor returns the SCHEMA_V1 descriptor for known stores', () => {
  assert.equal(storeDescriptor(STORE_NAMES.solutions), SCHEMA_V1[0]);
  assert.equal(storeDescriptor(STORE_NAMES.preferences).keyPath, 'key');
});

test('storeDescriptor rejects unknown stores as validation errors', () => {
  assert.throws(() => storeDescriptor('ghost' as StoreName), validationError);
});

test('planUpgrade on an empty database creates every store with all its indexes', () => {
  const plan = planUpgrade(new Map(), SCHEMA_V1);
  assert.deepEqual(
    plan.createStore.map((store) => store.name),
    ['solutions', 'completions', 'attempts', 'preferences']
  );
  assert.equal(
    plan.createIndex.length,
    SCHEMA_V1.reduce((total, store) => total + store.indexes.length, 0)
  );
  assert.ok(
    plan.createIndex.every((op) => plan.createStore.some((store) => store.name === op.store))
  );
});

test('planUpgrade backfills only missing indexes when every store exists', () => {
  const existing = existingIndexes([
    ['solutions', []],
    ['completions', []],
    ['attempts', ['byChallenge', 'byChallengeStartedAt']],
    ['preferences', []],
  ]);
  const plan = planUpgrade(existing, SCHEMA_V1);
  assert.deepEqual(plan.createStore, []);
  assert.deepEqual(plan.createIndex, [{ store: 'solutions', index: SCHEMA_V1[0].indexes[0] }]);
});

test('planUpgrade on a fully current database is a no-op', () => {
  const existing = existingIndexes(
    SCHEMA_V1.map((store) => [store.name, store.indexes.map((index) => index.name)] as const)
  );
  const plan = planUpgrade(existing, SCHEMA_V1);
  assert.deepEqual(plan, { createStore: [], createIndex: [] });
});

test(
  'IDB port round-trips put/get/list/putMany/delete/deleteMany/clear against a real database',
  { skip: isIndexedDBAvailable() ? false : 'no indexedDB in node' },
  async () => {
    const db = await openChallengeDatabase();
    const port = createIDBPersistencePort(db);
    try {
      await port.clear(STORE_NAMES.preferences);
      const record = { key: 'theme', value: 'dark' };
      await port.put(STORE_NAMES.preferences, 'theme', record);
      assert.deepEqual(await port.get(STORE_NAMES.preferences, 'theme'), record);
      assert.deepEqual(await port.list(STORE_NAMES.preferences), [record]);

      await port.putMany(STORE_NAMES.preferences, [
        ['fontSize', { key: 'fontSize', value: 14 }],
        ['layout', { key: 'layout', value: 'split' }],
      ]);
      assert.equal((await port.list(STORE_NAMES.preferences)).length, 3);

      await port.delete(STORE_NAMES.preferences, 'theme');
      assert.equal(await port.get(STORE_NAMES.preferences, 'theme'), undefined);

      await port.deleteMany(STORE_NAMES.preferences, ['fontSize', 'layout']);
      assert.deepEqual(await port.list(STORE_NAMES.preferences), []);

      await port.put(STORE_NAMES.preferences, 'pinned', { key: 'pinned', value: 'chunk' });
      await port.clear(STORE_NAMES.preferences);
      assert.deepEqual(await port.list(STORE_NAMES.preferences), []);

      await port.put(
        STORE_NAMES.solutions,
        ['c1', 'v1'],
        { challengeId: 'c1', challengeVersion: 'v1', updatedAt: 1 }
      );
      assert.deepEqual(await port.get(STORE_NAMES.solutions, ['c1', 'v1']), {
        challengeId: 'c1',
        challengeVersion: 'v1',
        updatedAt: 1,
      });
    } finally {
      db.close();
    }
  }
);
