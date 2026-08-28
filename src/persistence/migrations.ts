// Declarative schema migration plan for the IndexedDB persistence layer.
//
// The actual upgradeneeded execution belongs to a later IDB port slice
// (docs/design-v1.md §9.5); this module only offers a consumable plan
// description plus pure invariant checks over it.

import type { IndexDescriptor, ObjectStoreDescriptor } from './schema.ts';
import { SCHEMA_V1 } from './schema.ts';
import { PersistenceError } from './errors.ts';

export interface CreateStoreOp {
  kind: 'create-store';
  store: ObjectStoreDescriptor;
}

export interface CreateIndexOp {
  kind: 'create-index';
  store: string;
  index: IndexDescriptor;
}

export interface DeleteStoreOp {
  kind: 'delete-store';
  store: string;
}

export type MigrationOp = CreateStoreOp | CreateIndexOp | DeleteStoreOp;

export interface MigrationStep {
  from: number;
  to: number;
  name: string;
  ops: readonly MigrationOp[];
}

export const SCHEMA_MIGRATIONS: readonly MigrationStep[] = [
  {
    from: 0,
    to: 1,
    name: 'v1-initial-schema',
    ops: SCHEMA_V1.map((store) => ({ kind: 'create-store' as const, store })),
  },
];

export function currentSchemaVersion(steps: readonly MigrationStep[]): number {
  const last = steps[steps.length - 1];
  return last === undefined ? 0 : last.to;
}

export function validateMigrationPlan(steps: readonly MigrationStep[]): string[] {
  const issues: string[] = [];

  if (steps.length === 0) {
    issues.push('empty migration plan');
    return issues;
  }

  const existingStores = new Set<string>();
  let expectedFrom = 0;

  for (const step of steps) {
    validateStepVersions(step, issues);

    if (step.from !== expectedFrom) {
      issues.push(`step "${step.name}" starts at ${step.from} but expected ${expectedFrom}`);
    }
    expectedFrom = step.to;

    validateStepOps(step, existingStores, issues);
  }

  return issues;
}

function validateStepVersions(step: MigrationStep, issues: string[]): void {
  if (!Number.isInteger(step.from) || step.from < 0) {
    issues.push(`step "${step.name}" has a non-positive-integer from version ${step.from}`);
  }
  if (!Number.isInteger(step.to) || step.to <= step.from) {
    issues.push(`step "${step.name}" has a from/to range that is not strictly increasing`);
  }
}

function validateStepOps(
  step: MigrationStep,
  existingStores: Set<string>,
  issues: string[]
): void {
  const seenStoreNames = new Set<string>();
  const seenIndexNames = new Map<string, Set<string>>();

  for (const op of step.ops) {
    switch (op.kind) {
      case 'create-store': {
        if (seenStoreNames.has(op.store.name)) {
          issues.push(`step "${step.name}" creates object store "${op.store.name}" twice`);
        } else if (existingStores.has(op.store.name)) {
          issues.push(`step "${step.name}" recreates existing object store "${op.store.name}"`);
        } else {
          seenStoreNames.add(op.store.name);
          existingStores.add(op.store.name);
        }
        break;
      }
      case 'create-index': {
        const targetStores = seenIndexNames.get(op.store) ?? new Set<string>();
        seenIndexNames.set(op.store, targetStores);
        if (targetStores.has(op.index.name)) {
          issues.push(
            `step "${step.name}" creates index "${op.index.name}" on store "${op.store}" twice`
          );
        } else if (!existingStores.has(op.store)) {
          issues.push(
            `step "${step.name}" creates index "${op.index.name}" on missing store "${op.store}"`
          );
        } else {
          targetStores.add(op.index.name);
        }
        break;
      }
      case 'delete-store': {
        if (!existingStores.has(op.store)) {
          issues.push(
            `warning: step "${step.name}" deletes missing object store "${op.store}"`
          );
        } else {
          existingStores.delete(op.store);
        }
        break;
      }
    }
  }
}

// upgrade the installed schema version to the latest version in the plan
export function migrationPathTo(
  version: number,
  steps: readonly MigrationStep[] = SCHEMA_MIGRATIONS
): MigrationStep[] {
  if (!Number.isInteger(version) || version < 0) {
    throw new PersistenceError(
      'validation',
      `installed schema version ${version} is not a non-negative integer`
    );
  }

  const head = currentSchemaVersion(steps);
  if (version > head) {
    throw new PersistenceError(
      'validation',
      `installed schema version ${version} exceeds latest schema version ${head}`
    );
  }

  const path: MigrationStep[] = [];
  let cursor = version;
  for (const step of steps) {
    if (step.to <= version) {
      continue;
    }
    if (step.from !== cursor) {
      throw new PersistenceError(
        'validation',
        `no contiguous migration path from ${version} to ${head}`
      );
    }
    path.push(step);
    cursor = step.to;
  }

  if (cursor !== head) {
    throw new PersistenceError(
      'validation',
      `no contiguous migration path from ${version} to ${head}`
    );
  }

  return path;
}
