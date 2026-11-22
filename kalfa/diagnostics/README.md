# @kalfa/diagnostics

What a diagnostic is, and how a package reports one. A diagnostic is one thing a package says about a place: a code,
a severity, a message, a place and a hint. It is written first for an agent to act on.

This package says what a diagnostic is and nothing about printing one. The command that provides the `Diagnostics`
service prints, and it picks the exit code. This package never prints, never logs and never picks an exit code, and
it imports no other package of its repo, so any of them can import it.

Two words to keep apart. A **declared code** (`Diagnostic.Declared`) is a code and its long text, made once with
`Diagnostic.make`. A **reported diagnostic** (`Diagnostic.Reported`) is one report: the code with a severity, a
message, a place and a hint.

## Declare a code

Each package declares its codes once, with a long text in Markdown. A command can print that text on request, so a
message stays short.

```ts
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";

export const UnknownSetting = Diagnostic.make("config/unknown-setting", {
  explain: "A settings file names a setting that no app declares. Check the spelling against the settings reference.",
});
```

A code is a root name, one slash and a name, each in lowercase words joined by hyphens. The root is the name of the
subcommand that owns it. `make` throws when the code is malformed or the long text is blank, so a bad declaration
stops the import where it is written. The long text is kept exactly as given.

## Report through it

`report` takes only a declared code, never a plain string, and asks for the `Diagnostics` service.

```ts
import * as Diagnostics from "@kalfa/diagnostics/Diagnostics";

// Effect<void, never, Diagnostics.Diagnostics>
const found = Diagnostics.report(UnknownSetting, {
  severity: "error",
  message: "The setting `service.prot` is not declared.",
  place: { path: ".config/settings.toml", line: 4 },
  hint: "Did you mean `service.port`?",
});
```

- **Severity** is `error` or `warning`. `error` fails the subcommand and `warning` is only advice. The caller gives it,
  so it may come from a setting.
- **Place** is a path from the repo root, with a line and a column when known. The whole repo is `.`. Lines and
  columns count from 1. A column needs a line, and `.` takes no line.
- A blank message or hint, or a bad place, is a bug in the reporting code. The effect dies with a schema error that
  names the field, and nothing is reported.
- The service's own method takes only what `report` hands it, so a provider reads every field but no caller can skip
  `report`.

## Test what was reported

`TestDiagnostics.layer` provides `Diagnostics` and collects every report in order, repeats too. Each build of the
layer starts empty.

```ts
import * as TestDiagnostics from "@kalfa/diagnostics/TestDiagnostics";
import { Effect } from "effect";

const program = found.pipe(
  Effect.andThen(TestDiagnostics.reported),
  Effect.provide(TestDiagnostics.layer),
);
// [{ code: "config/unknown-setting", severity: "error", message: "...", place: { ... }, hint: "..." }]
```

`TestDiagnostics.reported` needs the test service in its type, so a read without the layer does not compile. The module
holds no helper that checks a message's wording: a test reads the fields it cares about.

## Write a message and a hint

- **The message** says what is so, as a fact. It never quotes text that must stay private, such as the value of a
  secret: it names the place and the kind of thing found.
- **The hint** says what to do next. Every diagnostic has one. When only a person can decide, the hint says so.

## What this package never does

- It never prints, and never logs: `Effect.log` prints by default, so a handler reports through `Diagnostics` and
  leaves the printing to the command.
- It never picks an exit code.
- It imports no other package of its repo. Lint and the layer and boundary rules hold this.
