import path from 'node:path';

/**
 * Resolves a (possibly extension-less) relative module specifier against an
 * importer path, trying the standard es-toolkit / TypeScript conventions.
 * `exists` is used to pick the first candidate that actually exists.
 *
 * Paths are posix-style upstream-relative paths, e.g.
 * `src/compat/array/compact.spec.ts`.
 */
export function resolveModulePath(
  importerPath: string,
  specifier: string,
  exists: (candidate: string) => boolean
): string | null {
  if (!specifier.startsWith('.')) {
    return null;
  }
  const dir = path.posix.dirname(importerPath);
  const base = path.posix.normalize(path.posix.join(dir, specifier));

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.d.ts`,
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.d.ts'),
    path.posix.join(base, 'index.ts'),
    path.posix.join(base, 'index.js'),
    path.posix.join(base, 'index.d.ts'),
  ];

  for (const candidate of new Set(candidates)) {
    if (exists(candidate)) {
      return candidate;
    }
  }
  return null;
}
