// App-level persistence bootstrap (docs/design-v1.md §9, §10).
//
// Wires a PersistencePort to the ProgressDAO (§9.5) and the flushable
// workspace progress seam (§10), and owns the preferences read/write path
// (§9.4). When no port is injected, the IndexedDB adapter from idb-port.ts
// backs a browser with indexedDB; otherwise the memory port keeps a
// deterministic always-success bootstrap. This is still an interim
// assembly: the App root does not consume it yet, and storage notices fire
// only when a layer reports a 'storage-unavailable' PersistenceError.

import type { ProgressSeam } from '../workspace/progress.ts';
import { createProgressDAO } from './dao.ts';
import type { ProgressDAO } from './dao.ts';
import type { PreferenceRecord } from './domain.ts';
import { normalizePersistenceError } from './errors.ts';
import type { PersistenceError } from './errors.ts';
import { createIDBPersistencePort, isIndexedDBAvailable, openChallengeDatabase } from './idb-port.ts';
import { createMemoryPort } from './memory.ts';
import type { PersistencePort } from './port.ts';
import { parsePreferences, serializePreferences } from './preferences.ts';
import type { PreferencesState } from './preferences.ts';
import { STORE_NAMES } from './schema.ts';
import { createWorkspaceProgressService } from './workspace-service.ts';

export interface PersistenceBootstrap {
  port: PersistencePort;
  dao: ProgressDAO;
  progress: ProgressSeam & { flush(): Promise<void> };
  storageAvailable: boolean;
  onStorageUnavailable(listener: () => void): () => void;
  loadPreferences(): Promise<PreferencesState>;
  savePreferences(state: Partial<PreferencesState>): Promise<void>;
}

export interface PersistenceBootstrapDeps {
  /** Fully overrides port selection; memory.ts and idb-port.ts both qualify. */
  port?: PersistencePort;
  clock?: () => number;
  openChallengeDatabase?: () => Promise<IDBDatabase>;
  maxAttemptsPerChallenge?: number;
}

function selectPort(deps: PersistenceBootstrapDeps): PersistencePort {
  if (deps.port !== undefined) {
    return deps.port;
  }
  if (!isIndexedDBAvailable()) {
    return createMemoryPort();
  }
  const opener = deps.openChallengeDatabase ?? openChallengeDatabase;
  return createIDBPersistencePort(opener());
}

export function createPersistence(
  deps: PersistenceBootstrapDeps = {}
): PersistenceBootstrap {
  const clock = deps.clock ?? Date.now;
  const port = selectPort(deps);
  const dao = createProgressDAO(port, { now: clock }, deps.maxAttemptsPerChallenge);

  const listeners = new Set<() => void>();
  let storageAvailable = true;

  function notifyStorageUnavailable(): void {
    if (!storageAvailable) {
      return;
    }
    storageAvailable = false;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A broken listener must never break the notification loop.
      }
    }
  }

  function observeError(error: unknown): PersistenceError {
    const normalized = normalizePersistenceError(error);
    if (normalized.code === 'storage-unavailable') {
      notifyStorageUnavailable();
    }
    return normalized;
  }

  const progress = createWorkspaceProgressService({
    dao,
    clock,
    onError: observeError,
  });

  return {
    port,
    dao,
    progress,
    get storageAvailable(): boolean {
      return storageAvailable;
    },
    onStorageUnavailable(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async loadPreferences(): Promise<PreferencesState> {
      try {
        const records = await port.list<PreferenceRecord>(STORE_NAMES.preferences);
        return parsePreferences(records);
      } catch (error) {
        throw observeError(error);
      }
    },
    async savePreferences(state: Partial<PreferencesState>): Promise<void> {
      try {
        // Incremental overlay keyed by record.key: unsubmitted keys (and any
        // records a future schema adds) survive untouched (§9.4).
        const entries = serializePreferences(state).map(
          (record) => [record.key, record] as const
        );
        await port.putMany(STORE_NAMES.preferences, entries);
      } catch (error) {
        throw observeError(error);
      }
    },
  };
}
