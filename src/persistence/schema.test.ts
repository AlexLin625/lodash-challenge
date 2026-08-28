import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SCHEMA_V1,
  STORE_NAMES,
  findStoreDescriptor,
  validateSchema,
  type ObjectStoreDescriptor,
} from './schema.ts';

test('SCHEMA_V1 passes structural validation', () => {
  assert.deepEqual(validateSchema(SCHEMA_V1), []);
});

test('SCHEMA_V1 covers every declared store name', () => {
  const names = SCHEMA_V1.map((store) => store.name).sort();

  assert.deepEqual(names, Object.values(STORE_NAMES).sort());
});

test('solutions and completions use a compound non-incrementing key', () => {
  const solutions = findStoreDescriptor(STORE_NAMES.solutions);
  const completions = findStoreDescriptor(STORE_NAMES.completions);

  assert.ok(solutions);
  assert.ok(completions);
  assert.deepEqual(solutions.keyPath, ['challengeId', 'challengeVersion']);
  assert.deepEqual(completions.keyPath, ['challengeId', 'challengeVersion']);
  assert.equal(solutions.autoIncrement, false);
  assert.equal(completions.autoIncrement, false);
});

test('attempts declares both challenge indexes with exact keyPaths', () => {
  const attempts = findStoreDescriptor(STORE_NAMES.attempts);

  assert.ok(attempts);
  assert.deepEqual(attempts.keyPath, 'id');
  assert.deepEqual(
    attempts.indexes.map((index) => [index.name, index.keyPath, index.unique]),
    [
      ['byChallenge', ['challengeId', 'challengeVersion'], false],
      ['byChallengeStartedAt', ['challengeId', 'challengeVersion', 'startedAt'], false],
    ]
  );
});

test('preferences is keyed by a single key path without extra indexes', () => {
  const preferences = findStoreDescriptor(STORE_NAMES.preferences);

  assert.ok(preferences);
  assert.equal(preferences.keyPath, 'key');
  assert.deepEqual(preferences.indexes, []);
});

test('findStoreDescriptor returns undefined for unknown names', () => {
  assert.equal(findStoreDescriptor('nope'), undefined);
});

test('validateSchema rejects an empty schema', () => {
  const issues = validateSchema([]);

  assert.ok(issues.length > 0);
});

test('validateSchema rejects duplicate store names', () => {
  const store: ObjectStoreDescriptor = {
    name: 'solutions',
    keyPath: 'id',
    autoIncrement: false,
    indexes: [],
  };

  assert.ok(validateSchema([store, store]).length > 0);
});

test('validateSchema rejects duplicate index names within a store', () => {
  const schema: ObjectStoreDescriptor[] = [
    {
      name: 'attempts',
      keyPath: 'id',
      autoIncrement: false,
      indexes: [
        { name: 'byChallenge', keyPath: 'challengeId', unique: false },
        { name: 'byChallenge', keyPath: 'startedAt', unique: false },
      ],
    },
  ];

  assert.ok(validateSchema(schema).length > 0);
});

test('validateSchema rejects empty keyPath arrays', () => {
  const schema: ObjectStoreDescriptor[] = [
    { name: 'solutions', keyPath: [], autoIncrement: false, indexes: [] },
  ];
  const withIndex: ObjectStoreDescriptor[] = [
    {
      name: 'solutions',
      keyPath: 'id',
      autoIncrement: false,
      indexes: [{ name: 'bySomething', keyPath: [], unique: false }],
    },
  ];

  assert.ok(validateSchema(schema).length > 0);
  assert.ok(validateSchema(withIndex).length > 0);
});

test('validateSchema rejects empty store and index names', () => {
  const schema: ObjectStoreDescriptor[] = [
    {
      name: '',
      keyPath: 'id',
      autoIncrement: false,
      indexes: [{ name: '', keyPath: 'x', unique: false }],
    },
  ];

  assert.ok(validateSchema(schema).length > 0);
});
