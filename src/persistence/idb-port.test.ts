// Unit tests for the IndexedDB PersistencePort adapter (docs/design-v1.md §9).
// Pure helpers run everywhere; the open/put/get/list/delete/clear
// round-trip needs a real IndexedDB, so it is skipped under node where no
// indexedDB global exists (§8.5 keeps such failures out of persisted data).

import assert from 'node:assert/strict';
import test from 'node:test';
import { makeAttemptId } from './attempts.ts';
import { createProgressDAO } from './dao.ts';
import type { AttemptRecord, ChallengeKey, CompletionRecord } from './domain.ts';
import type { PersistenceErrorCode } from './errors.ts';
import { PersistenceError } from './errors.ts';
import {
  isIndexedDBAvailable,
  openChallengeDatabase,
  planUpgrade,
  storeDescriptor,
  toIdbKey,
  createIDBPersistencePort,
} from './idb-port.ts';
import type {
  IndexedDBDatabaseLike,
  IndexedDBErrorLike,
  IndexedDBEventLike,
  IndexedDBFactoryLike,
  IndexedDBIndexOptionsLike,
  IndexedDBObjectStoreOptionsLike,
  IndexedDBObjectStoreLike,
  IndexedDBOpenDBRequestLike,
  IndexedDBRequestLike,
  IndexedDBStringListLike,
  IndexedDBTransactionLike,
} from './idb-port.ts';
import { toChallengeKeyTuple } from './keys.ts';
import { createMemoryPort } from './memory.ts';
import type { PersistencePort, StoreName } from './port.ts';
import { DATABASE_NAME, DATABASE_VERSION, SCHEMA_V1, STORE_NAMES } from './schema.ts';

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

// ---------------------------------------------------------------------------
// FakeIDB harness: a plain-Map stand-in for IndexedDB implementing the
// structural types exported by idb-port.ts, with in-line keyPath semantics.
// put() derives each record's key from the value via the store's keyPath, so
// the four SCHEMA_V1 stores behave like a real browser database and every
// adapter path (requests, transactions, upgrades) runs under node.

// FakeKey is the full IDBValidKey surface so the fake is a drop-in for the
// structural types; the tests only ever exercise string and tuple keys.
type FakeKey = IDBValidKey;

interface FakeStoredRecord {
  key: FakeKey;
  value: unknown;
}

interface FakeStoreData {
  keyPath: string | readonly string[] | null;
  autoIncrement: boolean;
  records: Map<string, FakeStoredRecord>;
  indexes: Map<string, { keyPath: string | readonly string[]; unique: boolean }>;
}

const fakeEvent: IndexedDBEventLike = {
  preventDefault(): void {
    /* the port only marks IDB error events as handled */
  },
};

function fakeDomError(name: string, message: string): DOMException {
  return new DOMException(message, name);
}

function fakeKeyId(key: FakeKey): string {
  return JSON.stringify(key);
}

function fakeInlineKey(store: FakeStoreData, value: unknown): FakeKey {
  if (store.keyPath === null) {
    throw fakeDomError('DataError', 'store uses out-of-line keys');
  }
  const parts = typeof store.keyPath === 'string' ? [store.keyPath] : store.keyPath;
  const record = (value ?? {}) as Record<string, unknown>;
  const components: unknown[] = parts.map((part) => record[part]);
  if (components.some((part) => typeof part !== 'string' && typeof part !== 'number')) {
    throw fakeDomError('DataError', 'value carries no valid in-line key');
  }
  return (typeof store.keyPath === 'string' ? components[0] : components) as FakeKey;
}

function persistenceFailure(code: PersistenceErrorCode): (error: unknown) => boolean {
  return (error: unknown) => error instanceof PersistenceError && error.code === code;
}

class FakeStringList implements IndexedDBStringListLike {
  readonly names: readonly string[];

  constructor(names: readonly string[]) {
    this.names = names;
  }

