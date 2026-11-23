Approved by the lead agent, builds issues 1749, 1844; body 222b32ee80c2
Plancheck-Version: 3

# Plan: edit a whole record (ticket 1844)

This is the kalfa packages, `kalfa/config`, new work. It is neither today's frozen version nor `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/1844, under
[Configuration's protocol](https://github.com/kamp-us/tea-fabrika/issues/1749) and
[its follow-up](https://github.com/kamp-us/tea-fabrika/issues/1806), whose rulings 4 and 5 this builds. Words:
`kalfa/config/GLOSSARY.md`. It extends the edit of ticket 1843 (approved plan `.kalfa/quests/kalfa-config-edit-PLAN.md`):
the same `SettingGroup.edit(group, text, file).set(setting, value)`, the same checks before and after the splice, and
the same reasons. What changes is inside the TOML format: a record written over several lines is no longer refused
`edit`, it is compared key by key. One pull request, about 200 product lines.

```ts
// The whole idea, a sketch. Nothing here was type-checked.
const refRule = Setting.make("reconciliation.ref-rule", RefRules).pipe(Setting.withDefault({}), Setting.files(["repo"]))
const Demo = SettingGroup.make("demo", refRule, approver)

const text = [
  "[reconciliation.ref-rule.main]",
  'source = "codehost"   # read from the host',
  "",
  "# Old release branch, going away.",
  "[reconciliation.ref-rule.release]",
  'source = "codehost"',
  "",
].join("\n")

// The caller passes the whole new record. Today this fails `edit`: the setting is not one key in the text.
yield* SettingGroup.edit(Demo, text, "repo").set(refRule, {
  main: { source: "codehost" },              // the same: its lines are not touched
  dev: { source: "codehost" },               // new: its own header, after its siblings
})                                           // release: gone, with the comment right above its header
// '[reconciliation.ref-rule.main]\nsource = "codehost"   # read from the host\n\n' +
// '[reconciliation.ref-rule.dev]\nsource = "codehost"\n'
// Effect<string, SettingsError>, as today
```

## Lead's calls at signing (2026-11-23)

The lead read the four 75% calls below.

1. **Only a table written over several lines is compared key by key:** kept as written.
2. **An array of tables that differs: changed.** It comes back as `[[name]]` blocks, not as one inline array. Why: the
   edit promises that every line it does not need to touch keeps its form, and turning a person's blocks into an
   inline array rewrites the look of their file. An array that was inline stays inline. The call below is rewritten to
   say this, and law RC7 with classes (k) and (z) holds both forms. Cost: about 25 more product lines (`internal/edit.ts`
   15, `internal/toml.ts` 10), so 197 in all. No new law id, and the run caps hold: RC7 stays within at most 10 sets and 4 starts a run.
3. **A new record item next to items under their own headers gets its own header:** kept as written.
4. **A dotted-key table that leaves takes its whole lines:** kept as written.

## Calls under 80%, read these first

The plan takes each lean and goes on. Each is how the code does what rulings 4 and 5 say; none is a question for the
owner. Call 2 is as the lead changed it at signing.

- **Only a table written over several lines is compared key by key (75%).** A table under its own header, under
  headers of its keys, or written by dotted keys is compared key by key. An inline table is one value, so it is
  replaced whole, as an array is, even when TOML 1.1 lets it run over several lines with comments inside. Why: an
  inline table on one line changes one line either way, and a member-by-member edit of a multi-line inline table puts
  a new member before its closing brace with no line break (toml-patch does that, see below). Cost: a person's
  multi-line inline table comes back on one line, its comments kept on lines above the key, as today's set keeps
  them. What settles it: the lead's read, or the first real kalfa config that holds one.
- **An array is replaced whole in the form it had (the lead's call at signing).** An inline array that differs is one
  new inline value in its place, as today. An array of tables that differs is replaced whole as `[[name]]` blocks:
  the old blocks leave with the comments inside them, and the new blocks are written where the first old block
  started, one `[[name]]` header per element, a line per key, and a `[name.key]` header for each non-empty record
  inside an element. The comment lines right above the first old block stay: they describe the array, which stays.
  Only when the new array cannot be blocks (it is empty, or holds an element that is not a record) is it written
  inline in the first block's place. Why: ruling 4 replaces an array whole, and the edit keeps the form of what it
  rewrites. Cost: about 25 product lines.
- **A new record item beside items under their own headers gets its own header (75%).** When the record's own table
  has no header and no line of its own and its items sit under their own headers (as
  `[reconciliation.ref-rule.main]`), a new item is written the same way: its header right after the last block under
  that table, a line per key, and a header of its own for each non-empty record below it. Anywhere else a new key goes
  where today's one-key set puts it. Why: today's set would put `reconciliation.ref-rule.dev = { … }` above the first
  header of the file, far from its siblings, and toml-patch does the same. Separable: striking it leaves new items
  where today's set puts them, and only RC1's bytes and RC2's (j) change.
- **A dotted-key table that leaves takes its whole lines (75%).** Each line that holds its data goes, with the comment
  after the value and any comment inside the value. An own-line comment between its dotted lines stays: no header owns
  it. Why: ruling 5 says the comments inside a leaving table go, and a change request then shows the line gone, not
  turned into a stray comment. The doubt is the own-line comment, which a person might read as the table's.

## Slices

One pull request, branch `fabrikalfa/kalfa-config-record`. It lands whole: the key-by-key compare needs a leaving
table's removal for its gone items, and the remove of a record setting needs the same removal.

## How others do it

Read, unless marked "from memory".

- **Elm (from memory).** The virtual DOM diff compares the old tree with the new one and patches only what differs;
  keyed children are matched by key, never by position. That is the record compare: items are matched by name.
- **Erlang/OTP (from memory).** No tool edits `sys.config` in place; a release ships a whole new file. No answer to
  copy.
- **Effect 4.1.3, read in `kalfa/config/node_modules/effect/src/JsonPatch.ts`.** `JsonPatch.get(old, new)` gives
  `add`, `remove` and `replace` steps by path, recursing into every object and every array by index, keys sorted. Taken:
  steps by path, computed from data. Done differently: arrays are replaced whole (ruling 4), an inline table is one
  value, and a new key keeps the new record's order.
- **toml-patch 3.3.2, already a dependency, read in its README and probed in a scratch script.** Its `patch(text,
  updated)` is a comparing write, and its comment ownership is ruling 5's: "a same-line trailing comment, or a
  line-comment directly above with no blank line in between travels along with it". The probe on a ref-rule file found
  three things that rule it out as the engine: a removed `release` table plus an added `dev` table of the same shape
  came back as `dev` holding `release`'s first lines while `release.desired` stayed, so the data was wrong (see
  Findings); a changed array was edited element by element; and a new item under header-written siblings went to the
  top of the file as `r.rules.dev = { … }`. So the package keeps calling only its `stringify`.
- **Rust's `toml_edit`, used by `cargo add` (from memory).** A table's leading comments are its "decor", so removing
  the table removes them. New tables are placed by a position number, at the end by default.
- **Our own TOML splice, read in `kalfa/config/src/internal/edit.ts` and `kalfa/config/src/internal/toml.ts`.** `set`
  and `remove` change one assignment by its source range and keep a comment inside a replaced or removed value. `check`
  refuses a path that no single assignment holds, which is why a record under its own header fails `edit` today (law
  E9). Sections know where they start and end; `sectionStart` walks up over blank and comment lines alike, which fits
  an insert and does not fit ruling 5's blank-line stop.
- **The 1843 plan's note.** "A record setting written under its own header is refused `edit`. Comparing a whole
  record key by key is 1844's ruling 4." This plan lifts that refusal as planned.
- **1997's ruling (one environment variable per key).** No bearing: an edit reads no environment.

## The shape

### Where the compare lives

1806 said the comparing write is "new code inside the format". It is, behind the format's unchanged signature.

```ts
// kalfa/config/src/internal/format.ts: the interface does not change, only what set and remove promise.
export interface Format {
  readonly name: string
  readonly extension: string
  readonly parse: (text: string) => Result.Result<Document, Fault>
  /** Sets the value at `path`, writing only the keys that differ. An array is replaced whole. */
  readonly set: (text: string, path: ReadonlyArray<string>, value: unknown) => Result.Result<string, Fault>
  /** Takes the key at `path` out, or the whole table there with the comments it owns. */
  readonly remove: (text: string, path: ReadonlyArray<string>) => Result.Result<string, Fault>
}
```

- `kalfa/config/src/internal/change.ts` does not change its steps. Its kept check (the answer holds exactly the old
  data with the one change) and its two whole-file checks guard the compare as they guard a one-key splice.
- **Today's `Toml` service keeps one-key edits.** `kalfa/config/src/TomlParser.ts` serves today's callers, and the
  T877 law L5 in `next/packages/libfabrika/src/settings/TomlEdit.test.ts` pins that its `set` and `remove` refuse a
  table under its own header with `Conflict`. So `internal/toml.ts` keeps today's two functions as `single`, and
  `TomlParser.ts` calls those. `toml`, the `Format` the new API uses, gets the comparing ones. Ticket 1849 deletes
  `TomlParser.ts`, and `single` with it.

### The steps

```ts
// Sketch: kalfa/config/src/internal/edit.ts. A Schema.TaggedUnion, as Fault is.
export const Step = Schema.TaggedUnion({
  Set: { path: Schema.Array(Schema.String), value: Schema.Unknown },
  Remove: { path: Schema.Array(Schema.String) },
  /** An array of tables replaced whole, as [[...]] blocks where its first block started. */
  Blocks: { path: Schema.Array(Schema.String), value: Schema.Array(Schema.Unknown) },
})

/** How the text writes the value at a path. */
type Form =
  | "absent"   // no line holds it
  | "one"      // one assignment holds it whole: a scalar, an array, an inline table, or a key inside one
  | "spread"   // a table no single assignment holds: under its own header, under headers below it, or dotted keys
  | "tables"   // an array of tables, written by [[...]] headers

/** The one-key steps that turn the text's value at `path` into `next`. */
export const plan = (index: Index, path: Path, next: unknown): ReadonlyArray<Step> => {
  const old = read(index.value, path)
  if (equal(old, next)) return []                                  // same data, any spelling or key order
  const form = formAt(index, path)
  if (form === "absent" || form === "one") return [Step.cases.Set.make({ path, value: next })]
  if (form === "spread" && isRecord(next)) {
    // An empty record that nothing would name once its keys go is written `= {}`, so a start reads {} back.
    if (Rec.isEmptyRecord(next) && !named(index, path)) return [remove(path), set(path, {})]
    const kept = Rec.keys(next).flatMap((key) => plan(index, [...path, key], next[key]))   // changed and new
    const gone = Rec.keys(old).filter((key) => !Rec.has(next, key)).map((key) => remove([...path, key]))
    return [...kept, ...gone]                                      // arrivals first: siblings still mark the place
  }
  if (form === "tables" && Array.isArray(next)) return [blocks(path, next)]   // blocks stay blocks
  return [remove(path), set(path, next)]                           // a spread table or [[...]] that changes kind
}
```

- **Data, not text, decides.** `equal` is today's: `1.0` is `1`, and key order carries no data, so a record with its
  keys reordered is no change.
- **Arrivals before departures.** A new item is placed after the last block under its table, so it is written while
  its leaving siblings still mark that place. Within one path a change of kind is always remove, then set.
- **The comparing set** in `internal/toml.ts`: parse; refuse a path that steps through a plain value (`Conflict`, as
  today, which the first whole-file check already reports first); `plan`; then each step on the text the last one
  made, parsed again each time; then the answer parsed once more. A step is today's one-key set, a new block, a leaving table
  or an array's blocks (each below). A one-key set still refuses a spread path, so a wrong plan fails `edit` and never
  writes.
- **The comparing remove:** `absent` gives the same text; `one` is today's one-key remove, which keeps a comment found
  inside the removed value (the ticket's fifth criterion); `spread` and `tables` take the table out.

### A table leaves

```ts
// Sketch: kalfa/config/src/internal/edit.ts. Section gains `start`, the offset of its header line.
/** Where a header's own comment lines start: up over comment lines only, stopping at a blank line or a key. */
const headerStart = (text: string, section: Section): number

/** Takes out every block and every line that holds data under `path`. */
export const removeTable = (text: string, index: Index, path: Path): string
```

- **A block** is a header at or under `path`, its keys, and every line up to the next header's own comment lines. It
  starts at its own `headerStart`. So the comments inside it and the comment lines right above its header go, and a
  comment with a blank line between it and the header stays (ruling 5).
- **The comment block between two tables with no blank line on either side** belongs to the header below it: it goes
  when the lower table leaves and stays when the upper one does. That is "right above its header" read literally, and
  it is toml-patch's comment ownership too. Law RC1 and class (s) settle it, as the ticket's fourth criterion asks.
- **A block that ends the file** also takes the blank lines right above it, so the file does not end in blank lines.
- **A dotted line** of the leaving table, outside its blocks, goes whole with its line break (the 75% call at the top).
- Each other line and byte stays; another setting's table between the record's blocks is never inside a block, since
  a block ends at the next header.

### A new item under its own header

```ts
// Sketch: kalfa/config/src/internal/edit.ts, used by the comparing set for a Set step at an absent path.
/** Writes `lines` as a block right after the last block under `parent`, one blank line before it. */
export const insertBlock = (text: string, index: Index, parent: Path, lines: ReadonlyArray<string>): string
```

- It is used only when the value is a non-empty record and its table (`parent`) has no header and no line of its own
  but has a header below it. `internal/toml.ts` renders the lines with today's `render`: the header, each key that is
  not a non-empty record as `key = value`, then a blank line and a block of its own for each non-empty record below.
  Keys are written as `render` writes them, so `a.b`, the empty key and `雪` are quoted.
- Lines end with the file's own line break.

### An array of tables is replaced in its own form

```ts
// Sketch: kalfa/config/src/internal/edit.ts, for a Blocks step.
/** Takes out the [[...]] blocks under `path` and writes `lines` where the first of them started. */
export const replaceBlocks = (text: string, index: Index, path: Path, lines: ReadonlyArray<string>): string
```

- The old blocks are found and cut as a leaving table's are, except that the first block starts at its header, not at
  its `headerStart`, so the comment lines right above it stay.
- `internal/toml.ts` renders the lines with `render`, as for a new block: per element a `[[name]]` header, a line per
  key that is not a non-empty record, and a `[name.key]` block for each non-empty record in it. One blank line
  separates two elements when the old blocks were separated by one, and none otherwise.
- An empty new array, or one with an element that is not a record, is one `name = [ … ]` line in that place, since
  TOML cannot write it as blocks. Its table must then be the one the first block sat in: when it is not, the line goes
  where a new key goes, as today's set puts it.
- An inline array is never turned into blocks: `form` says `one` for it, and its step is today's one-key set.

## One value traced

The repo configuration, nineteen lines. `refRule` has file scope `["repo"]` and the schema
`Record(String, Struct({ source: String, desired: optionalKey(Struct({ approvals: optionalKey(Int), checks:
optionalKey(Array(String)) })) }))`; `approver` is `delivery.approver`.

```toml
# Reconciliation: what each ref must look like.

# The main branch.
[reconciliation.ref-rule.main]
source = "codehost"   # read from the host

[reconciliation.ref-rule.main.desired]
approvals = 2
checks = ["ci"]

# Old release branch, going away.
[reconciliation.ref-rule.release]
source = "codehost"
# kept for one more week
[reconciliation.ref-rule.release.desired]
approvals = 1
# Who may approve.
[delivery]
approver = "people"
```

`SettingGroup.edit(Demo, text, "repo").set(refRule, { main: { source: "codehost", desired: { approvals: 3, checks:
["ci"] } }, dev: { source: "codehost", desired: { approvals: 1 } } })`:

1. `change.ts` as today: `refRule` is the group's, `repo` is in its file scope, the value passes its schema and
   encodes to the same JSON, the text parses, and the whole file passes with `reconciliation.ref-rule` left out.
2. The format's comparing `set` parses and plans at `["reconciliation", "ref-rule"]`. The old value is a table no
   assignment holds: `spread`. The new one is a record, so its keys are planned.
3. `main`: spread, so its keys. `source` is equal: nothing. `desired` is spread (its own header): `approvals` is one
   assignment and differs: `Set main.desired.approvals 3`. `checks` is equal: nothing.
4. `dev`: absent: `Set dev { … }`. `release`: gone: `Remove release`. The steps are those three, in that order.
5. `Set approvals 3` is today's one-key set: `2` becomes `3`, nothing else moves.
6. `Set dev`: the path is absent, the value a non-empty record, and `reconciliation.ref-rule` has no line of its own
   but has headers below it, so it is a block. The last block under it is `[reconciliation.ref-rule.release.desired]`,
   which ends before `# Who may approve.` (that comment's own section start). The block goes there, after one blank
   line: `[reconciliation.ref-rule.dev]`, `source = "codehost"`, a blank line, `[reconciliation.ref-rule.dev.desired]`,
   `approvals = 1`.
7. `Remove release`: spread, so the table leaves. The block of `[reconciliation.ref-rule.release]` starts at its own
   comment, `# Old release branch, going away.` (no blank line between), and ends at the next header's comment lines,
   so `# kept for one more week` starts the next block, `[reconciliation.ref-rule.release.desired]`. That block ends
   at the start of the next header, `dev`'s, so it takes the blank line step 6 wrote. The blank line after `checks`
   belongs to `main.desired`'s block and stays.
8. The answer parses. `change.ts`'s kept check expects the old data with `reconciliation.ref-rule` set to the new
   record; they agree. The second whole-file check passes. The answer:

```toml
# Reconciliation: what each ref must look like.

# The main branch.
[reconciliation.ref-rule.main]
source = "codehost"   # read from the host

[reconciliation.ref-rule.main.desired]
approvals = 3
checks = ["ci"]

[reconciliation.ref-rule.dev]
source = "codehost"

[reconciliation.ref-rule.dev.desired]
approvals = 1
# Who may approve.
[delivery]
approver = "people"
```

The change request shows `approvals` from 2 to 3, `release`'s six lines gone with both its comments, and `dev`'s five
lines added. `# Who may approve.` sat between two tables with no blank line on either side: it stays with
`[delivery]`, the table below it.

`.remove(refRule)` on the first text takes the four blocks, from `# The main branch.` through `approvals = 1`, and
answers `# Reconciliation: what each ref must look like.`, a blank line, `# Who may approve.`, `[delivery]` and its
key. The top comment stays: a blank line stands between it and `main`'s comment.

## What fact is lost if it is not recorded now

None. The edit is pure and stores nothing. The disk calls' span already records whether the text changed (1843's
`kalfa.config.changed`); which keys of a record changed is in the change request's diff, which git keeps.

## Generators

Every generator is an Effect `Arbitrary` in `kalfa/config/src/SettingGroup.record.test-support.ts`, which builds
typed files from marked pieces as `SettingGroup.edit.test-support.ts` does and reuses its exports (`Reach`, `doSet`,
`doRemove`, `startOn`, `fileName`). Each piece knows its key path and the lines it owns, comment lines included, so a
law can say which lines must stay, go or change. Each run builds one case per class it lists, from the drawn seeds,
never the cross product, and a law fails when a class it lists was not reached.

Where the record sits:

- (a) under its own header, items as inline tables: `[r.rules]`, then `main = { n = 1, m = 2 }`.
- (b) under its own header, items as dotted keys: `[r.rules]`, then `main.n = 1`.
- (c) items under their own headers, the record's table with no header: `[r.rules.main]`, with a deeper one
  `[r.rules.main.desired]`.
- (d) dotted keys under the record's parent table: `[r]`, then `rules.main.n = 1`.
- (e) dotted keys at the root: `r.rules.main.n = 1`.
- (f) mixed: one item under its own header, another as a dotted key under the record's header.
- (g) an inline item written over several lines, as TOML 1.1 allows, with a comment inside it.

What the new record does:

- (h) one key of one item changes.
- (i) an item leaves.
- (j) an item arrives: beside items under their own headers, beside dotted items, and beside inline items.
- (k) an inline array changes: on one line, and over several lines with a comment inside.
- (z) an array of tables changes: an element changed, one added, one gone, a non-empty record inside an element, a
  blank line between blocks and none, a comment right above the first block and comments inside the blocks; and a new
  array that is empty or holds an element that is not a record.
- (l) a value changes kind: a spread table becomes a scalar or an array, and an array of tables becomes a record.
- (m) emptiness: an item becomes empty, and the whole record becomes empty, in forms that would and would not keep a
  line naming it.
- (n) the same data: the same text, `1.0` for 1, `'x'` for `"x"`, and the keys in another order.
- (o) keys that need quotes: `a.b`, the empty key and `雪`, as an item's name and as a key inside one.

Comments around a leaving table:

- (p) comment lines right above its header, no blank line between.
- (q) a comment above its header with a blank line between.
- (r) comments inside it: own lines, after a value, and inside a multi-line array value.
- (s) a comment block between two tables with no blank line on either side, the lower and then the upper one leaving.
- (t) a leaving block that ends the file, with blank lines above it.
- (u) a key written as one assignment whose multi-line array value holds a comment, gone from the record.

Around it:

- (v) another setting's table before, between and after the record's blocks, each with a comment right above its
  header.
- (w) line ends: LF, CRLF, and no final line break.
- (x) secret-looking item names and values.
- (y) a remove of the whole record setting, in each form from (a) to (g).

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| RC1, the traced file: the set and the remove of "One value traced" give exactly the bytes shown there; the same file with the release blocks leaving the other way round (the lower table only, then the upper only) settles the comment between two tables: it leaves with the lower one and stays with the upper one | test | scenario: the traced file, written in the test | write the answer from the parsed document with the serializer, so every comment and blank line goes: red; (s) end a leaving block at the next header, not at that header's own comment lines: `# Who may approve.` leaves with `release.desired`, red | kalfa/config/src/SettingGroup.record.test.ts |
| RC2, only what differs: for a generated record file and a generated new record, `set` succeeds, and the answer's lines are the old lines in order except that the lines a gone or changed key owns are gone and each added line is a changed or new key, a new header, or a blank line before a new block; every line a kept key or another setting owns is the old line, byte for byte. 100 runs, every class listed reached | test | Effect Arbitrary: RecordEdits | (a) take a key that has a header of its own for one value and replace the whole record: every item line is rewritten, red; (b) call a table spread only when a header names it: a dotted item `main.n = 1` is removed and written again as `main = { n = 2 }`, red; (c) take out a leaving item's header line only, so its keys fall into the block above, red; (d) look for a leaving dotted line only inside its own path's block: `rules.old.n = 2` under `[r]` stays, red; (e) put a new dotted item at the end of the file: it lands under the last header, red; (f) decide every item's form from the first item: the dotted item is taken out as a block, with the lines after it, red; (g) compare a multi-line inline item member by member: a new member lands before its closing brace with no line break, red; (h) set the whole item when one of its keys differs: its other lines are rewritten, red; (j) write a new item beside header-written siblings where today's one-key set puts it: it lands above the first header, red; (v) end a leaving block at the next block of the same setting only: another setting's table between the record's blocks goes too, red; (w) end each new block's lines with `\n` whatever the file uses: red | kalfa/config/src/SettingGroup.record.test.ts |
| RC3, it reads back: for the same inputs, a start over in-memory files holding the answer gives the new record, origin that file with the line of the first line that names it, and every other setting's value and origin as before. 100 runs | test | Effect Arbitrary: RecordEdits | (i) skip the keys that are gone: the old item stays and the start reads it, red; (l) set over a spread table without taking it out first: the one-key set refuses and the edit fails `edit`, red; (m) plan the keys of an empty new record written by dotted keys: nothing names it afterwards and the start reads the default, red; (o) write a new header's keys bare: `a.b` reads back as two tables, red | kalfa/config/src/SettingGroup.record.test.ts |
| RC4, a leaving table takes its comments: for generated comment layouts, the set of a record without one item and the remove of the whole setting take out exactly the lines the leaving blocks own (their keys, the comments inside them, the comment lines right above each header) and keep every other line; a start then reads the rest, or the default after a remove. 100 runs | test | Effect Arbitrary: Leaving | (p) start a leaving block at its header: the comment right above it stays, red; (q) walk up over blank lines too, as an insert's section start does: a comment with a blank line between goes, red; (r) take a leaving block's keys out one by one, as a one-key remove does: its own-line comments stay, red; (t) leave the blank lines above a leaving last block: the file ends in blank lines, red; (y) remove a record setting by its own header only: its items' blocks stay, red | kalfa/config/src/SettingGroup.record.test.ts |
| RC5, one key still keeps its comment: a gone item written as one assignment, whose multi-line array value holds a comment, leaves only its assignment, and the comment stays on a line of its own where the key was, as E4 holds for a remove. 100 runs | test | Effect Arbitrary: OneKey | (u) drop the comments inside a removed value on a one-key remove, as a leaving table does: red | kalfa/config/src/SettingGroup.record.test.ts |
| RC6, no change gives the same text: setting the record the file already holds, in any spelling or key order, answers the input byte for byte. 100 runs | test | Effect Arbitrary: Same | (n) compare text, not data, so `1.0` for 1 or a new key order rewrites the line: red | kalfa/config/src/SettingGroup.record.test.ts |
| RC7, an array is replaced whole in its own form: an inline array that differs is one new inline value in the old one's place, a comment inside it kept on the line above its key, and no `[[` header appears; an array of tables that differs comes back as `[[name]]` blocks where its first block started, one per element, reading back as the new array, its inner comments gone and the comment lines above its first block kept; an empty new array, or one with an element that is not a record, is one inline line there; an equal array of either form is not touched. 100 runs | test | Effect Arbitrary: Arrays | (k) diff arrays by index, as Effect's `JsonPatch.get` does: one element of an inline array changes alone, red; (k) write every differing array with the block writer: an inline array of records becomes `[[...]]` blocks, red; (z) write a differing array of tables as one inline array: red; (z) start the new blocks at the first block's `headerStart`: the comment above the array goes, red; (z) write an empty new array as zero blocks: the key vanishes and a start reads the default, red | kalfa/config/src/SettingGroup.record.test.ts |
| RC8 [secrets], values stay out: a secret-looking item name or value never appears in an edit's message or cause, for a refused record (a member of the wrong type, `invalid`) and for the guard's `edit` (a stand-in format whose set also changes another key). 100 runs | test | Effect Arbitrary: HiddenRecords | (x) name the keys that differ in the `edit` message: red | kalfa/config/src/SettingGroup.record.test.ts, kalfa/config/src/internal/change.test.ts |
| S1, changed: its `edit` scene, a record under its own header, leaves the list, since that text now edits; RC8 holds the `edit` reason. Every other scene holds | test | Effect Arbitrary: Hidden | (already planted) | kalfa/config/src/SettingGroup.edit.test.ts |
| O1, the rest holds: E1 to E8, E10 and E11, D1 to D11, today's `TomlParser.test.ts` and the T877 laws L1 to L9 stay green with no edit; L5 keeps holding that today's `Toml` service refuses a table under its own header with `Conflict` | test | pinned: their own generators, unchanged | make `TomlParser.ts` call the comparing set: L5's table under its own header is set, red | kalfa/config/src/SettingGroup.edit.test.ts, kalfa/config/src/SettingGroup.disk.test.ts, kalfa/config/src/internal/change.test.ts, kalfa/config/src/TomlParser.test.ts, next/packages/libfabrika/src/settings/TomlEdit.test.ts |

**Lint, type or test?** Every law is about the bytes and data an edit gives, which no type or lint rule sees: tests.
No type changes, so no type law, and T5's reasons stay as they are. No import changes, so no lint law.

**E9 goes.** It held that a record under its own header, as dotted sub-keys or as an array of tables fails `edit`.
Those texts now edit, and RC2 to RC4 reach each form. Its test and the `tabled` scenes leave
`kalfa/config/src/SettingGroup.edit.test.ts` and `kalfa/config/src/SettingGroup.edit.test-support.ts`, and the id E9
is not reused.

**Where they run.** Every law runs in memory on every pull request: the edit is pure, and a read-back starts over
in-memory files. No `.integration.` law: the format is pure code over a string, so no stand-in is needed at all. No
law is host-only.

**Run time.** Each law stays under about 20 s at full depth, 100 runs, on the laptop. Caps: a record holds at most three
items of at most three keys, nested at most two below an item; a comment layout has at most four comment or blank
lines; RC2 makes at most 16 sets a run, RC3 at most 8 starts a run, RC4 at most 12 sets or removes and 6 starts, RC7 at most 10 sets and 4 starts. RC7's class (z) adds no cap: its arrays hold at most three elements, inside the same record caps.
Each set parses the text once per step plus twice, on files of under 40 lines. The tests step times each new law once
with `FABRIKA_TEST_DEPTH=full` and splits a law by class when it passes 20 s, as the Markdown laws were split.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/config/src/internal/edit.ts | build | 125 | `Step`, `plan` and its form of a path; `headerStart` and `removeTable`; `insertBlock`; `replaceBlocks`; `check` split so the comparing set refuses only a path through a plain value |
| kalfa/config/src/internal/toml.ts | build | 55 | `Section` gains its header's offset; the comparing `set` folds the steps and the comparing `remove` takes a table; a new block's lines and an array's `[[...]]` blocks rendered with `render`; today's two functions kept as `single` |
| kalfa/config/src/TomlParser.ts | build | 3 | calls `single`, so today's `Toml` service does not change |
| kalfa/config/src/internal/format.ts | build | 6 | what `set` and `remove` promise, in their doc comments |
| kalfa/config/src/internal/change.ts | build | 2 | the doc comment: a record is compared key by key |
| kalfa/config/src/SettingGroup.ts | build | 6 | `edit`'s doc: a record set writes only the keys that differ, a leaving table takes its comments, and the `edit` refusal for a record goes |
| kalfa/config/README.md | build | docs | "Change one setting in a file's text": the record compare, a leaving table's comments, and `edit` now only for an answer that would change other data |
| kalfa/config/GLOSSARY.md | build | docs | **Edit** gains one sentence |
| kalfa/config/src/SettingGroup.record.test.ts | tests | tests | new: RC1 to RC8's public half |
| kalfa/config/src/SettingGroup.record.test-support.ts | tests | tests | new: record files from marked pieces, the classes and their reach check, the generators |
| kalfa/config/src/internal/change.test.ts | tests | tests | RC8's guard half: a stand-in format and a secret key |
| kalfa/config/src/SettingGroup.edit.test.ts | tests | tests | E9 deleted; S1's `edit` scene leaves |
| kalfa/config/src/SettingGroup.edit.test-support.ts | tests | tests | `tabled` goes, `hiding` loses its `edit` scene, and the pieces the record support reuses are exported |
| kalfa/config/src/SettingGroup.disk.test.ts | tests | tests | O1: no change, stays green |
| kalfa/config/src/TomlParser.test.ts | tests | tests | O1: no change, stays green |
| next/packages/libfabrika/src/settings/TomlEdit.test.ts | tests | tests | O1: no change; L5 pins today's one-key refusal |

No change to `kalfa/config/src/index.ts`, the package manifest or the lockfile: no export, dependency or file moves.

## Existing tools

- `plan` and the form of a path, in kalfa/config/src/internal/edit.ts: searched Effect 4.1.3's `JsonPatch.get` (read
  in `node_modules/effect/src/JsonPatch.ts`: it recurses into arrays by index and into every object and sorts keys,
  where ruling 4 replaces arrays whole, an inline table is one value here and new keys keep the record's order),
  `effect/Differ` (a patch type for one data type, not text), toml-patch 3.3.2's `patch()` (probed: wrong data on a
  remove plus an add, arrays by element, new items at the top), and `edit.ts`'s own `read`, `equal`, `prefix` and
  `check` (reused). New, about 35 lines.
- `headerStart` and `removeTable` in kalfa/config/src/internal/edit.ts: searched `edit.ts`'s `remove` (one assignment
  only, reused for one-key steps), `toml.ts`'s `sectionStart` (walks up over blank lines too, so it cannot stop where
  ruling 5 stops; kept for inserts), and toml-patch's comment ownership (only inside `patch()`, not callable alone).
  New, about 50 lines.
