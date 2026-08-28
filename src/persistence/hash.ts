import { sha256Hex } from '../challenges/integrity.ts';

export async function sourceHash(
  files: Readonly<Record<string, string>>,
  editablePaths: readonly string[]
): Promise<string> {
  const paths = [...new Set(editablePaths)].sort();
  const entries = paths.map((path) => [path, files[path] ?? '']);
  return sha256Hex(JSON.stringify(entries));
}
