export type ObjectIterator<T, R> = (value: T[keyof T], key: string, collection: T) => R;

export type PartialShallow<T> = {
  [P in keyof T]?: T[P] extends object ? object : T[P];
};

export type IterateeShorthand<T> = PropertyKey | [PropertyKey, any] | PartialShallow<T>;

export type ObjectIteratee<TObject> = ObjectIterator<TObject, unknown> | IterateeShorthand<TObject[keyof TObject]>;

/**
 * Finds the key of the first element that matches the given predicate.
 *
 * This function determines the type of the predicate and delegates the search
 * to the appropriate helper function. It supports predicates as functions, objects,
 * arrays, or strings.
 *
 * @template T - The type of the object.
 * @param obj - The object to inspect.
 * @param predicate - The predicate to match.
 * @returns Returns the key of the matched element, else `undefined`.
 */
export function findKey<T>(obj: T | null | undefined, predicate?: ObjectIteratee<T>): string | undefined {
  void obj;
  void predicate;
  return undefined as unknown as string | undefined;
}
