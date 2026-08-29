import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPersistence } from './persistence/bootstrap.ts';
import type { PreferencesState } from './persistence/preferences.ts';
import { ChallengeWorkspace } from './workspace/ChallengeWorkspace.tsx';
import { HeaderMenu } from './workspace/header-menu.tsx';
import type { ProgressIOApi } from './workspace/progress-io.tsx';
import { nextTheme, resolveEditorTheme, stepFontSize } from './workspace/settings-logic.ts';
import { useChallengeProgressSummary } from './workspace/use-progress.ts';
import { useSystemTheme } from './workspace/use-system-theme.ts';
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

  const prefersDark = useSystemTheme();
  const resolvedEditorTheme = resolveEditorTheme(prefs?.editorTheme ?? 'auto', prefersDark);

  const storageAvailable = persistence.storageAvailable && !unavailableNotice;

  const { refresh: refreshSummary } = useChallengeProgressSummary(persistence.dao);

  const [importCount, setImportCount] = useState(0);

  const handleImportSuccess = useCallback(() => {
    refreshSummary();
    setImportCount((count) => count + 1);
  }, [refreshSummary]);

  const progressIoApi = useMemo<ProgressIOApi>(
    () => ({
      exportAll: () => persistence.dao.exportAll(),
      importAll: (data) => persistence.dao.importAll(data),
      onSuccess: handleImportSuccess,
    }),
    [persistence, handleImportSuccess]
  );

  return (
    <div className="app">
      <ChallengeWorkspace
        progressService={persistence.progress}
        reader={persistence.dao}
        editorTheme={resolvedEditorTheme}
        editorFontSize={prefs?.fontSize}
        refreshSignal={importCount}
        headerSlot={
          <HeaderMenu
            storageAvailable={storageAvailable}
            settings={
              prefs !== null
                ? {
                    prefs,
                    prefersDark,
                    onFontSize: handleFontSize,
                    onToggleTheme: handleToggleTheme,
                  }
                : null
            }
            progress={{ disabled: !storageAvailable, api: progressIoApi }}
          />
        }
      />
    </div>
  );
}

export default App