  get length(): number {
    return this.names.length;
  }

  contains(name: string): boolean {
    return this.names.includes(name);
  }

  *[Symbol.iterator](): Generator<string> {
    yield* this.names;
  }
}

class FakeRequest<T> implements IndexedDBRequestLike<T> {
  result!: T;
  error: IndexedDBErrorLike | null = null;
  onsuccess: ((event: IndexedDBEventLike) => void) | null = null;
  onerror: ((event: IndexedDBEventLike) => void) | null = null;
}

class FakeTransaction implements IndexedDBTransactionLike {
  error: IndexedDBErrorLike | null = null;
  oncomplete: ((event: IndexedDBEventLike) => void) | null = null;
  onerror: ((event: IndexedDBEventLike) => void) | null = null;
  onabort: ((event: IndexedDBEventLike) => void) | null = null;

  readonly db: FakeDatabase;
  readonly mode: 'readonly' | 'readwrite' | 'versionchange';
  readonly storeNames: readonly string[];

  private readonly views = new Map<string, FakeStoreData>();
  private pending = 0;
  private failed = false;
  private finished = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    db: FakeDatabase,
    mode: 'readonly' | 'readwrite' | 'versionchange',
    storeNames: readonly string[]
  ) {
    this.db = db;
    this.mode = mode;
    this.storeNames = storeNames;
    // A request-less transaction still auto-commits on the next turn, which
    // mirrors IndexedDB closing an untouched transaction at task end.
    queueMicrotask(() => this.settle());
  }

  viewOf(name: string): FakeStoreData {
    if (this.finished || this.failed) {
      throw fakeDomError('TransactionInactiveError', 'transaction is already finished');
    }
    if (this.mode !== 'versionchange' && !this.storeNames.includes(name)) {
      throw fakeDomError('NotFoundError', `transaction excludes object store "${name}"`);
    }
    let view = this.views.get(name);
    if (view === undefined) {
      const committed = this.db.stores.get(name);
      if (committed === undefined) {
        throw fakeDomError('NotFoundError', `object store "${name}" does not exist`);
      }
      view = {
        keyPath: committed.keyPath,
        autoIncrement: committed.autoIncrement,
        indexes: committed.indexes,
        // Readwrite transactions stage writes in a snapshot and swap the
        // committed record map in on completion; a failed swap never runs.
        records: this.mode === 'readwrite' ? new Map(committed.records) : committed.records,
      };
      this.views.set(name, view);
    }
    return view;
  }

  objectStore(name: string): IndexedDBObjectStoreLike {
    return new FakeObjectStore(this, name);
  }

  abort(): void {
    this.fail(this.error ?? fakeDomError('AbortError', 'transaction aborted'));
  }

  fail(error: IndexedDBErrorLike): void {
    if (this.failed || this.finished) {
      return;
    }
    this.failed = true;
    this.error = error;
    this.pending = 0;
    this.settle();
  }

  begin(): void {
    this.pending += 1;
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }

  end(): void {
    this.pending -= 1;
    this.settle();
  }

  close(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    this.finished = true;
  }

  private settle(): void {
    if (this.finished || this.failed || this.pending > 0 || this.settleTimer !== null) {
      return;
    }
    // A timer (not a microtask) so the port can queue its next request in the
    // same await chain before the transaction auto-commits, and so a failed
    // request's synchronous abort wins the race against completion.
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (this.finished || this.failed || this.pending > 0) {
        return;
      }
      this.finished = true;
      if (this.error !== null) {
        this.onerror?.(fakeEvent);
        this.onabort?.(fakeEvent);
        return;
      }
      if (this.mode === 'readwrite') {
        for (const [name, view] of this.views) {
          const committed = this.db.stores.get(name);
          if (committed !== undefined) {
            committed.records = view.records;
          }
        }
      }
      this.oncomplete?.(fakeEvent);
    }, 0);
  }
}

