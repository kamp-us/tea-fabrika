# 0055: the owner-approved leakgrep change is up for review: PR 1510

https://github.com/kamp-us/tea-fabrika/pull/1510, on `fabrikalfa/leakgrep-patch-added-lines` at
`a8c0e37d18`, is a draft, and its review passed (merge-ready).

**The change:** in `.agents/skills/lead/scripts/leakgrep.sh`, the em-dash check also skips a `+`
line inside a hunk of a file under `patches/`. Every other shape still reads those lines.

**The laws,** in `leakgrep.patches.test.ts`:

1. A planted em dash on a patch `+` line passes. Red before the edit, green after.
2. An em dash in a non-patch file, or in a patch header, still fails.
3. A planted key shape on a patch `+` line still fails.

Laws 2 and 3 passed before the edit and still pass. All 79 leakgrep laws and lint pass. Both leak
greps, the branch's and main's, read every commit clean, and the PR body was leak-checked too.

**Steps:**

| Commit | Step |
|---|---|
| `8aaec47` | tests |
| `9f5a525` | build, refused by `stepcommit.sh` (`leakgrep.sh` is an exam path, so a build may not commit it); row only |
| `19e9165` | a fresh tests round committed the edit, as the tool directs |
| `4aea1a7` | review: pass, with two non-blocking finding rows |
| `a8c0e37` | the finding rows |

**One thing to check when you merge:** one old law's `"added"` case was removed, because it held
the rule the owner reversed. That is the approved change itself, not a loosening beyond it. It is
still a removed case, so give it your `loosening.sh` read.

**Once 1510 is on main,** I tell tea-s2 to merge main in and re-run leakgrep on `18a737b` and
`a75c121`. It pushes both only on exit 0, then updates PR 1431. After that comes its review, and
then group 1's pipeline patch slice.
