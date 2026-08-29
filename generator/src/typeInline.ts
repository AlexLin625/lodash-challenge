import fs from 'node:fs';
import path from 'node:path';
import { Project, SyntaxKind } from 'ts-morph';
import type {
  EnumDeclaration,
  Identifier,
  ImportSpecifier,
  InterfaceDeclaration,
  Node,
  SourceFile,
  TypeAliasDeclaration,
} from 'ts-morph';
import { resolveModulePath } from './resolve.ts';
import { isTypeOnlyReference, referencedIdentifiers } from './unusedImports.ts';

/** A module file resolved against the upstream tree. */
export interface ResolvedUpstreamFile {
  path: string;
  text: string;
}

/**
 * Resolves a (relative) module specifier from the perspective of
 * `importerPath` (both upstream-relative posix paths) to an upstream file.
 */
export type ImportResolver = (importerPath: string, specifier: string) => ResolvedUpstreamFile | undefined;

export interface TypeInlineWarning {
  /** Local binding name of the import that stayed in place. */
  binding: string;
  moduleSpecifier: string;
  reason: string;
}

export interface TypeInlineReport {
  /** Type names injected into the starter, in injection (topological) order. */
  inlinedTypes: string[];
  /** Full text of the import declarations removed because every binding was inlined. */
  removedImports: string[];
  /** Type-only imports that could not be inlined; their imports are preserved. */
  warnings: TypeInlineWarning[];
}

export interface TypeInlineResult {
  content: string;
  report: TypeInlineReport;
}

type TypeDecl = TypeAliasDeclaration | InterfaceDeclaration | EnumDeclaration;

interface ClosureNode {
  name: string;
  file: string;
  text: string;
  deps: string[];
}

interface Candidate {
  spec: ImportSpecifier;
  exportedName: string;
  binding: string;
  moduleSpecifier: string;
  addedNodeNames: string[];
  error: string | null;
}

type ExportLookup =
  | { kind: 'local'; decl: TypeDecl }
  | { kind: 'reexport'; specifier: string; originalName: string }
  | { kind: 'value' }
  | { kind: 'none' };

/** Builds an {@link ImportResolver} over a real upstream directory. */
export function createUpstreamResolver(upstreamRoot: string): ImportResolver {
  const cache = new Map<string, ResolvedUpstreamFile | undefined>();
  return (importerPath, specifier) => {
    const resolved = resolveModulePath(importerPath, specifier, (candidate) => {
      const abs = path.join(upstreamRoot, candidate);
      return fs.existsSync(abs) && fs.statSync(abs).isFile();
    });
    if (!resolved) {
      return undefined;
    }
    if (!cache.has(resolved)) {
      const text = fs.readFileSync(path.join(upstreamRoot, resolved), 'utf8');
      cache.set(resolved, { path: resolved, text });
    }
    return cache.get(resolved);
  };
}

/**
 * Inlines type-only imports into the starter file itself
 * (docs/design-v1.md §6.1 B + §7): for every import binding whose references
 * all sit in type positions, the complete upstream declaration text (JSDoc,
 * generic constraints and leading comments preserved verbatim) is injected
 * into the starter together with its transitive type closure. Values
 * (parameter defaults like `= identity`) are never inlined and keep their
 * imports. Named aliases are followed and symbol-renamed deterministically;
 * anything else that cannot be resolved is preserved and reported as a warning.
 */
