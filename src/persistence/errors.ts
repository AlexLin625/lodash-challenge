export type PersistenceErrorCode = 'storage-unavailable' | 'db-error' | 'validation';

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string) {
    super(message);
    this.name = 'PersistenceError';
    this.code = code;
  }
}

export function storageUnavailableError(): PersistenceError {
  return new PersistenceError(
    'storage-unavailable',
    'IndexedDB unavailable. Progress cannot be saved in this browser.'
  );
}

const STORAGE_UNAVAILABLE_NAMES = new Set([
  'InvalidAccessError',
  'SecurityError',
  'QuotaExceededError',
  'NotSupportedError',
]);

export function normalizePersistenceError(error: unknown): PersistenceError {
  if (error instanceof PersistenceError) {
    return error;
  }

  const isDomException = typeof DOMException !== 'undefined' && error instanceof DOMException;
  if (error instanceof Error || isDomException) {
    if (STORAGE_UNAVAILABLE_NAMES.has(error.name)) {
      return storageUnavailableError();
    }
    return new PersistenceError('db-error', `${error.name}: ${error.message}`);
  }

  return new PersistenceError('db-error', 'UnknownError');
}
