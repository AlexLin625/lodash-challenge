// Pure progressive-disclosure logic for the hint panel (docs/design-v1.md
// §5.2 hints). Extracted from HintPanel.tsx so node:test can cover it
// without a JSX transform. Levels run 1..3; revealedLevel 0 means nothing
// has been shown yet.

import type { ChallengeHint } from '../challenges/types.ts';

export type RevealedLevel = 0 | 1 | 2 | 3;

/**
 * The level revealed by the next "show hint" click: the smallest hint level
 * above the current one, or `current` unchanged when there is nothing left
 * to reveal (capped at the highest available level).
 */
export function nextRevealedLevel(
  hints: readonly ChallengeHint[],
  current: RevealedLevel
): RevealedLevel {
  let next = current;
  for (const hint of hints) {
    if (hint.level > current && (next === current || hint.level < next)) {
      next = hint.level;
    }
  }
  return next;
}

/** Hints at or below the revealed level, ordered by ascending level. */
export function visibleHints(
  hints: readonly ChallengeHint[],
  revealedLevel: RevealedLevel
): ChallengeHint[] {
  return hints
    .filter((hint) => hint.level <= revealedLevel)
    .sort((a, b) => a.level - b.level);
}

/** Human label for unrevealed hints: "" when none are left. */
export function remainingHintCount(
  hints: readonly ChallengeHint[],
  revealedLevel: RevealedLevel
): string {
  const remaining = hints.filter((hint) => hint.level > revealedLevel).length;
  if (remaining === 0) {
    return '';
  }
  return `${remaining} more hint${remaining === 1 ? '' : 's'}`;
}
