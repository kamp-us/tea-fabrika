# Markdown

A Markdown file as a thing code can read and write: its frontmatter, its body, and the body as a tree. This context
knows nothing about what a file means. What a record is stays Records'.

## Language

**Frontmatter**:
The block of data at the top of a Markdown file, between two `---` lines. It holds what code reads from the file.
_Avoid_: front matter, header, metadata, properties

**Body**:
Everything in a Markdown file after its frontmatter. It is free text for people.
_Avoid_: content, text, prose

**Document**:
A body read into a tree of its parts: headings, paragraphs, lists, links. Two bodies that differ only in how they
are typed give the same document.
_Avoid_: tree, AST, nodes
