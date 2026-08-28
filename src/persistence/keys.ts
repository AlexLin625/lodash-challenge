import type { ChallengeKey } from './domain.ts';

// Single addressing key domain for the composite stores (solutions and
// completions): the raw [challengeId, challengeVersion] tuple. The DAO,
// the in-memory backing (via portKeyToId) and IndexedDB (via native
// compound keys) all consume exactly this form.
export function toChallengeKeyTuple(key: ChallengeKey): [string, string] {
  return [key.challengeId, key.challengeVersion];
}
