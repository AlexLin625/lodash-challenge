import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizePersistenceError,
  PersistenceError,
  storageUnavailableError,
} from './errors.ts';

test('constructs a PersistenceError with its code and name', () => {
  const error = new PersistenceError('validation', 'Invalid record');

  assert.equal(error.code, 'validation');
  assert.equal(error.name, 'PersistenceError');
  assert.equal(error.message, 'Invalid record');
  assert.ok(error instanceof Error);
});

test('creates a friendly storage-unavailable error', () => {
  const error = storageUnavailableError();

  assert.equal(error.code, 'storage-unavailable');
  assert.match(error.message, /IndexedDB unavailable/);
});

test('returns an existing PersistenceError unchanged', () => {
  const error = new PersistenceError('validation', 'Invalid record');

  assert.equal(normalizePersistenceError(error), error);
});

test('maps storage-related DOM error names to storage-unavailable', () => {
  for (const name of ['InvalidAccessError', 'SecurityError', 'QuotaExceededError', 'NotSupportedError']) {
    const error = new Error('storage failure');
    error.name = name;

    const normalized = normalizePersistenceError(error);
    assert.equal(normalized.code, 'storage-unavailable');
  }
});

test('maps ordinary Errors and DOMExceptions to db-error with their names', () => {
  const error = new Error('connection failed');
  error.name = 'NetworkError';
  const normalizedError = normalizePersistenceError(error);
  assert.equal(normalizedError.code, 'db-error');
  assert.match(normalizedError.message, /NetworkError/);

  const normalizedDomException = normalizePersistenceError(new DOMException('transaction failed', 'AbortError'));
  assert.equal(normalizedDomException.code, 'db-error');
  assert.match(normalizedDomException.message, /AbortError/);
});

test('maps unknown thrown values to db-error and UnknownError', () => {
  const normalized = normalizePersistenceError({ reason: 'failure' });

  assert.equal(normalized.code, 'db-error');
  assert.equal(normalized.message, 'UnknownError');
});
