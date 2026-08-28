// IndexedDB adapter for the PersistencePort contract (docs/design-v1.md §9).
// memory.ts remains the deterministic test backing; this file is the thin
// runtime mapping: one transaction per call, all-or-nothing batches, raw
// failures normalized through errors.ts. Blocked upgrades reject instead of
// waiting, so a stale tab can never freeze first paint (§8.5 stability).

import { normalizePersistenceError, PersistenceError, storageUnavailableError } from './errors.ts';
import type { PersistencePort, PortKey, StoreName } from './port.ts';
import type { IndexDescriptor, ObjectStoreDescriptor } from './schema.ts';
import { DATABASE_NAME, DATABASE_VERSION, findStoreDescriptor, SCHEMA_V1 } from './schema.ts';

// Structural injection surface: the exact subset of the DOM IDB* types this
// module calls, so a node-side fake can drive the same code path as a real
// browser database. Stand-ins enter through openChallengeDatabase({factory})
// and createIDBPersistencePort(db); each funnel converges in one cast.
export interface IndexedDBErrorLike {
  readonly name: string;
  readonly message: string;
}

export interface IndexedDBEventLike {
  preventDefault(): void;
}

export interface IndexedDBVersionChangeEventLike extends IndexedDBEventLike {
  readonly oldVersion: number;
}

export interface IndexedDBStringListLike {
  readonly length: number;
  contains(name: string): boolean;
}

export interface IndexedDBRequestLike<TResult = unknown> {
  result: TResult;
  error: IndexedDBErrorLike | null;
  onsuccess: ((event: IndexedDBEventLike) => void) | null;
  onerror: ((event: IndexedDBEventLike) => void) | null;
}

export interface IndexedDBObjectStoreOptionsLike {
  keyPath?: string | readonly string[];
  autoIncrement?: boolean;
}

export interface IndexedDBIndexOptionsLike {
  unique?: boolean;
}

export interface IndexedDBObjectStoreLike {
  readonly indexNames: IndexedDBStringListLike;
  createIndex(
    name: string,
    keyPath: string | readonly string[],
    options?: IndexedDBIndexOptionsLike
  ): unknown;
  get(query: IDBValidKey): IndexedDBRequestLike<unknown>;
  getAll(): IndexedDBRequestLike<readonly unknown[]>;
  put(value: unknown, key?: IDBValidKey): IndexedDBRequestLike<unknown>;
  delete(query: IDBValidKey): IndexedDBRequestLike<unknown>;
  clear(): IndexedDBRequestLike<unknown>;
}

export interface IndexedDBTransactionLike {
  error: IndexedDBErrorLike | null;
  objectStore(name: string): IndexedDBObjectStoreLike;
  abort(): void;
  oncomplete: ((event: IndexedDBEventLike) => void) | null;
  onerror: ((event: IndexedDBEventLike) => void) | null;
  onabort: ((event: IndexedDBEventLike) => void) | null;
}

export interface IndexedDBDatabaseLike {
  name: string;
  version: number;
  readonly objectStoreNames: IndexedDBStringListLike;
  onversionchange: ((event: IndexedDBEventLike) => void) | null;
  close(): void;
  createObjectStore(
    name: string,
    options?: IndexedDBObjectStoreOptionsLike
  ): IndexedDBObjectStoreLike;
  transaction(
    storeNames: string | readonly string[],
    mode?: 'readonly' | 'readwrite' | 'versionchange'
  ): IndexedDBTransactionLike;
}

export interface IndexedDBOpenDBRequestLike {
  result: IndexedDBDatabaseLike;
  transaction: IndexedDBTransactionLike | null;
  error: IndexedDBErrorLike | null;
  onsuccess: ((event: IndexedDBEventLike) => void) | null;
  onerror: ((event: IndexedDBEventLike) => void) | null;
  onblocked: ((event: IndexedDBEventLike) => void) | null;
  onupgradeneeded: ((event: IndexedDBVersionChangeEventLike) => void) | null;
}

export interface IndexedDBFactoryLike {
  open(name: string, version?: number): IndexedDBOpenDBRequestLike;
}

export interface OpenChallengeDatabaseOptions {
  /** Stand-in for globalThis.indexedDB; defaults to the ambient factory. */
  factory?: IndexedDBFactoryLike;
}

export function isIndexedDBAvailable(): boolean {
  try {
    return typeof globalThis.indexedDB !== 'undefined' && globalThis.indexedDB !== null;
  } catch {
    return false;
  }
}

