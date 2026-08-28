import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeAttemptId } from './attempts.ts';
import type {
  AttemptInput,
  ProgressDAO,
} from './dao.ts';
import { createProgressDAO } from './dao.ts';
import type {
  AttemptRecord,
  ChallengeKey,
  CompletionRecord,
  PreferenceRecord,
  SolutionRecord,
} from './domain.ts';
import type { PersistenceErrorCode } from './errors.ts';
import { PersistenceError } from './errors.ts';
import { challengeKeyId } from './keys.ts';
import { createMemoryPort } from './memory.ts';
import type { PersistencePort } from './port.ts';
import { STORE_NAMES } from './schema.ts';
import { progressKeyOf } from './summary.ts';
import type { ProgressExport } from './validate.ts';

const key: ChallengeKey = { challengeId: 'chunk', challengeVersion: 'v1' };
const otherKey: ChallengeKey = { challengeId: 'pick', challengeVersion: 'v2' };

type MemoryPort = ReturnType<typeof createMemoryPort>;

interface TestScope {
  port: MemoryPort;
  dao: ProgressDAO;
  setNow: (timestamp: number) => void;
}

function setup(startTime = 1000, maxAttempts?: number): TestScope {
  const port = createMemoryPort();
  const time = { value: startTime };
  const dao = createProgressDAO(port, { now: () => time.value }, maxAttempts);
  return { port, dao, setNow: (timestamp) => (time.value = timestamp) };
}

function draftInput(target: ChallengeKey = key) {
  return { key: target, files: { 'index.ts': 'export {}' }, starterHash: 'starter-h' };
}

function attemptInput(overrides: Partial<AttemptInput> = {}): AttemptInput {
  return {
    key,
    durationMs: 42,
    result: 'passed',
    passedTests: 3,
    totalTests: 3,
    sourceHash: 'src-hash',
    startedAt: 900,
    ...overrides,
  };
}

function emptyExport(overrides: Partial<ProgressExport> = {}): ProgressExport {
  return {
    version: 1,
    exportedAt: 0,
    solutions: [],
    completions: [],
    attempts: [],
    preferences: [],
    ...overrides,
  };
}

function solutionRecord(overrides: Partial<SolutionRecord> = {}): SolutionRecord {
  return {
    challengeId: 'chunk',
    challengeVersion: 'v1',
    files: { 'index.ts': 'export {}' },
    starterHash: 'starter-h',
    createdAt: 100,
    updatedAt: 100,
    runCount: 0,
    ...overrides,
  };
}

function attemptRecord(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    id: makeAttemptId(key, 900),
    challengeId: 'chunk',
    challengeVersion: 'v1',
    startedAt: 900,
    durationMs: 42,
    result: 'failed',
    passedTests: 0,
    totalTests: 3,
    sourceHash: 'src-hash',
    ...overrides,
  };
}

function rejectsWith(code: PersistenceErrorCode) {
  return (error: unknown) =>
    error instanceof PersistenceError && error.code === code;
}

async function attemptsOf(port: MemoryPort): Promise<AttemptRecord[]> {
  return port.list<AttemptRecord>(STORE_NAMES.attempts);
}

async function completionOf(port: MemoryPort): Promise<CompletionRecord | undefined> {
  return port.get<CompletionRecord>(STORE_NAMES.completions, challengeKeyId(key));
}

function failingPort(failure: unknown): PersistencePort {
  return {
    async get<T>(): Promise<T | undefined> {
      throw failure;
    },
    async list<T>(): Promise<T[]> {
      throw failure;
    },
    async put(): Promise<void> {
      throw failure;
    },
    async putMany(): Promise<void> {
      throw failure;
    },
    async delete(): Promise<void> {
      // no-op so resetChallenge reaches the failing list() first
    },
    async deleteMany(): Promise<void> {
      // no-op
    },
    async clear(): Promise<void> {
      // no-op
    },
  };
}

