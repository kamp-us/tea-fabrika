// Laws in this folder set a variable of this process for code that reads `process.env` itself:
// Alchemy (`ALCHEMY_HOME`, `DO_NOT_TRACK`), the local instance and what it starts (`FABRIKA_HOME`),
// and a Worker module Alchemy loads (`T502_PORT`). Effect's Config reads a variable and cannot write
// one, so this file is the one place those laws write it, each write under one reasoned line. What a
// law changes is read first through Config, so it can be put back as it was.
import { Config, ConfigProvider, Effect, Option } from "effect";

/** One variable as it is now: its text, or `undefined` when unset. An empty one stays empty. */
const current = (key: string) =>
  Config.String(key)
    .pipe(Config.option, Config.map(Option.getOrUndefined))
    .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))
    // A text read that may be unset fails only on a broken provider, which is a bug.
    .pipe(Effect.orDie);

/** Sets one variable, or unsets it when `value` is `undefined`. */
const write = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    // @effect-diagnostics-next-line processEnv:off -- puts an unset variable back as unset, and Config cannot write a variable
    delete process.env[key];
  } else {
    // @effect-diagnostics-next-line processEnv:off -- the code under test reads this variable from process.env itself, and Config cannot write a variable
    process.env[key] = value;
  }
};

/**
 * Saves each variable in `values` and in `kept`, then sets each in `values`. The answer is the
 * function that puts every saved one back, deleting one that was unset. A key in `kept` is one the
 * code under test sets, such as `ALCHEMY_HOME`, which `localInstance` writes.
 */
export const changeEnv = (values: Readonly<Record<string, string>>, kept: ReadonlyArray<string> = []) =>
  Effect.gen(function* () {
    const saved = yield* Effect.forEach(
      [...Object.keys(values), ...kept],
      (key) => current(key).pipe(Effect.map((value) => [key, value] as const)),
      { concurrency: 1 },
    );

    yield* Effect.sync(() => {
      for (const [key, value] of Object.entries(values)) {
        write(key, value);
      }
    });

    return (): void => {
      for (const [key, value] of saved) {
        write(key, value);
      }
    };
  });

/** `changeEnv` for the scope: its release puts every saved variable back. */
export const scopedEnv = (values: Readonly<Record<string, string>>, kept: ReadonlyArray<string> = []) =>
  Effect.acquireRelease(changeEnv(values, kept), (restore) => Effect.sync(restore));

/** For the scope, changes nothing now, and its release puts each of `keys` back as it was. */
export const keptEnv = (keys: ReadonlyArray<string>) => scopedEnv({}, keys);

/**
 * Turns Alchemy's telemetry off for the rest of this process. It is never put back, as
 * `localInstance` never puts its own write back, so nothing Alchemy runs later in the file sends.
 * Call it before Alchemy is imported.
 */
export const noTracking = (): void => {
  // @effect-diagnostics-next-line processEnv:off -- Alchemy reads DO_NOT_TRACK from process.env itself, and Config cannot write a variable
  process.env.DO_NOT_TRACK = "1";
};
