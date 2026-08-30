import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChallengeLoader } from '../challenges/loader.ts';
import type { ChallengeCatalog, LoadedChallenge } from '../challenges/types.ts';
import { sourceHash } from '../persistence/hash.ts';
import { summarizeTests, type TestRunResult } from '../runner/protocol.ts';
import { SandpackRunner } from '../runner/sandpack-runner.ts';
import { EditorPane } from '../editor/EditorPane.tsx';
import { WorkspaceModels, type WorkspaceFile } from '../editor/workspace-models.ts';
import { computeVisibleFiles } from './editor-files.ts';
import { ChallengeList } from './ChallengeList.tsx';
import { HintPanel } from './HintPanel.tsx';
import { nextRevealedLevel, type RevealedLevel } from './hint-logic.ts';
import {
  estimateDeclaredTestCaseCount,
  isFailedPartialRun,
  relaxedInitialTimeoutMs,
  shouldRetryAfterPartialFailure,
} from './run-policy.ts';
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
  /** Rendered at the right end of the single-line app header (e.g. the menu). */
  headerSlot?: ReactNode;
}

const DRAFT_SAVE_DEBOUNCE_MS = 600;
const DRAFT_NOTICE_MS = 5000;

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Subset of a file map for the given paths; missing paths get '' so the two
// lists always stay in sync with the bundle keys they came from.
function pickFiles(files: Readonly<Record<string, string>>, paths: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of paths) {
    out[path] = files[path] ?? '';
  }
  return out;
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
  headerSlot,
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
  const hasCompletedFirstRunRef = useRef(false);
  const previousRunFailedPartiallyRef = useRef(false);
  // Bundle files outside the starter's compilable dependency closure (specs,
  // runtime shims, unreferenced _internal files); the runner receives them
  // merged back with the live model contents, and the editor never sees them.
  const hiddenFilesRef = useRef<Record<string, string>>({});

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
    hiddenFilesRef.current = {};
    runnerRef.current?.destroy();
    runnerRef.current = null;
    hasCompletedFirstRunRef.current = false;
    previousRunFailedPartiallyRef.current = false;
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
      // One scoping pass per mount: the editor gets the starter's compilable
      // dependency closure (docs/design-v1.md §8.1); everything else keeps
      // test-scope semantics and only returns for runs.
      const { visible, hidden } = computeVisibleFiles(
        fileContents,
        challenge.manifest.editableFiles,
        challenge.manifest.readonlyFiles
      );
      const editorFiles = pickFiles(fileContents, visible);
      // Hidden contents always come from the pristine bundle, never from a
      // restored draft, so tampered drafts cannot reach the runner.
      hiddenFilesRef.current = pickFiles(challenge.files, hidden);
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
      created.create(editorFiles, challenge.manifest.editableFiles);
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

      // Seed the DAO draft with the starter's editor-scoped files only;
      // restore merges drafts over the full starter, and hidden (test-scope)
      // files never enter persisted drafts because models never carry them.
      const starterVisible = computeVisibleFiles(
        challenge.files,
        challenge.manifest.editableFiles,
        challenge.manifest.readonlyFiles
      ).visible;
      progressRef.current.challengeOpened(key, pickFiles(challenge.files, starterVisible));
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
    // The editor only carries the starter closure; hand the runner the
    // pristine hidden files plus the live (editable + visible readonly) models.
    const files = { ...hiddenFilesRef.current, ...currentModels.getAllContents() };
    const declaredCaseCount = estimateDeclaredTestCaseCount(files, current.manifest.upstream.testPaths);
    setPhase('running');
    setResult(null);
    const startedAt = Date.now();
    try {
      const firstRunTimeout = hasCompletedFirstRunRef.current
        ? undefined
        : relaxedInitialTimeoutMs(current.manifest.runtime.timeoutMs);
      let runResult = await runner.run({ manifest: current.manifest, files, timeoutMs: firstRunTimeout });
      hasCompletedFirstRunRef.current = true;
      if (challengeRef.current?.manifest.id !== runChallengeId) {
        // The user switched challenges mid-run; drop the stale result.
        return;
      }
      if (runResult.status === 'timeout' && firstRunTimeout !== undefined) {
        runResult = await runner.run({ manifest: current.manifest, files });
        if (challengeRef.current?.manifest.id !== runChallengeId) {
          return;
        }
      }
      if (
        shouldRetryAfterPartialFailure({
          previousRunFailedPartially: previousRunFailedPartiallyRef.current,
          status: runResult.status,
          executedCount: runResult.tests.length,
          declaredCount: declaredCaseCount,
        })
      ) {
        runResult = await runner.run({ manifest: current.manifest, files });
        if (challengeRef.current?.manifest.id !== runChallengeId) {
          return;
        }
      }
      previousRunFailedPartiallyRef.current = isFailedPartialRun(
        runResult.status,
        runResult.tests.length,
        declaredCaseCount
      );
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
    <>
      <header className="app-header">
        <h1 className="app-title">Lodash Challenge</h1>
        {catalog && <span className="app-subtitle">{catalog.challenges.length} challenges</span>}
        <div className="app-header-slot">{headerSlot}</div>
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

        <main className="workspace-main">
          {!selectedManifest ? (
            <div className="empty-state">
              {loadingChallenge && <p className="panel-hint">Loading challenge…</p>}
              {challengeError && (
                <p className="error-block" role="alert">
                  Failed to load challenge: {challengeError}
                </p>
              )}
              {!loadingChallenge && !challengeError && catalog && (
                <section className="welcome" aria-labelledby="welcome-title">
                  <p className="welcome-kicker">Browser-based practice</p>
                  <h2 className="welcome-title" id="welcome-title">
                    Rebuild familiar utilities, one function at a time.
                  </h2>
                  <p className="welcome-copy">
                    Choose a challenge from the catalog, implement it in TypeScript, and run the original behavior
                    upstream behavior tests locally in your browser.
                  </p>
                  <p className="welcome-prompt">Select a challenge from the left to begin.</p>
                  <footer className="welcome-credits">
                    <span>
                      Developed by{' '}
                      <a href="mailto:me@a1exlin.cn">me@a1exlin.cn</a>
                    </span>
                    <span className="welcome-credit-separator" aria-hidden="true">
                      ·
                    </span>
                    <span>
                      Puzzle sources adapted from{' '}
                      <a
                        href={`https://github.com/${catalog.upstream.repository}/commit/${catalog.upstream.commit}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        es-toolkit@{catalog.upstream.commit.slice(0, 8)}
                      </a>
                    </span>
                  </footer>
                </section>
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
    </>
  );
}
