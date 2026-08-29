import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  clampFontSize,
  nextTheme,
  resolveEditorTheme,
  stepFontSize,
  themeLabel,
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

test('nextTheme cycles auto -> vs-dark -> vs -> auto', () => {
  assert.equal(nextTheme('auto'), 'vs-dark');
  assert.equal(nextTheme('vs-dark'), 'vs');
  assert.equal(nextTheme('vs'), 'auto');
});

test('nextTheme keeps the old vs-dark <-> vs adjacency', () => {
  // A user previously toggling light/dark still reaches the other explicit
  // theme in one click; only the wrap now lands on 'auto'.
  assert.equal(nextTheme('vs-dark'), 'vs');
});

test('nextTheme snaps unknown themes into the cycle at vs-dark', () => {
  assert.equal(nextTheme('hc-black'), 'vs-dark');
  assert.equal(nextTheme(''), 'vs-dark');
});

test('resolveEditorTheme follows the system pref only in auto/unknown modes', () => {
  assert.equal(resolveEditorTheme('auto', true), 'vs-dark');
  assert.equal(resolveEditorTheme('auto', false), 'vs');
  assert.equal(resolveEditorTheme('vs-dark', false), 'vs-dark');
  assert.equal(resolveEditorTheme('vs', true), 'vs');
  assert.equal(resolveEditorTheme('monokai', true), 'vs-dark');
  assert.equal(resolveEditorTheme('monokai', false), 'vs');
});

test('themeLabel renders compact labels for the settings button', () => {
  assert.equal(themeLabel('auto', true), 'auto');
  assert.equal(themeLabel('auto', false), 'auto');
  assert.equal(themeLabel('vs-dark', false), 'dark');
  assert.equal(themeLabel('vs', true), 'light');
  // Unknown stored values show what actually renders.
  assert.equal(themeLabel('hc-black', true), 'dark');
  assert.equal(themeLabel('hc-black', false), 'light');
});