test('getSolution misses return null; saveDraft creates then upserts', async () => {
  const { dao, setNow } = setup(100);
  assert.equal(await dao.getSolution(key), null);

  await dao.saveDraft(draftInput());
  assert.deepEqual(await dao.getSolution(key), {
    challengeId: 'chunk',
    challengeVersion: 'v1',
    files: { 'index.ts': 'export {}' },
    starterHash: 'starter-h',
    createdAt: 100,
    updatedAt: 100,
    runCount: 0,
  });

  await dao.recordAttempt(attemptInput({ startedAt: 110, result: 'failed' }));
  setNow(250);
  await dao.saveDraft({ key, files: { 'index.ts': 'v2' }, starterHash: 'starter-h2' });

  assert.deepEqual(await dao.getSolution(key), {
    challengeId: 'chunk',
    challengeVersion: 'v1',
    files: { 'index.ts': 'v2' },
    starterHash: 'starter-h2',
    createdAt: 100,
    updatedAt: 250,
    runCount: 1,
    lastRunAt: 100,
    lastResult: 'failed',
  });
});

test('recordAttempt writes the attempt keyed by makeAttemptId', async () => {
  const { port, dao } = setup(100);
  await dao.recordAttempt(attemptInput({ startedAt: 55, result: 'timeout' }));

  const [attempt] = await attemptsOf(port);
  assert.deepEqual(attempt, {
    id: 'chunk:v1:55',
    challengeId: 'chunk',
    challengeVersion: 'v1',
    startedAt: 55,
    durationMs: 42,
    result: 'timeout',
    passedTests: 3,
    totalTests: 3,
    sourceHash: 'src-hash',
  });
});

test('recordAttempt without a solution skips the solution update', async () => {
  const { port, dao } = setup(100);
  await dao.recordAttempt(attemptInput());
  assert.equal(await dao.getSolution(key), null);
  assert.equal((await attemptsOf(port)).length, 1);
});

test('recordAttempt updates solution run statistics', async () => {
  const { dao } = setup(100);
  await dao.saveDraft(draftInput());
  await dao.recordAttempt(attemptInput({ startedAt: 111, result: 'runtime-error' }));
  await dao.recordAttempt(attemptInput({ startedAt: 112, result: 'failed' }));

  const solution = await dao.getSolution(key);
  assert.equal(solution?.runCount, 2);
  assert.equal(solution?.lastRunAt, 100);
  assert.equal(solution?.lastResult, 'failed');
});

test('recordAttempt with the same startedAt overwrites instead of duplicating', async () => {
  const { port, dao } = setup(100);
  await dao.saveDraft(draftInput());
  await dao.recordAttempt(attemptInput({ startedAt: 7, result: 'failed' }));
  await dao.recordAttempt(
    attemptInput({ startedAt: 7, durationMs: 99, result: 'passed', sourceHash: 'later' })
  );

  const attempts = await attemptsOf(port);
  assert.equal(attempts.length, 1);
  assert.deepEqual(attempts[0], {
    id: 'chunk:v1:7',
    challengeId: 'chunk',
    challengeVersion: 'v1',
    startedAt: 7,
    durationMs: 99,
    result: 'passed',
    passedTests: 3,
    totalTests: 3,
    sourceHash: 'later',
  });

  const solution = await dao.getSolution(key);
  assert.equal(solution?.runCount, 2);
});

test('recordAttempt prunes to the default cap of 20 attempts', async () => {
  const { port, dao } = setup(100);
  for (let startedAt = 1; startedAt <= 25; startedAt += 1) {
    await dao.recordAttempt(attemptInput({ startedAt }));
  }

  const attempts = await attemptsOf(port);
  assert.deepEqual(
    attempts.map((attempt) => attempt.startedAt),
    Array.from({ length: 20 }, (_, index) => index + 6)
  );
});