class FakeObjectStore implements IndexedDBObjectStoreLike {
  readonly transaction: FakeTransaction;
  readonly storeName: string;

  constructor(transaction: FakeTransaction, storeName: string) {
    this.transaction = transaction;
    this.storeName = storeName;
  }

  get indexNames(): IndexedDBStringListLike {
    return new FakeStringList([...this.view().indexes.keys()]);
  }

  private view(): FakeStoreData {
    return this.transaction.viewOf(this.storeName);
  }

  createIndex(
    name: string,
    keyPath: string | readonly string[],
    options?: IndexedDBIndexOptionsLike
  ): unknown {
    const data = this.view();
    if (data.indexes.has(name)) {
      throw fakeDomError('ConstraintError', `index "${name}" already exists`);
    }
    data.indexes.set(name, { keyPath, unique: options?.unique === true });
    this.transaction.db.callLog.indexes.push(`${this.storeName}/${name}`);
    return { name };
  }

  get(query: FakeKey): IndexedDBRequestLike<unknown> {
    return this.execute(() => {
      const found = this.view().records.get(fakeKeyId(query));
      return found === undefined ? undefined : structuredClone(found.value);
    });
  }

  getAll(): IndexedDBRequestLike<readonly unknown[]> {
    return this.execute(() =>
      [...this.view().records.values()].map((record) => structuredClone(record.value))
    );
  }

  put(value: unknown, key?: FakeKey): IndexedDBRequestLike<unknown> {
    const data = this.view();
    if (data.keyPath !== null) {
      if (key !== undefined) {
        throw fakeDomError('DataError', 'in-line key stores reject an explicit put key');
      }
      const inline = fakeInlineKey(data, value);
      return this.execute(() => {
        data.records.set(fakeKeyId(inline), { key: inline, value: structuredClone(value) });
        return inline;
      }, true);
    }
    if (key === undefined) {
      throw fakeDomError('DataError', 'out-of-line key stores require a put key');
    }
    return this.execute(() => {
      data.records.set(fakeKeyId(key), { key, value: structuredClone(value) });
      return key;
    }, true);
  }

  delete(query: FakeKey): IndexedDBRequestLike<unknown> {
    return this.execute(() => {
      this.view().records.delete(fakeKeyId(query));
      return undefined;
    }, true);
  }

  clear(): IndexedDBRequestLike<unknown> {
    const data = this.view();
    return this.execute(() => {
      data.records = new Map();
      return undefined;
    }, true);
  }

  private execute<TResult>(action: () => TResult, write = false): FakeRequest<TResult> {
    if (write && this.transaction.mode !== 'readwrite') {
      throw fakeDomError('ReadOnlyError', 'writes need a readwrite transaction');
    }
    const request = new FakeRequest<TResult>();
    const failure = this.transaction.db.takeFailure();
    this.transaction.begin();
    queueMicrotask(() => {
      if (failure !== null) {
        request.error = failure;
        request.onerror?.(fakeEvent);
        this.transaction.fail(failure);
        return;
      }
      try {
        request.result = action();
      } catch (error) {
        const wrapped =
          error instanceof Error || error instanceof DOMException
            ? error
            : fakeDomError('DataError', 'operation failed');
        request.error = wrapped;
        request.onerror?.(fakeEvent);
        this.transaction.fail(wrapped);
        return;
      }
      request.onsuccess?.(fakeEvent);
      this.transaction.end();
    });
    return request;
  }
}

class FakeDatabase implements IndexedDBDatabaseLike {
  readonly stores = new Map<string, FakeStoreData>();
  readonly callLog = {
    stores: [] as string[],
    indexes: [] as string[],
  };
  closed = false;
  onversionchange: ((event: IndexedDBEventLike) => void) | null = null;

  name: string;
  version: number;

  private failure: { remaining: number; error: IndexedDBErrorLike } | null = null;

