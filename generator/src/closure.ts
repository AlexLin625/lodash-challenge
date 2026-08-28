import fs from 'node:fs';
import path from 'node:path';
import { Project } from 'ts-morph';
import { resolveModulePath } from './resolve.ts';

/**
 * Collects the transitive closure of a set of entry files (all files reachable
 * through relative imports), reading real files from the upstream tree.
 *
 * @param rootDir absolute path to the upstream repository root
 * @param entries upstream-relative posix paths of the entry files
 * @param overrides optional in-memory content overrides (used e.g. to seed the
 *        transformed starter before walking its remaining imports)
 * @returns map of upstream-relative path -> file content
 */
export function collectClosure(rootDir: string, entries: string[], overrides?: Map<string, string>): Map<string, string> {
  const result = new Map<string, string>();
  const queue = [...new Set(entries)];

  while (queue.length > 0) {
    const relativePath = queue.shift() as string;
    if (result.has(relativePath)) {
      continue;
    }
    const override = overrides?.get(relativePath);
    let content: string;
    if (override !== undefined) {
      content = override;
    } else {
      const absolutePath = path.join(rootDir, relativePath);
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        throw new Error(`[closure] referenced file does not exist: ${relativePath}`);
      }
      content = fs.readFileSync(absolutePath, 'utf8');
    }
    result.set(relativePath, content);

    for (const specifier of relativeImportSpecifiers(content)) {
      const resolved = resolveModulePath(relativePath, specifier, (candidate) => {
        const abs = path.join(rootDir, candidate);
        return fs.existsSync(abs) && fs.statSync(abs).isFile();
      });
      if (resolved) {
        queue.push(resolved);
      }
    }
  }

  return result;
}

function relativeImportSpecifiers(sourceText: string): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('/closure.ts', sourceText, { overwrite: true });
  const specifiers: string[] = [];
  for (const decl of sourceFile.getImportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (specifier.startsWith('.')) {
      specifiers.push(specifier);
    }
  }
  for (const decl of sourceFile.getExportDeclarations()) {
    const specifier = decl.getModuleSpecifier()?.getLiteralText();
    if (specifier && specifier.startsWith('.')) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}
