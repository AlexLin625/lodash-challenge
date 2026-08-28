import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGeneratorConfig } from '../src/config.ts';
import { buildChallenge, determinismSummary } from '../src/generate.ts';
import { hashOfParts, sha256Hex } from '../src/hash.ts';
import { TEST_RUNTIME_BUNDLE_PATH } from '../src/paths.ts';

const configFile = loadGeneratorConfig();

test('pipeline builds both configured challenges and passes all validation checks', async () => {
  assert.ok(configFile.challenges.length >= 2);
  for (const config of configFile.challenges) {
    const built = await buildChallenge(config, configFile.upstream, configFile.generatorVersion, { verify: true });
    assert.equal(built.classification, config.id === 'compat-array-compact' ? 'single-function' : 'function-with-helpers');
    assert.ok(built.validation, `expected validation for ${config.id}`);
    assert.equal(built.validation.ok, true, `${config.id}: ${JSON.stringify(built.validation.checks, null, 2)}`);
    assert.ok(built.files.has(config.sourcePath), `starter file present for ${config.id}`);
    assert.ok(built.files.has(TEST_RUNTIME_BUNDLE_PATH));
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
  for (const config of configFile.challenges) {
    const first = await buildChallenge(config, configFile.upstream, configFile.generatorVersion, { verify: false });
    const second = await buildChallenge(config, configFile.upstream, configFile.generatorVersion, { verify: false });
    assert.equal(first.contentHash, second.contentHash, `content hash stable for ${config.id}`);
    assert.equal(first.manifest.challengeVersion, second.manifest.challengeVersion);
    for (const [filePath, content] of first.files) {
      assert.equal(second.files.get(filePath), content, `file ${filePath} stable for ${config.id}`);
    }
  }
});

test('determinism summary is stable', async () => {
  const built: Awaited<ReturnType<typeof buildChallenge>>[] = [];
  for (const config of configFile.challenges) {
    built.push(await buildChallenge(config, configFile.upstream, configFile.generatorVersion, { verify: false }));
  }
  assert.equal(determinismSummary(built), determinismSummary(built));
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
