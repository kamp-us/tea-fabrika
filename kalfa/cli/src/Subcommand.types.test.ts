// K10: the types of `make` and `isSubcommand`, checked by the compiler. Each case is written with real values, never
// `declare const`, and the file also runs under vitest: its `it` hands the function that holds the cases to `expectTypeOf`,
// so a missing module or a wrong import is red there too, and the compiler (`tsc`) reads every line.
import { expectTypeOf, it } from "@effect/vitest";
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import * as Diagnostics from "@kalfa/diagnostics/Diagnostics";
import { Effect, Layer, Path } from "effect";
import { Command } from "effect/cli";
import { Other, Probe } from "./Subcommand.test-support.ts";
import * as Subcommand from "./Subcommand.ts";

const KeyShape = Diagnostic.make("leak/key-shape", { explain: "A line has the shape of a private key." });

// A handler that needs `Probe`, one that needs `Other`, one that needs `Path` (Node's platform), and one that reports.
const needsProbe = Command.make("leak", {}, () => Effect.flatMap(Probe, () => Effect.void));

const needsOther = Command.make("leak", {}, () => Effect.flatMap(Other, () => Effect.void));

const needsPath = Command.make("leak", {}, () => Effect.flatMap(Path.Path, () => Effect.void));

const reports = Command.make("leak", {}, () =>
  Diagnostics.report(KeyShape, {
    severity: "error",
    message: "m",
    place: Diagnostic.Place.cases.repo.make({ path: "." }),
    hint: "h",
  }),
);

const gives = Layer.succeed(Probe, { value: "v" });

// A Layer that builds from the platform.
const fromPlatform = Layer.effect(
  Probe,
  Effect.map(Path.Path, () => ({ value: "v" })),
);

const diagnostics = [KeyShape];

// A call of `make` on the command that needs `Probe`, with a Layer of this type that gives it.
type Takes<L> = (
  command: typeof needsProbe,
  options: { readonly layer: L; readonly diagnostics: ReadonlyArray<Diagnostic.Declared> },
) => void;

