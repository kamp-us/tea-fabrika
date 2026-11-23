# @kalfa/cli

The `kalfa` command, and the shape a package exports so `kalfa` can run it. This package is the one place that knows
what a subcommand is. A package that gives one imports `@kalfa/cli/Subcommand` and nothing else of this package.

A **subcommand** is one package's command under `kalfa`, such as `kalfa records check`. Its first word is its **root
name**, such as `records`. Each package that has one exports a `subcommand` from its `./cli` entry.

This page covers what a package exports. How `kalfa` finds and runs it, and what it prints, comes with the command
itself.

## Export a subcommand

Write the command as an `effect/cli` command named by the root name, declare each code the package reports, and give
both to `Subcommand.make` with the Layer the command needs.

```ts
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
```

- `make` throws when the name is not a root name: lowercase words joined by single hyphens, starting with a letter. The
  rule is the one for the root of a diagnostic's code, so the two cannot drift.
- The Layer is given to the command inside `make`, so a subcommand cannot run without it. A command that needs a
  service that the Layer, `Diagnostics` and Node's platform do not give is a compile error, and the error names it.
- `kalfa` gives a subcommand Node's platform (`Subcommand.Platform`: file system, path, standard streams, terminal and
  child processes) and the `Diagnostics` service, and nothing else. Anything more goes in the Layer.
- `diagnostics` lists every code the package declared, so a command can print each code's long text on request.
- `Subcommand.isSubcommand` says whether a value is one that `make` built, even from another copy of this package.

## What to import

A package that reports imports `@kalfa/diagnostics`: it declares codes with `Diagnostic.make` and reports through
`Diagnostics.report`. Diagnostics' README says [how to write a message and a hint](../diagnostics/README.md), so an
agent can act on them.

A package that only gives a subcommand imports `@kalfa/cli` only for `Subcommand`. Nothing else in this package is
public.

What `kalfa` prints for a report is one line: `<place>: <severity> <code>: <message> Hint: <hint>`. It reads the
`package.json` in the folder it runs in and nowhere else, and it is the one place that decides the repo's root.
