import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PersistenceError } from './errors.ts';
import type { PersistenceErrorCode } from './errors.ts';
import { createMemoryPort } from './memory.ts';
import { portKeyToId } from './port.ts';
import type { PortKey, StoreName } from './port.ts';
import { STORE_NAMES } from './schema.ts';

function rejectedWith(code: PersistenceErrorCode) {
  return (error: unknown) =>
    error instanceof PersistenceError && error.code === code;
}

test('portKeyToId wraps single values via String and is stable', () => {
  assert.equal(portKeyToId('a'), portKeyToId('a'));
  assert.equal(portKeyToId(7), portKeyToId(7));
  assert.equal(portKeyToId(7), portKeyToId('7'), 'single values compare via String');
});

test('portKeyToId stringifies composite keys and distinguishes them from singles', () => {
  assert.equal(portKeyToId(['chunk', 'v1']), portKeyToId(['chunk', 'v1']));
  assert.notEqual(portKeyToId('chunk'), portKeyToId(['chunk']));
  assert.equal(portKeyToId(['chunk', 'v1']), JSON.stringify(['chunk', 'v1']));
});

test('put and get round-trip values without aliasing', async () => {
  const port = createMemoryPort();
  const value = { files: { 'index.ts': 'export {}' } };
  await port.put(STORE_NAMES.solutions, 'k', value);

  const retrieved = await port.get<typeof value>(STORE_NAMES.solutions, 'k');
  assert.deepEqual(retrieved, value);
  assert.notEqual(retrieved, value);
  assert.notEqual(retrieved?.files, value.files);

  retrieved!.files['index.ts'] = 'mutated';
  assert.deepEqual((await port.get<typeof value>(STORE_NAMES.solutions, 'k'))?.files, {
    'index.ts': 'export {}',
  });

  assert.equal(await port.get(STORE_NAMES.solutions, 'missing'), undefined);
});

test('list returns insertion order and re-put keeps position', async () => {
  const port = createMemoryPort();
  const attempts: (readonly [PortKey, number])[] = [
    ['a', 1],
    ['b', 2],
    ['c', 3],
  ];
  await port.putMany(STORE_NAMES.attempts, attempts);
  await port.put(STORE_NAMES.attempts, 'a', 9);

  assert.deepEqual(await port.list<number>(STORE_NAMES.attempts), [9, 2, 3]);
});

test('empty list for untouched but valid store', async () => {
  const port = createMemoryPort();
  assert.deepEqual(await port.list(STORE_NAMES.preferences), []);
});

test('delete and deleteMany remove matching keys only', async () => {
  const port = createMemoryPort();
  const prefs: (readonly [PortKey, string | number])[] = [
    ['theme', 'dark'],
    ['fontSize', 14],
    ['layout', 'split'],
  ];
  await port.putMany(STORE_NAMES.preferences, prefs);

  await port.delete(STORE_NAMES.preferences, 'theme');
  await port.deleteMany(STORE_NAMES.preferences, ['fontSize', 'nope']);

  assert.deepEqual(await port.list<string | number>(STORE_NAMES.preferences), ['split']);
});

test('clear empties one store and leaves others intact', async () => {
  const port = createMemoryPort();
  await port.put(STORE_NAMES.solutions, 's', 'sol');
  await port.put(STORE_NAMES.completions, 'c', 'comp');
  await port.clear(STORE_NAMES.solutions);

  assert.deepEqual(await port.list(STORE_NAMES.solutions), []);
  assert.deepEqual(await port.list<string>(STORE_NAMES.completions), ['comp']);
});

test('all SCHEMA_V1 store names are accepted by the port', async () => {
  const port = createMemoryPort();
  for (const store of Object.values(STORE_NAMES) as StoreName[]) {
    await port.put(store, 'probe', 1);
    assert.equal(await port.get<number>(store, 'probe'), 1);
    await port.clear(store);
    assert.deepEqual(await port.list(store), []);
  }
});

test('unknown store names throw PersistenceError validation', async () => {
  const port = createMemoryPort();
  const bogus = 'bogus' as StoreName;

  await assert.rejects(port.get(bogus, 'k'), rejectedWith('validation'));
  await assert.rejects(port.list(bogus), rejectedWith('validation'));
  await assert.rejects(port.put(bogus, 'k', 1), rejectedWith('validation'));
  await assert.rejects(port.putMany(bogus, []), rejectedWith('validation'));
  await assert.rejects(port.delete(bogus, 'k'), rejectedWith('validation'));
  await assert.rejects(port.deleteMany(bogus, ['k']), rejectedWith('validation'));
  await assert.rejects(port.clear(bogus), rejectedWith('validation'));
});
