Approved by the lead agent, builds ticket 2302, the records bin waits for its output before it exits; body d32947be3223
Plancheck-Version: 3

# Plan: Records' bin writes all of its output before it exits (ticket 2302)

This is kalfa package work in `kalfa/records`, not `next/` and not today's frozen version. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/2302. It has no comments yet.

```ts
// The whole idea, a sketch. Nothing here was type-checked.

// kalfa/records/src/Teardown.ts, new. Effect's `Runtime.Teardown` with two more jobs:
// 1. wait until standard output and standard error have written everything, then exit;
// 2. a closed reader (EPIPE, as in `check | head`) is the reader's business; any other stream error ends 2.
export const teardown = (streams: Streams): Runtime.Teardown => {
  let broken = false;

  for (const stream of [streams.stdout, streams.stderr]) {
    stream.on("error", (error) => {
      if (!(Predicate.hasProperty(error, "code") && error.code === "EPIPE")) {
        broken = true;
      }
    });
  }

  return (exit, onExit) => {
    const code = Exit.isSuccess(exit) && Predicate.isNumber(exit.value) && !broken ? exit.value : 2;

    // An empty write ends when everything before it is written.
    streams.stdout.write("", () => streams.stderr.write("", () => onExit(code)));
  };
};

// kalfa/records/src/bin.ts, the one changed line in the runMain call:
//   teardown: teardown({ stdout: process.stdout, stderr: process.stderr }),
```

## Calls under 80%, read these first

None. Every call below is 80% sure or more. The one closest to the line is the new file (80%): see "Calls taken", 2.

## The cause, read in the code

The bin hands its exit code to Effect's `NodeRuntime.runMain`, and `runMain` ends the process at once for any code
that is not 0. Output that Node has not yet written to a pipe is dropped.

- `kalfa/records/src/bin.ts` runs `Command.runWith(records, ...)` under `NodeRuntime.runMain` with a `teardown` that
  calls `onExit(code)` right away. The code is 0, 1 (`check` found something, its lines already printed) or 2.
- `onExit` is Effect's. In `@effect/platform-node-shared` 4.1.3, `src/NodeRuntime.ts`, the observer does
  `teardown(exit, (code) => { if (receivedSignal || code !== 0) { process.exit(code) } })`. With code 0 it does not
  exit, and Node ends on its own once its writes are done. With 1 or 2 it calls `process.exit` at once.
- Node writes to a pipe asynchronously on macOS and blocks on Linux. That is what Node's "A note on process I/O" says,
  as the ticket, `.kalfa/quests/kalfa-cli-command-PLAN.md` and the comment over K20 in
  `kalfa/cli/src/bin.integration.test.ts` all repeat. I could not fetch the Node page this session (the fetch was
  blocked), so that fact is not read here. So on a Mac, `node kalfa/records/src/bin.ts check runbook | head` can show
  fewer lines than were printed. `pnpm lint` reads this bin through a pipe too (`oxlint-plugins/parallel.ts`).

