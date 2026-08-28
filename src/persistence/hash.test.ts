import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256Hex } from '../challenges/integrity.ts';
import { sourceHash } from './hash.ts';

test('is independent of object insertion order', async () => {
  const paths = ['a.ts', 'b.ts'];

  assert.equal(
    await sourceHash({ 'a.ts': 'a', 'b.ts': 'b' }, paths),
    await sourceHash({ 'b.ts': 'b', 'a.ts': 'a' }, paths)
  );
});

test('is independent of editable path order and duplicate entries', async () => {
  const files = { 'a.ts': 'a', 'b.ts': 'b' };

  assert.equal(await sourceHash(files, ['b.ts', 'a.ts', 'a.ts']), await sourceHash(files, ['a.ts', 'b.ts']));
});

test('changes when an editable path or its content changes', async () => {
  const base = await sourceHash({ 'a.ts': 'a', 'b.ts': 'b' }, ['a.ts', 'b.ts']);

  assert.notEqual(await sourceHash({ 'a.ts': 'changed', 'b.ts': 'b' }, ['a.ts', 'b.ts']), base);
  assert.notEqual(await sourceHash({ 'a.ts': 'a', 'b.ts': 'b' }, ['a.ts']), base);
});

test('ignores files outside editable paths', async () => {
  assert.equal(
    await sourceHash({ 'a.ts': 'a', 'readonly.ts': 'one' }, ['a.ts']),
    await sourceHash({ 'a.ts': 'a', 'readonly.ts': 'two' }, ['a.ts'])
  );
});

test('treats a missing editable file as an empty string', async () => {
  assert.equal(
    await sourceHash({}, ['missing.ts']),
    await sha256Hex(JSON.stringify([['missing.ts', '']]))
  );
});
