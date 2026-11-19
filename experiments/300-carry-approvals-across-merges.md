---
date: "2026-11-18"
scripts: "carry-approvals.ts, on the branch fabrikalfa/exp-carry-approvals at experiments/scripts/carry-approvals.ts, not on main. It reads local git and the list from `gh pr list`, and writes raw rows under runs/ (git ignores it, 0027). It runs about 3 minutes."
summary: "Both versions; $0. Yes, code can decide most of it. Of 250 merges of main into PR branches since 2026-11-15, decision 0394's rule keeps the approval on 127 (51%), asks for a glance on 8 (3%) and for a re-review on 115 (46%). A plain patch-id alone keeps only 116. Of the 115, 11 had nothing new in the resolution (a false alarm) and 25 only dropped lines. Plain `git range-diff` saw none of the 250 resolutions. A clean merge can still break meaning: main touched a file the PR touches in 48 of the 127 kept."
---

# 300. Can code decide that an approval carries across a merge of main?

**The answer.** Mostly yes, and the rule already exists: [0394](../.decisions/0394-a-yes-carries-by-one-rule.md)
(`kept`, `glance`, `stale`), from [experiment 165](./165-review-binds-to-diff.md). It was measured
on force pushes. This write-up measures it on merges of main into a PR branch, which is the case
the `merger` meets. Both versions are in the data (the PRs touch `next/` and today's code); the
rule it recommends is for `next/`'s `merger`.

- **Half of the merges are mechanical.** Git's own merge of the PR head and main gives exactly the
  merge commit's tree in 127 of 250. The approval carries, with no human.
- **The other half had a hand-made resolution.** 123 merges differ from what Git would write. In
  104 of those the PR's own added lines changed. A person (or an agent) wrote new text there, so
  a re-review is fair, but of the *interdiff only* (the resolution), never the whole PR again.
- **Whole-PR re-review is too much.** The median PR among the merges that changed the PR's own lines touches 75 files. The resolution
  was often 1 to 3 lines.
- **Semantic conflicts are invisible to every diff rule here.** Main changed a file the PR also
  touches in 48 of the 127 kept merges. Only the checks at the final head catch a break there,
  which 0394 already says.

## What was measured

Data: the 374 PRs created since 2026-11-15 (`gh pr list`, 213 merged, 24 closed, 13 open), each
fetched as `refs/pull/N/head`. A merge counts when its second parent is on `origin/main` and it is
not itself on main. That gave 250 merges in 86 PRs; 42 PRs had more than one. For a merge M with
first parent P and main parent S:

- **before** = the PR's change as it was: `git diff merge-base(P,S) P`;
- **after** = the PR's change as it is: `git diff S M`;
- **mechanical** = `git merge-tree --write-tree P S` gives exactly M's tree (nobody edited);
- **interdiff** = the added lines that differ between before and after, read with `-U0`, with
  whitespace squashed and blank lines dropped. Removed text is ignored: it comes from main.

| What | Merges | Share |
|---|---|---|
| All merges | 250 | 100% |
| Same `patch-id --stable` | 115 (+1 with no PR change) | 46% |
| 0394 `kept` (clean replay gives the tree) | 127 | 51% |
| 0394 `glance` (only the `-U0 --verbatim` patch-id matches) | 8 | 3% |
| 0394 `stale` | 115 | 46% |
| of the stale: whitespace-only interdiff | 8 | |
| of the stale: same lines, hand-resolved (context moved) | 3 | |
| of the stale: the PR only lost lines | 25 | |
| of the stale: 1 to 3 new lines | 21 | |
| of the stale: 4 or more new lines (median 17, 20 over 50) | 58 | |
| `git range-diff` default marks every commit `=` | 250 | 100% |
| Kept, but main touched a file the PR touches | 48 of 127 | 38% |

Reading it:

- **A re-review that was not needed** (the interdiff holds nothing new): 11 of 250 (4%), or 11 of
  the 115 asked (10%). Another 25 asked only for deleted lines, a short look.
- **`--stable` patch-id alone** keeps 116 and asks 134. The clean replay adds 11 more kept, which
  is why 0394 uses it first.
- **range-diff is blind here.** It compares the PR's own commits, and they are the same on both
  sides. It ignores merge commits unless you pass `--diff-merges` (docs). So it never saw a
  resolution. Our own `git range-diff` runs would have printed all `=`. It needs `--remerge-diff`
  (git 2.36+ per the docs; the git here is 2.40, which I did not run it with).
- **All 115 same-patch-id merges were also mechanical.** No hand resolution kept the patch-id.

## The real-change cases, read

I read all 24 small ones and about 10 of the larger ones and the shrunk ones.

- **No human needed** (about 10 of the 24): `pnpm-lock.yaml` regenerated; two sides each adding a
  name to one `import { ... }` line (PR 1609, merge a2ca6c9fae: `Match, Predicate` added beside
  main's import edit); comment lines reflowed; identical `SAFETY:` comments moved. A formatter or
  a lockfile check covers them.
- **One line where both sides edited the same line** (PR 1594, the `lint` script in
  `package.json`, four merges): the resolution joins two edits. A look at the one-line interdiff
  is warranted and enough.
- **A person should look** (2 of the 24): PR 1462, merge 4cb461d81e, where the condition became
  `["reserved","rate_limited","quota"].includes(answer.reason)` (main added a reason, the PR
  kept its own logic); and PR 1619, merge 94d2a701eb, where a call changed shape. Both are logic
  joined from two sides.
- **The large 58** are mostly big sweep PRs (PR 1562 has 947 files, PR 1593 322, PR 1589 over
  100) where main moved under hundreds of lines. Reading each was not possible; the sample showed
  rewritten imports and renamed calls. A whole re-review of a 947-file PR for this is the
  expensive case, and the interdiff is the answer there.
- **The PR only lost lines** (25 stale): main now holds the same text, or the resolution took
  main's side. Median 80 lines lost. Nothing new was written, so a glance at the deleted lines
  fits. I did not check each one against main.

## What others do

Each claim is marked **docs** (read on the page named, quoted short) or **guess**. The docs text
came through a page fetch that summarizes, so a quote may be tightened by it; check the page
before you cite it in a decision.

- **Gerrit** (docs: Gerrit config-labels page). A label's `copyCondition` decides which approvals
  go to a new patch set: "If the query matches, the approval is copied from one patch set to the
  next." The change kinds: `TRIVIAL_REBASE` (same message and same diff; a rebase counts when Git
  needed no conflict resolution), `NO_CODE_CHANGE` ("the same code diff (including context lines)"
  as the last patch set), `NO_CHANGE` (same parent tree, same delta, same message, only the SHA
  differs), `MERGE_FIRST_PARENT_UPDATE` (a merge commit that differs only in its first parent).
  The last one is for a change that *is* a merge commit, so it does not fit our branches, where
  main comes in as a second parent (guess). The closest of ours is `TRIVIAL_REBASE`: no conflict
  resolution means carry. That is the same cut as our "mechanical" test, and as 0394's `replayed`.
- **GitHub** (docs: protected branches page). The setting dismisses approvals "when commits are
  pushed that affect the diff in the pull request". The page says the approval is dismissed when
  the diff changes, including by **Update branch**, and "if the merge base introduces new changes
  after the review was submitted". So GitHub looks at the diff against the base, not at the sha
  (docs). What it does for a merge of main whose result is mechanical: not stated on that page
  (guess: it does not dismiss, since the PR diff is unchanged).
- **GitLab** (docs: approval settings). By default an approval is removed when more changes are
  added. It compares patch ids: "the `patch-id` is evaluated against the previous `patch-id` to
  determine if the approvals should be reset", and the page names `git rebase` and
  `git merge <target>` as the commands it handles. That is our `--stable` row: it keeps 116 of 250
  and asks 134 times. The separate "remove approvals by Code Owners if their files changed" setting
  is per-file (docs).
- **Prow's lgtm** (docs plus the plugin source, `lgtm.go`). The label is removed on a push
  (`synchronize`), unless the PR author is in the sticky team, or, with `StoreTreeHash` on, the
  head's tree hash equals the one stored with the lgtm. A merge of main changes the tree, so it
  drops the label; the tree-hash test only helps a rebase that changes no content (the code does
  not name rebases; that reading is a guess).
- **bors** (docs): the page I read does not say what happens to an `r+` on new commits; it only has
  `up_to_date_approvals` for GitHub reviews. Not verified further.
- **Phabricator, Graphite**: the pages I tried did not answer (a timeout and a 404). From memory,
  Phabricator keeps an accepted revision "accepted" until the diff changes, and Graphite follows
  GitHub's setting. Both are **guesses**; not cited for any decision.
- **`git patch-id`** (docs): "line numbers ignored". `--stable`: "All whitespace within the patch is
  ignored", and reordering file diffs does not change the id. `--verbatim`: does not strip
  whitespace. Context lines are part of what is hashed, I believe (guess; the page does not say),
  and in the data the `-U0` id matched when the `-U3` id did not in 11 merges and never the other
  way round.
- **`git range-diff`** (docs): commits match when "the diff between their patches ... is reasonably
  small compared to the patches' size", `--creation-factor` default 60, merges ignored by default,
  `--remerge-diff` shows only what the merge changed beyond Git's own result, and "a non-conflicting
  `git merge`" gives an empty diff there. The page has no legend for `=`, `!`, `<`, `>`; the
  meanings are read from its example.

## The rule for `merger`

It is 0394's `carry` with one change: a `stale` answer asks for the interdiff, not the PR.
Confidence about 75% (the cut points are mine; the data has no approval times).

```ts
// A sketch. `auto` is the tree of `git merge-tree --write-tree <pr head> <main>`.
type Carry =
  | { _tag: "kept"; reason: "same_head" | "replayed" | "formatted" } // M's tree is auto, or the formatter's output
  | { _tag: "glance"; range: string } // same -U0 --verbatim patch-id, or a resolution that only deletes or only re-spaces
  | { _tag: "stale"; interdiff: string }; // review `git diff auto M`, and only that
```

- **Carries, silently:** `kept` when `auto == M`. This is Gerrit's `TRIVIAL_REBASE`, GitLab's equal
  patch id and 0394's clean replay. 127 of 250 (51%). Same tree after a pure merge also covers
  `NO_CHANGE`.
- **A short look:** the `-U0 --verbatim` id matches (8 of 250), and a resolution whose interdiff
  adds no non-blank text (the 25 shrunk ones, the 8 whitespace-only). That is a change from 0394,
  which makes those `stale`. It would move 33 more merges from re-review to a glance. Cost: if the
  dropped lines were wrong (main did not hold them), a glance can miss it. I did not check each of
  the 25 against main; confidence in this part is about 65%.
- **Re-review of the interdiff only:** a hand resolution that adds text, 79 of 250 (32%). The
  reviewer reads `git diff auto M`, usually 1 to 20 lines, not the PR. Of these, about a third
  (lockfile, an import list, a reflowed comment) need no person: let a formatter or lockfile check
  answer.
- **A semantic conflict is left to CI, on purpose.** Clean merge, no diff change, but main
  changed a file the PR touches: 48 of the 127 kept. No diff rule sees that two correct edits
  disagree. 0394 already requires the checks at the final head, and that is the only guard. Do not
  re-ask a person for these 48; it would put a re-review on 38% of the kept merges for a risk that
  CI covers. Flag them in the row so a red check at the final head is read with that in mind.

## What it cannot tell us

- **No approval times.** I assumed every merge came after an approval. Agents merge main into their
  branches often before any review, so the share of merges that cost a real re-review is lower
  than 46%.
- **Which re-reviews were worth it.** I read about 35 of the 115. The rest rest on line counts. A
  person might have found a problem in a "no human needed" case, and I did not link a merge to the
  CI result after it, so the 48 semantic-risk merges are a count of risk, not of breaks.
- **Branch history is partial.** `refs/pull/N/head` keeps only the last head, so a merge lost to a
  force push is missing. The window is since 2026-11-15 and holds many sweep PRs of hundreds of
  files, which inflate the large group.
- **Both versions are mixed**, and agents wrote most of these merges. Decisions about how a
  person merges by hand may differ.
- **Nothing was built.** 0394's `carry` exists in today's `carry.ts`; `next/programs/pipeline/src/Merger.ts` has no carry step yet, and `git range-diff --remerge-diff` was not run.
