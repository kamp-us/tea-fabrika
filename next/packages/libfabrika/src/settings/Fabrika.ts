/**
 * Fabrika's settings app, and the one place its name is written: `fabrika`, listed by `fabrika settings`.
 *
 * **Details**
 *
 * The module is the engine's `Setting.ts` and `Sources.ts` with `make`, `group` and `env` bound to fabrika, so code that declares or reads fabrika's settings imports it under either name, as `import * as Setting from "./Fabrika.ts"`, and keeps writing `Setting.make(path, options)` and `Sources.env(record)`.
 */
import * as App from "./App.ts";

export * from "./Setting.ts";

export * from "./Sources.ts";

/**
 * Fabrika's app: prefix `FABRIKA`, home variable `FABRIKA_HOME`, files `.fabrika/fabrika.toml` and `~/.fabrika/fabrika.toml`, and version setting `fabrika-version`.
 *
 * @category settings
 */
export const Fabrika = App.make({ name: "fabrika", list: "fabrika settings" });

/**
 * Declares one of fabrika's settings: `Setting.make` with fabrika as its app.
 *
 * @category constructors
 */
export const make = Fabrika.Setting.make;

/**
 * Joins fabrika's settings into one group: `Setting.group` with fabrika as its app.
 *
 * @category constructors
 */
export const group = Fabrika.Setting.group;

/**
 * Reads fabrika's variables, as `FABRIKA_INSTANCE_PORT`: `Sources.env` with fabrika as its app.
 *
 * @category constructors
 */
export const env = Fabrika.Sources.env;