- `insertBlock` in kalfa/config/src/internal/edit.ts and the block's lines in kalfa/config/src/internal/toml.ts:
  searched `edit.ts`'s `insertLine` (reused for the splice), `toml.ts`'s `render` (reused per key), and toml-patch's
  `stringify` of a nested record (from memory, not used: it writes its own line breaks and block shape, not the
  file's). New, about 30 lines.
- `replaceBlocks` in kalfa/config/src/internal/edit.ts and the `[[...]]` lines in kalfa/config/src/internal/toml.ts: searched
  `removeTable` and `insertBlock` above (reused: the cut is the leaving table's, the splice is `insertLine`'s),
  `render` (reused per key), and toml-patch 3.3.2's `patch()` (probed: it edits an array of tables element by element,
  which ruling 4 rules out). New, about 25 lines.
- `single` in kalfa/config/src/internal/toml.ts: today's `set` and `remove`, renamed and exported for `TomlParser.ts`.
  No new logic.

## Calls taken

Each picks how the code does what the ticket, 1806's rulings 4 and 5, or the 1843 plan already say. The four under
80% are at the top.

- **One pull request.** 90%. The compare needs a leaving table's removal, and both close the same ticket.
- **The compare lives in the TOML format, behind `Format`'s unchanged signature.** 85%. 1806 said so, and "spread" is
  a TOML idea: in JSON every object is one value. `change.ts` and its guards stay as they are.
