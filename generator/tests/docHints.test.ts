import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentationHints } from '../src/docHints.ts';
import { canonicalJson } from '../src/hash.ts';

const FULL_DOC = `
/**
 * Checks if the number is within the given range bounds.
 * The range is inclusive of \`start\` and exclusive of \`end\`.
 * Negative and float bounds are supported.
 *
 * @remarks The bounds are normalized so that \`start\` is always the smaller value.
 * @param value - The value to check.
 * @param start - The start of the range.
 * @param end - The end of the range.
 * @returns \`true\` if the number is in the range, \`false\` otherwise.
 *
 * @example
 * inRange(3, 2, 4)
 * const leaked = 'never include example code in hints';
 */
export function inRange(value?: number, start = 0, end?: number): boolean {
  return value! >= start && value! < (end ?? Infinity);
}
`;

const BRIEF_ONLY = `
/**
 * Checks if the value is \`NaN\`.
 * @param value - The value to check.
 */
export function isNaN(value?: unknown): boolean {
  return Number.isNaN(value);
}
`;

const NO_DOC = `
export function magic(a: number, b: number): number {
  return a + b;
}
`;

const NO_DOC_NO_PARAMS = `
export function answer(): number {
  return 42;
}
`;

test('full documentation yields three contiguous levels with documentation source', () => {
  const hints = documentationHints(FULL_DOC, 'inRange', 3);
  assert.equal(hints.length, 3);
  assert.deepEqual(hints.map((h) => h.level), [1, 2, 3]);
  assert.ok(hints.every((h) => h.source === 'documentation'));
  assert.equal(hints[0].text, 'Checks if the number is within the given range bounds.');
  assert.match(hints[1].text, /inclusive of `start`/);
  assert.match(hints[1].text, /normalized so that `start`/);
  assert.match(hints[2].text, /Consider each parameter in turn \(value, start, end\)/);
});

test('hints never contain implementation or example code', () => {
  const hints = documentationHints(FULL_DOC, 'inRange', 3);
  const all = hints.map((h) => h.text).join('\n');
  assert.ok(!all.includes('never include example code'));
  assert.ok(!all.includes('Number.isNaN'));
  assert.ok(!all.includes('return 42'));
  assert.ok(!all.includes('=> '));
});

test('brief-only documentation degrades: the parameter hint moves up to level 2', () => {
  const hints = documentationHints(BRIEF_ONLY, 'isNaN', 3);
  assert.equal(hints.length, 2);
  assert.deepEqual(hints.map((h) => h.level), [1, 2]);
  assert.ok(hints[0].text.includes('Checks if the value is'));
  assert.ok(hints[1].text.includes('(value)'));
});

test('missing JSDoc downgrades: the parameter hint becomes level 1', () => {
  const hints = documentationHints(NO_DOC, 'magic', 3);
  assert.equal(hints.length, 1);
  assert.equal(hints[0].level, 1);
  assert.equal(hints[0].source, 'documentation');
  assert.ok(hints[0].text.includes('(a, b)'));
});

test('no documentation material yields no hints', () => {
  assert.deepEqual(documentationHints(NO_DOC_NO_PARAMS, 'answer', 3), []);
  assert.deepEqual(documentationHints(NO_DOC, 'missing', 3), []);
});

test('maxLevel truncates the hint list', () => {
  assert.deepEqual(documentationHints(FULL_DOC, 'inRange', 1).map((h) => h.level), [1]);
  assert.deepEqual(documentationHints(FULL_DOC, 'inRange', 2).map((h) => h.level), [1, 2]);
});

test('fenced code blocks in the description are stripped from hints', () => {
  const source = `
/**
 * Trims the text.
 *
 * \`\`\`ts
 * const leaked = trim('  x  ');
 * \`\`\`
 *
 * Leading and trailing whitespace is removed.
 */
export function trim(text: string): string { return text.trim(); }
`;
  const hints = documentationHints(source, 'trim', 3);
  const all = hints.map((h) => h.text).join('\n');
  assert.ok(!all.includes('const leaked'));
  assert.ok(all.includes('whitespace is removed'));
});

test('hint generation is deterministic and serializes stably', () => {
  const first = documentationHints(FULL_DOC, 'inRange', 3);
  const second = documentationHints(FULL_DOC, 'inRange', 3);
  assert.equal(canonicalJson(first), canonicalJson(second));
});
