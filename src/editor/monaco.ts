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

import * as monaco from '../../node_modules/monaco-editor/esm/vs/editor/editor.api.js';
import '../../node_modules/monaco-editor/esm/vs/languages/definitions/typescript/register.js';
import '../../node_modules/monaco-editor/esm/vs/languages/features/typescript/register.js';
import editorWorker from '../../node_modules/monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from '../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker?worker';

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

export { monaco };
