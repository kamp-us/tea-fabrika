// What this package's own laws share: how a failure is checked. The suite and the settings a runner needs are in
// RepositoryTest.ts, which is `/test`.
import { expect } from "@effect/vitest";

/** `error` is an instance of the failure class `kind` and holds `fields`: never its text, only what it says. */
export const expectFailure = <E>(
  error: E,
  kind: abstract new (...args: never[]) => object,
  fields: object,
  message: string,
): void => {
  expect(error, message).toBeInstanceOf(kind);
  expect(error, message).toMatchObject(fields);
};
