Approved by the lead agent, builds 0088, 0084, 0063; body b07ba3440352
Plancheck-Version: 3

# Plan: a diagnostic's place says what kind of place it is (ticket 1929)

This is the kalfa package suite (`kalfa/diagnostics/`), new work. It is not today's frozen version and
not `next/`. The ticket is https://github.com/kamp-us/tea-fabrika/issues/1929, a GitHub issue, so the
pull request says `Closes #1929`. It builds decision 0088.

**This pull request changes a package that another pull request makes.** The branch
`fabrikalfa/kalfa-diagnostics-place` starts from the parent branch `fabrikalfa/kalfa-diagnostics-declare`
at its reviewed head (pull request https://github.com/kamp-us/tea-fabrika/pull/1921, ticket
https://github.com/kamp-us/tea-fabrika/issues/1917). Its pull request is stacked on that branch, and is
rebased onto main once the parent lands. Until then two things live only on main: decision 0088 itself
(`git show origin/main:.kalfa/decisions/0088-a-diagnostics-place-says-what-kind-of-place-it-is.md`) and
the new Place entry in `kalfa/diagnostics/GLOSSARY.md`. Both steps read 0088 from main. The glossary
entry arrives with the rebase; the two edits touch different lines, so git merges them on its own.

**Two calls under 80%, taken because the owner is away:**

1. **A flag's name keeps its dashes, as typed: `--instance.port`, `-f` (75%).** Configuration already
   stores a flag origin this way (`kalfa/config/src/Sources.ts:82`), and it is the only form that tells a
   short flag from a long one. The doubt: Effect's own CLI keeps a declared flag's name without dashes
   (`Flag.string("format")`, and `MissingOption` holds `api-key`), and adds `--` only when it prints.
   CLI's printer ticket or Configuration's error ticket would settle it. A change later is one rule, one
   text form and their laws, with no saved data.
2. **The one span gains one attribute, `kalfa.diagnostics.place.type`, holding only the kind (75%).**
   The design reference's "record wide, read later" asks for every measure that holds no secret, and the
   kind is one word out of four. The doubt: the ticket says "the place adds no span of its own", and a
   reader might read that as "adds nothing to the span". Dropping it is one line and one law cell.

```ts
// The whole idea, a sketch. A place says what kind of place it is, as data.
yield* Diagnostics.report(UnknownSetting, {
  severity: "error",
  message: "The setting `instance.prot` is not declared.",
  place: { _tag: "home", path: "~/.demo/demo.toml", line: 3, column: 1 },
  hint: "Did you mean `instance.port`?",
});

// The four kinds:
{ _tag: "repo", path: "docs/setup.md", line: 12 }          // a file in the repo; "." is the whole repo
{ _tag: "home", path: "$DEMO_HOME/demo.toml", line: 2 }    // a file under the home folder: ~/ or $NAME/
{ _tag: "environment", name: "DEMO_INSTANCE_PORT" }        // an environment variable, by name
{ _tag: "flag", name: "--instance.port" }                  // a command-line flag, by name

Diagnostic.formatPlace(place) // "~/.demo/demo.toml:3:1", "environment variable DEMO_INSTANCE_PORT", ...
```

## What changes, in one paragraph

`Diagnostic.Place` becomes a tagged union of four kinds, each an Effect Schema `TaggedStruct`. A file in
the repo keeps today's rules and gains one refusal: its first part may not start with `~` or `$`. A file
under the home folder starts with `~/` or `$NAME/` and then good parts. Both take a line and a column. An
environment variable and a flag take a name, and neither takes a line or a column. A new pure function,
`Diagnostic.formatPlace`, gives each kind's plain-text form, which CLI prints. The package still reads no
home folder and no environment, imports no kalfa package and no Node module, and adds no span. `report`,
the service, `TestDiagnostics` and the lint rows do not change, except the span's one attribute (call 2
above). Nothing calls the package yet (`rg -l "@kalfa/diagnostics"` finds only the package itself, the root
manifest and decision 0084), so no caller moves.

## Searched first

- Ticket 1929 whole, its parent https://github.com/kamp-us/tea-fabrika/issues/1890 and its one comment,
  the owner's answers at https://github.com/kamp-us/tea-fabrika/issues/1751#issuecomment-7083852422, and
  the sibling ticket https://github.com/kamp-us/tea-fabrika/issues/1918 with its three comments. The last
  one (2026-11-22) decides that an error carries its declared code and its fields unchecked, and the
  handler calls `Diagnostics.report`. This plan leaves that work to 1918: it only changes what the
  `place` field holds, which 1918's carried fields then use as they are.
- Decisions 0088 (from main), 0084 and 0063, whole. `kalfa/diagnostics/GLOSSARY.md` on this branch and on
  main. The parent's approved plan with its amendment, `.kalfa/quests/kalfa-diagnostics-declare-PLAN.md`,
  and every file it built under `kalfa/diagnostics/`.
