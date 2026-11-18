---
id: 0543
title: In next/, an approved guideline is followed as written, and a different look or behavior waits for a new guidelines study the owner sees
status: accepted
date: 2026-11-15
tags: [guidelines, next, design, ux, owner, clean-slate]
---

# 0543: In next/, an approved guideline is followed as written, and a different look or behavior waits for a new guidelines study the owner sees

**What this decides:** how `next/` treats a guideline the owner approved for today's app, and who
makes a UX call that a guideline does not settle.

## Context

[0217](0217-next-grows-beside-today.md) says what a tryout on today's app teaches goes into `next/`
"as a lesson, rethought, never copied", and `AGENTS.md` repeats it under "Two versions, side by
side". Read alone, that lets a `next/` builder treat an approved guideline as one more lesson and
pick a different look on their own reading. The tile slice did this
([pull request 1248](https://github.com/kamp-us/tea-fabrika/pull/1248), ticket 979): a tile whose
process had ended showed its state only in the title bar and kept drawing its last view. The
[tile guidelines](../docs/direction/tile-guidelines.md) say a tile kept after a crash follows the
empty state's rule, and that rule is one word where the content starts ("Empty and loading"). The
owner ruled on 2026-11-15 that `next/` follows the approved guideline.

A guideline is not code. It is studied material: the makers were read, designs were built and shot,
and the owner said yes ([the guidelines skill](../.claude/skills/guidelines/SKILL.md)). Rethinking it
in a plan throws that study away without a new one.

How this relates to the decisions and notes near it:

- **[0217](0217-next-grows-beside-today.md)**: this record amends it in part. Its "a lesson,
  rethought, never copied" now covers code and shapes only. An approved guideline's rules carry over
  as written. `next/` still imports nothing from today's version and copies no code.
- **[0525](0525-todays-version-is-frozen.md)** froze today's version. Freezing the code does not
  retire the guidelines studied on it.
- **[0136](0136-guidelines-live-in-their-own-pages.md)**: a change to a guideline is an edit to its
  page with the owner's yes; this decision adds that a different look in `next/` is such a change,
  so it needs a study first.
- **[Rethink, do not port](../docs/direction/rethink-do-not-port.md)**: its subject is how jobs and
  machines are built, and "older code here is a list of lessons" is true of code. It says nothing
  about guidelines.
- **[Clean slate](../docs/direction/clean-slate.md)** repeats 0217's tryout line. Its decided rules
  point at 0217, so this decision reaches it there; the note's text is left alone.
- **[Tile guidelines](../docs/direction/tile-guidelines.md)** said `next/` reads it "as a lesson".
  That one line now points here. No rule on the page changes.
- **[0502](0502-a-tiles-state-is-a-word.md)** and the other tile files (0499 to 0504) say "in
  today's version". They are written from this guideline, so through it their rules apply in
  `next/` too. Their text does not say the opposite, so they are not edited.

## Decision

**In `next/`, an approved guideline written for today's app is followed as written; a different
look or behavior needs a new guidelines study brought to the owner first.**

- An approved guideline's rules carry over to `next/` as written. Code is still rethought, never
  ported.
- A different look or behavior from what an approved guideline says needs a new study with the
  [guidelines skill](../.claude/skills/guidelines/SKILL.md), brought to the owner. Nobody deviates
  on their own reading, and a lean in a plan is not a study.
- Where a `next/` decision or an approved plan law fixes a point differently, that decision or law
  holds for that point. The pull request names the difference.
- Where a guideline is silent, nothing is invented. The gap is said plainly and goes to the owner or
  to a study.
- Every UX or product question (what a person sees, presses or reads) comes to the owner before a
  choice is made. An agent may build options side by side to show; it lands none on its own lean.

The first use, the tile whose process ended:

```text
before   state slot   Ended (crashed)
         body         Nothing on the list yet. 0 left      the ended process's last view

after    state slot   Ended (crashed)
         body         Ended                                one word where the view starts
```

The desk's status bar, which shows the prefix key, likewise stays one line, as the tile
guideline's "Bottom status line" section says. One
point there keeps the slice's plan and [0504](0504-two-live-regions-from-boot.md) over the
guideline's empty-state line: the end is said politely, not with `role="alert"`, and the pull
request names that difference.

## Consequences

- `next/` screens start from the approved pages, so the owner does not decide the same look twice.
- The cost: a builder who sees a better look must stop and ask for a study, which is slower than
  building it.
- `AGENTS.md`'s line about lessons now says that an approved guideline carries over as written.
- Not decided here: what counts as an approved guideline for a study written before
  [0136](0136-guidelines-live-in-their-own-pages.md)'s pages exist. The tile note is approved
  (decided 2026-11-01 by the owner); a note marked **proposed** is not.
