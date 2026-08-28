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

  constructor(actual: unknown) {
    this.actual = actual;
  }

  private fail(message: string): never {
    throw new Error(`expect(...).${message}`);
  }

  get not(): Expectation {
    return this;
  }

  toBe(expected: unknown): void {
    if (this.actual !== expected) {
      this.fail(`toBe: expected ${stringify(expected)}, received ${stringify(this.actual)}`);
    }
  }

  toEqual(expected: unknown): void {
    if (!deepEqual(this.actual, expected)) {
      this.fail(`toEqual: expected ${stringify(expected)}, received ${stringify(this.actual)}`);
    }
  }

  toStrictEqual(expected: unknown): void {
    this.toEqual(expected);
  }

  toBeUndefined(): void {
    if (this.actual !== undefined) {
      this.fail(`toBeUndefined: received ${stringify(this.actual)}`);
    }
  }

  toBeDefined(): void {
    if (this.actual === undefined) {
      this.fail('toBeDefined: received undefined');
    }
  }

  toBeNull(): void {
    if (this.actual !== null) {
      this.fail(`toBeNull: received ${stringify(this.actual)}`);
    }
  }

  toBeTruthy(): void {
    if (!this.actual) {
      this.fail(`toBeTruthy: received ${stringify(this.actual)}`);
    }
  }

  toBeFalsy(): void {
    if (this.actual) {
      this.fail(`toBeFalsy: received ${stringify(this.actual)}`);
    }
  }

  toBeNaN(): void {
    if (!(typeof this.actual === 'number' && Number.isNaN(this.actual))) {
      this.fail(`toBeNaN: received ${stringify(this.actual)}`);
    }
  }

  toBeGreaterThan(expected: number): void {
    if (!(typeof this.actual === 'number' && this.actual > expected)) {
      this.fail(`toBeGreaterThan(${expected}): received ${stringify(this.actual)}`);
    }
  }

  toBeLessThan(expected: number): void {
    if (!(typeof this.actual === 'number' && this.actual < expected)) {
      this.fail(`toBeLessThan(${expected}): received ${stringify(this.actual)}`);
    }
  }

  toBeCloseTo(expected: number, precision = 2): void {
    const delta = Math.abs(this.actual as number - expected);
    if (delta >= 10 ** -precision / 2) {
      this.fail(`toBeCloseTo(${expected}, ${precision}): received ${stringify(this.actual)}`);
    }
  }

  toContain(item: unknown): void {
    const actual = this.actual as ArrayLike<unknown> | string;
    if (!actual || typeof actual !== 'object' && typeof actual !== 'string') {
      this.fail(`toContain: received ${stringify(this.actual)}`);
    }
    const found = typeof actual === 'string' ? actual.includes(item as string) : Array.from(actual).includes(item);
    if (!found) {
      this.fail(`toContain(${stringify(item)}): received ${stringify(this.actual)}`);
    }
  }

  toHaveLength(length: number): void {
    const actual = this.actual as { length?: number } | undefined;
    if (!actual || actual.length !== length) {
      this.fail(`toHaveLength(${length}): received ${stringify(this.actual)}`);
    }
  }

  toBeInstanceOf(klass: unknown): void {
    if (!(this.actual instanceof (klass as new (...args: never[]) => unknown))) {
      this.fail(`toBeInstanceOf: received ${stringify(this.actual)}`);
    }
  }

  toHaveProperty(path: string, value?: unknown): void {
    let current: unknown = this.actual;
    for (const key of path.split('.')) {
      if (current === null || current === undefined || !(key in Object(current))) {
        this.fail(`toHaveProperty(${path}): received ${stringify(this.actual)}`);
      }
      current = (current as Record<string, unknown>)[key];
    }
    if (arguments.length >= 2 && current !== value) {
      this.fail(`toHaveProperty(${path}, ${stringify(value)}): received ${stringify(current)}`);
    }
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
    if (!threw) {
      this.fail('toThrow: function did not throw');
    }
    if (expected !== undefined) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      if (expected instanceof Error) {
        if (thrown !== expected) {
          this.fail(`toThrow: threw ${stringify(thrown)}`);
        }
      } else if (expected instanceof RegExp) {
        if (!expected.test(message)) {
          this.fail(`toThrow: message "${message}" does not match ${String(expected)}`);
        }
      } else if (!message.includes(String(expected))) {
        this.fail(`toThrow: message "${message}" does not contain ${JSON.stringify(String(expected))}`);
      }
    }
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