export function toIdbKey(key: PortKey): IDBValidKey {
  if (typeof key === 'string' || typeof key === 'number') {
    return key;
  }
  const copy = [...key];
  if (copy.length === 0) {
    throw new PersistenceError('validation', 'IndexedDB keys must have at least one component');
  }
  return copy;
}

export function storeDescriptor(name: StoreName): ObjectStoreDescriptor {
  const descriptor = findStoreDescriptor(name);
  if (descriptor === undefined) {
    throw new PersistenceError('validation', `unknown object store "${name}"`);
  }
  return descriptor;
}

export interface UpgradePlan {
  createStore: ObjectStoreDescriptor[];
  createIndex: { store: string; index: IndexDescriptor }[];
}

// Pure migration core (docs/design-v1.md §9.5): given the live database
// state as a map from store name to existing index names, derive the
// createObjectStore/createIndex calls an upgradeneeded handler must run.
export function planUpgrade(
  existing: ReadonlyMap<string, ReadonlySet<string>>,
  desired: readonly ObjectStoreDescriptor[]
): UpgradePlan {
  const plan: UpgradePlan = { createStore: [], createIndex: [] };
  for (const store of desired) {
    const indexNames = existing.get(store.name);
    if (indexNames === undefined) {
      plan.createStore.push(store);
      for (const index of store.indexes) {
        plan.createIndex.push({ store: store.name, index });
      }
      continue;
    }
    for (const index of store.indexes) {
      if (!indexNames.has(index.name)) {
        plan.createIndex.push({ store: store.name, index });
      }
    }
  }
  return plan;
}

function toIdbKeyPath(keyPath: string | readonly string[]): string | string[] {
  return typeof keyPath === 'string' ? keyPath : [...keyPath];
}

function usesInlineKeys(descriptor: ObjectStoreDescriptor): boolean {
  return typeof descriptor.keyPath === 'string'
    ? descriptor.keyPath !== ''
    : descriptor.keyPath.length > 0;
}

// Stores with a compound in-line keyPath are addressed by the tuple read
// off the record; port callers pass exactly that tuple (keys.
// toChallengeKeyTuple), so lookups go straight to IndexedDB unchanged.

export async function openChallengeDatabase(
  options: OpenChallengeDatabaseOptions = {}
): Promise<IDBDatabase> {
  if (options.factory === undefined && !isIndexedDBAvailable()) {
    throw storageUnavailableError();
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    try {
      // One-line cast: the factory default is the real IDBFactory, and an
      // injected IndexedDBFactoryLike only ever occupies open() below.
      const factory = (options.factory ?? globalThis.indexedDB) as IDBFactory;
      const request = factory.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        const upgrade = request.transaction;
        if (upgrade === null) {
          return;
        }
        const existing = new Map<string, ReadonlySet<string>>();
        for (const storeName of db.objectStoreNames) {
          existing.set(storeName, new Set(upgrade.objectStore(storeName).indexNames));
        }
        const plan = planUpgrade(existing, SCHEMA_V1);
        for (const store of plan.createStore) {
          db.createObjectStore(store.name, {
            keyPath: toIdbKeyPath(store.keyPath),
            autoIncrement: store.autoIncrement,
          });
        }
        for (const op of plan.createIndex) {
          upgrade
            .objectStore(op.store)
            .createIndex(op.index.name, toIdbKeyPath(op.index.keyPath), {
              unique: op.index.unique,
            });
        }
      };

      // MVP choice: an onblocked upgrade means another tab holds an old
      // version; waiting would hang boot, so fail fast (§8.5) and let the
      // DAO surface a storage-unavailable notice.
      request.onblocked = () => {
        reject(
          new PersistenceError(
            'storage-unavailable',
            `${DATABASE_NAME} upgrade blocked by another open tab`
          )
        );
      };

      request.onerror = () => {
        reject(
          normalizePersistenceError(
            request.error ?? new Error(`Failed to open ${DATABASE_NAME}`)
          )
        );
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
        };
        resolve(db);
      };
    } catch (error) {
      reject(normalizePersistenceError(error));
    }
  });
}

