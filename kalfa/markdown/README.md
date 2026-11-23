# @kalfa/markdown

Read and write a Markdown file's frontmatter against a schema. Frontmatter is the YAML block between two `---` lines at
the top of a file. This package knows nothing about what a file means: it turns text into data and back, and it is the one
place that decides how that YAML is read and written. Words: [GLOSSARY.md](./GLOSSARY.md).

It is private. Import one module, `@kalfa/markdown/Frontmatter`. It needs `effect` and `yaml`, takes text, and does no IO.

## The three calls

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
```

- `split(text)` answers `{ frontmatter: Option<string>, body }`. A fence line is `---`, with a `\r` before its line break
  allowed. The first line must be one and the frontmatter ends at the next one. Anything else has no frontmatter, and the whole
  text is the body. The body is kept byte for byte.
- `read(text, schema)` fails with `NoFrontmatter` when the file has none, and with `BadFrontmatter` when it cannot be read or
  the schema refuses it. It needs the services the schema's decode needs, and no others.
- `write({ data, body }, schema)` answers `Result<string, BadFrontmatter>`. A refused value gives no text.

`BadFrontmatter` has a `reason`, a one line `message`, the file's `line` when one is known, and the `cause`:

| `reason` | Meaning |
|---|---|
| `syntax` | The frontmatter is not YAML: a tab as indentation, a duplicate key, an unclosed quote, a second document. |
| `value` | It is YAML, but not a JSON object: a top level that is not a map, a tag that makes a `Set` or a `Date`, `.nan` or `.inf` as a value or a key, a key that is a list or null, two keys that give one text. |
| `schema` | The caller's schema refused the data. The `cause` is the `SchemaError`, which names the field. No `line`. |

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

## What it never does

It never reads or writes a file, never prints or logs, and never puts any text of the file in its span. Reading a body into
a Document, and changing one value of a frontmatter while keeping every other byte, come in later changes.
