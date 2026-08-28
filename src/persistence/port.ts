// Minimal persistence port shared by the in-memory backing and the
// future IndexedDB adapter (docs/design-v1.md §9.5). PortKey values are
// normalized to stable string ids via portKeyToId, and every store name
// must be one of the SCHEMA_V1 stores. Implementations rethrow raw
// storage errors as-is: PersistenceError normalization is the DAO's job.

import { STORE_NAMES } from './schema.ts';

export type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

export type PortKey = string | number | readonly (string | number)[];

export function portKeyToId(key: PortKey): string {
  if (typeof key === 'string' || typeof key === 'number') {
    return JSON.stringify(String(key));
  }
  return JSON.stringify([...key]);
}

export interface PersistencePort {
  get<T>(store: StoreName, key: PortKey): Promise<T | undefined>;
  list<T>(store: StoreName): Promise<T[]>;
  put<T>(store: StoreName, key: PortKey, value: T): Promise<void>;
  putMany<T>(store: StoreName, entries: readonly (readonly [PortKey, T])[]): Promise<void>;
  delete(store: StoreName, key: PortKey): Promise<void>;
  deleteMany(store: StoreName, keys: readonly PortKey[]): Promise<void>;
  clear(store: StoreName): Promise<void>;
}
