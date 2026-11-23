import * as Str from "effect/String";

/** The words of a dotted name: `delivery.carry-rule` is `["delivery", "carry-rule"]`. */
export const segments = (name: string): ReadonlyArray<string> => Str.split(name, ".");

/** The field a value has: the last word of the name, hyphens joined, so `delivery.carry-rule` is `carryRule`. */
export const field = (name: string): string =>
  (segments(name).at(-1) ?? name).replace(/-([a-z0-9])/gu, (_, letter: string) => letter.toUpperCase());

/** The environment variable that sets a setting: the app and the name in capitals, as `DEMO_INSTANCE_PORT`. */
export const variable = (app: string, name: string): string =>
  [app.toUpperCase(), ...segments(name).map(Str.configCase)].join("_");
