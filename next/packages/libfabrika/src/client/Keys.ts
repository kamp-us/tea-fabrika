/**
 * A window's key table and its router (0278, 0272). A program declares its commands as rows,
 * `{does, keys, word, label}`, each a `Binding` of the app layer, beside `Program`, which a caller
 * imports from there; a window is handed the rows as a value, ships them to its backend
 * and loads them into one `Table`. The router then reads one press against the table and the
 * window's prefix, in 0272's order: the platform's own keys first, then the prefix, then the
 * focused tile's content. No program has a mode yet, so steps 3 to 5 are not here.
 *
 * Keys are spelled the keybindings note's way: modifiers first, in the order `ctrl`, `alt`,
 * `meta`, `shift`, then the key, as `ctrl+b`; a printable key is its own character, as `%` or `Y`,
 * so Shift is already in it; a named key is lower case, as `escape`, `enter`, `space` or `f6`. A
 * row writes `mod` for the backend's command key (Cmd on a Mac, Ctrl elsewhere) and `<prefix>` for
 * a key pressed after the prefix.
 */
import { Result, Schema } from "effect";
import type { Binding } from "../runtime/Program.ts";
import type { Hello } from "../transport/Wire.ts";
import type { Prefix } from "./Prefix.ts";

/**
 * The backend a window runs on, from the hello's own words: its command key, and the keys it can
 * never have, spelled as a press is.
 *
 * @category models
 */
export type Backend = {
  readonly platform: (typeof Hello.Type)["platform"];
  readonly os: (typeof Hello.Type)["os"];
  readonly mod: "ctrl" | "meta";
  readonly cannot: ReadonlyArray<string>;
};

/**
 * A loaded key table: the backend it was loaded for, its rows, the prefix key, the commands bound
 * after the prefix and the commands bound to a key alone.
 *
 * @category models
 */
export type Table = {
  readonly backend: Backend;
  readonly rows: ReadonlyArray<Binding>;
  readonly prefix: string;
  readonly after: ReadonlyMap<string, string>;
  readonly alone: ReadonlyMap<string, string>;
};

/**
 * Schema for why a table does not load: a row binds a key its backend can never have.
 *
 * @category schemas
 */
export const LoadError = Schema.TaggedUnion({
  cannot: { does: Schema.String, key: Schema.String },
});

/**
 * Why a table does not load, as `LoadError` decodes it.
 *
 * @category models
 */
export type LoadError = typeof LoadError.Type;

/**
 * Schema for where one press goes: the platform keeps it; it arms the prefix; it is a command; it
 * goes to the focused tile's content; it ends the prefix and goes nowhere; or it answers a close's
 * y/n.
 *
 * @category schemas
 */
export const Routed = Schema.TaggedUnion({
  platform: {},
  prefix: {},
  command: { does: Schema.String },
  tile: { key: Schema.String },
  dropped: {},
  answer: { yes: Schema.Boolean },
});

/**
 * Where one press goes, as `Routed` decodes it.
 *
 * @category models
 */
export type Routed = typeof Routed.Type;

/** The prefix key, from the glossary's `prefix` row; a person's file may change it later (K2). */
const PREFIX = "ctrl+b";
const AFTER = "<prefix>";

/** What a browser keeps for itself (0278: a tab cannot have Mod-W, Mod-T, Mod-N or Mod-Q). */
const BROWSER = ["w", "t", "n", "q"] as const;

/** The press a row's key means on a backend: `mod` becomes the backend's command key. */
const resolved = (key: string, mod: Backend["mod"]): string => key.replace(/(^|\+)mod\+/, `$1${mod}+`);

/**
 * Returns the backend a window runs on. A browser tab keeps Mod-W, Mod-T, Mod-N and Mod-Q, and on
 * Windows and Linux Chrome keeps F6; an OS the window does not know keeps both command keys.
 * Electron on a Mac keeps Cmd-Q and Cmd-H. A headless client keeps none.
 *
 * @category constructors
 */
