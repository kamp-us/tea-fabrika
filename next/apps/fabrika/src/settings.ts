import { SettingsStart } from "@kampus/libfabrika";
import { Schema } from "effect";

export const Settings = SettingsStart.Input;
export type Settings = typeof Settings.Type;

export const Founding = Schema.Struct({
  name: Settings.fields.name,
  ...Settings.fields.founding.fields,
  build: Settings.fields.build,
  limits: Settings.fields.limits,
  mail: Settings.fields.mail,
});

export type Options = Omit<Settings, "start" | "build"> & { readonly start?: string; readonly home: string };

/** `a`, `a and b`, `a, b and c`. */
const list = (names: ReadonlyArray<string>) =>
  names.length < 2 ? (names[0] ?? "no program") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/**
 * Null when `value` names a program of `table` a tile may show; else the words the start stops
 * with. A tile shows any program of the build but `fabrika/tezgah`, the frame itself. `origin` is
 * where the value came from, as `fabrika settings` prints it.
 */
export const refuseNew = (
  value: string,
  origin: string,
  table: ReadonlyArray<{ readonly name: string }>,
): string | null => {
  const shown = table.map((p) => p.name).filter((name) => name !== "fabrika/tezgah");
  return shown.includes(value)
    ? null
    : `pack.fabrika.settings.tezgah.new is ${value} (from ${origin}), but a tile cannot show it. ` +
        `A tile can show ${list(shown.toSorted())}.`;
};
