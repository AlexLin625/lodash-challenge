// Bootstrap tests: the full §10 data flow over the real memory port and
// the storage-unavailable notification plumbing (docs/design-v1.md §9).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  AttemptRecord as DomainAttemptRecord,
  CompletionRecord,
  PreferenceRecord,
} from './domain.ts';
import { PersistenceError } from './errors.ts';
import { isIndexedDBAvailable } from './idb-port.ts';
import { challengeKeyId } from './keys.ts';
import { createMemoryPort } from './memory.ts';
import type { PersistencePort } from './port.ts';
import { DEFAULT_PREFERENCES } from './preferences.ts';
import { STORE_NAMES } from './schema.ts';
import { progressKeyOf } from './summary.ts';
import type { AttemptRecord, ChallengeKey } from '../workspace/progress.ts';
import { createPersistence } from './bootstrap.ts';

const key: ChallengeKey = { challengeId: 'chunk', challengeVersion: 'v1' };

function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    key,
    result: 'passed',
    passedTests: 5,
    totalTests: 5,
    durationMs: 80,
    sourceHash: 'src-hash',
    ...overrides,
  };
}

function storageUnavailablePort(): PersistencePort {
  const unavailable = new PersistenceError('storage-unavailable', 'no IndexedDB here');
  return {
    async get(): Promise<never> {
      throw unavailable;
    },
    async list(): Promise<never> {
      throw unavailable;
    },
    async put(): Promise<never> {
      throw unavailable;
    },
    async putMany(): Promise<never> {
      throw unavailable;
    },
    async delete(): Promise<never> {
      throw unavailable;
    },
    async deleteMany(): Promise<never> {
      throw unavailable;
    },
    async clear(): Promise<never> {
      throw unavailable;
    },
  };
}

test('default assembly persists the full progress flow through the memory port', async () => {
  const port = createMemoryPort();
  const bootstrap = createPersistence({ port, clock: () => 1000 });

  bootstrap.progress.challengeOpened(key, { 'index.ts': 'starter' });
  await bootstrap.progress.flush();
  bootstrap.progress.saveDraft(key, { 'index.ts': 'typed' });
  bootstrap.progress.recordAttempt(attempt());
  bootstrap.progress.markCompleted(key, attempt());
  await bootstrap.progress.flush();

  const solution = await bootstrap.dao.getSolution(key);
  assert.deepEqual(solution?.files, { 'index.ts': 'typed' });
  assert.equal(solution?.runCount, 1);
  assert.equal(solution?.lastResult, 'passed');

  const attempts = await port.list<DomainAttemptRecord>(STORE_NAMES.attempts);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.startedAt, 920);
  assert.equal(attempts[0]?.sourceHash, 'src-hash');

  const completion = await port.get<CompletionRecord>(
    STORE_NAMES.completions,
    challengeKeyId(key)
  );
  assert.equal(completion?.passingSourceHash, 'src-hash');
  assert.equal(completion?.firstPassedAt, 1000);

  const summary = await bootstrap.dao.getProgressSummary();
  assert.equal(summary.byChallenge.get(progressKeyOf(key))?.attemptCount, 1);
  assert.equal(bootstrap.storageAvailable, true);
});

test('flush resolves once every queued seam call has landed', async () => {
  const port = createMemoryPort();
  const bootstrap = createPersistence({ port, clock: () => 1000 });

  bootstrap.progress.saveDraft(key, { 'index.ts': 'v1' });
  bootstrap.progress.saveDraft(key, { 'index.ts': 'v2' });
  bootstrap.progress.saveDraft(key, { 'index.ts': 'v3' });
  await bootstrap.progress.flush();

  const stored = await port.list<{ files: Record<string, string> }>(
    STORE_NAMES.solutions
  );
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0]?.files, { 'index.ts': 'v3' });
});

