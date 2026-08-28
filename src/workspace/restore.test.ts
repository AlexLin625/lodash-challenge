// Pure tests for the draft-restore decision and merge helpers.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideDraftAction, mergeRestoredFiles } from './restore.ts';

const STARTER: Record<string, string> = {
  'src/index.ts': 'starter index',
  'src/util.ts': 'starter util',
  'test/index.test.ts': 'starter tests',
};
const EDITABLE = ['src/index.ts', 'src/util.ts'];

test('decideDraftAction returns none for null or undefined', () => {
  assert.equal(decideDraftAction(null), 'none');
  assert.equal(decideDraftAction(undefined), 'none');
});

test('decideDraftAction returns seed for an empty stored map', () => {
  assert.equal(decideDraftAction({}), 'seed');
});

test('decideDraftAction returns restore for a non-empty stored map', () => {
  assert.equal(decideDraftAction({ 'src/index.ts': 'typed' }), 'restore');
});

test('mergeRestoredFiles overrides editable paths with draft content', () => {
  const merged = mergeRestoredFiles(STARTER, { 'src/index.ts': 'user edit' }, EDITABLE);
  assert.equal(merged['src/index.ts'], 'user edit');
  assert.equal(merged['src/util.ts'], 'starter util');
  assert.equal(merged['test/index.test.ts'], 'starter tests');
});

test('mergeRestoredFiles ignores read-only tampering in the draft', () => {
  const merged = mergeRestoredFiles(
    STARTER,
    { 'test/index.test.ts': 'hacked tests', 'src/index.ts': 'typed' },
    EDITABLE
  );
  assert.equal(merged['test/index.test.ts'], 'starter tests');
  assert.equal(merged['src/index.ts'], 'typed');
});

test('mergeRestoredFiles ignores non-editable junk keys', () => {
  const merged = mergeRestoredFiles(STARTER, { 'dist/bundle.js': 'junk', '../escape.ts': 'junk' }, EDITABLE);
  assert.deepEqual(Object.keys(merged).sort(), Object.keys(STARTER).sort());
});

test('mergeRestoredFiles accepts editable draft paths missing from the starter', () => {
  const merged = mergeRestoredFiles(STARTER, { 'src/extra.ts': 'legacy file', 'src/index.ts': 'typed' }, [
    ...EDITABLE,
    'src/extra.ts',
  ]);
  assert.equal(merged['src/extra.ts'], 'legacy file');
  assert.equal(merged['src/index.ts'], 'typed');
});

test('mergeRestoredFiles ignores undefined draft values but keeps starter keys', () => {
  const merged = mergeRestoredFiles(
    STARTER,
    { 'src/index.ts': undefined } as unknown as Record<string, string>,
    EDITABLE
  );
  assert.equal(merged['src/index.ts'], 'starter index');
  assert.deepEqual(Object.keys(merged).sort(), Object.keys(STARTER).sort());
});

test('mergeRestoredFiles does not mutate the starter record', () => {
  const starter = { 'src/index.ts': 'starter index' };
  const merged = mergeRestoredFiles(starter, { 'src/index.ts': 'typed' }, ['src/index.ts']);
  assert.equal(starter['src/index.ts'], 'starter index');
  assert.equal(merged['src/index.ts'], 'typed');
});
