import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProgressExport } from '../persistence/validate.ts';
import type { ImportResult } from '../persistence/dao.ts';
import {
  describeImportResult,
  exportFileName,
  INVALID_PROGRESS_FILE_MESSAGE,
  parseImportFile,
  runExport,
  runImport,
  serializeForDownload,
  summarizeExport,
} from './export-import.ts';
import type { DownloadHooks } from './export-import.ts';

function sampleExport(overrides: Partial<ProgressExport> = {}): ProgressExport {
  return {
    version: 1,
    exportedAt: 1_700_000_000_000,
    solutions: [
      {
        challengeId: 'chunk',
        challengeVersion: '1',
        files: { 'main.js': 'export default function chunk() {}' },
        starterHash: 'aa',
        createdAt: 1,
        updatedAt: 2,
        runCount: 3,
      },
    ],
    completions: [
      {
        challengeId: 'chunk',
        challengeVersion: '1',
        firstPassedAt: 1,
        lastPassedAt: 2,
        bestDurationMs: 100,
        passingSourceHash: 'bb',
        attemptCountAtFirstPass: 1,
      },
    ],
    attempts: [
      {
        id: 'chunk@1@1',
        challengeId: 'chunk',
        challengeVersion: '1',
        startedAt: 1,
        durationMs: 100,
        result: 'passed',
        passedTests: 5,
        totalTests: 5,
        sourceHash: 'bb',
      },
    ],
    preferences: [{ key: 'editorTheme', value: 'vs-dark' }],
    ...overrides,
  };
}

function fakeDownload(hooks: Partial<DownloadHooks> = {}) {
  const calls: { create: string[]; trigger: (readonly [string, string])[]; revoke: string[] } = {
    create: [],
    trigger: [],
    revoke: [],
  };
  const download: DownloadHooks = {
    createObjectUrl(content) {
      calls.create.push(content);
      return 'blob:fake-url';
    },
    triggerDownload(url, fileName) {
      calls.trigger.push([url, fileName] as const);
    },
    revokeObjectUrl(url) {
      calls.revoke.push(url);
    },
    ...hooks,
  };
  return { download, calls };
}

test('exportFileName uses the UTC date of the given timestamp', () => {
  assert.equal(exportFileName(Date.UTC(2026, 7, 29, 0, 0, 0)), 'lodash-challenge-progress-2026-08-29.json');
  assert.equal(
    exportFileName(Date.UTC(2026, 0, 5, 23, 59, 59, 999)),
    'lodash-challenge-progress-2026-01-05.json'
  );
});

test('serializeForDownload pretty-prints the export with two spaces', () => {
  const data = sampleExport();
  assert.equal(serializeForDownload(data), JSON.stringify(data, null, 2));
});

test('summarizeExport counts the four record collections', () => {
  const counts = summarizeExport(sampleExport());
  assert.deepEqual(counts, { solutions: 1, completions: 1, attempts: 1, preferences: 1 });
  const empty = summarizeExport(
    sampleExport({ solutions: [], completions: [], attempts: [], preferences: [] })
  );
  assert.deepEqual(empty, { solutions: 0, completions: 0, attempts: 0, preferences: 0 });
});

test('describeImportResult renders a one-line English summary', () => {
  const result: ImportResult = {
    importedSolutions: 2,
    importedCompletions: 1,
    importedAttempts: 5,
    importedPreferences: 4,
    skippedConflicts: 1,
  };
  assert.equal(
    describeImportResult(result),
    'Imported 2 solutions, 1 completions, 5 attempts, 4 preferences (1 conflicts skipped).'
  );
});

test('runExport hands the serialized payload to a fresh url and revokes it', async () => {
  const data = sampleExport();
  const { download, calls } = fakeDownload();
  const returned = await runExport({ exportAll: async () => data }, Date.UTC(2026, 7, 29), download);

  assert.deepEqual(returned, data);
  assert.deepEqual(calls.create, [JSON.stringify(data, null, 2)]);
  assert.deepEqual(calls.trigger, [['blob:fake-url', 'lodash-challenge-progress-2026-08-29.json']]);
  assert.deepEqual(calls.revoke, ['blob:fake-url']);
});

test('runExport revokes the object url even when the download click throws', async () => {
  const data = sampleExport();
  const { download, calls } = fakeDownload({
    triggerDownload() {
      throw new Error('click failed');
    },
  });

  await assert.rejects(
    () => runExport({ exportAll: async () => data }, 0, download),
    /click failed/
  );
  assert.deepEqual(calls.revoke, ['blob:fake-url']);
});

test('runExport surfaces exportAll failures without touching the download hooks', async () => {
  const { download, calls } = fakeDownload();
  await assert.rejects(
    () =>
      runExport(
        {
          exportAll() {
            return Promise.reject(new Error('storage unavailable'));
          },
        },
        0,
        download
      ),
    /storage unavailable/
  );
  assert.deepEqual(calls.create, []);
  assert.deepEqual(calls.revoke, []);
});

test('parseImportFile accepts a valid serialized export', () => {
  const data = sampleExport();
  const parsed = parseImportFile(serializeForDownload(data));
  assert.notEqual(parsed, null);
  assert.equal(parsed?.version, 1);
  assert.equal(parsed?.solutions.length, 1);
});

test('parseImportFile rejects malformed JSON and invalid shapes', () => {
  assert.equal(parseImportFile('{not json'), null);
  assert.equal(parseImportFile('[]'), null);
  assert.equal(parseImportFile('{"version": 2}'), null);
  assert.equal(parseImportFile(JSON.stringify({ version: 1 })), null);
});

test('runImport passes a validated export to importAll and reports the result', async () => {
  const data = sampleExport();
  const result: ImportResult = {
    importedSolutions: 1,
    importedCompletions: 1,
    importedAttempts: 1,
    importedPreferences: 1,
    skippedConflicts: 0,
  };
  const seen: ProgressExport[] = [];
  const outcome = await runImport(
    {
      importAll: async (incoming) => {
        seen.push(incoming);
        return result;
      },
    },
    serializeForDownload(data)
  );

  assert.deepEqual(outcome, { ok: true, result });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.exportedAt, data.exportedAt);
  assert.deepEqual(seen[0]?.solutions, data.solutions);
});

test('runImport maps invalid files and failed imports to the shared error message', async () => {
  const bogus = await runImport({ importAll: async () => assert.fail('must not run') }, 'nope');
  assert.deepEqual(bogus, { ok: false, message: INVALID_PROGRESS_FILE_MESSAGE });

  const rejected = await runImport(
    {
      importAll() {
        return Promise.reject(new Error('quota exceeded'));
      },
    },
    serializeForDownload(sampleExport())
  );
  assert.deepEqual(rejected, { ok: false, message: INVALID_PROGRESS_FILE_MESSAGE });
});
