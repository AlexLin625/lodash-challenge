// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RecursiveArray<T> extends Array<T | RecursiveArray<T>> {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ListOfRecursiveArraysOrValues<T> extends ArrayLike<T | RecursiveArray<T>> {}

/**
 * Recursively flattens array up to depth times.
 *
 * @template T
 * @param array - The array to flatten.
 * @param [depth=1] - The maximum recursion depth.
 * @returns Returns the new flattened array.
 *
 * @example
 * const array = [1, [2, [3, [4]], 5]];
 *
 * flattenDepth(array, 1);
 * // => [1, 2, [3, [4]], 5]
 *
 * flattenDepth(array, 2);
 * // => [1, 2, 3, [4], 5]
 */
export function flattenDepth<T>(array: ListOfRecursiveArraysOrValues<T> | null | undefined, depth = 1): T[] {
  void array;
  void depth;
  return undefined as unknown as T[];
}
