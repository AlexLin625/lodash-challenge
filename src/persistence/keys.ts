import type { ChallengeKey } from './domain.ts';

export function toChallengeKeyTuple(key: ChallengeKey): [string, string] {
  return [key.challengeId, key.challengeVersion];
}

export function challengeKeyId(key: ChallengeKey): string {
  return JSON.stringify(toChallengeKeyTuple(key));
}
