import type { PreferencesState } from '../persistence/preferences.ts';
import { stepFontSize } from './settings-logic.ts';

export interface SettingsBarProps {
  prefs: PreferencesState;
  onFontSize(delta: number): void;
  onToggleTheme(): void;
}

export function SettingsBar({ prefs, onFontSize, onToggleTheme }: SettingsBarProps) {
  const decreaseDisabled = stepFontSize(prefs.fontSize, -1) === prefs.fontSize;
  const increaseDisabled = stepFontSize(prefs.fontSize, 1) === prefs.fontSize;
  const isDark = prefs.editorTheme === 'vs-dark';

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
          Theme: {isDark ? 'vs-dark' : 'vs'}
        </button>
      </span>
    </div>
  );
}
