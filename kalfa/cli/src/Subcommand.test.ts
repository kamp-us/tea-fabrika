// K11: what `make` and `isSubcommand` do at run time. `make` builds a subcommand from a command and a Layer, and
// refuses a name that is not a root name; `isSubcommand` tells what `make` built from everything else, in this copy of
// the package and in another. The types of the same call are K10 (Subcommand.types.test.ts).
import { describe, expect, it } from "@effect/vitest";
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import * as TestDiagnostics from "@kalfa/diagnostics/TestDiagnostics";
import { Effect, Exit, Layer, Ref, Result } from "effect";
import { Command } from "effect/cli";
import * as fc from "fast-check";
import {
  anyTextFc,
  CANDIDATE_IDS,
  candidates,
  goodCodes,
  goodName,
  goodNameFc,
  isRootName,
  NAME_BREAKS,
  platform,
  Probe,
  probing,
  SEED,
  wildText,
} from "./Subcommand.test-support.ts";
import * as Subcommand from "./Subcommand.ts";

/** What `make` did with a name: the subcommand it built, or the value it threw. Building the command is outside the try. */
const attempt = (name: string): { readonly built: Subcommand.Subcommand | undefined; readonly thrown: unknown } => {
  const command = Command.make(name);

  const result = Result.try({
    try: () => Subcommand.make(command, { layer: Layer.empty, diagnostics: [] }),
    catch: (thrown) => thrown,
  });

  return Result.isSuccess(result)
    ? { built: result.success, thrown: undefined }
    : { built: undefined, thrown: result.failure };
};

/** The model's verdict on a name against what `make` did, as one failure text. */
const verdict = (name: string): string | undefined => {
  const { built, thrown } = attempt(name);

  if (isRootName(name)) {
    return built === undefined ? `${JSON.stringify(name)} is a root name and make threw: ${String(thrown)}` : undefined;
  }

  if (built !== undefined) {
    return `${JSON.stringify(name)} is no root name and make built a subcommand`;
  }

  return thrown instanceof Error && thrown.message.trim() !== ""
    ? undefined
    : `${JSON.stringify(name)} is no root name and make did not throw an Error with a message`;
};

describe("K11, make and isSubcommand at run time", () => {
  // Plant: drop the name check, and a name with a capital letter builds. Check with a pattern that allows a trailing
  // hyphen, a leading digit or a double hyphen, and that break builds. Make the pattern refuse a digit inside a word,
  // and a good name with a digit is refused. Give the pattern the multiline flag, and a trailing line break builds.
  it("a name builds exactly when it is a root name by an independent model of the rule, and a refused name throws an Error", () => {
    fc.assert(
      fc.property(goodNameFc, anyTextFc, wildText, (good, text, wild) => {
        const names = [good, text, wild, ...NAME_BREAKS.map((broken) => broken.apply(good))];

        for (const name of names) {
          expect(verdict(name)).toBeUndefined();
        }

        // Every class is reached: the good name builds, and every break is refused.
        expect(attempt(good).built).toBeDefined();

        for (const broken of NAME_BREAKS) {
          expect(attempt(broken.apply(good)).thrown, broken.name).toBeInstanceOf(Error);
        }
      }),
      { seed: SEED, numRuns: 200 },
    );
  });

  // Plant: store another name than the command's, and the name differs. Cut the list of codes to its first code, or
  // sort it, and the list differs. Store the command with no `Command.provide`, and its handler dies for `Probe`.
  it.effect.prop(
    "what it builds keeps its name and its list of codes as given, and its command runs its handler with the Layer's service",
    { name: goodName, value: goodName, codes: goodCodes },
    ({ name, value, codes }) =>
      Effect.gen(function* () {
        const seen = yield* Ref.make<ReadonlyArray<string>>([]);
        const declared = codes.map((code) => Diagnostic.make(code, { explain: "A code made to fill a list." }));

        const made = Subcommand.make(probing(name, seen), {
          layer: Layer.succeed(Probe, { value }),
          diagnostics: declared,
        });

        expect(made.name).toBe(name);
        expect(made.command.name).toBe(name);
        expect(made.diagnostics.map((one) => one.code)).toEqual(codes);
        expect(made.diagnostics).toEqual(declared);

        const exit = yield* Effect.exit(
          Command.runWith(made.command, { version: "0.0.0" })([]).pipe(
            Effect.provide(Layer.mergeAll(platform, TestDiagnostics.layer)),
          ),
        );

        expect(Exit.isSuccess(exit), `the handler ran: ${String(exit)}`).toBe(true);
        expect(yield* Ref.get(seen)).toEqual([value]);
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );

  // Plant: check only the mark, and every look-alike that carries it is true. Replace `Command.isCommand` with a check of
  // a `name` key, and the plain object with the right name is true. Skip the name-against-command check, and the
  // other-name class is true. Skip the array check, or the diagnostics key, and the list classes are true. Mark with a
  // plain `Symbol()` and not `Symbol.for`: a subcommand from the second copy is false.
  it.effect.prop(
    "isSubcommand is true for what make built, here and from a second copy of the module, and false for each look-alike",
    { name: goodName },
    ({ name }) =>
      Effect.gen(function* () {
        // A second copy of the module: the same file under another query, which the module graph holds apart.
        const specifier: string = "./Subcommand.ts?second-copy";

        const second: typeof Subcommand = yield* Effect.tryPromise({
          try: () => import(specifier),
          catch: (cause) => new Error("the second copy of Subcommand.ts did not load", { cause }),
        });

        expect(second.make, "the second copy is another module").not.toBe(Subcommand.make);

        const here = Subcommand.make(Command.make(name), { layer: Layer.empty, diagnostics: [] });
        const there = second.make(Command.make(name), { layer: Layer.empty, diagnostics: [] });

        // The mark is a key of the global registry, so a copy of the package marks the same key.
        const marks = Object.getOwnPropertySymbols(here).map((mark) => Symbol.keyFor(mark));

        expect(marks.length, "the subcommand carries a mark").toBeGreaterThan(0);
        expect(
          marks.every((key) => key !== undefined),
          "the mark is made with Symbol.for",
        ).toBe(true);

        expect(Subcommand.isSubcommand(there), "built by the second copy, read by this one").toBe(true);
        expect(second.isSubcommand(here), "built by this copy, read by the second one").toBe(true);

        const reached = new Set<string>();

        for (const candidate of candidates(here)) {
          reached.add(candidate.id);

          expect(Subcommand.isSubcommand(candidate.value), candidate.name).toBe(candidate.holds);
          expect(second.isSubcommand(candidate.value), `${candidate.name}, read by the second copy`).toBe(
            candidate.holds,
          );
        }

        expect([...reached]).toEqual(CANDIDATE_IDS);
      }),
    { arbitrary: { seed: SEED, runs: 50 } },
  );
});
