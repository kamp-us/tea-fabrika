# @kalfa/cli

The `kalfa` command, and the shape a package exports so `kalfa` can run it. This package is the one place that knows
what a subcommand is. A package that gives one imports `@kalfa/cli/Subcommand` and nothing else of this package.

A **subcommand** is one package's command under `kalfa`, such as `kalfa records check`. Its first word is its **root
name**, such as `records`. Each package that has one exports a `subcommand` from its `./cli` entry.

This page covers what a package exports, then how `kalfa` finds and runs it and what it prints.

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

## Run kalfa

`kalfa <root name> ...` runs one package's subcommand. The folder it runs in is the repo's root: `kalfa` reads the
`package.json` there and nowhere else, never a folder above it, and it hands that folder to every subcommand as its
`Path`'s starting point.

**How it finds a subcommand.** Each direct dependency of that `package.json` (`dependencies`, `devDependencies` and
`optionalDependencies`, each name once) whose own `package.json` has a `kalfa.cli` field gives one. The field is `"."` or
a `"./"` path inside the package, such as `"kalfa": { "cli": "./cli" }`, and that entry of the package's `exports` must
export `subcommand`. Nothing runs to find them: not a dependency's own dependencies, not `PATH`, no package's code.
A listed dependency that is not installed stops the start, unless it is optional. So does an entry that exports no
`subcommand`, and one whose `exports` give the path no `"default"` condition. Each stop names the package.

**How it runs one.** Every found subcommand is loaded on each run, all at once, so help lists them all. The one asked
for runs on Node's platform with its own Layer, and with the `Diagnostics` service that prints each report as it is made.

**What it prints.** Standard output holds only what a handler prints through `Console`, as it is, and the help or the
version a person asked for. Everything `kalfa` writes itself goes to standard error:

```text
docs/setup.md:12: error leak/key-shape: A line has the shape of a private key. Hint: Remove the key and rotate it.
```

That is the **readable line**: `<place>: <severity> <code>: <message> Hint: <hint>`, one for each report. A control,
format or surrogate character, U+2028, U+2029 and a backslash are written as JSON writes them (`\n`, `\u001b`, `\\`),
so a report is always one line and the escape can be undone. A run that could not finish ends with one more line,
`kalfa: <message>`, with no code, place or severity. The help of a bad invocation comes before it.

**Exit codes.** 0 when the handler finished and reported no error (warnings alone are 0, and so are `--help` and
`--version`). 1 when it finished and reported one or more errors, each already printed. 2 when it could not finish: a
refused start, a bad invocation, a failure or a defect in the handler, or Ctrl-C. Standard output and error are written
out before the process exits, so a pipe that reads them gets every byte even at exit code 1 or 2.

## One file

Yes for the program, no for the install. One bundled `bin.ts` runs by itself: built with `bundle: true` and Effect
bundled in, it is one 750 kB file whose only imports are Node's own modules, and `node <file> --help` and `--version`
work in a folder that has a `package.json` and no `node_modules`. A found subcommand also works beside the bundle's own
copy of Effect: in a scratch repo, `leak check` printed its line, its report and ended with exit code 1, though the
package imports its own copy of `effect`. What it cannot do is find a subcommand without an install: `kalfa` reads each
subcommand from the repo's `node_modules`, so `kalfa ci paths` has no `@kalfa/ci` to run until a package manager has
installed it. That is how `kalfa` finds packages, not a limit of the bundle.
