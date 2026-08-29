import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorPreview, nextErrorDetailLevel } from './test-panel-logic.ts';

test('error details cycle through hidden, preview, full, then hidden', () => {
  assert.equal(nextErrorDetailLevel('hidden'), 'preview');
  assert.equal(nextErrorDetailLevel('preview'), 'full');
  assert.equal(nextErrorDetailLevel('full'), 'hidden');
});

test('error preview keeps the first three lines and marks truncation', () => {
  assert.equal(errorPreview('one\ntwo\nthree\nfour'), 'one\ntwo\nthree\n…');
  assert.equal(errorPreview('one\ntwo'), 'one\ntwo');
});
