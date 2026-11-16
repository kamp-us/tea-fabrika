# 0076: two box problems need tickets; 0113 slice 1 is done

Two problems in cloud boxes were each seen twice today. Under AGENTS.md's second-time rule, each
needs a root cause and a tracker ticket, and the tracker is on the laptop. I put a rule for each
into `fabrikalfa/twin-tools` `step-rules.md` at `652d233c3`, so coordinators avoid them meanwhile.
Separately, 0113 sweep slice 1's second round is rechecked and done.

## Ticket 1: lint and typecheck parts die when a box is short of memory

| Where | What happened |
|---|---|
| Mock group 1's box | Whole `pnpm lint` runs lost tsgo parts to the memory cgroup's out-of-memory kill, while two agents ran. |
| 0113 sweep box | `lint:dead`, `lint:promise-types` and `lint:kind` died with EPIPE while three agents ran. |

In both boxes, each part passes when run alone. A finding row for the 0113 sighting is being
written in its S3 review.

The new rule, "A box is small":

- At most two code agents run at once in a box.
- Only one of them runs `pnpm lint` or `pnpm typecheck` at a time.
- A part that dies this way is run again alone before anyone calls it red.

The root cause for the ticket to settle is the box's memory limit, set against `pnpm lint`'s
parallel parts. Two ways it could go: make the parts run one after another when memory is short,
or set a box size the environment can rely on. That part is my guess.

## Ticket 2: a worktree checkout keeps old content after moving to the branch head

Seen twice in the 0113 sweep. After a worktree agent fast-forwards to the branch head, its index
and files can still hold the old content. The reviewer restored them with
`git checkout HEAD -- <paths>`. The new rule tells agents to check `git status` after the move and
restore any stale paths the same way before reading or testing. I do not know the root cause.

## 0113 slice 1: done

- **Branch:** `fabrikalfa/port-0113-s01`, at `1e431b1`. That commit is the review row, on top of
  `43944f5`. Leakgrep is clean.
- **What the hold now reads:** `#!` lines on files that have no extension, for shell or Python,
  run directly or through `env`. It skips `env`'s flags, its `NAME=value` words and its option
  values, the way GNU and FreeBSD `env` read them.
- **The list:** 19 entries. `bin/tsh`, `packages/pipeline/bin/tsh` and
  `packages/fabrika/bin/tsh-small` are listed as "today's version, deleted with it (0525)", and are
  not touched.
- **The new law:** it went red on the old hold first. The plan's S1 row and Laws row carry dated
  notes.
- **The round:** one send-back. `env` options that take a value (`-u NAME`, `-C DIR`) were read as
  the interpreter. One fix round fixed it, and the same reviewer passed it.
- **A finding for later, not blocking:** the law seldom draws the `-iu NAME` flag cluster. The row
  is being filed on the branch.

## The other 0113 slices

| Slice | State |
|---|---|
| S2 (the Git service and `governance.ts`) | In review at `8b7a8b2` |
| S3 (`fieldrow.ts`) | In review at `8491d53` |
| S4 (RunsFs) | Tests done at `bc66217`; its build is next |
| S5, S6, S9 and S10 | Tests queued |

PR 1505's body now has its `## New names` section, which says "None.".

## What this cannot tell you

- Whether the memory kills happen with one agent on a large diff. Both sightings had two or more
  agents running.
- Why the worktree index goes stale. Nobody has traced it yet.
