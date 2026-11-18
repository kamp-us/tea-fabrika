// The variables the app's two launchers, dev.ts and hands.ts, read the same way: the home folder's
// and each declared setting's, through Config.
import * as Declarations from "@kampus/libfabrika/settings/Declarations";
import { Array as Arr, Config, ConfigProvider, Effect, Record as Rec } from "effect";

/** The entries that hold a value, as one record. */
export const present = (entries: ReadonlyArray<readonly [string, string | undefined]>) =>
  Rec.fromEntries(Arr.filter(entries, (entry): entry is readonly [string, string] => entry[1] !== undefined));

/**
 * The home folder's variable and each declared setting's, read when the effect runs, as process.env
 * was read: an empty variable stays empty, and an unset one is `undefined`.
 */
export const environment = Effect.suspend(() =>
  Config.all({
    home: Config.String("FABRIKA_HOME").pipe(Config.withDefault(undefined)),
    settings: Config.all(
      Object.fromEntries(
        Declarations.all.declarations.map((d) => [d.env, Config.String(d.env).pipe(Config.withDefault(undefined))]),
      ),
    ),
  }).parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true })),
);
