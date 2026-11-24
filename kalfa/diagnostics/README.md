# @kalfa/diagnostics

What a diagnostic is, and how a package reports one. A diagnostic is one thing a package says about a place: a code,
a severity, a message, a place and a hint. It is written first for an agent to act on.

This package says what a diagnostic is and nothing about printing one. The command that provides the `Diagnostics`
service prints, and it picks the exit code. This package never prints, never logs and never picks an exit code, and
it imports no other package of its repo, so any of them can import it.

Three words to keep apart. A **declared code** (`Diagnostic.Declared`) is a code and its long text, made once with
`Diagnostic.make`. A **reported diagnostic** (`Diagnostic.Reported`) is one report: the code with a severity, a
message, a place and a hint. A **carried diagnostic** (`Diagnostic.Carried`) is a declared code and its fields that a
typed error holds, unchecked until it is reported.

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
  place: { _tag: "repo", path: ".config/settings.toml", line: 4 },
  hint: "Did you mean `service.port`?",
});
```

- **Severity** is `error` or `warning`. `error` fails the subcommand and `warning` is only advice. The caller gives it,
  so it may come from a setting.
- **Place** says what kind of place it is. See the next section.
- A blank message or hint, or a bad place, is a bug in the reporting code. The effect dies with a schema error that
  names the field, and nothing is reported.
- The service's own method takes only what `report` hands it, so a provider reads every field but no caller can skip
  `report`.

## Say where

A place is one of four kinds, told apart by `_tag`. An agent reads the tag and the fields. A person reads the text
form, which `Diagnostic.formatPlace` gives.

```ts
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";

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
```

- Lines and columns count from 1. A column needs a line. `.` takes no line.
- In a package whose lint refuses a `_tag` written by hand (`anti-slop-effect/no-manual-tagged-construction`, which
  the kalfa packages turn on), build each place with its kind's maker, `Diagnostic.Place.cases.<kind>.make`, as the
  example under "Carry it on an error" does. The maker checks the place as it builds it, and throws on a bad one.
- A repo path has no leading `/`, no `./` start, no `.` or `..` part, no empty part, no trailing `/` and no backslash.
  Its first part does not start with `~` or `$` and holds no `:`, so it never reads as a file outside the repo: not
  `~login`, not `$HOME`, not a drive such as `C:`, and not a scheme such as `file:`. A `:` deeper in the path is fine.
- A home path is `~/` or `$NAME/` and then good parts. `~` alone, `~login/...`, `${NAME}/...` and an absolute path are
  refused. `$NAME` is a name a shell can expand.
- An environment variable's name is a name a shell can expand. A flag is `-` and exactly one character, or `--` and a
  name. Its name holds no `=`, no space, no control character, no format character (such as a zero-width space) and no
  lone surrogate, so no value rides along in it and nothing hides in it.
- An environment variable and a flag take no line and no column. A line on one is refused, not dropped.
- A refusal says which rule failed and never repeats the path, since a path may hold a login name.
- The package reads no home folder and no environment. A place only names where: a reader's own shell expands `~` and
  `$NAME`.

## Carry it on an error

A typed error can say which diagnostic it is, so the command that runs it can report it without knowing the error.
The error holds a **carried diagnostic** (`Diagnostic.Carried`) under the key `diagnostic`: a declared code and the
fields beside it, made with `Diagnostic.carry`. A carried diagnostic is always an error: `carry` takes no severity.

```ts
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import * as Diagnostics from "@kalfa/diagnostics/Diagnostics";
import { Effect, Option, Schema } from "effect";

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
```

- `carry` checks nothing. A blank message or a bad place is caught when the handler reports it: `report` dies, as
  for any report. A package's own tests report each of its errors, so they catch it.
- `fromError` takes any value. It answers `Option.some` of what the value carries under `diagnostic`, whether the
  value holds the key or its class gives it, and `Option.none()` when it carries none. Only a value `carry` made
  counts. A getter that throws is not caught, and no `cause` is followed: an error that wraps another says itself
  which diagnostic it is.
- Reporting stays one way in: `report` checks the fields, and only it hands the service a value. This package picks
  no exit code; the command that runs the subcommand does.

## Hide a cause

A typed error may hold a cause that quotes a value, as a secret store's own client does when it reports what it read. Hold it as
`Hidden.Cause`: a `Redacted` in memory, which no rendering shows, and the fixed text `Hidden.placeholder` (`<redacted>`) in every
codec that writes outward.

Give the error a field `cause: Hidden.Cause` (or `Schema.optional(Hidden.Cause)`), import it with
`import * as Hidden from "@kalfa/diagnostics/Hidden"`, and make a cause with `Redacted.make(cause)`. Then
`Schema.toCodecJson` of the error writes `{ _tag: "StoreFailed", cause: "<redacted>" }`, whatever the cause was. The example in
`Hidden.Cause`'s doc block shows the whole class.

```ts
import * as Hidden from "@kalfa/diagnostics/Hidden";
import { Redacted, Schema } from "effect";

export class StoreFailed extends Schema.TaggedError<StoreFailed, { readonly brand: unique symbol }>()("StoreFailed", {
  cause: Hidden.Cause,
}) {}

// The cause is made with `Redacted.make`; `Schema.toCodecJson` of the error writes its `cause` as "<redacted>".
const failed = new StoreFailed({ cause: Redacted.make(new Error("bad value")) });
```

- **Why not `Schema.Redacted`.** In Effect 4.1.3 `Schema.toCodecJson` of a `Schema.Redacted` writes the value it holds, in full. So an
  error that crosses a socket would carry its cause. `Hidden.Cause` writes `<redacted>` there, whatever the cause was, and a label is
  not written either.
- **Read back.** A read of the JSON gives a hidden cause with nothing in it (`Redacted.value` is `undefined`): the value never left the
  process. A wire cause of any other text is refused.
- **In the process.** `Schema.toCodecIso` keeps the cause, so an optic does not lose it. Make a cause with `Redacted.make(cause)`, and
  read it on purpose with `Redacted.value(error.cause)`. A cause that is not a `Redacted` does not compile.
- **Optional.** `Schema.optional(Hidden.Cause)` leaves the key out when there is no cause.

## Test what was reported

`TestDiagnostics.layer` provides `Diagnostics` and collects every report in order, repeats too. Each build of the
layer starts empty.

```ts
import * as TestDiagnostics from "@kalfa/diagnostics/TestDiagnostics";
import { Effect } from "effect";

const program = found.pipe(Effect.andThen(TestDiagnostics.reported), Effect.provide(TestDiagnostics.layer));
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
