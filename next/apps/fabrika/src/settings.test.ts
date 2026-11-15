// T753, next/. Port bounds are held at the shared reader in SettingsInput.test.ts.
import { describe, it } from "@effect/vitest";
import { ProgramName } from "@kampus/libfabrika/packs/ProgramName";
import * as StartsTest from "@kampus/libfabrika/settings/StartsTest";
import { Effect, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as fc from "fast-check";
import { expect } from "vitest";
import * as AppSettings from "./settings.ts";
import { Settings } from "./settings.ts";
import { programs } from "./table.ts";

StartsTest.law(
  "the app transport accepts the shared start envelope without a second port",
  fc.tuple(StartsTest.recipe),
  ([recipe]) =>
    Effect.gen(function* () {
      const input = yield* StartsTest.input(recipe);
      const decoded = yield* Schema.decodeUnknownEffect(Settings)(input, { onExcessProperty: "error" });
      expect(decoded).toEqual(input);
      expect(Object.hasOwn(decoded, "port")).toBe(false);
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
);

// Ticket 1042, next/ (a new tile opens the shell, through the setting `tezgah.new`): law N6 of the
// approved plan. Written before `refuseNew` exists. The shape it holds `settings.ts` to, from the
// plan: `refuseNew(value, origin, table)` answers null when `value` names a program of `table` a tile
// may show, every one but `fabrika/tezgah`, the frame itself; else the words the start stops with,
// which name the key `pack.fabrika.settings.tezgah.new`, the value, where it came from, and every
// program a tile can show.
const KEY = "pack.fabrika.settings.tezgah.new";
const TEZGAH = "fabrika/tezgah";

/** Where a value can come from, as `fabrika settings` prints it. */
const Origin = Schema.Literals([
  "default",
  "~/.fabrika/fabrika.toml",
  "$FABRIKA_HOME/fabrika.toml",
  "--pack.fabrika.settings.tezgah.new",
  "FABRIKA_PACK_FABRIKA_SETTINGS_TEZGAH_NEW",
]);

/** One draw: a made-up table of program names, with or without tezgah, a name that may be outside
 *  any table, and where the value came from. */
const Draw = Schema.Struct({
  names: Schema.Array(ProgramName).check(Schema.isMinLength(1), Schema.isMaxLength(5)),
  tezgah: Schema.Boolean,
  any: ProgramName,
  origin: Origin,
});

describe("Ticket 1042 N6: the start checks tezgah.new against the build's programs", () => {
  it.prop(
    "N6: refuseNew answers null exactly for the table's programs other than fabrika/tezgah, and its words name the key, the value, its origin and every program a tile can show",
    { draw: Draw },
    ({ draw }) => {
      expect(AppSettings.refuseNew, "N6: settings.ts exports refuseNew").toBeTypeOf("function");
      const made = [...new Set([...draw.names, ...(draw.tezgah ? [TEZGAH] : [])])].map((name) => ({ name }));

      // Each draw checks the app's own table and a made-up one, against each of its names,
      // fabrika/tezgah and a name that may be outside it, so every case is reached every time.
      for (const table of [programs, made]) {
        const names = table.map((p) => p.name);
        const shown = names.filter((n) => n !== TEZGAH);

        for (const value of [...names, TEZGAH, draw.any]) {
          const said = AppSettings.refuseNew(value, draw.origin, table);
          const takes = shown.includes(value);
          expect(said === null, `N6: ${value} ${takes ? "is" : "is not"} a program a tile of this table can show`).toBe(
            takes,
          );

          for (const word of takes ? [] : [KEY, value, draw.origin, ...shown]) {
            expect(said, `N6: the words for ${value} name ${word}`).toContain(word);
          }
        }
      }
    },
    { arbitrary: { seed: 119120, runs: 300 } },
  );
});