test('recordAttempt honors a custom maxAttemptsPerChallenge', async () => {
  const { port, dao } = setup(100, 3);
  for (let startedAt = 1; startedAt <= 6; startedAt += 1) {
    await dao.recordAttempt(attemptInput({ startedAt }));
  }

  const attempts = await attemptsOf(port);
  assert.deepEqual(
    attempts.map((attempt) => attempt.startedAt),
    [4, 5, 6]
  );
});

test('markCompleted creates then merges completion records', async () => {
  const { port, dao, setNow } = setup(100);
  await dao.recordAttempt(attemptInput({ startedAt: 10 }));
  await dao.recordAttempt(attemptInput({ startedAt: 20 }));

  await dao.markCompleted({ key, durationMs: 50, sourceHash: 'A' });
  assert.deepEqual(await completionOf(port), {
    challengeId: 'chunk',
    challengeVersion: 'v1',
    firstPassedAt: 100,
    lastPassedAt: 100,
    bestDurationMs: 50,
    passingSourceHash: 'A',
    attemptCountAtFirstPass: 2,
  });

  await dao.recordAttempt(attemptInput({ startedAt: 30 }));
  setNow(300);
  await dao.markCompleted({ key, durationMs: 40, sourceHash: 'B' });
  setNow(400);
  await dao.markCompleted({ key, durationMs: 999, sourceHash: 'C' });

  assert.deepEqual(await completionOf(port), {
    challengeId: 'chunk',
    challengeVersion: 'v1',
    firstPassedAt: 100,
    lastPassedAt: 400,
    bestDurationMs: 40,
    passingSourceHash: 'C',
    attemptCountAtFirstPass: 2,
  });
});

test('getProgressSummary projects solutions, completions and attempt counts', async () => {
  const { port, dao } = setup(1000);
  await dao.saveDraft(draftInput());
  await dao.recordAttempt(attemptInput({ startedAt: 900, result: 'failed' }));
  await dao.markCompleted({ key, durationMs: 42, sourceHash: 'src-hash' });
  await dao.recordAttempt(attemptInput({ key: otherKey, startedAt: 800 }));

  const summary = await dao.getProgressSummary();
  assert.deepEqual(summary.totals, { total: 2, completed: 1 });

  assert.deepEqual(summary.byChallenge.get(progressKeyOf(key)), {
    key,
    completed: true,
    firstPassedAt: 1000,
    updatedAt: 1000,
    lastResult: 'failed',
    runCount: 1,
    attemptCount: 1,
  });
  assert.deepEqual(summary.byChallenge.get(progressKeyOf(otherKey)), {
    key: otherKey,
    completed: false,
    runCount: 0,
    attemptCount: 1,
  });

  assert.equal(summary.byChallenge.size, 2);
  assert.equal((await attemptsOf(port)).length, 2);
});

test('resetChallenge deletes progress, attempts included, and is idempotent', async () => {
  const { port, dao } = setup(1000);
  await dao.saveDraft(draftInput());
  await dao.recordAttempt(attemptInput({ startedAt: 900 }));
  await dao.markCompleted({ key, durationMs: 42, sourceHash: 'src-hash' });
  await dao.saveDraft(draftInput(otherKey));

  await dao.resetChallenge(key);
  assert.equal(await dao.getSolution(key), null);
  assert.equal(await completionOf(port), undefined);
  assert.deepEqual(await attemptsOf(port), []);

  await dao.resetChallenge(key);
  assert.equal(await dao.getSolution(key), null);
  assert.deepEqual(await attemptsOf(port), []);
  assert.notEqual(await dao.getSolution(otherKey), null);
});

