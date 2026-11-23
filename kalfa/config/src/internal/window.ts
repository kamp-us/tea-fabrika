/**
 * The quiet window of a group with a live setting: how long a configuration file must stay unchanged before the running program reads it again. It is a restart setting the package adds to such a group, so a flag, a variable and both files set it by the usual precedence.
 */
import { Schema } from "effect";
import * as Setting from "../Declaration.ts";

/** A length of time as Effect's `Duration.fromInput` reads text: a number, spaces and a unit, or Infinity. W1 holds the two together. The `u` flag is what gives the pattern a JSON Schema form. */
const Pattern = /^(?:-?Infinity|-?\d+(?:\.\d+)?\s+(?:nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?))$/u;

const Length = Schema.String.check(Schema.isPattern(Pattern)).annotate({
  title: "a length of time",
  description: "Write it as text, as 100 millis or 2 seconds.",
});

/** The setting itself. A length of time is text, as decision 0089 says, and is decoded to a `Duration` where the follower builds its window. */
export const debounce = Setting.make("config.watch.debounce", Length).pipe(
  Setting.withDefault("100 millis"),
  Setting.withDescription(
    "How long a configuration file must stay unchanged before a running program reads it again, as 100 millis.",
  ),
);

/** The settings a group is read with: its own, and the quiet window when one of them is live. */
export const watched = (settings: ReadonlyArray<Setting.Any>): ReadonlyArray<Setting.Any> =>
  settings.some((setting) => setting.live) ? [...settings, debounce] : settings;

/** The settings a group of `R` is read with: its own, and the quiet window when one of them is live. A group whose names are not literal types is taken as it is. */
export type Watched<R extends ReadonlyArray<Setting.Any>> = string extends R[number]["name"]
  ? R
  : true extends R[number]["live"]
    ? readonly [...R, typeof debounce]
    : R;
