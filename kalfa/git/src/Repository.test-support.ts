// What this package's own laws share: how a failure is checked and the settings a law seeds a store with. The suite and the
// runner's types are in RepositoryTest.ts, which is `/test`; it exports `settings` from here too.
import { expect } from "@effect/vitest";
import { Schema } from "effect";
import type { Committer } from "./History.test-support.ts";
import * as Settings from "./Settings.ts";

/** The committer the written commits name, unless a law draws its own. */
export const COMMITTER: Committer = { name: "Bot", email: "bot@example.test" };

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

/** Settings with generous limits, the ones a law wants to push set, and the committer every written commit names. */
export const settings = (
  limits: {
    readonly commits?: number;
    readonly refs?: number;
    readonly bytes?: number;
    readonly files?: number;
    readonly diff?: number;
    readonly blob?: number;
    readonly time?: string;
    readonly kill?: string;
  } = {},
  committer: Committer = COMMITTER,
): Settings.Settings =>
  Schema.decodeUnknownSync(Settings.Settings)({
    limits: {
      commits: 1000,
      refs: 1000,
      bytes: 1_000_000,
      files: 1000,
      diff: 10_000_000,
      blob: 10_000_000,
      time: "10 seconds",
      kill: "5 seconds",
      ...limits,
    },
    committer,
  });
