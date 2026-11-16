// Desk S2b, next/ (the desk program fabrika/tezgah, ticket named by its title): laws L15 and L16 of the
// approved plan, the key table half. Written before `client/Keys.ts` and `client/Prefix.ts`.
//
// The shape these laws hold `client/Keys.ts` to, from the plan's "The shape" (the build may add more):
// - A binding is a row, `{does, keys, word, label}` (the keybindings note's K1 and 0278): `does` is a
//   command name that carries its program's name (`tezgah.split_right`), `keys` its keys in the note's
//   spelling, a key alone (`f6`, `mod+w`) or after the prefix (`<prefix>%`), `word` its shell word and
//   `label` its palette entry.
// - `Keys.backend(platform, os)` is the backend a window runs on, from the hello's own words, with
//   `cannot`: the keys that backend can never have (0278: a browser tab cannot have Mod-W, Mod-T, Mod-N
//   or Mod-Q; the plan: F6 is Chrome's on Windows and Linux).
// - `Keys.ship(defaults, backend)` is what a backend is shipped of the default rows: every row, in its
//   order, with each key the backend cannot have dropped, so the command keeps its word and its label.
// - `Keys.load(bindings, backend)` answers a `Result`: the window's `Table`, or a `LoadError`. A row on
//   a key the backend cannot have fails the load, `{_tag: "cannot", does, key}`, never a warning.
// - `Keys.route(table, prefix, null, {key})` is 0272's router for steps 1, 2 and 6 (no program has a
//   mode yet): `prefix` is the window's `Prefix` Model from `client/Prefix.ts` (`idle`, `armed
//   {since}`, `asking {tile, since}`). It answers `platform` for a key the table's backend cannot have,
//   in any prefix state; `prefix` for the prefix key (`ctrl+b`) while idle; `command {does}` for a key
//   bound after the prefix while armed; `tile {key}` for the prefix key pressed again while armed
//   (tmux's send-prefix) and for any other key while idle; and `dropped` for Escape or an unbound key
//   while armed.
import { describe, expect, it } from "@effect/vitest";
import { Result } from "effect";
import * as fc from "fast-check";
import type { Binding } from "../runtime/Program.ts";
import * as Keys from "./Keys.ts";
import { Prefix } from "./Prefix.ts";

const SEED = 119120;

const PLATFORMS = ["browser", "electron", "headless"] as const;

const OSES = ["macos", "windows", "linux", "android", "ios", "unknown"] as const;

const PREFIX = "ctrl+b";

const idle = Prefix.cases.idle.make({});

const armed = Prefix.cases.armed.make({ since: 0 });

/** Every backend a window can be, with its cannot keys, read from the real `Keys.backend`. */
const BACKENDS = PLATFORMS.flatMap((platform) =>
  OSES.map((os) => ({ platform, os, backend: Keys.backend(platform, os) })),
);

/** Each backend's cannot keys, one pair per key: the generator L15 names. */
const CANNOT = BACKENDS.flatMap((b) => b.backend.cannot.map((key) => ({ ...b, key })));

/** Made-up commands of a made-up program, so a law never leans on tezgah's own defaults. */
const WORDS = ["split_right", "split_down", "close", "zoom", "fold", "detach"] as const;

/** Keys no backend refuses: after the prefix, or alone keys a tile would type. */
const FREE = ["<prefix>%", '<prefix>"', "<prefix>x", "<prefix>|", "<prefix>-", "<prefix>z", "<prefix>g"] as const;

const binding = (word: string, keys: ReadonlyArray<string>): Binding => ({
  does: `demo.${word}`,
  keys,
  word: word.replace("_", " "),
  label: word,
});

/** Rows on keys no backend refuses, each command once and each key once. */
const freeRows = fc
  .uniqueArray(fc.integer({ min: 0, max: WORDS.length - 1 }), { minLength: 1, maxLength: WORDS.length })
  .chain((words) =>
    fc
      .shuffledSubarray([...FREE], { minLength: words.length, maxLength: words.length })
      .map((keys) => words.map((w, i) => binding(WORDS[w]!, [keys[i]!]))),
  );

