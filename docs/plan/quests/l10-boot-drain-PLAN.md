Approved by the lead agent, builds 0036, 0052, 0291, 0292, 0555, 0567, 0587, 0594, docs/direction/hot-reload.md and the owner's rulings Q1 and Q2 of 2026-11-18; body 627047193799
Plancheck-Version: 3

# L10 accounts for every install, and waits on counts, never on quiet

This plan covers `next/` only. Tracker ticket 1172, from the finding
`field/findings/2026-11-18-watch-l10-boot-drain-saw-repeated-installs.json`.

```ts
// Sketch. L10 checks every install by program and hash, and never waits for quiet.
changed(program, hash);  // the one change a boot or a save owes this program: values and hash checked
repeat(program, hash);   // same hash and source as the program's last change, inside its own rebuild
settle();                // every Rolldown cycle delivered so far has an ended rebuild span: a count

// Amendment 1 (owner ruling Q2): no clock in L10. An owed change is the install of the first
// rebuild after Rolldown reports the save's change; only the test's own time limit backs it up.
```

**Doubts, at the top because they are under 80%:**

- **The second failure shape may stay (50%).** One of the two failed runs saw no install at all
  inside the 3 s drain, on a box whose test worker the kernel then killed for memory. This plan
  keeps a 3 s bound on each owed install, because 0036 forbids a wider one and a law needs a bound
  to fail a watcher that never installs. If that miss was plain slowness, it can come back under
  the same load. If it was the same spurious Rolldown notifications restarting the boot build, the
  proof's trace will show `restart` and `change` events in that window. The proof records which.
- **One L10 clause narrows, and only the owner can say yes (open question 1).** The plan is
  written on a yes, at 85%. The lead holds the merge until the owner answers.

## What the source shows

Base read: `0f41ba4c` on `origin/main`, the merge of PR 1542 (ticket 1122). Every claim below is
about `next/`.

`next/packages/libfabrika/src/node/dev/watch.ts`, as built:

1. Each selected program gets its own Rolldown watcher. Its events go into a queue, and
   `Stream.split` on `END` makes one group per Rolldown cycle. Effect's `Stream.split` emits only
   non-empty groups, so each delivered `END` makes exactly one `watch.rebuild` run.
2. Each rebuild builds the program's current inputs and calls `install` for every good build, with
   `from: "boot"` for the first attempt and `"watch"` after. Nothing skips an install whose hash did
   not change. The brain answers `same` for a hash it already runs (`runtime/Code.ts`, `Installed`).
3. The install call runs inside the `watch.rebuild` span, which gets its `program` and `outcome`
   attributes when it ends.
4. Programs run as separate streams merged with unbounded concurrency, so two programs' installs
   interleave, while one program's rebuilds run one at a time, in order.

The L10 law in `next/packages/libfabrika/src/node/dev/watch.laws.integration.test.ts` (the
`// L10, p77` block) drains the brain double's install queue until 3 s pass with no install:

- **At boot,** it expects the drained `[program, from]` pairs to be exactly one `boot` pair per
  program.
- **After each save,** it expects the set of programs whose hash changed, and the set of programs
  that installed at all, each to equal the programs whose bundle reaches the saved file.

So the law assumes one install per program per boot or save, and it uses quiet time to say that
nothing more is coming. The finding shows both failing on the Linux cloud box under a concurrent
`pnpm lint`:

- **Run 2.** The drain received each program's boot install plus three `watch` installs, the
  repeats that items 1 and 2 above allow. That the three were unchanged bytes is inferred: no file
  changed before the first save.
- **Run 3.** No install came inside 3 s.

Twelve idle runs at the merged head passed. PR 1542 fixed the same assumption in the save-driven
L17/L18 law: it checks each reply by identity and waits under one bound per save, never for quiet.

A repeat inside a save's window hits the same assumption. A late boot repeat from a program the save
does not reach turns "only the programs that reach it install" red, even though the watcher did
nothing the plan forbids. The 3 s quiet window cannot tell a late repeat from a missing install;
the finding says so in its `cost`.

**Call, 90%:** this is a fault in the law, not the product. The P15 contract permits repeated
rebuilds with `same` answers. The 1122 plan read the same P15 plan as saying so, and the lead
approved that reading. No product defect is shown. If the controlled reproduction exposes one, the
tests step stops and the plan is amended before any product change.

## Settled rules and existing evidence

