// Browser-side runner built on @codesandbox/sandpack-client.
//
// This is the only module in src/runner that imports the sandpack package. It
// owns the iframe lifecycle (create/destroy), drives a single run at a time,
// and reconciles three sources of truth into a structured `TestRunResult`:
//
//   1. the sandbox's `result` postMessage (see protocol.ts / bootstrap.ts),
//   2. the bundler's compile-error messages,
//   3. the wall-clock timeout.
//
// All normalization and code generation is delegated to the pure modules
// (protocol.ts / run.ts / bootstrap.ts) so the hard logic is testable in Node.

import { extractErrorDetails, loadSandpackClient, SandpackLogLevel } from '@codesandbox/sandpack-client';
import type { ClientOptions, SandboxSetup, SandpackClient, SandpackMessage } from '@codesandbox/sandpack-client';
import type { ChallengeManifest } from '../challenges/types.ts';
import { isRunnerResultMessage, type RunnerResultMessage, type TestRunResult } from './protocol.ts';
import { buildSandboxFromChallenge, formatSandpackError, toRunResult, type SandboxSetupLike } from './run.ts';

export interface SandpackRunnerOptions {
  /** Element the hidden sandbox iframe is attached to. */
  host: HTMLElement;
  /** Override the CodeSandbox bundler URL. */
  bundlerURL?: string;
  /** Fallback per-run timeout (ms) when the manifest does not specify one. */
  timeoutMs?: number;
  maxConsoleEntries?: number;
  logLevel?: SandpackLogLevel;
}

export interface RunnerRunInput {
  runId?: string;
  /** Per-run timeout override; defaults to manifest runtime.timeoutMs. */
  timeoutMs?: number;
  manifest: ChallengeManifest;
  /** All challenge files, keyed by bundle-relative path (no leading slash). */
  files: Record<string, string>;
}

interface ActiveRun {
  runId: string;
  startedAt: number;
  deferred: {
    resolve: (result: TestRunResult) => void;
    reject: (error: unknown) => void;
  };
  timer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
  compileError: string | null;
}