describe("L15: a binding on a key the backend cannot have fails at load; a default on one is never shipped", () => {
  // The plan's lean (65%) that Chrome owns F6 on Windows and Linux, so a tab's defaults drop it, and
  // its other half: F6 stays in Electron (L34) and a headless client keeps every key. Walked over
  // every backend a window can be, so a backend that loses or gains F6 is found wherever it is.
  it("L15: some backend has keys it cannot have; a browser tab on Windows or Linux cannot have F6, and Electron and a headless client can", () => {
    expect(CANNOT.length, "L15: some backend has keys it cannot have").toBeGreaterThan(0);
    const seen = { owned: 0, kept: 0 };
    // A browser tab on any other OS is not walked: the plan decides F6 for Windows and Linux only.
    const decided = BACKENDS.filter((b) => b.platform !== "browser" || b.os === "windows" || b.os === "linux");
    fc.assert(
      fc.property(fc.constantFrom(...decided), ({ platform, os }) => {
        const owned = platform === "browser";
        seen[owned ? "owned" : "kept"]++;
        expect(
          Keys.backend(platform, os).cannot.includes("f6"),
          owned ? `L15: Chrome owns F6 on ${os}` : `L15: ${platform} on ${os} keeps F6`,
        ).toBe(owned);
      }),
      { seed: SEED, numRuns: decided.length * 8 },
    );
    expect(seen.owned, "L15: the walk meets a tab where Chrome owns F6").toBeGreaterThan(0);
    expect(seen.kept, "L15: the walk meets a backend that keeps F6").toBeGreaterThan(0);
  });

  it("L15: a person's row on a cannot key fails the load and names its command and its key, whatever rows sit beside it", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CANNOT), freeRows, fc.nat(), fc.constantFrom(...WORDS), (pick, rows, at, word) => {
        const bad = binding(`${word}_mine`, [pick.key]);
        const bindings = [...rows.slice(0, at % (rows.length + 1)), bad, ...rows.slice(at % (rows.length + 1))];
        const loaded = Keys.load(bindings, pick.backend);
        expect(
          Result.isFailure(loaded),
          `L15: ${pick.platform} on ${pick.os} loads a row on ${pick.key}, a key it cannot have`,
        ).toBe(true);

        if (Result.isFailure(loaded)) {
          expect(loaded.failure, "L15: the failure names the command and the key").toMatchObject({
            _tag: "cannot",
            does: bad.does,
            key: pick.key,
          });
        }
      }),
      { seed: SEED, numRuns: Math.max(100, CANNOT.length * 4) },
    );
  });

  it("L15: shipped defaults keep every row, in order, with its word and label, drop only the backend's cannot keys, and load", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CANNOT), freeRows, fc.nat(), (pick, rows, at) => {
        const i = at % rows.length;
        // One default sits on a key this backend cannot have, beside a key it can.
        const defaults = rows.map((r, j) => (j === i ? { ...r, keys: [pick.key, ...r.keys] } : r));
        const shipped = Keys.ship(defaults, pick.backend);
        expect(
          shipped.map((r) => [r.does, r.word, r.label]),
          "L15: every default row ships, in order",
        ).toEqual(defaults.map((r) => [r.does, r.word, r.label]));

        for (const [j, row] of shipped.entries()) {
          expect(
            row.keys.filter((k) => pick.backend.cannot.includes(k)),
            `L15: ${row.does} ships no key ${pick.platform} on ${pick.os} cannot have`,
          ).toEqual([]);
          expect(row.keys, `L15: ${row.does} keeps every key the backend can have`).toEqual(
            defaults[j]!.keys.filter((k) => !pick.backend.cannot.includes(k)),
          );
        }

        expect(Result.isSuccess(Keys.load(shipped, pick.backend)), "L15: shipped defaults load").toBe(true);
      }),
      { seed: SEED, numRuns: Math.max(100, CANNOT.length * 4) },
    );
  });

  it("L15: rows on keys the backend can have load on every backend", () => {
    fc.assert(
      fc.property(fc.constantFrom(...BACKENDS), freeRows, (b, rows) => {
        expect(Result.isSuccess(Keys.load(rows, b.backend)), `L15: ${b.platform} on ${b.os} loads free rows`).toBe(
          true,
        );
      }),
      { seed: SEED, numRuns: 100 },
    );
  });
});