Read for this plan: `AGENTS.md`, `next/AGENTS.md`, `docs/plan/README.md` (its 2026-11-18 entry
names this flake), decisions 0036, 0052, 0178, 0291, 0292, 0555, 0567, 0587 and 0594,
`docs/direction/hot-reload.md`, the 1122 plan `docs/plan/quests/dev-watch-rebuild-fix-PLAN.md`, its
proof row `field/runs/2026-11-18-dev-watch-rebuild-fix-cloud-proof.json`, and the watcher findings
under `field/findings/` dated 2026-11-13 to 2026-11-18.

- **0036 binds the fix.** It removes the cause. No wider timeout, no retry around an assertion, no
  skip. A fix that lengthens the quiet window is out, and `loosening.sh` runs on the change.
- **0291 and the hot-reload note's p77** say only the saved program's processes swap. An install
  answered `same` swaps nothing (`Installed.same`, and p72: a reload to the same hash changes
  nothing a reader can see). So the swap rule does not settle whether an unreached program may
  call `install` with unchanged code. L10's "only they install" is stricter than p77, which is why
  open question 1 goes to the owner.
- **0555** forbids `vi.mock` in `next/` tests, with one exception: an outside package, inside the
  law of the one file that wraps it, with Rolldown as the example. This plan extends that existing
  `rolldown` wrapper; it adds no new mock.
- **0567** rules out hand `_tag` comparisons in `next/` test files. New code matches unions with
  `Match.tag` (finding `2026-11-18-watch-save-law-compares-tags-by-hand`).
- **Decision 0602** (open PR 1614, named in `docs/plan/README.md`): no `.integration.` law runs on a
  pull request, a queue group or a branch proof run. The proof is therefore the Linux cloud box, as
  for 1542.
- **The 1542 findings on its proof** (`2026-11-18-watch-plan-plants-and-ordering-not-recorded`,
  `2026-11-18-watch-trace-lines-not-in-event-order`) shape the Records section: every plant's red
  is recorded, and trace lines carry an order the code can actually produce.

Settled search: `records.ts find --read-only` for "watcher boot install repeat same hash", "drain
quiet window flaky deadline", "only the programs that reach it install" and "rolldown repeated
notification rebuild unchanged". Every hit was read. None decides how a law may treat a repeated
install by an unreached program. `rg` over `docs/plan`, `docs/direction` and `field/findings` for
`p77`, `L10`, `repeat` and `same` found only the texts above.

## How others do it

