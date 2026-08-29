import type { PreferencesState } from '../persistence/preferences.ts';
import { stepFontSize, themeLabel } from './settings-logic.ts';

export interface SettingsBarProps {
  prefs: PreferencesState;
  /** System dark preference, used to label 'auto'/unknown themes sensibly. */
  prefersDark?: boolean;
  onFontSize(delta: number): void;
  onToggleTheme(): void;
}

export function SettingsBar({ prefs, prefersDark = false, onFontSize, onToggleTheme }: SettingsBarProps) {
  const decreaseDisabled = stepFontSize(prefs.fontSize, -1) === prefs.fontSize;
  const increaseDisabled = stepFontSize(prefs.fontSize, 1) === prefs.fontSize;

  return (
    <div className="settings-bar">
      <span className="settings-group">
        <button
          type="button"
          className="btn settings-btn"
          onClick={() => onFontSize(-1)}
          disabled={decreaseDisabled}
          aria-label="Decrease font size"
        >
          A−
        </button>
        <button
          type="button"
          className="btn settings-btn"
          onClick={() => onFontSize(1)}
          disabled={increaseDisabled}
          aria-label="Increase font size"
        >
          A+
        </button>
        <span className="settings-font-size">{prefs.fontSize}px</span>
      </span>
      <span className="settings-group">
        <button type="button" className="btn settings-btn" onClick={onToggleTheme} aria-label="Toggle editor theme">
          Theme: {themeLabel(prefs.editorTheme, prefersDark)}
        </button>
      </span>
    </div>
  );
}