function createRunId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class SandpackRunner {
  private readonly host: HTMLElement;
  private readonly options: SandpackRunnerOptions;

  private client: SandpackClient | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private activeRun: ActiveRun | null = null;
  private destroyed = false;

  private readonly handleWindowMessage = (event: MessageEvent): void => {
    const run = this.activeRun;
    if (!run || this.iframe === null || event.source !== this.iframe.contentWindow) {
      return;
    }
    if (!isRunnerResultMessage(event.data) || event.data.runId !== run.runId) {
      return;
    }
    this.settle({ sandboxMessage: event.data });
  };

  private readonly handleSandpackMessage = (message: SandpackMessage): void => {
    const run = this.activeRun;
    if (!run) {
      return;
    }
    if (message.type === 'action' && message.action === 'show-error') {
      run.compileError = formatSandpackError(extractErrorDetails(message));
    } else if (message.type === 'done' && message.compilatonError) {
      this.settle({ compileError: run.compileError ?? 'Bundling failed' });
    }
  };

  constructor(options: SandpackRunnerOptions) {
    this.host = options.host;
    this.options = options;
    window.addEventListener('message', this.handleWindowMessage);
  }

  get isRunning(): boolean {
    return this.activeRun !== null;
  }

  /**
   * Runs the challenge files once and resolves with a structured result.
   * Rejects if another run is already in progress.
   */
  async run(input: RunnerRunInput): Promise<TestRunResult> {
    if (this.destroyed) {
      throw new Error('SandpackRunner has been destroyed');
    }
    if (this.activeRun) {
      throw new Error('SandpackRunner is busy; a run is already in progress');
    }

    const runId = input.runId ?? createRunId();
    const timeoutMs = input.timeoutMs ?? this.options.timeoutMs ?? input.manifest.runtime.timeoutMs;
    const startedAt = Date.now();
    const setup = buildSandboxFromChallenge(input.manifest, input.files, runId, this.options.maxConsoleEntries);

    const run: ActiveRun = {
      runId,
      startedAt,
      deferred: {
        resolve: () => {},
        reject: () => {},
      },
      timer: null,
      settled: false,
      compileError: null,
    };

    const result = new Promise<TestRunResult>((resolve, reject) => {
      run.deferred = { resolve, reject };
      run.timer = setTimeout(() => this.onTimeout(run), timeoutMs);
    });
    this.activeRun = run;

    try {
      const createdFresh = await this.ensureClient(setup);
      if (this.activeRun === null || this.activeRun.runId !== runId) {
        // The run settled (e.g. timeout) while the client was being created.
        return result;
      }
      if (!createdFresh) {
        // Reused client: recompile with the current files.
        this.client!.updateSandbox({ files: setup.files }, false);
      }
    } catch (error) {
      this.fail(error);
    }

    return result;
  }

  /** Removes the iframe and releases all listeners (safe to call at any time). */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    if (this.activeRun) {
      this.clearRunTimer(this.activeRun);
      this.activeRun = null;
    }
    this.teardownClient();
    window.removeEventListener('message', this.handleWindowMessage);
  }

  private async ensureClient(setup: SandboxSetupLike): Promise<boolean> {
    if (this.client) {
      return false;
    }
    const iframe = document.createElement('iframe');
    iframe.setAttribute(
      'sandbox',
      'allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads allow-pointer-lock'
    );
    iframe.setAttribute('title', 'lodash-challenge sandbox');
    iframe.style.display = 'none';
    this.host.appendChild(iframe);
    this.iframe = iframe;

    const clientOptions: ClientOptions = {
      bundlerURL: this.options.bundlerURL,
      logLevel: this.options.logLevel ?? SandpackLogLevel.None,
      showErrorScreen: false,
      showLoadingScreen: false,
      clearConsoleOnFirstCompile: true,
    };

    const client = await loadSandpackClient(iframe, setup as unknown as SandboxSetup, clientOptions);
    if (this.destroyed) {
      // The runner was destroyed while the bundler was loading.
      client.destroy();
      iframe.remove();
      this.iframe = null;
      return false;
    }
    this.client = client;
    client.listen(this.handleSandpackMessage);
    return true;
  }

  private settle(input: { sandboxMessage?: RunnerResultMessage; compileError?: string }): void {
    const run = this.activeRun;
    if (!run || run.settled) {
      return;
    }
    run.settled = true;
    this.activeRun = null;
    this.clearRunTimer(run);
    const { sandboxMessage, compileError } = input;
    run.deferred.resolve(
      toRunResult({
        runId: run.runId,
        startedAt: run.startedAt,
        sandboxMessage: sandboxMessage ?? null,
        compileError,
        timedOut: false,
      })
    );
  }

  private fail(error: unknown): void {
    const run = this.activeRun;
    if (!run || run.settled) {
      return;
    }
    run.settled = true;
    this.activeRun = null;
    this.clearRunTimer(run);
    this.teardownClient();
    run.deferred.reject(error instanceof Error ? error : new Error(String(error)));
  }

  private onTimeout(run: ActiveRun): void {
    if (run.settled || this.activeRun !== run) {
      return;
    }
    run.settled = true;
    this.activeRun = null;
    // The iframe may be stuck in a synchronous loop; free it entirely.
    this.teardownClient();
    run.deferred.resolve(
      toRunResult({
        runId: run.runId,
        startedAt: run.startedAt,
        sandboxMessage: null,
        timedOut: true,
      })
    );
  }

  private clearRunTimer(run: ActiveRun): void {
    if (run.timer !== null) {
      clearTimeout(run.timer);
      run.timer = null;
    }
  }

  private teardownClient(): void {
    if (this.client) {
      try {
        this.client.destroy();
      } catch {
        // ignore teardown errors
      }
      this.client = null;
    }
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
  }
}
