import * as Str from "effect/String";
import type * as Setting from "../Declaration.ts";
import { debounce } from "./window.ts";

const App = /^[a-z][a-z0-9]*$/u;

/** Why an app's name is refused, or undefined when it is one lowercase word. */
export const refusedApp = (app: string) =>
  App.test(app) ? undefined : `${JSON.stringify(app)} is not an app name: it must be one lowercase word, as demo`;

/** The words of a dotted name: `delivery.carry-rule` is `["delivery", "carry-rule"]`. */
export const segments = (name: string): ReadonlyArray<string> => Str.split(name, ".");

/** The field a value has: the last word of the name, hyphens joined, so `delivery.carry-rule` is `carryRule`. */
export const field = (name: string): string =>
  (segments(name).at(-1) ?? name).replace(/-([a-z0-9])/gu, (_, letter: string) => letter.toUpperCase());

/** The environment variable that sets a setting: the app and the name in capitals, as `DEMO_INSTANCE_PORT`. */
export const variable = (app: string, name: string): string =>
  [app.toUpperCase(), ...segments(name).map(Str.configCase)].join("_");

/**
 * Why two settings cannot be read together, or undefined: they are one name or a value and its table, or they share a variable. A group also refuses two that are read as one field; a command over many groups does not, since each group yields its own fields (`fields` is false there).
 */
export const clashes = (app: string, a: Setting.Any, b: Setting.Any, fields = true) => {
  const [short, long] = a.name.length <= b.name.length ? [a.name, b.name] : [b.name, a.name];

  if (short === long || long.startsWith(`${short}.`)) {
    return "are one name, or a value and its table";
  }

  // The window is read by its setting name and never as a field of the program's values, so only the program's own fields can clash.
  if (fields && a !== debounce && b !== debounce && field(a.name) === field(b.name)) {
    return `are read as one field, ${field(a.name)}`;
  }

  return variable(app, a.name) === variable(app, b.name) ? `share ${variable(app, a.name)}` : undefined;
};
