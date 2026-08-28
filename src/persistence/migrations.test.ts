import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MigrationOp, MigrationStep } from './migrations.ts';
import {
  SCHEMA_MIGRATIONS,
  currentSchemaVersion,
  migrationPathTo,
  validateMigrationPlan,
} from './migrations.ts';
import type { IndexDescriptor, ObjectStoreDescriptor } from './schema.ts';
import { SCHEMA_V1, validateSchema } from './schema.ts';
import { PersistenceError } from './errors.ts';

function store(name: string): ObjectStoreDescriptor {
  return { name, keyPath: 'id', autoIncrement: false, indexes: [] };
}

function index(name: string, keyPath = 'x'): IndexDescriptor {
  return { name, keyPath, unique: false };
}

function makeStore(name: string): MigrationOp {
  return { kind: 'create-store', store: store(name) };
}

function step(
  name: string,
  from: number,
  to: number,
  ops: readonly MigrationOp[] = []
): MigrationStep {
  return { name, from, to, ops };
}

function assertValidationFailure(fn: () => unknown): void {
  assert.throws(
    fn,
    (error: unknown) => error instanceof PersistenceError && error.code === 'validation'
  );
}

test('SCHEMA_MIGRATIONS is a valid plan and currentSchemaVersion reaches 1', () => {
  assert.deepEqual(validateMigrationPlan(SCHEMA_MIGRATIONS), []);
  assert.equal(currentSchemaVersion(SCHEMA_MIGRATIONS), 1);
  assert.equal(currentSchemaVersion([]), 0);
  assert.equal(currentSchemaVersion([step('a', 0, 1), step('b', 1, 2)]), 2);
});

test('the v1 step creates exactly the SCHEMA_V1 stores with valid descriptors', () => {
  const created = SCHEMA_MIGRATIONS.flatMap((candidate) =>
    candidate.ops.flatMap((op) => (op.kind === 'create-store' ? [op.store] : []))
  );

  assert.deepEqual(
    created.map((candidate) => candidate.name).sort(),
    SCHEMA_V1.map((candidate) => candidate.name).sort()
  );
  assert.deepEqual(validateSchema(created), []);
  assert.equal(created.length, SCHEMA_V1.length);
});

test('validateMigrationPlan rejects an empty plan', () => {
  assert.deepEqual(validateMigrationPlan([]), ['empty migration plan']);
});

test('validateMigrationPlan requires the plan to start from version 0', () => {
  const issues = validateMigrationPlan([step('late', 1, 2)]);

  assert.ok(issues.includes('step "late" starts at 1 but expected 0'));
});

test('validateMigrationPlan rejects gaps and overlaps between steps', () => {
  const gap = validateMigrationPlan([step('a', 0, 1), step('b', 2, 3)]);
  const overlap = validateMigrationPlan([step('a', 0, 2), step('b', 1, 3)]);

  assert.ok(gap.some((issue) => issue.includes('starts at 2 but expected 1')));
  assert.ok(overlap.some((issue) => issue.includes('starts at 1 but expected 2')));
});

test('validateMigrationPlan rejects malformed from/to versions', () => {
  const equal = validateMigrationPlan([step('flat', 1, 1)]);
  const decreasing = validateMigrationPlan([step('back', 2, 1)]);
  const fractional = validateMigrationPlan([step('frac', 0.5, 1)]);
  const negative = validateMigrationPlan([step('neg', -1, 1)]);

  assert.ok(
    equal.some((issue) => issue.includes('not strictly increasing')) &&
      equal.some((issue) => issue.includes('starts at 1 but expected 0'))
  );
  assert.ok(decreasing.some((issue) => issue.includes('not strictly increasing')));
  assert.ok(fractional.some((issue) => issue.includes('non-positive-integer from')));
  assert.ok(negative.some((issue) => issue.includes('non-positive-integer from')));
});

test('validateMigrationPlan rejects duplicate create-store names', () => {
  const within = validateMigrationPlan([
    step('same', 0, 1, [makeStore('a'), makeStore('a')]),
  ]);
  const across = validateMigrationPlan([
    step('first', 0, 1, [makeStore('a')]),
    step('second', 1, 2, [makeStore('a')]),
  ]);

  assert.ok(within.some((issue) => issue.includes('creates object store "a" twice')));
  assert.ok(across.some((issue) => issue.includes('recreates existing object store "a"')));
});

test('validateMigrationPlan checks create-index targets and duplicates', () => {
  const backfill = validateMigrationPlan([
    step('first', 0, 1, [{ kind: 'create-index', store: 'a', index: index('byX') }]),
  ]);
  const unknownStore = validateMigrationPlan([
    step('first', 0, 1, [{ kind: 'create-index', store: 'missing', index: index('byX') }]),
  ]);
  const duplicate = validateMigrationPlan([
    step('same', 0, 1, [
      makeStore('a'),
      { kind: 'create-index', store: 'a', index: index('byX') },
      { kind: 'create-index', store: 'a', index: index('byX', 'y') },
    ]),
  ]);
  const acrossSteps = validateMigrationPlan([
    step('first', 0, 1, [makeStore('a'), { kind: 'create-index', store: 'a', index: index('byX') }]),
    step('second', 1, 2, [{ kind: 'create-index', store: 'a', index: index('byZ') }]),
  ]);

  assert.ok(backfill.some((issue) => issue.includes('missing store')));
  assert.ok(unknownStore.some((issue) => issue.includes('missing store')));
  assert.ok(duplicate.some((issue) => issue.includes('creates index "byX" on store "a" twice')));
  assert.deepEqual(acrossSteps, []);
});

test('validateMigrationPlan treats deletes of missing stores as warnings only', () => {
  const missing = validateMigrationPlan([step('first', 0, 1, [{ kind: 'delete-store', store: 'ghost' }])]);

  assert.deepEqual(missing, ['warning: step "first" deletes missing object store "ghost"']);

  const removed = validateMigrationPlan([
    step('first', 0, 1, [
      makeStore('a'),
      { kind: 'create-index', store: 'a', index: index('byX') },
      { kind: 'delete-store', store: 'a' },
    ]),
    step('second', 1, 2, [{ kind: 'create-index', store: 'a', index: index('byY') }]),
  ]);

  assert.ok(removed.some((issue) => issue.includes('missing store "a"')));
});

test('deleting a created store frees its name for a later create-store', () => {
  const issues = validateMigrationPlan([
    step('first', 0, 1, [makeStore('a'), { kind: 'delete-store', store: 'a' }]),
    step('second', 1, 2, [makeStore('a')]),
  ]);

  assert.deepEqual(issues, []);
});

test('migrationPathTo returns the v1 step for a fresh database and nothing when current', () => {
  assert.deepEqual(migrationPathTo(0), [SCHEMA_MIGRATIONS[0]]);
  assert.deepEqual(migrationPathTo(1), []);
});

test('migrationPathTo rejects versions beyond the plan head and malformed versions', () => {
  assertValidationFailure(() => migrationPathTo(2));
  assertValidationFailure(() => migrationPathTo(-1));
  assertValidationFailure(() => migrationPathTo(0.5));
});

test('migrationPathTo requires a contiguous walk over custom plans', () => {
  const plan = [step('a', 0, 1), step('b', 2, 3)];

  assertValidationFailure(() => migrationPathTo(0, plan));
  assertValidationFailure(() => migrationPathTo(1, plan));
  assert.deepEqual(migrationPathTo(2, plan), [step('b', 2, 3)]);
});
