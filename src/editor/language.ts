// Maps bundle file paths to Monaco language ids. Pure (no monaco import) so it
// can be unit-tested in Node.

const EXTENSION_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.json': 'json',
  '.html': 'html',
  '.css': 'css',
  '.md': 'markdown',
  '.txt': 'plaintext',
};

export function languageForPath(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot <= 0) {
    return 'plaintext';
  }
  return EXTENSION_LANGUAGE[path.slice(dot)] ?? 'plaintext';
}
