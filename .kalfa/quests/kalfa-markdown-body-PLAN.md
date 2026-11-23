Approved by the lead agent, builds issues 1909, 1928, 0087, 0063; body 45b78724c65e
Plancheck-Version: 3

# Plan: @kalfa/markdown, read a body into a document (ticket 1928)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The
ticket is https://github.com/kamp-us/tea-fabrika/issues/1928, and its pull request says `Closes #1928`.
One pull request, one slice. It adds one module, `Markdown`, with one call, `Markdown.parse`, to the
package that pull request https://github.com/kamp-us/tea-fabrika/pull/1942 made. Words:
`kalfa/markdown/GLOSSARY.md` (Body, Document, Frontmatter, Fence).

```ts
// The whole idea, a sketch. Nothing here was type-checked.
import * as Frontmatter from "@kalfa/markdown/Frontmatter";
import * as Markdown from "@kalfa/markdown/Markdown";

const file = "---\nsummary: x\n---\n# Data on top\n\nText with **bold**.\n\n```js\n# not a heading\n```\n";

const document = Markdown.parse(Frontmatter.split(file).body);
// Markdown.Document, which is mdast's Root. A plain function: no Effect, no error, no span.
// children: heading (depth 1, "Data on top"), paragraph, code (lang "js", value "# not a heading")

// The first level-one heading, found from the document alone. The package gives no call for it.
const first = document.children.find((part) => part.type === "heading" && part.depth === 1);

