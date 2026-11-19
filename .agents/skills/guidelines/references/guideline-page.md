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

The page holds the rules and why they hold. The makers' reading lives in the research file. The
leans and their numbers, the lost designs and the smaller calls live in the pull request's body.

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

- **Kind:** law, lint or taste.
- **Means:** what a person or a program does, in one or two plain sentences.
- **Why:** a short quoted source, with its link.
- **Example:** real code or a real shot.
- **Linear:** how its team would build it, or "No Linear answer: <why>", and where we differ.
- **Elm or OTP:** the answer that fits, and where we leave it.
- **WCAG:** the criterion it touches, or "none", and what needs a real screen reader run.
- **Held by:** the type, test, lint rule or refusal that holds it. A `law` names its test by its
  exact title, and a `lint` names its rule; one not built yet links the quest that builds it. A
  `taste` principle names the shot a person judges it by.
- **Breaks today:** `file:line`, or "Nothing: today's <example> follows it, at `file:line`."
````

On the owner's yes, line one becomes `**Approved DATE.**`, and it holds nothing else.

## The visual form

A visual principle opens with a do and don't pair of shots, then the same fields, plus Tokens and
Checked by. The names in angle brackets are placeholders, not real tokens or shots.

```markdown
## X2: <name>

| Do | Don't |
|---|---|
| ![<what the do shot shows>](shots/<state>.<layout>.do.png) | ![<what the don't shot shows>](shots/<state>.<layout>.dont.png) |

- **Kind:** taste.
- **Means:** ...
- **Why:** ...
- **Example:** the do shot above.
- **Linear:**, **Elm or OTP:**, **WCAG:** ...
- **Tokens:** `<token>`, `<token>`, from `@kampus/fabrika-design`.
- **Checked by:** who looks, at which of the five layouts, beside which Linear screen.
- **Held by:** ...
- **Breaks today:** ...
```

## Checklist

- [ ] Line one is the status alone: **Proposed DATE.** or **Approved DATE.**
- [ ] The research file is linked, and the running example opens the page.
- [ ] Every principle is a `## X1: <name>` with Kind, Means, Why, Example, Linear, Elm or OTP,
  WCAG, Held by and Breaks today.
- [ ] Every Why quotes a source and links it. Every Example is real code or a real shot.
- [ ] Every `law` and `lint` principle's Held by names its test or lint rule, or links the quest
  that builds it.
- [ ] Every `file:line` was read on main the day the page was written.
- [ ] A visual principle opens with a do and don't pair, and names its Tokens and Checked by.
- [ ] The leans, their numbers and the smaller calls are in the pull request's body, and the page
  holds none of them.
- [ ] Every relative link resolves.
