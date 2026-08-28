// Integrity helpers for generated challenge assets.
//
// The generator records SHA-256 hashes of the starter, the adapted tests and
// the manifest (docs/design-v1.md §5.2). These helpers recompute those hashes
// on the client so the loader can detect stale or corrupted bundles. This is a
// reproducibility convenience, not a security boundary.
//
// `sha256Hex` uses the platform Web Crypto API, which is available both in
// modern browsers and in Node >= 18, so the same code runs in tests.

export async function sha256Hex(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hashes a list of parts the same way the generator does (SHA-256 of the parts
 * joined with a NUL byte). Used to recompute `testsHash`, which is built from
 * the sorted `path\ncontent` entries of the adapted test files.
 */
export async function hashOfParts(parts: string[]): Promise<string> {
  return sha256Hex(parts.join('\u0000'));
}

export interface IntegrityCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface IntegrityResult {
  ok: boolean;
  checks: IntegrityCheck[];
}

/**
 * Verifies the integrity hashes recorded in a manifest against the loaded
 * challenge files. The `files` map must contain every editable + readonly
 * file, keyed by bundle-relative path (no leading slash).
 */
export async function verifyChallengeIntegrity(
  manifest: {
    id: string;
    integrity: { starterHash: string; testsHash: string; manifestHash: string };
    entryFile: string;
    testPaths: string[];
  },
  files: Record<string, string>,
  manifestJson: string
): Promise<IntegrityResult> {
  const checks: IntegrityCheck[] = [];

  const starter = files[manifest.entryFile] ?? '';
  const starterHash = await sha256Hex(starter);
  checks.push({
    name: 'starterHash matches entry file',
    passed: starterHash === manifest.integrity.starterHash,
    detail: starterHash === manifest.integrity.starterHash ? undefined : `expected ${manifest.integrity.starterHash}, got ${starterHash}`,
  });

  const testEntries = manifest.testPaths
    .map((p) => ({ path: p, content: files[p] ?? '' }))
    .filter((e) => e.content !== '')
    .sort((a, b) => a.path.localeCompare(b.path));
  const testsHash = await hashOfParts(testEntries.map((e) => `${e.path}\n${e.content}`));
  checks.push({
    name: 'testsHash matches test files',
    passed: testsHash === manifest.integrity.testsHash,
    detail: testsHash === manifest.integrity.testsHash ? undefined : `expected ${manifest.integrity.testsHash}, got ${testsHash}`,
  });

  const manifestHash = await sha256Hex(manifestJson);
  checks.push({
    name: 'manifestHash matches manifest JSON',
    passed: manifestHash === manifest.integrity.manifestHash,
    detail: manifestHash === manifest.integrity.manifestHash ? undefined : `expected ${manifest.integrity.manifestHash}, got ${manifestHash}`,
  });

  return { ok: checks.every((c) => c.passed), checks };
}
