import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { analyzeSource } from '../src/analyzer.ts';
import { transformSource } from '../src/transform.ts';
import { createUpstreamResolver, inlineTypeImports } from '../src/typeInline.ts';
import { internalImportSpecifiers } from '../src/validate.ts';
import { loadGeneratorConfig } from '../src/config.ts';
import { buildChallenge } from '../src/generate.ts';
import { withFixture, baseConfig } from './helpers.ts';

const UPSTREAM = path.resolve('external', 'es-toolkit');

function run(starterText: string, root: string, starterPath = 'lib/target.ts') {
  return inlineTypeImports(starterText, starterPath, createUpstreamResolver(root));
}

test('inlines an interface verbatim (JSDoc + generic constraints)', async () => {
  const files = {
    'lib/box.ts': `/** A boxed key. */
export interface Box<K extends string | number> {
  key: K;
}
`,
  };
  const starter = `import { Box } from './box.ts';
export function unwrap<K extends PropertyKey>(box: Box<K>): K {
  void box;
  return undefined as unknown as K;
}
`;
  await withFixture(files, (root) => {
    const { content, report } = run(starter, root);
    assert.ok(content.includes('/** A boxed key. */\nexport interface Box<K extends string | number> {'), 'declaration injected verbatim');
    assert.ok(!content.includes("import { Box } from './box.ts';"), 'type-only import removed');
    assert.deepEqual(report.inlinedTypes, ['Box']);
    assert.deepEqual(report.warnings, []);
  });
});

test('inlines a two-hop type alias chain through re-exports in topological order', async () => {
  const files = {
    'lib/alpha.ts': `import { Beta } from './beta.ts';
export type Alpha = { v: Beta };
`,
    'lib/beta.ts': `import { Gamma } from './gamma.ts';
type Beta = { g: Gamma };
export { Beta };
`,
    'lib/gamma.ts': `export type Gamma = string;
`,
  };
  const starter = `import { Alpha } from './alpha.ts';
export function use(a: Alpha): string {
  void a;
  return '';
}
`;
  await withFixture(files, (root) => {
    const { content, report } = run(starter, root);
    assert.deepEqual(report.inlinedTypes, ['Gamma', 'Beta', 'Alpha']);
    const idxGamma = content.indexOf('export type Gamma = string;');
    const idxBeta = content.indexOf('type Beta = { g: Gamma };');
    const idxAlpha = content.indexOf('export type Alpha = { v: Beta };');
    assert.ok(idxGamma >= 0 && idxGamma < idxBeta && idxBeta < idxAlpha, 'injected in topological order');
    assert.ok(!content.includes('import {'), 'no imports remain');
    assert.deepEqual(report.warnings, []);
  });
});

test('injects a type shared by two imports exactly once', async () => {
  const files = {
    'lib/s1.ts': `import { Shared } from './shared.ts';
export type S1 = { a: Shared };
`,
    'lib/s2.ts': `import { Shared } from './shared.ts';
export type S2 = { b: Shared };
`,
    'lib/shared.ts': `export type Shared = number;
`,
  };
  const starter = `import { S1 } from './s1.ts';
import { S2 } from './s2.ts';
export function both(a: S1, b: S2): number {
  void a;
  void b;
  return 0;
}
`;
  await withFixture(files, (root) => {
    const { content, report } = run(starter, root);
    const occurrences = content.split('export type Shared = number;').length - 1;
    assert.equal(occurrences, 1, 'Shared injected once');
    assert.deepEqual(report.inlinedTypes, ['Shared', 'S1', 'S2']);
    assert.ok(!content.includes("import { S1 }"), 'S1 import removed');
    assert.ok(!content.includes("import { S2 }"), 'S2 import removed');
  });
});

test('mixed value/type import keeps the value binding and inlines only the type', async () => {
  const files = {
    'lib/mod.ts': `export function make(): number {
  return 1;
}
export type Kind = 'a' | 'b';
`,
  };
  const starter = `import { make, Kind } from './mod.ts';
export function f(k: Kind = make() as Kind): number {
  void k;
  return 0;
}
`;
  await withFixture(files, (root) => {
    const { content, report } = run(starter, root);
    assert.ok(content.includes("import { make } from './mod.ts';"), 'value binding kept');
    assert.ok(!content.includes('Kind }'), 'type binding removed');
    assert.ok(content.includes(`export type Kind = 'a' | 'b';`), 'Kind inlined');
    assert.deepEqual(report.inlinedTypes, ['Kind']);
    assert.deepEqual(report.removedImports, [], 'declaration not removed (mixed)');
  });
});

