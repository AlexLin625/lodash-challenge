// Declarative IndexedDB schema for the persistence layer.
//
// The DAO migration (docs/design-v1.md §9) consumes SCHEMA_V1 to create
// object stores and indexes. validateSchema is a pure structural check
// so malformed descriptors fail fast without touching any IDB API.

export const DATABASE_NAME = 'lodash-challenge';
export const DATABASE_VERSION = 1;

export interface IndexDescriptor {
  name: string;
  keyPath: string | readonly string[];
  unique: boolean;
}

export interface ObjectStoreDescriptor {
  name: string;
  keyPath: string | readonly string[];
  autoIncrement: boolean;
  indexes: readonly IndexDescriptor[];
}

export const STORE_NAMES = {
  solutions: 'solutions',
  completions: 'completions',
  attempts: 'attempts',
  preferences: 'preferences',
} as const;

export const SCHEMA_V1: readonly ObjectStoreDescriptor[] = [
  {
    name: STORE_NAMES.solutions,
    keyPath: ['challengeId', 'challengeVersion'],
    autoIncrement: false,
    indexes: [{ name: 'byUpdatedAt', keyPath: 'updatedAt', unique: false }],
  },
  {
    name: STORE_NAMES.completions,
    keyPath: ['challengeId', 'challengeVersion'],
    autoIncrement: false,
    indexes: [],
  },
  {
    name: STORE_NAMES.attempts,
    keyPath: 'id',
    autoIncrement: false,
    indexes: [
      { name: 'byChallenge', keyPath: ['challengeId', 'challengeVersion'], unique: false },
      {
        name: 'byChallengeStartedAt',
        keyPath: ['challengeId', 'challengeVersion', 'startedAt'],
        unique: false,
      },
    ],
  },
  {
    name: STORE_NAMES.preferences,
    keyPath: 'key',
    autoIncrement: false,
    indexes: [],
  },
];

export function findStoreDescriptor(
  name: string,
  schema: readonly ObjectStoreDescriptor[] = SCHEMA_V1
): ObjectStoreDescriptor | undefined {
  return schema.find((store) => store.name === name);
}

export function validateSchema(schema: readonly ObjectStoreDescriptor[]): string[] {
  const issues: string[] = [];

  if (schema.length === 0) {
    issues.push('schema declares no object stores');
  }

  const seenStores = new Set<string>();

  for (const store of schema) {
    if (store.name === '') {
      issues.push('object store has an empty name');
    } else if (seenStores.has(store.name)) {
      issues.push(`duplicate object store name "${store.name}"`);
    } else {
      seenStores.add(store.name);
    }

    validateKeyPath(store.keyPath, `object store "${store.name}"`, issues);

    const seenIndexes = new Set<string>();

    for (const index of store.indexes) {
      if (index.name === '') {
        issues.push(`index with an empty name in object store "${store.name}"`);
      } else if (seenIndexes.has(index.name)) {
        issues.push(`duplicate index name "${index.name}" in object store "${store.name}"`);
      } else {
        seenIndexes.add(index.name);
      }

      validateKeyPath(index.keyPath, `index "${index.name}" in object store "${store.name}"`, issues);
    }
  }

  return issues;
}

function validateKeyPath(keyPath: string | readonly string[], context: string, issues: string[]): void {
  if (typeof keyPath === 'string') {
    if (keyPath === '') {
      issues.push(`${context} has an empty keyPath`);
    }
    return;
  }

  if (keyPath.length === 0) {
    issues.push(`${context} has an empty keyPath array`);
  } else if (keyPath.some((part) => part === '')) {
    issues.push(`${context} has a keyPath array containing an empty string`);
  }
}
