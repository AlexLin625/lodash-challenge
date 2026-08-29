import { useState } from 'react';
import type { TestRunResult } from '../runner/protocol.ts';
import { summarizeTests } from '../runner/protocol.ts';
import { errorPreview, nextErrorDetailLevel, type ErrorDetailLevel } from './test-panel-logic.ts';

export type RunPhase = 'idle' | 'running' | TestRunResult['status'];

export interface TestPanelProps {
  phase: RunPhase;
  result: TestRunResult | null;
}

interface DetailsState {
  result: TestRunResult | null;
  casesOpen: boolean;
  errorLevels: Record<number, ErrorDetailLevel>;
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
  const [details, setDetails] = useState<DetailsState>({ result: null, casesOpen: false, errorLevels: {} });
  const summary = result ? summarizeTests(result.tests) : null;
  const failedRun = phase === 'compile-error' || phase === 'runtime-error' || phase === 'timeout';
  const hasResult = result !== null && phase !== 'running';
  const detailsAreCurrent = details.result === result;
  const casesOpen = detailsAreCurrent && details.casesOpen;

  const toggleCases = (): void => {
    setDetails((current) => ({
      result,
      casesOpen: current.result === result ? !current.casesOpen : true,
      errorLevels: current.result === result ? current.errorLevels : {},
    }));
  };

  const toggleError = (index: number): void => {
    setDetails((current) => {
      const errorLevels = current.result === result ? current.errorLevels : {};
      return {
        result,
        casesOpen: true,
        errorLevels: {
          ...errorLevels,
          [index]: nextErrorDetailLevel(errorLevels[index] ?? 'hidden'),
        },
      };
    });
  };

  return (
    <div className={`test-panel panel-status-${phase}`}>
      <div className="test-panel-header">
        <span className="run-status">{STATUS_LABELS[phase]}</span>
        {hasResult && result && summary && <span className="run-meta">{result.durationMs}ms</span>}
      </div>

      {phase === 'idle' && <p className="panel-hint">Press Run to execute the tests in the sandbox.</p>}
      {phase === 'running' && <p className="panel-hint">Compiling and running in the sandbox…</p>}

      {failedRun && result?.error && <pre className="error-block">{result.error}</pre>}

      {hasResult && result && summary && result.tests.length > 0 && (
        <div className="run-results-summary">
          <div className="run-counts" aria-label={`${summary.passed} passed, ${summary.failed} failed`}>
            <span className="run-count run-count-passed">
              <strong>{summary.passed}</strong> Passed
            </span>
            <span className="run-count run-count-failed">
              <strong>{summary.failed}</strong> Failed
            </span>
          </div>
          <div className="run-summary-actions">
            {summary.skipped > 0 && <span className="run-meta">{summary.skipped} skipped</span>}
            <button
              type="button"
              className="test-cases-toggle"
              aria-expanded={casesOpen}
              onClick={toggleCases}
            >
              {casesOpen ? 'Hide test cases' : `Show test cases (${result.tests.length})`}
            </button>
          </div>
        </div>
      )}

      {hasResult && result && result.tests.length === 0 && !failedRun && (
        <p className="panel-hint">No test cases were reported.</p>
      )}

      {hasResult && result && result.tests.length > 0 && casesOpen && (
        <ul className="test-list">
          {result.tests.map((test, index) => {
            const errorLevel = detailsAreCurrent ? (details.errorLevels[index] ?? 'hidden') : 'hidden';
            return (
              <li key={index} className={`test test-${test.status}`}>
                <div className="test-case-row">
                  <span className="test-icon" aria-hidden="true">
                    {TEST_ICONS[test.status] ?? '·'}
                  </span>
                  <span className="test-name">{test.name}</span>
                  {test.error && (
                    <button
                      type="button"
                      className="test-error-toggle"
                      aria-expanded={errorLevel !== 'hidden'}
                      onClick={() => toggleError(index)}
                    >
                      {errorLevel === 'hidden' ? 'Show log' : errorLevel === 'preview' ? 'Expand log' : 'Hide log'}
                    </button>
                  )}
                </div>
                {test.error && errorLevel !== 'hidden' && (
                  <pre className={`test-error test-error-${errorLevel}`}>
                    {errorLevel === 'preview' ? errorPreview(test.error) : test.error}
                  </pre>
                )}
              </li>
            );
          })}
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
