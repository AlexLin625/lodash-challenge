// Sandbox bootstrap generator.
//
// Produces the entry module that is injected into the Sandpack sandbox for a
// single run. It statically imports the adapted test files (which register
// suites on the shared test-runtime module), hooks `console.*` with a bounded
// collector, runs the tests, and posts a structured result back to the parent
// window (see `protocol.ts`).
//
// This module is pure (no DOM / no sandpack imports) so the code generation
// and path math can be unit-tested in Node.

import {
  RUNNER_MESSAGE_SOURCE,
  RUNNER_MESSAGE_VERSION,
} from './protocol.ts';

export const BOOTSTRAP_PATH = '/src/runner/bootstrap.ts';

export interface BootstrapInput {
  challengeId: string;
  runId: string;
  /** Bundle-relative test paths, e.g. `src/compat/array/compact.spec.ts`. */
  testPaths: string[];
  /** Bundle-relative runtime path, e.g. `runtime/test-runtime.ts`. */
  runtimePath: string;
  maxConsoleEntries?: number;
}

export const DEFAULT_MAX_CONSOLE_ENTRIES = 200;

/** Resolves a posix path to the directory of a file (absolute paths only). */
function posixDirname(path: string): string {
  const parts = path.split('/').filter((s) => s !== '' && s !== '.');
  parts.pop();
  return '/' + parts.join('/');
}

/** Relative `./...` specifier from an absolute directory to an absolute path. */
function posixRelative(fromDir: string, toPath: string): string {
  const fromParts = fromDir.split('/').filter((s) => s !== '' && s !== '.');
  const toParts = toPath.split('/').filter((s) => s !== '' && s !== '.');
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common += 1;
  }
  const ups = fromParts.length - common;
  const rel = [...Array(ups).fill('..'), ...toParts.slice(common)];
  const joined = rel.join('/');
  // `../` paths are already clearly relative; same-dir/subdir paths need a
  // leading `./` so they are not mistaken for bare (package) specifiers.
  return rel[0] === '..' ? joined : `./${joined}`;
}

export function createBootstrapCode(input: BootstrapInput): string {
  const maxConsole = input.maxConsoleEntries ?? DEFAULT_MAX_CONSOLE_ENTRIES;
  const bootstrapDir = posixDirname(BOOTSTRAP_PATH);
  const runtimeSpecifier = posixRelative(bootstrapDir, `/${input.runtimePath.replace(/^\/+/, '')}`);
  const testSpecifiers = input.testPaths.map((p) => posixRelative(bootstrapDir, `/${p.replace(/^\/+/, '')}`));

  const imports = [
    `import { __runTests } from '${runtimeSpecifier}';`,
    ...testSpecifiers.map((spec) => `import '${spec}';`),
  ].join('\n');

  return `// Auto-generated runner bootstrap for challenge "${input.challengeId}" (run protocol v${RUNNER_MESSAGE_VERSION}).
// Installed as the sandbox entry module. Do not edit.

${imports}

const RUN_ID = ${JSON.stringify(input.runId)};

const MAX_CONSOLE_ENTRIES = ${maxConsole};
const consoleEntries = [];

function stringifyConsoleValue(value) {
  if (typeof value === 'string') {
    return value;
  }
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch (err) {
    return String(value);
  }
}

function installConsoleHook() {
  const originals = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };
  const hook = function (method) {
    return function () {
      const args = Array.prototype.map.call(arguments, stringifyConsoleValue);
      if (consoleEntries.length < MAX_CONSOLE_ENTRIES) {
        consoleEntries.push({ method: method, args: args });
      }
      originals[method].apply(console, arguments);
    };
  };
  console.log = hook('log');
  console.info = hook('info');
  console.warn = hook('warn');
  console.error = hook('error');
  console.debug = hook('debug');
}

function postResult(status, tests, error) {
  const payload = { status: status, tests: tests || [], console: consoleEntries };
  if (error !== undefined) {
    payload.error = error;
  }
  window.parent.postMessage(
    {
      source: ${JSON.stringify(RUNNER_MESSAGE_SOURCE)},
      version: ${JSON.stringify(RUNNER_MESSAGE_VERSION)},
      runId: RUN_ID,
      type: 'result',
      payload: payload,
    },
    '*'
  );
}

async function main() {
  installConsoleHook();
  try {
    const results = await __runTests();
    const failed = results.filter(function (result) {
      return result.status === 'failed';
    }).length;
    postResult(failed > 0 ? 'failed' : 'passed', results, undefined);
  } catch (err) {
    const message = err instanceof Error ? (err.stack || err.message) : String(err);
    postResult('runtime-error', [], message);
  }
}

main();
`;
}