**Where the root sits.** No kalfa code is shared here. `kalfa/cli/src/internal/run.ts` never ends the process: it
answers a code, and `kalfa/cli/src/bin.ts` ends the process in its own `teardown`. That teardown already waits for
both streams (landed in https://github.com/kamp-us/tea-fabrika/pull/2311). Only two kalfa files call `runMain`:
the two bins. The one piece every bin shares is Effect's `runMain`. Patching it in `patches/` would change every Node
program in the repo. That is a bigger design call than this ticket, so it goes under "Findings". The fix goes in
Records' bin, in the CLI's shape, as the ticket asks.

**The bin is short-lived.** Ticket https://github.com/kamp-us/tea-fabrika/issues/2277 deletes "the package's own edge
script" once `kalfa records check` runs through the `kalfa` command, whose bin already waits. So this fix lives until
2277 lands. That keeps it small and keeps it out of `@kalfa/cli`'s exports.

## How others do it

- **Node.** The documented way to exit with a code without losing output is to set `process.exitCode` and let the
  loop drain, not to call `process.exit()` (Node's `process.exit()` docs; not fetched this session, as above). Effect's
  `runMain` takes the same approach for code 0 but not for other codes.
- **Erlang/OTP.** `init:stop/1` with a status is the clean halt: it closes the system in order, ports included, before
  the VM exits. `erlang:halt/1` exits at once, and its `{flush, true}` option (the default for a number) flushes port
  output first. Halting at once is the special case there, not the usual one. Recalled from OTP's `erlang` and `init`
  docs; not fetched.
- **Elm.** It has no process exit, so it has nothing to say here.
- **Effect.** I searched both Effect trackers (`Effect-TS/effect-smol` for "runMain process.exit" and "process.exit",
  `Effect-TS/effect` for "runMain stdout exit", "stdout flush runMain" and "truncated output process.exit") and found
  no issue on it.
- **This repo.** `kalfa/cli/src/bin.ts` writes an empty string to standard output, then to standard error, and exits
  in the last callback. A stream `error` listener ignores `EPIPE`. Records copies that shape, as the ticket says.

## The shape

```ts
// kalfa/records/src/Teardown.ts. A sketch; the build may pick other local names.
import { Exit, Predicate } from "effect";
import type { Runtime } from "effect";

/** One standard stream, as much of Node's as the teardown uses: `process.stdout` and `process.stderr` fit it. */
export interface Stream {
  readonly write: (chunk: string, done: (error?: Error | null) => void) => boolean;
  readonly on: (event: "error", listener: (error: unknown) => void) => unknown;
}

/** The two streams a run writes to. */
export interface Streams {
  readonly stdout: Stream;
  readonly stderr: Stream;
}

/**
 * The bin's teardown: the run's code, or 2 when it did not end with a number or a stream broke, after both streams
 * have written everything.
 *
 * @category running
 */
export declare const teardown: (streams: Streams) => Runtime.Teardown;
```

- The exit codes stay 0, 1 and 2. `bin.ts` keeps its `Effect.as(0)`, `catchTag("Failed", ... 1)` and
  `catchCause(... 2)`. Only the `teardown` option changes.
- The listeners are added when `teardown(...)` is called, before `runMain` starts the run, as the CLI does at the top
  of its `import.meta.main` block. That way an `EPIPE` during the run is caught too, not only one at exit.
- `Stream` takes `unknown` for the error, so `hasProperty` is a real check and not a type cast. If
  `process.stdout` does not fit this shape, `pnpm typecheck` on `bin.ts` says so. The build then narrows `Stream`
  so it does, without a cast.
- No Node import. The file uses only `effect`, so the stand-in in the test is a plain object.

The manifest: `@effect/platform-node` moves into `peerDependencies` too, and stays in `devDependencies` for the
workspace install. This is the same as `kalfa/cli/package.json` and the same as `effect` in this manifest. pnpm writes
no peer of a workspace package into the importers of `pnpm-lock.yaml`, so the lockfile does not change.

## One value traced

`node kalfa/records/src/bin.ts check runbook`, run on a Mac in a repo whose `.agents/skills/sev/SKILL.md` links 20,000
sev runbooks that are not there, piped to a reader that starts one second late:

1. `teardown({ stdout: process.stdout, stderr: process.stderr })` adds one `error` listener to each stream.
2. `check` finds 20,000 `dangling` findings and writes them with one `Console.log`: about 3 MB. A pipe holds about
   64 KB, so Node keeps the rest in its own buffer and writes it in the background.
3. `check` fails with `Failed { count: 20000 }`, and the bin turns that into `0 | 1 | 2` as `1`.
4. `runMain`'s observer calls the teardown. The code is `1`: a success, a number, and no broken stream.
5. Today: `onExit(1)` runs at once, `process.exit(1)` runs, and the 3 MB still in Node's buffer is gone. The reader
   gets the first part only.
6. With the fix: `stdout.write("", cb)` waits behind the 3 MB. The reader starts after one second and reads it all,
   then the callback runs. `stderr.write("", cb2)` is done at once, and `onExit(1)` calls `process.exit(1)`.
7. The reader gets every byte and the exit code is 1.

Variant: `... check runbook | head -n 1`. `head` reads one line and closes, and the next write fails with `EPIPE`.
The listener ignores it, the write callback still runs (Node calls it with the error), and the code stays 1. With no
listener, Node would crash on the unhandled `error` event with a stack trace and exit code 1. Waiting at exit makes
that crash more likely than today, so the listener is part of the fix and not an extra.

## Generators

B1 to B3 draw one case of the teardown on a stand-in pair of streams. Each stand-in write keeps its callback until
the test lets it go, and emitting `error` with no listener throws, as Node's emitter does. Every run builds each
class:

- (a) a success whose value is an integer: 0, 1, 2, or any other integer. The code is that value.
- (b) a success whose value is not a number (a string, `undefined`, an object). The code is 2. This reaches the
  `isNumber` check, after `isSuccess` passed.
- (c) a failure or an interruption. The code is 2.
- (d) an `error` with code `EPIPE` on standard output. The code is the run's.
- (e) an `error` with code `EPIPE` on standard error. The code is the run's.
- (f) an `error` with another code (`EIO`, `EBADF`) on either stream. The code is 2.
- (g) an `error` that carries no `code` own key: a plain `Error`, a string, or `null`. The code is 2. This reaches
  the `hasProperty` read.
- (h) standard output's write held, then let go: `onExit` waits for it.
- (i) standard error's write held, then let go, after standard output's went through: `onExit` waits for it too.
- (j) a write whose callback gets an error (the stream already closed): `onExit` still runs once.

## Laws

B1 to B3 are one test file on a stand-in. They run on every pull request and on the laptop by name, and the
teardown planted out turns them red on Linux too. B4 to B6 start the real bin as a child process in a temp git repo,
so they are `*.integration.test.ts`. The laptop refuses that file by name, and only main's full run (or a proof run
the lead starts) runs it, on Linux. There, B4 cannot turn red for the drain, because Linux pipes block. Why no
stand-in does for B4 to B6: what they prove is that Node's real stream on a real pipe behaves as the stand-in does,
and that `runMain`'s real `process.exit` waits for the teardown.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| B1, `onExit` runs exactly once, and only after both streams have finished every write the teardown started. 100 runs | test | fc.record: an exit, error events per stream, and a release order over (h), (i) and (j) | (h) call `onExit(code)` straight away and skip the writes: called while standard output is held, red; (i) wait for standard output only: called while standard error is held, red; (j) call `onExit` only when the callback has no error: never called, red; call `onExit` in both callbacks: called twice, red | kalfa/records/src/Teardown.test.ts |
| B2, the code is the run's number for a success with no broken stream, and 2 otherwise. 100 runs | test | fc.record: an exit and error events over (a), (b), (c), (f) and (g) | (a) answer 1 for every success: red; (b) delete the `isNumber` check: a string becomes the code, red; (c) read `exit.value` with no `isSuccess`: a failure gives no number, red; (f) ignore every `error`: an `EIO` keeps the run's code, red; (g) read `error.code` with no `hasProperty`: `null` throws, red | kalfa/records/src/Teardown.test.ts |
| B3, an `EPIPE` on either stream leaves the run's code and throws nothing. 100 runs | test | fc.record: an exit and one `EPIPE` on a drawn stream, over (d) and (e) | (d) count `EPIPE` as broken: code 2, red; (e) add the listener to standard output only: the emit on standard error throws, red | kalfa/records/src/Teardown.test.ts |
| B4, the real bin run as `check runbook` on a repo with 20,000 dangling sev links ends 1, and a reader that starts one second late gets every byte of standard output, the same text the in-memory command prints | test | scenario: a temp git repo, the real bin, a real pipe, a late reader | put back `onExit` at once in `bin.ts`: on macOS the reader gets less, red; on Linux it stays green (see "What this cannot tell us") | kalfa/records/src/bin.integration.test.ts |
| B5, the real bin keeps its codes: 0 with empty output on a clean repo, 2 for `check nope` | test | scenario: the same repo, clean, and a bad argument | make the teardown answer 1 for anything that is not 0: `check nope` ends 1, red; drop the `isSuccess` check: crashes or ends 1, red | kalfa/records/src/bin.integration.test.ts |
| B6, `check runbook \| head -n 1` keeps exit code 1, and standard error holds no stack and no absolute path | test | scenario: the 20,000-link repo, a reader that closes after one line | drop the `error` listeners: Node's unhandled `EPIPE` prints a stack, red on Linux and macOS | kalfa/records/src/bin.integration.test.ts |

The ids B1 to B6 are new in `kalfa/records`, which uses L6, L7 and R11 today. `node oxlint-plugins/law-ids.ts`
passes on this tree. The three open pull requests the brief names
(https://github.com/kamp-us/tea-fabrika/pull/2378, https://github.com/kamp-us/tea-fabrika/pull/2379 and
https://github.com/kamp-us/tea-fabrika/pull/2386) each add only a plan file today, and none of them touches
`kalfa/records`. Law ids are counted per package, so a scratch merge would report the same ids. I did not make one.

**Host-only:** none of B1 to B6. B4 to B6 start a process and `git`. That is not launchd, the Electron app or a
signal, and they run in CI. The ticket's second check, "the test fails on today's bin", needs a Mac. Running it on
the owner's Mac waits for his yes, so it is a later part (see "Size", 2). Until then, the lead posts on the ticket
why CI cannot show it red. A text for that comment is under "Records".

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/records/src/Teardown.ts | build | 30 | new: `Stream`, `Streams`, `teardown`, with a module comment that names the cause (`runMain`'s `process.exit`) |
| kalfa/records/src/bin.ts | build | 6 | the `teardown` option calls `teardown({ stdout: process.stdout, stderr: process.stderr })`; the module comment says output is written whole before exit, and its stale "status, patch or link finding" becomes "a runbook finding" |
| kalfa/records/package.json | build | 3 | `@effect/platform-node` added to `peerDependencies`, kept in `devDependencies` |
| kalfa/records/README.md | build | docs | one sentence under "The command": a long output piped to another program is written whole before the command exits, and a reader that closes early does not change the exit code |
| kalfa/records/src/Teardown.test.ts | tests | tests | new: B1 to B3, the stand-in stream pair |
| kalfa/records/src/bin.integration.test.ts | tests | tests | new: B4 to B6 |
| kalfa/records/src/bin.test-support.ts | tests | tests | new: `makeRepo` (a temp folder, `git init`, files written, `git add -A`), `bin` (runs `node bin.ts` and reads both streams and the code, with an optional late start), `closedPipe`, and the in-memory oracle for B4 through `cliLayers` |
| pnpm-lock.yaml | tests | tests | no change expected: a peer of a workspace package is not written there. If `pnpm install --frozen-lockfile` refuses after the manifest change, the tests step writes it with one `pnpm install --offline` |
| kalfa/records/src/Records.test-support.ts | tests | tests | no change: `cliLayers` is imported by the B4 oracle |
| kalfa/cli/src/bin.integration.test.ts kalfa/cli/src/bin.test-support.ts | tests | tests | no change: read as the model for B4 to B6 and their support |
| package.json oxlint-plugins/parallel.ts | tests | tests | no change: the root `lint` script still runs `node kalfa/records/src/bin.ts check` through `parallel.ts` |
| oxlint-plugins/law-ids.ts oxlint-plugins/package-deps.ts | tests | tests | no change: run (`law-ids.ts`) and read (`package-deps.ts`, "Findings", 2) |
| patches/ | tests | tests | no change: no patch of Effect in this plan ("Findings", 3) |

`kalfa/records/GLOSSARY.md`: no change, as no domain word is new (see "New names").

## Existing tools

- kalfa/records/src/Teardown.ts: searched `kalfa/` and the root scripts for `runMain` and `process.exit`. Only
  `kalfa/cli/src/bin.ts` has this teardown, and only inline, not exported. I searched `effect` 4.1.3 and
  `@effect/platform-node-shared` 4.1.3 for a teardown that waits for streams and found none: `Runtime.defaultTeardown`
  maps an exit to a code and nothing more. The new file is the CLI's lines made callable, so a stand-in can test them.
- kalfa/records/src/bin.test-support.ts: follows `kalfa/cli/src/bin.test-support.ts` (`spawnRead`, `readAll` with
  its delay, `closedPipe`'s shell lines) by copying, not importing. That file is a test support file of another
  package and is not exported. The in-memory oracle reuses `cliLayers` from `kalfa/records/src/Records.test-support.ts`.
- The stand-in stream in Teardown.test.ts: a plain object. I searched for a shared stream stand-in under `kalfa/` and
  `@kampus/vitest` and found none. `node:stream`'s `Writable` would work but needs timers to hold a write.

## Calls taken

1. **The fix goes in Records' bin, not in shared code (85%).** No kalfa code that both bins share ends the process.
   The shared piece is Effect's `runMain`, and patching that changes every Node program here. Ticket 2277 deletes
   this bin, after which only the CLI's bin is left, and it already waits.
2. **The teardown becomes its own file with a stand-in law (80%).** The CLI keeps its teardown inline, so only its
   integration file covers it, and that runs on Linux, where it cannot turn red. A file of about 30 lines gives
   Records three laws that turn red on every pull request. The cost is one file that 2277 deletes or moves (see
   "Findings", 1). Inline with only B4 to B6 would be about 20 lines and no law CI can turn red.
3. **The `EPIPE` listener comes with the drain (85%).** The ticket says "the same way the CLI ticket's `bin.ts`
   does", and waiting at exit without it turns `check | head` into a crash with a stack (see "One value traced").
4. **`@effect/platform-node` is a peer, not a plain dependency (80%).** The brief says the product file needs it as a
   dependency. `@kalfa/cli` lists it as a peer and a dev dependency, and this manifest treats `effect` the same way:
   the caller supplies the platform, so there is one copy of Effect. A plain dependency would also work, but it
   would change `pnpm-lock.yaml` and differ from `@kalfa/cli`.
5. **The size is 20,000 links and a one-second late reader (85%).** That is about 3 MB, over forty times a pipe's
   64 KB, and the late start makes the macOS loss certain rather than likely, as the CLI's K20 standard-error rows
   do. The count is a test constant, not a setting: it describes the test, not the product.
6. **B4's expected text comes from the in-memory command (80%).** `cliLayers` runs the same `records` command on the
   same files with no process. Comparing the two shows the real bin prints exactly what the stand-in prints, without
   writing the finding's words a second time in the test.

**Is this a setting?** No new choice is one. The exit codes are the glossary's, and the stream list is fixed by
what a process has.

## Validation

- Tests step: `nice -n 15 pnpm exec vitest run kalfa/records/src/Teardown.test.ts`, red with no `Teardown.ts`, then
  red on each plant of B1 to B3 against a quick local copy of the sketch, then undone. The laptop refuses
  `bin.integration.test.ts`. The tests step checks that it compiles, and its plants for B5 and B6 are run by the
  lead's proof run.
- Build step: the same test file green, `pnpm lint` green, `pnpm install --frozen-lockfile` passes.
- The lead: one proof run in CI that names `kalfa/records/src/bin.integration.test.ts`, green with the fix. The lead
  runs typecheck once at the end. Pull requests and the merge queue run no integration law.

## Size

1. One pull request: about 39 product lines (`Teardown.ts` 30, `bin.ts` 6, `package.json` 3) and a README sentence,
   plus about 250 test lines over three files. It lands whole: the laws are red until `Teardown.ts` exists.
2. Later, waiting for the owner's yes: run `bin.integration.test.ts` once on his Mac with the drain planted out and
   then put back, to show B4 red and then green. 0 lines. Until that yes, the ticket comment stands in for it.

About 1.5 agent hours across tests, build and review, 85% sure. The doubt is B4's oracle: if `TestConsole`'s lines
do not join back to the exact bytes on a pipe, the tests step builds the text from the finding's template instead,
which may take one send-back. Basis: about $7 a step for small work copied from a shape that already exists, as in
`.kalfa/quests/lint-block-gaps-PLAN.md`'s mostly-copied steps: tests, build, review, and one likely send-back.

Estimate: 4 steps, $28

## New names

None in a glossary. `teardown` is Effect's own word (`Runtime.Teardown`), and `Stream` and `Streams` are
code-local names for Node's two standard streams. The domain words in play (finding, runbook, exit code) are
already in `kalfa/records/GLOSSARY.md` or in Effect.

## Records

- The cause goes in `Teardown.ts`'s module comment, where the next reader of a bin looks: `runMain` calls
  `process.exit` at once for a code that is not 0, and macOS writes pipes asynchronously.
- The lead posts this on https://github.com/kamp-us/tea-fabrika/issues/2302 for the ticket's second check: "B4 runs
  in CI on Linux, where Node's writes to a pipe block, so the pipe never loses bytes there and B4 cannot turn red for
  the missing wait. B1 to B3 test the same wait on a stand-in and turn red on every pull request. A run of B4 on a Mac
  with the wait taken out waits for the owner."
- No decision record: the ticket and the CLI's landed shape already settle the fix.

## What fact is lost if it is not recorded now

That a bin under Effect's `runMain` loses piped output for any exit code but 0 on a Mac, and that CI cannot catch it.
Without the comment in `Teardown.ts`, the next bin (ticket 2277's move, or a new package's) is written with a plain
`onExit(code)`, the way Records' was, and passes every CI check.

## What this cannot tell us

- Whether today's bin really loses bytes on a Mac. The ticket's own first test was never run, and CI is Linux.
  B1 to B3 show the wait is there, not that it was needed. "Size", 2 settles it.
- Whether Linux pipes really block for Node's standard output. If they do not, B4 can turn red on CI too, which is
  only better. The Node page was not fetched this session.
- A reader that never reads and never closes keeps the bin waiting forever. That is how any Unix program behaves at a
  full pipe, and no law draws it.
- How the bin behaves on Windows: no law runs there.
- Whether Effect would take an upstream change to `runMain`: no issue was found and none was filed.

## Open questions

None.

Each call above picks how the code does what the ticket and the CLI's landed shape already say.

## Findings

1. **Ticket 2277 should move `teardown`, not delete it.** When 2277 deletes Records' bin, `Teardown.ts` and B1 to B3
   go with it, and the CLI's inline teardown in `kalfa/cli/src/bin.ts` is again covered only by its K20 and K22
   integration laws, which run on Linux. Proof: `kalfa/cli/src/bin.integration.test.ts`'s K20 comment says that "on
   Linux ... this law cannot turn red for the drain". A line on 2277 (move `teardown` and B1 to B3 into `kalfa/cli`,
   and have its bin call it) keeps the only CI-red check.
2. **No lint checks that a kalfa product file's imports are listed in its manifest.** `oxlint-plugins/package-deps.ts`
   says "The rule judges `next/` files only". That is why `kalfa/records/src/bin.ts` passes lint while it imports
   `@effect/platform-node`, which `kalfa/records/package.json` lists only under `devDependencies`. A ticket could
   point that rule's `unlisted` check at `kalfa/*/src/**` product files as well, with dev dependencies left out for
   them.
3. **Effect's `runMain` drops piped output for every Node program here that exits with a code other than 0.**
   `@effect/platform-node-shared` 4.1.3, `src/NodeRuntime.ts`, calls `process.exit(code)` straight from the
   teardown's callback. Every bin that does not wait the way the CLI's and now Records' do can lose output on a Mac.
   No upstream issue was found in `Effect-TS/effect-smol` or `Effect-TS/effect`. An upstream issue, or a repo patch to
   wait for the standard streams before `process.exit`, would fix it for all of them. That is a separate design call.