- **Our own splice, not toml-patch's `patch()`.** 90%. The probe gave wrong data on the ref-rule shape this ticket is
  for, and the kept check would refuse it with `edit` every time.
- **Today's `Toml` service keeps one-key edits, through `single`.** 90%. The 1843 plan promised it no behavior change
  until 1849 deletes it, and L5 pins it.
- **The comment between two tables belongs to the header below it.** 85%. Ruling 5's words read literally, and
  toml-patch's comment ownership agrees.
- **A last block takes the blank lines above it.** 80%. Without it a removal at the end leaves a file ending in blank
  lines, which a person's editor or `pnpm format` would trim in a later, noisy diff.
- **An empty record that nothing would name is written `= {}`.** 80%. A set must read back as set (E3's rule); the
  other way, an empty record whose header stays, reads `{}` and keeps the header.
- **Arrivals before departures, kind changes as remove then set.** 85%. Placement then follows the siblings the person
  wrote.
- **`edit.ts` grows by about 125 lines rather than a new file.** 80%. The new code shares its unexported splice
  helpers (`apply`, `insertLine`, `ending`); a new file would export them only for one reader.
- **The `edit` reason stays.** 90%. It now fires only from the guards: an answer that would change other data or not
  parse.
- **E9 is deleted, and S1's `edit` scene moves to RC8.** 85%. Their texts now edit.
- **Is this a setting?** No new choice is. Where a new item goes, which comments a table owns and when a table is
  compared key by key are what the format is, the same for every app, and no person would pick them per repo.

## Where this departs from today's code

- Today `SettingGroup.edit(...).set` and `.remove` fail `edit` for a record under its own header, as dotted sub-keys or
  as an array of tables. After this they compare it or take it out.
- Today's `Toml` service (`TomlParser.ts`) does not change.

## Validation

- Tests step: `nice -n 15 pnpm exec vitest run kalfa/config/src/SettingGroup.record.test.ts
  kalfa/config/src/internal/change.test.ts kalfa/config/src/SettingGroup.edit.test.ts` shows RC1 to RC8 red on the
  branch head (RC6 and parts of RC7 may pass today, for the one-assignment cases) and S1 green; each new law timed
  once at full depth.
- Build step: the same paths plus `kalfa/config/src/TomlParser.test.ts` and
  `next/packages/libfabrika/src/settings/TomlEdit.test.ts` green, each plant run once and undone; `pnpm format` and
  `pnpm lint`.
- The lead runs the changed-tests run and one full type check; neither runs in a box.

## Size

1. One pull request: 197 product lines (`internal/edit.ts` 125, `internal/toml.ts` 55, `internal/format.ts` 6,
   `SettingGroup.ts` 6, `TomlParser.ts` 3, `internal/change.ts` 2), plus one new test file, one new support file and
   edits to three.

About 3 agent hours across tests, build and review, 75% sure. The doubt is the tests step: 26 classes over typed TOML
files whose pieces must know the lines they own. Basis: the 1843 plan's slice 2 and the 1842 plan, priced at about $8
a step for Opus steps. Steps: tests, build and review, plus one likely send-back of tests and build, and a second
review.

Estimate: 6 steps, $48

## New names

- `Step`, with cases `Set`, `Remove` and `Blocks`: one change in the plan, code names inside `internal/`.
- `plan`, `headerStart`, `removeTable`, `insertBlock`, `replaceBlocks`: functions inside `internal/edit.ts`.
- `single`: today's one-key edits in `internal/toml.ts`, for `TomlParser.ts` only.
- "spread", the form of a table no single assignment holds: a word in code comments and this plan only, never in a
  message a person reads.
- `SettingGroup.record.test.ts`: a test file named for the record, as `SettingGroup.edit.test.ts` is named for the edit.

## Records

- `kalfa/config/GLOSSARY.md`, **Edit**: one more sentence, "Setting a record writes only the keys that differ, and a
  table that leaves takes its comments with it." No new term: record, table, key and array are TOML's and the
  industry's words, and the plan coins no domain word.
- `kalfa/config/README.md`: the record compare and a leaving table's comments, under "Change one setting in a file's
  text".
- No decision record: 1806's ruling 7 says none of this is hard to undo, and the edit has no caller yet.
- No pattern doc: `.kalfa/patterns/settings.md` describes today's shape until 1849.

## What this cannot tell us

- How real kalfa configs are written. The adopt case is planned from the reconciliation draft's shape (items under
  their own headers, a `desired` table each); a person who writes items as multi-line inline tables gets the whole
  replacement the first call takes.