const shapeContract = (widened: string, either: "a" | "b") => {
  // The name is the command's name, as a literal.
  const plain = Subcommand.make(Command.make("leak"), { layer: Layer.empty, diagnostics });

  // K10 plant: return `Subcommand<string>` from `make`, and this line fails.
  expectTypeOf(plain).toEqualTypeOf<Subcommand.Subcommand<"leak">>();
  expectTypeOf(plain.name).toEqualTypeOf<"leak">();
  expectTypeOf(plain.diagnostics).toEqualTypeOf<ReadonlyArray<Diagnostic.Declared>>();

  // A command made with a handler, and one made with subcommands under it.
  const handled = Subcommand.make(
    Command.make("leak", {}, () => Effect.void),
    { layer: Layer.empty, diagnostics },
  );

  const check = Command.make("check", {}, () => Effect.void);

  const parent = Subcommand.make(Command.make("leak").pipe(Command.withSubcommands([check])), {
    layer: Layer.empty,
    diagnostics: [],
  });

  expectTypeOf(handled).toEqualTypeOf<Subcommand.Subcommand<"leak">>();
  expectTypeOf(parent).toEqualTypeOf<Subcommand.Subcommand<"leak">>();

  // A command that already has a Layer given, written both ways round, and one with its name widened to `string`,
  // which a run checks.
  const provided = Command.provide(needsProbe, gives);
  const given = Subcommand.make(provided, { layer: Layer.empty, diagnostics });
  const piped = Subcommand.make(needsProbe.pipe(Command.provide(gives)), { layer: Layer.empty, diagnostics });
  const wide = Subcommand.make(Command.make(widened), { layer: Layer.empty, diagnostics });

  expectTypeOf(given).toEqualTypeOf<Subcommand.Subcommand<"leak">>();
  expectTypeOf(piped).toEqualTypeOf<Subcommand.Subcommand<"leak">>();
  expectTypeOf(wide).toEqualTypeOf<Subcommand.Subcommand<string>>();

  // A name that is a union, and a command typed by hand instead of inferred, as an author may write it.
  const typed: Command.Command<"leak", Record<never, never>, Record<never, never>, never, never> = Command.make("leak");

  expectTypeOf(Subcommand.make(Command.make(either), { layer: Layer.empty, diagnostics })).toEqualTypeOf<
    Subcommand.Subcommand<"a" | "b">
  >();
  expectTypeOf(Subcommand.make(typed, { layer: Layer.empty, diagnostics })).toEqualTypeOf<
    Subcommand.Subcommand<"leak">
  >();

  // The list of codes: empty, mutable, read-only and a fixed tuple all fit.
  const lists = [
    Subcommand.make(typed, { layer: Layer.empty, diagnostics: [] }),
    Subcommand.make(typed, { layer: Layer.empty, diagnostics: [KeyShape, KeyShape] }),
    Subcommand.make(typed, { layer: Layer.empty, diagnostics: [KeyShape] as const }),
  ];

  expectTypeOf(lists).toEqualTypeOf<Array<Subcommand.Subcommand<"leak">>>();

  // A Layer that gives what the command needs, one that builds from Node's platform, and a command that needs the
  // platform or Diagnostics, which `kalfa` gives.
  const layers = [
    Subcommand.make(needsProbe, { layer: gives, diagnostics }),
    Subcommand.make(needsProbe, { layer: fromPlatform, diagnostics }),
    Subcommand.make(needsPath, { layer: Layer.empty, diagnostics }),
    Subcommand.make(reports, { layer: Layer.empty, diagnostics }),
  ];

  expectTypeOf(layers).toEqualTypeOf<Array<Subcommand.Subcommand<"leak">>>();

  // K10 plant: drop `Covered` from `make`, and this line compiles, so its `@ts-expect-error` is unused.
  // @ts-expect-error a command needs a service that its Layer, Diagnostics and Node's platform do not give
  const missing = Subcommand.make(needsOther, { layer: Layer.empty, diagnostics });

  // @ts-expect-error the Layer gives a service the command does not need, and the command still needs `Other`
  const wrong = Subcommand.make(needsOther, { layer: gives, diagnostics });

  // A Layer that needs a service nothing gives is refused. It is a type check of `make`'s own signature, with no
  // Layer value to hand over: `make` fits a call with such a Layer only if its signature takes one.
  // K10 plant: widen the Layer's requirement `LR` to `unknown`, or to a bound that holds `Other`, and the two `not`
  // lines fail; narrow it to `never`, and the line with `Path` fails.
  expectTypeOf(Subcommand.make).not.toExtend<Takes<Layer.Layer<Probe, never, Other>>>();
  expectTypeOf(Subcommand.make).not.toExtend<Takes<Layer.Layer<Probe, never, Path.Path | Other>>>();
  expectTypeOf(Subcommand.make).toExtend<Takes<Layer.Layer<Probe, never, Path.Path>>>();
  expectTypeOf(Subcommand.make).toExtend<Takes<Layer.Layer<Probe, never, Subcommand.Platform>>>();

  // @ts-expect-error a list of codes holds declared codes, never text
  const text = Subcommand.make(typed, { layer: Layer.empty, diagnostics: ["leak/key-shape"] });

  // @ts-expect-error a plain object with a code and a text is no declared code: only `Diagnostic.make` builds one
  const plainCode = Subcommand.make(typed, { layer: Layer.empty, diagnostics: [{ code: "a/b", explain: "x" }] });

  // @ts-expect-error the list of codes is required
  const noList = Subcommand.make(typed, { layer: Layer.empty });

  // @ts-expect-error the Layer is required, so no subcommand is made that cannot run without one
  const noLayer = Subcommand.make(typed, { diagnostics });

  // @ts-expect-error the command is an effect/cli command, never its name
  const named = Subcommand.make("leak", { layer: Layer.empty, diagnostics });

  expectTypeOf([missing, wrong, text, plainCode, noList, noLayer, named]).toBeArray();
};

// Two types are the same when each is assignable to the other. `expectTypeOf`'s own equality cannot read a Subcommand
// whose name is the wide `string`: it fails on the command's read-only list of examples.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const guardContract = () => {
  // A value nothing is known of: a Layer is no subcommand.
  const value: unknown = Layer.empty;

  // K10 plant: make `isSubcommand` return `boolean`, and the guard line fails.
  expectTypeOf<
    Same<
      typeof Subcommand.isSubcommand extends ((value: unknown) => value is infer S) ? S : never,
      Subcommand.Subcommand
    >
  >().toEqualTypeOf<true>();
  expectTypeOf(Subcommand.isSubcommand).parameters.toEqualTypeOf<[value: unknown]>();

  if (Subcommand.isSubcommand(value)) {
    expectTypeOf<Same<typeof value, Subcommand.Subcommand>>().toEqualTypeOf<true>();
    expectTypeOf(value.name).toEqualTypeOf<string>();
  }

  // A subcommand with a literal name is one with any name: `Name` is only read.
  expectTypeOf<Subcommand.Subcommand<"leak">>().toExtend<Subcommand.Subcommand>();
  expectTypeOf<Subcommand.Subcommand>().not.toExtend<Subcommand.Subcommand<"leak">>();
};

it("K10 type: make gives a Subcommand named by its command and refuses what its Layer, Diagnostics and Node's platform do not cover, and isSubcommand narrows to one", () => {
  expectTypeOf(shapeContract).toBeFunction();
  expectTypeOf(guardContract).toBeFunction();
});
