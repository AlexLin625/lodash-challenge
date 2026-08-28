// Pure helpers that assemble the sandbox input for a single run and normalize
// results. Kept free of `@codesandbox/sandpack-client` imports so these
// boundaries are unit-testable in Node without a browser.

import type { ChallengeManifest } from '../challenges/types.ts';
import {
  BOOTSTRAP_PATH,
  DEFAULT_MAX_CONSOLE_ENTRIES,
  createBootstrapCode,
} from './bootstrap.ts';
import { isRunnerResultMessage, type RunnerResultMessage, type TestCaseResult, type TestRunResult } from './protocol.ts';

/** Structural subset of a sandpack bundler file (type-only, no package import). */
export interface SandboxFileEntry {
  code: string;
  hidden?: boolean;
  readOnly?: boolean;
}

export type SandboxFiles = Record<string, SandboxFileEntry>;

export interface SandboxSetupLike {
  files: SandboxFiles;
  dependencies: Record<string, string>;
  entry: string;
  template: string;
}

export interface SandboxInput {
  challengeId: string;
  runId: string;
  /** Bundle-relative paths of the adapted test files. */
  testPaths: string[];
  /** Bundle-relative path of the shared test runtime. */
  runtimePath: string;
  /** All challenge files, keyed by bundle-relative path (no leading slash). */
  files: Record<string, string>;
  maxConsoleEntries?: number;
}

/** Adds the sandpack-required leading slash to a bundle-relative path. */
export function sandboxPath(bundleRelative: string): string {
  return '/' + bundleRelative.replace(/^\/+/, '');
}

function packageJson(entry: string): string {
  return JSON.stringify(
    {
      name: 'lodash-challenge-runner',
      private: true,
      main: entry,
      dependencies: {},
      devDependencies: { typescript: '^4.0.0' },
    },
    null,
    2
  );
}

const MINIMAL_INDEX_HTML =
  '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8" />\n</head>\n<body></body>\n</html>\n';

/**
 * Builds the sandbox setup for a run: challenge files + generated bootstrap
 * entry + package.json (entry = bootstrap) + a minimal index.html. Pure.
 */
export function buildSandboxSetup(input: SandboxInput): SandboxSetupLike {
  const files: SandboxFiles = {};
  for (const [relPath, code] of Object.entries(input.files)) {
    files[sandboxPath(relPath)] = { code };
  }

  const bootstrap = createBootstrapCode({
    challengeId: input.challengeId,
    runId: input.runId,
    testPaths: input.testPaths,
    runtimePath: input.runtimePath,
    maxConsoleEntries: input.maxConsoleEntries,
  });
  files[BOOTSTRAP_PATH] = { code: bootstrap, hidden: true };
  files['/package.json'] = { code: packageJson(BOOTSTRAP_PATH), hidden: true };
  files['/index.html'] = { code: MINIMAL_INDEX_HTML, hidden: true };

  return {
    files,
    dependencies: {},
    entry: BOOTSTRAP_PATH,
    template: 'vanilla-ts',
  };
}

export interface CompiledRunInput {
  challengeId: string;
  runId: string;
  files: Record<string, string>;
  testPaths: string[];
  runtimePath: string;
  maxConsoleEntries?: number;
}

/** Builds a sandbox setup from a loaded challenge plus a run id. */
export function buildSandboxFromChallenge(manifest: ChallengeManifest, files: Record<string, string>, runId: string, maxConsoleEntries?: number): SandboxSetupLike {
  const runtimePath = manifest.readonlyFiles.find((p) => p.endsWith('/test-runtime.ts')) ?? 'runtime/test-runtime.ts';
  return buildSandboxSetup({
    challengeId: manifest.id,
    runId,
    testPaths: manifest.upstream.testPaths,
    runtimePath,
    files,
    maxConsoleEntries,
  });
}

export interface RunResultInput {
  runId: string;
  startedAt: number;
  /** Raw message parsed from the sandbox; null when the run did not produce one. */
  sandboxMessage: RunnerResultMessage | null;
  /** Compile/bundler error text, when reported. */
  compileError?: string;
  /** Set when the run exceeded its time budget. */
  timedOut?: boolean;
}

/**
 * Normalizes the various run outcomes into a single `TestRunResult` (pure).
 *
 * Priority: timeout > compile error > sandbox result (runtime-error / failed /
 * passed).
 */
export function toRunResult(input: RunResultInput): TestRunResult {
  const durationMs = Date.now() - input.startedAt;
  const message = input.sandboxMessage;
  if (input.timedOut) {
    return {
      runId: input.runId,
      status: 'timeout',
      durationMs,
      tests: message?.payload.tests ?? [],
      console: message?.payload.console ?? [],
      error: `Run timed out after ${durationMs}ms`,
    };
  }
  if (input.compileError) {
    return {
      runId: input.runId,
      status: 'compile-error',
      durationMs,
      tests: [],
      console: message?.payload.console ?? [],
      error: input.compileError,
    };
  }
  if (!message) {
    return {
      runId: input.runId,
      status: 'runtime-error',
      durationMs,
      tests: [],
      console: [],
      error: 'Sandbox did not report a result',
    };
  }
  const tests: TestCaseResult[] = message.payload.tests;
  return {
    runId: input.runId,
    status: message.payload.status,
    durationMs,
    tests,
    console: message.payload.console,
    error: message.payload.error,
  };
}

/** Formats a sandpack error into a single human-readable string (pure). */
export interface SandpackErrorLike {
  message: string;
  title?: string;
  path?: string;
  line?: number;
  column?: number;
}

export function formatSandpackError(error: SandpackErrorLike): string {
  const title = error.title && error.title.length > 0 ? `${error.title}: ` : '';
  const location = error.path ? `${error.path}${error.line != null ? `:${error.line}:${error.column ?? 1}` : ''}: ` : '';
  return `${title}${location}${error.message}`;
}

export { isRunnerResultMessage, DEFAULT_MAX_CONSOLE_ENTRIES };
