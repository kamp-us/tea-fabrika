Approved by the lead agent, builds 0087, 0063, 0047, 0049; body fdf1b8abbdcd
Plancheck-Version: 3

# Plan: @kalfa/markdown, set values in a file's frontmatter and keep every other byte (ticket 1927)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The
ticket is https://github.com/kamp-us/tea-fabrika/issues/1927, and its pull request says `Closes #1927`.
One pull request, one slice. It adds one call, `Frontmatter.set`, to the package that pull request
https://github.com/kamp-us/tea-fabrika/pull/1942 landed. Words: `kalfa/markdown/GLOSSARY.md`, and
Records' words data and shape in `kalfa/records/GLOSSARY.md`.

```ts
// The whole idea, a sketch. Nothing here was type-checked.
import * as Frontmatter from "@kalfa/markdown/Frontmatter";

const Shape = Schema.Struct({
  number: Schema.Int,
  status: Schema.Literals(["proposed", "accepted"]),
  summary: Schema.String,
  tags: Schema.Array(Schema.String),
});

const text = [
  "---",
  "number: 87",
  "status: proposed   # waits for a yes",
  "summary: >",
  "  Data on top",
  "  and free text below.",
  "tags: [one, two]",
  "---",
  "# A title",
  "",
].join("\n");

const next = yield* Frontmatter.set(text, { status: "accepted" }, Shape);
// Only `proposed` became `accepted`. The comment and its three spaces, the folded block and `[one, two]`
// are the same bytes, and so is the body:
// "---\nnumber: 87\nstatus: accepted   # waits for a yes\nsummary: >\n  Data on top\n  and free text below.\ntags: [one, two]\n---\n# A title\n"
// Effect<string, NoFrontmatter | BadFrontmatter, never>, in the span markdown.frontmatter.set
```

## Doubts, at the top

One call is under 80%. The plan takes its lean and goes on.

- **A new reason, `edit`, on `BadFrontmatter` (75%).** `set` checks its own answer by reading it again
  (see "The check after the edit"). When the edit would change data the caller did not set (an alias
  elsewhere uses the old value's anchor), `set` gives no text. No reason of the three fits: `syntax`
  and `value` describe the caller's file, and that file was fine. `edit` says "this change cannot be
  made in this file's text without changing other data". The doubt is the word. The fallback is
  reason `value` with the same message, a one-line change. What would settle it: the review or the lead
  reading the README table.

## What changes, in one paragraph

`Frontmatter.set(text, values, schema)` reads the file as `read` does, decodes it with the Schema,
merges the new values in, encodes the result, and works out which top-level keys changed in the
encoded data. For each changed key it replaces only that value's text, at the place yaml's positions
give. A key the file lacks gets its own lines at the end of the frontmatter. The fences and the body
are never touched. Then it reads its own answer again with the same reading and refuses to answer if
any other data changed. It is an `Effect.fn` with the span `markdown.frontmatter.set`, because decoding
and encoding may need the Schema's services, as `read`'s decoding does. Out of scope: removing a key,
keys below the top level, keeping the old value's quote style, and Records' own call that uses this.

## Searched first

- The ticket whole; issue https://github.com/kamp-us/tea-fabrika/issues/1843 whole (Configuration's
  edit of one key: "every other line and comment stays as it was", and "the whole edited text is
  checked ... before any text comes back", which this plan's check after the edit copies); the answer
  on https://github.com/kamp-us/tea-fabrika/issues/1909 (its "what this cannot tell us" says it never
  tried whether yaml keeps comments and key order when one field is set); decisions 0087, 0089, 0063,
  0047 and 0049.