test('exportAll validates stores and returns a detached copy', async () => {
  const { port, dao } = setup(1000);
  await dao.saveDraft(draftInput());
  await dao.recordAttempt(attemptInput({ startedAt: 900 }));
  await port.put<PreferenceRecord>(STORE_NAMES.preferences, 'theme', {
    key: 'theme',
    value: 'dark',
  });

  const exported = await dao.exportAll();
  assert.deepEqual(exported, {
    version: 1,
    exportedAt: 1000,
    solutions: [
      {
        challengeId: 'chunk',
        challengeVersion: 'v1',
        files: { 'index.ts': 'export {}' },
        starterHash: 'starter-h',
        createdAt: 1000,
        updatedAt: 1000,
        runCount: 1,
        lastRunAt: 1000,
        lastResult: 'passed',
      },
    ],
    completions: [],
    attempts: [attemptRecord({ result: 'passed', passedTests: 3 })],
    preferences: [{ key: 'theme', value: 'dark' }],
  });

  exported.solutions[0].files['index.ts'] = 'tampered';
  exported.attempts.length = 0;
  assert.equal((await dao.exportAll()).attempts.length, 1);
  assert.equal((await dao.getSolution(key))?.files['index.ts'], 'export {}');
});

test('importAll round-trips exportAll into a fresh DAO', async () => {
  const daoScope = setup(1000);
  await daoScope.dao.saveDraft(draftInput());
  await daoScope.dao.recordAttempt(attemptInput({ startedAt: 900 }));
  await daoScope.dao.markCompleted({ key, durationMs: 42, sourceHash: 'src-hash' });
  await daoScope.port.put<PreferenceRecord>(STORE_NAMES.preferences, 'theme', {
    key: 'theme',
    value: 'monokai',
  });

  const exported = await daoScope.dao.exportAll();

  const fresh = setup(1000);
  const result = await fresh.dao.importAll(exported);
  assert.deepEqual(result, {
    importedSolutions: 1,
    importedCompletions: 1,
    importedAttempts: 1,
    importedPreferences: 1,
    skippedConflicts: 0,
  });
  assert.deepEqual(await fresh.dao.exportAll(), exported);
});

test('importAll(exportAll()) into the same DAO is idempotent', async () => {
  const { dao } = setup(1000);
  await dao.saveDraft(draftInput());
  await dao.recordAttempt(attemptInput({ startedAt: 900 }));

  const first = await dao.exportAll();
  const result = await dao.importAll(first);
  assert.deepEqual(result, {
    importedSolutions: 1,
    importedCompletions: 0,
    importedAttempts: 1,
    importedPreferences: 0,
    skippedConflicts: 0,
  });
  assert.deepEqual(await dao.exportAll(), first);
});

test('importAll keeps the newer solution and counts conflicts', async () => {
  const { dao } = setup(1000);
  await dao.saveDraft({ key, files: { 'index.ts': 'mine' }, starterHash: 'h' });

  const older = emptyExport({
    solutions: [solutionRecord({ updatedAt: 500, files: { 'index.ts': 'older' } })],
  });
  assert.deepEqual(await dao.importAll(older), {
    importedSolutions: 0,
    importedCompletions: 0,
    importedAttempts: 0,
    importedPreferences: 0,
    skippedConflicts: 1,
  });
  assert.equal((await dao.getSolution(key))?.files['index.ts'], 'mine');

  const tied = emptyExport({
    solutions: [solutionRecord({ updatedAt: 1000, files: { 'index.ts': 'theirs' } })],
  });
  const tiedResult = await dao.importAll(tied);
  assert.equal(tiedResult.importedSolutions, 1);
  assert.equal(tiedResult.skippedConflicts, 0);
  assert.equal((await dao.getSolution(key))?.files['index.ts'], 'theirs');
});

test('importAll merges completions by best and newest fields', async () => {
  const { port, dao, setNow } = setup(200, 3);
  await dao.recordAttempt(attemptInput({ startedAt: 10 }));
  await dao.recordAttempt(attemptInput({ startedAt: 20 }));
  await dao.markCompleted({ key, durationMs: 50, sourceHash: 'A' });

  setNow(999);
  await dao.importAll(
    emptyExport({
      completions: [
        {
          challengeId: 'chunk',
          challengeVersion: 'v1',
          firstPassedAt: 120,
          lastPassedAt: 260,
          bestDurationMs: 33,
          passingSourceHash: 'X',
          attemptCountAtFirstPass: 5,
        },
      ],
    })
  );

  assert.deepEqual(await completionOf(port), {
    challengeId: 'chunk',
    challengeVersion: 'v1',
    firstPassedAt: 120,
    lastPassedAt: 260,
    bestDurationMs: 33,
    passingSourceHash: 'X',
    attemptCountAtFirstPass: 5,
  });
});

