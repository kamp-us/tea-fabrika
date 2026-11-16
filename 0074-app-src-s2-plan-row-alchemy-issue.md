# 0074: mock app-src s2 needs a plan row for dev.ts; one Alchemy upstream issue to file

Mock app-src slice 2 is stopped on law B3. The fix is one line in a file the plan's Files table
does not list, so it needs a plan amendment and your re-sign. Group 1's chained-vi amendment is
amending the same plan, so I have lined the two up: group 1's commit lands first, group 3's goes
on top, and you re-sign once for both. There is also one Alchemy upstream issue for you to file.

## The slice now

- **Branch:** `fabrikalfa/mock-app-src-s2`, head
  `153b53f96f014f400f82e1ca8f6b2c91c53b48b6`, pushed, leakgrep clean.
- **Done and green:** the Alchemy patch (Node Workerd now spawns through `ChildProcessSpawner`),
  its lockfile hash, and laws B1 and B2. The other dev and local-instance integration laws the patch
  reaches are green too.
- **Red:** B3, the two real-instance laws in `instance-one-file.integration.test.ts`. No child
  process came through the law's spawner. Alchemy's deploy provides its own platform services, and
  those shadow any spawner the law gives it.

## The fix, which needs a plan row

It is one line in `next/packages/libfabrika/src/node/dev/dev.ts`, at about line 327, where the
stack's local context is built, plus its import:

```ts
Context.add(ChildProcessSpawner.ChildProcessSpawner, yield* ChildProcessSpawner.ChildProcessSpawner)
```

The tests step tried it once on a copy, and all 7 laws in that file passed. The plan's Files table
has no `dev.ts` row, so the build cannot make this change without an amendment.

## The order I set

1. Group 1 pushes its chained-vi amendment on top of `5ecab3938`, the signed plan, and sends me its
   head.
2. Group 3 adds one commit on top of that head. It adds only a slice 2 build row for `dev.ts`,
   naming B3 and the one-line fix.
3. I mail you the final head, and you re-sign once for both amendments. Then the s2 build runs.

## For the reviewer to weigh: behavior the patch changes

- The serve scope now waits for workerd to exit.
- A startup error is classified from the last 4096 characters of stderr.
- The exit signal is read from Effect's error message.

## An upstream issue to file

The title: "cloudflare-runtime: Node Workerd spawns with node:child_process directly, so it cannot
be given a ChildProcessSpawner". The body is in
`field/runs/2026-11-16-mock-app-src-s2-tests1.json` on the branch. Under "never wait on upstream",
it is filed the same day, and the local patch stays until the release that takes the fix.

## Also

Group 3 is now reviewing app-src slice 1 (A1 to A4) against the plan at `5ecab3938`.

## What this cannot tell you

Whether Alchemy's maintainers would rather take a `ChildProcessSpawner` parameter or a platform
layer the caller can override. The issue asks for the first.
