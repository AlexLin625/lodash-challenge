// Progress file export/import controls for the top bar (docs/design-v1.md
// §3.1, §9.5). Zero persistence imports at runtime: every storage touch
// goes through the injected api props; the pure transfer logic lives in
// export-import.ts. All DOM side effects are confined to the small
// browserDownload hooks below.

import { useCallback, useRef, useState } from 'react';
import type { ImportResult } from '../persistence/dao.ts';
import type { ProgressExport } from '../persistence/validate.ts';
import {
  describeImportResult,
  INVALID_PROGRESS_FILE_MESSAGE,
  runExport,
  runImport,
  summarizeExport,
} from './export-import.ts';
import type { DownloadHooks } from './export-import.ts';

export interface ProgressIOApi {
  exportAll(): Promise<ProgressExport>;
  importAll(data: ProgressExport): Promise<ImportResult>;
  onSuccess?(): void;
}

export interface ProgressIOProps {
  disabled?: boolean;
  api: ProgressIOApi;
}

const browserDownload: DownloadHooks = {
  createObjectUrl(content) {
    const blob = new Blob([content], { type: 'application/json' });
    return URL.createObjectURL(blob);
  },
  triggerDownload(url, fileName) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  },
  revokeObjectUrl(url) {
    URL.revokeObjectURL(url);
  },
};

function exportMessage(data: ProgressExport): string {
  const counts = summarizeExport(data);
  return (
    `Exported ${counts.solutions} solutions, ${counts.completions} completions, ` +
    `${counts.attempts} attempts, ${counts.preferences} preferences.`
  );
}

export function ProgressIO({ disabled = false, api }: ProgressIOProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    setMessage(null);
    try {
      const data = await runExport(
        { exportAll: () => api.exportAll() },
        Date.now(),
        browserDownload
      );
      setMessage(exportMessage(data));
    } catch {
      setMessage('Failed to export progress');
    }
  }, [api]);

  const handleImportFile = useCallback(async () => {
    const input = fileInputRef.current;
    const file = input?.files?.[0];
    if (input !== null && input !== undefined) {
      input.value = '';
    }
    if (file === undefined || file === null) {
      return;
    }
    setMessage(null);
    try {
      const text = await file.text();
      const outcome = await runImport(
        { importAll: (data) => api.importAll(data) },
        text
      );
      if (outcome.ok) {
        setMessage(describeImportResult(outcome.result));
        api.onSuccess?.();
      } else {
        setMessage(INVALID_PROGRESS_FILE_MESSAGE);
      }
    } catch {
      setMessage(INVALID_PROGRESS_FILE_MESSAGE);
    }
  }, [api]);

  return (
    <div className="progress-io">
      <button
        type="button"
        className="btn settings-btn"
        onClick={() => {
          void handleExport();
        }}
        disabled={disabled}
      >
        Export progress
      </button>
      <button
        type="button"
        className="btn settings-btn"
        onClick={() => {
          fileInputRef.current?.click();
        }}
        disabled={disabled}
      >
        Import progress
      </button>
      <input
        ref={fileInputRef}
        type="file"
        className="progress-io-file"
        accept="application/json,.json"
        aria-label="Progress file to import"
        onChange={() => {
          void handleImportFile();
        }}
      />
      {message !== null && (
        <span className="progress-io-message" role="status">
          {message}
        </span>
      )}
    </div>
  );
}
