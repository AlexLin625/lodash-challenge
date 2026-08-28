import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeSource } from '../src/analyzer.ts';
import { transformSource } from '../src/transform.ts';
import { withFixture, baseConfig } from './helpers.ts';

const UPSTREAM = path.resolve('external', 'es-toolkit');

test('classifies a single-function file', async () => {
  const source = `import { helper } from './helper.ts';
export function add(a: number, b: number): number {
  return helper(a) + b;
}
`;
  await withFixture({ 'lib/add.ts': source }, (root) => {
    const result = analyzeSource(baseConfig('lib/add.ts', 'add'), root);
    assert.equal(result.analysis.classification, 'single-function');
    assert.deepEqual(result.analysis.unsupportedReasons, []);
    assert.equal(result.internal.helpers.length, 0);
    assert.equal(result.analysis.runtimeFunctions.length, 1);
    assert.equal(result.analysis.runtimeFunctions[0].isTarget, true);
  });
});

test('classifies a file with a private helper as function-with-helpers', async () => {
  const source = `import { useThing } from './useThing.ts';
export function main(x: number): number {
  return helperFn(x) + useThing(x);
}
function helperFn(x: number): number {
  return x * 2;
}
`;
  await withFixture({ 'lib/main.ts': source }, (root) => {
    const result = analyzeSource(baseConfig('lib/main.ts', 'main'), root);
    assert.equal(result.analysis.classification, 'function-with-helpers');
    assert.deepEqual(result.internal.helpers.map((h) => h.name), ['helperFn']);
  });
});

test('marks overloaded exports as unsupported', async () => {
  const source = `export function head<T>(array: readonly [T, ...unknown[]]): T;
export function head<T>(array: ArrayLike<T> | null | undefined): T | undefined {
  return array?.[0];
}
`;
  await withFixture({ 'lib/head.ts': source }, (root) => {
    const result = analyzeSource(baseConfig('lib/head.ts', 'head'), root);
    assert.equal(result.analysis.classification, 'unsupported');
    assert.ok(result.analysis.unsupportedReasons.some((r) => r.includes('overload')));
  });
});

test('marks generator exports as unsupported', async () => {
  const source = `export function* gen(): Generator<number> {
  yield 1;
}
`;
  await withFixture({ 'lib/gen.ts': source }, (root) => {
    const result = analyzeSource(baseConfig('lib/gen.ts', 'gen'), root);
    assert.equal(result.analysis.classification, 'unsupported');
    assert.ok(result.analysis.unsupportedReasons.some((r) => r.includes('generator')));
  });
});

test('marks async exports as unsupported in the first batch', async () => {
  const source = `export async function fetchData(): Promise<number> {
  return 1;
}
`;
  await withFixture({ 'lib/fetch.ts': source }, (root) => {
    const result = analyzeSource(baseConfig('lib/fetch.ts', 'fetchData'), root);
    assert.equal(result.analysis.classification, 'unsupported');
    assert.ok(result.analysis.unsupportedReasons.some((r) => r.includes('async')));
  });
});

test('marks multiple public exports as unsupported unless listed in removableExports', async () => {
  const source = `export function main(): number {
  return 1;
}
export function other(): number {
  return 2;
}
`;
  await withFixture({ 'lib/multi.ts': source }, (root) => {
    const blocked = analyzeSource(baseConfig('lib/multi.ts', 'main'), root);
    assert.equal(blocked.analysis.classification, 'unsupported');
    assert.ok(blocked.analysis.unsupportedReasons.some((r) => r.includes('multiple public exports')));

    const allowed = analyzeSource(baseConfig('lib/multi.ts', 'main', { removableExports: ['other'] }), root);
    assert.equal(allowed.analysis.classification, 'function-with-helpers');
    assert.deepEqual(allowed.internal.helpers.map((h) => h.name), ['other']);
  });
});

test('marks a target with no explicit return type as unsupported', async () => {
  const source = `export function weird(a: number) {
  return a;
}
`;
  await withFixture({ 'lib/weird.ts': source }, (root) => {
    const result = analyzeSource(baseConfig('lib/weird.ts', 'weird'), root);
    assert.equal(result.analysis.classification, 'unsupported');
    assert.ok(result.analysis.unsupportedReasons.some((r) => r.includes('return type')));
  });
});

test('marks a missing target export as unsupported', async () => {
  const source = `export function other(): number {
  return 1;
}
`;
  await withFixture({ 'lib/other.ts': source }, (root) => {
    const result = analyzeSource(baseConfig('lib/other.ts', 'missing'), root);
    assert.equal(result.analysis.classification, 'unsupported');
    assert.ok(result.analysis.unsupportedReasons.some((r) => r.includes('not found')));
  });
});