/** The table the router laws read: three commands after the prefix, on a browser tab on Linux. */
const ROUTER_BACKEND = Keys.backend("browser", "linux");

const ROUTER_ROWS = [
  binding("split_right", ["<prefix>%", "<prefix>|"]),
  binding("split_down", ['<prefix>"', "<prefix>-"]),
  binding("close", ["<prefix>x"]),
];

const table = () => {
  const loaded = Keys.load(ROUTER_ROWS, ROUTER_BACKEND);

  if (Result.isFailure(loaded)) {
    throw new Error(`the router's table does not load: ${JSON.stringify(loaded.failure)}`);
  }

  return loaded.success;
};

describe("L16: the router takes 0272's steps 1, 2 and 6 in order", () => {
  // scenario: L16's generator in the plan is one press per router step.
  it("scenario: a platform key is never taken, the prefix wins over the tile, a bound key after it is its command, the rest reaches the tile", () => {
    const t = table();
    const platform = ROUTER_BACKEND.cannot[0];
    expect(platform, "L16: a browser tab on Linux has a key it cannot have").toBeDefined();

    // Step 1: the platform's keys, in any prefix state.
    expect(Keys.route(t, idle, null, { key: platform! }), "L16 step 1, idle").toMatchObject({ _tag: "platform" });
    expect(Keys.route(t, armed, null, { key: platform! }), "L16 step 1, armed").toMatchObject({
      _tag: "platform",
    });

    // Step 2: the prefix, before the tile could take the key.
    expect(Keys.route(t, idle, null, { key: PREFIX }), "L16 step 2: the prefix arms").toMatchObject({
      _tag: "prefix",
    });
    expect(Keys.route(t, armed, null, { key: "%" }), "L16 step 2: % after the prefix").toEqual({
      _tag: "command",
      does: "demo.split_right",
    });
    expect(Keys.route(t, armed, null, { key: '"' }), 'L16 step 2: " after the prefix').toEqual({
      _tag: "command",
      does: "demo.split_down",
    });
    expect(Keys.route(t, armed, null, { key: "x" }), "L16 step 2: x after the prefix").toEqual({
      _tag: "command",
      does: "demo.close",
    });

    // Step 6: the focused tile's own content, for a key no step took.
    for (const key of ["a", "%", "x", "enter", "ctrl+c", "shift+a"]) {
      expect(Keys.route(t, idle, null, { key }), `L16 step 6: ${key} while idle reaches the tile`).toEqual({
        _tag: "tile",
        key,
      });
    }
  });
});

describe("L14: the keys after the prefix (the router's half)", () => {
  it("L14: the prefix again passes the prefix key to the tile; Escape and an unbound key are dropped; a bound key is its one command", () => {
    const t = table();

    const bound = new Map([
      ["%", "demo.split_right"],
      ["|", "demo.split_right"],
      ['"', "demo.split_down"],
      ["-", "demo.split_down"],
      ["x", "demo.close"],
    ]);

    const pressed = fc.oneof(
      fc.constantFrom(PREFIX, "escape", "%", "|", '"', "-", "x", "o", ";", "y", "n", "enter", "shift+x", "ctrl+x"),
      fc.string({ minLength: 1, maxLength: 3 }),
    );

    fc.assert(
      fc.property(pressed, (key) => {
        if (ROUTER_BACKEND.cannot.includes(key)) {
          return;
        }

        const routed = Keys.route(t, armed, null, { key });
        const does = bound.get(key);

        const want =
          key === PREFIX
            ? { _tag: "tile", key: PREFIX }
            : does !== undefined
              ? { _tag: "command", does }
              : { _tag: "dropped" };

        expect(routed, `L14: ${JSON.stringify(key)} after the prefix`).toEqual(want);
      }),
      { seed: SEED, numRuns: 200 },
    );
  });
});
