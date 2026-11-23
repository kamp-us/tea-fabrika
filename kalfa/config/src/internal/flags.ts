/**
 * One `effect/cli` flag per setting a flag may set, and the types of the flags and of what a command's handler gets for them.
 */
import * as Command from "effect/cli/Command";
import * as CommandSpec from "effect/cli/CommandSpec";
import * as Flag from "effect/cli/Flag";
import * as Option from "effect/Option";
import type * as Setting from "../Declaration.ts";

/** One optional text flag: none when the person did not give it. */
type Text = Flag.Flag<Option.Option<string>>;

/** One flag per setting a flag may set, by setting name. A file-only setting has none, so each named key is optional. Names that are only `string` make a plain record. */
export type Flags<R extends ReadonlyArray<Setting.Any>> = string extends R[number]["name"]
  ? Readonly<Record<string, Text>>
  : { readonly [S in R[number] as S["name"]]?: Text };

/** What a command's handler gets for those flags: each flag's text, or none when the person did not give it. */
export type FlagValues<R extends ReadonlyArray<Setting.Any>> = string extends R[number]["name"]
  ? Readonly<Record<string, Option.Option<string>>>
  : { readonly [S in R[number] as S["name"]]?: Option.Option<string> };

// The names and aliases Effect's runner reads before a command's own flags, from its default built-ins.
const kept: ReadonlySet<string> = new Set(
  Option.getOrThrow(CommandSpec.resolve(Command.make("x"), ["x"])).flags.flatMap((flag) =>
    flag.scope._tag === "Global" ? [flag.name, ...flag.aliases] : [],
  ),
);

/**
 * Makes one flag for each setting that is not file-only, named as the setting is, with its description as help text.
 *
 * Throws an `Error` when a setting's flag would be one Effect's command line keeps for itself, as `help`.
 */
export const make = (settings: ReadonlyArray<Setting.Any>): Readonly<Record<string, Text>> =>
  Object.fromEntries(
    settings
      .filter((s) => !s.fileOnly)
      .map((s) => {
        if (kept.has(s.name)) {
          throw new Error(`Settings cannot be declared: ${s.name} is a flag Effect's command line keeps for itself.`);
        }

        // `SettingGroup.make` refuses a setting with no description, so a group's settings always have one.
        if (s.description === undefined) {
          throw new Error(`Settings cannot be declared: ${s.name} has no description.`);
        }

        return [s.name, Flag.String(s.name).pipe(Flag.withDescription(s.description), Flag.optional)];
      }),
  );
