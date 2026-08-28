import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './hash.ts';
import { CATALOG_SCHEMA_VERSION } from './paths.ts';
import type { ChallengeCatalog, ChallengeManifest, UnsupportedReport, GeneratorConfigFile } from './types.ts';

export function buildCatalog(generatorVersion: string, upstream: GeneratorConfigFile['upstream'], manifests: ChallengeManifest[]): ChallengeCatalog {
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatorVersion,
    upstream: { repository: upstream.repository, commit: upstream.commit },
    challenges: [...manifests].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function buildUnsupportedReport(generatorVersion: string, upstream: GeneratorConfigFile['upstream'], entries: UnsupportedReport['unsupported']): UnsupportedReport {
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatorVersion,
    upstream: { repository: upstream.repository, commit: upstream.commit },
    unsupported: entries.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function writeJson(outputPath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, canonicalJson(value), 'utf8');
}

export function writeFile(outputPath: string, content: string): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf8');
}
