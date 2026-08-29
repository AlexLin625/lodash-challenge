// Pure helpers for splitting a challenge bundle into editor-visible files and
// hidden test files (the `.spec.ts` suites and `runtime/` harness shims that
// the user should never edit). Browser-free so node:test can cover them; the
// Monaco-backed WorkspaceModels re-exports these for convenience.

/**
 * True for bundle paths that are hidden from the editor: the jest spec files
 * (docs/design-v1.md §4 test files) and the runtime/ test-harness shims. The
 * runner still receives these from the original bundle (the workspace merges
 * them back in at run time), so hiding them never removes tests.
 */
export function isTestBundlePath(path: string): boolean {
  return path.endsWith('.spec.ts') || path.startsWith('runtime/');
}

/** Partition a bundle map into editor-visible files and hidden test files. */
export function partitionBundleFiles(files: Record<string, string>): {
  editorFiles: Record<string, string>;
  testFiles: Record<string, string>;
} {
  const editorFiles: Record<string, string> = {};
  const testFiles: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (isTestBundlePath(path)) {
      testFiles[path] = content;
    } else {
      editorFiles[path] = content;
    }
  }
  return { editorFiles, testFiles };
}
