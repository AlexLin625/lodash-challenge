import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex, hashOfParts, verifyChallengeIntegrity } from './integrity.ts';

test('sha256Hex matches the well-known empty-string digest', async () => {
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('sha256Hex matches the standard "abc" digest', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('hashOfParts joins parts with a NUL byte', async () => {
  assert.equal(await hashOfParts(['a', 'b']), await sha256Hex('a\u0000b'));
});

test('verifyChallengeIntegrity passes when every hash matches', async () => {
  const entry = 'export function compact() {}';
  const spec = 'describe("compact", () => {});';
  const starterHash = await sha256Hex(entry);
  const testsHash = await hashOfParts([`src/compat/array/compact.spec.ts\n${spec}`]);
  const manifestJson = JSON.stringify({ id: 'c1' });
  const manifestHash = await sha256Hex(manifestJson);

  const manifest = {
    id: 'c1',
    entryFile: 'src/compat/array/compact.ts',
    testPaths: ['src/compat/array/compact.spec.ts'],
    integrity: { starterHash, testsHash, manifestHash },
  };
  const files = { 'src/compat/array/compact.ts': entry, 'src/compat/array/compact.spec.ts': spec };
  const result = await verifyChallengeIntegrity(manifest, files, manifestJson);
  assert.equal(result.ok, true);
});

test('verifyChallengeIntegrity flags a mismatched starter', async () => {
  const entry = 'export function compact() {}';
  const spec = 'describe("compact", () => {});';
  const starterHash = await sha256Hex(entry);
  const testsHash = await hashOfParts([`src/compat/array/compact.spec.ts\n${spec}`]);
  const manifestJson = JSON.stringify({ id: 'c1' });
  const manifestHash = await sha256Hex(manifestJson);

  const manifest = {
    id: 'c1',
    entryFile: 'src/compat/array/compact.ts',
    testPaths: ['src/compat/array/compact.spec.ts'],
    integrity: { starterHash, testsHash, manifestHash },
  };
  const result = await verifyChallengeIntegrity(manifest, { 'src/compat/array/compact.ts': 'tampered', 'src/compat/array/compact.spec.ts': spec }, manifestJson);
  assert.equal(result.ok, false);
  assert.ok(result.checks.find((c) => c.name === 'starterHash matches entry file')?.passed === false);
});
