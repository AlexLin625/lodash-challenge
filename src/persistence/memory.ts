// In-memory PersistencePort implementation backing DAO tests and any
// environment without IndexedDB (docs/design-v1.md §9.5). Values are
// structured-cloned on store and retrieval so callers never alias
// records inside the port. list follows insertion order; re-putting an
// existing key keeps its original position.

import { PersistenceError } from './errors.ts';
import { portKeyToId } from './port.ts';
import type { PersistencePort, PortKey, StoreName } from './port.ts';
import { STORE_NAMES } from './schema.ts';

interface MemoryEntry {
  key: PortKey;
  value: unknown;
}

const VALID_STORES: ReadonlySet<string> = new Set<string>(Object.values(STORE_NAMES));

function assertStore(store: string): void {
  if (!VALID_STORES.has(store)) {
    throw new PersistenceError('validation', `unknown object store "${store}"`);
  }
}

export function createMemoryPort(): PersistencePort {
  const stores = new Map<StoreName, Map<string, MemoryEntry>>();

  function readEntries(store: StoreName): Map<string, MemoryEntry> | undefined {
    assertStore(store);
    return stores.get(store);
  }

  function writeEntries(store: StoreName): Map<string, MemoryEntry> {
    assertStore(store);
    let entries = stores.get(store);
    if (entries === undefined) {
      entries = new Map<string, MemoryEntry>();
      stores.set(store, entries);
    }
    return entries;
  }

  return {
    async get<T>(store: StoreName, key: PortKey): Promise<T | undefined> {
      const entry = readEntries(store)?.get(portKeyToId(key));
      if (entry === undefined) {
        return undefined;
      }
      return structuredClone(entry.value) as T;
    },

    async list<T>(store: StoreName): Promise<T[]> {
      const entries = readEntries(store);
      if (entries === undefined) {
        return [];
      }
      return [...entries.values()].map((entry) => structuredClone(entry.value) as T);
    },

    async put<T>(store: StoreName, key: PortKey, value: T): Promise<void> {
      writeEntries(store).set(portKeyToId(key), { key, value: structuredClone(value) });
    },

    async putMany<T>(
      store: StoreName,
      items: readonly (readonly [PortKey, T])[]
    ): Promise<void> {
      const entries = writeEntries(store);
      for (const [key, value] of items) {
        entries.set(portKeyToId(key), { key, value: structuredClone(value) });
      }
    },

    async delete(store: StoreName, key: PortKey): Promise<void> {
      readEntries(store)?.delete(portKeyToId(key));
    },

    async deleteMany(store: StoreName, keys: readonly PortKey[]): Promise<void> {
      const entries = readEntries(store);
      if (entries === undefined) {
        return;
      }
      for (const key of keys) {
        entries.delete(portKeyToId(key));
      }
    },

    async clear(store: StoreName): Promise<void> {
      readEntries(store)?.clear();
    },
  };
}
