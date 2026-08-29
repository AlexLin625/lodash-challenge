// Owns the lifecycle of the Monaco models for one loaded challenge.
//
// Every bundle file (editable + readonly) gets a `monaco.editor.TextModel`
// keyed by its bundle-relative path. Model URIs mirror the bundle layout so the
// TS language service can resolve relative imports across virtual files.
//
// Switching challenges or unmounting must call `disposeAll()`; reusing a model
// from a previous challenge would leak into the new one.

import type { IDisposable } from 'monaco-editor';
import { isTestBundlePath } from './bundle-files.ts';
import { languageForPath } from './language.ts';
import { monaco } from './monaco.ts';

export { isTestBundlePath, partitionBundleFiles } from './bundle-files.ts';

export interface WorkspaceFile {
  path: string;
  readonly: boolean;
}

export interface WorkspaceModelsOptions {
  /** Fires with every edit of an editable model (used for the draft seam). */
  onEditableChange?: (path: string, value: string) => void;
}

function bundleUri(path: string): monaco.Uri {
  return monaco.Uri.file('/' + path.replace(/^\/+/, ''));
}

export class WorkspaceModels {
  private readonly options: WorkspaceModelsOptions;
  private readonly models = new Map<string, monaco.editor.ITextModel>();
  private readonly listeners = new Map<string, IDisposable>();
  private files: WorkspaceFile[] = [];

  constructor(options: WorkspaceModelsOptions = {}) {
    this.options = options;
  }

  /** Disposes previous models, then creates one per bundle file (editable first, tests excluded). */
  create(files: Record<string, string>, editableFiles: readonly string[]): void {
    this.disposeAll();
    const hidden = new Set(Object.keys(files).filter(isTestBundlePath));
    const editable = new Set(editableFiles.filter((p) => !hidden.has(p)));
    const paths = [
      ...editable,
      ...Object.keys(files).filter((p) => !editable.has(p) && !hidden.has(p)),
    ];
    this.files = paths.map((path) => ({ path, readonly: !editable.has(path) }));

    for (const path of paths) {
      const model = monaco.editor.createModel(files[path] ?? '', languageForPath(path), bundleUri(path));
      this.models.set(path, model);
      if (!editable.has(path)) {
        continue;
      }
      const listener = model.onDidChangeContent(() => {
        this.options.onEditableChange?.(path, model.getValue());
      });
      this.listeners.set(path, listener);
    }
  }

  fileList(): WorkspaceFile[] {
    return this.files;
  }

  getModel(path: string): monaco.editor.ITextModel | undefined {
    return this.models.get(path);
  }

  isReadOnly(path: string): boolean {
    const file = this.files.find((f) => f.path === path);
    return file?.readonly ?? true;
  }

  getValue(path: string): string {
    return this.models.get(path)?.getValue() ?? '';
  }

  /** Current content of every model, keyed by bundle-relative path. */
  getAllContents(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [path, model] of this.models) {
      out[path] = model.getValue();
    }
    return out;
  }

  /** Restores every model to its starter content. */
  resetToStarter(starter: Record<string, string>): void {
    for (const [path, model] of this.models) {
      const value = starter[path];
      if (value !== undefined) {
        model.setValue(value);
      }
    }
  }

  disposeAll(): void {
    for (const listener of this.listeners.values()) {
      listener.dispose();
    }
    this.listeners.clear();
    for (const model of this.models.values()) {
      model.dispose();
    }
    this.models.clear();
    this.files = [];
  }
}