  constructor(name: string, version = 0) {
    this.name = name;
    this.version = version;
  }

  get objectStoreNames(): IndexedDBStringListLike {
    return new FakeStringList([...this.stores.keys()]);
  }

  /** Makes the nth request created from now on (default: the next one) fail. */
  failNextRequest(error: IndexedDBErrorLike, after = 1): void {
    this.failure = { remaining: after, error };
  }

  takeFailure(): IndexedDBErrorLike | null {
    if (this.failure === null) {
      return null;
    }
    this.failure.remaining -= 1;
    if (this.failure.remaining > 0) {
      return null;
    }
    const { error } = this.failure;
    this.failure = null;
    return error;
  }

  createObjectStore(
    name: string,
    options?: IndexedDBObjectStoreOptionsLike
  ): IndexedDBObjectStoreLike {
    if (this.stores.has(name)) {
      throw fakeDomError('ConstraintError', `object store "${name}" already exists`);
    }
    const keyPath = options?.keyPath ?? null;
    const autoIncrement = options?.autoIncrement === true;
    this.callLog.stores.push(`${name}|${JSON.stringify(keyPath)}`);
    this.stores.set(name, { keyPath, autoIncrement, records: new Map(), indexes: new Map() });
    // The handle rides a throwaway versionchange transaction so upgrade-time
    // mutations (createIndex) hit the committed view immediately.
    return new FakeTransaction(this, 'versionchange', [name]).objectStore(name);
  }

  transaction(
    storeNames: string | readonly string[],
    mode: 'readonly' | 'readwrite' | 'versionchange' = 'readonly'
  ): IndexedDBTransactionLike {
    const names = typeof storeNames === 'string' ? [storeNames] : [...storeNames];
    for (const name of names) {
      if (!this.stores.has(name)) {
        throw fakeDomError('NotFoundError', `object store "${name}" does not exist`);
      }
    }
    return new FakeTransaction(this, mode, names);
  }

  close(): void {
    this.closed = true;
  }
}

class FakeOpenRequest implements IndexedDBOpenDBRequestLike {
  result!: IndexedDBDatabaseLike;
  transaction: IndexedDBTransactionLike | null = null;
  error: IndexedDBErrorLike | null = null;
  onsuccess: ((event: IndexedDBEventLike) => void) | null = null;
  onerror: ((event: IndexedDBEventLike) => void) | null = null;
  onblocked: ((event: IndexedDBEventLike) => void) | null = null;
  onupgradeneeded: ((event: { readonly oldVersion: number } & IndexedDBEventLike) => void) | null =
    null;
}

class FakeFactory implements IndexedDBFactoryLike {
  readonly databases = new Map<string, FakeDatabase>();
  openCount = 0;
  blockMode: 'blocked' | 'error' | null = null;
  lastOldVersion: number | null = null;

  open(name: string, version = DATABASE_VERSION): IndexedDBOpenDBRequestLike {
    this.openCount += 1;
    const request = new FakeOpenRequest();
    if (this.blockMode !== null) {
      const kind = this.blockMode;
      queueMicrotask(() => {
        if (kind === 'blocked') {
          request.onblocked?.(fakeEvent);
        } else {
          request.error = fakeDomError('UnknownError', 'open failed');
          request.onerror?.(fakeEvent);
        }
      });
      return request;
    }
    let database = this.databases.get(name);
    if (database === undefined) {
      database = new FakeDatabase(name, 0);
      this.databases.set(name, database);
    }
    const oldVersion = database.version;
    database.version = version;
    request.result = database;
    const needsUpgrade = oldVersion < version;
    const upgrade = new FakeTransaction(database, 'versionchange', []);
    request.transaction = upgrade;
    queueMicrotask(() => {
      if (needsUpgrade) {
        this.lastOldVersion = oldVersion;
        request.onupgradeneeded?.({ oldVersion, ...fakeEvent });
      }
      upgrade.close();
      request.transaction = null;
      queueMicrotask(() => {
        request.onsuccess?.(fakeEvent);
      });
    });
    return request;
  }
}

