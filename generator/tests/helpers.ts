import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Writes fixture files to a temp dir and runs fn with that dir as the upstream root. */
export async function withFixture(files: Record<string, string>, fn: (upstreamRoot: string) => void | Promise<void>): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-fixture-'));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const abs = path.join(tmp, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
    }
    await fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function baseConfig(sourcePath: string, targetExport: string, transform?: { removableExports?: string[] }) {
  return {
    id: sourcePath.replace(/\//g, '-').replace(/\.ts$/, ''),
    sourcePath,
    targetExport,
    transform: { strategy: 'single-function' as const, removableExports: transform?.removableExports ?? [] },
    tests: { sourcePaths: [] },
    hints: { mode: 'none' as const, maxLevel: 1 as const },
  };
}
