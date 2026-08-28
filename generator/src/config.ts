import fs from 'node:fs';
import path from 'node:path';
import { GENERATOR_DIR } from './paths.ts';
import { canonicalJson, sha256Hex } from './hash.ts';
import type { ChallengeGenerationConfig, GeneratorConfigFile } from './types.ts';

export const DEFAULT_CONFIG_PATH = path.join(GENERATOR_DIR, 'config', 'challenges.json');

export function loadGeneratorConfig(configPath: string = DEFAULT_CONFIG_PATH): GeneratorConfigFile {
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as GeneratorConfigFile;
  validateGeneratorConfig(parsed, configPath);
  return parsed;
}

function validateGeneratorConfig(config: GeneratorConfigFile, configPath: string): void {
  if (!config.upstream || typeof config.upstream.commit !== 'string') {
    throw new Error(`[config] ${configPath}: missing "upstream.commit"`);
  }
  if (typeof config.generatorVersion !== 'string') {
    throw new Error(`[config] ${configPath}: missing "generatorVersion"`);
  }
  if (!Array.isArray(config.challenges)) {
    throw new Error(`[config] ${configPath}: missing "challenges" array`);
  }
  const ids = new Set<string>();
  for (const c of config.challenges) {
    if (!c.id || ids.has(c.id)) {
      throw new Error(`[config] ${configPath}: challenge "id" must be unique and non-empty`);
    }
    ids.add(c.id);
    if (typeof c.sourcePath !== 'string' || typeof c.targetExport !== 'string') {
      throw new Error(`[config] ${configPath}: challenge ${JSON.stringify(c.id)} missing sourcePath/targetExport`);
    }
    if (!c.transform || !c.tests || !Array.isArray(c.tests.sourcePaths) || c.tests.sourcePaths.length === 0) {
      throw new Error(`[config] ${configPath}: challenge ${JSON.stringify(c.id)} missing transform/tests`);
    }
  }
}

/**
 * Stable hash of a single challenge's generation configuration. Any change to
 * the configuration (source path, target export, strategy, tests, hints, ...)
 * must produce a different config hash and therefore a different
 * challengeVersion.
 */
export function configHashOfChallenge(config: ChallengeGenerationConfig): string {
  const relevant = {
    id: config.id,
    sourcePath: config.sourcePath,
    targetExport: config.targetExport,
    transform: config.transform,
    tests: config.tests,
    hints: config.hints,
    overrides: config.overrides ?? null,
  };
  return sha256Hex(canonicalJson(relevant));
}
