import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUnusedImportBindings } from '../src/unusedImports.ts';

function bindings(sourceText: string): string[] {
  return findUnusedImportBindings(sourceText).map((u) => u.binding);
}

test('no findings for a file without imports', () => {
  assert.deepEqual(bindings('export function f(x: number): number { void x; return 1; }'), []);
});

test('parameter default usages keep the import (dropWhile-style)', () => {
  const source = `import { identity } from '../../function/identity.ts';
import { ListIteratee } from '../_internal/ListIteratee.ts';
export function dropWhile<T>(array: ArrayLike<T> | null | undefined, predicate: ListIteratee<T> = identity): T[] {
  void array;
  void predicate;
  return undefined as unknown as T[];
}
`;
  assert.deepEqual(bindings(source), []);
});

test('type-position usages in signatures keep type imports (flattenDepth-style)', () => {
  const source = `import { ListOfRecursiveArraysOrValues } from '../_internal/ListOfRecursiveArraysOrValues.ts';
export function flattenDepth<T>(array: ListOfRecursiveArraysOrValues<T> | null | undefined, depth: number): T[] {
  void array;
  void depth;
  return undefined as unknown as T[];
}
`;
  assert.deepEqual(bindings(source), []);
});

test('flags a named import that became unreferenced', () => {
  const source = `import { identity } from './i.ts';
export function f(x: number): number {
  void x;
  return 1;
}
`;
  const findings = findUnusedImportBindings(source);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].binding, 'identity');
  assert.equal(findings[0].kind, 'named');
  assert.equal(findings[0].moduleSpecifier, './i.ts');
});

test('JSDoc mentions alone do not count as references', () => {
  const source = `import { identity } from './i.ts';
/**
 * @param [p=identity] see {@link identity}
 */
export function f(x: number): number {
  void x;
  return 1;
}
`;
  assert.deepEqual(bindings(source), ['identity']);
});

test('property names and member accesses do not count as references', () => {
  const source = `import { identity } from './i.ts';
export function f(x: number): number {
  void x;
  const wrapper = { identity: 1 };
  return wrapper.identity;
}
`;
  assert.deepEqual(bindings(source), ['identity']);
});

test('flags unused default and namespace imports', () => {
  const source = `import _ from './mod.ts';
import * as util from './util.ts';
export function f(x: number): number {
  void x;
  return 1;
}
`;
  assert.deepEqual(bindings(source), ['_', 'util']);
});

test('honours import aliases', () => {
  const used = `import { identity as id } from './i.ts';
export function f(x: number = id()): number {
  void x;
  return 1;
}
`;
  assert.deepEqual(bindings(used), []);
  const unused = `import { identity as id } from './i.ts';
const id = 1;
export { id };
export function f(x: number): number {
  void x;
  return 1;
}
`;
  // "id" appears outside the import (the local const shadows it); the checker
  // is intentionally conservative and reports nothing rather than false flags.
  assert.deepEqual(bindings(unused), []);
});

test('mixed declaration only flags the unreferenced bindings', () => {
  const source = `import def, { used, unused } from './mod.ts';
export function f(x: number = used()): number {
  void x;
  void def;
  return 1;
}
`;
  assert.deepEqual(bindings(source), ['unused']);
});

test('side-effect-only imports have no bindings to flag', () => {
  assert.deepEqual(bindings(`import './polyfill.ts';\nexport function f(): number { return 1; }`), []);
});
