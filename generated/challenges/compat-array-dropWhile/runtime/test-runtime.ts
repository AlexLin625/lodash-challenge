// Minimal Jest-compatible subset runtime ("jest-subset-v1").
//
// This file is emitted into every challenge bundle at runtime/test-runtime.ts and
// is also loaded by the generator's node-side validator. It is intentionally
// self-contained (no imports) so it can run both in Node and in a browser sandbox.
//
// The public surface mirrors the subset documented in docs/design-v1.md §8.3:
// describe / it / test, expect + common matchers, beforeEach / afterEach,
// beforeAll / afterAll, and a basic `fn` mock.
//
// `__runTests` is a generator-only extension used to drive execution and collect
// results; it is not part of the public user-facing API.

export interface TestCaseResult {
  suite: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  error?: string;
}

type MaybePromise<T> = T | Promise<T>;

interface TestCase {
  name: string;
  fn: () => MaybePromise<void>;
  skipped: boolean;
}

interface Suite {
  name: string;
  before: Array<() => MaybePromise<void>>;
  after: Array<() => MaybePromise<void>>;
  beforeAllHooks: Array<() => MaybePromise<void>>;
  afterAllHooks: Array<() => MaybePromise<void>>;
  tests: TestCase[];
}

const suites: Suite[] = [];
const suiteStack: Suite[] = [];
const rootSuite: Suite = {
  name: '',
  before: [],
  after: [],
  beforeAllHooks: [],
  afterAllHooks: [],
  tests: [],
};
suiteStack.push(rootSuite);

function currentSuite(): Suite {
  return suiteStack[suiteStack.length - 1];
}

export function describe(name: string, fn: () => void): void {
  const suite: Suite = { name, before: [], after: [], beforeAllHooks: [], afterAllHooks: [], tests: [] };
  suites.push(suite);
  suiteStack.push(suite);
  fn();
  suiteStack.pop();
}

function registerTest(name: string, fn: () => MaybePromise<void>, skipped = false): void {
  currentSuite().tests.push({ name, fn, skipped });
}

export function it(name: string, fn: () => MaybePromise<void>): void {
  registerTest(name, fn);
}

export function test(name: string, fn: () => MaybePromise<void>): void {
  registerTest(name, fn);
}

export function xit(name: string, fn: () => MaybePromise<void>): void {
  registerTest(name, fn, true);
}

export function beforeEach(fn: () => MaybePromise<void>): void {
  currentSuite().before.push(fn);
}

export function afterEach(fn: () => MaybePromise<void>): void {
  currentSuite().after.push(fn);
}

export function beforeAll(fn: () => MaybePromise<void>): void {
  currentSuite().beforeAllHooks.push(fn);
}

export function afterAll(fn: () => MaybePromise<void>): void {
  currentSuite().afterAllHooks.push(fn);
}

export function fn<T extends (...args: never[]) => unknown = () => void>(impl?: T): T & { mock: { calls: unknown[][] } } {
  const mock: { calls: unknown[][] } = { calls: [] };
  const mockFn = ((...args: never[]) => {
    mock.calls.push(args);
    if (impl) {
      return impl(...args);
    }
    return undefined;
  }) as T & { mock: { calls: unknown[][] } };
  mockFn.mock = mock;
  return mockFn;
}

export function expect(actual: unknown): Expectation {
  return new Expectation(actual);
}

export class Expectation {
  private readonly actual: unknown;
  private readonly negated: boolean;

  constructor(actual: unknown, negated = false) {
    this.actual = actual;
    this.negated = negated;
  }

  private fail(message: string): never {
    throw new Error(`expect(...).${message}`);
  }

  /** Asserts that `passed` is true; when negated, asserts that it is false. */
  private check(passed: boolean, message: string): void {
    if (passed === this.negated) {
      this.fail(message);
    }
  }

  get not(): Expectation {
    return new Expectation(this.actual, !this.negated);
  }

  toBe(expected: unknown): void {
    this.check(this.actual === expected, `toBe: expected ${stringify(expected)}, received ${stringify(this.actual)}`);
  }

  toEqual(expected: unknown): void {
    this.check(deepEqual(this.actual, expected), `toEqual: expected ${stringify(expected)}, received ${stringify(this.actual)}`);
  }

  toStrictEqual(expected: unknown): void {
    this.toEqual(expected);
  }

  toBeUndefined(): void {
    this.check(this.actual === undefined, `toBeUndefined: received ${stringify(this.actual)}`);
  }

  toBeDefined(): void {
    this.check(this.actual !== undefined, 'toBeDefined: received undefined');
  }

  toBeNull(): void {
    this.check(this.actual === null, `toBeNull: received ${stringify(this.actual)}`);
  }

  toBeTruthy(): void {
    this.check(Boolean(this.actual), `toBeTruthy: received ${stringify(this.actual)}`);
  }

  toBeFalsy(): void {
    this.check(!this.actual, `toBeFalsy: received ${stringify(this.actual)}`);
  }

  toBeNaN(): void {
    this.check(
      typeof this.actual === 'number' && Number.isNaN(this.actual),
      `toBeNaN: received ${stringify(this.actual)}`
    );
  }

  toBeGreaterThan(expected: number): void {
    this.check(
      typeof this.actual === 'number' && this.actual > expected,
      `toBeGreaterThan(${expected}): received ${stringify(this.actual)}`
    );
  }

