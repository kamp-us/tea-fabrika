import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";

/** Plain data as it is at run time: what every setting's value is. */
type Plain = string | number | boolean | ReadonlyArray<Plain> | { readonly [key: string]: Plain };

/** Whether an object was made by `{}` or has no prototype. */
const record = (value: object) => {
  const prototype = Reflect.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
};

/**
 * A deep-frozen copy of a value, or none when some part of it is not plain data.
 *
 * **Details**
 *
 * Plain data is a string, a number, a boolean, an array whose prototype is `Array.prototype`, or an object whose prototype is `Object.prototype` or null, each part checked all the way down. It is a copy, so the object a caller declared a default with is never frozen or handed out. Text, numbers and booleans come back as they are, since they are immutable already. A `Date`, a `Map`, a class instance, `null`, `undefined` and a function answer none, wherever they sit.
 */
export const frozen = (value: unknown): Option.Option<Plain> => {
  if (Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)) {
    return Option.some(value);
  }

  if (Array.isArray(value)) {
    return Reflect.getPrototypeOf(value) === Array.prototype
      ? Option.map(Option.all(value.map(frozen)), (parts) => Object.freeze(parts))
      : Option.none();
  }

  if (Predicate.isObject(value) && record(value)) {
    return Option.map(Option.all(Rec.map(value, frozen)), (parts) => Object.freeze(parts));
  }

  return Option.none();
};