export const backend = (platform: Backend["platform"], os: Backend["os"]): Backend => {
  const mod = os === "macos" || os === "ios" ? "meta" : "ctrl";
  const mods = os === "unknown" ? (["ctrl", "meta"] as const) : [mod];
  const cannot =
    platform === "browser"
      ? [
          ...mods.flatMap((m) => BROWSER.map((k) => `${m}+${k}`)),
          ...(os === "windows" || os === "linux" || os === "unknown" ? ["f6"] : []),
        ]
      : platform === "electron" && os === "macos"
        ? ["meta+q", "meta+h"]
        : [];
  return { platform, os, mod, cannot };
};

/**
 * Returns what a backend is shipped of the default rows: every row, in order, with each key that
 * backend can never have dropped. A command keeps its word and its label, so it keeps a way in.
 *
 * @category constructors
 */
export const ship = <B extends Binding>(defaults: ReadonlyArray<B>, on: Backend): ReadonlyArray<B> =>
  defaults.map((row) => ({ ...row, keys: row.keys.filter((k) => !on.cannot.includes(resolved(k, on.mod))) }));

/**
 * Loads rows into a window's table, or fails on the first row bound to a key its backend can never
 * have: a person's binding there fails loudly, never with a warning (0278).
 *
 * @category constructors
 */
export const load = (bindings: ReadonlyArray<Binding>, on: Backend): Result.Result<Table, LoadError> => {
  const after = new Map<string, string>();
  const alone = new Map<string, string>();

  for (const row of bindings) {
    for (const key of row.keys) {
      const press = resolved(key, on.mod);

      if (on.cannot.includes(press)) {
        return Result.fail(LoadError.cases.cannot.make({ does: row.does, key }));
      }

      if (press.startsWith(AFTER)) {
        after.set(press.slice(AFTER.length), row.does);
      } else {
        alone.set(press, row.does);
      }
    }
  }

  return Result.succeed({ backend: on, rows: bindings, prefix: PREFIX, after, alone });
};

const R = Routed.cases;

/**
 * Routes one press by 0272's steps 1, 2 and 6, in order. A key the backend keeps is the
 * platform's in any state. While idle the prefix key arms, a key bound alone is its command, and
 * the rest reaches the tile. While armed a bound key is its command, the prefix again goes to the
 * tile (tmux's send-prefix), and Escape or an unbound key is dropped. While a close asks, `y` says
 * yes and any other key says no. `mode` is the focused program's mode; none has one yet.
 *
 * @category getters
 */
export const route = (table: Table, prefix: Prefix, _mode: null, press: { readonly key: string }): Routed => {
  const key = press.key;

  if (table.backend.cannot.includes(key)) {
    return R.platform.make({});
  }

  if (prefix._tag === "asking") {
    return R.answer.make({ yes: key === "y" });
  }

  if (prefix._tag === "armed") {
    const does = table.after.get(key);
    return key === table.prefix
      ? R.tile.make({ key })
      : does === undefined
        ? R.dropped.make({})
        : R.command.make({ does });
  }

  const does = table.alone.get(key);
  return key === table.prefix
    ? R.prefix.make({})
    : does === undefined
      ? R.tile.make({ key })
      : R.command.make({ does });
};

/** The keys a press names by its own name, lower case. */
const NAMED: Readonly<Record<string, string>> = { " ": "space", Esc: "escape" };

/**
 * Returns a press spelled as the table spells it, from a key event's own fields (a DOM
 * `KeyboardEvent` has them), or null for a modifier pressed alone.
 *
 * @category getters
 */
export const spell = (e: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): string | null => {
  if (["Control", "Alt", "Meta", "Shift", "AltGraph", "CapsLock", "Dead", "Unidentified"].includes(e.key)) {
    return null;
  }

  const named = NAMED[e.key] ?? (e.key.length === 1 ? null : e.key.toLowerCase());
  const mods = [e.ctrlKey ? "ctrl" : "", e.altKey ? "alt" : "", e.metaKey ? "meta" : ""].filter((m) => m !== "");
  // A printable key carries Shift in its own character; with Ctrl, Alt or Meta it is the letter
  // itself, lower case, and Shift is said.
  const shift = e.shiftKey && (named !== null || mods.length > 0) ? ["shift"] : [];
  const base = named ?? (mods.length > 0 ? e.key.toLowerCase() : e.key);
  return [...mods, ...shift, base].join("+");
};
