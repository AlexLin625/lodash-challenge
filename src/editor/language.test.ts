import { test } from 'node:test';
import assert from 'node:assert/strict';
import { languageForPath } from './language.ts';

test('languageForPath maps known extensions', () => {
  assert.equal(languageForPath('src/compat/array/compact.ts'), 'typescript');
  assert.equal(languageForPath('src/a.tsx'), 'typescript');
  assert.equal(languageForPath('x.js'), 'javascript');
  assert.equal(languageForPath('x.json'), 'json');
  assert.equal(languageForPath('x.md'), 'markdown');
  assert.equal(languageForPath('index.html'), 'html');
});

test('languageForPath falls back to plaintext', () => {
  assert.equal(languageForPath('x.unknown'), 'plaintext');
  assert.equal(languageForPath('noext'), 'plaintext');
  assert.equal(languageForPath('.hidden'), 'plaintext');
});