export function inlineTypeImports(starterText: string, starterPath: string, resolveImport: ImportResolver): TypeInlineResult {
  const project = new Project({ useInMemoryFileSystem: true });
  const starterSf = project.createSourceFile(path.posix.join('/', starterPath), starterText, { overwrite: true });
  const parsedFiles = new Map<string, SourceFile>();

  function parseUpstream(file: ResolvedUpstreamFile): SourceFile {
    let sf = parsedFiles.get(file.path);
    if (!sf) {
      sf = project.createSourceFile(path.posix.join('/upstream', file.path), file.text, { overwrite: true });
      parsedFiles.set(file.path, sf);
    }
    return sf;
  }

  const localTypeDecl = (sourceFile: SourceFile, name: string): TypeDecl | undefined =>
    sourceFile.getTypeAlias(name) ?? sourceFile.getInterface(name) ?? sourceFile.getEnum(name);

  const starterTypeDecls = new Set(
    starterSf
      .getStatements()
      .filter((s) => s.isKind(SyntaxKind.TypeAliasDeclaration) || s.isKind(SyntaxKind.InterfaceDeclaration) || s.isKind(SyntaxKind.EnumDeclaration))
      .map((s) => (s as TypeDecl).getName())
  );
  const starterValueDeclNames = collectValueDeclarationNames(starterSf);

  function lookupExport(sourceFile: SourceFile, exportedName: string): ExportLookup {
    const decl = localTypeDecl(sourceFile, exportedName);
    if (decl && decl.isExported()) {
      return { kind: 'local', decl };
    }
    for (const exportDecl of sourceFile.getExportDeclarations()) {
      for (const spec of exportDecl.getNamedExports()) {
        const outerName = spec.getAliasNode()?.getText() ?? spec.getName();
        if (outerName !== exportedName) {
          continue;
        }
        const originalName = spec.getName();
        const specifier = exportDecl.getModuleSpecifierValue();
        if (specifier === undefined) {
          const local = localTypeDecl(sourceFile, originalName);
          if (local) {
            return { kind: 'local', decl: local };
          }
          return { kind: 'value' };
        }
        return { kind: 'reexport', specifier, originalName };
      }
    }
    if (!decl && hasValueExport(sourceFile, exportedName)) {
      return { kind: 'value' };
    }
    return { kind: 'none' };
  }

  function hasValueExport(sourceFile: SourceFile, exportedName: string): boolean {
    for (const decl of sourceFile.getExportedDeclarations().get(exportedName) ?? []) {
      if (!(decl.isKind(SyntaxKind.TypeAliasDeclaration) || decl.isKind(SyntaxKind.InterfaceDeclaration) || decl.isKind(SyntaxKind.EnumDeclaration))) {
        return true;
      }
    }
    return false;
  }

  function importBindingOf(
    sourceFile: SourceFile,
    localName: string
  ): { specifier: string; exportedName: string } | 'non-inlineable' | undefined {
    for (const decl of sourceFile.getImportDeclarations()) {
      for (const spec of decl.getNamedImports()) {
        const alias = spec.getAliasNode();
        if ((alias?.getText() ?? spec.getName()) === localName) {
          return { specifier: decl.getModuleSpecifierValue(), exportedName: spec.getName() };
        }
      }
      const defaultImport = decl.getDefaultImport();
      if (defaultImport && defaultImport.getText() === localName) {
        return 'non-inlineable';
      }
      const namespaceImport = decl.getNamespaceImport();
      if (namespaceImport && namespaceImport.getText() === localName) {
        return 'non-inlineable';
      }
    }
    return undefined;
  }

  /** Local names referenced by a type declaration (globals, keywords and self names excluded). */
  function referenceNamesIn(decl: TypeDecl): string[] {
    const names: string[] = [];
    decl.forEachDescendant((node) => {
      if (!node.isKind(SyntaxKind.Identifier)) {
        return;
      }
      const identifier = node as Identifier;
      const parent = identifier.getParent();
      if (parent && (parent.isKind(SyntaxKind.TypeParameter) || nameNodeIs(parent, identifier) || isQualifiedNameRight(parent, identifier))) {
        return;
      }
      if (!names.includes(identifier.getText())) {
        names.push(identifier.getText());
      }
    });
    return names;
  }

  // ---- Candidate classification (all bindings, before any mutation) ----
  const refsByName = referencedIdentifiers(starterSf);
  const allBindingNames: string[] = [];
  const candidates: Candidate[] = [];
  const warnings: TypeInlineWarning[] = [];

  for (const decl of starterSf.getImportDeclarations()) {
    const moduleSpecifier = decl.getModuleSpecifierValue();
    const defaultImport = decl.getDefaultImport();
    if (defaultImport) {
      const binding = defaultImport.getText();
      allBindingNames.push(binding);
      const references = refsByName.get(binding) ?? [];
      if (references.length > 0 && references.every(isTypeOnlyReference)) {
        warnings.push({ binding, moduleSpecifier, reason: 'default type imports are not inlined' });
      }
    }
    const namespaceImport = decl.getNamespaceImport();
    if (namespaceImport) {
      const binding = namespaceImport.getText();
      allBindingNames.push(binding);
      const references = refsByName.get(binding) ?? [];
      if (references.length > 0 && references.every(isTypeOnlyReference)) {
        warnings.push({ binding, moduleSpecifier, reason: 'namespace type imports are not inlined' });
      }
    }
    for (const spec of decl.getNamedImports()) {
      const alias = spec.getAliasNode();
      const binding = alias?.getText() ?? spec.getName();
      allBindingNames.push(binding);
      const references = refsByName.get(binding) ?? [];
      if (references.length === 0 || !references.every(isTypeOnlyReference)) {
        continue;
      }
      candidates.push({ spec, exportedName: spec.getName(), binding, moduleSpecifier, addedNodeNames: [], error: null });
    }
  }

  const inlinedBindingNames = new Set<string>();
  const nodes = new Map<string, ClosureNode>();
  const inProgress = new Set<string>();

  function fail(candidate: Candidate, reason: string): void {
    if (!candidate.error) {
      candidate.error = reason;
    }
    for (const name of candidate.addedNodeNames) {
      nodes.delete(name);
    }
    candidate.addedNodeNames = [];
  }

  function bindingCollision(name: string, candidate: Candidate): string | undefined {
    if (starterValueDeclNames.has(name)) {
      return `name "${name}" collides with a declaration already present in the starter`;
    }
    const allowed = new Set(inlinedBindingNames);
    allowed.add(candidate.binding);
    if (allBindingNames.includes(name) && !allowed.has(name)) {
      return `name "${name}" collides with an import binding that stays in the starter`;
    }
    return undefined;
  }

  function addLocalNode(
    candidate: Candidate,
    sourceFile: SourceFile,
    sourcePath: string,
    decl: TypeDecl,
    sourceName: string,
    visibleName: string
  ): void {
    if (candidate.error) {
      return;
    }
    const existing = nodes.get(visibleName);
    if (existing) {
      if (existing.file !== sourcePath) {
        fail(candidate, `duplicate type name "${visibleName}" exported from ${existing.file} and ${sourcePath}`);
      }
      return;
    }
    if (starterTypeDecls.has(visibleName) || inProgress.has(visibleName)) {
      return;
    }
    const collision = bindingCollision(visibleName, candidate);
    if (collision) {
      fail(candidate, collision);
      return;
    }
    inProgress.add(visibleName);
    const node: ClosureNode = {
      name: visibleName,
      file: sourcePath,
      text: renamedDeclarationText(decl, sourceName, visibleName),
      deps: [],
    };
    for (const ref of referenceNamesIn(decl)) {
      if (candidate.error || ref === sourceName || starterTypeDecls.has(ref)) {
        continue;
      }
      const local = localTypeDecl(sourceFile, ref);
      if (local) {
        node.deps.push(ref);
        addLocalNode(candidate, sourceFile, sourcePath, local, ref, ref);
        continue;
      }
      const binding = importBindingOf(sourceFile, ref);
      if (binding === 'non-inlineable') {
        fail(candidate, `"${ref}" in ${sourcePath} is bound through a default/namespace import, which cannot be inlined`);
        break;
      }
      if (binding) {
        const target = resolveImport(sourcePath, binding.specifier);
        if (!target) {
          fail(candidate, `module "${binding.specifier}" (imported by ${sourcePath} for "${ref}") could not be resolved`);
          break;
        }
        node.deps.push(ref);
        addVisibleName(candidate, target, binding.exportedName, ref);
        continue;
      }
      if (starterValueDeclNames.has(ref)) {
        fail(candidate, `"${ref}" referenced by ${sourcePath}:${visibleName} collides with a value declaration in the starter`);
        break;
      }
      // Anything else is a global (PropertyKey, ArrayLike, ...) bound in the
      // ambient/lib context of the starter as well: no injection needed.
    }
    inProgress.delete(visibleName);
    if (!candidate.error) {
      nodes.set(visibleName, node);
      candidate.addedNodeNames.push(visibleName);
    }
  }

  /** Ensures an exported type is inlined under the name visible to its importer. */
  function addVisibleName(candidate: Candidate, file: ResolvedUpstreamFile, exportedName: string, visibleName: string): void {
    if (candidate.error) {
      return;
    }
    if (starterTypeDecls.has(visibleName)) {
      return;
    }
    const existing = nodes.get(visibleName);
    if (existing) {
      if (existing.file !== file.path) {
        fail(candidate, `duplicate type name "${visibleName}" exported from ${existing.file} and ${file.path}`);
      }
      return;
    }
    const sourceFile = parseUpstream(file);
    const lookup = lookupExport(sourceFile, exportedName);
    if (lookup.kind === 'local') {
      addLocalNode(candidate, sourceFile, file.path, lookup.decl, lookup.decl.getName(), visibleName);
      return;
    }
    if (lookup.kind === 'reexport') {
      const target = resolveImport(file.path, lookup.specifier);
      if (!target) {
        fail(candidate, `module "${lookup.specifier}" (re-exported by ${file.path}) could not be resolved`);
        return;
      }
      addVisibleName(candidate, target, lookup.originalName, visibleName);
      return;
    }
    addError(candidate, exportedName, file.path, lookup);
  }

  function addError(candidate: Candidate, name: string, exporterPath: string, lookup: ExportLookup): void {
    if (lookup.kind === 'value') {
      fail(candidate, `"${name}" exported by ${exporterPath} is a value, not an inlineable type`);
    } else {
      fail(candidate, `exported type "${name}" not found in ${exporterPath}`);
    }
  }

  // ---- Run one closure attempt per candidate (starter import order) ----
  for (const candidate of candidates) {
    const target = candidate.error ? undefined : resolveImport(starterPath, candidate.moduleSpecifier);
    if (!target) {
      fail(candidate, `module "${candidate.moduleSpecifier}" could not be resolved`);
    } else {
      addVisibleName(candidate, target, candidate.exportedName, candidate.binding);
    }
    inProgress.clear();
    if (candidate.error) {
      warnings.push({ binding: candidate.binding, moduleSpecifier: candidate.moduleSpecifier, reason: candidate.error });
    } else {
      inlinedBindingNames.add(candidate.binding);
    }
  }

  // ---- Apply import mutations ----
  const succeeded = candidates.filter((c) => !c.error);
  const specsToRemove = new Set(succeeded.map((c) => c.spec));
  const report: TypeInlineReport = { inlinedTypes: [], removedImports: [], warnings };

  let mutated = false;
  for (const decl of [...starterSf.getImportDeclarations()]) {
    const specs = decl.getNamedImports().filter((spec) => specsToRemove.has(spec));
    if (specs.length === 0) {
      continue;
    }
    const removesDeclaration =
      decl.getNamedImports().every((spec) => specsToRemove.has(spec)) && decl.getDefaultImport() == null && decl.getNamespaceImport() == null;
    const declarationText = decl.getText().trim();
    mutated = true;
    for (const spec of specs) {
      spec.remove();
    }
    if (removesDeclaration) {
      decl.remove();
      report.removedImports.push(declarationText);
    }
  }

  // ---- Inject the closure after the remaining imports ----
  const ordered = topoSortNodes(nodes);
  if (ordered.length > 0) {
    const firstStatement = starterSf.getStatements().find((s) => !s.isKind(SyntaxKind.ImportDeclaration));
    const block = `${ordered.map((node) => node.text).join('\n\n')}\n\n`;
    if (firstStatement) {
      starterSf.insertText(firstStatement.getStart(true), block);
    } else {
      starterSf.insertText(starterSf.getEnd(), `\n\n${block.trimEnd()}`);
    }
    report.inlinedTypes = ordered.map((node) => node.name);
  }

  let content = starterSf.getFullText();
  if (mutated) {
    content = content.replace(/^\n+/, '');
  }
  return { content, report };
}

