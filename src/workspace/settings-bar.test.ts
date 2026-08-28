import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  clampFontSize,
  nextTheme,
  stepFontSize,
} from './settings-logic.ts';

test('stepFontSize steps by the given delta inside the range', () => {
  assert.equal(stepFontSize(14, 1), 15);
  assert.equal(stepFontSize(14, -1), 13);
  assert.equal(stepFontSize(14, 4), 18);
});

test('stepFontSize clamps to the [8, 32] bounds', () => {
  assert.equal(stepFontSize(MAX_FONT_SIZE, 1), MAX_FONT_SIZE);
  assert.equal(stepFontSize(MAX_FONT_SIZE + 10, 1), MAX_FONT_SIZE);
  assert.equal(stepFontSize(MIN_FONT_SIZE, -1), MIN_FONT_SIZE);
  assert.equal(stepFontSize(MIN_FONT_SIZE - 5, -1), MIN_FONT_SIZE);
});

test('clampFontSize keeps values inside the bounds', () => {
  assert.equal(clampFontSize(0), MIN_FONT_SIZE);
  assert.equal(clampFontSize(999), MAX_FONT_SIZE);
  assert.equal(clampFontSize(16), 16);
});

test('nextTheme toggles between vs and vs-dark', () => {
  assert.equal(nextTheme('vs'), 'vs-dark');
  assert.equal(nextTheme('vs-dark'), 'vs');
});

test('nextTheme snaps unknown themes to vs-dark', () => {
  assert.equal(nextTheme('hc-black'), 'vs-dark');
  assert.equal(nextTheme(''), 'vs-dark');
});
