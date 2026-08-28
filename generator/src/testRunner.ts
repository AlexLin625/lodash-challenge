import ts from 'typescript';
import { resolveModulePath } from './resolve.ts';
import type { TestCaseResult, TestRunSummary } from './types.ts';

/**
 * Runs a set of test files against an in-memory file map using the generator's
 * jest-subset runtime shim. Files are transpiled to CommonJS and loaded through
 * a tiny module registry; relative imports resolve against the file map.
 *
 * This mirrors how a browser sandbox would load the bundle files, so behavior
 * checks (original passes / stub fails) exercise the exact bundle contents.
 */
export async function runTests(files: Map<string, string>, testPaths: string[], runtimePath: string): Promise<TestRunSummary> {
  const cache = new Map<string, Record<string, unknown>>();

  function load(modulePath: string): Record<string, unknown> {
    const cached = cache.get(modulePath);
    if (cached) {
      return cached;
    }
    const content = files.get(modulePath);
    if (content === undefined) {
      throw new Error(`[runner] missing module: ${modulePath}`);
    }
    const js = ts
      .transpileModule(content, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
          isolatedModules: true,
        },
      })
      .outputText;

    const mod = { exports: {} as Record<string, unknown> };
    cache.set(modulePath, mod.exports);

    const localRequire = (specifier: string): Record<string, unknown> => {
      const resolved = resolveModulePath(modulePath, specifier, (candidate) => files.has(candidate));
      if (!resolved) {
        throw new Error(`[runner] cannot resolve "${specifier}" from "${modulePath}"`);
      }
      return load(resolved);
    };

    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const compiled = new Function('require', 'module', 'exports', js);
    compiled(localRequire, mod, mod.exports);
    return mod.exports;
  }

  for (const testPath of testPaths) {
    load(testPath);
  }

  const runtime = load(runtimePath) as {
    __runTests: () => Promise<TestCaseResult[]>;
  };
  const results = await runtime.__runTests();
  return summarize(results);
}

function summarize(results: TestCaseResult[]): TestRunSummary {
  const failures = results
    .filter((r) => r.status === 'failed')
    .map((r) => ({ name: r.name, error: r.error ?? 'unknown error' }));
  return {
    total: results.length,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: failures.length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failures,
  };
}