function nameNodeIs(node: Node, child: Identifier): boolean {
  const getter = (node as { getNameNode?: () => Node }).getNameNode;
  return typeof getter === 'function' && getter.call(node) === child;
}

function isQualifiedNameRight(node: Node, child: Identifier): boolean {
  return node.isKind(SyntaxKind.QualifiedName) && (node as { getRight(): Node }).getRight() === child;
}

function collectValueDeclarationNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (name) {
      names.add(name);
    }
  }
  for (const variable of sourceFile.getVariableDeclarations()) {
    names.add(variable.getName());
  }
  for (const declaration of sourceFile.getClasses()) {
    const name = declaration.getName();
    if (name) {
      names.add(name);
    }
  }
  return names;
}

/** Clones and symbol-renames a declaration without mutating the cached upstream AST. */
function renamedDeclarationText(decl: TypeDecl, sourceName: string, visibleName: string): string {
  const text = decl.getFullText().trim();
  if (sourceName === visibleName) {
    return text;
  }
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('/renamed-type.ts', text, { overwrite: true });
  const clone = sourceFile.getTypeAlias(sourceName) ?? sourceFile.getInterface(sourceName) ?? sourceFile.getEnum(sourceName);
  if (!clone) {
    return text;
  }
  clone.rename(visibleName);
  return sourceFile.getFullText().trim();
}

/** Dependency topological order; declarations at the same level sort by name. */
function topoSortNodes(nodes: Map<string, ClosureNode>): ClosureNode[] {
  const levels = new Map<string, number>();
  const computing = new Set<string>();
  const levelOf = (name: string): number => {
    const cached = levels.get(name);
    if (cached !== undefined) {
      return cached;
    }
    if (computing.has(name)) {
      return 0;
    }
    computing.add(name);
    const node = nodes.get(name);
    let level = 0;
    if (node) {
      for (const dep of [...node.deps].sort()) {
        if (!nodes.has(dep)) {
          continue;
        }
        level = Math.max(level, levelOf(dep) + 1);
      }
    }
    computing.delete(name);
    levels.set(name, level);
    return level;
  };
  return [...nodes.values()].sort((a, b) => {
    const diff = levelOf(a.name) - levelOf(b.name);
    return diff !== 0 ? diff : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}
