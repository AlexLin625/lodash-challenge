// Monaco bootstrap for the challenge workspace.
//
// Installs the Vite `?worker` factories so the TS language service and the
// editor core run in dedicated workers.
//
// Note: the workers are imported via *relative* paths into `node_modules`
// instead of package specifiers. monaco-editor's `exports` field uses a
// catch-all wildcard, which makes Vite/Rolldown fail to resolve query-imports
// like `monaco-editor/.../ts.worker?worker`. A relative path bypasses package
// `exports` resolution, so `?worker` is handled normally.
//
// This module is browser-only and must not be imported from Node tests.

import * as monaco from 'monaco-editor';
import { typescriptDefaults } from '../../node_modules/monaco-editor/esm/vs/languages/features/typescript/register.js';
import editorWorker from '../../node_modules/monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from '../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// A challenge is a small multi-file TypeScript workspace. Monaco otherwise
// syncs only models that have been opened in the editor, so an editable file
// can report a false "Cannot find module" diagnostic for a readonly dependency
// (for example maxBy.ts -> identity.ts) until that dependency's tab is opened.
// Hidden test/runtime files are not models, so eager sync remains scoped to the
// starter's compilable dependency closure.
typescriptDefaults.setEagerModelSync(true);

if (!self.MonacoEnvironment) {
  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker();
      }
      return new editorWorker();
    },
  };
}

// Monaco ships these themes out of the box; no defineTheme call is needed.
const BUILTIN_EDITOR_THEMES: readonly string[] = ['vs', 'vs-dark', 'hc-black', 'hc-light'];

export function normalizeEditorTheme(theme: string): string {
  return BUILTIN_EDITOR_THEMES.includes(theme) ? theme : 'vs';
}

export function setEditorTheme(theme: string): void {
  monaco.editor.setTheme(normalizeEditorTheme(theme));
}

export { monaco };
