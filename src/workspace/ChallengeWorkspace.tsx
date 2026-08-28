import { useCallback, useEffect, useRef, useState } from 'react';
import { ChallengeLoader } from '../challenges/loader.ts';
import type { ChallengeCatalog, LoadedChallenge } from '../challenges/types.ts';
import { sourceHash } from '../persistence/hash.ts';
import { summarizeTests, type TestRunResult } from '../runner/protocol.ts';
import { SandpackRunner } from '../runner/sandpack-runner.ts';
import { EditorPane } from '../editor/EditorPane.tsx';
import { WorkspaceModels, type WorkspaceFile } from '../editor/workspace-models.ts';
import { ChallengeList } from './ChallengeList.tsx';
import { HintPanel } from './HintPanel.tsx';
import { nextRevealedLevel, type RevealedLevel } from './hint-logic.ts';
import { TestPanel, type RunPhase } from './TestPanel.tsx';
import { completedChallengeIds, progressTotalsLabel } from './completion.ts';
import { useChallengeProgressSummary, type ProgressReader as ProgressSummaryReader } from './use-progress.ts';
import {
  noopProgressService,
  type AttemptRecord,
  type ChallengeKey,
  type ProgressReader as SolutionDraftReader,
  type ProgressSeam,
} from './progress.ts';
import { decideDraftAction, mergeRestoredFiles } from './restore.ts';

const EMPTY_COMPLETED_IDS: ReadonlySet<string> = new Set<string>();

/** Reader prop: the summary reader, optionally extended with draft reads. */
type WorkspaceReader = ProgressSummaryReader & Partial<SolutionDraftReader>;

export interface ChallengeWorkspaceProps {
  progressService?: ProgressSeam;
  reader?: WorkspaceReader | null;
  editorTheme?: string;
  editorFontSize?: number;
  /** Bump to re-read the progress summary (e.g. after an import replaced it). */
  refreshSignal?: number;
}

const DRAFT_SAVE_DEBOUNCE_MS = 600;
const DRAFT_NOTICE_MS = 5000;

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Reads the stored draft from the first source that supports it: the reader
// prop first, then a DAO-backed progress seam. A failing read never blocks
// opening the challenge.
async function readStoredDraft(
  reader: WorkspaceReader | null,
  seam: ProgressSeam,
  key: ChallengeKey
): Promise<Record<string, string> | null> {
  try {
    if (typeof reader?.getSolutionDraft === 'function') {
      return (await reader.getSolutionDraft(key)) ?? null;
    }
    if (typeof seam.getSolutionDraft === 'function') {
      return (await seam.getSolutionDraft(key)) ?? null;
    }
  } catch {
    // Persistence errors surface through the service's own onError channel.
  }
  return null;
}

export function ChallengeWorkspace({
  progressService,
  reader,
  editorTheme,
  editorFontSize,
  refreshSignal,
}: ChallengeWorkspaceProps) {
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
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [hintsLevel, setHintsLevel] = useState<RevealedLevel>(0);

  const { summary, refresh } = useChallengeProgressSummary(reader ?? null);

  const loaderRef = useRef<ChallengeLoader | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const modelsRef = useRef<WorkspaceModels | null>(null);
  const runnerRef = useRef<SandpackRunner | null>(null);
  const progressRef = useRef<ProgressSeam>(progressService ?? noopProgressService);
  const readerRef = useRef<WorkspaceReader | null>(reader ?? null);
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
    readerRef.current = reader ?? null;
  }, [reader]);

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

  // Create Monaco models and the runner for the loaded challenge. When a
  // draft source is available, restore the stored draft before mounting
  // (docs/design-v1.md §10 "user opens challenge → DAO read → restore/seed").
  useEffect(() => {
    if (!challenge) {
      return;
    }
    let cancelled = false;
    const key: ChallengeKey = {
      challengeId: challenge.manifest.id,
      challengeVersion: challenge.manifest.challengeVersion,
    };

    const mount = (fileContents: Record<string, string>): void => {
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
      created.create(fileContents, challenge.manifest.editableFiles);
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

      progressRef.current.challengeOpened(key, challenge.files);
    };

    const open = async (): Promise<void> => {
      const draft = await readStoredDraft(readerRef.current, progressRef.current, key);
      if (cancelled || challengeRef.current !== challenge) {
        // The user switched challenges while the draft was loading; drop it.
        return;
      }
      if (decideDraftAction(draft) === 'restore' && draft !== null) {
        setDraftNotice('Draft restored');
        mount(mergeRestoredFiles(challenge.files, draft, challenge.manifest.editableFiles));
      } else {
        mount(challenge.files);
      }
    };

    void open();

    return () => {
      cancelled = true;
      disposeWorkspace();
    };
  }, [challenge, disposeWorkspace]);

  // Auto-dismiss the non-blocking draft-restored notice.
  useEffect(() => {
    if (draftNotice === null) {
      return;
    }
    const timer = setTimeout(() => {
      setDraftNotice(null);
    }, DRAFT_NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [draftNotice]);

  // Re-read the summary when the app signals that progress changed underneath
  // us (an import replaced the whole directory), so badges refresh immediately.
  useEffect(() => {
    if (refreshSignal === undefined) {
      return;
    }
    refresh();
  }, [refreshSignal, refresh]);

  const handleSelect = useCallback(
    (id: string) => {
      if (selectedId === id) {
        return;
      }
      setChallenge(null);
      setChallengeError(null);
      setLoadingChallenge(true);
      setHintsLevel(0);
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

              <HintPanel
                hints={selectedManifest.hints}
                revealedLevel={hintsLevel}
                onShowMore={() => {
                  const hints = selectedManifest.hints;
                  setHintsLevel((prev) => nextRevealedLevel(hints, prev));
                }}
              />

              {draftNotice && (
                <p className="panel-hint" role="status">
                  {draftNotice}
                </p>
              )}

              <div className="editor-results">
                <div className="editor-region">
                  <EditorPane
                    files={files}
                    activePath={activePath}
                    models={models}
                    onActivePathChange={setActivePath}
                    editorTheme={editorTheme}
                    editorFontSize={editorFontSize}
                  />
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
