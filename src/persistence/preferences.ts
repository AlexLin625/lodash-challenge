// Typed local-preference projection for the preferences store
// (docs/design-v1.md §9.4). Pure functions that parse persisted
// preference records into a defaults-merged state and serialize a
// partial state back into deterministic records, without any
// storage API access.

import type { JsonValue, PreferenceRecord } from './domain.ts';

export interface PreferencesState {
  editorTheme: string;
  fontSize: number;
  panelLayout: string;
  recentChallengeKey: string | null;
  autoSaveEnabled: boolean;
}

const KNOWN_PREFERENCE_KEYS = [
  'editorTheme',
  'fontSize',
  'panelLayout',
  'recentChallengeKey',
  'autoSaveEnabled',
] as const satisfies readonly (keyof PreferencesState)[];

export const PREFERENCE_KEYS: readonly string[] = KNOWN_PREFERENCE_KEYS;

const PREFERENCE_KEY_SET: ReadonlySet<string> = new Set(PREFERENCE_KEYS);

export const DEFAULT_PREFERENCES: Readonly<PreferencesState> = {
  editorTheme: 'vs',
  fontSize: 14,
  panelLayout: 'split',
  recentChallengeKey: null,
  autoSaveEnabled: true,
};

const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;

export function isPreferenceKey(key: string): boolean {
  return PREFERENCE_KEY_SET.has(key);
}

export function parsePreferences(records: readonly PreferenceRecord[]): PreferencesState {
  const state: PreferencesState = { ...DEFAULT_PREFERENCES };
  for (const record of records) {
    applyPreference(state, record.key, record.value);
  }
  return state;
}

export function serializePreferences(state: Partial<PreferencesState>): PreferenceRecord[] {
  const records: PreferenceRecord[] = [];
  for (const key of KNOWN_PREFERENCE_KEYS) {
    const value = state[key];
    if (value !== undefined) {
      records.push({ key, value });
    }
  }
  return records;
}

function applyPreference(state: PreferencesState, key: string, value: JsonValue): void {
  switch (key) {
    case 'editorTheme':
      if (typeof value === 'string') {
        state.editorTheme = value;
      }
      break;
    case 'fontSize': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        break;
      }
      state.fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value));
      break;
    }
    case 'panelLayout':
      if (typeof value === 'string') {
        state.panelLayout = value;
      }
      break;
    case 'recentChallengeKey':
      if (value === null || typeof value === 'string') {
        state.recentChallengeKey = value;
      }
      break;
    case 'autoSaveEnabled':
      if (typeof value === 'boolean') {
        state.autoSaveEnabled = value;
      }
      break;
  }
}
