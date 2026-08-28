import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptTestFile } from '../src/testAdapter.ts';
import { hashOfParts, sha256Hex, canonicalJson } from '../src/hash.ts';

const VITEST_SPEC = `import { describe, expect, it } from 'vitest';
import { compact } from './compact';

describe('compact', () => {
  it('should filter falsey values', () => {
    expect(compact([1, 0])).toEqual([1]);
  });

  it('should return empty for null', () => {
    expect(compact(null)).toEqual([]);
  });
});
`;

test('adapts the vitest import to the internal test runtime', () => {
  const adapted = adaptTestFile(VITEST_SPEC, { runtimeRelativePath: '../../../runtime/test-runtime.ts' });
  assert.ok(adapted.includes("from '../../../runtime/test-runtime.ts'"));
  assert.ok(!adapted.includes("from 'vitest'"));
  assert.ok(adapted.includes('describe('));
  assert.ok(adapted.includes('expect('));
});

test('keeps relative imports untouched', () => {
  const adapted = adaptTestFile(VITEST_SPEC, { runtimeRelativePath: 'runtime/test-runtime.ts' });
  assert.ok(adapted.includes("from './compact'"));
});

test('excludes matching test cases by exact title', () => {
  const adapted = adaptTestFile(VITEST_SPEC, {
    runtimeRelativePath: 'runtime/test-runtime.ts',
    excludedCases: ['should filter falsey values'],
  });
  assert.ok(!adapted.includes('should filter falsey values'));
  assert.ok(adapted.includes('should return empty for null'));
});

test('excludes matching test cases by substring', () => {
  const adapted = adaptTestFile(VITEST_SPEC, {
    runtimeRelativePath: 'runtime/test-runtime.ts',
    excludedCases: ['falsey'],
  });
  assert.ok(!adapted.includes('should filter falsey values'));
  assert.ok(adapted.includes('should return empty for null'));
});

test('sha256 hashes are stable and differ for different inputs', () => {
  assert.equal(sha256Hex('abc'), sha256Hex('abc'));
  assert.notEqual(sha256Hex('abc'), sha256Hex('abd'));
  assert.match(sha256Hex('x'), /^[0-9a-f]{64}$/);
});

test('hashOfParts is order-stable', () => {
  assert.equal(hashOfParts(['a', 'b']), hashOfParts(['a', 'b']));
  assert.notEqual(hashOfParts(['a', 'b']), hashOfParts(['b', 'a']));
});

test('canonicalJson sorts object keys deterministically', () => {
  const a = canonicalJson({ b: 1, a: { d: 1, c: 2 } });
  const b = canonicalJson({ a: { c: 2, d: 1 }, b: 1 });
  assert.equal(a, b);
  assert.equal(sha256Hex(a), sha256Hex(b));
});
