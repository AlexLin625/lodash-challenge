export type ConformsPredicateObject<T> = {
  [P in keyof T]: T[P] extends (arg: infer A) => any ? A : any;
};

/**
 * Checks if `object` conforms to `source` by invoking the predicate properties of `source` with the corresponding property values of `object`.
 *
 * Note: This method is equivalent to `conforms` when source is partially applied.
 *
 * @template T - The type of the target object.
 * @param target The object to inspect.
 * @param source The object of property predicates to conform to.
 * @returns Returns `true` if `object` conforms, else `false`.
 *
 * @example
 *
 * const object = { 'a': 1, 'b': 2 };
 * const source = {
 *   'a': (n) => n > 0,
 *   'b': (n) => n > 1
 * };
 *
 * console.log(conformsTo(object, source)); // => true
 *
 * const source2 = {
 *   'a': (n) => n > 1,
 *   'b': (n) => n > 1
 * };
 *
 * console.log(conformsTo(object, source2)); // => false
 */
export function conformsTo<T>(target: T, source: ConformsPredicateObject<T>): boolean {
  void target;
  void source;
  return undefined as unknown as boolean;
}