test('importAll lets same-id attempts win and re-prunes per challenge', async () => {
  const { port, dao } = setup(100, 3);
  for (const startedAt of [1, 2, 3]) {
    await dao.recordAttempt(attemptInput({ startedAt }));
  }

  const merged = await dao.importAll(
    emptyExport({
      attempts: [
        attemptRecord({ id: makeAttemptId(key, 3), startedAt: 3, durationMs: 77, sourceHash: 'winner' }),
        attemptRecord({ id: makeAttemptId(key, 4), startedAt: 4 }),
      ],
    })
  );
  assert.deepEqual(merged, {
    importedSolutions: 0,
    importedCompletions: 0,
    importedAttempts: 2,
    importedPreferences: 0,
    skippedConflicts: 0,
  });

  const attempts = await attemptsOf(port);
  assert.deepEqual(
    attempts.map((attempt) => attempt.startedAt),
    [2, 3, 4]
  );
  assert.equal(attempts.find((attempt) => attempt.startedAt === 3)?.durationMs, 77);
});

test('importAll overwrites preferences without conflicts', async () => {
  const { port, dao } = setup(100);
  await port.put<PreferenceRecord>(STORE_NAMES.preferences, 'theme', {
    key: 'theme',
    value: 'light',
  });

  const result = await dao.importAll(
    emptyExport({
      preferences: [
        { key: 'theme', value: 'dark' },
        { key: 'fontSize', value: 14 },
      ],
    })
  );
  assert.equal(result.importedPreferences, 2);
  assert.deepEqual(await port.list<PreferenceRecord>(STORE_NAMES.preferences), [
    { key: 'theme', value: 'dark' },
    { key: 'fontSize', value: 14 },
  ]);
});

test('importAll rejects malformed exports with a validation error', async () => {
  const { dao } = setup(100);
  await assert.rejects(
    dao.importAll({ version: 2 } as unknown as ProgressExport),
    rejectsWith('validation')
  );
  await assert.rejects(
    dao.importAll(emptyExport({ solutions: [{ challengeId: '' }] as SolutionRecord[] })),
    rejectsWith('validation')
  );
});

test('rejects malformed challenge keys with a validation error', async () => {
  const { dao } = setup(100);
  const badKey = { challengeId: '', challengeVersion: 'v1' };
  await assert.rejects(dao.getSolution(badKey), rejectsWith('validation'));
  await assert.rejects(dao.saveDraft({ ...draftInput(), key: badKey }), rejectsWith('validation'));
  await assert.rejects(
    dao.recordAttempt(attemptInput({ key: badKey })),
    rejectsWith('validation')
  );
  await assert.rejects(dao.resetChallenge(badKey), rejectsWith('validation'));
});

test('DAO normalizes storage failures into PersistenceError codes', async () => {
  const quota = new DOMException('quota', 'QuotaExceededError');
  const daoQuota = createProgressDAO(failingPort(quota), 100);
  await assert.rejects(daoQuota.getSolution(key), rejectsWith('storage-unavailable'));
  await assert.rejects(daoQuota.exportAll(), rejectsWith('storage-unavailable'));

  const generic = new Error('disk on fire');
  const daoGeneric = createProgressDAO(failingPort(generic), 100);
  await assert.rejects(daoGeneric.getSolution(key), rejectsWith('db-error'));
  await assert.rejects(daoGeneric.markCompleted({ key, durationMs: 1, sourceHash: 'h' }), rejectsWith('db-error'));
});
