Approved by the lead agent, builds ticket 2385, the pack landing runs outside the time limit; body 8c93216c65c2
Plancheck-Version: 3

# Plan: @kalfa/git, a fetch cut short by its time limit lands a whole pack or nothing (ticket 2385)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/2385, part of https://github.com/kamp-us/tea-fabrika/issues/1938, so the
pull request says `Closes #2385` and `Refs #1938`, and carries no `fabrika close ticket` line. One pull request, from main.

```ts
// The whole idea, a sketch. Today `make` puts one time limit around the adapter's whole fetch, renames included:
//   const refs = yield* limited(Effect.gen(function* () { ...; return yield* raw.fetch(...) })); // renames run in here
// After: the adapter's fetch reads and checks, and hands back the one step that adds the objects. `make` runs that step
// outside the time limit, and nothing can cut it.
const refs = yield* Effect.scoped(
  Effect.gen(function* () {
    const fetched = yield* limited(read); // url, slot, transfer, checks: TimedOut can only happen here
    yield* Effect.uninterruptible(fetched.stow); // .pack, .rev, .idx renamed in; never cut
    return fetched.refs;
  }),
);
// So a fetch either answers its refs with every answered commit readable, or fails with nothing added.
```

## Doubts, read first

- **A stuck disk can now hold a fetch past `limits.time`, 85%.** The stow step has no bound. A bound would not help: an
  `fs.rename` that Node has started cannot be stopped (it has no abort signal, and Effect's `effectify` only stops
  waiting for its callback), so a bound would answer `TimedOut` while the rename still lands later. That is bug 2 again.
  What would settle it: a real case of a local rename that hangs. The stow is a directory listing and three renames on
  one file system.
- **A rename the disk refuses part way can still leave one `.pack` with no `.idx`, 85%.** The fix covers the time limit
  and an outside interrupt, which are the two bugs. A refused rename (a disk fault) fails `GitUnavailable` and may leave
  the `.pack` it already moved. Cleaning it up is not safe: two fetches of the same objects make a pack of the same name
  (tried on git 2.40.1, see Records), so deleting "my" `.pack` can delete another fetch's `.pack` just before its `.idx`
  lands. That would break the one property that holds today. git itself leaves the same garbage when its own rename
  fails (it `die`s in `rename_tmp_packfile`). The contract says this plainly, which is the ticket's second "Done when" path
  for this one case.

## Records read

- `kalfa/git/src/ProcessRepository.ts`: `stow` (renames `.pack`, `.rev` if listed, `.idx` last, per pack name),
  `folder` (the call's `kalfa-fetch-*` folder, released after every ending, bounded by `limits.kill`), and `fetch`
  (probe, folder, `init`, alternates, transfer, `whole`, `for-each-ref`, the refs limit, then `stow`, all inside
  `Effect.scoped`).
- `kalfa/git/src/Repository.ts`: `make`'s `limited` (one `Effect.timeoutOrElse`), its `fetch` (one limit around
  `remoteUrl`, the slot and `raw.fetch`), the `fetch` contract line and `Raw`.
- `kalfa/git/src/MemoryRepository.ts`: `fetch` checks, then one `Cell.update` copies the commits, with the comment "Only
  a good answer adds commits, as the process adapter renames its pack in only after one".
- `kalfa/git/src/Fetch.test-support.ts` (F1 to F9, the shared laws), `kalfa/git/src/ProcessFetch.test.ts` (F10 to F14 on
  a stand-in spawner and a recording file system; F14 times a fetch out only while the transfer hangs),
  `kalfa/git/src/Fetch.types.test.ts` (F17), `kalfa/git/src/ProcessRepository.integration.test.ts` (F1 to F9 on real git
  with `it.effect`, so the test clock, and F12), `kalfa/git/src/ProcessSeed.test-support.ts` and
  `kalfa/git/src/MemorySeed.test-support.ts` (the two fetch subjects).