async function fakeBackedPort(): Promise<{
  factory: FakeFactory;
  db: FakeDatabase;
  port: PersistencePort;
}> {
  const factory = new FakeFactory();
  const db = await openChallengeDatabase({ factory });
  assert.ok(db instanceof FakeDatabase);
  return { factory, db, port: createIDBPersistencePort(db) };
}

interface DemoSolution {
  challengeId: string;
  challengeVersion: string;
  updatedAt: number;
}

function demoSolution(challengeId: string, challengeVersion: string, updatedAt: number): DemoSolution {
  return { challengeId, challengeVersion, updatedAt };
}

function demoPreference(key: string, value: string | number): { key: string; value: string | number } {
  return { key, value };
}

async function scriptPort(port: PersistencePort): Promise<unknown[]> {
  const seen: unknown[] = [];
  seen.push(await port.get(STORE_NAMES.solutions, ['chunk', 'v1']));
  await port.put(STORE_NAMES.solutions, ['chunk', 'v1'], demoSolution('chunk', 'v1', 1));
  seen.push(await port.get(STORE_NAMES.solutions, ['chunk', 'v1']));
  seen.push(await port.get(STORE_NAMES.solutions, ['chunk', 'v2']));
  await port.putMany(STORE_NAMES.preferences, [
    ['theme', demoPreference('theme', 'dark')],
    ['fontSize', demoPreference('fontSize', 14)],
  ]);
  seen.push(await port.list(STORE_NAMES.preferences));
  seen.push(await port.list(STORE_NAMES.solutions));
  await port.delete(STORE_NAMES.preferences, 'missing');
  await port.deleteMany(STORE_NAMES.preferences, ['fontSize', 'missing']);
  seen.push(await port.list(STORE_NAMES.preferences));
  await port.put(STORE_NAMES.preferences, 'theme', demoPreference('theme', 'light'));
  seen.push(await port.list(STORE_NAMES.preferences));
  await port.clear(STORE_NAMES.solutions);
  seen.push(await port.list(STORE_NAMES.solutions));
  return seen;
}

const scriptedExpectation: unknown[] = [
  undefined,
  demoSolution('chunk', 'v1', 1),
  undefined,
  [demoPreference('theme', 'dark'), demoPreference('fontSize', 14)],
  [demoSolution('chunk', 'v1', 1)],
  [demoPreference('theme', 'dark')],
  [demoPreference('theme', 'light')],
  [],
];

test('fake IDB port reproduces memory port semantics op by op', async () => {
  assert.deepEqual(await scriptPort(createMemoryPort()), scriptedExpectation);
  const { port } = await fakeBackedPort();
  assert.deepEqual(await scriptPort(port), scriptedExpectation);
});

test('fake IDB port returns detached clones and keeps list insertion order', async () => {
  const { port } = await fakeBackedPort();
  const first = demoPreference('theme', 'dark');
  await port.put(STORE_NAMES.preferences, 'theme', first);
  await port.put(STORE_NAMES.preferences, 'fontSize', demoPreference('fontSize', 14));

  const listed = await port.list<typeof first>(STORE_NAMES.preferences);
  assert.deepEqual(listed, [first, demoPreference('fontSize', 14)]);
  assert.notEqual(listed[0], first);
  const got = await port.get<typeof first>(STORE_NAMES.preferences, 'theme');
  assert.notEqual(got, first);
  listed[0].value = 'mutated';
  assert.deepEqual(await port.get(STORE_NAMES.preferences, 'theme'), first);

  await port.put(STORE_NAMES.preferences, 'theme', demoPreference('theme', 'light'));
  assert.deepEqual(await port.list(STORE_NAMES.preferences), [
    demoPreference('theme', 'light'),
    demoPreference('fontSize', 14),
  ]);
});