export function createIDBPersistencePort(
  db?:
    | IDBDatabase
    | Promise<IDBDatabase>
    | IndexedDBDatabaseLike
    | Promise<IndexedDBDatabaseLike>
): PersistencePort {
  // One-line cast: a structural stand-in only ever occupies the IDBDatabase
  // members this port touches, so real and fake databases share one path.
  const asNativeDatabase = (database: IDBDatabase | IndexedDBDatabaseLike): IDBDatabase =>
    database as IDBDatabase;
  const injected =
    db === undefined
      ? null
      : Promise.resolve(db).then(asNativeDatabase, (error: unknown) => {
          throw normalizePersistenceError(error);
        });
  let opening: Promise<IDBDatabase> | null = null;

  function database(): Promise<IDBDatabase> {
    if (injected !== null) {
      return injected;
    }
    if (opening === null) {
      opening = openChallengeDatabase().catch((error: unknown) => {
        opening = null;
        throw error;
      });
    }
    return opening;
  }

  function sendRequest<T>(request: IDBRequest<T>, transaction: IDBTransaction): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = (event) => {
        event.preventDefault();
        reject(
          normalizePersistenceError(
            transaction.error ?? request.error ?? new Error('IndexedDB request failed')
          )
        );
      };
    });
  }

  function execute<T>(
    store: StoreName,
    mode: IDBTransactionMode,
    run: (objectStore: IDBObjectStore, transaction: IDBTransaction) => Promise<T>
  ): Promise<T> {
    const descriptor = storeDescriptor(store);
    return database().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          let transaction: IDBTransaction;
          try {
            transaction = db.transaction(descriptor.name, mode);
          } catch (error) {
            reject(normalizePersistenceError(error));
            return;
          }
          let settled = false;
          let result: T | undefined;
          const failTransaction = () => {
            if (settled) {
              return;
            }
            settled = true;
            reject(
              normalizePersistenceError(
                transaction.error ??
                  new Error(`IndexedDB ${descriptor.name} transaction failed`)
              )
            );
          };
          transaction.oncomplete = () => {
            if (settled) {
              return;
            }
            settled = true;
            resolve(result as T);
          };
          transaction.onerror = (event) => {
            event.preventDefault();
            failTransaction();
          };
          transaction.onabort = (event) => {
            event.preventDefault();
            failTransaction();
          };
          run(transaction.objectStore(descriptor.name), transaction).then(
            (value) => {
              result = value;
            },
            (error: unknown) => {
              if (!settled) {
                settled = true;
                reject(normalizePersistenceError(error));
              }
              try {
                transaction.abort();
              } catch {
                // already finished; the rejection above stands
              }
            }
          );
        })
    );
  }

  return {
    async get<T>(store: StoreName, key: PortKey): Promise<T | undefined> {
      const idbKey = toIdbKey(key);
      return execute(store, 'readonly', (objectStore, transaction) =>
        sendRequest<T | undefined>(objectStore.get(idbKey), transaction)
      );
    },

    async list<T>(store: StoreName): Promise<T[]> {
      return execute(store, 'readonly', (objectStore, transaction) =>
        sendRequest<T[]>(objectStore.getAll(), transaction)
      );
    },

    async put<T>(store: StoreName, key: PortKey, value: T): Promise<void> {
      const idbKey = toIdbKey(key);
      // IndexedDB throws DataError when a put() combines an in-line key
      // path with an explicit key argument, so the record's own keyPath
      // wins and the port key is only forwarded to out-of-line stores.
      const inline = usesInlineKeys(storeDescriptor(store));
      await execute(store, 'readwrite', (objectStore, transaction) =>
        sendRequest(
          inline ? objectStore.put(value) : objectStore.put(value, idbKey),
          transaction
        )
      );
    },

    async putMany<T>(
      store: StoreName,
      entries: readonly (readonly [PortKey, T])[]
    ): Promise<void> {
      const prepared = entries.map(([key, value]) => [toIdbKey(key), value] as const);
      const inline = usesInlineKeys(storeDescriptor(store));
      await execute(store, 'readwrite', async (objectStore, transaction) => {
        for (const [idbKey, value] of prepared) {
          await sendRequest(
            inline ? objectStore.put(value) : objectStore.put(value, idbKey),
            transaction
          );
        }
      });
    },

    async delete(store: StoreName, key: PortKey): Promise<void> {
      const idbKey = toIdbKey(key);
      await execute(store, 'readwrite', (objectStore, transaction) =>
        sendRequest(objectStore.delete(idbKey), transaction)
      );
    },

    async deleteMany(store: StoreName, keys: readonly PortKey[]): Promise<void> {
      const idbKeys = keys.map(toIdbKey);
      await execute(store, 'readwrite', async (objectStore, transaction) => {
        for (const idbKey of idbKeys) {
          await sendRequest(objectStore.delete(idbKey), transaction);
        }
      });
    },

    async clear(store: StoreName): Promise<void> {
      await execute(store, 'readwrite', (objectStore, transaction) =>
        sendRequest(objectStore.clear(), transaction)
      );
    },
  };
}
