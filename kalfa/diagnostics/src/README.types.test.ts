// D24: the README's code blocks, word for word, so the package's compiler checks that they compile. Each place
// is typed as `Diagnostic.Place`, so a kind written wrong, or a place written without its type, does not compile.
// Package.test.ts reads the README and this file and checks that every block is here, apart from import lines, which
// sit together at the top. Change a block in one and the same block in the other.
// D24 plant: drop `: Diagnostic.Place` from one example below, and tsc refuses `formatPlace` on it.
/* oxlint-disable anti-slop-effect/no-manual-tagged-construction -- the README shows a caller writing a place as plain data, and each example is checked as written */
import { expectTypeOf, it } from "@effect/vitest";
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import * as Diagnostics from "@kalfa/diagnostics/Diagnostics";
import * as Hidden from "@kalfa/diagnostics/Hidden";
import * as TestDiagnostics from "@kalfa/diagnostics/TestDiagnostics";
import { Effect, Option, Redacted, Schema } from "effect";

export const UnknownSetting = Diagnostic.make("config/unknown-setting", {
  explain: "A settings file names a setting that no app declares. Check the spelling against the settings reference.",
});

// Effect<void, never, Diagnostics.Diagnostics>
const found = Diagnostics.report(UnknownSetting, {
  severity: "error",
  message: "The setting `service.prot` is not declared.",
  place: { _tag: "repo", path: ".config/settings.toml", line: 4 },
  hint: "Did you mean `service.port`?",
});

// A file in the repo: a path from the repo root, with a line and a column when known. The whole repo is ".".
const repo: Diagnostic.Place = { _tag: "repo", path: "docs/setup.md", line: 12 };

// A file under the home folder: starts with "~/" or "$NAME/". A login name is never printed.
const home: Diagnostic.Place = { _tag: "home", path: "~/.demo/demo.toml", line: 3, column: 1 };

const variableHome: Diagnostic.Place = { _tag: "home", path: "$DEMO_HOME/demo.toml", line: 2 };

// An environment variable, by name. No line and no column.
const environment: Diagnostic.Place = { _tag: "environment", name: "DEMO_INSTANCE_PORT" };

// A command-line flag, by name as typed, with its hyphens. No line and no column.
const flag: Diagnostic.Place = { _tag: "flag", name: "--instance.port" };

Diagnostic.formatPlace(repo); // "docs/setup.md:12"

Diagnostic.formatPlace(home); // "~/.demo/demo.toml:3:1"

Diagnostic.formatPlace(variableHome); // "$DEMO_HOME/demo.toml:2"

Diagnostic.formatPlace(environment); // "environment variable DEMO_INSTANCE_PORT"

Diagnostic.formatPlace(flag); // "flag --instance.port"

const program = found.pipe(Effect.andThen(TestDiagnostics.reported), Effect.provide(TestDiagnostics.layer));
// [{ code: "config/unknown-setting", severity: "error", message: "...", place: { ... }, hint: "..." }]

export class UnknownSettingError extends Schema.TaggedError<UnknownSettingError, { readonly brand: unique symbol }>()(
  "UnknownSettingError",
  {
    setting: Schema.String,
    line: Schema.Int,
  },
) {
  get diagnostic(): Diagnostic.Carried {
    return Diagnostic.carry(UnknownSetting, {
      message: `The setting \`${this.setting}\` is not declared.`,
      place: Diagnostic.Place.cases.repo.make({ path: ".config/settings.toml", line: this.line }),
      hint: "Check the spelling against the settings reference.",
    });
  }
}

// Where the error is handled: report what it carries through `report`, or nothing.
const reportCarried = (error: UnknownSettingError) =>
  Option.match(Diagnostic.fromError(error), {
    onNone: () => Effect.void,
    onSome: (carried) => Diagnostics.report(carried.declared, carried.fields),
  });

export class StoreFailed extends Schema.TaggedError<StoreFailed, { readonly brand: unique symbol }>()("StoreFailed", {
  cause: Hidden.Cause,
}) {}

// The cause is made with `Redacted.make`; `Schema.toCodecJson` of the error writes its `cause` as "<redacted>".
const failed = new StoreFailed({ cause: Redacted.make(new Error("bad value")) });

it("D24 type: the README's examples compile", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(failed.cause).toEqualTypeOf<Redacted.Redacted<unknown>>();
  expectTypeOf(program).toBeObject();
  // `Option.match` gives a union of its two branches, so the check is `toExtend`, not equality.
  expectTypeOf(reportCarried).returns.toExtend<Effect.Effect<void, never, Diagnostics.Diagnostics>>();
  expectTypeOf(Diagnostic.formatPlace).toEqualTypeOf<(place: Diagnostic.Place) => string>();
});
