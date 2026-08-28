import { createHash } from 'node:crypto';

/** Returns the hex SHA-256 digest of a UTF-8 string. */
export function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/** Serializes a value to a stable canonical JSON string (sorted keys, 2-space indent). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + '\n';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

/** Hashes a list of parts deterministically. */
export function hashOfParts(parts: string[]): string {
  return sha256Hex(parts.join('\u0000'));
}
