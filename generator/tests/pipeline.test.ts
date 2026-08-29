import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGeneratorConfig } from '../src/config.ts';
import { buildChallenge, determinismSummary } from '../src/generate.ts';
import { hashOfParts, sha256Hex } from '../src/hash.ts';
import { TEST_RUNTIME_BUNDLE_PATH } from '../src/paths.ts';
import type { BuiltChallenge } from '../src/types.ts';

const configFile = loadGeneratorConfig();
const REQUIRED_CATEGORIES = ['array', 'string', 'math', 'object', 'predicate'];

async function buildAll(verify: boolean): Promise<BuiltChallenge[]> {
  const built: BuiltChallenge[] = [];
  for (const config of configFile.challenges) {
    built.push(await buildChallenge(config, configFile.upstream, configFile.generatorVersion, { verify }));
  }
  return built;
}

test('every configured challenge either builds and passes all validation checks or reports unsupported reasons', async () => {
  assert.ok(configFile.challenges.length >= 20);
  for (const config of configFile.challenges) {
    const built = await buildChallenge(config, configFile.upstream, configFile.generatorVersion, { verify: true });
    if (built.classification === 'unsupported') {
      assert.ok(built.unsupportedReasons.length > 0, `${config.id} must explain why it is unsupported`);
      continue;
    }
    assert.ok(built.validation, `expected validation for ${config.id}`);
    assert.equal(built.validation.ok, true, `${config.id}: ${JSON.stringify(built.validation.checks, null, 2)}`);
    assert.ok(built.files.has(config.sourcePath), `starter file present for ${config.id}`);
    assert.ok(built.files.has(TEST_RUNTIME_BUNDLE_PATH));
  }
});

test('the catalog covers at least 20 supported challenges across all five domains', async () => {
  const built = await buildAll(false);
  const supported = built.filter((b) => b.classification !== 'unsupported');
  assert.ok(supported.length >= 20, `expected >= 20 supported challenges, got ${supported.length}`);
  const categories = new Set(supported.map((b) => b.manifest.category));
  for (const category of REQUIRED_CATEGORIES) {
    assert.ok(categories.has(category), `category "${category}" is covered`);
  }
});

test('the seed single-function and remove-helpers classifications are unchanged', async () => {
  const expected = new Map([
    ['compat-array-compact', 'single-function'],
    ['compat-array-dropWhile', 'function-with-helpers'],
  ]);
  for (const [id, classification] of expected) {
    const config = configFile.challenges.find((c) => c.id === id)!;
    const built = await buildChallenge(config, configFile.upstream, configFile.generatorVersion, { verify: false });
    assert.equal(built.classification, classification);
  }
});

test('manifest exposes the expected fields and integrity hashes', async () => {
  const config = configFile.challenges.find((c) => c.id === 'compat-array-compact')!;
  const built = await buildChallenge(config, configFile.upstream, configFile.generatorVersion, { verify: false });

  assert.equal(built.manifest.id, 'compat-array-compact');
  assert.equal(built.manifest.entryFile, config.sourcePath);
  assert.deepEqual(built.manifest.editableFiles, [config.sourcePath]);
  assert.ok(built.manifest.readonlyFiles.includes(config.tests.sourcePaths[0]));
  assert.equal(built.manifest.upstream.commit, configFile.upstream.commit);
  assert.equal(built.manifest.upstream.repository, configFile.upstream.repository);
  assert.match(built.manifest.challengeVersion, /^[0-9a-f]{64}$/);
  assert.equal(built.manifest.integrity.starterHash, sha256Hex(built.entryContent));
  assert.equal(built.manifest.runtime.testAdapter, 'jest-subset-v1');
  assert.ok(built.manifest.description.length > 0);
});

test('documentation-mode manifests carry deterministic hints without implementation code', async () => {
  const built = await buildAll(false);
  const documented = built.filter((b) => {
    if (b.classification === 'unsupported') {
      return false;
    }
    const config = configFile.challenges.find((c) => c.id === b.id)!;
    return config.hints.mode === 'documentation';
  });
  assert.ok(documented.length > 0);
  for (const challenge of documented) {
    const config = configFile.challenges.find((c) => c.id === challenge.id)!;
    const hints = challenge.manifest.hints;
    assert.ok(hints.length >= 1, `${challenge.id} has at least one hint`);
    assert.ok(hints.length <= config.hints.maxLevel, `${challenge.id} respects hints.maxLevel`);
    hints.forEach((hint, index) => {
      assert.equal(hint.level, index + 1, `${challenge.id} hint levels are contiguous and ascending`);
      assert.equal(hint.source, 'documentation');
      assert.ok(!/\breturn\b.*;|\bconst \w+ =|=>/.test(hint.text), `${challenge.id} level ${hint.level} hint carries no code`);
    });
  }
});

test('challengeVersion changes when the starter changes', async () => {
  const config = configFile.challenges.find((c) => c.id === 'compat-array-compact')!;
  const a = await buildChallenge(config, configFile.upstream, configFile.generatorVersion, { verify: false });
  const changedConfig = { ...config, targetExport: 'compact', overrides: { returnType: 'number[]' } };
  const b = await buildChallenge(changedConfig, configFile.upstream, configFile.generatorVersion, { verify: false });
  assert.notEqual(a.manifest.challengeVersion, b.manifest.challengeVersion);
});

test('challengeVersion changes when the upstream commit changes', async () => {
  const config = configFile.challenges.find((c) => c.id === 'compat-array-compact')!;
  const a = await buildChallenge(config, configFile.upstream, configFile.generatorVersion, { verify: false });
  const otherCommit = await buildChallenge(config, { ...configFile.upstream, commit: 'deadbeef' }, configFile.generatorVersion, { verify: false });
  assert.notEqual(a.manifest.challengeVersion, otherCommit.manifest.challengeVersion);
});

test('the same inputs rebuild byte-identical bundles (determinism)', async () => {
  const first = await buildAll(false);
  const second = await buildAll(false);
  for (let i = 0; i < first.length; i++) {
    const a = first[i];
    const b = second[i];
    assert.equal(a.classification, b.classification);
    if (a.classification === 'unsupported') {
      assert.deepEqual(a.unsupportedReasons, b.unsupportedReasons);
      continue;
    }
    assert.equal(a.contentHash, b.contentHash, `content hash stable for ${a.id}`);
    assert.equal(a.manifest.challengeVersion, b.manifest.challengeVersion);
    assert.equal(JSON.stringify(a.manifest.hints), JSON.stringify(b.manifest.hints), `hints stable for ${a.id}`);
    for (const [filePath, content] of a.files) {
      assert.equal(b.files.get(filePath), content, `file ${filePath} stable for ${a.id}`);
    }
  }
});

test('determinism summary is stable and only covers supported challenges', async () => {
  const built = await buildAll(false);
  const supported = built.filter((b) => b.classification !== 'unsupported');
  assert.equal(determinismSummary(supported), determinismSummary(supported));
  assert.ok(determinismSummary(supported).includes('compat-array-compact'));
});

test('config hash is part of challengeVersion composition', async () => {
  const config = configFile.challenges.find((c) => c.id === 'compat-array-compact')!;
  const built = await buildChallenge(config, configFile.upstream, configFile.generatorVersion, { verify: false });
  const recomposed = hashOfParts([
    configFile.upstream.commit,
    configFile.generatorVersion,
    built.manifest.integrity.configHash,
    built.manifest.integrity.starterHash,
    built.manifest.integrity.testsHash,
  ]);
  assert.equal(built.manifest.challengeVersion, recomposed);
});
