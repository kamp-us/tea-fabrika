// Desk S2b, next/ (the desk program fabrika/tezgah, ticket named by its title): law L19 of the approved
// plan. Written before `commands.ts`. The types are checked by `tsc` over this file (CI's typecheck
// job, 0133); the runtime half checks the rows themselves.
//
// The shape this law holds `commands.ts` to, from the plan's "The shape" and "Commands" (the build may
// add more):
// - `commands` is tezgah's one table of default rows, each a libfabrika `Binding`, `{does, keys,
//   word, label}` (0267's one `commands` field, which the window is handed as a value). Its row types
//   keep their literal names, so a name is checked where it is written.
// - Every command is named `tezgah.<word>` (0267: a name carries its program's name, 0491: the word is
//   tezgah), carries a shell word and a palette label (0278: losing a key never loses a command), and
//   is a command tezgah's own `did` takes, so a key never sends what tezgah would refuse to decode.
// - This slice ships split right, split down and close on tmux's keys after the prefix.
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import type { Binding } from "@kampus/libfabrika";
import * as Keys from "@kampus/libfabrika/client/Keys";
import { Result } from "effect";
import * as fc from "fast-check";
import { commands } from "./commands.ts";
import type { tezgahMachine } from "./program.ts";

type Row = (typeof commands)[number];
type Did = Extract<typeof tezgahMachine.msg.Type, { readonly type: "did" }>;

const PLATFORMS = ["browser", "electron", "headless"] as const;
const OSES = ["macos", "windows", "linux", "android", "ios", "unknown"] as const;

describe("L19: every tezgah command is named tezgah.<word> and carries a word and a label", () => {
  // pinned: L19 is a type law; these checks fail CI's typecheck when a row loses its name, word or label.
  it("pinned: each row is a Binding named tezgah.<word> that tezgah's did takes, and a Binding needs its word and its label", () => {
    expectTypeOf<Row>().toExtend<Binding>();
    expectTypeOf<Row["does"]>().toExtend<`tezgah.${string}`>();
    expectTypeOf<Row["does"]>().toExtend<Did["does"]>();
    expectTypeOf<Row["word"]>().toExtend<string>();
    expectTypeOf<Row["label"]>().toExtend<string>();
    expectTypeOf<string>().not.toExtend<Row["does"]>();
    const rows = (row: Binding) => row;
    // @ts-expect-error a command with no word is not a binding
    rows({ does: "tezgah.zoom", keys: ["<prefix>z"], label: "Zoom" });
    // @ts-expect-error a command with no label is not a binding
    rows({ does: "tezgah.zoom", keys: ["<prefix>z"], word: "zoom" });
    expect(rows(commands[0]!)).toBe(commands[0]);
  });

  it("pinned: the slice ships split right, split down and close, each named once with a word and a label", () => {
    const names = commands.map((c) => c.does);
    expect(new Set(names).size, "L19: each command is named once").toBe(names.length);
    expect(names, "L19: the slice's three commands").toEqual(
      expect.arrayContaining(["tezgah.split_right", "tezgah.split_down", "tezgah.close"]),
    );

    for (const c of commands) {
      expect(c.does, "L19: a command is tezgah.<word>").toMatch(/^tezgah\.[a-z][a-z_]*$/);
      expect(c.word.trim(), `L19: ${c.does} carries a shell word`).not.toBe("");
      expect(c.label.trim(), `L19: ${c.does} carries a palette label`).not.toBe("");
    }
  });

  it("L19: the rows ship to and load on every backend, and each command keeps its word wherever its keys are dropped", () => {
    fc.assert(
      fc.property(fc.constantFrom(...PLATFORMS), fc.constantFrom(...OSES), (platform, os) => {
        const backend = Keys.backend(platform, os);
        const shipped = Keys.ship(commands, backend);
        expect(
          shipped.map((c) => [c.does, c.word, c.label]),
          `L19: ${platform} on ${os} is shipped every command`,
        ).toEqual(commands.map((c) => [c.does, c.word, c.label]));
        expect(Result.isSuccess(Keys.load(shipped, backend)), `L19: the rows load on ${platform} on ${os}`).toBe(true);
      }),
      { seed: 119120, numRuns: PLATFORMS.length * OSES.length * 3 },
    );
  });
});
