// Pure catalog-facing projections over a DAO progress summary
// (docs/design-v1.md §10). Completed challenge ids collapse across
// challenge versions, and the totals label degrades to '' when the
// catalog/progress has nothing to report.

import type { ProgressSummary } from '../persistence/dao.ts';
import type { ProgressTotals } from '../persistence/summary.ts';

export function completedChallengeIds(summary: ProgressSummary): Set<string> {
  const ids = new Set<string>();
  for (const progress of summary.byChallenge.values()) {
    if (progress.completed) {
      ids.add(progress.key.challengeId);
    }
  }
  return ids;
}

export function progressTotalsLabel(totals: ProgressTotals): string {
  if (totals.total === 0) {
    return '';
  }
  return `${totals.completed} / ${totals.total} completed`;
}
