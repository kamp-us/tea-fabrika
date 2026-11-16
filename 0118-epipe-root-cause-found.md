# 0118: the EPIPE root cause, found: the box's memory limit kills a TypeScript API child, and our dispose hides it

The investigation is done. Its finding row is
`field/findings/2026-11-16-ts-api-epipe-hides-the-oom-kill.json`, on
`fabrikalfa/finding-ts-api-epipe`, head `2d9b670cea57826cdd6d48a64f15263c3d035393`. It opens no
PR and changes no code.

## The cause

- **The memory limit.** Each box runs under a v1 memory cgroup, limited to 14,002,708 kB (13.35
  GiB) and shared by all of a session's commands. `free` does not show that limit.
- **The kill.** When the box runs short, the out-of-memory killer kills a TypeScript API child
  partway through a run.
- **The hiding.** Our `finally` block then calls `Snapshot.dispose`, which writes to the dead pipe
  and raises EPIPE. That EPIPE replaces the real error, the end-of-file from the killed child.
- **Where it happens:**
  - typescript 7.0.2: `dist/api/sync/api.js:196`, with the write at `syncChannel.js:495`;
  - ours: `promise-types.ts:323`;
  - `lint:dead` fails the same way, through native-preview's identical channel.

## How it was proved

| Run | Result |
|---|---|
| `lint:promise-types` alone | 0 failures in 10 |
| Full `pnpm lint` alone (1.7 to 2.0 GB left free) | 0 failures in 3 |
| Full lint beside a process holding 1.5 GB | Failed 1 of 1. dmesg showed "Killed process (tsc)" with the exact stack. |

## It is not the Schema.Tuple([]) panic

That lead was tested on main `2623b9f39`. One uncommitted file held `Schema.Tuple([])`, and was
deleted afterwards. `lint:promise-types` failed with "panic: interface conversion:
checker.TypeData is *checker.TypeReference, not *checker.TupleType" at `promise-types.ts:234:27`,
and printed no EPIPE. The API child sends that panic back as a request error and stays alive, so
the dispose after it works. That panic is a separate bug, already in its own finding row on
`fabrikalfa/reflect-rest` at `4ba508a3b`.

## The proposed fix, in two parts

1. **Report the real error.** In `promise-types.ts`, a release that never replaces the first error,
   through `acquireRelease`. code-graph gets the same fix through our existing patch, plus an issue
   on kamp-us/demlik. Then the next memory kill shows up as the kill, not as EPIPE.
2. **Make the kills rarer.** This goes on your existing box-memory ticket: fewer TypeScript API
   lint parts at once in a box. Today's step rule, "a box is small", already caps code agents at
   two. Running the API lint parts one after another in a box is the next step.

## The ask

Add this cause to the box-memory ticket. Part 1 is lead tooling (`.agents`, `oxlint-plugins` and
`exam` code), so it is fast-tracked. Say if you want me to start it in the cloud as one small job.
It would include the demlik issue's repro, for you to file.
