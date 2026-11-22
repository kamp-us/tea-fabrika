Approved by the lead agent, builds 0087, 0047, 0049, 0063, 0084; body 8b2a1b3c437e
Plancheck-Version: 3

# Plan: @kalfa/markdown, read and write a file's frontmatter against a schema (ticket 1926)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The
ticket is https://github.com/kamp-us/tea-fabrika/issues/1926, and its pull request says `Closes #1926`,
never a `fabrika close ticket` line. One pull request, one slice. It makes the new package
`kalfa/markdown/`, which holds only a glossary today, and carries the ticket's riskiest unknown: one
YAML reading serves both directions and gives the values a Schema made from a JSON Schema file expects.
Words: `kalfa/markdown/GLOSSARY.md`, and Records' words data and shape in `kalfa/records/GLOSSARY.md`.

```ts
// The whole idea, a sketch. Nothing here was type-checked.
import * as Frontmatter from "@kalfa/markdown/Frontmatter";

const Shape = Schema.Struct({ number: Schema.Int, status: Schema.Literals(["proposed", "accepted"]), id: Schema.String });

const text = Frontmatter.write({ data: { number: 87, status: "accepted", id: "0146" }, body: "# A title\n\nText.\n" }, Shape);
// Result.succeed("---\nnumber: 87\nstatus: accepted\nid: \"0146\"\n---\n# A title\n\nText.\n")

const file = yield* Frontmatter.read(Result.getOrThrow(text), Shape);
// { data: { number: 87, status: "accepted", id: "0146" }, body: "# A title\n\nText.\n" }
// Effect<{ data, body }, NoFrontmatter | BadFrontmatter, never>, in the span markdown.frontmatter.read

Frontmatter.split("# No frontmatter\n"); // { frontmatter: Option.none(), body: "# No frontmatter\n" }
```

## Doubts, at the top

The owner is away, so the plan takes its lean on each of these and goes on.

- **`write` answers a `Result`, not a plain string (75%).** The owner's sketch on issue 1909 writes
  `Frontmatter.write({ data, body }, schema): string`, marked "a sketch (not code to keep)". A Schema's
  checks are not all in its type: `Schema.Int` types its value as `number`, and encoding `1.5` fails
  (tried in the installed Effect 4.1.3). A string answer would have to throw there. The repo's pattern
  is that plain code answers a `Result` (`.kalfa/patterns/effect-pure-domain-returns-result.md`), and
  the sibling ticket https://github.com/kamp-us/tea-fabrika/issues/1927 already says a refused value
  "fails with `BadFrontmatter` and gives no new text". What would settle it: the owner's word. The
  fallback, a string that throws, is a one-line change to `write` and its laws. This is also the one
  open question.
- **The span is named `markdown.frontmatter.read` (75%).** The ticket says `markdown.<call>`, and
  decision 0063 says `<package>.<call>`. The call is `Frontmatter.read`, so `<call>` here is
  `frontmatter.read`; the repo has three-part span names already (`watchers.remote.publish`). The doubt
  is whether the lead reads `<call>` as the bare function name, `markdown.read`. A rename is one string
  and one law (F12).

## What changes, in one paragraph

