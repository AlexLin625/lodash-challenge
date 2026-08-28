import type { ChallengeCatalog } from '../challenges/types.ts';

export interface ChallengeListProps {
  catalog: ChallengeCatalog | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const DIFFICULTY_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

function byDifficulty(a: { difficulty: string }, b: { difficulty: string }): number {
  return (DIFFICULTY_ORDER[a.difficulty] ?? 3) - (DIFFICULTY_ORDER[b.difficulty] ?? 3);
}

export function ChallengeList({ catalog, selectedId, onSelect }: ChallengeListProps) {
  if (!catalog) {
    return null;
  }
  const groups = new Map<string, typeof catalog.challenges>();
  for (const challenge of catalog.challenges) {
    const list = groups.get(challenge.category) ?? [];
    list.push(challenge);
    groups.set(challenge.category, list);
  }
  const categories = [...groups.keys()].sort();

  return (
    <nav className="challenge-list" aria-label="Challenges">
      {categories.map((category) => (
        <section key={category} className="challenge-group">
          <h3 className="group-title">{category}</h3>
          <ul className="group-items">
            {[...groups.get(category)!].sort(byDifficulty).map((challenge) => {
              const selected = challenge.id === selectedId;
              return (
                <li key={challenge.id}>
                  <button
                    type="button"
                    className={selected ? 'challenge-item selected' : 'challenge-item'}
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => onSelect(challenge.id)}
                  >
                    <span className="challenge-slug">{challenge.title}</span>
                    <span className={`badge badge-${challenge.difficulty}`}>{challenge.difficulty}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
