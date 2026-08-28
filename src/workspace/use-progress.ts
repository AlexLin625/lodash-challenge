// Progress-summary reading hook for the workspace (docs/design-v1.md §10).
// Pulls the DAO progress summary once when a reader appears and exposes a
// refresh trigger so passed runs update the catalog badges. Errors are kept
// quiet here — the storage banner comes from bootstrap.onStorageUnavailable.

import { useCallback, useEffect, useState } from 'react';
import type { ProgressSummary } from '../persistence/dao.ts';

export interface ProgressReader {
  getProgressSummary(): Promise<ProgressSummary>;
}

export interface ChallengeProgressState {
  summary: ProgressSummary | null;
  refresh: () => void;
}

export function useChallengeProgressSummary(
  reader: ProgressReader | null
): ChallengeProgressState {
  const [summary, setSummary] = useState<ProgressSummary | null>(null);

  const refresh = useCallback(() => {
    if (reader === null) {
      return;
    }
    reader
      .getProgressSummary()
      .then((next) => {
        setSummary(next);
      })
      .catch((error: unknown) => {
        console.warn('Failed to read progress summary; keeping previous value.', error);
      });
  }, [reader]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { summary, refresh };
}
