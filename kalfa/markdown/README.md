# @kalfa/markdown

Read, write and set values in a Markdown file's frontmatter against a schema, and read its body into a document.
Frontmatter is the YAML block between two `---` lines at the top of a file. This package knows nothing about what a file
means: it turns text into data and back, and it is the one place that decides how that YAML is read and written and how a
body's Markdown is read. Words: [GLOSSARY.md](./GLOSSARY.md).

It is private. Import `@kalfa/markdown/Frontmatter` for the frontmatter and `@kalfa/markdown/Markdown` for the body. It needs
`effect`, `yaml` and the Markdown reader (`mdast-util-from-markdown`, `mdast-util-gfm`, `micromark-extension-gfm`, and
`@types/mdast` for the types), takes text, and does no IO.

## The four frontmatter calls

```ts
import * as Frontmatter from "@kalfa/markdown/Frontmatter";
import { Effect, Result, Schema } from "effect";

const Shape = Schema.Struct({
  number: Schema.Int,
  status: Schema.Literals(["proposed", "accepted"]),
  id: Schema.String,
});

// write: a plain function. It answers a Result, because a Schema can refuse data its type allows (1.5 is a number).
const text = Frontmatter.write({ data: { number: 87, status: "accepted", id: "0146" }, body: "# A title\n\nText.\n" }, Shape);
// Result.succeed('---\nnumber: 87\nstatus: accepted\nid: "0146"\n---\n# A title\n\nText.\n')

// read: an Effect, in one span named markdown.frontmatter.read.
const file = Frontmatter.read(Result.getOrThrow(text), Shape);
// Effect<{ data: { number: 87, status: "accepted", id: "0146" }, body: "# A title\n\nText.\n" },
//        NoFrontmatter | BadFrontmatter, never>

// split: the one way to cut a file in two.
Frontmatter.split("# No frontmatter\n"); // { frontmatter: Option.none(), body: "# No frontmatter\n" }

// set: change some values and keep every other byte. An Effect, in one span named markdown.frontmatter.set.
const edited = Frontmatter.set(
  "---\nnumber: 87\nstatus: proposed   # waits for a yes\ntags: [one, two]\n---\n# A title\n",
  { status: "accepted" },
  Shape,
);
// Effect<"---\nnumber: 87\nstatus: accepted   # waits for a yes\ntags: [one, two]\n---\n# A title\n",
//        NoFrontmatter | BadFrontmatter, never>
```

- `split(text)` answers `{ frontmatter: Option<string>, body }`. A fence line is `---`, with a `\r` before its line break
  allowed. The first line must be one and the frontmatter ends at the next one. Anything else has no frontmatter, and the whole
  text is the body. The body is kept byte for byte.
- `read(text, schema)` fails with `NoFrontmatter` when the file has none, and with `BadFrontmatter` when it cannot be read or
  the schema refuses it. It needs the services the schema's decode needs, and no others.
- `write({ data, body }, schema)` answers `Result<string, BadFrontmatter>`. A refused value gives no text.
- `set(text, values, schema)` answers the file's text with the values set. `values` is typed data, as `write` takes it, and
  holds only the keys to set. It needs the services the schema's decode and encode need. The rules are below.

`BadFrontmatter` has a `reason`, a one line `message`, the file's `line` when one is known, and the `cause`:

| `reason` | Meaning |
|---|---|
| `syntax` | The frontmatter is not YAML: a tab as indentation, a duplicate key, an unclosed quote, a second document. |
| `value` | It is YAML, but not a JSON object: a top level that is not a map, a tag that makes a `Set` or a `Date`, `.nan` or `.inf` as a value or a key, a key that is a list or null, two keys that give one text. |
| `schema` | The caller's schema refused the data. The `cause` is the `SchemaError`, which names the field. No `line`. |
| `edit` | Only `set` gives it: the change cannot be made in this file's text without changing other data, or a pair has no `:` to set a value after. The message names the keys, never their values. No `line`. |

## The reading

One reading serves both directions, so what `write` gives, `read` gives back.

- **YAML 1.2, core schema.** Only `true`, `false`, `null`, `~` and plain numbers are typed. `id: 0146` is the number 146,
  and `id: "0146"` is the text `0146`, so `write` quotes a text that would read back as another type. `yes`, `on` and
  `2026-11-22` are text. `~` is null. `.nan`, `.inf` and a `Date` are refused.
- **The data is a JSON object.** Both calls check it with `Schema.JsonObject`. A schema whose encoded side is not JSON (a
  `Date`, a bigint) is passed as `Schema.toCodecJson(itsSchema)`.
- **An empty block is the empty map.** `---\n---\n` reads as `{}`, and `{}` is written that way.
- **A text with a line break, or that starts with U+FEFF, is written double-quoted.** Plain YAML would write some of
  them as a block scalar, and a reader would give them back changed.
- **One value per line.** No folding and no `&a1` anchors.
- **Nothing is printed.** A warning from the YAML library is an error here, and the package never logs.

## What `set` does

`set` reads the file, decodes it with the schema, puts `values` over the data and encodes the result. It compares the
encoded data before and after, never the file's text, so a value the schema reads one way and writes another keeps its text
until the caller changes it.