test('preferences round-trip through the port with clamping and defaults', async () => {
  const bootstrap = createPersistence({ port: createMemoryPort() });
  assert.deepEqual(await bootstrap.loadPreferences(), { ...DEFAULT_PREFERENCES });

  await bootstrap.savePreferences({ fontSize: 99, editorTheme: 'dracula' });
  const state = await bootstrap.loadPreferences();
  assert.equal(state.fontSize, 32);
  assert.equal(state.editorTheme, 'dracula');
  assert.equal(state.panelLayout, DEFAULT_PREFERENCES.panelLayout);
  assert.equal(state.autoSaveEnabled, DEFAULT_PREFERENCES.autoSaveEnabled);
});

test('savePreferences overlays keys without deleting unsubmitted ones', async () => {
  const port = createMemoryPort();
  const bootstrap = createPersistence({ port });
  const foreign: PreferenceRecord = { key: 'futureKey', value: 'from-a-later-schema' };
  await port.put(STORE_NAMES.preferences, foreign.key, foreign);

  await bootstrap.savePreferences({ autoSaveEnabled: false });
  await bootstrap.savePreferences({ fontSize: 20 });

  const stored = await port.list<PreferenceRecord>(STORE_NAMES.preferences);
  assert.ok(stored.some((record) => record.key === 'futureKey'));

  const state = await bootstrap.loadPreferences();
  assert.equal(state.autoSaveEnabled, false);
  assert.equal(state.fontSize, 20);
});

test('maxAttemptsPerChallenge flows through the DAO and trims attempts', async () => {
  const port = createMemoryPort();
  const time = { value: 1000 };
  const bootstrap = createPersistence({
    port,
    clock: () => time.value,
    maxAttemptsPerChallenge: 1,
  });

  bootstrap.progress.recordAttempt(attempt({ durationMs: 10 }));
  time.value = 1030;
  bootstrap.progress.recordAttempt(attempt({ durationMs: 10, sourceHash: 'second' }));
  await bootstrap.progress.flush();

  const attempts = await port.list<DomainAttemptRecord>(STORE_NAMES.attempts);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.startedAt, 1020);
  assert.equal(attempts[0]?.sourceHash, 'second');
});

test('onStorageUnavailable registers, unregisters, and notifies once on failures', async () => {
  const bootstrap = createPersistence({ port: storageUnavailablePort() });
  assert.equal(bootstrap.storageAvailable, true);

  let notified = 0;
  let broken = 0;
  const unsubscribe = bootstrap.onStorageUnavailable(() => {
    notified += 1;
  });
  const unsubscribeBroken = bootstrap.onStorageUnavailable(() => {
    broken += 1;
    throw new Error('listener explosion');
  });

  assert.doesNotThrow(() => unsubscribeBroken());

  assert.doesNotThrow(() => {
    bootstrap.progress.saveDraft(key, { 'index.ts': 'lost' });
  });
  await bootstrap.progress.flush();

  assert.equal(notified, 1);
  assert.equal(broken, 0);
  assert.equal(bootstrap.storageAvailable, false);

  await assert.rejects(
    bootstrap.savePreferences({ fontSize: 12 }),
    (error: unknown) =>
      error instanceof PersistenceError && error.code === 'storage-unavailable'
  );
  assert.equal(notified, 1);

  assert.doesNotThrow(() => unsubscribe());
  assert.doesNotThrow(() => unsubscribe());
});

test(
  'createPersistence without deps keeps an always-success in-memory bootstrap',
  { skip: isIndexedDBAvailable() ? 'the default port would be IndexedDB here' : false },
  async () => {
    const bootstrap = createPersistence();
    assert.equal(bootstrap.storageAvailable, true);
    bootstrap.progress.challengeOpened(key, { 'index.ts': 'starter' });
    await bootstrap.progress.flush();
    const solution = await bootstrap.dao.getSolution(key);
    assert.equal(solution?.challengeId, key.challengeId);
  }
);
