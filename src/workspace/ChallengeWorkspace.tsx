import { useCallback, useEffect, useRef, useState } from 'react';
import { ChallengeLoader } from '../challenges/loader.ts';
import type { ChallengeCatalog, LoadedChallenge } from '../challenges/types.ts';
import { sourceHash } from '../persistence/hash.ts';
import { summarizeTests, type TestRunResult } from '../runner/protocol.ts';
import { SandpackRunner } from '../runner/sandpack-runner.ts';
import { EditorPane } from '../editor/EditorPane.tsx';
import { WorkspaceModels, type WorkspaceFile } from '../editor/workspace-models.ts';
import { ChallengeList } from './ChallengeList.tsx';
import { TestPanel, type RunPhase } from './TestPanel.tsx';
import { completedChallengeIds, progressTotalsLabel } from './completion.ts';
import { useChallengeProgressSummary, type ProgressReader } from './use-progress.ts';
import { noopProgressService, type AttemptRecord, type ProgressSeam } from './progress.ts';

const EMPTY_COMPLETED_IDS: ReadonlySet<string> = new Set<string>();

export interface ChallengeWorkspaceProps {
  progressService?: ProgressSeam;
  reader?: ProgressReader;
}

const DRAFT_SAVE_DEBOUNCE_MS = 600;

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function ChallengeWorkspace({ progressService, reader }: ChallengeWorkspaceProps) {
  const [catalog, setCatalog] = useState<ChallengeCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<LoadedChallenge | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [loadingChallenge, setLoadingChallenge] = useState(false);
  const [models, setModels] = useState<WorkspaceModels | null>(null);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [activePath, setActivePath] = useState('');
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [result, setResult] = useState<TestRunResult | null>(null);

  const { summary, refresh } = useChallengeProgressSummary(reader ?? null);

  const loaderRef = useRef<ChallengeLoader | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const modelsRef = useRef<WorkspaceModels | null>(null);
  const runnerRef = useRef<SandpackRunner | null>(null);
  const progressRef = useRef<ProgressSeam>(progressService ?? noopProgressService);
  const challengeRef = useRef<LoadedChallenge | null>(null);
  const phaseRef = useRef<RunPhase>('idle');
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (loaderRef.current === null) {
    loaderRef.current = new ChallengeLoader({ verifyIntegrity: false });
  }

  useEffect(() => {
    progressRef.current = progressService ?? noopProgressService;
  }, [progressService]);

  useEffect(() => {
    challengeRef.current = challenge;
  }, [challenge]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Load the catalog once.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    loaderRef.current!
      .loadCatalog(controller.signal)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setCatalog(loaded);
        setCatalogError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCatalogError(toMessage(error));
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  // Load the bundle for the selected challenge.
  useEffect(() => {
    if (!selectedId) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    loaderRef.current!
      .loadChallenge(selectedId, controller.signal)
      .then((loaded) => {
        if (!cancelled) {
          setChallenge(loaded);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setChallengeError(toMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingChallenge(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedId]);

  const disposeWorkspace = useCallback(() => {
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    modelsRef.current?.disposeAll();
    modelsRef.current = null;
    runnerRef.current?.destroy();
    runnerRef.current = null;
    setModels(null);
    setFiles([]);
    setActivePath('');
    setPhase('idle');
    setResult(null);
  }, []);

  // Create Monaco models and the runner for the loaded challenge.
  useEffect(() => {
    if (!challenge) {
      return;
    }
    const created = new WorkspaceModels({
      onEditableChange: (_path: string, _value: string) => {
        if (draftTimerRef.current) {
          clearTimeout(draftTimerRef.current);
        }
        draftTimerRef.current = setTimeout(() => {
          const current = challengeRef.current;
          const currentModels = modelsRef.current;
          if (!current || !currentModels) {
            return;
          }
          progressRef.current.saveDraft(
            { challengeId: current.manifest.id, challengeVersion: current.manifest.challengeVersion },
            currentModels.getAllContents()
          );
        }, DRAFT_SAVE_DEBOUNCE_MS);
      },
    });
    created.create(challenge.files, challenge.manifest.editableFiles);
    modelsRef.current = created;
    setModels(created);

    const list = created.fileList();
    setFiles(list);
    setActivePath(list[0]?.path ?? '');
    setPhase('idle');
    setResult(null);

    if (hostRef.current) {
      runnerRef.current = new SandpackRunner({
        host: hostRef.current,
        timeoutMs: challenge.manifest.runtime.timeoutMs,
      });
    }

    progressRef.current.challengeOpened(
      { challengeId: challenge.manifest.id, challengeVersion: challenge.manifest.challengeVersion },
      challenge.files
    );

    return disposeWorkspace;
  }, [challenge, disposeWorkspace]);

  const handleSelect = useCallback(
    (id: string) => {
      if (selectedId === id) {
        return;
      }
      setChallenge(null);
      setChallengeError(null);
      setLoadingChallenge(true);
      setSelectedId(id);
    },
    [selectedId]
  );

  const handleRun = useCallback(async () => {
    const current = challengeRef.current;
    const currentModels = modelsRef.current;
    const runner = runnerRef.current;
    if (!current || !currentModels || !runner || phaseRef.current === 'running') {
      return;
    }
    const runChallengeId = current.manifest.id;
    const files = currentModels.getAllContents();
    setPhase('running');
    setResult(null);
    const startedAt = Date.now();
    try {
      const runResult = await runner.run({ manifest: current.manifest, files });
      if (challengeRef.current?.manifest.id !== runChallengeId) {
        // The user switched challenges mid-run; drop the stale result.
        return;
      }
      setPhase(runResult.status);
      setResult(runResult);

      const summary = summarizeTests(runResult.tests);
      const key = { challengeId: current.manifest.id, challengeVersion: current.manifest.challengeVersion };
      const attempt: AttemptRecord = {
        key,
        result: runResult.status,
        passedTests: summary.passed,
        totalTests: summary.total,
        durationMs: runResult.durationMs,
        sourceHash: await sourceHash(files, current.manifest.editableFiles),
      };
      progressRef.current.recordAttempt(attempt);
      if (runResult.status === 'passed') {
        progressRef.current.markCompleted(key, attempt);
        refresh();
      }
    } catch (error: unknown) {
      if (challengeRef.current?.manifest.id !== runChallengeId) {
        return;
      }
      setPhase('runtime-error');
      setResult({
        runId: '',
        status: 'runtime-error',
        durationMs: Date.now() - startedAt,
        tests: [],
        console: [],
        error: toMessage(error),
      });
    }
  }, [refresh]);

  const handleReset = useCallback(() => {
    const current = challengeRef.current;
    const currentModels = modelsRef.current;
    if (!current || !currentModels) {
      return;
    }
    currentModels.resetToStarter(current.files);
    setPhase('idle');
    setResult(null);
  }, []);

  const selectedManifest = challenge?.manifest;
  const runDisabled = phase === 'running';
  const completedIds = summary ? completedChallengeIds(summary) : EMPTY_COMPLETED_IDS;
  const totalsLabel = summary ? progressTotalsLabel(summary.totals) : '';

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Lodash Challenge</h1>
        {catalog && <span className="app-subtitle">{catalog.challenges.length} challenges</span>}
      </header>

      <div className="workspace">
        <aside className="sidebar">
          {catalogError ? (
            <p className="error-block" role="alert">
              Failed to load catalog: {catalogError}
            </p>
          ) : catalog === null ? (
            <p className="panel-hint">Loading catalog…</p>
          ) : (
            <ChallengeList
              catalog={catalog}
              selectedId={selectedId}
              onSelect={handleSelect}
              completedIds={completedIds}
              totalsLabel={totalsLabel}
            />
          )}
        </aside>

        <main className="main">
          {!selectedManifest ? (
            <div className="empty-state">
              {loadingChallenge && <p className="panel-hint">Loading challenge…</p>}
              {challengeError && (
                <p className="error-block" role="alert">
                  Failed to load challenge: {challengeError}
                </p>
              )}
              {!loadingChallenge && !challengeError && (
                <p className="panel-hint">Select a challenge from the list to get started.</p>
              )}
            </div>
          ) : (
            <>
              <div className="toolbar">
                <div className="toolbar-info">
                  <h2 className="challenge-title">{selectedManifest.title}</h2>
                  <span className={`badge badge-${selectedManifest.difficulty}`}>{selectedManifest.difficulty}</span>
                  <span className="challenge-category">{selectedManifest.category}</span>
                </div>
                <div className="toolbar-actions">
                  <button type="button" className="btn" onClick={handleReset} disabled={runDisabled}>
                    Reset
                  </button>
                  <button type="button" className="btn btn-primary" onClick={handleRun} disabled={runDisabled}>
                    {phase === 'running' ? 'Running…' : 'Run'}
                  </button>
                </div>
              </div>

              {selectedManifest.description && <p className="description">{selectedManifest.description}</p>}

              <div className="editor-results">
                <div className="editor-region">
                  <EditorPane files={files} activePath={activePath} models={models} onActivePathChange={setActivePath} />
                </div>
                <div className="results-region">
                  <TestPanel phase={phase} result={result} />
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      <div className="runner-host" ref={hostRef} aria-hidden="true" />
    </div>
  );
}
