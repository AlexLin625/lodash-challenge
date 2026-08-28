import type { TestRunResult } from '../runner/protocol.ts';
import { summarizeTests } from '../runner/protocol.ts';

export type RunPhase = 'idle' | 'running' | TestRunResult['status'];

export interface TestPanelProps {
  phase: RunPhase;
  result: TestRunResult | null;
}

const STATUS_LABELS: Record<RunPhase, string> = {
  idle: 'Idle',
  running: 'Running…',
  passed: 'Passed',
  failed: 'Failed',
  'compile-error': 'Compile error',
  'runtime-error': 'Runtime error',
  timeout: 'Timeout',
};

const TEST_ICONS: Record<string, string> = {
  passed: '✓',
  failed: '✗',
  skipped: '–',
};

export function TestPanel({ phase, result }: TestPanelProps) {
  const summary = result ? summarizeTests(result.tests) : null;
  const failedRun = phase === 'compile-error' || phase === 'runtime-error' || phase === 'timeout';
  const hasResult = result !== null && phase !== 'running';

  return (
    <div className={`test-panel panel-status-${phase}`}>
      <div className="test-panel-header">
        <span className="run-status">{STATUS_LABELS[phase]}</span>
        {hasResult && result && summary && (
          <span className="run-summary">
            {summary.passed} passed · {summary.failed} failed · {summary.skipped} skipped · {result.durationMs}ms
          </span>
        )}
      </div>

      {phase === 'idle' && <p className="panel-hint">Press Run to execute the tests in the sandbox.</p>}
      {phase === 'running' && <p className="panel-hint">Compiling and running in the sandbox…</p>}

      {failedRun && result?.error && <pre className="error-block">{result.error}</pre>}

      {hasResult && result && result.tests.length === 0 && !failedRun && (
        <p className="panel-hint">No test cases were reported.</p>
      )}

      {hasResult && result && result.tests.length > 0 && (
        <ul className="test-list">
          {result.tests.map((test, index) => (
            <li key={index} className={`test test-${test.status}`}>
              <span className="test-icon" aria-hidden="true">
                {TEST_ICONS[test.status] ?? '·'}
              </span>
              <div className="test-body">
                <span className="test-name">{test.name}</span>
                {test.error && <pre className="test-error">{test.error}</pre>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {result && result.console.length > 0 && (
        <section className="console-block">
          <h4 className="console-title">Console</h4>
          <ul className="console-list">
            {result.console.map((entry, index) => (
              <li key={index} className={`console-line console-${entry.method}`}>
                <span className="console-method">{entry.method}</span>
                <span className="console-args">{entry.args.join(' ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
