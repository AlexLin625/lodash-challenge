import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeVisibleFiles } from './editor-files.ts';

// Small bundle helper: keys are inserted in scrambled order on purpose so the
// tests prove the outputs are sorted, not input-ordered.
const SOURCE = (body = '') => body;

test('one-hop: readonly files imported by editable files become visible', () => {
  const files = {
    'src/compat/array/mean.ts': SOURCE("import sum from '../math/sum.ts';\nexport default sum;"),
    'src/compat/math/sum.ts': SOURCE('export default function sum() {}'),
  };
  const { visible, hidden } = computeVisibleFiles(
    files,
    ['src/compat/array/mean.ts'],
    ['src/compat/math/sum.ts']
  );
  assert.deepEqual(visible, ['src/compat/array/mean.ts', 'src/compat/math/sum.ts']);
  assert.deepEqual(hidden, []);
});

test('two-hop: transitive readonly imports stay in the closure', () => {
  const files = {
    'src/compat/mean.ts': SOURCE("import sum from './math/sum.ts';"),
    'src/compat/math/sum.ts': SOURCE("import baseSum from '../_internal/baseSum.ts';"),
    'src/compat/_internal/baseSum.ts': SOURCE('export default 0;'),
  };
  const { visible, hidden } = computeVisibleFiles(
    files,
    ['src/compat/mean.ts'],
    ['src/compat/math/sum.ts', 'src/compat/_internal/baseSum.ts']
  );
  assert.deepEqual(visible, [
    'src/compat/_internal/baseSum.ts',
    'src/compat/math/sum.ts',
    'src/compat/mean.ts',
  ]);
  assert.deepEqual(hidden, []);
});

test('unrelated _internal files are hidden even though they sit in the bundle', () => {
  const files: Record<string, string> = {
    'src/compat/mean.ts': SOURCE("import isArrayLike from './_internal/isArrayLike.ts';"),
    'src/compat/_internal/isArrayLike.ts': SOURCE('export default true;'),
    'src/compat/_internal/arrays.ts': SOURCE('export default [];'),
    'src/compat/_internal/falsey.ts': SOURCE('export default [undefined];'),
    'src/compat/_internal/symbol.ts': SOURCE('export default Symbol.iterator;'),
  };
  const readonlyFiles = Object.keys(files).filter((p) => p !== 'src/compat/mean.ts');
  const { visible, hidden } = computeVisibleFiles(files, ['src/compat/mean.ts'], readonlyFiles);
  assert.deepEqual(visible, ['src/compat/_internal/isArrayLike.ts', 'src/compat/mean.ts']);
  assert.deepEqual(hidden, [
    'src/compat/_internal/arrays.ts',
    'src/compat/_internal/falsey.ts',
    'src/compat/_internal/symbol.ts',
  ]);
});

test('circular imports terminate and share one visibility outcome', () => {
  const files = {
    'src/a.ts': SOURCE("import { b } from './b.ts';"),
    'src/b.ts': SOURCE("import { a } from './a.ts';\nexport const b = 1;"),
  };
  const { visible, hidden } = computeVisibleFiles(files, ['src/a.ts'], ['src/b.ts']);
  assert.deepEqual(visible, ['src/a.ts', 'src/b.ts']);
  assert.deepEqual(hidden, []);

  // A cycle nobody in the closure enters remains hidden.
  const orphan = {
    'src/entry.ts': SOURCE('export const x = 1;'),
    'src/c1.ts': SOURCE("import './c2.ts';"),
    'src/c2.ts': SOURCE("import './c1.ts';"),
  };
  const orphanResult = computeVisibleFiles(orphan, ['src/entry.ts'], ['src/c1.ts', 'src/c2.ts']);
  assert.deepEqual(orphanResult.visible, ['src/entry.ts']);
  assert.deepEqual(orphanResult.hidden, ['src/c1.ts', 'src/c2.ts']);
});