- **Only a changed key's value text is replaced.** That text runs from the value's tag or anchor, else its start, to its end.
  A comment after it, the key, the other lines, their spacing and style, the fences and the body stay the same bytes. A
  comment inside a changed block value goes with the old value.
- **A value the file already holds is not touched.** When nothing changes, the text comes back as it came.
- **A new value is written as `write` writes it.** A value on its key's line stays on that line, in flow style with no
  padding inside (`[a, b]`, `{x: 1}`). A value on a later line stays there: a list or map in block style at the old value's
  column, anything else on one line. A list that sat at its key's column keeps that column, and a value of another kind
  goes two past it. A value that was empty (`k:`, `k: # note`) is set right after the `:`. When the old text ended with a
  line break, the new text does too. The line break of every new line is the file's, `\r\n` when the opening fence is `---\r`.
- **A key the file lacks gets its lines at the end of the frontmatter,** after any last comment, at the column of the first
  key. In a top level flow map (`{a: 1}`) it goes after the last pair instead.
- **The file must pass the schema first,** so a file the schema refuses cannot be fixed with `set`: it fails with `schema`.
  `write` rewrites a whole frontmatter.
- **The edited frontmatter is read again before any text comes back.** It must read clean, read as the old data with only the
  set keys changed, and pass the schema. A miss gives no text: `edit` for the first two, `schema` for the third. This is
  what refuses to set the value that holds an anchor another key uses as an alias, and a new key after a `...` line.
- **Top level keys only, and no removal.** `values` never holds `undefined`, so a key is never taken out, and a key below
  the top level is set by setting the whole value of its top level key.

## Reading a body: `Markdown.parse`

```ts
import * as Frontmatter from "@kalfa/markdown/Frontmatter";
import * as Markdown from "@kalfa/markdown/Markdown";

const file = "---\nsummary: x\n---\n# Data on top\n\nText with **bold**.\n\n```js\n# not a heading\n```\n";

// parse: a plain function. Any text is a document, so it has no Effect, no error and no span.
const document = Markdown.parse(Frontmatter.split(file).body);
// Markdown.Document, which is mdast's Root. children: a heading (depth 1, "Data on top"), a paragraph and a code
// (lang "js", value "# not a heading").

// The first level-one heading. The package gives no call for it: what a record's title is stays Records'.
const first = document.children.find((part) => part.type === "heading" && part.depth === 1);
```

- **A body, not a file.** `parse` cuts nothing. Read a whole file with its frontmatter and the first `---` is a thematic
  break and the lines after it are a level-two heading. Pass `Frontmatter.split(text).body`.
- **The tree is mdast's.** `Markdown.Document` is `Root` from `@types/mdast`, as it is. A caller that walks the tree imports
  the part types from `mdast`.
- **CommonMark with GitHub's Markdown.** Tables, strikethrough, footnotes and link literals (`www.x.com`) are read. Two
  bodies that differ only in how they are typed (`**x**` and `__x__`, `-` and `*`, `# T` and `T` over `===`, a fence of
  backticks and one of `~~~`) give the same document once every `position` is left out. A `# ` line inside a fenced or an
  indented block is code, not a heading.
- **The task-list check is off.** `[ ]` and `[x]` at the start of a list item stay text, so `- [ ] a` is a list item whose
  text is `[ ] a` and `checked` is `null`. GitHub's own check throws in micromark's development build, and in its default
  build drops the `[ ]` and puts a `checked` field on the root, for a body such as `-\n[ ] a` (an empty item, then a line
  that starts with a check). The newest published versions keep the bug. A change that turns it back on needs that body to
  read whole.
- **The first level-one heading** is the first child of the root that is a `heading` of depth 1, as in the code above. A
  heading inside a block quote or a list item is not a file's title, and a setext heading (`T` over `===`) counts.

### A part's line in the whole file

`parse` reads only the body, so every position counts from the body's start. The body is the end of the file byte for byte,
so the text before it is `text.slice(0, text.length - body.length)`. Call it `before`.

- **Line:** the part's line plus the line endings in `before`. A line ending is `\n`, `\r\n` or a lone `\r`, each counted
  once, as CommonMark counts them. For a file `Frontmatter.write` made, that is the frontmatter's lines plus its two fences.
- **Column:** the same in both, since the body starts at the start of a line.
- **Offset:** the part's offset plus `before.length`.
- **One exception:** micromark skips a U+FEFF at the very start of the body. Then the offsets, and the columns on the body's
  first line, count from after it: add one to each.

### Parts with no position

Every part has a position except a `link` and its `text` that GFM's link-literal step made, for the smallest inputs
`[a@b.x`, `_a@b.co_` and `http://.!-`. Their paragraph, heading or cell always has one, so take the nearest part above that
has one. `see https://a.b now`, `www.x.com` and `a@b.co` alone keep their positions. The positions stay as mdast gives them:
`parse` does not fill them in.

Only one pair of siblings overlaps: a setext heading and the run of link definitions right above it. mdast starts the
heading where the run starts, at its first definition, and it ends below the run's last one. `[a]: /u\nT\n===` gives a
definition at 1:1 to 1:8 and a heading from 1:1 to 3:4. An ATX heading after a definition does not overlap it.

## What it never does

It never reads or writes a file, never prints or logs, and never puts any text of the file in its span. Writing a document
back to text is not here.
