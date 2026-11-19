# The guideline page

Step 8 writes one page per design area. It holds the area's rules together, read whole, and it is
edited in place when a guideline changes. Its folder is the `guidelines` record's path in
`.kalfa/kalfa.toml`.

```text
text area     <area>.md
visual area   <area>/README.md          the page
              <area>/shots/             real shots from the built app
                <state>.<layout>.<look>.png
```

A visual area is one a person judges by its look. Its shots come from the real built app (steps 5
and 6), and they are product docs kept in the repo. The look in a shot's name is `do`, `dont` or a
design's name. The layout is one of the five in "Shoot more than one layout"
([changing the product](changing-the-product.md)).

The page holds the area's product principles and why they hold, in plain words, for a person
deciding how the product behaves. It is never shaped for code: it names no test, type, file or
`file:line`. A principle may be codified or not, by what it is; a codified one lives as a test whose
name reads like the principle, and the page keeps only the plain words. The makers' reading lives in
the research file. The kinds, the leans and their numbers, the `file:line`s, the lost designs and
the smaller calls live in the pull request's body.

The approved pages in the `guidelines` record are filled examples: read one before you write.
Where one is older than this shape, this file wins.

## The text form

`X` is a letter for the area.

````markdown
**Proposed 2026-11-19.**

What the area covers, in one or two lines, with the scope line from step 1. The makers' reading:
[<the research question>](<relative link to the research file>).

```text
the running example in a few lines: what a person does, and what the app answers
```

## X1: <name>

- **Means:** what a person or a program does, in one or two plain sentences.
- **Why:** a short quoted source, with its link.
- **Example:** one real case in plain words, from the running example, or a real shot.
- **Linear:** how its team would build it, or "No Linear answer: <why>", and where we differ.
- **Elm or OTP:** the answer that fits, and where we leave it.
- **WCAG:** the criterion it touches, or "none", and what needs a real screen reader run.
````

On the owner's yes, line one becomes `**Approved DATE.**`, and it holds nothing else. A page the
owner settled before this shape, on mockups or in a walk, counts as Approved: its line one is
`**Approved DATE.**`, dated the day he settled it.

## The visual form

A visual principle opens with a do and don't pair of shots, then the same fields. The names in
angle brackets are placeholders, not real shots.

```markdown
## X2: <name>

| Do | Don't |
|---|---|
| ![<what the do shot shows>](shots/<state>.<layout>.do.png) | ![<what the don't shot shows>](shots/<state>.<layout>.dont.png) |

- **Means:** ...
- **Why:** ...
- **Example:** the do shot above.
- **Linear:**, **Elm or OTP:**, **WCAG:** ...
```

## Checklist

- [ ] Line one is the status alone: **Proposed DATE.** or **Approved DATE.**
- [ ] The research file is linked, and the running example opens the page.
- [ ] Every principle is a `## X1: <name>` with Means, Why, Example, Linear, Elm or OTP and WCAG,
  in plain words.
- [ ] Every Why quotes a source and links it. Every Example is a real case or a real shot.
- [ ] The page names no test, type, file or `file:line`.
- [ ] A visual principle opens with a do and don't pair.
- [ ] The kinds, the leans, their numbers, the `file:line`s and the smaller calls are in the pull
  request's body, and the page holds none of them.
- [ ] Every relative link resolves.