// Its line in the whole file: the part's line plus the 3 line endings before the body.
// first.position.start.line is 1, so the file's line is 4.
```

## Doubts, at the top

Two calls are under 80%. The plan takes its lean on each and goes on.

- **No call maps a part's place in the body to its place in the file (75%).** The ticket asks only
  that the pull request say how the two lines relate. The README states the rule, and law M6 proves
  it on generated files. The doubt: a caller may count it wrong. A lone `\r` is a line ending to
  CommonMark, and a body that starts with U+FEFF has its offsets counted after it. What would settle
  it: Records' redraw, its first caller. The fallback is a small call added here later, such as a
  `bodyStart` point on `Frontmatter.split`'s answer. That is a new field, not a change to a field.
- **Positions stay as mdast gives them (75%).** Two facts from the trials are left as they are and
  written in the README, not fixed in `parse`. A `link` and its `text` made by GFM's link-literal step
  can have no position (`[a@b.x`, `_a@b.co_`), while their paragraph, heading or cell always has one.
  And offsets in a body that starts with U+FEFF count from after it. unist, the spec mdast follows,
  says a made node has no position, so the first fact is allowed. Fixing either means walking the tree
  and changing mdast's own answer. What would settle it: Records' first diagnostic on a link.

## What changes, in one paragraph

A new module, `kalfa/markdown/src/Markdown.ts`, exported as `@kalfa/markdown/Markdown`. It holds the
type `Document` (mdast's `Root`) and the plain function `parse(body: string): Document`. `parse` reads
with micromark, the CommonMark reader remark uses, with GitHub's Markdown (GFM: tables, strikethrough,
footnotes, link literals), except one GFM part: the task-list check, `[ ]` and `[x]` at the start of a
list item. That part throws in its development build, and in its production build drops text and puts
a `checked` field on the root, for a body such as `-\n[ ] a` (see Trials). With it off, `- [ ] a` is a
list item whose text is `[ ] a`, and nothing is lost. `parse` cannot fail, makes no span, does no IO and
names no record. The package gains four dependencies that the catalog and the lockfile already hold
for Records: `mdast-util-from-markdown`, `mdast-util-gfm`, `micromark-extension-gfm` and `@types/mdast`.
The README gains the call, the reading and the rule for a part's line in the whole file, and the pull
request body copies that rule. Out of scope: writing a document back to text (the 1909 sketch's
`Markdown.write`), and any call that finds a heading or a summary.

## Searched first

- The ticket whole; the answer on https://github.com/kamp-us/tea-fabrika/issues/1909 (its sketch:
  `Markdown.parse(text: string): Document`, "any text is valid Markdown, so no error"); decisions
  0087 and 0063 whole.
- The package as built on main: `kalfa/markdown/src/Frontmatter.ts`, its test support, its laws, its
  type laws and `Package.test.ts`; the README, the glossary and the manifest. The approved plans
  `.kalfa/quests/kalfa-markdown-frontmatter-PLAN.md` (on main) and `.kalfa/quests/kalfa-markdown-set-PLAN.md`
  (on branch `fabrikalfa/kalfa-markdown-set`, pull request https://github.com/kamp-us/tea-fabrika/pull/1993,
  still open). This plan copies their shape: class ids with a plant each, every class reached in every
  run, laws in memory.
- `kalfa/AGENTS.md`, `kalfa/records/GLOSSARY.md` (Summary: "the record's first heading, or a field of
  its frontmatter"), `kalfa/diagnostics/GLOSSARY.md` (Place: "a line and column when known", counted
  from 1, with no rule for line endings) and `.kalfa/glossary/GLOSSARY-MAP.md`.
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns` and `.kalfa/runbooks` for
  "mdast", "markdown", "commonmark|micromark|gfm" and "heading|title". Only 0087 and the glossaries
  touch this; none settles which Markdown reading, or how a line maps.
- The two readers the repo has today: `kalfa/records/src/Markdown.ts` (micromark with GFM, flattened
  to prose blocks and links, inside Records) and `programs/markdown/src/root.ts` (today's frozen
  version, the same reader, narrowed for a window).
- Installed versions in `pnpm-lock.yaml` and `pnpm-workspace.yaml`'s catalog: `mdast-util-from-markdown`
  2.1.0, `mdast-util-gfm` 3.1.0, `micromark-extension-gfm` 3.0.0, `@types/mdast` 4.0.4, `micromark`
  4.0.3, `mdast-util-gfm-task-list-item` 2.0.0, `effect` 4.1.3, `vitest` 5.0.5, `yaml` 2.9.1. Read in
  them: `fromMarkdown`'s entry (`lib/index.js`: no start point can be passed), micromark's
  `create-tokenizer.js` (a line ending is `\n`, `\r\n` or a lone `\r`; a column moves one per code
  unit), `preprocess.js` (a leading U+FEFF is skipped), the task-list check's `exitCheck`, and each
  package's `exports` (a `development` build beside the default one).
- npm, by `npm view`: the newest `micromark-extension-gfm-task-list-item` is 2.1.0, the one installed,
  and the newest `mdast-util-gfm-task-list-item` is 2.0.1. Its `lib/index.js`, read from unpkg, changes
  only the writing side; `exitCheck` is the same. So no upgrade fixes the bug.
- `.oxlintrc.json`: the `kalfa/markdown/src/**` override (no kalfa, repo, Telemetry, Node or platform
  import, no printing), and the Effect block that holds the same folder (`fabrika/no-effect-run-outside-edge`,
  and `eslint/id-denylist`, which refuses the names `where`, `why`, `what`, `who` and `how`, test
  support included).

## Trials run while planning

Small scripts in a scratch folder, against the installed packages, in Node's default build and again
with `--conditions=development`. Nothing in the repo ran or changed. Each fact is a trial result.

- **The ticket's cases.** `---\ntitle: x\n---\n# A\n` read whole gives `thematicBreak`, a level-two
  `heading` ("title: x") and a level-one `heading`. With every `position` removed, `a __bold__ b` and
  `a **bold** b`, `_e_` and `*e*`, `* a\n* b` and `- a\n- b` (and `+`), `# Title` and `Title\n=====`,
  `## T` and `T\n---`, `# T #` and `T\n=`, a ```` ``` ```` and a `~~~` fence, and a four-space block and a
  fence with no info give equal trees. `a__b__c` and `a**b**c` do not: `__` inside a word is not
  bold. A `# ` line in a fenced block, an indented block and an unclosed fence is code.
- **Positions.** Over 20,000 random bodies (434,000 points), each point's line and column follow from
  its offset: the line is one plus the line endings before it, counting `\n`, `\r\n` and a lone `\r`
  each once, and the column is the code units since the line's start plus one (a tab is one). An
  empty body gives a root from 1:1:0 to 1:1:0. A surrogate pair is two code units.
- **A leading U+FEFF.** `﻿ab\ncd` gives text at offset 0 and column 1, so `body.slice` of its
  position is off by one. A U+FEFF later in the body is a plain character.
- **Parts with no position.** Only `link` and `text`, only from GFM's link-literal step: the smallest
  inputs are `[a@b.x`, `_a@b.co_` and `http://.!-`. `see https://a.b now`, `www.x.com` and `a@b.co`
  alone keep their positions. CommonMark alone gives none without a position.
- **The task-list bug.** `-\n[ ] a`, `*\n[x] a` and `1.\n[ ] a` (an empty item, then a line that starts
  with a check) throw `Expected value to be truthy` in the development build, from `exitCheck` in
  `mdast-util-gfm-task-list-item`. The default build throws nothing, but the root gets
  `checked: false` and the paragraph's text is ` a`, the `[ ]` lost. A random search of 30,000 bodies
  found it once. With `{ disable: { null: ["tasklistCheck"] } }` beside `gfm()`, 60,000 random bodies
  threw nothing in either build, every root held only `type`, `children` and `position`, and
  `- [ ] a` gave a list item with `checked: null` and the text `[ ] a`.
- **One options object for every call.** Seven bodies (footnotes, a reference definition, a table, a
  check, a heading), read three times each with one shared options object, gave the same trees as a
  fresh one each time. A footnote defined in one call is not seen by the next.
- **The plants below.** Turning off `setextUnderline` makes `T\n===` a paragraph; turning off
  `codeIndented` makes `    # T` a heading; turning off `codeFenced` makes the fenced `# T` a heading;
  reading without `gfm()` makes a table a paragraph.
- **Speed.** One paragraph of 4,000 short lines reads in 0.3 s and one of 8,000 in 1 s with GFM's
  syntax, against 49 ms with CommonMark alone; 8,000 one-line paragraphs read in 0.2 s. Turning off
  the table, link-literal or task-list part does not change it, and GFM's mdast half alone is 68 ms.

## How others do it

- **remark** (from memory, not fetched): `remark-parse` is `mdast-util-from-markdown` inside unified,
  and `remark-gfm` adds `micromark-extension-gfm` and `mdast-util-gfm`, the same pair this plan uses
  without unified. Astro's content collections read a body with remark and its frontmatter apart,
  which is 0087's split.
- **GitHub** (from memory): cmark-gfm, CommonMark plus the GFM extensions, with task-list items as an
  extension of their own. This plan keeps GFM's reading and leaves that one extension off.
- **unist** (from memory of the spec): a point is a line and a column from 1 and an offset from 0,
  and a node that was made, not read, has no position. So the link-literal step's parts are allowed.
- **Elm** (from memory): `dillonkearns/elm-markdown` parses into a list of blocks and answers a
  `Result`, with dead ends for what it cannot read. CommonMark has no such case: any text is a
  document, so `parse` answers the tree alone, as decision 0087's sketch says. Nothing here runs,
  waits or is supervised, so no Erlang/OTP answer applies.
- **Effect** (read in the installed 4.1.3): it has no Markdown reader. A plain function is the house
  rule for code that cannot fail and needs no service (`.kalfa/patterns/effect-pure-domain-returns-result.md`
  covers code that can fail; this cannot).

## The shape

```ts
// kalfa/markdown/src/Markdown.ts, a sketch. Doc blocks shortened. Nothing here was type-checked.
import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/**
 * A body read into a tree of its parts: mdast's Root.
 *
 * @category models
 */
export type Document = Root;

// GitHub's Markdown, less the task-list check: for an empty list item followed by a line that starts
// with `[ ]`, that part throws in its development build and drops the `[ ]` in its default one. With it
// off, `- [ ] a` is an item whose text is `[ ] a`. The options hold no state, so one object serves every call.
const READ = {
  extensions: [gfm(), { disable: { null: ["tasklistCheck"] } }],
  mdastExtensions: [gfmFromMarkdown()],
};

/**
 * Reads a body into its document. Any text is a document, so it cannot fail. ...
 *
 * @category constructors
 */
export const parse = (body: string): Document => fromMarkdown(body, READ);
```

- **A body, not a file.** `parse` cuts nothing. A caller with a whole file passes
  `Frontmatter.split(text).body`. Law M2 shows why: a whole file read as Markdown turns its
  frontmatter into a thematic break and a level-two heading.
- **No call for the first heading.** Decision 0087: what a record is stays Records'. The README shows
  the one line a caller writes, `document.children.find(...)` for the first `heading` of depth 1
  among the document's own children, and law M5 shows it finds the right one.
- **The types are mdast's.** `@types/mdast` is a dependency, not a dev dependency, because the
  module's public type names it. A caller that walks the tree imports its part types from `mdast`.
- **The word list P2 holds.** `Markdown.ts` must not hold `record`, `kind` or `decision` in any case,
  so it never uses TypeScript's `Record` type.

### A part's line in the whole file

This is the rule the README states and the pull request body copies, word for word.

`parse` reads only the body, so every position counts from the body's start. The body is the end of
the file byte for byte, so the text before it is `text.slice(0, text.length - body.length)`. Call it
`before`.

- **Line:** the part's line plus the line endings in `before`. A line ending is `\n`, `\r\n` or a
  lone `\r`, each counted once, as CommonMark counts them. For a file `Frontmatter.write` made, that
  is the frontmatter's lines plus its two fences.
- **Column:** the same in both, since the body starts at the start of a line.
- **Offset:** the part's offset plus `before.length`.
- **One exception:** micromark skips a U+FEFF at the very start of the body. Then the offsets, and the
  columns on the body's first line, count from after it: add one to each.
- A `link` and its `text` from GFM's link-literal step can have no position; take the nearest part
  above it that has one.

## One value traced

The file from the opening block.

1. `Frontmatter.split` finds `---` on line 1 and the next `---` on line 3. The body is the text from
   offset 19, `# Data on top\n\nText with **bold**.\n\n```js\n# not a heading\n```\n`, byte for byte.
2. `parse(body)` reads it with micromark and GFM. The root's children are a `heading` of depth 1 at
   1:1:0, a `paragraph` at 3:1:15 and a `code` with `lang: "js"` at 5:1:36 whose value is
   `# not a heading`. The `# ` line in the fence is code.
3. The caller's `find` takes the first child that is a heading of depth 1: `Data on top`.
4. `before` is `---\nsummary: x\n---\n`: 19 code units and 3 line endings. So the heading is on the
   file's line 4 at column 1 and offset 19, and the code block starts on the file's line 8.
5. Nothing threw, and no span was made. A body with no heading gives `undefined` from the same `find`.

## Generators

Every generator is an Effect `Arbitrary` in `kalfa/markdown/src/Markdown.test-support.ts`. As in 1926
and 1927, each run checks every class below, not left to chance: each run builds one variant per
class from its drawn seeds, a law keeps the ids it checked, and a law fails when an id is missing or a
variant's pool does not hold what its class says. Texts reuse the pools that
`kalfa/markdown/src/Frontmatter.test-support.ts` already builds (controls, line breaks, letters past
ASCII, lone surrogates, YAML marks). A helper that gives the line and column of an offset may not be
named `where` (`eslint/id-denylist`). Bodies stay under about 200 lines, since one long GFM paragraph
reads slowly (see Trials).

Any text:

- (a) a soup: 0 to 40 pieces joined at random from Markdown marks (`# `, `=`, `---`, `* `, `1) `,
  `> `, three backticks, `~~~`, four spaces, a tab, `|`, `|---|`, `[`, `](`, `[^1]: `, `<!--`, `**`,
  `__`, `~~`, a backslash, `&amp;`, `&#0;`), line endings, U+0000, U+D800, U+DC00, U+FEFF, U+2028,
  U+0085, emoji and letters past ASCII.
- (b) checks: `- [ ] a`, `* [x] b`, and an empty item then a check line: `-\n[ ] a`, `*\n[x] a`,
  `1.\n[ ] a`.
- (c) link literals: ones with a position (`www.x.com`, `https://a.b`, `a@b.co` inside text) and the
  three without (`[a@b.x`, `_a@b.co_`, `http://.!-`).
- (d) a body of blocks: ATX and setext headings, paragraphs with a hard break, lists two deep, a
  block quote, thematic breaks, an HTML block, a link definition, a footnote, a table with an
  alignment row and an escaped pipe, a fenced block and an indented block opened with a tab.

Two typings of one document (the second body differs from the first only as the class says):

- (e) strong and emphasis: `**x**` and `__x__`, `*x*` and `_x_`, each at a word's edge.
- (f) list markers: `-`, `*` and `+` across a whole list, and `1.` and `1)`. One list per body, or
  lists kept apart by a paragraph, since a change of marker starts a new list.
- (g) headings: `# T` and `T` over `===`, `## T` and `T` over `---`, closing `#` marks, and an underline
  of one to eight marks, each after a blank line.
- (h) code: a fence of three backticks, of `~~~` and of four backticks, and a fence with no info
  beside the same lines indented four spaces, with no blank first or last line.

Code is code:

- (i) fenced blocks (backticks and tildes, with and without info, inside a list item and a block quote,
  and one left open at the body's end) holding `# T`, `T` over `===`, `---`, `- a`, `| a |` over `|---|`
  and `> q`.
- (j) indented blocks (four spaces and a tab) holding the same lines.

The first level-one heading:

- (k) its form: ATX, setext with `=`, with closing `#` marks, up to three spaces before it, and with
  bold, inline code and a link inside.
- (l) what comes before it: headings of depth 2 to 6, a setext heading with `-`, paragraphs, a fenced
  block holding `# fake`, a block quote and a list item holding `# quoted`, and an HTML `<h1>`.
- (m) bodies with none: `    # fake` indented four spaces, `#x`, an escaped `\# x`, and a `#` inside
  a paragraph.

Places in the whole file:

- (n) the file's start: a frontmatter `Frontmatter.write` made, the same with `\r\n` fences, the empty
  block `---\n---\n`, a hand-typed block with a lone `\r` in a comment line, and no frontmatter at all,
  including a file whose first line is `---` with no closing fence.
- (o) the body's line endings: `\n`, `\r\n`, a lone `\r`, all three mixed, no final line ending, and a
  first line that is empty.
- (p) a body that starts with U+FEFF.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| M1, any text is a document: for a body from (a), (b), (c) and (d), `parse` returns and throws nothing; the root holds exactly `type`, `children` and `position`, from 1:1:0 to the body's end; every part but a `link` or `text` has a position; each child's position lies inside its parent's, siblings in order and not overlapping; and for (b) each paragraph's text keeps its `[ ]` or `[x]`. 300 runs, every class reached in every run | test | Effect Arbitrary: anyBodies | throw on U+0000 or a lone surrogate before reading, (a) red; drop the `tasklistCheck` line, so the development build throws and the default one puts `checked` on the root and loses `[ ]`, (b) red; give a part with no position its parent's, so siblings overlap, (c) red; read without `gfm()`, so a table is a paragraph and its cells' text runs together, (d) red | kalfa/markdown/src/Markdown.test.ts |
| M2, a body, not a file: the whole file `---\ntitle: x\n---\n# A\n` read with `parse` gives a `thematicBreak`, a level-two `heading` with the text `title: x`, then a level-one `heading`; its body from `Frontmatter.split` gives one level-one `heading`, `A` | test | scenario: the ticket's file, written in the test | cut a leading `---` block inside `parse`, as if it read frontmatter: the whole file shows no thematic break, red | kalfa/markdown/src/Markdown.test.ts |
| M3, two typings give one document: for each pair from (e), (f), (g) and (h), set in a body of other blocks from (d), the two bodies differ and their documents are equal once every `position` is removed (`deepStrictEqual`). 300 runs, every class reached | test | Effect Arbitrary: typedPairs | an exit handler in `parse`'s mdast options that keeps the typed mark in `data`: on strong and emphasis, (e) red; on lists and list items, (f) red; on headings, (g) red; on code, (h) red | kalfa/markdown/src/Markdown.test.ts |
| M4, code is code: for a body from (i) and (j), its document holds a `code` part whose value has every one of the block's lines, and no `heading`, `list`, `table`, `blockquote` or `thematicBreak` comes from them. 300 runs, every class reached | test | Effect Arbitrary: codeBodies | turn off `codeFenced`, so the fenced `# T` is a heading, (i) red; turn off `codeIndented`, so a four-space `# T` is a heading, (j) red | kalfa/markdown/src/Markdown.test.ts |
| M5, the first level-one heading, from the document alone: for a body from (k), (l) and (m) whose answer the generator knows, the first child of the root that is a `heading` of depth 1 has that answer's text (its `text` and `inlineCode` values joined), or there is none for (m). 300 runs, every class reached | test | Effect Arbitrary: headingBodies | turn off `setextUnderline`, so a setext title is a paragraph, (k) red; turn off `codeFenced`, so `# fake` comes first, (l) red; turn off `codeIndented`, so `    # fake` is a heading, (m) red | kalfa/markdown/src/Markdown.test.ts |
| M6, a part's place in the file: for a file made of a start from (n) and a body from (d), (o) and (p), each part's place under the README's rule (line plus the line endings before the body, the same column, offset plus the length before it, plus one for a leading U+FEFF) is the line and column the file itself gives at that offset, counting `\n`, `\r\n` and a lone `\r` once each. 300 runs, every class reached | test | Effect Arbitrary: placedFiles | turn each tab into four spaces before reading, (d) red; drop a leading `---` line before reading, as if it were a fence, (n) red; turn each `\r\n` into `\n` before reading, (o) red; turn a leading U+FEFF into a space before reading, so it is counted, (p) red | kalfa/markdown/src/Markdown.test.ts |
| M7, the parts of GitHub's Markdown this pull request states: a table with `:-`, `:-:` and `-:` gives a `table` with `align` left, center and right; `~~s~~` gives `delete`; `www.x.com` gives a `link`; `a[^1]` with `[^1]: n` gives a `footnoteReference` and a `footnoteDefinition`; `- [ ] a` gives a `listItem` with `checked: null` and the text `[ ] a` | test | pinned: GFM as the installed micromark-extension-gfm 3.0.0 reads it, with the task-list check off | read without `gfm()`: the table is a paragraph, red; drop the `tasklistCheck` line: the item is `checked: false`, red | kalfa/markdown/src/Markdown.test.ts |
| T3, the types: `Markdown.parse` is `(body: string) => Markdown.Document`, `Markdown.Document` is mdast's `Root`, and `parse`'s answer is no Effect and no `Result` | type | type | make `parse` an `Effect.fn`: the `toEqualTypeOf` fails, red | kalfa/markdown/src/Markdown.types.test.ts |
| P1, the manifest, as changed: the dependencies are exactly `yaml`, `@types/mdast`, `mdast-util-from-markdown`, `mdast-util-gfm` and `micromark-extension-gfm`; `effect` is the one peer; the exports are exactly `./Frontmatter`, `./Markdown` and `./package.json`, and `./Markdown` has its `dist` pair; no field names a `@kalfa/` or `@kampus/` package | test | scenario: the package's own manifest at head | add `@kalfa/diagnostics` to the dependencies: red | kalfa/markdown/src/Package.test.ts |
| P2, as it stands, now reaching `Markdown.ts`: no tracked file names this repo, and no source file but tests holds `record`, `records`, `kind` or `decision` | test | scenario: the package's tracked files at head | write `a record's first heading` in a comment in `Markdown.ts`: red | kalfa/markdown/src/Package.test.ts |
| L1, as it stands, now reaching `Markdown.ts`: an import of a `@kalfa/`, `@kampus/` or `@tea-fabrika/` package, of `node:` or of Telemetry is refused there | lint | lint | import `@kalfa/diagnostics/Diagnostic` in `Markdown.ts`: lint red, then undone | .oxlintrc.json |
| L5, no span and no hidden Effect: `Effect.runSync` in `Markdown.ts` is refused by `fabrika/no-effect-run-outside-edge` | lint | lint | wrap the read in `Effect.runSync(Effect.withSpan(...))`: lint red, then undone | .oxlintrc.json |

**Lint, type or test?** L1 and L5 are shapes of imports and calls: lint. T3 is a shape the compiler
sees: type. M1 to M7 are about what tree a text gives, and P1 and P2 about what files hold, which no
lint rule or type sees: tests.

**Where they run.** Every law runs in memory on every pull request: no spawned process, no temp folder,
no network. None needs launchd, the real Electron app, a real OS process or socket, or a real signal,
so none is host-only and none waits on the owner's Mac. No law is a `*.integration.test.ts` file. P1
and P2 read the package's own files, as they do today. M2 is a fixed input labeled `scenario` and M7
one labeled `pinned`; no fixture stands in for a tool's output. No secret flows through the package,
so no law is a `[secrets]` law. 1926's F1 to F13 and T1 must stay green; 1927's laws are not touched.

**Which build the laws run.** Vitest may load micromark's development build (its `development`
export) or the default one. M1's (b) plant goes red in both: a throw in the first, a `checked` on the
root and a lost `[ ]` in the second.

## What fact is lost if it is not recorded now

The task-list bug and why that one GFM part is off. Without the comment in `Markdown.ts` and the README
line, a later change that "turns GFM back on in full" brings back a throw for some bodies, and no one
knows why it was off. The trials' inputs (`-\n[ ] a`) go into M1's class (b), so a law holds it.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/markdown/src/Markdown.ts | build | 45 | new: `Document`, `parse`, the one options object with its comment, doc blocks |
| kalfa/markdown/README.md | build | docs | the second module and its call; the reading (CommonMark with GFM, the task-list check off, and why); the rule for a part's line in the whole file; the parts with no position; the first-heading line a caller writes; the dependencies; the last paragraph no longer says a body comes later |
| kalfa/markdown/GLOSSARY.md | build | docs | Document: "headings, paragraphs, lists, links, code and tables", and "give the same document, apart from where each part sits" |
| kalfa/markdown/package.json | tests | tests | the four dependencies from the catalog, `./Markdown` in `exports` and in `publishConfig.exports`. The tests step owns it with the lockfile, so its laws install and run red |
| pnpm-lock.yaml | tests | tests | the `kalfa/markdown` importer gains its four links, by one `pnpm install --offline`; every version is already locked for Records |
| kalfa/markdown/src/Markdown.test-support.ts | tests | tests | new: the generators, classes (a) to (p), the reach check, the position remover and the offset-to-line helper |
| kalfa/markdown/src/Markdown.test.ts | tests | tests | new: M1 to M7 |
| kalfa/markdown/src/Markdown.types.test.ts | tests | tests | new: T3 |
| kalfa/markdown/src/Package.test.ts | tests | tests | P1 as changed |
| kalfa/markdown/src/Frontmatter.test-support.ts | tests | tests | exports the text pools the body generators reuse; what 1926's laws draw does not change |
| kalfa/markdown/src/Frontmatter.test.ts | tests | tests | no change: F1 to F13 stay green |
| .oxlintrc.json | tests | tests | no change: its `kalfa/markdown/src/**` blocks already hold `Markdown.ts` (L1, L5) |
| layer-rules.json | tests | tests | no change: no new workspace import |
| boundary-rules.json | tests | tests | no change: no new workspace import |
| package.json | tests | tests | no change: the root already depends on `@kalfa/markdown` |
| pnpm-workspace.yaml | tests | tests | no change: the catalog holds all four versions |
| vitest.config.ts | tests | tests | no change: its kalfa source glob already finds the laws |

## Existing tools

- `kalfa/markdown/src/Markdown.ts`: searched `kalfa/records/src/Markdown.ts` (the same micromark and
  GFM, but it flattens a body into prose blocks and links, keeps full GFM with the task-list bug, and
  lives in Records, which this package must not import), `programs/markdown/src/root.ts` (today's
  frozen version, a narrowed tree for a window), Effect 4.1.3 (no Markdown reader), and on npm
  `remark-parse` with unified (the same `mdast-util-from-markdown` inside a processor layer, plus
  unified and vfile, not installed), `markdown-it` and `marked` (tokens and HTML, not mdast). The
  catalog already holds `mdast-util-from-markdown`, `mdast-util-gfm` and `micromark-extension-gfm`
  for Records, so the module is a thin call to them.
- The position remover in `Markdown.test-support.ts`: searched for `unist-util-remove-position` in
  the lockfile (not installed) and Effect's `Equal` (it compares every field, positions included). A
  ten-line walk that copies a tree without `position` is the tests step's.
- The offset-to-line helper in `Markdown.test-support.ts`: searched `vfile-location` (not installed)
  and yaml's `LineCounter` (it counts only `\n`, so it would miss a lone `\r`). The helper counts
  `\n`, `\r\n` and a lone `\r` once each, as micromark does.

## Calls taken

- **CommonMark with GitHub's Markdown, 90%.** The ticket names tables, which CommonMark lacks;
  Records and today's Markdown window already read GFM with these packages; GitHub is where the files
  are read by people.
- **The task-list check is off, 80%.** It is the only GFM part that throws or loses text in the
  trials, and the newest versions on npm keep the bug. The cost: `[ ]` and `[x]` are text, not a
  `checked` field. The ticket's list (headings, paragraphs, lists, links, code and tables) does not
  name checks, and no caller needs them. The fallback, when a caller does: turn it back on behind a
  guard for the empty-item case, or after an upstream fix.
- **`parse` answers the tree alone, with no `Result` and no Effect, 90%.** The ticket and 0087's
  sketch say it cannot fail; with the check off, 60,000 random bodies and law M1 agree. No span, as
  the ticket says (0063, as in 1926).
- **`Document` is mdast's `Root` as it is, 85%.** The ticket says "in mdast, the standard tree". A
  narrower type with every position required would be a second tree to keep in step with mdast, and
  the link-literal parts have none anyway.
- **`parse` takes a plain `string`, not a body only `split` can make, 80%.** A branded body would make
  "a whole file" hard to pass by mistake, but text that never had frontmatter (a chat message) would
  then need a cast or a `split` it does not need. The ticket asks for a test that shows why, which is
  M2.
- **The first level-one heading is the first depth-1 `heading` among the root's own children, 80%.**
  A heading inside a block quote or a list item is not a file's title. M5 holds it, and the README
  says it. The package gives no call for it (0087).
- **One options object for every call, 80%.** The trial shows no state carries over, and it saves
  building the extensions on every call.
- **The dependencies come from the catalog, 90%.** The same versions Records reads with, already
  locked, so the install adds no package to the store.
- **Is any of this a setting? No.** The reading (which Markdown, which parts off) must be the same for
  every caller, or two tools read one body two ways, the reason 0087 gives this package one reading.
  No setting is declared, so decision 0089 does not apply.

## Validation

- Tests step: `pnpm install --offline` once, to give the importer its four links (each version is
  already in the store). Then
  `nice -n 15 pnpm exec vitest run kalfa/markdown/src/Markdown.test.ts kalfa/markdown/src/Package.test.ts`
  shows M1 to M7 red on the missing module and P1 red on the old manifest. Each plant runs once, by
  hand, and is undone; the reach table names each class id, the law that reached it and its plant
  seen red. L1's and L5's plants run with `pnpm lint`, each undone. Generators use Effect's
  `Arbitrary`, so `fabrika/prefer-schema-arbitrary` stays quiet.
- Build step: the same two files green, plus `kalfa/markdown/src/Frontmatter.test.ts` still green,
  `pnpm format`, `pnpm lint`, and `pnpm --filter @kalfa/markdown build` once, listing `dist` (a
  `Markdown.js` and a `Markdown.d.ts` beside the Frontmatter pair), then deleting it.
- The lead runs `pnpm typecheck`, which holds T3. The lockfile changes, so the laptop refuses
  `--changed origin/main`; the lead runs the package's test files by path, and CI runs the rest.

## Size

1. One slice, the reader: about 45 product lines (`Markdown.ts`), plus M1 to M7, T3, P1, the
   generators, the README and the glossary line. It lands whole: a caller can read a body into its
   document, find its first heading and name a part's line in the file.

About 2.5 agent hours across the steps, 75% sure. The doubt is the generators again: sixteen classes,
each reached in every run, are most of the work, and both earlier tickets of this package needed a
fix round on exactly that. Budget basis: the 1926 plan's $24 and the 1927 plan's $28 for four steps;
this one has a smaller product file and about as many classes. Tests, build, review and one likely
send-back.

Estimate: 4 steps, $22

## New names

- `Markdown.parse`: the ticket's and 0087's sketch's.
- `Markdown.Document`: the glossary's word, as the type.
- `@kalfa/markdown/Markdown`: the module, beside `./Frontmatter`, as the 1926 plan foresaw.
- `READ`: a constant inside `Markdown.ts`, not exported, not a domain word.

No new domain word: Body and Document are in the glossary, and the plan coins none.

## Records

- `kalfa/markdown/GLOSSARY.md`: Document's definition names code and tables and says "apart from
  where each part sits", in the build. No new term.
- `kalfa/markdown/README.md`: the call, the reading, the task-list check and why it is off, and the
  rule for a part's line, in the build. The pull request body copies that rule, as the ticket asks.
- No decision record: decision 0087 holds that this package owns the Markdown reading, and this plan
  picks how. The lead may judge "GFM less the task-list check" worth its own decision once Records
  reads with it.
- No pattern doc: Records is the first caller.

## What this cannot tell us

- Which build of micromark vitest loads, the development one or the default one. M1 is written to go
  red in both, but the laws show only the one they ran.
- Whether a caller counts a part's line right. The rule is stated and proved; no law sees a caller.
- Whether any body people write holds a task check. Records' and the decisions' bodies were not
  searched for `[ ]`.
- How slow a long body is in real use. One paragraph of 8,000 lines takes about a second; the
  package sets no limit, and no law measures time.
- Whether a micromark or GFM upgrade changes a document. M7 pins the parts this pull request states,
  and the catalog holds each version exact.
- Whether the package runs in a browser: Node is kept out of its source by lint, but no law loads it
  there.

## Open questions

None.

## Findings

1. **GFM's task-list check throws or loses text, upstream and in the repo's readers today.** For an
   empty list item followed by a line that starts with a check (`-\n[ ] a`), `mdast-util-gfm-task-list-item`
   2.0.0's `exitCheck` asserts that its grandparent is a list item. In the development build that is a
   throw; in the default build it puts `checked: false` on whatever part is there (the root) and the
   paragraph's text loses `[ ]`. The newest published versions (2.1.0 of the syntax, 2.0.1 of the
   mdast half) keep it. `kalfa/records/src/Markdown.ts` and `programs/markdown/src/root.ts` read with
   full GFM, so in the default build they drop the `[ ]` of such a body without a word. No ticket filed
   here; an upstream issue for the syntax package, with `-\n[ ] a` as its input, is the lead's to file.
2. **Records' reader gives line 0 for some links.** `kalfa/records/src/Markdown.ts` records
   `node.position?.end.line ?? 0`, and a link from GFM's link-literal step can have no position
   (`[a@b.x`, `_a@b.co_`). Such a link is never a link to a record file, so no check of Records misses
   anything today. It goes away when Records moves onto this package and takes the nearest positioned
   part above.
3. **Pull request https://github.com/kamp-us/tea-fabrika/pull/1993 edits the same README paragraph.**
   Both change the last paragraph of `kalfa/markdown/README.md` ("come in later changes"). Whichever
   lands second rebases; the two sentences do not conflict in meaning.