test('putMany is all-or-nothing: a failed second request aborts the transaction', async () => {
  const { port, db } = await fakeBackedPort();
  db.failNextRequest(fakeDomError('QuotaExceededError', 'disk full'), 2);
  await assert.rejects(
    port.putMany(STORE_NAMES.preferences, [
      ['a', demoPreference('a', 1)],
      ['b', demoPreference('b', 2)],
    ]),
    persistenceFailure('storage-unavailable')
  );
  assert.deepEqual(await port.list(STORE_NAMES.preferences), []);

  await port.putMany(STORE_NAMES.preferences, [
    ['a', demoPreference('a', 1)],
    ['b', demoPreference('b', 2)],
  ]);
  assert.deepEqual(await port.list(STORE_NAMES.preferences), [
    demoPreference('a', 1),
    demoPreference('b', 2),
  ]);
});

test('composite tuple keys address solutions records, scalar preferences by key', async () => {
  const { port } = await fakeBackedPort();
  await port.put(STORE_NAMES.solutions, ['chunk', 'v1'], demoSolution('chunk', 'v1', 1));
  await port.put(STORE_NAMES.solutions, ['chunk', 'v2'], demoSolution('chunk', 'v2', 2));
  assert.deepEqual(await port.get(STORE_NAMES.solutions, ['chunk', 'v1']), demoSolution('chunk', 'v1', 1));
  assert.deepEqual(await port.get(STORE_NAMES.solutions, ['chunk', 'v2']), demoSolution('chunk', 'v2', 2));
  assert.equal(await port.get(STORE_NAMES.solutions, 'chunk'), undefined);
  assert.deepEqual(await port.list(STORE_NAMES.solutions), [
    demoSolution('chunk', 'v1', 1),
    demoSolution('chunk', 'v2', 2),
  ]);
});

test('fake IDB and memory port agree on solutions tuple-key get/put/delete', async () => {
  const { port: idb } = await fakeBackedPort();
  const memory = createMemoryPort();
  const key: ChallengeKey = { challengeId: 'chunk', challengeVersion: 'v1' };
  const tuple = toChallengeKeyTuple(key);
  const first = demoSolution('chunk', 'v1', 1);
  const second = demoSolution('chunk', 'v1', 2);

  assert.deepEqual(await idb.get(STORE_NAMES.solutions, tuple), undefined);
  assert.deepEqual(await memory.get(STORE_NAMES.solutions, tuple), undefined);

  await idb.put(STORE_NAMES.solutions, tuple, first);
  await memory.put(STORE_NAMES.solutions, tuple, first);
  assert.deepEqual(await idb.get(STORE_NAMES.solutions, tuple), first);
  assert.deepEqual(await memory.get(STORE_NAMES.solutions, tuple), first);

  await idb.put(STORE_NAMES.solutions, tuple, second);
  await memory.put(STORE_NAMES.solutions, tuple, second);
  assert.deepEqual(await idb.list(STORE_NAMES.solutions), await memory.list(STORE_NAMES.solutions));

  await idb.delete(STORE_NAMES.solutions, tuple);
  await memory.delete(STORE_NAMES.solutions, tuple);
  assert.deepEqual(await idb.get(STORE_NAMES.solutions, tuple), undefined);
  assert.deepEqual(await memory.get(STORE_NAMES.solutions, tuple), undefined);
  assert.deepEqual(await idb.list(STORE_NAMES.solutions), await memory.list(STORE_NAMES.solutions));
});

test('request and transaction failures normalize to coded PersistenceErrors', async () => {
  const { port, db } = await fakeBackedPort();
  db.failNextRequest(fakeDomError('QuotaExceededError', 'quota'));
  await assert.rejects(
    port.put(STORE_NAMES.preferences, 'theme', demoPreference('theme', 'dark')),
    persistenceFailure('storage-unavailable')
  );
  db.failNextRequest(new Error('disk on fire'));
  await assert.rejects(
    port.get(STORE_NAMES.preferences, 'theme'),
    persistenceFailure('db-error')
  );
  await port.put(STORE_NAMES.preferences, 'theme', demoPreference('theme', 'dark'));
  assert.deepEqual(await port.list(STORE_NAMES.preferences), [demoPreference('theme', 'dark')]);
});

