// Pure control logic for the settings bar (docs/design-v1.md §9.4).
//
// Extracted from settings-bar.tsx so node:test can cover it without a JSX
// transform. Font-size stepping here mirrors the [8, 32] clamp that
// preferences.ts applies when parsing persisted records.

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 32;

export function clampFontSize(size: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
}

export function stepFontSize(current: number, delta: number): number {
  return clampFontSize(current + delta);
}

export function nextTheme(current: string): string {
  // Three-state cycle through the settings button: auto -> vs-dark -> vs -> auto.
  // Keeping explicit vs-dark <-> vs adjacent preserves the old toggle behavior
  // for anyone already on an explicit theme; unknown values snap into the cycle
  // at vs-dark so the button always lands on a concrete theme.
  switch (current) {
    case 'auto':
      return 'vs-dark';
    case 'vs-dark':
      return 'vs';
    case 'vs':
      return 'auto';
    default:
      return 'vs-dark';
  }
}

/**
 * Resolve a stored editor theme against the system preference: 'auto' (and
 * unknown values) follow the OS, explicit 'vs'/'vs-dark' win as-is. The
 * result is always a real Monaco theme id.
 */
export function resolveEditorTheme(theme: string, prefersDark: boolean): 'vs' | 'vs-dark' {
  if (theme === 'vs-dark' || theme === 'vs') {
    return theme;
  }
  return prefersDark ? 'vs-dark' : 'vs';
}

/** Compact SettingsBar label for the theme button (shows 'auto'/'dark'/'light'). */
export function themeLabel(theme: string, prefersDark: boolean): string {
  if (theme === 'auto') {
    return 'auto';
  }
  if (theme !== 'vs' && theme !== 'vs-dark') {
    // Unknown stored values render as what the editor actually shows.
    return resolveEditorTheme(theme, prefersDark) === 'vs-dark' ? 'dark' : 'light';
  }
  return theme === 'vs-dark' ? 'dark' : 'light';
}
