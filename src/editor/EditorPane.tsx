import { useEffect, useRef } from 'react';
import { monaco } from './monaco.ts';
import type { WorkspaceFile, WorkspaceModels } from './workspace-models.ts';

export interface EditorPaneProps {
  files: WorkspaceFile[];
  activePath: string;
  models: WorkspaceModels | null;
  onActivePathChange: (path: string) => void;
}

function fileName(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}

export function EditorPane({ files, activePath, models, onActivePathChange }: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  // Create the editor once; switching models is handled by the effect below.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const editor = monaco.editor.create(container, {
      model: null,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      tabSize: 2,
      wordWrap: 'on',
      readOnly: true,
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
      theme: 'vs',
    });
    editorRef.current = editor;
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !models) {
      return;
    }
    const model = models.getModel(activePath);
    if (!model) {
      return;
    }
    editor.setModel(model);
    editor.updateOptions({ readOnly: models.isReadOnly(activePath) });
  }, [models, activePath]);

  return (
    <div className="editor-pane">
      <div className="editor-tabs" role="tablist" aria-label="Challenge files">
        {files.map((file) => {
          const active = file.path === activePath;
          return (
            <button
              key={file.path}
              type="button"
              role="tab"
              aria-selected={active}
              className={active ? 'tab active' : 'tab'}
              onClick={() => onActivePathChange(file.path)}
            >
              <span className="tab-name">{fileName(file.path)}</span>
              {file.readonly && <span className="tab-badge">readonly</span>}
            </button>
          );
        })}
      </div>
      <div className="editor-container" ref={containerRef} />
    </div>
  );
}
