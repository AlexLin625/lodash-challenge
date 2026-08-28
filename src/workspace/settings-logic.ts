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
  return current === 'vs-dark' ? 'vs' : 'vs-dark';
}
