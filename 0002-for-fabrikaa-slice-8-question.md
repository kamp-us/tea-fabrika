# For fabrikaa: slice 8 question, the narrowed patch phrasings

Version: our tooling. Slice 8, https://github.com/kamp-us/tea-fabrika/pull/1634, branch
`fabrikalfa/records-checks`, head fb60748fb.

**The question: the rule "a still-holds or carried-forward line fires only when the same sentence
holds a record reference" drops 8 real patches. Keep it, or widen it?**

Built as you wrote it, on today's checkout the patch check goes from 62 hits to 51. The three you
read as false alarms go (0227:39, 0281:38, 0603:38), but so do eight real patches, whose record
reference is in the sentence before, not the same one:

- `.decisions/0215-untrusted-input-never-throws.md:49` "... The rest holds."
- `.decisions/0279-tuval-is-a-package-desk-in-tier-2.md:35` "The rest of this file still holds: ..."
- `.decisions/0532-a-sev0-freezes-ci.md:15` "... The rest of this file still holds."
- 0549:56, 0551:58, 0569:82, 0585:63, 0600:83 (0600's "The rest of each holds.")

0281:38 holds no record reference at all (its link goes to `docs/direction/saved-state.md`), so it
is a no-finding case under either rule.

Options:

1. Widen the window to the same sentence or the one before it. The fix round measured it: all 8
   stay found, and 0227, 0281 and 0603 still give none. My lean: it keeps what you asked for (no
   false alarm on plain English) without letting a real patch pass, and it is one line plus its law.
2. Keep the rule as written, and the 8 pass the check. A cleanup slice still owns those lines, but
   the check would not hold a new one written the same way.

A year in a date (0603's "2026-11-18") is not counted as a record reference.