- The landed package whole: `kalfa/markdown/src/Frontmatter.ts`, its laws, test support, type laws and
  package laws, the README, the glossary and the manifest; the approved plan
  `.kalfa/quests/kalfa-markdown-frontmatter-PLAN.md`. Its review rounds: the pull request says the review
  answered merge-ready twice, at 6a14bf32b with five findings and at 65e64ea26 after one fix round. That
  fix commit is "a non-finite number key is refused, the generators reach the plan's wording, and the
  glossary has Fence". Pull request https://github.com/kamp-us/tea-fabrika/pull/1982 then made
  `plancheck.sh --draft` refuse a class id with no plant, after reviews of 1921, 1922 and 1942 sent work
  back for a generator that missed a class the plan named. So this plan names every class by id, lists
  its members as concrete strings, and gives each id a plant.
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks` and the kalfa
  glossaries for "frontmatter", "every other line", "keep comments" and "one key". Only 0087 and the
  glossaries touch this; none settles how a value is replaced.
- Installed versions in `pnpm-lock.yaml`: `yaml` 2.9.1, `effect` and `@effect/vitest` 4.1.3, `vitest`
  5.0.5. In yaml 2.9.1: `dist/parse/cst.d.ts` (`CollectionItem` with `start`, `key`, `sep`, `value`;
  `SourceToken` types `map-value-ind`, `anchor`, `tag`, `newline`, `comment`), `dist/parse/cst-scalar.d.ts`
  (`setScalarValue` and `createScalarToken`, which say they do no schema work and "won't check for such
  conflicts"), `dist/nodes/Pair.d.ts` (`srcToken?: CollectionItem`), and `dist/options.d.ts`
  (`keepSourceTokens`, `collectionStyle`, `flowCollectionPadding`, `indentSeq`, `lineWidth`). In Effect
  4.1.3: `Schema.ConstraintCodec<T, E, RD, RE>`, `Schema.encodeEffect`, `Schema.decodeUnknownEffect`, and
  `Equal.equals`. `tsconfig.base.json` sets `exactOptionalPropertyTypes`, so `Partial<T>` takes no
  `undefined`.
- npm search from this machine gave no answer, so the npm tools below are from memory and marked so.

## Trials run while planning

Small scripts in a scratch folder against the installed `yaml` 2.9.1 and `effect` 4.1.3. Nothing in the
repo ran or changed. Each fact is a trial result.

- **yaml's own document set reflows other lines.** `parseDocument` of the opening block's frontmatter,
  then `doc.set("status", "accepted")` and `toString`: the folded block came back as one line, `[one, two]`
  as `[ one, two ]`, and `   # waits` as ` # waits`. This is the ticket's trial, repeated.
- **Where yaml's positions put a value.** A value node's `range` is `[start, valueEnd, nodeEnd]`.
  `valueEnd` stops before a comment after the value (`1 # c` gives `1`). A block scalar's text runs from
  its `>` or `|` through its last line break. A block list or map runs from its first item through its
  last line break, and a comment after its last item on the same line is inside it. A comment line
  after the block, at a lower indent, and blank lines are outside it. A tag or an anchor is not in the
  range (`!!str 87` gives `87`); the CST's `sep` tokens hold their offsets, after the `map-value-ind`.
  An empty value (`k:`, `k: `, `k: # c`) has an empty range. `? a` with no value has no
  `map-value-ind` and no value node. Offsets are JavaScript string indexes, as `slice` uses.
- **A prototype of the splice.** 28 hand cases, each read back with the same reading: plain, quoted,
  folded and literal values; flow and block lists and maps; compact lists at the key's column; empty
  values; a value on the next line under an own-line comment; tags; an unused anchor; an alias value;
  an indented top map; a top-level flow map with and without a trailing comma; CRLF; an explicit key;
  quoted keys; empty and comment-only frontmatter; `|+`. Every case gave the asked data with every
  other byte kept, except two the check after the edit must refuse: setting the value that holds
  `&x` while `*x` is used elsewhere (yaml reads it with no error, and `toJS` throws `Unresolved alias`),
  and adding a key after a `...` line (`MULTIPLE_DOCS`).
- **Writing one value.** With the write options plus `collectionStyle: "flow"` and
  `flowCollectionPadding: false`, the pair `{ k: value }` is written `{k: <value>}` on one line, even
  for a list of 60 items and a key of 1,100 characters, and the long-key form reads back with no error.
  Texts that would read as another type or break a flow context come out quoted (`"true"`, `"a,b"`,
  `"- a"`, `"-0"`); `-0` as a number is `-0`.
- **Equality.** `Equal.equals` in Effect 4.1.3 compares plain objects and lists by structure, ignores
  key order, and treats `0` and `-0` as equal. `Schema.toEquivalence(Schema.Json)` does the same.

## How others do it

- **yaml's own answer** (read in the installed d.ts): the Document API keeps comments but writes the
  whole document again (the trial above). For exact edits the library offers the CST:
  `CST.setScalarValue` and `CST.stringify`, for scalars only, with no check that the new text reads as
  the asked type. So the library's makers point to positions and the CST for format-keeping edits, and
  leave the type safety to the caller. This plan uses the CST only to find offsets, and its own writer
  for the new text.