test('openChallengeDatabase({factory}) upgrades a fresh fake database to SCHEMA_V1', async () => {
  const { factory, db } = await fakeBackedPort();
  assert.equal(factory.lastOldVersion, 0);
  assert.equal(db.version, DATABASE_VERSION);
  assert.deepEqual(db.callLog.stores, [
    'solutions|["challengeId","challengeVersion"]',
    'completions|["challengeId","challengeVersion"]',
    'attempts|"id"',
    'preferences|"key"',
  ]);
  assert.deepEqual(db.callLog.indexes, [
    'solutions/byUpdatedAt',
    'attempts/byChallenge',
    'attempts/byChallengeStartedAt',
  ]);
  for (const descriptor of SCHEMA_V1) {
    assert.deepEqual(
      [...(db.stores.get(descriptor.name)?.indexes.keys() ?? [])],
      descriptor.indexes.map((index) => index.name)
    );
  }

  const again = await openChallengeDatabase({ factory });
  assert.equal(again, db);
  assert.equal(factory.openCount, 2);
  assert.equal(db.callLog.stores.length, SCHEMA_V1.length);
  assert.equal(db.callLog.indexes.length, 3);
});

test('a re-run upgrade backfills missing indexes without recreating stores', async () => {
  const factory = new FakeFactory();
  const database = new FakeDatabase(DATABASE_NAME, 0);
  // The attempts store already exists with exactly one of its two indexes.
  database
    .createObjectStore(STORE_NAMES.attempts, { keyPath: 'id' })
    .createIndex('byChallengeStartedAt', ['challengeId', 'challengeVersion', 'startedAt']);
  database.callLog.stores.length = 0;
  database.callLog.indexes.length = 0;
  factory.databases.set(DATABASE_NAME, database);

  const db = await openChallengeDatabase({ factory });
  assert.ok(db instanceof FakeDatabase);
  assert.equal(factory.lastOldVersion, 0);
  assert.deepEqual(db.callLog.stores, [
    'solutions|["challengeId","challengeVersion"]',
    'completions|["challengeId","challengeVersion"]',
    'preferences|"key"',
  ]);
  assert.deepEqual(db.callLog.indexes, ['solutions/byUpdatedAt', 'attempts/byChallenge']);
  assert.deepEqual([...(database.stores.get(STORE_NAMES.attempts)?.indexes.keys() ?? [])], [
    'byChallengeStartedAt',
    'byChallenge',
  ]);
});

test('openChallengeDatabase rejects blocked and failed opens', async () => {
  const blocked = new FakeFactory();
  blocked.blockMode = 'blocked';
  await assert.rejects(
    openChallengeDatabase({ factory: blocked }),
    persistenceFailure('storage-unavailable')
  );

  const errored = new FakeFactory();
  errored.blockMode = 'error';
  await assert.rejects(
    openChallengeDatabase({ factory: errored }),
    persistenceFailure('db-error')
  );
});

test(
  'openChallengeDatabase rejects storage-unavailable when no ambient factory exists',
  { skip: isIndexedDBAvailable() ? 'ambient indexedDB is present' : false },
  async () => {
    await assert.rejects(openChallengeDatabase(), persistenceFailure('storage-unavailable'));
  }
);

