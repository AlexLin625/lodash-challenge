// Bridge tests: ProgressSeam semantics on top of the real DAO and memory port.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProgressDAO } from './dao.ts';
import type { ProgressDAO } from './dao.ts';
import type {
  AttemptRecord as DomainAttemptRecord,
  CompletionRecord,
  SolutionRecord,
} from './domain.ts';
import { PersistenceError } from './errors.ts';
import { toChallengeKeyTuple } from './keys.ts';
import { createMemoryPort } from './memory.ts';
import { STORE_NAMES } from './schema.ts';
import { progressKeyOf } from './summary.ts';
import type { AttemptRecord, ChallengeKey, ProgressSeam } from '../workspace/progress.ts';
import { createWorkspaceProgressService } from './workspace-service.ts';
import type { FlushableProgressSeam } from './workspace-service.ts';

const key: ChallengeKey = { challengeId: 'chunk', challengeVersion: 'v1' };

interface TestScope {
  service: FlushableProgressSeam;
  dao: ProgressDAO;
  errors: PersistenceError[];
  setNow: (timestamp: number) => void;
}

function setup(): TestScope {
  const port = createMemoryPort();
  const time = { value: 1000 };
  const clock = { now: () => time.value };
  const dao = createProgressDAO(port, clock);
  const errors: PersistenceError[] = [];
  const service = createWorkspaceProgressService({
    dao,
    clock: () => clock.now(),
    onError: (error) => errors.push(error),
  });
  return {
    service,
    dao,
    errors,
    setNow: (timestamp) => (time.value = timestamp),
  };
}

function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    key,
    result: 'passed',
    passedTests: 3,
    totalTests: 3,
    durationMs: 42,
    sourceHash: 'src-hash',
    ...overrides,
  };
}

function brokenService(): { service: FlushableProgressSeam; errors: PersistenceError[] } {
  const time = { value: 1000 };
  const failingDao: ProgressDAO = {
    async getSolution(): Promise<SolutionRecord | null> {
      throw new Error('port exploded');
    },
    async saveDraft(): Promise<void> {
      throw new Error('port exploded');
    },
    async recordAttempt(): Promise<void> {
      throw new Error('port exploded');
    },
    async markCompleted(): Promise<void> {
      throw new Error('port exploded');
    },
    async getProgressSummary(): Promise<never> {
      throw new Error('unreachable');
    },
    async resetChallenge(): Promise<void> {
      throw new Error('unreachable');
    },
    async exportAll(): Promise<never> {
      throw new Error('unreachable');
    },
    async importAll(): Promise<never> {
      throw new Error('unreachable');
    },
  };
  const errors: PersistenceError[] = [];
  const service = createWorkspaceProgressService({
    dao: failingDao,
    clock: () => time.value,
    onError: (error) => errors.push(error),
  });
  return { service, errors };
}

test('challengeOpened seeds a starter draft when no solution exists', async () => {
  const { service, dao } = setup();
  service.challengeOpened(key, { 'index.ts': 'starter' });
  await service.flush();

  const solution = await dao.getSolution(key);
  assert.notEqual(solution, null);
  assert.deepEqual(solution?.files, { 'index.ts': 'starter' });
  assert.equal(solution?.starterHash, '');
});

test('challengeOpened is idempotent and keeps the user draft', async () => {
  const { service, dao } = setup();
  service.challengeOpened(key, { 'index.ts': 'starter' });
  await service.flush();
  service.saveDraft(key, { 'index.ts': 'user edit' });
  await service.flush();
  service.challengeOpened(key, { 'index.ts': 'starter again' });
  await service.flush();

  const solution = await dao.getSolution(key);
  assert.deepEqual(solution?.files, { 'index.ts': 'user edit' });
});

test('saveDraft preserves the stored starterHash', async () => {
  const { service, dao, setNow } = setup();
  await dao.saveDraft({ key, files: { 'index.ts': 'starter' }, starterHash: 'hash-1' });

  setNow(2000);
  service.saveDraft(key, { 'index.ts': 'typed' });
  await service.flush();

  const solution = await dao.getSolution(key);
  assert.deepEqual(solution?.files, { 'index.ts': 'typed' });
  assert.equal(solution?.starterHash, 'hash-1');
  assert.equal(solution?.updatedAt, 2000);
});

