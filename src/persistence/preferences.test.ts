import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JsonValue, PreferenceRecord } from './domain.ts';
import {
  DEFAULT_PREFERENCES,
  PREFERENCE_KEYS,
  isPreferenceKey,
  parsePreferences,
  serializePreferences,
} from './preferences.ts';

function pref(key: string, value: JsonValue): PreferenceRecord {
  return { key, value };
}

test('PREFERENCE_KEYS lists every known preference key in order', () => {
  assert.deepEqual([...PREFERENCE_KEYS], [
    'editorTheme',
    'fontSize',
    'panelLayout',
    'recentChallengeKey',
    'autoSaveEnabled',
  ]);
  for (const key of PREFERENCE_KEYS) {
    assert.equal(isPreferenceKey(key), true);
  }
  assert.equal(isPreferenceKey('bogus'), false);
  assert.equal(isPreferenceKey(''), false);
});

test('DEFAULT_PREFERENCES carries the documented defaults', () => {
  assert.deepEqual({ ...DEFAULT_PREFERENCES }, {
    editorTheme: 'vs',
    fontSize: 14,
    panelLayout: 'split',
    recentChallengeKey: null,
    autoSaveEnabled: true,
  });
});

test('parsePreferences on an empty list returns a copy of the defaults', () => {
  const state = parsePreferences([]);

  assert.deepEqual(state, { ...DEFAULT_PREFERENCES });
  state.fontSize = 99;
  assert.equal(DEFAULT_PREFERENCES.fontSize, 14);
});

test('parsePreferences applies every valid stored value', () => {
  const state = parsePreferences([
    pref('editorTheme', 'monokai'),
    pref('fontSize', 18),
    pref('panelLayout', 'tabs'),
    pref('recentChallengeKey', 'lodash.chunk@1.0.0'),
    pref('autoSaveEnabled', false),
  ]);

  assert.deepEqual(state, {
    editorTheme: 'monokai',
    fontSize: 18,
    panelLayout: 'tabs',
    recentChallengeKey: 'lodash.chunk@1.0.0',
    autoSaveEnabled: false,
  });
});

test('parsePreferences clamps fontSize and drops malformed numbers', () => {
  assert.equal(parsePreferences([pref('fontSize', 3)]).fontSize, 8);
  assert.equal(parsePreferences([pref('fontSize', 100)]).fontSize, 32);
  assert.equal(parsePreferences([pref('fontSize', Infinity)]).fontSize, 32);
  assert.equal(parsePreferences([pref('fontSize', -Infinity)]).fontSize, 8);
  assert.equal(parsePreferences([pref('fontSize', NaN)]).fontSize, 14);
  assert.equal(parsePreferences([pref('fontSize', '16')]).fontSize, 14);
  assert.equal(parsePreferences([pref('fontSize', null)]).fontSize, 14);
});

test('parsePreferences ignores values of the wrong type per key', () => {
  const state = parsePreferences([
    pref('editorTheme', 42),
    pref('panelLayout', { nested: true }),
    pref('recentChallengeKey', 7),
    pref('autoSaveEnabled', 'true'),
  ]);

  assert.deepEqual(state, { ...DEFAULT_PREFERENCES });
});

test('recentChallengeKey accepts strings and explicit null', () => {
  assert.equal(
    parsePreferences([pref('recentChallengeKey', 'a@1')]).recentChallengeKey,
    'a@1'
  );
  assert.equal(
    parsePreferences([pref('recentChallengeKey', 'a@1'), pref('recentChallengeKey', null)])
      .recentChallengeKey,
    null
  );
});

test('parsePreferences ignores unknown keys', () => {
  const state = parsePreferences([
    pref('bogus', 'nope'),
    pref('editortheme', 'lowercase-miss'),
    pref('editorTheme', 'dark'),
  ]);

  assert.equal(state.editorTheme, 'dark');
  assert.deepEqual(Object.keys(state).sort(), [...PREFERENCE_KEYS].sort());
});

test('duplicate keys resolve to the last valid value', () => {
  const state = parsePreferences([
    pref('fontSize', 5),
    pref('fontSize', 20),
    pref('editorTheme', 'light'),
    pref('editorTheme', ' monokai'),
    pref('autoSaveEnabled', false),
    pref('autoSaveEnabled', true),
  ]);

  assert.equal(state.fontSize, 20);
  assert.equal(state.editorTheme, ' monokai');
  assert.equal(state.autoSaveEnabled, true);

  const invalidFollows = parsePreferences([pref('fontSize', 20), pref('fontSize', 'x')]);
  assert.equal(invalidFollows.fontSize, 20);
});

test('serializePreferences emits known defined keys in PREFERENCE_KEYS order', () => {
  const records = serializePreferences({
    autoSaveEnabled: false,
    fontSize: 20,
    editorTheme: 'dark',
  });

  assert.deepEqual(records, [
    { key: 'editorTheme', value: 'dark' },
    { key: 'fontSize', value: 20 },
    { key: 'autoSaveEnabled', value: false },
  ]);
  assert.deepEqual(serializePreferences({}), []);
  assert.deepEqual(serializePreferences({ fontSize: undefined }), []);
  assert.deepEqual(
    serializePreferences({ fontSize: 20, bogus: 1 } as { fontSize: number; bogus: number }),
    [{ key: 'fontSize', value: 20 }]
  );
});

test('serialize then parse round-trips against the defaults', () => {
  const state = {
    editorTheme: 'dark',
    fontSize: 18,
    panelLayout: 'split',
    recentChallengeKey: 'lodash.chunk@1.0.0',
    autoSaveEnabled: false,
  };

  assert.deepEqual(parsePreferences(serializePreferences(state)), state);

  const partial = { fontSize: 10, autoSaveEnabled: true };
  assert.deepEqual(parsePreferences(serializePreferences(partial)), {
    ...DEFAULT_PREFERENCES,
    fontSize: 10,
    autoSaveEnabled: true,
  });

  const clamped = parsePreferences(serializePreferences({ fontSize: 3 }));
  assert.deepEqual(clamped, { ...DEFAULT_PREFERENCES, fontSize: 8 });
});
