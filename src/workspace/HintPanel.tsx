// Controlled progressive-disclosure hint panel. The reveal level lives in
// the workspace; this component only renders it. An empty hint list renders
// nothing, so challenges without hints keep their current layout.

import type { ChallengeHint } from '../challenges/types.ts';
import { nextRevealedLevel, remainingHintCount, visibleHints } from './hint-logic.ts';
import type { RevealedLevel } from './hint-logic.ts';

export interface HintPanelProps {
  hints: readonly ChallengeHint[];
  revealedLevel: RevealedLevel;
  onShowMore(): void;
}

export function HintPanel({ hints, revealedLevel, onShowMore }: HintPanelProps) {
  if (hints.length === 0) {
    return null;
  }

  const revealed = visibleHints(hints, revealedLevel);
  const remaining = remainingHintCount(hints, revealedLevel);
  const exhausted = nextRevealedLevel(hints, revealedLevel) === revealedLevel;

  return (
    <section className="hint-panel">
      <div className="hint-panel-header">
        <button type="button" className="btn" onClick={onShowMore} disabled={exhausted}>
          Show hint ({revealed.length}/{hints.length})
        </button>
        {remaining !== '' && (
          <span className="panel-hint" role="status">
            {remaining}
          </span>
        )}
      </div>
      {revealed.map((hint, index) => (
        <div key={`${hint.level}-${index}`} className="hint-item">
          <span className="badge hint-level-badge">Hint {hint.level}</span>
          <span className="hint-text">{hint.text}</span>
        </div>
      ))}
    </section>
  );
}
