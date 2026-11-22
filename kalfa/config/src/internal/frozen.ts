import * as Rec from "effect/Record";

/** Whether a value is plain data: an object made by `{}` or with no prototype. */
const plain = (value: object) => {
  const prototype = Reflect.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
};

/**
 * A copy of a value with every plain object and array in it frozen, all the way down.
 *
 * **Details**
 *
 * It is a copy, so the object a caller declared a default with is never frozen or handed out. Anything that is not a plain object or an array is kept as it is.
 */
export const frozen = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(frozen));
  }

  if (typeof value === "object" && value !== null && plain(value)) {
    return Object.freeze(Rec.map(value, frozen));
  }

  return value;
};
