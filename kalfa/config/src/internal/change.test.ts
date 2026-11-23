// Ticket 1843, slice 2, kalfa/config (new work): E11 of the approved plan (.kalfa/quests/kalfa-config-edit-PLAN.md, with
// its Amendment 1), the guard after the edit, for the internal `set` of `internal/change.ts`. It is internal on purpose:
// the real TOML format never gets this wrong, so a law that reaches the guard through `SettingGroup.edit` has nothing to
// see. The three stand-in formats below each go wrong in one way, and the guard must turn each into the one error
// `edit`, with no text.
//
// scenario: three stand-in formats, each wrong in one way (the reason label `fabrika/law-shape` takes for a guard no
// real input reaches). Plant, run once and never kept: drop the kept check in `change.ts`, so the first stand-in's
// text comes back and the law is red.
import { expect, it } from "@effect/vitest";
import { Effect, Exit, Result, Schema } from "effect";
import { Setting, SettingGroup } from "../index.ts";
import { set } from "./change.ts";
import type { Format } from "./format.ts";
import { toml } from "./toml.ts";

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const port = (name: string) =>
  Setting.make(name, Port).pipe(Setting.withDefault(18787), Setting.withDescription("A generated port."));

const one = port("a.one");

const group = SettingGroup.make("demo", one, port("a.two"), port("b.three"));

const place = { file: "repo", names: { repo: ".demo/demo.toml", user: "~/.demo/demo.toml" } } as const;

const TEXT = "[a]\none = 1\ntwo = 2\n\n[b]\nthree = 3\n";

/** The real format, so each stand-in is the real edit and then one more change. */
const standIn = (after: (text: string) => Result.Result<string, never>): Format => ({
  ...toml,
  set: (text, path, value) => Result.flatMap(toml.set(text, path, value), after),
});

/** One edit that also changes another key. */
const alsoChanges = standIn((text) => {
  const next = toml.set(text, ["a", "two"], 99);

  return Result.succeed(Result.isSuccess(next) ? next.success : text);
});

/** One whose answer is not TOML. */
const unreadable = standIn((text) => Result.succeed(`${text}\n= = =\n`));

/** One that drops a table. */
const dropsTable = standIn((text) => Result.succeed(text.slice(0, text.indexOf("[b]"))));

const run = (format: Format) => Effect.exit(set(group, format, place, TEXT, one, 5));

it.effect(
  "scenario: E11 a format that changes another key, one whose answer does not parse, and one that drops a table each answer edit and no text",
  () =>
    Effect.gen(function* () {
      // The real format passes the same guard: the stand-ins fail it, not the file.
      const real = yield* run(toml);

      expect(Exit.isSuccess(real)).toBe(true);
      expect(Exit.isSuccess(real) ? real.value : "").toBe("[a]\none = 5\ntwo = 2\n\n[b]\nthree = 3\n");

      for (const [name, format] of [
        ["changes another key", alsoChanges],
        ["does not parse", unreadable],
        ["drops a table", dropsTable],
      ] as const) {
        const exit = yield* run(format);

        expect(Exit.isFailure(exit), `${name}: no text comes back`).toBe(true);

        const errors = Exit.isFailure(exit)
          ? exit.cause.reasons.flatMap((reason) => (reason._tag === "Fail" ? [reason.error] : []))
          : [];

        expect(errors, `${name}: one error`).toHaveLength(1);
        expect(errors[0]?.reason, name).toBe("edit");
        expect(errors[0]?.file, name).toBe(".demo/demo.toml");
      }
    }),
);