- Configuration's plan for https://github.com/kamp-us/tea-fabrika/issues/1839, read only from its own
  worktree. It names the user configuration `~/.<app>/<app>.toml`, or `$<APP>_HOME/<app>.toml` when that
  variable is set, and an environment variable as `DEMO_INSTANCE_PORT`. Today's Configuration code:
  `kalfa/config/src/Sources.ts` (an origin names a flag `--instance.port`), `kalfa/config/src/Snapshot.ts`
  (`declaredOrigin`, which already accepts `~/...` and `$<APP>_HOME/...` file origins) and
  `kalfa/config/GLOSSARY.md` (Flag, Environment variable, User configuration, Origin).
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks` and each kalfa
  glossary for "home folder|home directory", "environment variable", "login name|absolute path", "flag
  name" and "place". Only 0088 settles a place; Configuration's glossary settles the words flag,
  environment variable and origin in its own context.
- Effect 4.1.3 with its patch, the lockfile's version, in `node_modules/effect`: `Schema.TaggedStruct`,
  `Schema.Union`, `Schema.toTaggedUnion` (with `match`, `cases` and `guards`), `Schema.optionalKey`,
  `Schema.Never`, `Schema.makeFilter`, and the `ParseOptions` notes in `dist/SchemaAST.d.ts`:
  `onExcessProperty` defaults to `"ignore"` and a schema annotation cannot change it, and `reportInput`
  is off by default, so a SchemaError holds no rejected input unless a check's own message puts it there.
  `effect/cli` (`src/cli/Flag.ts`, `src/cli/CliError.ts`, `src/cli/internal/lexer.ts`) for how a flag is
  named and written.
- The lint rows the parent made: the `kalfa/diagnostics/src/**` override in `.oxlintrc.json` (lines 3914
  to 4062 at this head), the `kalfa-diagnostics` rows in `layer-rules.json` and `boundary-rules.json`.

## How others do it

- **Cargo** records where a config value came from as one of three kinds: a path, an environment variable
  or a command-line option (`Definition::Path`, `Environment`, `Cli` in
  https://github.com/rust-lang/cargo/blob/master/crates/cargo-util-config/src/definition.rs, cited by
  0088). Its messages read "environment variable `CARGO_X`" and "--config cli option". That is the
  four-kind shape here and the text form for the two named kinds. From 0088's citation and memory; not
  fetched for this plan.
- **git** `config --show-origin` prints an origin type and a value: `file:<path>`, `command line:`,
  `standard input:` (https://git-scm.com/docs/git-config, cited by 0088). From memory.
- **SARIF 2.1.0** keeps paths relative to a named base (`uriBaseId`, such as `%SRCROOT%`) so a log names no
  machine, and says why absolute paths stay out. `$NAME/...` is the same idea, with the base named by a
  shell variable. From memory, not fetched.
- **POSIX shell**: a tilde-prefix `~/` expands to the home folder, and `~login/` to that login's home. A
  name (XBD 3.235) is underscores, digits and letters of the portable set, not starting with a digit, and
  only such a name expands as `$NAME`. That is this plan's rule for `$NAME` and for an environment
  variable's name, and the reason a repo path may not start with `~`. From memory, not fetched.
- **GNU Coding Standards**, "Formatting Error Messages": `file:line:column: message`. That is the text form
  of the two file kinds. From memory.
- **Elm and Erlang/OTP**: Elm's compiler report holds a region in a named file; Erlang's compiler returns
  `{Location, Module, Descriptor}` per file and formats it in a separate call. Both keep where as data and
  format it apart, as `formatPlace` does beside the Schema. Neither has places outside files. From memory.
- **Effect**: a tagged union of `TaggedStruct`s with `toTaggedUnion("_tag")` and its `match`, as the
  installed `Schema.d.ts` examples show.

## The shape

```ts
// kalfa/diagnostics/src/Diagnostic.ts, a sketch. Doc blocks left out; unchanged parts shown as "...".
import { Schema } from "effect";

// ... Code, Severity, Said, Reported, Declared and make, unchanged.

// A name a shell can expand as $NAME: a letter or underscore, then letters, digits and underscores.
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// A flag as written on a command line: one or two hyphens, then a name that does not start with a hyphen
// and holds no whitespace, no "=" and no control character. So no value rides along in it.
const FLAG = /^--?[^\s=\p{Cc}-][^\s=\p{Cc}]*$/u;

// A part of a path is not empty, ".", or "..", and holds no backslash. Unchanged.
const isSegment = (segment: string): boolean => ...;

// A path from the repo root: "." for the whole repo, else good parts joined by "/". Its first part does
// not start with "~" or "$", so it never reads as a file under the home folder.
const isRepoPath = (path: string): boolean =>
  path === "." || (!/^[~$]/.test(path) && path.split("/").every(isSegment));

// A path under the home folder: "~" or "$NAME", then one or more good parts. So never absolute, and never
// "~login", which names a login.
const isHomePath = (path: string): boolean => {
  const [start = "", ...parts] = path.split("/");
  const named = start === "~" || (start.startsWith("$") && NAME.test(start.slice(1)));
  return named && parts.length > 0 && parts.every(isSegment);
};

// Each refusal's message names the rule, never the input: a refused home path may hold a login name.
const RepoPath = Schema.String.check(Schema.makeFilter((p: string) => isRepoPath(p) || "Expected a path from the repo root, or `.` for the whole repo"));
const HomePath = Schema.String.check(Schema.makeFilter((p: string) => isHomePath(p) || "Expected a path that starts with `~/` or `$NAME/`"));
const VariableName = Schema.String.check(Schema.makeFilter((n: string) => NAME.test(n) || "Expected an environment variable's name"));
const FlagName = Schema.String.check(Schema.makeFilter((n: string) => FLAG.test(n) || "Expected a flag as written, such as `--name` or `-n`"));

const Count = ...; // unchanged: an integer from 1
const columnNeedsLine = Schema.makeFilter(...); // unchanged rule, now shared by two kinds
const wholeRepoHasNoLine = Schema.makeFilter(...); // unchanged rule, repo kind only

const Repo = Schema.TaggedStruct("repo", {
  path: RepoPath, line: Schema.optionalKey(Count), column: Schema.optionalKey(Count),
}).check(columnNeedsLine, wholeRepoHasNoLine);

const Home = Schema.TaggedStruct("home", {
  path: HomePath, line: Schema.optionalKey(Count), column: Schema.optionalKey(Count),
}).check(columnNeedsLine);

// No line and no column: the key may be left out, and a value for it is refused, at run time and in the
// type. A plain Struct would drop the key silently instead.
const Environment = Schema.TaggedStruct("environment", {
  name: VariableName, line: Schema.optionalKey(Schema.Never), column: Schema.optionalKey(Schema.Never),
});
const Flag = Schema.TaggedStruct("flag", {
  name: FlagName, line: Schema.optionalKey(Schema.Never), column: Schema.optionalKey(Schema.Never),
});

export const Place = Schema.Union([Repo, Home, Environment, Flag]).pipe(Schema.toTaggedUnion("_tag"));
export type Place = typeof Place.Type;

// The plain-text form a person reads. Pure: it reads nothing, prints nothing and runs no Effect.
const fileText = ({ path, line, column }: { path: string; line?: number; column?: number }): string =>
  [path, line, column].filter((part) => part !== undefined).join(":");

export const formatPlace = (place: Place): string =>
  Place.match(place, {
    repo: fileText,
    home: fileText,
    environment: ({ name }) => `environment variable ${name}`,
    flag: ({ name }) => `flag ${name}`,
  });
```

```ts
// kalfa/diagnostics/src/Diagnostics.ts, the one changed line in `report` (call 2 at the top).
yield* Effect.annotateCurrentSpan({
  "kalfa.diagnostics.code": reported.code,
  "kalfa.diagnostics.severity": reported.severity,
  "kalfa.diagnostics.place.type": reported.place._tag, // "repo", "home", "environment" or "flag"; never a path or name
});
```

`Diagnostics.Fields` is `Omit<typeof Diagnostic.Reported.Encoded, "code">`, so it follows the union with no
edit: a caller writes `_tag`, and an environment place with `line: 3` does not compile (`number` is not
`never`). `TestDiagnostics.ts` does not change. The package's exports do not change: `Place` and
`formatPlace` both live in `./Diagnostic`, so the package's manifest and law D11 stay as they are.

### Why each rule (calls)

- **The four tags are `repo`, `home`, `environment` and `flag`, and the keys `path`, `line`, `column` and
  `name`, 85%.** Each tag is the glossary's own phrase cut to one word ("a file in the repo", "a file under
  the home folder", "an environment variable", "a command-line flag"); `environment` is Cargo's word.
  `{ _tag: "environment", name: "DEMO_INSTANCE_PORT" }` reads as a sentence. Not `env`: Configuration's
  glossary lists it under _Avoid_.
- **A repo path's first part may not start with `~` at all, not only be `~`, 80%.** Decision 0088 refuses a
  first part that is `~` or starts with `$`. A shell reads `~someone/x` as that login's home, so a repo
  path `~someone/.demo/demo.toml` would print a login name and pass as a home file, which 0088 refuses the
  `~` case for. This refuses more than 0088 names and contradicts nothing in it. A part that starts with
  `~` or `$` deeper in the path stays good: `docs/~/x` and `a/$HOME/b` are folders in the repo.
- **A home path needs one part after its start, 85%.** The ticket says "with good parts after it", and a
  place is a file: `~` alone and `$DEMO_HOME` alone are refused, though Configuration's snapshot accepts
  them as file origins (Findings, 3).
- **`$NAME` and an environment variable's name follow the shell's name rule, 85%.** 0088 says a reader's
  shell expands `$NAME`, and only a shell name expands. Lowercase is allowed (`$xdg_config_home`), since
  the shell allows it. The brace form `${NAME}/` is refused: it adds nothing a person needs, and loosening
  later breaks no saved data.
- **A flag holds no `=`, no whitespace and no control character, 85%.** With `=` refused, a value such as
  `--token=...` can never ride into a place. A control character could rewrite a terminal when CLI prints
  the place. A name past U+024F, such as `--设置`, is allowed: nothing here reads the words.
- **A line or column on an environment variable or a flag is refused, not dropped, 80%.** With a plain
  `Struct`, Effect drops an unknown key by default, so a caller's line would vanish with no word. Declaring
  the key as `optionalKey(Never)` refuses it in the Schema itself, wherever the place is decoded, and in
  the type. The other way, decoding in `report` with `onExcessProperty: "error"`, holds only inside
  `report` and also refuses every other stray key, a wider change than the ticket asks.
- **The text forms, 80%.** The two file kinds print `path`, `path:line` or `path:line:column`, as GNU's
  format and the parent's README do; the whole repo prints `.`. The two named kinds print a word first,
  as Cargo does: `environment variable DEMO_INSTANCE_PORT`, `flag --instance.port`. A home place prints its
  `~/` or `$NAME/` start as given, so no login name is printed. The text is for a person; an agent reads
  `_tag`. A repo path may hold spaces, so `environment variable X` is also a legal repo path's text; the
  data still tells them apart (What this cannot tell us).
- **`formatPlace` is a pure function in `Diagnostic.ts`, with no span, 85%.** The ticket gives the package
  a text form and keeps printing CLI's. Decision 0063 traces each step; a pure string function is no step
  that does work, and a span would need it to become an Effect. The name is a verb, as Effect's
  `DateTime.format` and `Duration.format`.
- **Is any of this a setting? No.** The kinds, their rules and their text are the protocol every package
  that reports and the printing command read alike; a setting would split them.

### What lint holds, and what does not change

The `kalfa/diagnostics/src/**` override in `.oxlintrc.json` stays as the parent made it: no kalfa or repo
package, no Node module in either spelling, no printing or exit-code module, and none of the globals
`console`, `process`, `globalThis`, `global`, `self` or `window`. That is what "the package reads neither
the home folder nor the environment" rests on, with type law D25 for the two new parts. The one way
around it that lint does not see, Effect's own `Config`, is a finding, not part of this plan (Findings, 1).

No `layer-rules.json` row changes, so `oxlint-plugins/layers.test.ts`, which pins every row, does not
change either. `boundary-rules.json` does not change.

## One value traced: a home file, then the same path as a repo file, then an absolute path

1. A handler runs `Diagnostics.report(UnknownSetting, { severity: "error", message, place: { _tag: "home",
   path: "~/.demo/demo.toml", line: 3, column: 1 }, hint })`.
2. `report` decodes `{ ...fields, code }` with `Reported`. The union reads `_tag: "home"` and uses `Home`.
   `isHomePath` splits the path into `~`, `.demo` and `demo.toml`: the start is `~`, there are two parts
   after it, and each is a good part. Line 3 and column 1 are counts from 1, and the column has its line.
   It passes.
3. The span `diagnostics.report` gets `kalfa.diagnostics.code` = `config/unknown-setting`,
   `kalfa.diagnostics.severity` = `error` and `kalfa.diagnostics.place.type` = `home`. No path, no message
   and no hint.
4. Under `TestDiagnostics.layer`, the service appends the value. `TestDiagnostics.reported` answers one
   value whose `place` is `{ _tag: "home", path: "~/.demo/demo.toml", line: 3, column: 1 }`: line and column
   kept, as for a repo file.
5. `Diagnostic.formatPlace(place)` answers `~/.demo/demo.toml:3:1`.
6. The same report with `place: { _tag: "repo", path: "~/.demo/demo.toml", line: 3 }`: `isRepoPath` sees a
   first part starting with `~` and refuses. `report` dies with the SchemaError, and the Ref is not touched.
7. The same report with a home place whose path is absolute: the Linux home root, then `someone`, then
   `.demo/demo.toml`. Split on `/`, its start is the empty string, so `isHomePath` refuses. The SchemaError's message says "Expected a path that starts with
   `~/` or `$NAME/`" and holds no part of the path, so `someone` is in no output.
8. `{ _tag: "environment", name: "DEMO_INSTANCE_PORT", line: 2 }` does not compile. Decoded from unknown
   input, it is refused on `line`. Without the line it passes and prints
   `environment variable DEMO_INSTANCE_PORT`.

## What fact is lost if not recorded now

None is lost by this plan. The fact the ticket keeps is the kind of place and, for a file outside the
repo, its file and line; without this change a settings error about the user configuration could only say
`.` and put the file and line in its message. Nothing has been reported yet, so no old record lacks the
kind. The package still stores nothing.

## Laws

Laws use `it.prop` and `it.effect.prop` from `@effect/vitest` 4.1.3, with inputs from Effect's own
`Arbitrary`, built in `kalfa/diagnostics/src/Diagnostic.test-support.ts`, as the parent's laws are. As in
the parent's amendment, a generator's reach is part of its law: where a row names classes of input, each
run takes its drawn value and also checks one made from it for each class, so every class is in every
run, and each class has a plant that a generator missing that class would let pass. Every law runs in
memory on every pull request.

The classes the shared generators draw, named once here and used in the rows:

- **Repo paths (good):** the parent's groups (a) a part starting with a dot but not `.` or `..`, (b) a
  space at a part's start, inside and end, (c) ASCII punctuation, `é`, a character past U+024F such as
  `设`, and one outside the Basic Multilingual Plane; and new (d) the whole repo `.`, (e) a deeper part
  that is `~`, starts with `~`, is `$` or is `$HOME`, (f) a path of more than 200 characters. The drawn
  first part never starts with `~` or `$` (today's segment pattern can draw `~` alone, so it changes).
- **Home paths (good):** (g) the `~/` start and (h) the `$NAME/` start, with names that (i) mix capitals,
  digits and underscores (`DEMO_HOME2`), (j) start with an underscore (`_X`), (k) are lowercase
  (`xdg_config_home`), (l) are more than 200 characters; the parts after the start reach the repo groups
  (a), (b), (c), (e) and (f), and include a first part after the start that is itself `~` or starts with `$`.
- **Environment variable names (good):** (i) to (l) above, and a one-character name (`X`, `_`).
- **Flag names (good):** (m) `--` with a long name (`--instance.port`, `--a-b`, `--a_b`, `--2fa`, `--Port`),
  (n) `-` with one character (`-f`, `-1`), (o) a name past U+024F (`--设置`) and outside the Basic
  Multilingual Plane, (p) more than 200 characters.
- **Logins:** generated login names (lowercase letters, digits, `.`, `_`, `-`, and one more than 32
  characters), each put into every home root a machine uses: the macOS folder `Users` and the Linux
  folders `home` and `var/home` at the root, each followed by the login; the Windows drive form `C:`,
  then `Users`, then the login, with either slash; a network share `\\server\<login>`; and `~<login>`.
  Each has `/.demo/demo.toml` after it. The support file builds each root from pieces joined at run time,
  as `Package.test.ts` does with its forbidden words, so no file holds a whole machine path and the
  repo's leak check passes it.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| D2, a file in the repo: for generated repo paths of every repo class (a) to (f), with no line, a line, or a line and a column, `Place` accepts `{ _tag: "repo", ... }`; it refuses each of the parent's breaks (an empty path, a leading `/`, a `./` start, a `..`, `.` or empty part, a trailing `/`, a backslash, a line or column of 0, negative or a fraction, a column with no line, a line on `.`) and each new one: a first part that is `~`, is `~` plus a login, is `$`, or is `$` plus a name (`$HOME/x`, `$1/x`). 200 runs | test | Effect Arbitrary: repoParts | drop the first-part rule: `~/x` is accepted, red; refuse only a first part that is exactly `~`: `~someone/x` is accepted, red; refuse `~` and `$` anywhere: class (e) is refused, red; plus the parent's plants for groups (a) to (c); refuse more than 64 characters: class (f) is refused, red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D18, a file under the home folder: for generated home paths of every home class (g) to (l), with no line, a line, or a line and a column, `Place` accepts `{ _tag: "home", ... }`; it refuses `~` alone, `~/` alone, `$NAME` alone, `$NAME/` alone, `.`, an absolute path, `~someone/x`, `${NAME}/x`, `$/x`, `$1X/x`, a name holding `-`, `.`, a space, `é` or `设`, an empty, `.` or `..` part after the start, a trailing `/`, a backslash, `C:/x`, and the bad line and column cases of D2. 200 runs | test | Effect Arbitrary: homeParts | accept only `~/`: class (h) is refused, red; accept only capital names: class (k) is refused, red; refuse a name with digits: class (i) is refused, red; accept `$` plus any characters up to `/`: the `$NA-ME/x` break passes, red; accept `~` with no part after it: red; drop the column-needs-line check on `Home`: red; refuse a part past U+024F: red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D19, an environment variable: for generated names of every environment class, `Place` accepts `{ _tag: "environment", name }`; it refuses an empty name, a name starting with a digit, a name holding `-`, `.`, a space, `=`, `$`, `/`, `é` or `设`, a `$` in front (`$DEMO_PORT`), and any line or column, given alone or both. 200 runs | test | Effect Arbitrary: variableName | accept only capitals: class (k) is refused, red; refuse more than 32 characters: class (l) is refused, red; declare `line` as `optionalKey(Count)`: a line is accepted, red; use a plain `Struct` with no `line` key: the line is dropped and the place accepted, red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D20, a command-line flag: for generated names of every flag class (m) to (p), `Place` accepts `{ _tag: "flag", name }`; it refuses an empty name, `-`, `--`, `---x`, a name with no leading hyphen, one holding a space, a tab, a line break, U+00A0, U+3000, `=` (`--token=x`), ESC (U+001B), DEL or a C1 control character, and any line or column. 200 runs | test | Effect Arbitrary: flagName | accept only `--`: class (n) is refused, red; accept only ASCII: class (o) is refused, red; allow `=`: `--token=x` is accepted, red; check whitespace with `/ /` only: a tab is accepted, red; refuse more than 64 characters: class (p) is refused, red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D21, the kind is data: a place with no `_tag` (the parent's old `{ path }` shape), an unknown `_tag` such as `file`, and each kind's tag with another kind's fields (`{ _tag: "environment", path }`, `{ _tag: "home", name }`) are refused; for a generated good place of every kind, encoding then decoding gives the same value, line and column kept on both file kinds. 200 runs | test | Effect Arbitrary: anyPlace | make `_tag` optional on `Repo` with `repo` as its default: the old shape is accepted, red; drop `column` when encoding a home place: red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D22, the text form: for a generated good place of every kind and class, `formatPlace` answers exactly: for both file kinds the path, then `:line` when there is a line, then `:column` when there is a column; for the whole repo `.`; `environment variable <name>`; `flag <name>`. 200 runs | test | Effect Arbitrary: anyPlace | leave out the column: red; print the environment name bare: red; print a flag without the word `flag`: red; trim the path: class (b) is changed, red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D23 [secrets], no login name in any output: for generated logins in every home root, `{ _tag: "home", path }` and `{ _tag: "repo", path }` are both refused, and the outputs are read for the login: the SchemaError's message from `Schema.decodeUnknownExit(Place)`, the defect `report` dies with (its message and its `JSON.stringify`), `TestDiagnostics.reported` (empty) and the span's attributes. For every good home place, `formatPlace` and the encoded place start with exactly the drawn `~/` or `$NAME/`. 100 runs | test | Effect Arbitrary: login | accept an absolute home path: red; write the path into `HomePath`'s refusal message: red; decode in `report` with `reportInput: true`: the defect's message holds the path, red; print a home place with its start cut off: red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D3, a reported diagnostic, widened: as in the parent, with its good place drawn from every kind and every class above, not only repo paths. 200 runs | test | Effect Arbitrary: goodReported | each plant of D2, D18, D19 and D20 that refuses a good class also turns D3 red; the parent's plants stay | kalfa/diagnostics/src/Diagnostic.test.ts |
| D5, report collects in order, widened: as in the parent, and each run also reports one item per place kind and class; `TestDiagnostics.reported` gives them back equal, a home place's line and column kept. 100 runs | test | Effect Arbitrary: items | drop `line` from a home place in the test Layer's append: red; each good-class plant of D2, D18, D19 and D20: that report dies, red | kalfa/diagnostics/src/Diagnostics.test.ts |
| D6, bad fields die and report nothing, widened: the bad place is drawn from the breaks of all four kinds, D21's refused shapes and D23's absolute paths. 100 runs | test | Effect Arbitrary: withABadOne | drop the first-part rule from `isRepoPath`: a `~/x` repo place is collected, red; the parent's plants stay | kalfa/diagnostics/src/Diagnostics.test.ts |
| D17 [secrets], the span, widened: for a generated report of every place kind, `report` ends one span named `diagnostics.report`; its attributes are exactly `kalfa.diagnostics.code`, `kalfa.diagnostics.severity` and `kalfa.diagnostics.place.type`, the last equal to the place's `_tag`; no attribute value is the message, the hint, the place's path or name, or `formatPlace`'s text. 100 runs | test | Effect Arbitrary: goodFields | add `kalfa.diagnostics.place` with `formatPlace`'s text: red; put the path in `kalfa.diagnostics.place.type`: red; leave out `kalfa.diagnostics.place.type`: red; the parent's plants stay | kalfa/diagnostics/src/Diagnostics.test.ts |
| D8, report's type, widened: a place with no `_tag` does not compile; `{ _tag: "environment", name, line: 1 }` and `{ _tag: "flag", name, column: 1 }` do not compile; `{ _tag: "home", path, line: 1, column: 1 }` compiles; `Fields["place"]["_tag"]` is `"repo" \| "home" \| "environment" \| "flag"` | type | type | declare `line` on `Environment` as `optionalKey(Count)`: its `@ts-expect-error` is unused, red | kalfa/diagnostics/src/Diagnostics.types.test.ts |
| D25, the place reads nothing: `typeof Diagnostic.Place.DecodingServices` and `EncodingServices` are `never`, and `Diagnostic.formatPlace` is `(place: Diagnostic.Place) => string`, so neither can ask for a service, read `Config` or run an Effect | type | type | make `formatPlace` an Effect that reads `Config.string("HOME")`: red | kalfa/diagnostics/src/Diagnostics.types.test.ts |
| D24, the README shows each kind: `kalfa/diagnostics/README.md` holds a code example with each of `_tag: "repo"`, `_tag: "home"` (once with `~/`, once with `$NAME/`), `_tag: "environment"` and `_tag: "flag"`, and the text form of each | test | scenario: the package's own README at head | delete the flag example: red | kalfa/diagnostics/src/Package.test.ts |

D1, D4, D7, D9 to D16 do not change. D10 to D12 still hold: `TestDiagnostics`' exports, the manifest
and the words the package may not name are untouched. The README's new examples use `demo`, never a word
D12 forbids, such as the repo's own records folder.

No law needs launchd, the real Electron app, a real OS process or socket, or a real signal, so none is
host-only and none waits on the owner's Mac. No law is a `*.integration.test.ts` file.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/diagnostics/src/Diagnostic.ts | build | 80 | `Place` becomes the four-kind union; `isRepoPath` gains the first-part rule; new `isHomePath`, `NAME`, `FLAG`, the four case schemas and `formatPlace`; refusal messages that name no input; doc blocks for `Place` and `formatPlace`, each with an example of every kind |
| kalfa/diagnostics/src/Diagnostics.ts | build | 3 | the span gains `kalfa.diagnostics.place.type`; the doc example's place gains `_tag: "repo"` |
| kalfa/diagnostics/README.md | build | docs | the Place bullet becomes a short section: the four kinds, one example of each (home twice), the text forms, the refused forms, and that the package reads no home folder and no environment; every existing example's place gains `_tag: "repo"` |
| kalfa/diagnostics/src/TestDiagnostics.ts | build | 0 | no change |
| kalfa/diagnostics/GLOSSARY.md | build | docs | no change on this branch: the Place entry decision 0088 wrote arrives from main with the rebase, and this plan coins no domain word |
| kalfa/diagnostics/package.json | tests | tests | no change: no new export path |
| kalfa/diagnostics/src/Diagnostic.test-support.ts | tests | tests | the classes above: repo parts whose first part never starts with `~` or `$`, home parts, variable names, flag names, logins and home roots, the breaks of each kind, and `anyPlace`, which `goodFields` and `brokenPlace` now draw from |
| kalfa/diagnostics/src/Diagnostic.test.ts | tests | tests | D2 rewritten; D18 to D23 new; D3 widened |
| kalfa/diagnostics/src/Diagnostics.test.ts | tests | tests | D5, D6 and D17 widened; the bad place set of D6 grows |
| kalfa/diagnostics/src/Diagnostics.types.test.ts | tests | tests | D8 widened; D25 new; the places in D8 and D16 gain `_tag: "repo"`, so D16's lines still fail only for the brand |
| kalfa/diagnostics/src/Package.test.ts | tests | tests | D24 new |
| .oxlintrc.json | tests | tests | no change: the parent's override holds the package's imports and globals |
| layer-rules.json | tests | tests | no change: no new row |
| oxlint-plugins/layers.test.ts | tests | tests | no change, since no `layer-rules.json` row changes |
| boundary-rules.json | tests | tests | no change |

## Existing tools

- `Place`, the union in `kalfa/diagnostics/src/Diagnostic.ts`: searched Effect 4.1.3's Schema for a tagged
  union; `Schema.TaggedStruct`, `Schema.Union` and `Schema.toTaggedUnion` are used as they are, and
  `match` from `toTaggedUnion` writes `formatPlace` with every kind checked by the compiler.
- `formatPlace` in `kalfa/diagnostics/src/Diagnostic.ts`: searched Effect (`Inspectable`, `Formatter`,
  `SchemaIssue`'s formatters, which format issues, not places) and `kalfa/config/src/Print.ts` (which
  prints a whole settings list and lives in a package this one may not import). None gives a place's
  text, so it is new, written over `match`.
- `isHomePath` in `kalfa/diagnostics/src/Diagnostic.ts`: searched the repo for `startsWith("~"` and home
  path checks; found `declaredOrigin` in `kalfa/config/src/Snapshot.ts`, which ties the `$` start to one
  app's home variable, accepts `~` alone, and sits in Configuration, which this package ranks below. It
  reuses the package's own `isSegment` for the parts.
- `NAME` and `FLAG` in `kalfa/diagnostics/src/Diagnostic.ts`: searched the repo for an environment name
  pattern (found only test generators in `next/` and today's packages, each a fast-check
  `stringMatching` of the same shape, none exported) and `effect/cli` for a flag name
  check (its lexer splits on `--` and `=`, and exports no check). Both are one pattern each, kept beside
  the Schema that uses them.
- The generators in `kalfa/diagnostics/src/Diagnostic.test-support.ts`: built from its own `pattern`,
  `between`, `pick` and `Break`, as the parent's are.

## Validation

- tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3 kalfa/diagnostics` shows D2 and D18 to D24
  red on the missing kinds and `formatPlace`, and D3, D5, D6 and D17 red on the widened generators. Each
  class's plant is tried by hand in `Diagnostic.ts`, seen red, and undone. No install: no package or
  lockfile changes.
- build step: the same vitest path green, then `pnpm format` and `pnpm lint`.
- The lead runs `pnpm typecheck`, which holds D8, D16 and D25, and the `--changed` run.
- After the parent lands: rebase onto main, and the same vitest path again. The glossary's Place entry is
  then main's.

## Size

1. One slice, the place: about 83 product lines (`Diagnostic.ts` 80, `Diagnostics.ts` 3), plus the laws,
   the README section and the generator classes. It lands whole: a package can report a file in the repo,
   a file under the home folder, an environment variable or a flag, and CLI can print each.

About 2 agent hours across the steps, 80% sure. The steps are tests, build and one review, plus one likely
send-back, most likely on a generator class. The parent measured about $5 a step at list price for a
package of this size.

Estimate: 4 steps, $20

## New names

- `repo`, `home`, `environment`, `flag`: the four `_tag` values. They are code names for the kinds the
  glossary's Place entry already defines in words, so the glossary gains no term. `home` here is any file
  under the home folder, not Configuration's user configuration, whose _Avoid_ list holds "home file" in
  that other context.
- `name`: the key for an environment variable's or a flag's name, the glossary's own word.
- `Diagnostic.formatPlace`: a place's plain-text form.
- `kalfa.diagnostics.place.type`: the span attribute, in decision 0063's form; `type` as OpenTelemetry's
  `error.type` uses it, for a class of thing.

## Records

- No new decision: 0088 holds the ruling. The two calls under 80% at the top are the lead's to keep or
  drop; neither needs a decision file.
- The glossary's Place entry is main's, from the pull request that recorded 0088. No new term.
- `field/runs/` rows for each step, by the lead.

## What this cannot tell us

- Whether Configuration can build each kind from its `SettingsError` without parsing text. 0088 says it
  must carry where as data; that is Configuration's error ticket.
- Whether CLI's printer wants exactly these text forms. CLI is not built.
- Whether a flag should be named with its dashes (call 1).
- A repo path may hold spaces, so a repo place's text can match an environment or flag place's text, such
  as a folder named `flag --x`. The data tells them apart; the text alone does not.
- The text form escapes nothing. A part of a path may hold a control character (Findings, 2).
- A home path's parts may still hold a login name a caller chose, such as `~/someone/notes.md`. The package
  refuses an absolute path and `~login`; it cannot know what the words after the start mean.
- Whether 0088's "first part is `~`" was meant to allow `~someone/` as a repo path. This plan refuses it
  (80%).

## Open questions

None.

The two calls under 80% are at the top, each with what would settle it.

## Findings

1. **The package's lint override does not refuse Effect's `Config` or `ConfigProvider`.** The
   `kalfa/diagnostics/src/**` override in `.oxlintrc.json` (lines 3914 to 4062 at this head) refuses Node
   modules, printing and exit-code modules and the global objects, and no entry names `Config` or
   `ConfigProvider` (`rg -n '"Config"|ConfigProvider' .oxlintrc.json` hits only other blocks). So a later
   edit could read `HOME` through `Config.string("HOME")` inside an Effect with no lint finding. This plan
   holds the two new parts with type law D25 and leaves the lint rows as the parent made them, as the brief
   asks. A row for `Config` and `ConfigProvider` from `effect`, and their subpaths, is its own small ticket.
2. **A repo or home path part may hold control characters, so a printed place can carry terminal escapes.**
   `isSegment` (`kalfa/diagnostics/src/Diagnostic.ts:44`) refuses only empty, `.`, `..` and a backslash, by
   the parent's D2, which says a part may be any characters but `/` and `\`. A part holding ESC prints as
   an escape sequence. CLI's printer should escape control characters in every place it prints, or this
   package should refuse them; which one is CLI's ticket or the lead's call.
3. **Configuration's snapshot accepts `~` and `$<APP>_HOME` alone as file origins.** `declaredOrigin` in
   `kalfa/config/src/Snapshot.ts:84-95` accepts `file === "~"` and `file === home`. A home place needs a
   part after the start, so if Configuration ever names an origin that way, its error ticket must name the
   file, not the folder. No action here.

## Amendment 1 (2026-11-22): a drive letter is not a repo path's first part

The tests step found that `isRepoPath` above accepts a Windows drive path written with forward slashes: `C:`, then
`Users`, then a login, then `.demo/demo.toml`, since `C:` is a good part. That path is absolute and names a login,
which decision 0088 refuses. This amendment wins over the sections above where they differ.

- `isRepoPath` also refuses a first part that is one ASCII letter followed by `:` (`C:`, `c:`). A deeper part such as
  `docs/C:/x` stays good, as `~` and `$` do. `isHomePath` already refuses it, since its start is neither `~` nor `$NAME`.
- **D2** gains the break: a first part `C:` and `z:`. Plant: drop the drive rule, so the drive root, then `Users`, then a
  generated login is accepted as a repo place, red. The support file builds it from pieces, as for D23.
- **D23** refuses the drive root with forward slashes as a repo place too, in every run, not only as a home place.
- **D6** draws the drive break among the bad places.
- The plan's call stays at 80%: a repo folder named `C:` at the root is refused. No real repo needs one.