- `kalfa/git/README.md` (the Fetch section), `kalfa/git/GLOSSARY.md` ("land" is Delivery's word, listed under _Avoid_),
  `kalfa/git/src/Settings.ts` (`time` "is the longest one call may take").
- The approved plan `.kalfa/quests/kalfa-git-fetch-credential-PLAN.md`: the fresh git directory, the folder's release
  as the cleanup, and "a pack is renamed in only after a good answer".
- Installed versions: `effect@4.1.3` with the repo's one patch to it, which touches only the arbitrary model and
  `TestConsole`, `@effect/platform-node-shared@4.1.3`. In
  `node_modules/effect/src/internal/effect.ts`, `timeoutOrElse` is `timeoutOption`, which is `raceFirst(self, sleep)`.
  `raceAllFirst` resumes the caller as soon as the sleep wins, interrupts the loser, and, through `onExitUnsafe`, waits
  for the loser to finish before the race itself ends. So an uninterruptible step inside the limit still runs to its end
  and the call still answers `TimedOut`. That is why the step must sit outside the limit, not just be uninterruptible.
  In `NodeFileSystem.ts`, `rename` is `effectify(NFS.rename)`: interrupting it stops the wait, never the rename.
- Settled search: `rg -il` for "uninterruptible", "time limit", "TimedOut", "rename", "kalfa-fetch" and "whole pack" over
  `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks` and the kalfa glossaries. The hits are about
  other time limits (agents' `ask`, Delivery's wait) and other renames. No decision covers how a git call ends on its
  time limit; the `moveRef` contract line ("A call that ends in `TimedOut` may have moved the ref") is the nearest, and
  it is the other way out, which this plan does not take for `fetch` (Calls taken).
- A scratch tryout on git 2.40.1 (not committed): a fetch with `-c transfer.unpackLimit=1 -c pack.writeReverseIndex=true`
  writes `pack-*.rev`; without the pin it writes none. Two fresh directories fetching the same remote got the same pack
  name.
- Background only, not cited in the repo: a model of the stow steps and a replay on real git, which found both bugs.

## How others do it

- **git itself** (read: `pack-write.c` on git's master, fetched). `stage_tmp_packfiles` renames `.pack`, then `.rev`, then
  `.mtimes`, and the caller renames the `.idx` last with `rename_tmp_packfile_idx`. A reader finds a pack by its `.idx`,
  so the `.idx` is the point where the pack exists. A rename that fails makes git `die`, leaving the earlier files as
  garbage that `git count-objects -v` reports. Our order already matches; what git does not have is a time limit
  between the renames. A git process that runs to its end never stops between them.
- **Effect** (read in the installed source, above): a step that must not be cut is `Effect.uninterruptible`, and
  `timeout` races, so the step has to be outside the race for the answer to match what happened.
- **Elm and Erlang/OTP** (not fetched, from memory). Elm has no answer here; its effects are the runtime's. In OTP, a
  `gen_server:call` that times out says nothing about whether the server did the work, and the usual way to make a file
  change safe is to write a temporary file and `file:rename` it in, so the change is one step. The stow is that one
  step, made of three renames, so we make the three act as one.
- **The industry** (gRPC's deadline guide, fetched): the server keeps going after the client's deadline, and "the server
  application is responsible for stopping any activity it has spawned". A deadline that fires while work is landing
  tells the caller nothing about the result. That is bug 2, and the reason the limit should end before the landing
  starts.

## The shape

### `Repository.ts`: what an adapter's fetch hands back

```ts
// A sketch.
/**
 * What an adapter's `fetch` read and checked, and the one step that adds it to the repository. `make` runs `stow` once,
 * after the read answered, outside the time limit and with interrupts held off, so no fetch is cut between its files.
 */
export interface Fetched {
  readonly refs: ReadonlyArray<Ref.Ref>;
  /** Adds the fetched objects to the repository whole. It cannot time out, so its only failure is a disk that refuses. */
  readonly stow: Effect.Effect<void, GitUnavailable>;
}

export type Raw = Omit<Repository["Service"], "writeCommit" | "rangePatchId" | "readText" | "rebase" | "fetch"> & {
  // ...writeCommit and remoteUrl as today...
  /** Reads the remote and checks what came. Anything it holds open (the git adapter's folder) lives in the scope `make` gives, so it is released after `stow`. */
  readonly fetch: (request: {
    readonly url: Remote.Url;
    readonly under: Ref.RefName;
    readonly credential: Option.Option<Credentials.Credential>;
  }) => Effect.Effect<Fetched, Remote.FetchFailed | HistoryTooShort | TooMany | RefNotCommit | Fails, Scope.Scope>;
};
```

`stow` fails `GitUnavailable` only, never `TimedOut`: the type says the step has no time limit. The service's `fetch`
type does not change (F17 holds it).

`make`'s `fetch`:

```ts
// A sketch.
fetch: Effect.fn("git.fetch")(function* (request) {
  yield* Effect.annotateCurrentSpan({ /* as today */ });

  const refs = yield* Effect.scoped(
    Effect.gen(function* () {
      // The time limit covers everything up to the stow, the slot's answer included, so a slow filler still ends.
      const fetched = yield* limited(
        Effect.gen(function* () {
          const url = yield* raw.remoteUrl(request.remote);
          const slot = yield* Credentials.Credentials;
          const credential = yield* slot.ask(url);
          yield* Effect.annotateCurrentSpan({ "kalfa.git.credential": Option.isSome(credential) });
          return yield* raw.fetch({ url, under: request.under, credential });
        }),
      );

      // Stowing is one step that neither the limit nor an interrupt cuts. A rename Node has started cannot be called
      // back, so a limit here would only make the answer disagree with the disk.
      yield* Effect.uninterruptible(fetched.stow);

      return fetched.refs;
    }),
  );

  yield* Effect.annotateCurrentSpan({ "kalfa.git.refs": refs.length });
  return refs;
}),
```

The race inside `limited` waits for its loser to end before it answers, so the folder's finalizer, now in the outer
scope, still runs after the transfer's own scope has closed, as F14 needs.

The contract line for `fetch` gains, in plain words: "A fetch that fails adds no commit, `TimedOut` included. The time
limit covers the fetch up to stowing the objects; stowing is one step that neither the limit nor an interrupt cuts, so
once it starts the call answers the refs, a few renames past `limits.time` at most. A disk that refuses a rename part
way fails `GitUnavailable` and can leave one `.pack` that no reader uses, never an `.idx` without its `.pack`. A call
interrupted from outside answers nothing and may have added a whole pack." `make`'s doc ("A call that runs past the time
limit is interrupted") gets the same exception for `fetch`'s stow.

### `ProcessRepository.ts`

- `fetch` drops its own `Effect.scoped`: the folder is acquired in the scope `make` gives. It does every step as
  today up to the refs limit, then returns `{ refs, stow: stow(disk.fs, fresh, objects) }` instead of running `stow`.
  The comment above it says the pack is renamed in by `make`, after the read answered.
- `stow` is unchanged: per pack name, `.pack`, `.rev` if listed, `.idx` last.
- `TRANSFER_PINS` gains `pack.writeReverseIndex=true`, so every git from 2.38 on writes a `.rev` beside each fetched pack,
  as git 2.41 and later do by default. Then the rename order between `.idx` and `.rev` matters on every machine, and the
  laws see it on every machine.

### `MemoryRepository.ts`

`fetch` does its checks as today, then returns `{ refs, stow: Cell.update(cell, (now) => copied(now, there, tips)) }`.
The comment becomes: "Only a good answer adds commits: `make` runs `stow` after the read answered." The copy reads the
store as it is when `stow` runs, so a write that came between is kept, as today.

### Docs

- `kalfa/git/README.md`, Fetch section, the Git bullet: the `.rev` pin; the stow runs after the time limit and is never
  cut, so a failure adds nothing; the one disk-fault exception; "A call ends within `limits.time` plus two `limits.kill`
  waits" gains "plus the stow". The Failures bullet: `TimedOut` adds nothing.
- `kalfa/git/src/Settings.ts`: `time` "is the longest one call may take" gains ", except that a fetch's stow is never
  cut".
- `kalfa/git/GLOSSARY.md`: the word **Stow** (New names).

## One value traced through

A fetch of `refs/heads/main` by name, `limits.time` 10 seconds, the remote ahead by three commits, on a slow disk.

1. `make` opens a scope and starts `limited`. At 0.0 s `remoteUrl` reads `origin`'s URL; the slot answers `none`.
2. `raw.fetch` probes, makes `kalfa-fetch-7` in the scope, runs `init`, writes the alternates file, and runs the
   transfer. git writes `pack-ab12.pack`, `pack-ab12.rev` (the pin) and `pack-ab12.idx` into the folder's object folder.
3. `whole` passes, `for-each-ref` prints one ref, one is within `limits.refs`. `raw.fetch` returns
   `{ refs: [main at c3], stow }` at 9.8 s. `limited` answers; the limit's sleep is interrupted.
4. `make` runs `stow` with interrupts held off. The listing, then `.pack` renamed in at 9.9 s. The disk stalls; 10 s
   passes. Nothing is racing any more, so nothing fires. `.rev` at 10.3 s, `.idx` at 10.4 s.
5. `stow` ends; `make` returns `[main at c3]`. The scope closes and removes `kalfa-fetch-7`, now empty of pack files.
6. `readCommit(c3)` finds it. `objects/pack` holds `pack-ab12.pack`, `.rev` and `.idx`. A reader that listed the folder
   at 10.0 s saw no `pack-ab12.idx` and so no pack, which is git's own rule.

Today at step 4 the limit fires at 10 s: the call answers `TimedOut`, the release removes the folder with `.rev` and
`.idx` inside, and `pack-ab12.pack` stays for good with no index (bug 1). With the stall after the `.idx` instead, the call
answers `TimedOut` and `readCommit(c3)` finds it (bug 2).

Had the transfer taken past 10 s at step 2, `limited` answers `TimedOut`, `stow` never runs, and the scope removes the
folder with the pack in it: nothing was added.

## Generators

Where the fetch is held while the time limit fires, or while something else happens. Each law below names the ones it
reaches.

- (a) the limit fires before the read has answered: the transfer hangs on the stand-in; on real git, a hold after the
  alternates file is written; in memory, a hold in the remote store's read.
- (b) the limit fires after the stow's listing, before any rename.
- (c) the limit fires after the `.pack` rename, before the `.rev`.
- (d) the limit fires after the `.rev` rename, before the `.idx`.
- (e) the limit fires after the `.idx` rename, before the call answers.
- (f) the caller interrupts the fetch at a hold inside the stow, at (b), (c) or (d).
- (g) the disk refuses the first, the second or the third rename.
- (h) git wrote no `.rev`: the stand-in's listing has only `.pack` and `.idx`, so the stow has two renames.

Each hold is a gate in a file system wrapper (stand-in or real `NodeFileSystem`), or in the memory remote's read: the
k-th operation runs, then waits on a `Deferred`. The law waits until the gate is reached, moves the test clock by
`limits.time`, opens the gate and joins the call. The time limit and the kill wait are drawn, as F14 draws them.

## Laws

| Law | Kind | Generator | Plant |
|---|---|---|---|
| F18 `make` stows once and never cuts it: on a stand-in `Raw` whose `fetch` and `stow` hold at a gate, the limit firing in `fetch` answers `TimedOut` and `stow` never runs; the limit firing in `stow` lets it end and the call answers the refs; a caller interrupt in `stow` lets it end; `stow` runs once, only after `fetch` answered; the scope `fetch` was given closes after `stow` ends, and on every failure (new file `kalfa/git/src/FetchStow.test.ts`) | test, 50 runs | Effect Arbitrary: Schema.Int | Keep `stow` inside `limited`, wrapped in `Effect.uninterruptible`, (e) red: it answers `TimedOut` after `stow` ran; run `stow` interruptibly outside the limit, (f) red; run `stow` in a finalizer after every ending, (a) red; run it with `Effect.ignore`, so its failure answers the refs, red |
| F19 on the stand-in spawner and the recording file system, the limit firing at each hold: at (a) the call fails `TimedOut` and no rename was made; at (b) to (e) the call answers the refs, the renames are `.pack`, `.rev`, `.idx` in that order, all three before the folder's removal, which happens once; with a listing of no `.rev`, the renames are `.pack`, `.idx`; at (f) the interrupted call made all its renames before it ended (`ProcessFetch.test.ts`) | test, 20 runs | Effect Arbitrary: Schema.Int | Today's code (`stow` inside the limit), (b), (c), (d) and (e) red; `Effect.uninterruptible` around each rename alone, (c) and (d) red; remove the folder in a finalizer that runs before `stow`, (c) red; rename the `.rev` whether or not it was listed, (h) red |
| F20 a refused rename: when the disk refuses the k-th rename of the stow, the call fails `GitUnavailable`, the renames made are a prefix of `.pack`, `.rev`, `.idx`, so no `.idx` is renamed without its `.pack` and `.rev`, and the folder is removed once (`ProcessFetch.test.ts`) | test, 20 runs | Effect Arbitrary: Schema.Int | Ignore each rename's failure and go on, so the `.idx` lands without its `.rev`, (g) red; map the stow's failure to the refs answer, (g) red |
| F21 cut short at every hold the subject has, in both adapters: before the read answers (a), the call fails `TimedOut`, each remote commit the repository lacked still reads `NoSuchCommit`, and no pack file was added; at any hold inside or after the stow, (b) to (e) on real git, the call answers the refs and every answered commit reads back; every pack the fetch added has its `.pack`, `.rev` and `.idx`, and `git count-objects -v` says `garbage: 0`; the carrier reached every hold its subject names (`Fetch.test-support.ts`, run by `Fetch.test.ts` on memory and the integration file on real git) | test, default runs | Effect Arbitrary: textureArb | Today's code on real git, (c) red (a `.pack` with no `.idx`, garbage 1) and (e) red (`TimedOut` with the tip readable); rename `.idx` before `.rev`, (d) red on every git, since the pin writes a `.rev`; copy the commits in memory before the limit ends, as a finalizer, (a) red |
| F10 (changed) the transfer's pins hold `-c pack.writeReverseIndex=true` beside the four it has (`ProcessFetch.test.ts`) | test, default runs | scenario: one fetch by name on the stand-in | Drop the pin, red; on git older than 2.41 F21's `.rev` check then turns red too |
| F17 (changed) `Raw["fetch"]` answers `Fetched` and needs `Scope`; `Fetched["stow"]` is `Effect<void, GitUnavailable>`, with no `TimedOut`; the service's `fetch` type is as it was (`Fetch.types.test.ts`) | type | type | Type `stow`'s error as `GitUnavailable \| TimedOut`, red; leave `Raw["fetch"]` answering the refs, red; add `Scope` to the service's `fetch`, red |

F14 stays as it is: its `TimedOut` cases hang in the transfer, which is class (a), and its bound holds because the stand-in's
stow takes no time. Its title gains "plus the stow" to match the README.

**Where each runs.** F17 to F20 and F21 on memory run on every pull request. F21 on real git is in
`kalfa/git/src/ProcessRepository.integration.test.ts`, which the laptop refuses by name: it runs in the lead's proof run
before the first review, never narrowly here. No stand-in will do for it, because the point is what real git writes
(`.rev` under the pin, the pack's name) and what a real reader (`count-objects`, `readCommit`) makes of the files. F19
and F20 prove the behavior on the stand-in; F21 on git is the thin check that the real thing matches. None of these laws
needs the owner's Mac: no signal, launchd entry or app window.

**The subject hooks** (the tests step shapes them; a sketch). `FetchSeeded` gains `holds: ReadonlyArray<Hold>`, the
holds this subject can make, and `hold: (at: Hold) => Effect<Gate>`, where a `Gate` has `reached: Effect<void>` and
`open: Effect<void>`, and `packs: Effect<ReadonlyArray<string>>`, the file names in `objects/pack` (`[]` in memory).
Memory names `"read"` (its remote store's read). Real git names `"alternates"`, `"listing"`, `"pack"`, `"rev"` and
`"idx"`: the real `NodeFileSystem` wrapped so the k-th call of that kind waits after it runs. The integration file
already runs on the test clock (`it.effect`), so the law moves the clock as F14 does; nothing else in a fetch waits on the
clock.

## Files

| File | Owner | Product lines expected | What changes |
|---|---|---|---|
| `kalfa/git/src/Repository.ts` | build | 35 | `Fetched`; `Raw["fetch"]` answers it and needs `Scope`; `make`'s `fetch` runs `stow` outside the limit, uninterruptible; the `fetch` contract line and `make`'s doc |
| `kalfa/git/src/ProcessRepository.ts` | build | 12 | `fetch` returns `{ refs, stow }` and takes its folder from `make`'s scope; the `.rev` pin; comments |
| `kalfa/git/src/MemoryRepository.ts` | build | 6 | `fetch` returns `{ refs, stow }`; the comment |
| `kalfa/git/src/Settings.ts` | build | 1 | the `time` doc line |
| `kalfa/git/README.md` | build | docs | the Fetch section's Git and Failures bullets |
| `kalfa/git/GLOSSARY.md` | build | docs | the word Stow |
| `kalfa/git/src/FetchStow.test.ts` | tests | tests | new: F18 |
| `kalfa/git/src/ProcessFetch.test.ts` | tests | tests | F19, F20, F10's pin, F14's title, the recording file system's holds and refused renames |
| `kalfa/git/src/Fetch.test-support.ts` | tests | tests | F21; `FetchSeeded` gains `holds`, `hold` and `packs` |
| `kalfa/git/src/Fetch.types.test.ts` | tests | tests | F17 |
| `kalfa/git/src/MemorySeed.test-support.ts` | tests | tests | the memory subject's hold in the remote read |
| `kalfa/git/src/ProcessSeed.test-support.ts` | tests | tests | the git subject's file system wrapper, `holds` and `packs` |
| `kalfa/git/src/ProcessRepository.integration.test.ts` | tests | tests | the comment listing F21's plants beside the suite's run |

## Existing tools

- `Fetched` in `kalfa/git/src/Repository.ts`, a new type in a file that exists. Searched `kalfa/git/src` for a type that
  pairs an answer with a step to run later, and Effect 4.1.3 for one (`Effect.acquireUseRelease` and `Scope` hold a
  release, not a commit step). None fits: the step must be run by `make` and not by the adapter, so the adapter hands it
  over as a value.
- The hold gate in the test support files: searched the test support files of `kalfa/git/src` and `StandIn.test-support.ts`
  (the stand-in has `"hang"` replies for commands, not for file system calls) and Effect's `Deferred` and `Latch`. It is
  a `Deferred` per hold, built where `recording` already wraps `FileSystem.layerNoop`.
- The real file system wrapper in `kalfa/git/src/ProcessSeed.test-support.ts`: searched `kalfa/` for a wrapped
  `FileSystem` (only the stand-in's `FileSystem.layerNoop` recorder exists). It spreads the real service and replaces
  `rename` and `writeFileString` and `readDirectory`, as the recorder does.
- The garbage check: `git count-objects -v`'s `garbage:` line, git's own report of pack files with no index, which the
  seed's `fingerprint` already runs.
- The `.rev` pin: `pack.writeReverseIndex`, git's own key since 2.31, tried on 2.40.1.

## Is this a setting?

- The stow's bound: no setting, because there is no bound. A bound would make the answer lie (Doubts). Every other
  limit stays a setting.
- The `.rev` pin: not a setting. It fixes what files a fetch writes so readers and laws see one shape on every git; a
  setting would bring back the machine-dependent case the ticket names.
- Where the time limit ends (before the stow): not a setting. It is what the contract promises.

## New names

- **Stow** (`kalfa/git/GLOSSARY.md`, context git): "The last step of a fetch: it makes the fetched objects part of the
  repository whole, after every check passed. No time limit and no interrupt cuts it." _Avoid_: land (Delivery's word),
  install, commit.
- `Fetched` is a code name for what an adapter's fetch hands back; it names no new thing beyond Fetch, so it gets no
  glossary entry.

## Validation

- tests step: each law file alone, such as `nice -n 15 pnpm exec vitest run kalfa/git/src/FetchStow.test.ts`, then
  `ProcessFetch.test.ts`, `Fetch.test.ts` and `Fetch.types.test.ts`, each red for its row's reason before the build. F18
  and F17 are red because `Fetched` does not exist yet; F19 and F21 on memory are red where the row says. Each plant by
  hand, undone. The integration file is not run here.
- build step: the same files green, then `pnpm format` and `pnpm lint`.
- The lead runs the changed set, the typecheck, and a proof run of the integration laws (F1 to F9 and F21 on git, F12)
  before the first review.

## Size

One pull request: about 54 product lines (`Repository.ts` 35, `ProcessRepository.ts` 12, `MemoryRepository.ts` 6,
`Settings.ts` 1), the README and one glossary entry, and about 450 lines of laws and test support. It lands whole: both
adapters agree that a fetch adds commits only with an answer, and no fetch leaves a pack with no index. 80% sure of the
size: the doubt is the hooks for real git in `ProcessSeed.test-support.ts`, which may take more lines to wrap the real
file system. About 4 agent hours. Steps: tests, build, one review, and one likely send-back, at about $12 a step on list
prices, as the credential plan priced its steps.

1. Slice 1, the stow outside the time limit, both adapters, the `.rev` pin and its laws: 54 lines

Estimate: 4 steps, $48

## What this cannot tell us

- That a local rename never hangs for good. If one does, a fetch now hangs with it, where today it answers `TimedOut`
  (Doubts). No law can show this, since no stand-in hang is real.
- A disk fault part way through the stow is covered only by the stand-in (F20). Real git is never made to refuse.
- `git gc` or `git repack` in the same repository during a fetch, and a crash of the machine: neither is in any law, as
  the ticket says.
- That git from 2.38 to 2.40 honors `-c pack.writeReverseIndex=true` through `fetch`'s index-pack child. Tried only on
  2.40.1; CI's git is newer and writes `.rev` anyway, so the laptop's run is the one that proves the pin.
- That the race in Effect 4.1.3 keeps waiting for its loser. Read in the source, and F14 depends on it today; a later
  Effect that stops waiting would release the folder while git still writes in it. F14 would see that.
- That two packs of one name always hold the same bytes. git names a pack by its contents' hash, so it should; the plan
  does not test it.

## Calls taken

- **The lead's lean: the stow runs outside the time limit and uninterruptible, 85%.** Why: it fixes both bugs with one
  change of shape, keeps "only a good answer adds commits" true in both adapters, and makes the order (`make` checks,
  then stows) something an adapter cannot get wrong. Cost: a fetch can end a few renames past `limits.time`, and a stuck
  disk holds it. The other path, saying in the contract that a late `TimedOut` may leave a whole pack (as `moveRef`
  does), was not taken: it still leaves bug 1 to fix on its own, and it makes every caller re-read after a `TimedOut`.
- **`make` runs the stow, not the adapter, 85%.** Passing the limit into `Raw["fetch"]` would let an adapter put the
  stow inside it again, and no type would catch it. With `Fetched`, the only way to add objects is the step `make` runs.
- **Plain `Effect.uninterruptible`, not just outside the limit, 90%.** An outside interrupt between renames is bug 1
  again by another road.
- **No cleanup after a refused rename, 85%** (Doubts).
- **The `.rev` pin in the product, not only in the tests, 85%.** The transfer reads no outside config, so no test can
  turn `.rev` on without it; and it gives every machine one file shape.
- **F21 in the shared suite with subject-given holds, 80%.** Memory has one hold, (a), since its stow is one step; the
  law then states the same promise for both, and real git adds (b) to (e).

## Open questions

None.

## Findings

1. **A fetched commit can be pruned before a ref points at it.** No ref moves on a fetch, so the fetched objects are
   unreachable until the caller moves one. A `git gc --prune=now` in that gap drops them; git's default prune age (two
   weeks) makes this unlikely. Nothing in this repo runs gc. Proof: `fetch`'s contract ("No ref of this repository
   moves") and the model's notes. No ticket: Delivery's own plan is where a fetch and its `moveRef` meet.
