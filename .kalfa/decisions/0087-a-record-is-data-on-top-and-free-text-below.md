# A record is data on top and free text below, and Markdown's mechanics are their own package

Records' protocol (https://github.com/kamp-us/tea-fabrika/issues/1761) read one thing from a record, its summary, and
wrote nothing, so a fact code had to check (a decision's status) lived in prose, and the only way to check prose is to
compare its exact text. We decided that a record's data is its frontmatter, checked against its kind's shape, and that
its body is free text code never turns into data beyond the first heading. `@kalfa/records` reads a record's data,
makes a record from data and sets fields on one, and a kind's shape is a JSON Schema file its setting names. The
mechanics move into a small `@kalfa/markdown` package below Records: Markdown text to and from mdast, and reading and
writing frontmatter. We chose this because it is how tools that keep records in Markdown already work (Changesets,
Astro's content collections, GitHub Docs), and because the makers of the standard Markdown writer say a full round
trip of a body is impossible. The design ticket is https://github.com/kamp-us/tea-fabrika/issues/1909.

## Considered Options

- The whole body as data, each `## ` section a field, so code rebuilds a file from data: rejected, because a body
  that code writes back comes back restyled (`__bold__` returns as `**bold**`), and every record would have to be
  written to fit a parser.
- The mechanics stay inside `@kalfa/records`: rejected, because frontmatter has no formal standard and each tool
  reads it a little differently, so one package should own the one reading, and Records is not the only package that
  holds Markdown.
- A kind's shape as a list of field names and types in the settings file: rejected, because it is a small language
  of our own where JSON Schema is the open standard, which editors already read.
- One shared package for everything that makes text (Delivery's templates, Conversation's bodies, a plan's view):
  rejected, because they share only that the result is text.

## Consequences

- `@kalfa/markdown` is built before Records, and Records' build tickets are drawn on it. It imports no kalfa package.
- A fact that code checks must sit in a record's frontmatter. Most records in `.kalfa/decisions/` have none today, so
  a kind that gets a shape needs its records moved once.
- The suite has no check that compares the exact text of a file a person writes. A byte check stays only for text
  that must not change between two moments, such as a signature, a copy after it moved, or a file code made.
- Effect 4.1.3 turns a JSON Schema 2020-12 file into a Schema (`SchemaRepresentation.fromJsonSchemaDocument`). It
  drops an extra field with no error and refuses a `pattern` unless told to apply it, so a shape that needs either
  says so in its own build ticket.
- Effect has no YAML writer, so writing frontmatter uses the `yaml` library. Whether it keeps comments and key order
  when one field is set was not tried.
- The tree half of `@kalfa/markdown` has one sure user today, Records. Conversation's bodies are Markdown, but only
  GitHub was studied, and GitHub takes Markdown as it is.
- Nothing here was type-checked when it was decided.
