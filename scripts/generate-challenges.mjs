// Thin wrapper around the generator CLI so it can be invoked via `pnpm generate`.
// The generator is TypeScript; Node >= 22 runs it directly via type stripping.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'generator', 'src', 'cli.ts');

const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