test('createIDBPersistencePort accepts structural databases, database promises and rejected promises', async () => {
  const manual = new FakeDatabase('manual', 1);
  manual.createObjectStore(STORE_NAMES.preferences, { keyPath: 'key' });
  const port = createIDBPersistencePort(manual);
  await port.put(STORE_NAMES.preferences, 'theme', demoPreference('theme', 'dark'));
  assert.deepEqual(await port.list(STORE_NAMES.preferences), [demoPreference('theme', 'dark')]);

  const manualPromise: Promise<IndexedDBDatabaseLike> = Promise.resolve(manual);
  const promised = createIDBPersistencePort(manualPromise);
  assert.deepEqual(await promised.get(STORE_NAMES.preferences, 'theme'), demoPreference('theme', 'dark'));

  const brokenPromise: Promise<IndexedDBDatabaseLike> = Promise.reject(
    fakeDomError('InvalidAccessError', 'database closed')
  );
  const broken = createIDBPersistencePort(brokenPromise);
  await assert.rejects(
    broken.get(STORE_NAMES.preferences, 'theme'),
    persistenceFailure('storage-unavailable')
  );
});

test('persistenceFailure recognizes only coded PersistenceErrors', () => {
  const check = persistenceFailure('db-error');
  assert.equal(check(new PersistenceError('db-error', 'boom')), true);
  assert.equal(check(new PersistenceError('validation', 'nope')), false);
  assert.equal(check(new Error('plain')), false);
  assert.equal(check('not an error'), false);
});

test('DAO smoke: draft, attempt, completion and summary flow over the fake IDB port', async () => {
  const key: ChallengeKey = { challengeId: 'chunk', challengeVersion: 'v1' };
  const factory = new FakeFactory();
  const port = createIDBPersistencePort(openChallengeDatabase({ factory }));
  const dao = createProgressDAO(port, 1000);

  assert.equal(await dao.getSolution(key), null);
  await dao.saveDraft({ key, files: { 'index.ts': 'export {}' }, starterHash: 'starter-h' });
  await dao.saveDraft({ key, files: { 'index.ts': 'export const x = 1;' }, starterHash: 'starter-h' });
  assert.deepEqual(await dao.getSolution(key), {
    challengeId: 'chunk',
    challengeVersion: 'v1',
    files: { 'index.ts': 'export const x = 1;' },
    starterHash: 'starter-h',
    createdAt: 1000,
    updatedAt: 1000,
    runCount: 0,
  });
  assert.deepEqual(await port.get(STORE_NAMES.solutions, ['chunk', 'v1']), {
    challengeId: 'chunk',
    challengeVersion: 'v1',
    files: { 'index.ts': 'export const x = 1;' },
    starterHash: 'starter-h',
    createdAt: 1000,
    updatedAt: 1000,
    runCount: 0,
  });

  await dao.recordAttempt({
    key,
    durationMs: 42,
    result: 'passed',
    passedTests: 3,
    totalTests: 3,
    sourceHash: 'src-hash',
    startedAt: 900,
  });
  const solution = await dao.getSolution(key);
  assert.equal(solution?.runCount, 1);
  assert.equal(solution?.lastResult, 'passed');
  assert.equal(solution?.lastRunAt, 1000);
  const attempts = await port.list<AttemptRecord>(STORE_NAMES.attempts);
  assert.deepEqual(attempts.map((attempt) => attempt.id), [makeAttemptId(key, 900)]);

  await dao.markCompleted({ key, durationMs: 42, sourceHash: 'src-hash' });
  const completion = await port.get<CompletionRecord>(
    STORE_NAMES.completions,
    toChallengeKeyTuple(key)
  );
  assert.equal(completion?.attemptCountAtFirstPass, 1);
  assert.equal(completion?.firstPassedAt, 1000);
  assert.equal(completion?.bestDurationMs, 42);

  const summary = await dao.getProgressSummary();
  assert.deepEqual(summary.totals, { total: 1, completed: 1 });

  const db = factory.databases.get(DATABASE_NAME);
  assert.ok(db !== undefined);
  assert.equal(db.stores.get(STORE_NAMES.solutions)?.records.size, 1);
});