- **VS Code's `jsonc-parser`** (from memory, not fetched): `modify(text, path, value, options)` answers a
  list of edits, each `{ offset, length, content }`, that replace only the value's range, and
  `applyEdits` applies them. A new property is inserted with the caller's formatting options. This is
  the shape this plan copies for YAML.
- **Rust's `toml_edit`**, used by `cargo add` (from memory): a format-keeping document; a set value gets
  default spacing and every other byte stays.
- **Python's `ruamel.yaml`** and **Go's `yaml.v3` node API** (from memory): both keep comments but write
  the whole document again, so spacing can change. The ticket rules that out.
- **Configuration's own edit**, issue 1843: set or remove one key of a TOML file, "every other line and
  comment stays", and the whole edited text is checked before any text comes back.
- **Elm** (from memory): a pure function from text to `Result Error String`; nothing here runs or waits,
  so no Erlang/OTP answer applies. `set` is an Effect only because the caller's Schema may need services
  to decode or encode, the same reason `read` is one (decision 0063 names the span).

## The shape

### The call

```ts
// kalfa/markdown/src/Frontmatter.ts, a sketch. Doc blocks left out. Nothing here was type-checked.

export const set = Effect.fn("markdown.frontmatter.set")(function* <
  S extends Schema.ConstraintCodec<{ readonly [key: string]: unknown }, unknown, unknown, unknown>,
>(
  text: string,
  values: Partial<S["Type"]>,
  schema: S,
): Effect.fn.Return<string, NoFrontmatter | BadFrontmatter, S["DecodingServices"] | S["EncodingServices"]> {
  // 1. Cut: the frontmatter's start and end offsets in `text`, by `split`'s rule. None is NoFrontmatter.
  // 2. Read it with READ plus `keepSourceTokens: true` (the same reading; source tokens change no value):
  //    syntax or value, exactly as `read` refuses.
  // 3. Decode its JSON with the Schema: a refusal is schema. Set only edits a file that passes.
  // 4. Encode the old data and `{ ...old, ...values }`; each must be a JSON object: schema, then value.
  // 5. Changed keys: each key of the new encoding that the old encoding lacks, or whose value is not
  //    `Equal.equals` the old one. None changed: answer `text` as it is.
  // 6. One edit per changed key the map has, and one append for the keys it lacks.
  // 7. Apply the edits from the last offset to the first. Answer: text before the frontmatter, the edited
  //    frontmatter, text after it. The fences and the body are slices of `text`, never rebuilt.
  // 8. The check after the edit; any miss is BadFrontmatter reason edit, with no text.
});
```

- `values` is `Partial<S["Type"]>`: typed data, as `write` takes, so a caller sets `{ status: "accepted" }`
  and the Schema does the encoding. With `exactOptionalPropertyTypes`, `undefined` cannot be passed, so
  `set` never removes a key.
- Changed keys come from the **encoded** data, old against new, never from the file's text. So a value
  the Schema reads one way and writes another (`count: "1.50"` with `Schema.FiniteFromString`) keeps
  its text unless the caller changes it, and a key the Schema renames is found by its file name.
