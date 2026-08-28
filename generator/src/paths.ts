import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repository root. */
export const ROOT = path.resolve(currentDir, '..', '..');

/** Absolute path to the generator directory. */
export const GENERATOR_DIR = path.resolve(currentDir, '..');

/** Absolute path to the generator's bundled asset directory. */
export const ASSETS_DIR = path.join(GENERATOR_DIR, 'assets');

/** Absolute path to the upstream es-toolkit submodule root (set at runtime from config). */
export const DEFAULT_UPSTREAM_ROOT = path.join(ROOT, 'external', 'es-toolkit');

/** Default output directory for generated assets. */
export const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'generated');

/** Path (relative to a challenge bundle) of the emitted test runtime shim. */
export const TEST_RUNTIME_BUNDLE_PATH = 'runtime/test-runtime.ts';

/** Module specifier used in test files to import the runtime (rewritten from 'vitest'). */
export const TEST_RUNTIME_SPECIFIER = '@es-toolkit-challenge/test-runtime';

/** Default runtime timeout (ms) recorded in the manifest. */
export const DEFAULT_TIMEOUT_MS = 5000;

/** Catalog schema version for generated assets. */
export const CATALOG_SCHEMA_VERSION = 1;
