import { identity } from '../../function/identity.ts';

export type PartialShallow<T> = {
  [P in keyof T]?: T[P] extends object ? object : T[P];
};

export type ListIteratee<T> =
  | ((value: T, index: number, collection: ArrayLike<T>) => unknown)
  | (PropertyKey | [PropertyKey, any] | PartialShallow<T>);

/**
 * Creates a slice of array excluding elements dropped from the beginning.
 * Elements are dropped until predicate returns falsey.
 * The predicate is invoked with three arguments: (value, index, array).
 *
 * @template T - The type of elements in the array
 * @param array - The array to query
 * @param [predicate=identity] - The function invoked per iteration
 * @returns Returns the slice of array
 *
 * @example
 * dropWhile([1, 2, 3], n => n < 3)
 * // => [3]
 *
 * dropWhile([{ a: 1, b: 2 }, { a: 1, b: 3 }], { a: 1 })
 * // => []
 *
 * dropWhile([{ a: 1, b: 2 }, { a: 1, b: 3 }], ['a', 1])
 * // => []
 *
 * dropWhile([{ a: 1, b: 2 }, { a: 1, b: 3 }], 'a')
 * // => []
 */
export function dropWhile<T>(array: ArrayLike<T> | null | undefined, predicate: ListIteratee<T> = identity): T[] {
  void array;
  void predicate;
  return undefined as unknown as T[];
}