test('unresolvable type imports are preserved and reported as warnings', async () => {
  const starter = `import { Ghost } from './ghost.ts';
export function f(x: Ghost): number {
  void x;
  return 0;
}
`;
  await withFixture({}, (root) => {
    const { content, report } = run(starter, root);
    assert.equal(content, starter, 'starter text preserved unchanged');
    assert.equal(report.warnings.length, 1);
    assert.equal(report.warnings[0].binding, 'Ghost');
    assert.ok(report.warnings[0].reason.includes('could not be resolved'));
    assert.deepEqual(report.inlinedTypes, []);
  });
});

test('value exports used in type positions are preserved with a warning', async () => {
  const files = {
    'lib/mod.ts': `export const Config = { a: 1 };
`,
  };
  const starter = `import { Config } from './mod.ts';
export type Snapshot = typeof Config;
export function f(x: Snapshot): number {
  void x;
  return 0;
}
`;
  await withFixture(files, (root) => {
    const { content, report } = run(starter, root);
    assert.ok(content.includes("import { Config } from './mod.ts';"), 'import kept');
    assert.equal(report.warnings.length, 1);
    assert.match(report.warnings[0].reason, /value/);
  });
});

test('inlineTypeImports output is byte-stable across runs', async () => {
  const starter = `import { identity } from '../../function/identity.ts';
import { ListIteratee } from '../_internal/ListIteratee.ts';
export function dropWhile<T>(array: ArrayLike<T> | null | undefined, predicate: ListIteratee<T> = identity): T[] {
  void array;
  void predicate;
  return undefined as unknown as T[];
}
`;
  const first = run(starter, UPSTREAM, 'src/compat/array/dropWhile.ts');
  const second = run(starter, UPSTREAM, 'src/compat/array/dropWhile.ts');
  assert.equal(first.content, second.content);
  assert.deepEqual(first.report.inlinedTypes, second.report.inlinedTypes);
  assert.ok(second.content.includes('export type ListIteratee'), 'sanity: inlined');
});

test('transformSource inlines _internal types for the real dropWhile source but keeps the identity import', () => {
  const config = baseConfig('src/compat/array/dropWhile.ts', 'dropWhile', { removableExports: [] });
  const attempt = () => {
    const analysis = analyzeSource(config, UPSTREAM);
    return transformSource(config, analysis, createUpstreamResolver(UPSTREAM));
  };
  const first = attempt();
  const second = attempt();
  assert.equal(first.content, second.content);
  assert.ok(first.content.includes('export type ListIteratee'), 'ListIteratee inlined');
  assert.ok(first.content.includes('export type PartialShallow'), 'closure dependency inlined');
  assert.ok(first.content.includes("import { identity } from '../../function/identity.ts';"), 'value import preserved');
  assert.ok(!first.content.includes('_internal'), 'no _internal import remains');
  assert.deepEqual(first.report.inlinedTypes, ['PartialShallow', 'ListIteratee']);
  assert.ok(first.report.removedImports.some((i) => i.includes('ListIteratee.ts')), 'removed import reported');
  assert.ok(!first.report.keptImports.some((i) => i.includes('ListIteratee')), 'keptImports updated');
});

test('validate rejects leftover _internal imports in starters', () => {
  assert.deepEqual(internalImportSpecifiers(`import { X } from '../_internal/x.ts';\nexport function f(x: X): number { void x; return 0; }`), ['../_internal/x.ts']);
  assert.deepEqual(internalImportSpecifiers(`import { Y } from './_internal/y.ts';\nexport function f(y: Y): number { void y; return 0; }`), ['./_internal/y.ts']);
  assert.deepEqual(internalImportSpecifiers(`import { Z } from '../internalish/z.ts';\nexport function f(z: Z): number { void z; return 0; }`), []);
  assert.deepEqual(internalImportSpecifiers('export type Local = number;\nexport function f(x: Local): number { void x; return 0; }'), []);
});

test('the dropWhile challenge validates cleanly with the new §7 _internal check', async () => {
  const configFile = loadGeneratorConfig();
  const config = configFile.challenges.find((c) => c.id === 'compat-array-dropWhile')!;
  const built = await buildChallenge(config, configFile.upstream, configFile.generatorVersion, { verify: true });
  assert.ok(built.validation);
  const internalCheck = built.validation!.checks.find((c) => c.name.includes('_internal'));
  assert.ok(internalCheck, 'the _internal check runs');
  assert.equal(internalCheck.passed, true, internalCheck.detail);
  assert.equal(built.validation!.ok, true, JSON.stringify(built.validation!.checks.filter((c) => !c.passed), null, 2));
  assert.ok(built.entryContent.includes("import { identity } from '../../function/identity.ts';"), 'identity value import survives');
  assert.ok(!/from\s+'[^']*_internal\//.test(built.entryContent), 'no _internal import in the starter');
  assert.ok(built.manifest.readonlyFiles.includes('src/function/identity.ts'), 'identity readonly file still ships');
});