test('spec and runtime files stay hidden even when a starter import references them', () => {
  const files = {
    // Pathological but instructive: the starter itself reaches into spec and
    // runtime scope; those targets must not become editor tabs.
    'src/compat/mean.ts': SOURCE(
      "import helpers from './mean.spec.ts';\nimport rt from '../runtime/test-runtime.ts';"
    ),
    'src/compat/mean.spec.ts': SOURCE("import util from './_internal/util.ts';"),
    'runtime/test-runtime.ts': SOURCE('export default {};'),
    'src/compat/_internal/util.ts': SOURCE('export default {};'),
  };
  const { visible, hidden } = computeVisibleFiles(
    files,
    ['src/compat/mean.ts'],
    ['src/compat/mean.spec.ts', 'runtime/test-runtime.ts', 'src/compat/_internal/util.ts']
  );
  // The spec's own import must not leak util into the closure either.
  assert.deepEqual(visible, ['src/compat/mean.ts']);
  assert.deepEqual(hidden, [
    'runtime/test-runtime.ts',
    'src/compat/_internal/util.ts',
    'src/compat/mean.spec.ts',
  ]);
});

test('specifiers without the .ts suffix and ../a/b style paths resolve', () => {
  const files = {
    'src/compat/array/mean.ts': SOURCE(
      "import sum from '../math/sum';\nimport type List from '../math/list';"
    ),
    'src/compat/math/sum.ts': SOURCE('export default 0;'),
    'src/compat/math/list.ts': SOURCE('export type List = number[];'),
  };
  const readonlyFiles = ['src/compat/math/sum.ts', 'src/compat/math/list.ts'];
  const { visible, hidden } = computeVisibleFiles(files, ['src/compat/array/mean.ts'], readonlyFiles);
  assert.deepEqual(hidden, []);
  assert.equal(visible.length, 3);
});

test('directory specifiers resolve to index.ts', () => {
  const files = {
    'src/compat/mean.ts': SOURCE("import { sum } from './math';"),
    'src/compat/math/index.ts': SOURCE("export { sum } from './sum.ts';"),
    'src/compat/math/sum.ts': SOURCE('export const sum = 0;'),
  };
  const { visible } = computeVisibleFiles(files, ['src/compat/mean.ts'], [
    'src/compat/math/index.ts',
    'src/compat/math/sum.ts',
  ]);
  assert.deepEqual(visible, [
    'src/compat/math/index.ts',
    'src/compat/math/sum.ts',
    'src/compat/mean.ts',
  ]);
});

test('unknown or out-of-bundle specifiers are skipped without throwing', () => {
  const files = {
    'src/compat/mean.ts': SOURCE(
      [
        "import lodash from 'lodash';", // bare package: ignored
        "import nope from './does-not-exist.ts';", // no key, no .ts/index.ts hit
        "import up from '../../escape.ts';", // above the bundle root
        "export { x } from '../sibling/dir';", // directory without index.ts
      ].join('\n')
    ),
  };
  const { visible, hidden } = computeVisibleFiles(files, ['src/compat/mean.ts'], []);
  assert.deepEqual(visible, ['src/compat/mean.ts']);
  assert.deepEqual(hidden, []);
});

test('outputs are sorted by path and partition the bundle keys', () => {
  const files: Record<string, string> = {
    'src/z.ts': SOURCE(''),
    'src/b/inner.ts': SOURCE(''),
    'runtime/boot.ts': SOURCE(''),
    'src/a.ts': SOURCE(''),
    'm.ts': SOURCE(''),
    'src/compat/x.spec.ts': SOURCE(''),
  };
  const allKeys = Object.keys(files);
  const { visible, hidden } = computeVisibleFiles(
    files,
    ['m.ts', 'src/z.ts'],
    allKeys.filter((p) => !['m.ts', 'src/z.ts'].includes(p))
  );
  assert.deepEqual(visible, ['m.ts', 'src/z.ts']);
  assert.deepEqual(hidden, allKeys.slice().sort().filter((p) => !visible.includes(p)));
  const sorted = (xs: string[]) => xs.slice().sort();
  assert.deepEqual(visible, sorted(visible));
  assert.deepEqual(hidden, sorted(hidden));
  assert.equal(visible.length + hidden.length, allKeys.length);
});