- Whether a person reads an own-line comment between dotted lines as the table's. This plan keeps it.
- Whether the new-block rule's blank line matches every file's spacing: it always writes one blank line before the
  block, whatever the siblings use.
- What JSONC will need: its objects are all one value, so its compare would recurse into objects where TOML's stops at
  an inline table. Unchecked.
- Whether a generated file reaches a case the plan's forms miss, such as a record split across a header and dotted
  keys under a parent header and deeper headers at once. The kept check fails such a case `edit` and writes nothing,
  so a miss is a refusal, never wrong data.

## Open questions

None.

Every choice above picks how the code does what the ticket, 1806's rulings 4 and 5 or the 1843 plan already say. The
lead read the four calls under 80% at signing; see the section at the top.

## Findings

1. **toml-patch 3.3.2's `patch()` writes wrong data for a remove plus an add.** Proof, run in a scratch script against
   the installed `kalfa/config/node_modules/@decimalturn/toml-patch/dist/toml-patch.js`: the text
   `[r.ref-rule.main]` / `source = "codehost"` / `[r.ref-rule.release]` / `source = "codehost"` /
   `[r.ref-rule.release.desired]` / `approvals = 1`, patched with the parsed value minus `release` plus
   `dev: { source: "codehost", desired: { approvals: 1 } }`, comes back with `[r.ref-rule.dev]` holding `release`'s
   `source` and `[r.ref-rule.release.desired]` still there, so `dev.desired` is lost and `release.desired` stays. The
   package calls only `stringify`, so nothing here is affected. The lead may file it upstream at
   https://github.com/DecimalTurn/toml-patch with that repro; no ticket filed.
2. **For ticket 1849:** when `TomlParser.ts` goes, `single` in `kalfa/config/src/internal/toml.ts` goes with it, and
   the T877 law L5 in `next/packages/libfabrika/src/settings/TomlEdit.test.ts` with its callers.