  toBeLessThan(expected: number): void {
    this.check(
      typeof this.actual === 'number' && this.actual < expected,
      `toBeLessThan(${expected}): received ${stringify(this.actual)}`
    );
  }

  toBeCloseTo(expected: number, precision = 2): void {
    const delta = Math.abs((this.actual as number) - expected);
    this.check(
      delta < 10 ** -precision / 2,
      `toBeCloseTo(${expected}, ${precision}): received ${stringify(this.actual)}`
    );
  }

  toContain(item: unknown): void {
    const actual = this.actual as ArrayLike<unknown> | string;
    const arrayLike =
      !!actual && (typeof actual === 'object' || typeof actual === 'string') && typeof actual.length === 'number';
    const found =
      arrayLike && (typeof actual === 'string' ? actual.includes(item as string) : Array.from(actual).includes(item));
    this.check(Boolean(found), `toContain(${stringify(item)}): received ${stringify(this.actual)}`);
  }

  toHaveLength(length: number): void {
    const actual = this.actual as { length?: number } | undefined;
    this.check(!!actual && actual.length === length, `toHaveLength(${length}): received ${stringify(this.actual)}`);
  }

  toBeInstanceOf(klass: unknown): void {
    this.check(
      this.actual instanceof (klass as new (...args: never[]) => unknown),
      `toBeInstanceOf: received ${stringify(this.actual)}`
    );
  }

  toHaveProperty(path: string, value?: unknown): void {
    let current: unknown = this.actual;
    let present = true;
    for (const key of path.split('.')) {
      if (current === null || current === undefined || !(key in Object(current))) {
        present = false;
        break;
      }
      current = (current as Record<string, unknown>)[key];
    }
    const withValue = arguments.length >= 2;
    this.check(
      present && (!withValue || current === value),
      `toHaveProperty(${path}${withValue ? `, ${stringify(value)}` : ''}): received ${stringify(this.actual)}`
    );
  }

  toThrow(expected?: RegExp | string | Error): void {
    let threw = false;
    let thrown: unknown;
    try {
      const fn = this.actual as () => unknown;
      const result = fn();
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        this.fail('toThrow: received a promise; use expect(...).rejects instead');
      }
    } catch (err) {
      threw = true;
      thrown = err;
    }
    let matches = false;
    if (threw) {
      matches = true;
      if (expected !== undefined) {
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        if (expected instanceof Error) {
          matches = thrown === expected;
        } else if (expected instanceof RegExp) {
          matches = expected.test(message);
        } else {
          matches = message.includes(String(expected));
        }
      }
    }
    this.check(
      threw && matches,
      `toThrow(${expected !== undefined ? stringify(expected) : ''}): expected function to${this.negated ? ' not' : ''} throw`
    );
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'function') {
    return '[Function]';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function deepEqual(a: unknown, b: unknown, seen: WeakMap<object, WeakSet<object>> = new WeakMap()): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) {
    return true;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  if (a instanceof RegExp && b instanceof RegExp) {
    return a.source === b.source && a.flags === b.flags;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (seen.has(a) && seen.get(a)!.has(b)) {
    return true;
  }
  const aSeen = seen.get(a) ?? new WeakSet<object>();
  aSeen.add(b);
  seen.set(a, aSeen);

  const keysA = Reflect.ownKeys(a);
  const keysB = Reflect.ownKeys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) {
      return false;
    }
    for (const [key, value] of a) {
      if (!b.has(key) || !deepEqual(value, b.get(key), seen)) {
        return false;
      }
    }
    return true;
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) {
      return false;
    }
    for (const value of a) {
      if (!b.has(value)) {
        return false;
      }
    }
    return true;
  }
  for (const key of keysA) {
    if (!(key in b)) {
      return false;
    }
    const av = (a as Record<PropertyKey, unknown>)[key];
    const bv = (b as Record<PropertyKey, unknown>)[key];
    if (!deepEqual(av, bv, seen)) {
      return false;
    }
  }
  return true;
}

export async function __runTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  for (const suite of suites) {
    const beforeAllErrors: string[] = [];
    for (const hook of suite.beforeAllHooks) {
      try {
        await hook();
      } catch (err) {
        beforeAllErrors.push(String(err instanceof Error ? err.stack ?? err.message : err));
      }
    }
    for (const tc of suite.tests) {
      if (tc.skipped) {
        results.push({ suite: suite.name, name: tc.name, status: 'skipped' });
        continue;
      }
      const fullName = suite.name ? `${suite.name} > ${tc.name}` : tc.name;
      if (beforeAllErrors.length > 0) {
        results.push({ suite: suite.name, name: fullName, status: 'failed', error: beforeAllErrors.join('\n') });
        continue;
      }
      try {
        for (const hook of suite.before) {
          await hook();
        }
        await tc.fn();
        for (const hook of suite.after) {
          await hook();
        }
        results.push({ suite: suite.name, name: fullName, status: 'passed' });
      } catch (err) {
        const error = err instanceof Error ? err.stack ?? err.message : String(err);
        results.push({ suite: suite.name, name: fullName, status: 'failed', error });
        for (const hook of suite.after) {
          try {
            await hook();
          } catch {
            // ignore cleanup errors on failure
          }
        }
      }
    }
    for (const hook of suite.afterAllHooks) {
      try {
        await hook();
      } catch {
        // ignore
      }
    }
  }
  return results;
}
