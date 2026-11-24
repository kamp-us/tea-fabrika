---
name: step-commit
description: Commit and sign one pipeline step's work in one command. Use whenever the tests, build, mutation or lead step commits, instead of running git commit and pnpm commits sign apart.
---

# Commit and sign a step

One command stages the paths you name, refuses a build commit that holds an exam path, commits as
the bot with the person as co-author, signs the link as your step, and pushes it. Run it from the
repo root.

```sh
sh .agents/skills/step-commit/scripts/stepcommit.sh <step> <ticket> "T<ticket> <step>: <subject>" <path>...
sh .agents/skills/step-commit/scripts/stepcommit.sh --commit-only <step> <ticket> "T<ticket> <step>: <subject>" <path>...
sh .agents/skills/step-commit/scripts/stepcommit.sh --body-file plants.md tests 277 "T277 tests: one refusal per request" <path>...
sh .agents/skills/step-commit/scripts/stepcommit.sh build 277 "T277 build: one refusal per request" next/apps/fabrika/src/door.ts
```


## The rules

- **`<step>` is `tests`, `build`, `mutation`, `lead` or `fix`.** `mutation` signs as `tests` for now, a
  stopgap until it has a role of its own (field note 2026-11-08-19).
- **`fix` is a fix round**: one agent
  writes the law and the fix, so the commit may hold exam paths and takes the paths the plan gives to
  `tests` or `build`, and an exam path it gives to no step. A path the plan gives to any other step is
  refused. It signs nothing; it still pushes.
- **A `tests` commit carries its plant record.** `--body-file <file>` puts the file's text in the
  commit body. For `tests` the body needs a `Plant: <law title>: <what you broke>: <the failure's first line>`
  line per new law, and the reach table when the plan has a `## Generators` section, or the script
  refuses (exit 7) and commits nothing. A `fix` commit that names a test file (`*.test.ts`,
  `*.test-support.ts`) needs the same line; a `fix` of product files only does not. The review reads
  the record from `git log`. A box's commit (drive's) needs none. Other steps may pass a body; none must.
- **`--empty` makes a commit with no files.** The `lead` step uses it to open a slice's pull request. A
  `build` or `fix` commit may too, to carry `Survivor:` lines: its body is those lines and nothing else, or the
  script refuses (exit 2). It signs and pushes like that step's other commits. A commit right after an empty one
  refuses (exit 4), since two empty links on one tree break the chain: put every line in one.
- **Start with nothing staged.** If the index already holds changes, the script refuses (exit 4)
  before it stages anything, and lists them. Do not unstage another step's work: name the staged
  paths in your report, and finish the work that does not need the commit.
- **A `build` that names an exam path is refused** (exit 3) and nothing is committed. The paths are in
  `exam-paths.json`. Do not work around it: answer `send` to tests with the paths.
- **Each path must be the step's own in the plan's files table**, or the script refuses with
  `not_owner: <path>`. One exception: the exam is the test writer's, so a `tests` commit may hold
  an exam path that no row names. A path the plan gives to another step stays refused, exam path
  or not. `box.sh fetch --sign` holds the same rule. Both read an exam list the step cannot edit:
  the script reads the box base's, fetch reads main's.
- **A `lead` link signs only under a real ticket, and one no other branch's open PR holds.** The
  number must be an open tracker ticket or an open GitHub issue of this repo (the kalfa build tickets
  are issues), or the script refuses (exit 5, `unknown_ticket`) and signs nothing. A made-up number
  such as 0, a closed ticket or issue, and a pull request's number are refused, so lead tooling files a
  ticket first (`tracker_file`). If neither the tracker nor GitHub can say, it refuses too. Then, a
  ticket whose open PR is on another branch refuses (exit 5) and names that PR and branch: the new
  link would be that ticket's newest, outside the PR's chain, and the commits check would read the
  PR's own lead links as `stale_link`. Sign field rows and other lead work under a lead ticket of its own.
- **One commit per call.** Several commits mean several calls, in order.
- **Never rewrite history.** No `reset`, `rebase`, `commit --amend` or force-push. A takeover is a
  new commit on top. A rewrite leaves signed links that no longer match (`stale_link`).
- **Never read, print or copy a key file.** The script reads `~/.fabrika/step-keys/<step>` itself.
- **It pushes for you.** A commit is pushed at once, after the leak grep, and the branch gets
  a draft pull request when it has none. If the push cannot run, it exits 6 with the commit
  made (and signed, unless it is a `fix`): put the command it prints in your report and go on with your step, and the lead
  runs it. `--commit-only` and a box's commit push nothing here; the quest's host part pushes them.
- **It ends a merge of main.** With a merge in progress (`git merge --no-commit origin/main`), name
  your own paths and each conflict you resolved, and it makes the merge commit. Main's files the
  merge left staged, unchanged, need no naming and no owner. Any other staged path refuses with exit 4.
- The co-author comes from `FABRIKA_COAUTHOR` (`Name <email>`), or your global git config. It never
  reads a box's own git config.

## When it fails

stepcommit.sh checks named paths, owners, exam paths and staged formatting. For every step but tests (its laws are red on types until the build), it also runs the typecheck of each package that owns a committed .ts file.
fetch --sign checks owners and signs missing notes in MAIN.
A step that `drive.ts` runs in a box does not call this script: drive commits its tree and signs it.
`--commit-only` runs the same checks and leaves signing to fetch.
Owner checks read the box's saved plan. Older worktrees without `.box` keep the legacy route.
Existing notes stay unchanged, including invalid or stale links. Put their check result in your report
for the lead.
- The full table of answers is in [sign a step's commit](../../../.kalfa/runbooks/sign-a-step-commit.md).

`scripts/exam.py <exam-paths.json> <path>...` prints each path that is an exam path, with its glob,
and exits 1 when it finds one. The plan step's check uses it too.
