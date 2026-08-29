// Editor scoping for challenge bundles (docs/design-v1.md §8.1).
//
// §8.1 lets the editor carry "the compilable dependency closure" of the
// starter: Monaco manages the user-editable files plus the readonly files
// those files actually import, so cross-file go-to-definition and type
// diagnostics keep working without dumping the bundle's entire transitive
// test-spec closure into the tab bar. Everything outside the closure is
// treated like test scope and hidden from the editor.
//
// Hiding is a UI concern only, not secrecy: per the §3.2 trust model the
// user is a trusted local learner and nothing in the bundle is confidential,
// so hidden files are simply merged back in at run time by the workspace.

export interface VisibleFilesResult {
  /** Bundle paths the editor should open, sorted by path. */
  visible: string[];
  /** Every other bundle path (bundle minus visible), sorted by path. */
  hidden: string[];
}

/** Spec suites and runtime harness shims stay out of the editor, always. */
function isTestPath(path: string): boolean {
  return path.endsWith('.spec.ts') || path.startsWith('runtime/');
}

// Static module references with *relative* specifiers: `import … from '…'`,
// `import type … from '…'`, `export … from '…'`, bare side-effect
// `import '…'`, and dynamic `import('…')`. Over-matching (say, inside a
// comment) is harmless: unresolvable specifiers are skipped.
const FROM_SPECIFIER_RE = /\bfrom\s*['"](\.[^'"\n]*)['"]/g;
const BARE_IMPORT_RE = /\bimport\s+['"](\.[^'"\n]*)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"](\.[^'"\n]*)['"]\s*\)/g;

function importedSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const re of [FROM_SPECIFIER_RE, BARE_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    for (let match = re.exec(source); match !== null; match = re.exec(source)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/** Directory portion of a bundle path ('src/a/b.ts' -> 'src/a', 'a.ts' -> ''). */
function dirname(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/** Join a relative specifier onto its importer's directory, normalising '.'/'..'. */
function resolveBase(fromDir: string, specifier: string): string | undefined {
  const segments = fromDir === '' ? [] : fromDir.split('/');
  for (const part of specifier.split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      if (segments.length === 0) {
        return undefined; // Escapes past the bundle root.
      }
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join('/');
}

/**
 * Resolve one relative specifier against the bundle keys, trying the exact
 * path, then `+'.ts'`, then `+'/index.ts'`. Returns undefined when nothing
 * hits; resolution failures are skipped, never thrown.
 */
function resolveSpecifier(
  eligible: ReadonlySet<string>,
  fromDir: string,
  specifier: string
): string | undefined {
  const base = resolveBase(fromDir, specifier);
  if (base === undefined) {
    return undefined;
  }
  for (const candidate of [base, base + '.ts', base + '/index.ts']) {
    if (eligible.has(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Compute which bundle files the editor may show.
 *
 * - Editable files are always visible (they are the task's starting point)
 *   and seed the BFS over relative imports.
 * - `.spec.ts` files and `runtime/` paths are always hidden, even when
 *   referenced; they never seed or propagate visibility either.
 * - Every other readonly file becomes visible only if the closure of the
 *   visible set references it transitively; all the rest are hidden.
 *
 * Both outputs are sorted by path (lexicographic) and together partition
 * the bundle keys in `files`.
 */
export function computeVisibleFiles(
  files: Readonly<Record<string, string>>,
  editableFiles: readonly string[],
  readonlyFiles: readonly string[]
): VisibleFilesResult {
  // Only bundle-present, manifest-declared, non-test files can ever be
  // visible; the editable set seeds the BFS closure over relative imports.
  const editable = new Set(editableFiles);
  const declared = new Set(readonlyFiles);
  const eligible = new Set<string>();
  for (const path of Object.keys(files)) {
    if ((editable.has(path) || declared.has(path)) && !isTestPath(path)) {
      eligible.add(path);
    }
  }

  const visible = new Set<string>();
  const queue: string[] = [];
  for (const path of editable) {
    if (eligible.has(path) && !visible.has(path)) {
      visible.add(path);
      queue.push(path);
    }
  }

  for (let i = 0; i < queue.length; i++) {
    const path = queue[i];
    for (const specifier of importedSpecifiers(files[path])) {
      const resolved = resolveSpecifier(eligible, dirname(path), specifier);
      if (resolved !== undefined && !visible.has(resolved)) {
        visible.add(resolved);
        queue.push(resolved);
      }
    }
  }

  const all = Object.keys(files);
  const hidden = all.filter((path) => !visible.has(path));
  return {
    visible: all.filter((path) => visible.has(path)).sort(),
    hidden: hidden.sort(),
  };
}
