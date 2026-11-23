// K16: the README's code blocks, word for word, so the package's compiler checks that they compile. Package.test.ts reads
// the README and this file and checks that every block is here, apart from import lines, which sit together at the top.
// Change a block in one and the same block in the other.
// Plant: write `Subcommand.make` with no `layer` in one example below, and tsc refuses it.
/* oxlint-disable anti-slop-effect/no-manual-tagged-construction -- the README shows a caller writing a place as plain data, and each example is checked as written */
import { expectTypeOf, it } from "@effect/vitest";
import * as Subcommand from "@kalfa/cli/Subcommand";
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import * as Diagnostics from "@kalfa/diagnostics/Diagnostics";
import { Console, Effect, Layer } from "effect";
import { Command } from "effect/cli";

export const KeyShape = Diagnostic.make("leak/key-shape", { explain: "A line has the shape of a private key." });

const check = Command.make("check", {}, () =>
  Effect.gen(function* () {
    yield* Console.log("checked 2 files");
    yield* Diagnostics.report(KeyShape, {
      severity: "error",
      message: "Line 4 of `notes.md` has the shape of a private key.",
      place: { _tag: "repo", path: "notes.md", line: 4 },
      hint: "Remove the line and rotate the key.",
    });
  }),
);

// Subcommand<"leak">
export const subcommand = Subcommand.make(Command.make("leak").pipe(Command.withSubcommands([check])), {
  layer: Layer.empty,
  diagnostics: [KeyShape],
});

it("K16 type: the README's examples compile", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(subcommand).toEqualTypeOf<Subcommand.Subcommand<"leak">>();
});
