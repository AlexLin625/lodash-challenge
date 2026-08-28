// Pure export/import transfer logic for progress files (docs/design-v1.md
// §3.1, §9.5). No DOM and no DAO runtime: the download side effects arrive
// through the injected DownloadHooks, so the revoke-in-finally guarantee is
// observable under node --test. Import paths only need asProgressExport,
// the public validator from the persistence layer.

import { asProgressExport } from '../persistence/validate.ts';
import type { ProgressExport } from '../persistence/validate.ts';
import type { ImportResult } from '../persistence/dao.ts';

export interface ExportApi {
  exportAll(): Promise<ProgressExport>;
}

export interface ImportApi {
  importAll(data: ProgressExport): Promise<ImportResult>;
}

export interface DownloadHooks {
  createObjectUrl(content: string): string;
  triggerDownload(url: string, fileName: string): void;
  revokeObjectUrl(url: string): void;
}

export interface ExportCounts {
  solutions: number;
  completions: number;
  attempts: number;
  preferences: number;
}

export type ImportOutcome =
  | { ok: true; result: ImportResult }
  | { ok: false; message: string };

export const INVALID_PROGRESS_FILE_MESSAGE = 'Invalid progress file';

export function exportFileName(now: number): string {
  const isoDate = new Date(now).toISOString().slice(0, 10);
  return `lodash-challenge-progress-${isoDate}.json`;
}

export function serializeForDownload(data: ProgressExport): string {
  return JSON.stringify(data, null, 2);
}

export function summarizeExport(data: ProgressExport): ExportCounts {
  return {
    solutions: data.solutions.length,
    completions: data.completions.length,
    attempts: data.attempts.length,
    preferences: data.preferences.length,
  };
}

export function describeImportResult(result: ImportResult): string {
  return (
    `Imported ${result.importedSolutions} solutions, ` +
    `${result.importedCompletions} completions, ` +
    `${result.importedAttempts} attempts, ` +
    `${result.importedPreferences} preferences ` +
    `(${result.skippedConflicts} conflicts skipped).`
  );
}

export async function runExport(
  api: ExportApi,
  now: number,
  download: DownloadHooks
): Promise<ProgressExport> {
  const data = await api.exportAll();
  const fileName = exportFileName(now);
  const url = download.createObjectUrl(serializeForDownload(data));
  try {
    download.triggerDownload(url, fileName);
  } finally {
    download.revokeObjectUrl(url);
  }
  return data;
}

export function parseImportFile(text: string): ProgressExport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  try {
    return asProgressExport(parsed);
  } catch {
    return null;
  }
}

export async function runImport(api: ImportApi, text: string): Promise<ImportOutcome> {
  const data = parseImportFile(text);
  if (data === null) {
    return { ok: false, message: INVALID_PROGRESS_FILE_MESSAGE };
  }
  try {
    const result = await api.importAll(data);
    return { ok: true, result };
  } catch {
    return { ok: false, message: INVALID_PROGRESS_FILE_MESSAGE };
  }
}
