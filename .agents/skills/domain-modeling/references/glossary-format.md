# The format of a context's words

A context's words are rows in a table, one row per word. The map says where each context's rows
are written. Today the map is [`.glossary/TERMS.md`](../../../../.glossary/TERMS.md). The map also
says how the contexts meet, and how a word that crosses a border translates.

A context starts with a line or two that says what the context is and why it exists. Its rows
follow, in a table with three cells:

```md
| Term | Definition | Not |
|---|---|---|
| Order | A request from a customer to buy goods, placed and tracked until it is fulfilled. | Purchase, transaction |
| Invoice | A request for payment sent to a customer after delivery. | Bill, payment request |
```

- **Term:** the one word the project uses, picked from its synonyms.
- **Definition:** one or two sentences. Say what the thing is, not what it does. Cite the decision
  or the note that settles it, by its relative link.
- **Not:** the old names, the wrong names, and the nearby words a reader may mix it up with.

## Rules

- **Be opinionated.** When several words name one concept, pick the best one and list the others
  under Not.
- **Keep definitions tight.** One or two sentences. Define what it is, not what it does.
- **Only this context's words.** A timeout or an error type is not one of a context's words, even
  when the context uses it a lot. Before you add a word, ask: is this unique to this context, or a
  general programming concept? Only the first belongs.
- **One meaning per context.** A word with two meanings inside one context is a bug. A word that
  means something else in a second context gets a row there too, and the map names the boundary.
  A word that appears in two contexts carries its context in its key, such as `inbox (ledger)`.
- **Check the industry's word first**
  ([names](../../../../docs/direction/use-the-industrys-names.md)).
- **Group under headings** only when natural clusters appear. A flat list is fine when every term
  belongs to one area.
- **Add or change a row in the same pull request that coins or renames a word.**
- **No implementation detail.** A glossary is not a spec or a scratch pad. It holds words and
  nothing else.

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT license).
