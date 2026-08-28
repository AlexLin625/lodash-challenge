import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runTests } from '../src/testRunner.ts';
import { ASSETS_DIR, TEST_RUNTIME_BUNDLE_PATH } from '../src/paths.ts';

const RUNTIME = fs.readFileSync(path.join(ASSETS_DIR, 'test-runtime.ts'), 'utf8');

function summaryFor(specSource: string) {
  const files = new Map<string, string>();
  files.set(TEST_RUNTIME_BUNDLE_PATH, RUNTIME);
  files.set('not.spec.ts', specSource);
  return runTests(files, ['not.spec.ts'], TEST_RUNTIME_BUNDLE_PATH);
}

const PASSING_ASSERTIONS = [
  'expect(1).not.toBe(2);',
  'expect(1).not.not.toBe(1);',
  'expect(1).not.toBeUndefined();',
  'expect(undefined).not.toBeDefined();',
  'expect(1).not.toBeNull();',
  'expect(0).not.toBeTruthy();',
  'expect(1).not.toBeFalsy();',
  'expect(1).not.toBeNaN();',
  'expect(1).not.toBeGreaterThan(2);',
  'expect(2).not.toBeLessThan(1);',
  'expect(1).not.toBeCloseTo(2, 2);',
  'expect([1, 2]).not.toContain(3);',
  "expect('abc').not.toContain('d');",
  'expect([1]).not.toHaveLength(2);',
  'expect(1).not.toBeInstanceOf(String);',
  "expect({}).not.toHaveProperty('a.b');",
  'expect(() => {}).not.toThrow();',
  "expect(() => { throw new Error('boom'); }).not.toThrow('other');",
  'expect({ a: 1 }).not.toEqual({ a: 2 });',
  'expect({ a: 1 }).not.toStrictEqual({ a: 2 });',
];

const FAILING_ASSERTIONS = [
  'expect(1).not.toBe(1);',
  'expect(undefined).not.toBeUndefined();',
  'expect(1).not.toBeDefined();',
  'expect(1).not.toBeTruthy();',
  'expect(0).not.toBeFalsy();',
  'expect(NaN).not.toBeNaN();',
  'expect(1).not.toBeGreaterThan(0);',
  'expect(1).not.toBeLessThan(2);',
  'expect(1).not.toBeCloseTo(1, 2);',
  'expect([1, 2]).not.toContain(2);',
  "expect('abc').not.toContain('b');",
  'expect([1]).not.toHaveLength(1);',
  'expect([]).not.toBeInstanceOf(Array);',
  "expect({ a: 1 }).not.toHaveProperty('a');",
  "expect(() => { throw new Error('boom'); }).not.toThrow();",
  "expect(() => { throw new Error('boom'); }).not.toThrow('boom');",
  'expect({ a: 1 }).not.toEqual({ a: 1 });',
  'expect({ a: 1 }).not.toStrictEqual({ a: 1 });',
];

function specWith(assertions: string[]): string {
  const tests = assertions
    .map((assertion, i) => `  it('assertion ${i + 1}', () => {\n    ${assertion}\n  });`)
    .join('\n');
  return `import { describe, expect, it } from './runtime/test-runtime.ts';\n\ndescribe('not', () => {\n${tests}\n});\n`;
}

test('`.not` correctly negates every supported matcher (positive cases pass)', async () => {
  const summary = await summaryFor(specWith(PASSING_ASSERTIONS));
  assert.equal(summary.total, PASSING_ASSERTIONS.length);
  assert.equal(summary.failed, 0, `expected all negated assertions to pass, got: ${JSON.stringify(summary.failures)}`);
  assert.equal(summary.passed, PASSING_ASSERTIONS.length);
});

test('`.not` correctly fails assertions that should hold', async () => {
  const summary = await summaryFor(specWith(FAILING_ASSERTIONS));
  assert.equal(summary.total, FAILING_ASSERTIONS.length);
  assert.equal(summary.passed, 0, 'no negated assertion should pass here');
  assert.equal(summary.failed, FAILING_ASSERTIONS.length);
});

test('non-negated assertions keep working after the `.not` refactor', async () => {
  const spec = `import { describe, expect, it } from './runtime/test-runtime.ts';

describe('plain', () => {
  it('passes when values match', () => {
    expect(1).toBe(1);
    expect({ a: 1 }).toEqual({ a: 1 });
    expect(undefined).toBeUndefined();
    expect(() => { throw new Error('boom'); }).toThrow('boom');
  });
  it('fails when values differ', () => {
    expect(1).toBe(2);
  });
});
`;
  const summary = await summaryFor(spec);
  assert.equal(summary.total, 2);
  assert.equal(summary.passed, 1);
  assert.equal(summary.failed, 1);
});
