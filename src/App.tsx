import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPersistence } from './persistence/bootstrap.ts';
import type { PreferencesState } from './persistence/preferences.ts';
import { ChallengeWorkspace } from './workspace/ChallengeWorkspace.tsx';
import { ProgressIO } from './workspace/progress-io.tsx';
import type { ProgressIOApi } from './workspace/progress-io.tsx';
import { SettingsBar } from './workspace/settings-bar.tsx';
import { nextTheme, stepFontSize } from './workspace/settings-logic.ts';
import { useChallengeProgressSummary } from './workspace/use-progress.ts';
import './App.css';

function App() {
  const persistence = useMemo(() => createPersistence(), []);
  const [unavailableNotice, setUnavailableNotice] = useState(false);
  const [prefs, setPrefs] = useState<PreferencesState | null>(null);

  useEffect(() => {
    return persistence.onStorageUnavailable(() => {
      setUnavailableNotice(true);
    });
  }, [persistence]);

  useEffect(() => {
    let cancelled = false;
    persistence
      .loadPreferences()
      .then((loaded) => {
        if (!cancelled) {
          setPrefs(loaded);
        }
      })
      .catch((error: unknown) => {
        console.warn('Failed to load editor preferences', error);
      });
    return () => {
      cancelled = true;
    };
  }, [persistence]);

  const updatePrefs = useCallback(
    (patch: Partial<PreferencesState>) => {
      setPrefs((prev) => (prev === null ? prev : { ...prev, ...patch }));
      void persistence.savePreferences(patch);
    },
    [persistence]
  );

  const handleFontSize = useCallback(
    (delta: number) => {
      if (prefs === null) {
        return;
      }
      updatePrefs({ fontSize: stepFontSize(prefs.fontSize, delta) });
    },
    [prefs, updatePrefs]
  );

  const handleToggleTheme = useCallback(() => {
    if (prefs === null) {
      return;
    }
    updatePrefs({ editorTheme: nextTheme(prefs.editorTheme) });
  }, [prefs, updatePrefs]);

  const storageAvailable = persistence.storageAvailable && !unavailableNotice;

  const { refresh: refreshSummary } = useChallengeProgressSummary(persistence.dao);

  const progressIoApi = useMemo<ProgressIOApi>(
    () => ({
      exportAll: () => persistence.dao.exportAll(),
      importAll: (data) => persistence.dao.importAll(data),
      onSuccess: refreshSummary,
    }),
    [persistence, refreshSummary]
  );

  return (
    <>
      {!storageAvailable && (
        <div className="storage-banner banner--muted" role="status">
          Local storage unavailable — progress won&apos;t be saved
        </div>
      )}
      <div className="app-topbar">
        {prefs !== null && (
          <SettingsBar prefs={prefs} onFontSize={handleFontSize} onToggleTheme={handleToggleTheme} />
        )}
        <ProgressIO disabled={!storageAvailable} api={progressIoApi} />
      </div>
      <ChallengeWorkspace
        progressService={persistence.progress}
        reader={persistence.dao}
        editorTheme={prefs?.editorTheme}
        editorFontSize={prefs?.fontSize}
      />
    </>
  );
}

export default App