test('saveDraft on a fresh slot stores an empty starterHash', async () => {
  const { service, dao } = setup();
  service.saveDraft(key, { 'index.ts': 'typed' });
  await service.flush();

  const solution = await dao.getSolution(key);
  assert.equal(solution?.starterHash, '');
});

test('recordAttempt persists start time derived from the clock', async () => {
  const { service, dao, setNow } = setup();
  service.challengeOpened(key, { 'index.ts': 'starter' });
  await service.flush();

  setNow(1042);
  service.recordAttempt(attempt());
  await service.flush();

  const solution = await dao.getSolution(key);
  assert.equal(solution?.runCount, 1);
  assert.equal(solution?.lastResult, 'passed');

  const summary = await dao.getProgressSummary();
  assert.equal(summary.byChallenge.get(progressKeyOf(key))?.attemptCount, 1);
});

test('recordAttempt maps unknown run statuses to failed', async () => {
  const port = createMemoryPort();
  const dao = createProgressDAO(port, 1000);
  const service = createWorkspaceProgressService({ dao, clock: () => 1000 });

  service.recordAttempt(attempt({ result: 'compile-error' }));
  await service.flush();

  const stored = await port.list<DomainAttemptRecord>(STORE_NAMES.attempts);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.result, 'failed');
  assert.equal(stored[0]?.startedAt, 958);
});

test('markCompleted stores the passing source hash from the attempt', async () => {
  const port = createMemoryPort();
  const dao = createProgressDAO(port, 5000);
  const service = createWorkspaceProgressService({ dao, clock: () => 5000 });

  const passing = attempt({ result: 'passed', sourceHash: 'good-hash', durationMs: 60 });
  service.recordAttempt(passing);
  service.markCompleted(key, passing);
  await service.flush();

  const completion = await port.get<CompletionRecord>(
    STORE_NAMES.completions,
    toChallengeKeyTuple(key)
  );
  assert.notEqual(completion, undefined);
  assert.equal(completion?.passingSourceHash, 'good-hash');
  assert.equal(completion?.bestDurationMs, 60);
  assert.equal(completion?.firstPassedAt, 5000);
});

test('DAO failures are reported through onError without throwing', async () => {
  const { service, errors } = brokenService();
  const seam: ProgressSeam = service;

  assert.doesNotThrow(() => {
    seam.challengeOpened(key, { 'index.ts': 'starter' });
    seam.saveDraft(key, { 'index.ts': 'typed' });
    seam.recordAttempt(attempt());
    seam.markCompleted(key, attempt());
  });

  await service.flush();

  assert.equal(errors.length, 4);
  for (const error of errors) {
    assert.ok(error instanceof PersistenceError);
    assert.equal(error.code, 'db-error');
  }
});

test('the queue keeps running after a failed operation', async () => {
  const { service, dao, errors } = setup();

  service.saveDraft(key, { 'index.ts': 'ok' });
  service.recordAttempt(attempt({ durationMs: Number.NaN }));
  service.saveDraft(key, { 'index.ts': 'after failure' });
  await service.flush();

  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.code, 'validation');
  const solution = await dao.getSolution(key);
  assert.deepEqual(solution?.files, { 'index.ts': 'after failure' });
});

test('getSolutionDraft returns null when no solution is stored', async () => {
  const { service } = setup();
  assert.equal(await service.getSolutionDraft(key), null);
});

test('getSolutionDraft returns the stored draft files', async () => {
  const { service, dao } = setup();
  await dao.saveDraft({ key, files: { 'index.ts': 'typed' }, starterHash: 'hash-1' });
  assert.deepEqual(await service.getSolutionDraft(key), { 'index.ts': 'typed' });
});

test('getSolutionDraft reports DAO failures through onError and resolves null', async () => {
  const { service, errors } = brokenService();
  assert.equal(await service.getSolutionDraft(key), null);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof PersistenceError);
  assert.equal(errors[0]?.code, 'db-error');
});

test('flush covers queued reads and reads observe earlier writes', async () => {
  const { service } = setup();
  service.challengeOpened(key, { 'index.ts': 'starter' });
  const read = service.getSolutionDraft(key);
  await service.flush();
  assert.deepEqual(await read, { 'index.ts': 'starter' });
});