- A key the Schema ignores (an extra key in a Struct's file) is in neither encoding, so it stays.
- Only top-level keys. A key is found by the text `keyText` already gives it (`"q k"`, `'1'` and `1`
  are the keys `q k`, `1` and `1`), so a quoted or explicit key is found.

### BadFrontmatter gains one reason

```ts
reason: Schema.Literals(["syntax", "value", "schema", "edit"]),
```

`edit`: the change cannot be made in this file's text without changing other data, or the pair has no
`:` to set a value after (`? a`). `message` names the keys, never their values. No `line`.

### A value's text, and where the new text goes

A value's text is the bytes the edit replaces. It runs from the value's first tag or anchor (the CST
`sep` tokens after the pair's `:`), else from the value's start, to the value's end (`range[1]`). So a
comment after the value stays, a block value's last line break is inside it, and a comment inside an
old block value (after its last item, or between its items) goes with the old value.

```ts
// A sketch: where the new text goes, from yaml's positions.
type Place =
  | { readonly _tag: "Empty"; readonly at: number }   // no value text: insert " " + one line right after the `:`
  | { readonly _tag: "Inline" }                        // the value starts on its key's line, or the top map is flow
  | { readonly _tag: "Below"; readonly column: number } // the value starts on a later line, at this column

interface Edit {
  readonly from: number; // offsets in the frontmatter's text
  readonly to: number;
  readonly text: string;
}
```

- **Inline**: one line. A text, number, boolean or null is written as `write` writes it (quoted when
  it would read as another type, double-quoted when it has a line break or starts with U+FEFF). A list
  or map is written in flow style with no inner padding: `[a, b]`, `{x: 1}`, `[[a], {x: [1]}]`. One
  writer makes all of it: the pair `{ k: value }` under the write options plus `collectionStyle: "flow"`
  and `flowCollectionPadding: false`, cut to the text after `{k: ` and before `}`.
- **Below**: a non-empty list or map is written in block style, its lines indented to the place's
  column; anything else is written as one line there. The column is the old value's column, or two past
  the key's column when the old value was a compact list at the key's column and the new value is not a
  non-empty list.
- **Empty**: `k:` becomes `k: x`, `k: ` becomes `k: x ` and `k: # c` becomes `k: x # c`.
- When the old text ended with a line break, the new text ends with one too.
- **The line break** of every new line is the file's: `\r\n` when the opening fence is `---\r`, else `\n`.
- **A key the map lacks** is written as `write` writes the pair, at the column of the map's first key (0
  when there is no pair), and its lines go at the very end of the frontmatter, after any last comment.
  Several such keys go in one append, in the new encoding's key order. In a top-level flow map they go
  after the last pair's value as `, k: v`, or right after `{` when the map is empty.

### The check after the edit

Issue 1843's rule: the whole edited text is checked before any text comes back. `set` reads the edited
frontmatter with the same reading and asks three things.

1. It reads clean: no error, no warning, no refused key, no throw from `toJS`.
2. Every key that is not changed reads `Equal.equals` what it read before, and every changed key reads
   its new encoded value. No key appears or goes beyond the ones set.
3. The Schema still decodes it.

A miss on 1 or 2 is reason `edit`; a miss on 3 is reason `schema`. This is what turns the two hard
cases the trial found (an anchor another key's alias uses, a key added after `...`) into a refusal in
place of a wrong file, and it holds any case no law reached.

## One value traced

The opening block's file, `Shape` and `{ status: "accepted" }`.

1. The first line is `---`, so the frontmatter starts at offset 4 and ends before the next `---` line.
2. yaml reads it with no error into a map of four pairs. Its JSON is `{ number: 87, status: "proposed",
   summary: "Data on top and free text below.\n", tags: ["one", "two"] }`, and `Shape` decodes it.
3. The old encoding and the encoding of `{ ...old, status: "accepted" }` differ at `status` only.
4. The `status` pair: its `sep` holds `map-value-ind` then a space, no tag and no anchor. Its value's
   text is `proposed` (from `range[0]` to `range[1]`); the three spaces and `# waits for a yes` are after
   `range[1]`. It starts on the key's line, so the place is Inline. The writer gives `accepted`.
5. One edit, `proposed` to `accepted`. The answer is the text before offset 4, the edited frontmatter,
   and the text from the closing fence on: the folded block, `[one, two]` and the body are slices of
   the input.
6. The check reads the new frontmatter: `number`, `summary` and `tags` read as before, `status` reads
   `accepted`, and `Shape` decodes it. The Effect succeeds with the new text, inside one span,
   `markdown.frontmatter.set`, with no attribute.
7. With `{ tags: ["one", "two", "three"] }` instead, the place is Inline and the text is
   `[one, two, three]`. With `{ number: 1.5 }` the encoding fails: `BadFrontmatter` reason `schema`, no
   text. If the file had held `base: &b [1]` and `copy: *b`, setting `base` would make `copy` unreadable,
   so the check answers reason `edit` and no text.

## Generators

Every generator is an Effect `Arbitrary` in `kalfa/markdown/src/Frontmatter.set.test-support.ts`, built
on the pools the 1926 support already draws (its text groups, key groups, `NUMBERS`, json skeletons,
`bare`, `broken`, `unread` and body variants). As in 1926, each run checks every class below, not left to
chance: each run builds one variant per class from its drawn seeds, a law keeps the ids it checked, and a
law fails when an id is missing or a variant's pool does not hold what its class says. Each id has a
plant in the laws table.

A **typed file** is a frontmatter as a person types it, built from pieces: for each pair its head (the
indent, the key's text, the `:` and the gap), its value's text by the rule in "A value's text", its tail
(a comment after the value and the line break), and the data it reads as; plus comment and blank lines
between pairs. The support knows each value's text span, so a law can say which bytes may change.
The old forms a set value can have:

- (a) plain scalars: `word`, `87`, `0146`, `-1.5`, `true`, `false`, `~`, `null`, and `two words here`.
- (b) quoted scalars: `'x'`, `'it''s'`, `''`, `"x"`, `"a\"b"`, `"tab\there"` and `""`.
- (c) block scalars: `>`, `>-`, `|`, `|-` and `|+`, each with one to three content lines, one of them
  the last value before the closing fence.
- (d) flow collections: `[a, b]`, `[ a,b ]`, `[]`, `{x: 1}`, `{ }`, `[a, [b, c]]`, `{x: [1, {y: 2}]}`, and
  `[a,` with `  b]` on the next line.
- (e) block lists: two past the key's column (`  - a`) and compact at it (`- a`), each with a list inside
  a list and a list of maps.
- (f) block maps: one and two levels deep under the key.
- (g) empty values: `k:`, `k: ` with its trailing space, and `k: # note`.
- (h) a value on a later line: `k:` then `  text`, `k:` then `  "q"`, `k:` then `  # note` then `  - a`,
  and the plain text `k: a` then `  b`, over two lines.
- (i) a comment after a value, after one space, three spaces and a tab: `1 # c`, `[a, b]   # c`,
  `"x"` then a tab then `# c`.
- (j) comment lines and blank lines: before the first pair, between pairs, after the last pair, and an
  indented comment line under a block value.
- (k) props on a value: `!!str 87`, `!!int 3`, `!!str` alone, an anchor nothing uses (`&a 1`), and an
  alias value `*b` whose anchor sits at a key that is not set.
- (l) key forms: `"q k"`, `'s k'`, `? long` then `: 1`, `a b`, the number key `1`, `true` as a key, and
  keys from every 1926 key group.
- (m) a top-level map indented two spaces.
- (n) a top-level flow map: `{a: 1, b: [2]}`, `{a: 1,}` and `{}`.
- (o) CRLF: both fences and every line end with `\r\n`.
- (p) a frontmatter with no pair: empty, blank lines only, and comments only.

What a call sets:

- (q) scalars of every JSON kind: null, true, false, every number in 1926's `NUMBERS`, and texts from
  every 1926 text group, a to j.
- (r) lists: empty, flat, nested three deep, a list of maps, and a list of 60 items.
- (s) maps: empty, nested three deep, and keys from every 1926 key group, keys over 1,024 characters
  included.
- (t) no change: the value the file already holds, and under S3 a number whose file text differs from
  its writing (`count: "1.50"`, set to 1.5).
- (u) a key the file lacks: alone, beside replaced keys, and two at once.
- (v) how many keys: one, two to five, and every key of the file.

What `set` must refuse:

- (w) the Schema refuses: the new value (S2's `number` at 1.5 or 0, a `status` outside its three) or the
  file as it is (S2 with `number: '87'`).
- (x) the edit cannot keep other data: the set value holds an anchor that an alias elsewhere uses, a
  `...` line before the closing fence when a key is added, and an explicit key with no `:` (`? a`).
- (y) no frontmatter to set: 1926's `bare` files, its `broken` files and its `unread` files.

The rest of the file:

- (z) every 1926 body group in every run: a body that starts with or holds `---` lines, a body that is a
  whole file with its own frontmatter, no final line break, only `\r\n` line ends, a heading, and a code
  fence that holds a `---` line.

The Schemas are 1926's: S1 `Schema.JsonObject`, S2 the decision-like Struct, S3 with
`Schema.FiniteFromString`, and S5 made from a JSON Schema file. A typed file for S2, S3 or S5 types each
field in a form its type allows (`number` as `87` or `!!int 87`, `tags` as a flow or block list, `meta`
as a flow or block map), so the forms reach the typed Schemas too.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| E1, the ticket's file: a frontmatter with a comment after a value, a folded `>` block and a flow list `[a, b]`; setting one key gives exactly the expected text, every other line equal byte for byte | test | scenario: the ticket's file, written in the test | write the edited yaml Document with its own `toString`: the folded block and `[a, b]` reflow, red | kalfa/markdown/src/Frontmatter.set.test.ts |
| E2, every other byte kept: for a typed file, a body and values from the set classes under S1, the answer is the old text with only each changed key's value text replaced and the new keys' lines added at the end of the frontmatter: every byte outside those spans, in order, is the old byte. 300 runs, every class reached in every run | test | Effect Arbitrary: typedSets | start a later-line value's text at the end of its key's `:`, so `  # note` goes, (h) red; end a value's text at yaml's node end, so `# c` goes, (i) red; rebuild the frontmatter from the pairs' own texts, so comment and blank lines go, (j) red | kalfa/markdown/src/Frontmatter.set.test.ts |
| E3, it reads back: for the same inputs under S1, S2, S3 and S5, `set` succeeds and `read` of its answer gives data `Equal.equals` to `{ ...old, ...values }`. 300 runs, every class reached | test | Effect Arbitrary: typedSets | end a value's text at its first space, (a) red; for a quoted value, end its text at its start plus its read text's length, (b) red; for a block scalar, end its text before its last line break, (c) red; for a flow collection, end its text at its first `]` or `}`, (d) red; write a new map at a compact list's column with no added indent, (e) red; end a block map's text at the end of its first line, (f) red; insert at an empty value's place with no space, (g) red; start a value's text after its tag or anchor, (k) red; find a key by its source text, not its read text, (l) red; put new keys at column 0, (m) red; append a new key as a new line in a flow top map, (n) red; take new keys' column from the first pair and fail when there is none, (p) red; write a new text plain when the old value was plain, (q) red; skip a key the file lacks, (u) red; apply the edits from the first offset to the last without moving later ones, (v) red | kalfa/markdown/src/Frontmatter.set.test.ts |
| E4, the body for any body: for a typed file and any body from 1926's body groups, the answer's text after its closing fence equals the body byte for byte, and both fence lines are the old ones. 300 runs | test | Effect Arbitrary: bodySets | find the closing fence by the last fence line, not the next, (z) red | kalfa/markdown/src/Frontmatter.set.test.ts |
| E5, no change gives the same text: setting values whose encoding equals the file's gives the input text unchanged, byte for byte, under S1 and S3. 200 runs | test | Effect Arbitrary: sameSets | edit every key in `values`, changed or not, so `'x'` becomes `x`, (t) red | kalfa/markdown/src/Frontmatter.set.test.ts |
| E6, line breaks: in a CRLF file every line the answer adds or changes ends with `\r\n` and no lone `\n` appears; in an LF file no `\r` appears that the old text or the value lacks. 200 runs | test | Effect Arbitrary: crlfSets | write `\n` in new lines whatever the file uses, (o) red | kalfa/markdown/src/Frontmatter.set.test.ts |
| E7, refusals give no text: each `refused` case fails, with `BadFrontmatter` reason `schema` for the Schema cases, reason `edit` for the cases that cannot keep other data, `NoFrontmatter` for a bare file, and `syntax` or `value` as `read` gives for a broken or unread file. 200 runs | test | Effect Arbitrary: refusedSets | encode after the edit, so a refused value still gives text, (w) red; merge onto the file's raw data without decoding it, so a file S2 refuses gets text, (w) red; drop the check after the edit, so the anchor case answers a text that does not read, (x) red; treat a file with no frontmatter as an empty one, (y) red | kalfa/markdown/src/Frontmatter.set.test.ts |
| E8, the span: under a recording tracer, `set` ends exactly one span named `markdown.frontmatter.set`, on success and on each failure, and no attribute or event holds a marker text put in the file's frontmatter, body, keys or values. 100 runs | test | Effect Arbitrary: tracedSets | call `read` inside `set`: two spans, red; annotate the set keys on the span: red | kalfa/markdown/src/Frontmatter.set.test.ts |
| E9, how a new value is written: in an Inline place it is one line, and a list or map is flow with no inner padding (`[a, b]`, `{x: 1}`); in a Below place a non-empty list or map is block, with every line at the place's column or deeper. 200 runs | test | Effect Arbitrary: placedSets | leave yaml's flow padding on, so `[ a, b ]`, (r) red; indent only the first line of a new block value, (s) red | kalfa/markdown/src/Frontmatter.set.test.ts |
| T2, the types: `set(text, values, S)` is `Effect<string, NoFrontmatter \| BadFrontmatter, S["DecodingServices"] \| S["EncodingServices"]>`; a value of the wrong type, a key outside a Struct's fields, and `undefined` for an optional field do not compile | type | type | type `values` as `Schema.JsonObject`: its `@ts-expect-error` lines are unused, red | kalfa/markdown/src/Frontmatter.types.test.ts |

**Lint, type or test?** T2 is a shape the compiler sees: type. E1 to E9 are about the bytes and data a
call gives, which no lint rule or type sees: tests. No law is lint: `set` adds no import, no file and
no rule row; the 1926 lint laws L1 to L4 hold the new code as they hold the old.

**Where they run.** Every law runs in memory on every pull request. None needs launchd, the real
Electron app, a real OS process or socket, or a real signal, so none is host-only and none waits on the
owner's Mac. No law is a `*.integration.test.ts` file. E1 is a fixed input written in the test, labeled
`scenario`; no fixture stands in for a tool's output. No secret flows through the package, so no law is
a `[secrets]` law; E8 keeps file text out of the span, as decision 0063 keeps message text out by
default. 1926's laws F1 to F13, T1, P1 and P2 must stay green: `parse` gains a way to hand back the
yaml document, and the reading does not change.

## What fact is lost if it is not recorded now

None. `set` stores nothing and keeps no log. The facts worth keeping are its rules (which bytes change,
where new keys go, what it refuses), and the README and the pull request body record them now.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/markdown/src/Frontmatter.ts | build | 200 | `set` with its doc block; `parse` also answers the yaml document read with source tokens; the place, edit and inline and block writers; the check after the edit; `edit` added to the reasons. Its words stay clear of P2's list |
| kalfa/markdown/README.md | build | docs | `set` in the calls, its rules (what changes, where new keys go, the line break, what it refuses), the `edit` row in the reason table; the last paragraph no longer says set comes later |
| kalfa/markdown/src/Frontmatter.set.test-support.ts | tests | tests | new: typed files, the set and refused generators, the class list and its reach check |
| kalfa/markdown/src/Frontmatter.set.test.ts | tests | tests | new: E1 to E9 |
| kalfa/markdown/src/Frontmatter.test-support.ts | tests | tests | exports the pools the set laws reuse; what 1926's laws draw does not change |
| kalfa/markdown/src/Frontmatter.types.test.ts | tests | tests | T2 |
| kalfa/markdown/src/Frontmatter.test.ts | tests | tests | no change expected: F1 to F13 stay green |
| kalfa/markdown/src/Package.test.ts | tests | tests | no change: P1 and P2 hold as they are |
| pnpm-lock.yaml | tests | tests | no change: read for the installed versions; no dependency is added |
| tsconfig.base.json | tests | tests | no change: read for `exactOptionalPropertyTypes` |

## Existing tools

- `set` and its helpers, new functions in `kalfa/markdown/src/Frontmatter.ts`: searched yaml 2.9.1's
  Document API (`doc.set`, `setIn`: reflows other lines, trial above), its CST helpers (`setScalarValue`,
  `createScalarToken`, `CST.stringify`: scalars only, with no check of the read type, so a list or map
  value and `"true"` as text would need our own writer anyway), and the package's own `write` (whole
  frontmatter only). On npm, from memory since search did not answer here: `jsonc-parser` (JSON only),
  `yawn-yaml` (js-yaml based, a second reading). None replaces a value's text by position with this
  package's reading, so `set` is new, built on what ships: yaml's `parseDocument` with `keepSourceTokens`,
  node `range`, `Pair.srcToken` and `Document` with the write options; Effect's `Effect.fn`,
  `Schema.decodeUnknownEffect`, `Schema.encodeEffect`, `Schema.JsonObject` and `Equal.equals`. It reuses
  `split`'s fence rule, `parse`, `keyText`, `quoted`, `WRITE` and `bad` from the same file.
- The inline writer: searched for a yaml call that writes one value in a given context; none is public,
  so it writes the pair `{ k: value }` and cuts it, which is exact because `k` is a fixed one-letter key.

## Calls taken

- **`set` replaces only each changed value's text, found by yaml's positions, 90%.** The ticket's rule;
  the trial shows yaml's own set reflows other lines.
- **The check after the edit, 90%.** Issue 1843's rule. It is the one guard that holds every case no law
  reached, for the cost of one more read of a small block.
- **`set` takes typed data, `Partial<S["Type"]>`, and works out changed keys from the encodings, 85%.**
  A caller holds typed data (as `write` takes it), and a value the Schema writes differently from how a
  person typed it keeps its text.
- **The file must pass the Schema before a set, 80%.** The ticket says the result "still passes the
  Schema", and merging typed data needs the old data typed. The cost: a file that fails its Schema
  cannot be fixed with `set`; `write` remains for that.
- **An Effect with the span `markdown.frontmatter.set`, 85%.** Decoding and encoding may need the
  Schema's services, as `read`'s decoding does; the name follows `markdown.frontmatter.read`.
- **Top-level keys only, and no removal, 85%.** The ticket says keys; decision 0087 says Records "sets
  fields". Removal is not asked, and `exactOptionalPropertyTypes` keeps `undefined` out of `values`.
- **The new value's text is written by the package's one writer, not in the old value's style, 80%.**
  One writer keeps one reading for both directions (0087). A plain `word` set to the text `true` must be
  quoted anyway. A later ticket can keep a quote style where it is safe.
- **Inline places get one line and flow style; Below places get block style, 80%.** A value typed on
  its key's line stays on it, a value typed below stays below.
- **A comment inside the old value's text goes with it, 85%.** It is that value's text. Comments after
  the value, and every comment line outside it, stay.
- **New keys go at the end of the frontmatter, after any last comment, at the first key's column, 80%.**
  It changes no old byte, and it is where a person adds a line.
- **`0` and `-0` are the same value for "changed", 80%.** That is how `Equal.equals` reads JSON. Setting
  `-0` where the file holds `0` keeps `0`.
- **Keep `set` in `Frontmatter.ts`, 80%.** It needs the file's private reading parts (`parse`,
  `keyText`, `quoted`, `WRITE`); a second module would have to export them. The file grows to about
  510 lines.
- **Is any of this a setting? No.** The line break, the place rules and the writer must be the same for
  every caller, or two tools write one file two ways, the reason 0087 gives the package one reading. No
  setting is declared, so decision 0089 does not apply.

## Validation

- Tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3 kalfa/markdown` shows E1 to E9 red on the
  missing `set`, and F1 to F13, P1 and P2 green. Each plant runs once, by hand, and is undone; the
  reach table names each class id, the law that reached it and its plant seen red. Generators use
  Effect's `Arbitrary`, so `fabrika/prefer-schema-arbitrary` stays quiet.
- Build step: the same vitest path green, `pnpm format`, `pnpm lint`.
- The lead runs `pnpm typecheck`, which holds T2, and the `--changed origin/main` run at the end. No
  lockfile change, so that run stays narrow.

## Size

1. One slice, `set`: about 200 lines in `Frontmatter.ts`, plus E1 to E9, T2, the set generators and the
   README. It lands whole: a caller can set values in a frontmatter and keep every other byte.

About 3 agent hours across the steps, 75% sure. The doubt is the generators again: the typed file model
with 26 classes, each reached in every run, is the larger half, and 1926 needed a fix round on exactly
that. Budget basis: the 1926 plan's $24 for four steps; this one adds about $1 a step for the typed file
model. Tests, build, review and one likely send-back.

Estimate: 4 steps, $28

## New names

- `Frontmatter.set`: the ticket's verb, and Records' ("sets fields").
- `edit`: a new `BadFrontmatter` reason.
- `markdown.frontmatter.set`: the span.
- `Place` with `Empty`, `Inline` and `Below`, and `Edit`: code names inside `Frontmatter.ts`, not
  exported, not domain words.

No new domain word: Frontmatter, Fence and Body are in the glossary, and the plan coins none.

## Records

- `kalfa/markdown/README.md`: `set`, its rules, and the `edit` reason, in the build.
- No glossary term, no decision record: decision 0087 holds that one package owns the reading, and the
  ticket and this plan pick how a set keeps the rest. 0087's line "Whether it keeps comments and key
  order when one field is set was not tried" is answered by the trial above; see Findings.
- No pattern doc: Records is the first caller and shows whether "set data in a file a person types"
  needs one.

## What this cannot tell us

- Whether people like a set value written in the package's style when they typed it another way
  (`'x'` set to `y` becomes `y`).
- How Records fixes a record that fails its shape: `set` refuses such a file. `write` rewrites the whole
  frontmatter.
- Whether Records needs to remove a field or set a field below the top level. Neither is built.
- Whether the check after the edit ever fires on a file people really type. It fires on the two hard
  cases the trial found; no law can show it never fires elsewhere.
- Which line an `edit` or `schema` refusal is on: neither gives one, as in 1926.

## Open questions

None.

## Findings

1. **Decision 0087 still says set was not tried.** Its consequence "Whether it keeps comments and key
   order when one field is set was not tried" (`.kalfa/decisions/0087-a-record-is-data-on-top-and-free-text-below.md`)
   is answered: yaml's own document set keeps comments and key order but reflows folded blocks, flow
   lists and comment gaps (the ticket's trial and this plan's). The README records how `set` keeps them.
   Whether a decision's consequence line gets updated is the lead's call; no ticket asked here.
2. **Set never removes a key.** Configuration's edit (issue 1843) offers set and remove; this ticket asks
   only set. If Records' "set fields" includes clearing an optional field, it needs a remove call here,
   the same edit with an empty append. No ticket filed: Records' own tickets are still being redrawn.
