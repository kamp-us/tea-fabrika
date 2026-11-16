# 0117: app-src s2 was sent back once; instance-one-file needs a 0036 ticket (second sighting)

## app-src s2: sent back once, review head `d9d8c5f68527b1dcdea707cb669a099b44b0c1f0`

**The blocker.** The Alchemy patch classifies a failed workerd start from only the last 4096
characters of stderr (patch line 379). Upstream classifies all of it. The reviewer proved it by
driving the patched dist:

| stderr size | What the patch classifies | Spawns |
|---|---|---|
| 3.8 KB | `ConfigError WorkerdUserScript` | 1 |
| 9.6 KB | `SystemError WorkerdStartFailed`, losing the "service core:user:brain:" line | 4, through retries |

That breaks 0054: a patch fixes only the gap it has proved. The reviewer is about 80% sure this
should block, rather than go in a finding row.

**What holds:**

- The serve scope waits for workerd to exit.
- The exit signal is read from Effect's message. The wording is fragile, but B1 pins it.
- The patch touches dist only, which is fine. When you file the upstream issue, it should carry the
  matching change to `src/core/workerd/Workerd.ts`.
- The lockfile carries only the hash.
- B1 and B3: the wait is real, and the floor of 1 spawn proves the reach.
- The `dev.ts` line does not change what production does.

**At the fold.** A merge-tree against main shows one conflict: `dev.ts`'s import line, because main
moved to namespace imports
(`import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"`).

**The fix round.** One fix agent is running:

- It keeps the whole startup stderr for `error()`, and the tail for `exited()`.
- It pins the long-stderr case in `alchemy-lifecycle.test.ts`.
- It fixes `startDev`'s doc, and commits the review's 2 finding rows.

The same reviewer rechecks after.

## The ask: a 0036 ticket for `instance-one-file.integration.test.ts`

This is the second sighting.

1. **First:** in app-src s2's tests step, the file's real-instance laws went red after about 72 s,
   with no error captured. Afterwards an orphaned workerd from those runs was found.
2. **Second:** at `cd1e2352a`, the p33 recovery law at line 792 was red once in 10 runs. It took
   115 s instead of about 50 s, and left an orphaned workerd, whose parent process ID was 1.

Its finding row lands with this fix round. The pattern matches the cold first-run flakes in
`door.integration` and `file-services.laws.integration` from 0102: the box is under load, a run
takes much longer than usual, and a test worker may have been killed. The flake box hunting those
two is still running. If it finds the cause, it may cover this one too.