test('analyzes the real compact source as single-function', () => {
  const result = analyzeSource(baseConfig('src/compat/array/compact.ts', 'compact'), UPSTREAM);
  assert.equal(result.analysis.classification, 'single-function');
  assert.equal(result.analysis.targetExport, 'compact');
});

test('analyzes the real dropWhile source as function-with-helpers', () => {
  const result = analyzeSource(baseConfig('src/compat/array/dropWhile.ts', 'dropWhile'), UPSTREAM);
  assert.equal(result.analysis.classification, 'function-with-helpers');
  assert.deepEqual(result.internal.helpers.map((h) => h.name), ['dropWhileImpl']);
});

test('transforms a single-function file into a stub with void params and return placeholder', async () => {
  const source = `import { helper } from './helper.ts';
export function add<T>(a: T, b: number): T[] {
  return helper(a);
}
`;
  await withFixture({ 'lib/add.ts': source }, (root) => {
    const result = analyzeSource(baseConfig('lib/add.ts', 'add'), root);
    const { content, report } = transformSource(baseConfig('lib/add.ts', 'add'), result);
    assert.match(content, /export function add<T>\(a: T, b: number\): T\[\]/);
    assert.match(content, /void a;/);
    assert.match(content, /void b;/);
    assert.match(content, /return undefined as unknown as T\[\];/);
    assert.doesNotMatch(content, /helper/);
    assert.deepEqual(report.removedImports, ["import { helper } from './helper.ts';"]);
    assert.equal(report.keptImports.length, 0);
  });
});

test('transforms destructuring and rest parameters into void statements', async () => {
  const source = `export function config({ a, b }: { a: number; b: number }, ...rest: number[]): number {
  return a + b;
}
`;
  await withFixture({ 'lib/config.ts': source }, (root) => {
    const result = analyzeSource(baseConfig('lib/config.ts', 'config'), root);
    const { content } = transformSource(baseConfig('lib/config.ts', 'config'), result);
    assert.match(content, /void a;/);
    assert.match(content, /void b;/);
    assert.match(content, /void rest;/);
    assert.match(content, /return undefined as unknown as number;/);
  });
});

test('does not emit a return placeholder for void functions', async () => {
  const source = `export function log(msg: string): void {
  console.log(msg);
}
`;
  await withFixture({ 'lib/log.ts': source }, (root) => {
    const result = analyzeSource(baseConfig('lib/log.ts', 'log'), root);
    const { content } = transformSource(baseConfig('lib/log.ts', 'log'), result);
    assert.match(content, /void msg;/);
    assert.doesNotMatch(content, /return/);
  });
});

test('removes private helpers and their imports, keeping signature-referenced imports', async () => {
  const source = `import { dropWhileToolkit } from '../../array/dropWhile.ts';
import { identity } from '../../function/identity.ts';
import { ListIteratee } from '../_internal/ListIteratee.ts';
import { toArray } from '../_internal/toArray.ts';

export function dropWhile<T>(array: ArrayLike<T> | null | undefined, predicate: ListIteratee<T> = identity): T[] {
  return dropWhileImpl(toArray(array), predicate);
}

function dropWhileImpl<T>(arr: readonly T[], predicate: ListIteratee<T>): T[] {
  return dropWhileToolkit(arr, predicate);
}
`;
  await withFixture({ 'lib/dropWhile.ts': source }, (root) => {
    const result = analyzeSource(baseConfig('lib/dropWhile.ts', 'dropWhile'), root);
    const { content, report } = transformSource(baseConfig('lib/dropWhile.ts', 'dropWhile'), result);
    assert.doesNotMatch(content, /dropWhileImpl/);
    assert.doesNotMatch(content, /dropWhileToolkit/);
    assert.doesNotMatch(content, /toArray/);
    assert.match(content, /import \{ identity \} from '\.\.\/\.\.\/function\/identity\.ts';/);
    assert.match(content, /import \{ ListIteratee \} from '\.\.\/_internal\/ListIteratee\.ts';/);
    assert.deepEqual(report.removedHelpers, ['dropWhileImpl']);
    assert.ok(report.removedImports.some((i) => i.includes('dropWhileToolkit')));
    assert.ok(report.removedImports.some((i) => i.includes('toArray')));
  });
});

test('preserves the public signature of the real compact source', async () => {
  const source = fs.readFileSync(path.join(UPSTREAM, 'src/compat/array/compact.ts'), 'utf8');
  await withFixture({ 'compact.ts': source }, (root) => {
    const result = analyzeSource(baseConfig('compact.ts', 'compact'), root);
    const { content } = transformSource(baseConfig('compact.ts', 'compact'), result);
    assert.ok(content.includes('export function compact<T>(arr: ArrayLike<T | Falsey> | null | undefined): T[]'));
    assert.ok(content.includes('type Falsey = false | null | 0 | 0n | \'\' | undefined;'));
  });
});