- **Elm.** Every Cmd result comes back as a message, and `update` handles each one by its contents
  ([Elm guide, HTTP](https://guide.elm-lang.org/effects/http.html), not fetched this session). A law
  in that spirit takes every install and says what it is. It never infers from elapsed time which
  save an install belongs to.
- **Erlang/OTP.** `receive` picks messages by pattern, and messages between two processes keep their
  order ([Erlang reference manual, processes](https://www.erlang.org/doc/system/ref_man_processes.html),
  not fetched). The known way to know that earlier messages were handled is a synchronous round
  trip, such as `sys:get_state/1`, never a sleep. `settle` is that round trip: it counts the
  notifications already delivered and waits until each has an ended rebuild.
- **Testing practice.** Martin Fowler's "Eradicating Non-Determinism in Tests", which 0036 cites,
  says an asynchronous test waits on a condition with a bound and never on a fixed sleep.
  Awaitility's "await until, at most" is the same rule
  ([awaitility.org](http://www.awaitility.org/), not fetched).
- **Rolldown 1.2.13, as installed.** Its `WatcherOptions.buildDelay` documentation describes a
  debounce in the file watcher and never promises one cycle per save. `RolldownWatcherWatcherEventMap`
  documents a `change` event, `[id, {event}]` for "a file was modified", and a `restart` event for
  "a new run was triggered". The law reads both through the real watcher, unchanged.
- **Effect 4.1.3, as installed** (`@effect/vitest` 4.1.3, fast-check 4.10.2, vitest 5.0.5; Effect's
  existing patch changes arbitrary shrinking only). `Effect.currentSpan` (`src/Effect.ts:17405`)
  gives the span an install runs in. `Queue`, `Deferred` and `Tracer.NativeSpan.end` give the waits.
  `node_modules/effect/AGENTS.md` was read. This plan adds no dependency and no patch.

**The lead's lean, weighed: drain to a stable state.** As a suggestion, "stable" can mean one of two
things, and neither holds alone.

- **No new installs for a while.** That is the quiet window again, under another name. It cannot
  tell a late repeat from a missing install.
- **Each program reached its expected hash.** That ignores what happened on the way. A stray changed
  install from an unreached program, or a stale build that later corrects itself, passes. It also
  cannot see a save that reaches no program at all.

**Call, 85%: take the 1542 shape and make "stable" a count.** Every install is accounted for by
program and hash, and each owed change waits under its own bound. Then `settle` waits until every
Rolldown cycle delivered so far has an ended rebuild span. That keeps the lead's idea of reaching a
stable state without a quiet window: the state is stable when the product has handled every
notification it was given. The cost is about 40 more test lines than a plain stable-state check.

**The branch that would undo 1542: the watcher stops installing unchanged code.** The product could
skip an install whose hash equals the program's last answered hash. The literal "only they install"
would then hold. But it changes the watcher's stream contract: no more `same` replies for
repeats, and 1542's `duplicate` check, which takes one install per `same`, would have to change. It
is a new design call on the product. It is the fallback if the owner answers no to question 1, and
this plan does not take it.

## The change

The tests step owns every edit, all in the law file. No product line changes.

### 1. The Rolldown wrapper records what Rolldown says

The existing `vi.mock("rolldown")` wrapper gains two fields per watcher, beside `closed` and
`repeat`. Both are kept in memory only:

- `ends`: how many `END` notifications reached the product's listener, real and replayed. The
  existing `repeat` replay counts its own `END` through the same small function.
- `changes`: the ids from Rolldown's own `change` event, registered on the real watcher through the
  original `on`. These are absolute temp paths and are never written to a record.

### 2. L10's install double captures its rebuild span, and can hold one install

L10 wraps `brain`'s `install`. It reads `Effect.currentSpan`, which is the product's
`watch.rebuild` span, and records `{code, span}`. It can also hold one program's next install
behind a `Deferred` gate, as saveWalk's gates do for replies. The shared `brain` helper and the
L18 law do not change.

### 3. L10 accounts for every install

Sketch, not compiled:

```ts
type Seen = { readonly code: Install; readonly span: Tracer.Span };
type Values = readonly [shared: number, own: number]; // the fixture's `globalThis.__p15` array

const last = new Map<string, Install>(); // program -> its last changed install

// One install is a change or a repeat. Nothing is skipped.
const account = Effect.fnUntraced(function* (seen: Seen, pending: Set<string>, want: (p: string) => Values) {
  const before = last.get(seen.code.program);
  if (before !== undefined && seen.code.hash === before.hash) {
    // A repeat: Rolldown notified again, and the bytes did not change.
    expect(seen.code).toMatchObject({ from: "watch", source: before.source });
    yield* inOwnRebuild(seen, "same");
    return;
  }
  expect(pending.has(seen.code.program), "only a program the save reaches installs a changed hash").toBe(true);
  expect(seen.code.from).toBe(before === undefined ? "boot" : "watch");
  expect(seen.code.hash).toBe(yield* hash(seen.code.source));
  expect(fixtureValue(seen.code.source).facts[0]?.values).toEqual(want(seen.code.program));
  yield* inOwnRebuild(seen, "loaded");
  last.set(seen.code.program, seen.code);
  pending.delete(seen.code.program);
});

// Each owed change has its own 3 s bound, which a repeat never renews.
const owed = (programs: ReadonlyArray<string>, want: (p: string) => Values) => {
  const pending = new Set(programs);
  return Effect.forEach(programs, () =>
    takeUntilChanged(pending, want).pipe(
      Effect.timeoutOrElse({ duration: "3 seconds", orElse: () => Effect.die(new Error("an owed install never came")) }),
    ), { discard: true });
};

// Settled: every END delivered so far has an ended rebuild span. A count, not a quiet time.
const settle = Effect.fnUntraced(function* () {
  const delivered = ends(); // summed over this case's watchers, snapshot now
  while (endedRebuilds() < delivered) yield* Queue.take(completed);
  for (const seen of yield* Queue.clear(installs)) yield* account(seen, new Set(), want);
}); // bounded by the file's existing 10 s "a started rebuild ends" bound
```

`inOwnRebuild` waits for the install's span to end, under the same 10 s bound. It then checks that
the span is a `watch.rebuild` that ended normally, that its `program` is the install's program and
its `outcome` is the expected one, and that no other install shares that span.

The walk, step by step:

- **Boot.** `owed(every program, () => [0, 0])`, then `settle`.
- **Each save.** The existing generated file and value are written. Then
  `owed(reaches[file], current values)`, a positive wait until the case's watchers have reported a
  `change` for the saved file at least `reaches[file].length` times, and `settle`. A save that
  reaches no program owes nothing and only settles.
- **The end of the case.** The stream's scope closes and every watcher closes. Every install left
  in the queue is accounted for. Then these hold:
  - normally ended rebuild spans are at most the delivered `END`s;
  - for each saved file, the number of case watchers that ever reported a `change` for it equals
    the number of programs that reach it;
  - every install from after boot came `from: "watch"`.

The existing walk stays as it is: `fc.gen()`, edits 1 to 4, values +1 to +99, the four fixture
files, seed 119120, `runsFor({ fast: 3, full: 20 })`, and the shared/own/outside coverage check.
`Stream.runDrain` stays; L10 reads installs, not replies.

### 4. `fixtureValue` reports both values

`fixtureValue` gains one field per fact, `values`: the numeric literals of the `__p15` array's
elements, `[shared, own]`, or `null` for an element that is not one. The build minifies, so
imported constants are inlined. saveWalk's expectation already pins `own` as a `Literal`, and the
same inlining gives `shared`. saveWalk's exact expectation gains `values: [0, value]`. That is a
stronger check, and its existing stale-build plant must still go red.

### 5. A scenario law reproduces the failure without load

The new law is "scenario: L10 repeats at boot and inside saves are accounted for". It runs four
fixed cases, in order, each in its own fixture. Each case uses the wrapper's existing `repeat`,
which replays the watcher's last completed cycle without changing any file:

1. **Boot repeat.** Once both boot installs are in, `repeat` runs on every case watcher. Each program
   then installs its boot hash again, from `watch`. This is run 2's shape.
2. **Repeat inside an own save.** Write `programs/one/own.ts`, then run `repeat` on every case
   watcher. Program two, which the save does not reach, installs unchanged code inside the save's
   wait.
3. **Repeat inside an outside save.** Write `shared/unused.ts`, then run `repeat` on every case
   watcher. Both programs install unchanged code while the save owes nothing.
4. **A held repeat released after the write.** Gate program one's next install. Run `repeat`. Once
   the gate holds that unchanged install, write `programs/one/own.ts`, then release the gate. Program
   one's rebuilds run in order, so the held unchanged install is the first install of the save's
   wait. It must be checked as a repeat and must not pay the save's owed change.

The gate decides the order. No sleep chooses it. Every gate is released through scoped cleanup,
including when an assertion fails.

**Call, 90%:** these four cases are the right regression. They use installs the real watcher made
from real Rolldown events, and they turn the old law red on purpose. They prove the law handles
those orders, not that run 2 had exactly that order.

### The other waits in this file (0036's "tests that share the cause")

| Wait | Can it go red on a late or repeated install? | This plan |
|---|---|---|
| L10 boot and per-save `drain(b.installs, 3000)` | yes, the finding's two shapes | replaced |
| L18 interruption: boot `drain(b.installs, 3000)` | no: nothing asserts on what it drained, and the run is cut either way | unchanged |
| L18 interruption: the broken save's `failure` within 3 s | no: a bound on an owed fact, not a quiet window | unchanged |
| First L17/L18 law: `drain(answers, 300)` after each `repeat` | no: each drained answer must be `same`, and a positive wait for every rebuild span to end follows | unchanged |
| saveWalk: `drain(answers, 300)` after the late repeat | no: it follows a positive wait on the repeat's span, and every reply left over is checked at the end | unchanged |

After this change, `drain` is used only by the first L17/L18 law, saveWalk and L18.

## What L10 asserted, and what it asserts now

| Assertion before | After | Narrower? |
|---|---|---|
| Boot: one `[program, boot]` pair per program, nothing else in 3 s of quiet | Each program installs exactly one changed hash at boot, `from: "boot"`, with values `[0, 0]` and a hash of its source. Any other boot install is an unchanged repeat in its own rebuild | The count "once" becomes "one change". This rests on 1542's approved boot-duplicate handling and the P15 permission. **Call, 85%: the lead's to approve, not the owner's** |
| Save: the programs whose hash changed equal `reaches[file]` | Each reached program installs exactly one changed hash with the save's values. No unreached program installs a changed hash, at any point in the case | No: stronger. It adds an exact count, values and hash, and covers the whole case, not 3 s |
| Save: every install is `from: "watch"` | kept | no |
| Save: the programs that installed equal `reaches[file]` ("only they install") | An unreached program may install only an unchanged repeat: same hash and source, inside its own rebuild span. Rebuilds never outnumber delivered Rolldown cycles, and no unreached watcher reports a change for the saved file | **Yes: open question 1** |
| The walk reaches shared, own and outside saves | kept | no |
| Each wait: 3 s of quiet, renewed by any install | 3 s per owed change, never renewed by a repeat. `settle` and span ends use the file's existing 10 s bound for a started rebuild | No: never later than the old drain allowed, for any schedule |

If the owner answers yes, the L10 title becomes "L10: a save changes the hash of exactly the
programs whose bundle reaches the file, and any other install is an unchanged repeat from that
program's own rebuild". The pull request's mapping table carries the rename for `loosening.sh`.

Which planted breaks each version keeps red (P1 to P6 live only on a scratch branch):

| Product break | Old L10 | A rule of same hash and source only | This plan |
|---|---|---|---|
| P1 hash the entry file only | red | red | red |
| P2 install every program on any rebuild ("push to every process") | red | green | red: span tie |
| P3 build each cycle twice | green | green | red: rebuilds outnumber cycles |
| P4 install the previous rebuild's build | red | red | red: values |
| P5 watch an outside file (`addWatchFile` of `shared/unused.ts`) | red | green | red: change count |
| P6 add a per-rebuild counter to the hash | green unless a repeat came | red only with a repeat | red: scenario case 1 |

## One value traced through

1. Boot. `p15/one` installs hash `A1` from `boot` with values `[0, 0]`, inside a `p15/one` rebuild
   span that ends with outcome `loaded`. `p15/two` does the same with `A2`. Both owed changes are
   paid.
2. A spurious Rolldown cycle on two's watcher. Two installs `A2` again, from `watch`, with the same
   source. `account` reads it as a repeat, and its span ends with outcome `same`. The old law
   turned red at this step.
3. `settle`. Three `END`s were delivered and three rebuild spans ended, so the boot is settled.
4. A save writes `programs/one/own.ts` with `own = 37`. Owed: `p15/one`.
5. A late repeat from two arrives first: `A2`, unchanged, inside its own rebuild. It is accounted
   for as an unreached repeat (question 1), and it neither pays nor renews one's bound.
6. One installs `B1` from `watch` with values `[0, 37]`, and `B1` is the hash of its source. Its
   span is `p15/one` with outcome `loaded`. The owed change is paid.
7. One watcher has reported a `change` for `programs/one/own.ts`, as many as the programs that
   reach it. `settle` waits for the spans of the five delivered `END`s.
8. The scope closes. No install is left over, and at most five rebuild spans ended normally against
   five delivered `END`s.

If step 6 never comes, its 3 s bound fails the law, whatever repeats arrived in the meantime.

## Laws

All are runtime tests: they judge asynchronous behavior of a real Rolldown watcher on real files,
which neither lint nor types can see. They stay `*.integration.test.ts` laws, because no stand-in
can produce real file notifications, Rolldown's own `change` and `END` events, or a real rebuild.
They are not Mac-only: the proof runs on the Linux cloud box before the first review (0178's
timing, 0594's routing), never on the owner's Mac.

| Law | Kind | Generator or reason label | Plant that must turn it red |
|---|---|---|---|
| L10a. At boot each program installs exactly one changed hash, from `boot`, with values `[0, 0]` and a hash of its source; every other boot install is an unchanged repeat inside its own rebuild | test | fc.gen: the existing walk, 3 runs at fast depth and 20 runs at full depth, seed 119120 | Law: restore the old boot drain equality (scenario case 1 red). Product: P6 |
| L10b. A save changes the hash of exactly the programs whose bundle reaches the file: one changed install each, carrying the save's values; no unreached program ever installs a changed hash | test | fc.gen: the same walk, 3 runs at fast depth and 20 runs at full depth | P1, P4 |
| L10c. Any other install is an unchanged repeat from its own program's rebuild: one install per `watch.rebuild` span of the same program, rebuilds never outnumber delivered Rolldown `END`s, and the watchers that report a change for a saved file number the programs that reach it | test | fc.gen: the same walk, 3 runs at fast depth and 20 runs at full depth | Law: restore the old "only the programs that reach it install" check (scenario cases 2 and 3 red). Product: P2, P3, P5 |
| L10d. A repeat never pays an owed change, and each owed change has its own 3 s bound that no repeat renews | test | scenario: case 4's held unchanged install, released after the write | Law: let any install of a pending program pay its owed change |
| S1. The four repeat orders above are accounted for: boot repeat, repeat in an own save, repeat in an outside save, a held repeat released after the write | test | scenario: the wrapper's existing `repeat` and one `Deferred` gate, four fixed cases | Law: the old L10 assertions, applied to each case: case 1 shows run 2's shape |
| saveWalk's value check also pins the shared element | test | fc.gen: saveWalk's existing walk, 3 runs at fast depth and 20 runs at full depth, unchanged | Product: 1542's stale-build plant, run once more |

Kept unchanged: the first L17/L18 law, saveWalk's other checks, the R1 scenario and the L18
interruption law. Kept in L10: the reached-module coverage and the generated walk.

## Existing tools

- `account`, `owed`, `settle` and `inOwnRebuild`, test-local in
  `next/packages/libfabrika/src/node/dev/watch.laws.integration.test.ts`. Searched that file's
  `receiveChange`, `duplicate`, `checkSpan` and `sameSpan`, the dev folder's other laws, and the
  installed Effect `Queue`, `Deferred` and `Tracer` APIs. `receiveChange` and `duplicate` are
  closures inside saveWalk, bound to one program and its reply queue. L10 has two programs and
  reads installs, so it reuses their shape (`Queue.take`, one bound per owed change, span
  completion through `end`) rather than the closures. Generalizing saveWalk to two programs would
  rewrite 1542's law, so it is not done here. vitest's `vi.waitFor` polls on an interval. The span
  completion queue gives the same wait with no polling and is already the file's way.
- The wrapper's `ends` and `changes`, in the same file's existing `vi.mock("rolldown")` block.
  Searched the wrapper's `repeat` and `cycle` code and Rolldown 1.2.13's
  `RolldownWatcherWatcherEventMap`. Rolldown's own `change` event, used as it ships, gives the ids,
  and counting `END` reuses the wrapper's existing `END` branch. 0555's Rolldown exception already
  covers this block, and it gets no new mock.
- The span capture in L10's install double. Searched `Effect.currentSpan` in the installed
  `node_modules/effect/src/Effect.ts` and the file's tracer, which records spans at `end`. It reuses
  both.
- The install gate in L10's double. Searched saveWalk's `gates` queue with its `Deferred` pair, and
  reuses that pattern.
- `fixtureValue`'s new `values` field, in the existing helper. Searched the helper's own `number`
  and `kind` readers, and reuses `number`.

No new exported name, no new code file and no new dependency.

## Settings

This adds no setting. Each bound is a property of the law: how long a watcher may take to answer
an owed install before the law calls it broken. A person never chooses to accept a later answer,
so these are not `fabrika.toml` values (0069). The depth setting, `FABRIKA_TEST_DEPTH`, stays as
it is.

## Files

Read-only rows make ownership explicit. They authorize no edits.

| File | Owner | Product lines expected | Work |
|---|---|---:|---|
| `next/packages/libfabrika/src/node/dev/watch.laws.integration.test.ts` | tests | tests | Wrapper fields, L10's accounting and bounds, the scenario law, `fixtureValue`'s `values` and saveWalk's expectation |
| `next/packages/libfabrika/src/node/dev/watch.ts` | build | 0 | Read-only product contract; product plants live only in a scratch worktree |
| `next/packages/libfabrika/src/node/dev/internal/watcher.ts` | build | 0 | Read-only boot and failed-input phases |
| `next/packages/libfabrika/src/node/build/build.ts` | build | 0 | Read-only build path and minify setting |
| `next/packages/libfabrika/src/runtime/Code.ts` | build | 0 | Read-only install answer contract |
| `next/packages/libfabrika/src/runtime/Built.ts` | build | 0 | Read-only `hash` |
| `vitest.config.ts` | tests | 0 | Read-only runner limits |
| `.agents/skills/lead/scripts/loosening.sh` | tests | 0 | Read-only law comparison, with the pull request's mapping table |
| `docs/plan/quests/l10-boot-drain-PLAN.md` | lead | docs | Save, check and sign this plan |
| `docs/plan/README.md` | lead | docs | Record the quest's result in "Where we are now" |
| `field/runs/` | lead | records | Step rows, and the cloud proof row with every plant and trace |

If a product change turns out to be needed, the plan is amended, with its owner, before the build
starts it.

## Validation

No validation command runs in this read-only plan step.

**The tests step** writes the change in a permitted Linux container or on the cloud box. It runs
the scenario law and L10 there one file at a time, with
`FABRIKA_TEST_DEPTH=full nice -n 15 pnpm exec vitest run --project next-integration --maxWorkers=1`
on the law file, `-t` naming the law. Pinned Node 26.13.0, `TYPESAFE_API_KEY` unset, no `CI` or
approval variable set to pass the local guard. No integration law runs on the owner's laptop. Before
the repair, it reads one real run's `change` ids, to confirm their shape and that Rolldown reports
no `change` for `shared/unused.ts`. That is the `vector:` the change-count check rests on. If
Rolldown does report one, the step stops and the plan is amended.

**The lead's cloud proof,** before the first review, on the Linux cloud box, as for 1542:

1. **Controlled reproduction, before the repair.** Run the scenario law with the old L10 assertions
   (the law plant). Case 1 must fail with run 2's shape: each boot install followed by `watch`
   installs. Cases 2 and 3 must fail on "only the programs that reach it install". Record the
   command, head and failure lines.
2. **After the repair:** the scenario law 5 times in a row, L10 at full depth 10 times in a row on
   an idle box, then L10 at full depth 3 times while a `nice -n 15 pnpm lint` runs beside it, the
   finding's load. These are proof runs, not retries. A run the kernel kills for memory is recorded
   as that, never counted as a pass, and starts a finding.
3. **The whole watcher law file** once at full depth.
4. **Every plant once:** P1 to P6 in `watch.ts` on a scratch branch, never committed or pushed, plus
   the four law plants above and 1542's stale-build plant against saveWalk. Record each red, then
   remove it.
5. `pnpm format`, then `pnpm lint`. The lead runs the one changed-test selection and the one
   `pnpm typecheck`, and starts no integration law on a laptop.
6. **The lead reads** the whole diff, every `loosening.sh` hit with the mapping table, the proof
   row and the leak grep.

No skip, no wider bound, no retry around an assertion, no smaller input range and no lowered rule.

## Records

No product fact changes.

What cannot be recovered later is what the real watcher did under load. The proof row records it,
in the shape of `field/runs/2026-11-18-dev-watch-rebuild-fix-cloud-proof.json`:

- Each run's head, seed, path, depth, command, seconds, and whether a concurrent lint ran.
- For the loaded runs, the scratch trace, in one fiber's order: each install's program, `from`,
  hash cut to 8 hex, and change or repeat. Also each Rolldown `change` id as a path relative to the
  fixture, each `restart`, and each watcher's `END` count at every `settle`. This is the evidence
  for the top doubt: whether spurious notifications point at files that something else touched, and
  whether a missing boot install follows a `restart`.
- Each plant, which law went red, and its failing line.
- The new L10's time per full-depth run. The old one took 260 s, mostly in quiet windows.

No absolute temp path, private marker or raw source goes into a committed record. Raw logs go to
the private archive.

## Size

One pull request: about 180 to 260 changed test lines and 0 product lines, plus the plan and the
records. About 1.5 to 2.5 agent hours of tests work and about 3 hours of proof time on the box.
Confidence 70%. The change-count check's real Rolldown behavior and the gate in case 4 are the
main uncertainty.

1. L10 accounts for every install, and the scenario law reproduces the flake: 0 product lines, about 220 test lines, landing whole after the owner's answer to question 1.

A split was weighed and rejected: the boot fix first, the narrowing after. A first pull request
that keeps the literal "only they install" still goes red when a late boot repeat lands in a save's
wait, so it would not fix the flake whole.

Budget basis: median list prices over this month's rows in `field/runs/`: tests $2.38, build $1.13,
review $2.11, fix $4.18. The 1122 quest needed five tests rounds and two reviews on the same file.
Allow tests $3, build $1.2, review $2.2, one fix round $4.2 and one recheck $2.1, about $12.7,
rounded up.

Estimate: 5 steps, $14

## What this cannot tell us

- Why the real watcher saw spurious Rolldown notifications under load. The proof's trace can point
  at the files, but it cannot prove what touched them.
- Whether run 3's missing install was slowness or a boot build restarted by those notifications.
  If a miss comes back on a box with memory to spare, that is a new finding and a ticket on the
  bound. The bound is not widened here.
- Whether the four scenario orders cover every order real load produces.
- Whether a product fault hides behind the flake. A controlled trace that shows one stops the tests
  step, and the plan is amended before any product change.

## Amendment 1: the owner's rulings (2026-11-18)

The owner answered both questions yes, relayed by the merge lead (fabrikaa) on 2026-11-18. They are
owner rulings, not the lead's calls, and they replace open question 1 and the 3 s bound below.

- **Q1, yes.** L10 accepts an install by a program the save does not reach when it is an unchanged
  repeat: the same hash and source as that program's last change, inside that program's own
  `watch.rebuild` span. A changed hash from an unreached program still fails. The title change in
  "What L10 asserted, and what it asserts now" stands.
- **Q2, yes.** L10 drops the 3 s bound per owed install and waits on events. The owed change is the
  install of the first rebuild after Rolldown reports the save's `change`: a count with no clock.
  At boot it is the install of each program's first rebuild. Only the test's own time limit (the
  `it` timeout) backs up a watcher that never answers. Speed, if it is wanted later, becomes its own
  measured law.

Why: the cloud proof at 2f388a50 (`field/runs/2026-11-18-l10-boot-drain-cloud-proof.json`) passed
10 of 10 idle and failed 3 of 3 beside a `pnpm lint` with "an owed install never came". A fixed
budget for a real build measures the machine (0052). Removing it removes the cause, which is what
0036 asks, so it does not count as a wider timeout.

**What changes in "The change", applying Q2's principle to every wait L10 owns:**

- `owed` takes installs until the owed program's first rebuild after its `change` report has
  ended, then requires that rebuild's install to be the owed change. A repeat in that rebuild, or no
  install in it, fails at once with its own message, never after a timeout.
- **The lead's reading of Q2, after the tests step built it (85%):** the owed change is due by the
  end of the program's first rebuild that started after the `change` report, and a rebuild that
  started earlier but already read the saved bytes may pay it first. Read as "that rebuild's install
  must be the change", the rule fails a correct watcher on an order scenario case 2 makes on
  purpose. It stays a count with no clock, a repeat still never pays, and an unpaid change fails at
  the end of that rebuild with its own message.
- The change-report wait in `owe` and the scenario's gate wait lose their 3 s bounds too, by the
  same principle.
- `settle` and `inOwnRebuild` wait on the span-completion queue with no 10 s bound. Those 10 s
  bounds are the file's existing ones; inside L10 they are the same machine-dependent wait, so
  Q2's principle covers them. Only the `it` timeout backs them up.
- The bounds in the other laws of the file (the first L17/L18 law, saveWalk, R1 and L18) are not
  changed here. Each is listed for the lead as ticket text under 0036's "tests that share the
  cause".
- L10d becomes: a repeat never pays an owed change, and the owed change is the install of the
  first rebuild after its `change` report. Its plant stays: let any install of a pending program
  pay its owed change.
- Proof again on the Linux cloud box at the new head: the scenario 5 times, L10 10 times idle and
  3 times beside a `pnpm lint`, the whole file once, and the plants whose red went through the 3 s
  bound (P4 and the law plants) once more.

## Open questions

1. *Answered yes by the owner, amendment 1.* **May L10 accept an install by a program the save does not reach, when it is an unchanged
   repeat?** That means the same hash and source as that program's last change, made inside that
   program's own rebuild span, with no more rebuilds than Rolldown delivered cycles and no change
   report for the saved file from that program's watcher. A changed hash from an unreached program
   still fails. Yes or no?

   **Lean: yes, 85%.** p77 and 0291 speak of swaps, and a `same` answer swaps nothing (p72). The
   P15 contract permits repeated rebuilds with `same` answers, and 1542 already accepts them for
   the saved program. Every planted break the old clause caught stays red here (the table under
   "What L10 asserted"). What yes loses: a program's extra rebuild that its own Rolldown watcher
   started, with unchanged bytes, no longer turns L10 red.

   The stricter alternative, if the answer is no: keep "only the programs that reach it install"
   literally, and change the product so the watcher skips an install whose hash equals the
   program's last answered hash. That is a new design call. It undoes the `same` replies that
   1542's laws check, and it needs its own plan. With the owner away, the steps run on the yes,
   and the lead holds the merge for the answer (0014).

## Findings

None.