A new private workspace package, `@kalfa/markdown`, with one module, `Frontmatter`: `split` (the
package's one way to cut a file into frontmatter and body), `read` (an Effect, in its own span) and
`write` (a plain function), with two errors, `NoFrontmatter` and `BadFrontmatter`. It depends on the
`yaml` package (2.9.1, already the catalog's version) and imports no kalfa package, no Node module and
no Telemetry; lint holds all three. Its rank, below Records, is written in the three places the repo
keeps import rules. Nothing calls the package yet. Out of scope and left to the sibling tickets: setting
values in a frontmatter while keeping every other byte (https://github.com/kamp-us/tea-fabrika/issues/1927),
and reading a body into mdast, with how a body's line maps to the file's line
(https://github.com/kamp-us/tea-fabrika/issues/1928). Records' own move onto this package is Records'.

## Searched first

- The ticket, its parent issue https://github.com/kamp-us/tea-fabrika/issues/1909 with the answer
  comment, the sibling tickets 1927 and 1928, and decisions 0087, 0047, 0049, 0063 and 0084 whole. From
  0075 on, only 0084 (a package's rank, the way Diagnostics was placed) and 0087 touch this.
- `kalfa/AGENTS.md`, `kalfa/markdown/GLOSSARY.md`, `kalfa/records/GLOSSARY.md`,
  `.kalfa/glossary/GLOSSARY-MAP.md` (it already says "Records reads and writes a record through
  Markdown").
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks` for
  "frontmatter|front matter", "yaml", "json schema", "byte for byte" and "round trip". Only 0087 and the
  glossaries settle anything this plan picks.
- The two approved plans of this push, for a first ticket of a new kalfa package: the diagnostics plan
  with its amendment 1 (span name in lowercase package form, Effect's own `Arbitrary` and no
  `fast-check`, generators whose groups are checked in every run, the Node import gap) and the
  configuration plan. This plan copies their package layout and lint rows.
- Today's frontmatter reader, `kalfa/records/src/Frontmatter.ts`: YAML's failsafe schema (every value
  text), `Result`, the line of each key. It stays as it is; Records' redraw replaces it.
- Installed versions in `pnpm-lock.yaml`: `effect` and `@effect/vitest` 4.1.3 (with its patch), `vitest`
  5.0.5, `yaml` 2.9.1 (catalog, already used by `kalfa/records`, CI's own package and the root), `@rslib/core`
  1.0.5, `oxlint` 1.90.0, `@demlik/code-graph` 0.15.0.
- In the installed Effect: `node_modules/effect/AGENTS.md` whole; `effect/encoding/Yaml` (a reader only,
  "based on `yaml` 2.9.0", which lists "compact nested block sequences (`- - value` on one line)" as
  unsupported); `SchemaRepresentation.fromJsonSchemaDocument` (answers `Schema.Top`, whose services
  are `unknown`) and its neighbor's example of typing a rebuilt schema with
  `Schema.make<Schema.Codec<T>>(schema.ast)` (`src/SchemaRepresentation.ts`, the `fromRepresentation`
  doc); `Schema.decodeUnknownEffect`, `Schema.encodeResult` (its schema must need no encoding service),
  `Schema.JsonObject`, `Schema.toCodecJson`, `Schema.TaggedError`, the generic `Effect.fn` example
  (`src/Effect.ts`, "`function*<A>(`"), and the string arbitrary (`src/internal/arbitrary/schema.ts`:
  printable ASCII 32 to 126 plus 15 fixed edge cases, so it never draws `é`, `设`, `\r` or U+2028 on
  its own).
- The lint a new `kalfa/` folder meets, in `.oxlintrc.json`: base `unicorn/prefer-node-protocol` (on
  for every file, never turned off), `kalfa/config`'s Effect block, the `kalfa/**/*` block (it refuses
  `JSON.parse` and `Data.TaggedError`), the `kalfa/*/src/**` docs rule, the anti-slop blocks that reach
  new folders (`no-unknown-parameters`, `no-unknown-returns`, `no-runtime-typeof`,
  `require-safety-comment-for-type-assertion`), `fabrika/no-type-assertions` and
  `fabrika/prefer-schema-arbitrary`. `fabrika/no-node-imports` does nothing here: it returns early for a
  file outside `next/` and `.agents/` (`heldToNext`, `oxlint-plugins/match.ts:112`, read at
  `oxlint-plugins/no-node-imports.ts:47`), so this plan counts on no rule from that block for Node.

## Trials run while planning

Small scripts in a scratch folder, against the installed `yaml` 2.9.1, `effect` 4.1.3 and `oxlint`
1.90.0. Nothing in the repo ran or changed. Each fact below is a trial result, not from memory.

- **YAML schemas and `0146`.** `id: 0146` reads as the number 146 under the core schema (YAML 1.2), as
  the text `"0146"` under failsafe, and as 102 (octal) under `yaml-1.1`. Under core, `yes`, `on` and
  `2026-11-22` read as text, `~` as null, `0x1F` as 31, `.inf` as Infinity. Writing the text `"0146"`
  under core gives `id: "0146"`, quoted, so it reads back as text.
- **Round trips under core.** With `stringify(value, { schema: "core", lineWidth: 0,
  aliasDuplicateObjects: false })` and `parseDocument(text, { schema: "core", logLevel: "error" })`,
  every case came back equal (`assert.deepStrictEqual`): about 50 awkward strings (U+2028, U+0085,
  U+FEFF, lone surrogates, `\r`, `\r\n`, `a\n---\nb`, `a\n...\nb`, leading and trailing spaces, tabs,
  control characters, `ğüşİı中文😀`, 5,000 characters, every YAML mark, every word another reading
  types), 44 awkward keys (`null`, `~`, `true`, `1`, `-0`, `.x`-like, `a b`, the empty key, `---`,
  `<<`, `__proto__`, 2,000 characters, which yaml writes as an explicit `? ` key), `-0`, `5e-324`,
  `1e21`, `2^53+2`, and a list inside a list. No written line was `---` or `...`: a text holding such a
  line is written as an indented `|-` block.
- **What the reading must refuse itself.** `!!set`, `!!omap`, `!!timestamp` and `!!binary` give a
  `Set`, a `Map`, a `Date` and a `Buffer` with no warning. `!!float 1` and `!x` give a warning and a
  text. `? [a]: 1` gives the key `"[ a ]"`, and with yaml's default log level `toJS` prints a Node
  warning (`process.emitWarning`). `~: 1` with `null: 2` gives `{ "": 2 }` with no error. An alias bomb
  throws a `ReferenceError` from `toJS`. A tab used as indentation, a duplicate key, `a: b: c`, an
  unclosed quote or bracket, and a `%YAML` line are errors, each with a line.
- **A second document is dropped silently with `logLevel: "silent"`.** `k: 1\n...\nz: 4` and
  `a: 1\n--- \nb: 2` read as one document and lose the rest with no error. With `logLevel: "error"`,
  both are a `MULTIPLE_DOCS` error, and no warning is printed: `process.emitWarning` and `console.warn`
  were never called for any case above.
- **Effect's JSON gate.** `Schema.JsonObject` refuses `NaN`, `Infinity`, a `Date`, a `Buffer`, a `Set`,
  a `Map`, `undefined`, a bigint, a class instance and a top level that is a list or null. It keeps
  `-0` and an own `__proto__` key. `Schema.toCodecJson` turns a `Date` into its ISO text, a bigint into
  text and an `undefined` optional into null.
- **A Schema made from a JSON Schema.** A 2020-12 document with an enum `status`, an integer `number`
  (minimum 1), a string `decided`, an integer list, a boolean and a string-or-null accepted the core
  reading of a decision-shaped block, kept an extra key, and refused `number: '87'`, `status: Accepted`,
  `number: 0` and `draft: yes`. `0146` inside the integer list read as 146.
- **oxlint's import patterns.** `@kalfa/*` matches `@kalfa/config` but not `@kalfa/config/App`;
  `@kalfa/**` matches both. `node:*` matches `node:fs` but not `node:fs/promises`; `node:*/**` matches
  the second and not the first. `@effect/platform-*` with its `/**` form matches the package and its
  subpaths. So each rule row below uses `/**`, and the `node:` group holds both forms.

## How others do it

- **Jekyll and Hugo** (from memory, not fetched): front matter is a YAML block between a `---` first
  line and the next `---` line, and the rest is the page. Hugo also takes TOML between `+++` lines. The
  ticket fixes the YAML form only.
- **Astro's content collections** (from memory): each file's frontmatter is checked against the
  collection's schema, and the body is left as Markdown. This is decision 0087's split: data on top,
  checked against a shape; free text below.
- **Changesets** (from memory): a `---` block of data, then the free text summary.
- **gray-matter** (from memory): splits on `---`, reads with js-yaml 3, which reads YAML 1.1 (a leading
  `0` is octal, `yes` is true), and gives `{}` for an empty block. Its readings differ from the `yaml`
  package's, which is the 0087 reason for one package owning one reading.
- **YAML 1.2's core schema** (from memory of the spec, and tried in the installed `yaml`): only `true`,
  `false`, `null`, `~` and plain numbers are typed; everything else is text. It is the `yaml`
  package's default and the reading closest to JSON, which JSON Schema shapes expect.
- **Elm** (from memory): a decoder answers `Result Error a`, and an encoder is total, because a value
  built with exact types cannot be wrong. Here `read` is the decoder and answers its errors in the
  Effect's error channel. `write` cannot be total: an Effect Schema's checks (an integer, a pattern)
  are not all in its type, so it answers a `Result`, as Elm's decoders do.
- **Erlang/OTP**: nothing here runs, waits or is supervised, so no OTP answer applies.
- **Effect** (read in the installed 4.1.3): `Effect.fn("name")` for a function that makes a span,
  `Schema.TaggedError` for errors with the cause kept, `Schema.encodeResult` for a synchronous encode,
  `Schema.JsonObject` for a JSON object, and `Schema.make<Schema.Codec<T>>(ast)` to type a schema that
  arrives as `Schema.Top`.

## The shape

### The package

```text
kalfa/markdown/
  package.json          @kalfa/markdown, private; exports ./Frontmatter and ./package.json
  README.md             what the package is, the reading, the three calls, the errors, what it never does
  GLOSSARY.md           exists; Body says "or the whole file when it has none"
  rslib.config.ts       as kalfa/config's
  tsconfig.json         as kalfa/config's, with the Effect checks
  tsconfig.build.json   as kalfa/config's
  src/
    Frontmatter.ts      split, read, write, NoFrontmatter, BadFrontmatter, Split
```

No root entry: subpaths only, as `@kalfa/config` and `@kalfa/diagnostics` export. 1928 adds
`./Markdown` beside it.

```jsonc
// kalfa/markdown/package.json, a sketch.
{
  "name": "@kalfa/markdown", "version": "0.0.0", "private": true, "type": "module",
  "scripts": { "build": "rslib build", "typecheck": "tsc --noEmit" },
  "exports": { "./Frontmatter": "./src/Frontmatter.ts", "./package.json": "./package.json" },
  "publishConfig": { "exports": { "./Frontmatter": { "types": "./dist/Frontmatter.d.ts", "default": "./dist/Frontmatter.js" } } },
  "files": ["dist", "!dist/.rsbuild"],
  "dependencies": { "yaml": "catalog:" },
  "peerDependencies": { "effect": "catalog:" },
  "devDependencies": { "@effect/platform-node, @effect/vitest, @rslib/core, @types/node, effect, typescript, vitest": "catalog:" },
  "engines": { "node": ">=26" }
}
```

No `fast-check` and no `@kampus/vitest`: the laws use `@effect/vitest` and Effect's own `Arbitrary`,
as the diagnostics package does, so the package needs nothing from this repo and its rule rows say
`imports: []`. Laws run in memory, so a literal `numRuns` passes `fabrika/runs-from-depth`.

### Frontmatter.ts

```ts
// kalfa/markdown/src/Frontmatter.ts, a sketch. Doc blocks left out. Nothing here was type-checked.
import { Effect, Option, Result, Schema } from "effect";
import { isMap, isScalar, LineCounter, parseDocument, stringify, visit } from "yaml";

// The one reading, used by read and write alike. YAML 1.2's core schema: only true, false, null, ~ and
// plain numbers are typed, so `0146` is the number 146 and `"0146"` is text. "error" makes a second
// document an error ("silent" drops it with no error) and prints nothing.
const READ = { version: "1.2", schema: "core", logLevel: "error" } as const;
// lineWidth 0: one value per line, never folded. aliasDuplicateObjects false: no `&a1` anchors.
const WRITE = { version: "1.2", schema: "core", lineWidth: 0, aliasDuplicateObjects: false } as const;

/** A file cut in two: the text between its two `---` lines, if it has them, and the rest. */
export interface Split {
  readonly frontmatter: Option.Option<string>; // without the `---` lines; "" for an empty block
  readonly body: string;                       // byte for byte; the whole text when there is no frontmatter
}

// A fence line is `---`, with `\r` before its line break allowed. The first line must be one, and the
// frontmatter ends at the next one. A first line that is not, or no second fence: no frontmatter.
export const split: (text: string) => Split;

export class NoFrontmatter extends Schema.TaggedError<NoFrontmatter, { readonly brand: unique symbol }>()(
  "NoFrontmatter", {},
) {}

export class BadFrontmatter extends Schema.TaggedError<BadFrontmatter, { readonly brand: unique symbol }>()(
  "BadFrontmatter",
  {
    // syntax: the frontmatter is not YAML. value: it is YAML but holds what is not a JSON object (a top
    // level that is not a map, a tag that makes a Set or a Date, .nan, a key that is a list, a null key,
    // two keys that give one text); on write, the encoded data is not a JSON object. schema: the
    // caller's Schema refused the data.
    reason: Schema.Literals(["syntax", "value", "schema"]),
    message: Schema.String,                  // one line: yaml's first line, ours, or the SchemaError's
    line: Schema.optionalKey(Schema.Int),    // the file's line, counted from 1, when one is known
    cause: Schema.optional(Schema.Defect()), // the YAMLParseError, YAMLWarning or SchemaError; none for ours
  },
) {}

export const read = Effect.fn("markdown.frontmatter.read")(function* <S extends Schema.ConstraintDecoder<unknown, unknown>>(
  text: string,
  schema: S,
): Effect.fn.Return<{ readonly data: S["Type"]; readonly body: string }, NoFrontmatter | BadFrontmatter, S["DecodingServices"]> {
  // 1. split; none is NoFrontmatter.
  // 2. parseDocument(frontmatter, { ...READ, lineCounter }); errors[0] is syntax, its line plus 1 (the
  //    block starts on the file's second line); warnings[0] is value.
  // 3. empty contents (blank lines or comments only) is the empty map; contents that are not a map,
  //    and any key that is not a scalar, null, or a text another key of its map already gives, is value.
  // 4. toJS, wrapped: a throw (an alias bomb) is value, with the throw as its cause.
  // 5. Schema.JsonObject: a refusal is value. 6. the caller's schema: a refusal is schema.
});

export const write: <S extends Schema.ConstraintEncoder<unknown>>(
  file: { readonly data: S["Type"]; readonly body: string },
  schema: S,
) => Result.Result<string, BadFrontmatter>;
// 1. Schema.encodeResult(schema): a refusal is schema. 2. Schema.JsonObject: a refusal is value.
// 3. "---\n" + (empty map ? "" : stringify(json, WRITE)) + "---\n" + body.
```

- **`read` takes any Schema whose decode needs any services,** and its Effect needs those same
  services. `write` takes a Schema whose encode needs none, because it is a plain function.
- **A Schema made from a JSON Schema file arrives as `Schema.Top`,** with services `unknown`, so it
  cannot be run as it is. Effect's own answer is `Schema.make<Schema.Codec<T>>(top.ast)`, which types
  it with no cast; law F10 does that, and Records will hold its shapes the same way.
- **The data is a JSON object.** Decision 0087 makes a kind's shape a JSON Schema file, so the values
  are JSON. A caller whose Schema's encoded side is not JSON (a `Date`, a bigint) passes
  `Schema.toCodecJson(itsSchema)`, which the README says.
- **No `line` for a schema refusal.** The SchemaError names the path; mapping a path to its line needs
  the document's positions, which 1927 builds for set. A later ticket can add it without changing a
  field.

## One value traced

Shape as in the opening block, data `{ number: 87, status: "accepted", id: "0146" }`, body
`"# A title\n\nText.\n"`.

1. `write` encodes with `Shape`: the same object. `Schema.JsonObject` accepts it. `stringify` under
   core writes `number: 87\nstatus: accepted\nid: "0146"\n`: `0146` is quoted, since unquoted it would
   read as a number. The answer is `Result.succeed` of `---\n` + that + `---\n` + the body.
2. `read` on that text: `split` finds `---` on line 1 and the next `---` on line 5, so the frontmatter
   is the three lines between, and the body is everything after line 5's line break, the given body
   byte for byte.
3. `parseDocument` under core: no error, no warning, a map with three plain keys, each key's text
   once. `toJS` gives `{ number: 87, status: "accepted", id: "0146" }`; `Schema.JsonObject` and then
   `Shape` accept it. The Effect succeeds with `{ data, body }`, inside one span,
   `markdown.frontmatter.read`, which holds no attribute.
4. A person edits line 4 to `id: 0146`, unquoted. Core reads 146, `Schema.JsonObject` accepts it,
   `Shape` refuses it: `BadFrontmatter { reason: "schema", message: <the SchemaError's line, naming
   ["id"]>, cause: <the SchemaError> }`, no `line`.
5. Then they indent line 3 with a tab. `parseDocument` gives `TAB_AS_INDENT` at the block's line 2:
   `BadFrontmatter { reason: "syntax", line: 3, message: "Tabs are not allowed as indentation" }`.
   The span records that failure.
6. A file of only `# A title\n` has no `---` first line: `read` fails with `NoFrontmatter`, and
   `split` gives `{ frontmatter: Option.none(), body: "# A title\n" }`.

## What lint holds

One new `.oxlintrc.json` override for `kalfa/markdown/src/**`, its tests left out, after the last
kalfa override, as the diagnostics package placed its own. An override replaces a rule's options, so
it repeats the base `no-restricted-imports` entries (Radix, Playwright's `_electron`) and adds:

- **No kalfa or repo package:** patterns `@kalfa/**`, `@kampus/**`, `@tea-fabrika/**` and `../../**`.
- **No Telemetry:** `@kalfa/**` covers `@kalfa/telemetry`; also `@opentelemetry/**` and
  `@effect/opentelemetry` with `@effect/opentelemetry/**`. Spans are made only with `Effect.fn`.
- **No Node module, in both spellings:** the pattern group `node:*` and `node:*/**`; a bare builtin
  name (`fs`, `process`) is already refused for every file by base `unicorn/prefer-node-protocol`.
  Also `@effect/platform-*` and `@effect/platform-*/**`: the package takes text and does no IO.
- **No printing and no Node global:** `eslint/no-console`, and `eslint/no-restricted-globals` for
  `console`, `process`, `Buffer`, `globalThis`, `global`, `self` and `window`, as the diagnostics
  override refuses them (a ban on `process` alone misses `globalThis.process`).

The same folder joins the files of `kalfa/config`'s Effect block (`no-promises`,
`no-effect-run-outside-edge`, `effect-functions`, `no-hand-tag` and the rest). The new override comes
after it, so its `no-restricted-imports` wins. Two rules in that block, `no-node-imports` and
`no-ledger-sql`, check nothing in `kalfa/`, which is why the Node group above exists. `Effect.log`
prints by default and no rule here sees it; the review holds it, and the README says the package
never logs. The yaml library's own `process.emitWarning` call is held by law F13, since lint does not
read a dependency.

`boundary-rules.json`'s `pure: true` was weighed and is not used, for the reason the diagnostics plan
gives: that file has no `testFiles` key, so the package's own tests would be judged impure.

## Where the rank is written

The three places the diagnostics plan found, each edited:

- `kalfa/AGENTS.md`, the "No import cycles" bullet, gains one sentence: Markdown ranks below Records,
  which reads and writes its records' frontmatter through it (decision 0087).
- `layer-rules.json`: a `kalfa-markdown` row, `layer: 0`, `paths: ["kalfa/markdown/src"]`,
  `imports: []`, after the `next-vitest` row (a row with no `layer` ranks just under the ranked row
  above it, so a row placed after `kalfa-config` would push `next-id-test-support` below it), and
  `kalfa/markdown/src` in `roots`.
- `boundary-rules.json`: `"kalfa-markdown": { "imports": [], "pure": false }` and
  `"kalfa/markdown": "kalfa-markdown"`. `kalfa-records` gains `kalfa-markdown` in Records' own ticket,
  when it makes the edge, since each edge needs its reason.

Pull request https://github.com/kamp-us/tea-fabrika/pull/1921 (diagnostics) edits the same lines of
these files, the root `package.json` and the lockfile. Whichever lands second rebases; the rows sit
side by side and do not conflict in meaning.

## Generators and what each must reach

A generator's reach is part of its law. Each group below is checked in every run, not left to chance:
each run takes its drawn value and also checks one made from it for each group. Every generator is an
Effect `Arbitrary` in `kalfa/markdown/src/Frontmatter.test-support.ts`; Effect's own string arbitrary
reaches only printable ASCII and 15 fixed cases, so `text` is built, not derived. Each group has a
plant: a wrong rule in `Frontmatter.ts` that a generator without the group would let pass.

- **`text`** (every value, key and body): (a) empty, one space, only spaces, only a tab, only line
  breaks; (b) leading and trailing space, tab, `\n`, `\r\n` and U+00A0; (c) line breaks inside: `\n`,
  `\r\n`, a lone `\r`, two in a row, U+0085, U+2028, U+2029; (d) a tab inside; (e) U+0000 to U+001F,
  U+007F and U+FEFF anywhere; (f) letters past ASCII to U+024F (`é`, `ş`, `İ`, `ı`), past U+024F in the
  Basic Multilingual Plane (`α`, `ж`, `设`, U+FFFD), outside it (an emoji, U+10FFFF), and the lone
  surrogates U+D800 and U+DC00; (g) YAML marks at the start, inside and alone: `---`, `...`, `-`,
  `- `, `? `, `: `, ` #`, `#`, `&a`, `*a`, `!a`, `!!str`, `%`, `@`, a backtick, `|`, `>`, `'`, `"`,
  `[`, `]`, `{`, `}`, `,`, `<<`; (h) words another YAML reading types: `true`, `False`, `TRUE`, `yes`,
  `No`, `on`, `off`, `y`, `null`, `Null`, `~`, `0146`, `0o17`, `0x1F`, `1e3`, `1_000`, `+1`, `-0`,
  `.5`, `.inf`, `-.Inf`, `.nan`, `2026-11-22`, `2026-11-22T10:00:00Z`; (i) `__proto__`,
  `constructor`, `prototype`, `toString`, `hasOwnProperty`; (j) 200 to 5,000 characters, as one word
  repeated with spaces and as one run with no space.
- **`key`**: every `text` group, plus (k) path-like keys: a part that starts with a dot (`.x`, `..`,
  `...`), that holds a space (`a b`, ` a`, `a `), a dot inside (`a.b`), a slash (`a/b`), digits only
  (`1`, `007`, `-1`, `1.5`); (l) keys over 1,024 characters (written as explicit `? ` keys); (m) two
  keys of one map that differ only in letter case or whitespace.
- **`json`** (data for `Schema.JsonObject`): maps of 0 to 8 keys from `key`, nested to depth 4, with
  (n) null, true and false; (o) 0, -0, 1, -1, ±(2^53−1), 2^53+2, 0.1, 1/3, 1e21, 5e-324 and
  ±Number.MAX_VALUE; (p) strings from `text`; (q) lists: empty, a list inside a list three deep, a list
  of maps, a list of empty maps, a list of every kind; (r) maps: empty, and nested four deep; (s) one
  map or list object placed at two keys.
- **`shaped`** (data for the fixed Schemas, every string from `text`): S1 `Schema.JsonObject` with
  `json`; S2 a decision-like Struct (`number` an integer from 1, `status` a literal of three,
  `decided` text, `supersedes` integers, `tags` texts, `note` an `optionalKey` text, `draft` a
  boolean, `meta` a Struct with the keys `"a.b"` and `" c"`, the second null or a number); S3 a Struct
  with a `Schema.NumberFromString` field, so the file holds text and the data a number, and
  `Schema.toCodecJson` of a Struct with a `Schema.Date` field; S4 a record of text keys to lists of
  lists of text; S5 F10's Schema made from a JSON Schema.
- **`body`**: every `text` group, plus (t) starting with `---\n` or `---\r\n`, holding `---` lines,
  holding a whole file with its own frontmatter; (u) starting with `\n`, with no final line break,
  with only `\r\n` line ends; (v) a `# ` heading, and a code fence that holds a `---` line.
- **`bare`** (files with no frontmatter): (w) a first line that nearly is a fence: `--- `, ` ---`,
  `----`, `--`, `---x`, `--- # c`, `---\t`, `﻿---`, `***`, `+++`, `...`, `- - -`; (x) a first
  line `---` and no later `---` or `---\r` line, the later lines from (w) and `text`; (y) the empty
  text, `---` alone, `---\n` alone, `---\r\n` alone; (z) any `text` whose first line is not a fence.
- **`broken`** (not YAML; reason syntax): a tab as indentation; an unclosed `[` or `{`; an unclosed
  `"` or `'`; a duplicate key; `a: b: c`; a list item beside map keys; a key indented past its
  sibling; a `%YAML 1.1` line; a second document after `...` or after `--- ` with a trailing space.
  Each is put after 0 to 5 good lines that `write` made from `json`.
- **`unread`** (YAML that is not a JSON object; reason value): a top level that is a list, a text, a
  number or an explicit `~`; the tags `!!set`, `!!omap`, `!!timestamp`, `!!binary`, `!!float 1` and
  `!x`; the values `.nan`, `.inf`, `-.inf`; a key that is a list or a map; a null key; two keys that
  give one text (`1` and `"1"`, `true` and `"true"`, `~` and `""`). Each sits at a generated depth
  inside data from `json`.
- **`refused`** (reason schema): S2 data with one break at a generated field: a number where text is
  wanted, text where an integer is wanted (`"87"`), a literal outside the three (`Accepted`), a missing
  required field, an integer below 1.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| F1, write then read is the same: for each of S1 to S5, data from `shaped` and a body from `body`, `read(write({ data, body }, S), S)` succeeds with data equal by `assert.deepStrictEqual` (so `-0` stays `-0`) and the body identical. 300 runs. Every group of `text`, `key`, `json` and `body` is reached in every run | test | Effect Arbitrary: roundTrip | read under `yaml-1.1`: `yes` written plain reads back true, red; write under failsafe: 87 comes back as text, red; per group, each a wrong rule in `Frontmatter.ts`: split lines on `\r` too, (c) red; drop the `\r` a fence may carry, (t) red; trim the body, (a) and (b) red; replace lone surrogates before writing, (f) red; key the map by `key.toLowerCase()`, (m) red | kalfa/markdown/src/Frontmatter.test.ts |
| F2, the file's form: for data from `json` and a body from `body`, `write` gives `---\n`, then YAML lines none of which is `---`, `---\r` or `...`, then `---\n`, then the body byte for byte; the empty map gives `---\n---\n` and the body; no written YAML holds an alias or anchor node, even for (s). 200 runs | test | Effect Arbitrary: written | leave `aliasDuplicateObjects` at yaml's default: (s) writes `&a1`, red; write `{}` for the empty map: red | kalfa/markdown/src/Frontmatter.test.ts |
| F3, the one split: for frontmatter lines from `text` with no fence among them and a body from `body`, `split` of the joined file with `\n` fences, and again with `\r\n` fences, gives `Option.some` of exactly those lines and the body; for any text from `bare` it gives `Option.none()` and the whole text as the body. 300 runs | test | Effect Arbitrary: splits | compare `line.trim()` with `---`: (w)'s `--- ` becomes a fence, red; take the last fence, not the next: (t) red | kalfa/markdown/src/Frontmatter.test.ts |
| F4, no frontmatter: for any text from `bare` and S1 or S2, `read` fails with `NoFrontmatter`. 200 runs | test | Effect Arbitrary: bareFiles | read an unclosed `---` as an empty frontmatter: (x) red | kalfa/markdown/src/Frontmatter.test.ts |
| F5, not YAML: for each `broken` case after k good lines and any body, `read` fails with `BadFrontmatter` reason `syntax`, a `line` from 2 to the closing `---` line, and for a tab as indentation and a duplicate key exactly k + 2. 200 runs | test | Effect Arbitrary: brokenFiles | parse with `logLevel: "silent"`: the second-document cases succeed, red; report the block's own line, not the file's: red | kalfa/markdown/src/Frontmatter.test.ts |
| F6, YAML that is not data here: for each `unread` case and any body, `read` with S1 fails with `BadFrontmatter` reason `value`, and with a Schema that takes any value (`Schema.Unknown`) too. 200 runs | test | Effect Arbitrary: unreadFiles | drop the `Schema.JsonObject` step: `!!set` passes `Schema.Unknown`, red; drop the key walk: `1` and `"1"` merge, red; call `toJS` unwrapped: the alias bomb is a defect, red | kalfa/markdown/src/Frontmatter.test.ts |
| F7, the Schema refuses: for S2 data with one break from `refused`, written as YAML by hand, `read` fails with `BadFrontmatter` reason `schema` whose cause is a SchemaError naming the broken field. 200 runs | test | Effect Arbitrary: refusedFiles | map every decode failure to `syntax`: red; drop the cause: red | kalfa/markdown/src/Frontmatter.test.ts |
| F8, write refuses and gives no text: S2 data with an integer field at 1.5 fails with reason `schema`; a Struct with a plain `Schema.Date`, a `Schema.Number` at `NaN` or `Infinity`, a `Schema.optional` field holding `undefined`, or a `Schema.BigInt` fails with reason `value`; each answer is a `Result` failure with no text. 100 runs | test | Effect Arbitrary: unwritable | drop the `Schema.JsonObject` step: the date is written as its ISO text, red | kalfa/markdown/src/Frontmatter.test.ts |
| F9, the readings this pull request states: with `Struct({ id: String })`, `id: 0146` fails with reason `schema`, and with `Struct({ id: Number })` it reads 146; `yes`, `on` and `2026-11-22` read as text; `~` reads as null; `.nan` fails with reason `value`; writing `{ id: "0146" }` gives the line `id: "0146"` | test | pinned: the YAML 1.2 core readings in the installed yaml 2.9.1 | read under failsafe: `0146` reads as text and the first line passes, red | kalfa/markdown/src/Frontmatter.test.ts |
| F10, a decision-shaped file and a Schema made from JSON Schema: a 2020-12 document (status enum, integer number from 1, decided text, integer list, boolean, text or null) through `SchemaRepresentation.fromJsonSchemaDocument`, typed with `Schema.make<Schema.Codec<T>>(ast)`, reads a decision-shaped file with a body and gives the numbers, list, boolean and null it expects; `number: '87'` and `draft: yes` fail with reason `schema`; writing the data read and reading it again gives it back | test | scenario: one decision-shaped file and its JSON Schema, written in the test | read under failsafe: `number: 87` is text and the good file fails, red | kalfa/markdown/src/Frontmatter.test.ts |
| F11, line ends do not change data: for data from `json` and a body from `body`, the file `write` gives with every `\n` up to and including the closing fence's turned into `\r\n` reads the same data and the same body. 100 runs | test | Effect Arbitrary: crlfFiles | take a fence only when the line is exactly `---`: red | kalfa/markdown/src/Frontmatter.test.ts |
| F12, the span: under a recording tracer (`Tracer.make` with `Effect.withTracer`), `read` ends exactly one span named `markdown.frontmatter.read`, on success and on each failure, and no attribute value holds a marker text put in the file's frontmatter or body; `split` and `write` end none. 100 runs | test | Effect Arbitrary: tracedFiles | name it `Frontmatter.read`: red; annotate the body: red; make `write` an `Effect.fn`: red | kalfa/markdown/src/Frontmatter.test.ts |
| F13, reading prints nothing: reading a file whose frontmatter has a list as a key, and one with an unknown tag, fails with reason `value`, and neither `process.emitWarning` nor any `console` method is called | test | scenario: two files, with both printers watched by a vitest spy | parse with yaml's default log level and `toJS` before the key walk: the warning fires, red | kalfa/markdown/src/Frontmatter.test.ts |
| T1, the types: `read(text, S)` is `Effect<{ readonly data: S["Type"]; readonly body: string }, NoFrontmatter \| BadFrontmatter, S["DecodingServices"]>`; `write` takes `data: S["Type"]` and answers `Result<string, BadFrontmatter>`; a `write` with data of another type, or with a Schema whose encode needs a service, does not compile; `split` answers `Split`; neither `split` nor `write` answers an Effect | type | type | type `write`'s data as `unknown`: its `@ts-expect-error` is unused, red | kalfa/markdown/src/Frontmatter.types.test.ts |
| P1, the manifest: `kalfa/markdown/package.json` has `yaml` as its only dependency and `effect` as its only peer, names no `@kalfa/` or `@kampus/` package in any field, exports exactly `./Frontmatter` and `./package.json`, and gives `./Frontmatter` its `dist` pair | test | scenario: the package's own manifest at head | add `@kampus/vitest` to its dev dependencies: red | kalfa/markdown/src/Package.test.ts |
| P2, nothing of this repo (decision 0047): no file git tracks under `kalfa/markdown/` holds `fabrika`, `kampus`, `kamp-us` or `.kalfa/` in any letter case, and no file under `kalfa/markdown/src/` but its tests holds the whole words `record`, `records`, `kind` or `decision` in any letter case | test | scenario: the package's tracked files at head | write `a record's data` in a comment in `Frontmatter.ts`: red | kalfa/markdown/src/Package.test.ts |
| L1, no kalfa or repo package: an import of `@kalfa/config`, `@kalfa/config/App`, `@kampus/vitest`, `@tea-fabrika/x` or `../../config/src/App.ts` in a file under `kalfa/markdown/src/` but its tests is refused | lint | lint | each of the five, one at a time, in `Frontmatter.ts`: lint red each time, then undone | .oxlintrc.json |
| L2, no Node and no printing: `import "node:fs"`, `import "node:fs/promises"`, `import "fs"` (base `unicorn/prefer-node-protocol`), `@effect/platform-node`, `@effect/platform-node/NodeServices`, `console.log("x")`, `process.env.X`, `Buffer.from("a")` and `globalThis.process` are each refused there | lint | lint | each of the nine, one at a time, in `Frontmatter.ts`: lint red each time | .oxlintrc.json |
| L3, no Telemetry: `@kalfa/telemetry`, `@opentelemetry/api` and `@effect/opentelemetry` are each refused there | lint | lint | each of the three in `Frontmatter.ts`: lint red each time | .oxlintrc.json |
| L4, the rank: the package imports no other workspace package (`pnpm lint:boundaries`, `pnpm lint:layers`), and its layer row sits at 0 | lint | lint | (a) import `@kalfa/records/Finding` in `Frontmatter.ts`: both checks red; (b) grant `"imports": ["kalfa-config"]` on the `kalfa-markdown` row: `lint:layers` refuses an upward grant, red | layer-rules.json, boundary-rules.json |

**Lint, type or test?** L1 to L4 are shapes of imports and names: lint. T1 is a shape the compiler
sees: type. F1 to F13 are about what text and data the calls give, and P1 and P2 about what files hold,
which no lint rule or type sees: tests. P2 reads words, not code shape, so it is a test, as in the
diagnostics package.

**Where they run.** Every law runs in memory on every pull request. None needs launchd, the real
Electron app, a real OS process or socket, or a real signal, so none is host-only and none waits on the
owner's Mac. No law is a `*.integration.test.ts` file: P1 and P2 read the package's own files, which
`fabrika/runs-from-depth` does not count as real IO. F9 and F10 are fixed inputs written in the test,
labeled `pinned` and `scenario`; no fixture stands in for a tool's output. No secret flows through the
package, so no law is a `[secrets]` law: F12 keeps file text out of the span, as decision 0063 keeps
message text out by default.

## What fact is lost if it is not recorded now

None. The package stores nothing and keeps no log: it turns text into data and back, and the caller
keeps the file. The facts worth keeping are the reading's choices (which YAML schema, what `0146`
reads as), and the README and the pull request body record them now.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/markdown/package.json | tests | tests | new: name, `private`, scripts, exports, `publishConfig.exports`, `files`, `yaml` as dependency, `effect` as peer, dev dependencies. The tests step owns it with the lockfile, so its laws install and run red |
| kalfa/markdown/tsconfig.json | tests | tests | new: as `kalfa/config`'s, with the Effect checks |
| kalfa/markdown/tsconfig.build.json | tests | tests | new: as `kalfa/config`'s |
| kalfa/markdown/rslib.config.ts | build | 12 | new: as `kalfa/config`'s |
| kalfa/markdown/src/Frontmatter.ts | build | 200 | new: `split`, `read`, `write`, `Split`, `NoFrontmatter`, `BadFrontmatter`, the two yaml option sets, with doc blocks |
| kalfa/markdown/README.md | build | docs | new: Markdown's mechanics only, with what a record is left to Records; the three calls; the reading (YAML 1.2 core; `0146`, `yes`, `2026-11-22`, `~`, `.nan`); JSON objects only, with `Schema.toCodecJson` for other Schemas; the three reasons; the span; never does IO, prints or logs |
| kalfa/markdown/GLOSSARY.md | build | docs | Body: "Everything in a Markdown file after its frontmatter, or the whole file when it has none." |
| kalfa/AGENTS.md | build | docs | the "No import cycles" bullet gains: Markdown ranks below Records |
| kalfa/markdown/src/Frontmatter.test-support.ts | tests | tests | the generators and their groups, as Effect `Arbitrary` values |
| kalfa/markdown/src/Frontmatter.test.ts | tests | tests | F1 to F13 |
| kalfa/markdown/src/Frontmatter.types.test.ts | tests | tests | T1 |
| kalfa/markdown/src/Package.test.ts | tests | tests | P1, P2 |
| .oxlintrc.json | tests | tests | L1 to L3: the new override for `kalfa/markdown/src/**`, and that folder added to the files of `kalfa/config`'s Effect block |
| layer-rules.json | tests | tests | L4: the `kalfa-markdown` row after `next-vitest`, and `kalfa/markdown/src` in `roots` |
| boundary-rules.json | tests | tests | L4: the `kalfa-markdown` library type and its `libraries` entry |
| package.json | tests | tests | `@kalfa/markdown` as a root dev dependency, so `pnpm lint:reach` finds it reached |
| pnpm-lock.yaml | tests | tests | the new `kalfa/markdown` importer and the root's new link |
| vitest.config.ts | tests | tests | no change: its kalfa source glob already finds the laws |
| oxlint-plugins/match.ts | tests | tests | no change: read for `heldToNext` |
| oxlint-plugins/no-node-imports.ts | tests | tests | no change: read to learn it checks nothing in `kalfa/` |
| unreachable-ledger.json | tests | tests | no change expected: package `exports` targets are public to `pnpm lint:dead`; if it still flags an export, the step comes back to the plan, never to this ledger |

## Existing tools

- `kalfa/markdown/src/Frontmatter.ts`: searched `kalfa/records/src/Frontmatter.ts` (the repo's one
  frontmatter reader: failsafe, so a JSON Schema shape's integers and booleans arrive as text; read
  only; inside Records, which this package must not import), Effect 4.1.3's `effect/encoding/Yaml` (a
  reader with no writer, which refuses the `- - a` the `yaml` package writes for a list inside a list),
  and npm's gray-matter (js-yaml 3, a YAML 1.1 reading, and a second YAML library), front-matter (read
  only) and vfile-matter (read only, for unified's virtual files). None reads and writes with one
  reading, so the module is new, built on what ships: `yaml` 2.9.1's `parseDocument`, `stringify`,
  `isMap`, `isScalar`, `visit` and `LineCounter`; Effect's `Effect.fn`, `Option`, `Result`,
  `Schema.TaggedError`, `Schema.decodeUnknownEffect`, `Schema.encodeResult` and `Schema.JsonObject` (in
  place of a hand-written JSON check, which `no-runtime-typeof` and Effect's AGENTS.md both refuse).
- `kalfa/markdown/rslib.config.ts`: searched the `kalfa/config` build file, copied as it is: the same
  entry globs, which leave tests and test support out of `dist`.

## Calls taken

- **YAML 1.2's core schema, for reading and writing, 85%.** The ticket asks the pull request to say
  which. Core gives JSON's types, which is what a JSON Schema shape expects (trial: integers, booleans
  and null fit; failsafe would give every integer as text). The cost: `0146` unquoted is 146. It is loud
  where a shape wants text (a refusal), and silent only where a shape wants a number. `yaml-1.1` would
  read it as 102 and `yes` as true, worse on both counts.
- **The data is a JSON object, checked by `Schema.JsonObject` on both sides, 85%.** Decision 0087 makes
  shapes JSON Schema files, so the values are JSON. It refuses what the YAML tags would smuggle in (a
  `Set`, a `Date`, a `Buffer`) and what JSON has no word for (`NaN`, `undefined`), so read and write
  agree on one set of values. A top level that is a list or a text is refused too: every tool in "How
  others do it" treats frontmatter as keys, and 1927 sets keys.
- **`logLevel: "error"`, 90%.** Trial: `"silent"` drops a second document with no error; `"error"`
  refuses it and prints nothing; the default prints a Node warning for a list used as a key.
- **Warnings refuse, 80%.** A tag yaml cannot resolve is read as text with a warning. Refusing it keeps
  "what the Schema sees is what the file says".
- **Keys: no list or map, no null, no two keys giving one text, 80%.** Each one, in the trial, lost or
  changed data with no error.
- **An empty block is the empty map, 80%.** `---\n---\n` is a common way to mark a file with no data
  (Jekyll). `write` gives that form for the empty map, so F1 holds it.
- **A fence line is `---`, with an optional `\r`, 85%.** The ticket fixes `---`; a file saved with
  `\r\n` must not lose its frontmatter (F11). A BOM before `---` makes a first line that is not `---`,
  so such a file has no frontmatter, as the ticket's rule says; Effect's text reader drops a BOM anyway.
- **An unclosed `---` first line means no frontmatter, 80%.** A Markdown file may open with a thematic
  break, and today's records reader treats it the same way.
- **`lineWidth: 0` and no anchors on write, 80%.** One value per line, never folded, and no `&a1`, so
  the text stays what a person would type, and 1927 can change one value's text in one place.
- **`read`'s errors carry the file's line for `syntax`, and for `value` when yaml gives one, 80%.**
  Today's records reader reports the line, and a diagnostic needs a place.
- **`split` answers an `Option`, 85%.** Two states, the frontmatter's text or none, with the body in
  both; an `Option` makes a third impossible.
- **The reasons are `syntax`, `value` and `schema`, 80%.** Short plain words; `schema` is the library's
  word, since `shape` is Records' and this package names nothing of Records.
- **The build setup and the lint rows copy the diagnostics package, 85%.** The same push, the same
  review's findings.
- **Is any of this a setting? No.** The YAML schema, the fence and the write options must be the same
  for every reader and writer of a file, or one tool writes what another reads differently, which is
  the reason 0087 gives this package one reading. A setting would split them.

## Validation

- Tests step: `pnpm install --offline` once, to add the new importer to the lockfile (a new workspace
  package cannot go in with `--frozen-lockfile`; `yaml` 2.9.1 is already in the store), then
  `nice -n 15 pnpm exec vitest run --maxWorkers=3 kalfa/markdown` shows F1 to F13, P1 and P2 red on the
  missing module. L1 to L4's plants run by hand with `pnpm lint`, each undone, each red. Generators use
  Effect's `Arbitrary` built from Schemas, so `fabrika/prefer-schema-arbitrary` stays quiet.
- Build step: the same vitest path green, `pnpm format`, `pnpm lint` (it runs `lint:layers`,
  `lint:boundaries`, `lint:reach` and `lint:dead`), and `pnpm --filter @kalfa/markdown build` once,
  listing the `dist` files, then deleting them.
- The lead runs `pnpm typecheck`, which holds T1 and the doc blocks' types. The lockfile change makes
  `--changed` the whole suite, so the full run is CI's.

## Size

1. One slice, the package: about 212 product lines (`Frontmatter.ts` 200, `rslib.config.ts` 12), plus
   F1 to F13, T1, P1, P2, the generators, the README, the glossary line, the `kalfa/AGENTS.md`
   sentence and the rule rows. It lands whole: a caller can read and write a frontmatter against any
   Schema, and the riskiest unknown is settled by F1 and F10.

About 3 agent hours across the steps, 75% sure. The doubt is the generators: nine of them with every
group checked in every run is the larger half of the work, and the diagnostics package needed a
send-back on exactly that. Budget basis: the diagnostics plan, a package of this size, at about $5 a
step at list price; this one adds about $1 a step for the generators. Tests, build, review and one
likely send-back.

Estimate: 4 steps, $24

## New names

- `Frontmatter.split`, `Frontmatter.read`, `Frontmatter.write`: the owner's sketch on 1909 names the
  last two; `split` is the ticket's "the package's one way to split a file".
- `NoFrontmatter`, `BadFrontmatter`: the ticket's.
- `Split`: the answer of `split`, a code name, not a domain word.
- `syntax`, `value`, `schema`: `BadFrontmatter`'s reasons.
- `markdown.frontmatter.read`: the span.

No new domain word: Frontmatter, Body and Document are in the glossary, and the plan coins none.

## Records

- `kalfa/markdown/GLOSSARY.md`: Body's definition gains "or the whole file when it has none", in the
  build. No new term.
- `kalfa/AGENTS.md`'s one sentence on the rank, as above.
- The README and the pull request body record the reading: YAML 1.2 core, and `0146` unquoted reads as
  the number 146. No decision record: decision 0087 holds the ruling that one package owns one
  reading, and this plan picks how. The lead may judge the YAML schema hard enough to undo, once
  records are written with it, to want its own decision.
- No pattern doc yet: the first caller, Records, shows whether "read a frontmatter against a Schema"
  needs one.

## What this cannot tell us

- Whether people typing records by hand trip on the core reading. `0146` is refused where a shape wants
  text; where a shape wants a number, a leading zero is dropped with no word.
- Whether 1927's set can reuse this reading's checks (keys, warnings, the JSON gate) on yaml's document,
  or needs its own walk. Both read with the same options.
- Which line a schema refusal is on: not given here.
- Whether the package runs in a browser: lint keeps Node out of its source, but no law loads it there,
  and the `yaml` package's browser build is not tried.
- Whether `Schema.make<Schema.Codec<T>>(ast)` is how Records should hold a kind's shape; F10 shows only
  that it works.
- How Records' move changes its readings: today's failsafe reader gives every value as text, so a
  `summary: 12` becomes a number after the move. That is Records' ticket to check.

## Open questions

1. Should `Frontmatter.write` answer a `Result` that can fail, not the plain string the 1909 sketch
   shows? Lean yes, 75%: an Effect Schema's checks are not all in its type, so the only other answer is
   a throw; the plan builds the `Result`.
   Answered by the lead on 2026-11-22: yes, a `Result`. Two written rules decide it, so it is no new
   design call: `.kalfa/patterns/effect-pure-domain-returns-result.md` (plain code answers a `Result`),
   and the sibling ticket https://github.com/kamp-us/tea-fabrika/issues/1927, which already says a
   refused value "fails with `BadFrontmatter` and gives no new text". The 1909 sketch is marked as not
   code to keep.

## Findings

1. **Today's records reader prints a Node warning for a list used as a key.**
   `kalfa/records/src/Frontmatter.ts` calls `parseDocument` with yaml's default log level and then
   `toJS`. In the trial, a frontmatter of `? [a]\n: 1` made yaml 2.9.1 call `process.emitWarning`
   ("Keys with collection values will be stringified due to JS Object restrictions"), so the runbook
   check would print a warning on stderr for such a runbook. It goes away when Records moves onto this
   package; until then it is harmless and only seen on a malformed runbook. No ticket asked for here.
