
Plancheck-Version: 3

# Root causes for the tezgah focus, L13 and L15 flakes, in next/ (decision 0036)

All three are about `next/`. The first two are test-helper bugs. The third is a product bug in the
gateway, which the law found.

```text
flake                          what the wait waits for                    why it comes late, or never
tezgah L28/L30 (and L33)       a region named in an ARIA snapshot         the region left the page after the snapshot,
  tezgah.test-support.ts:161     to have a bounding box                     and Playwright's boundingBox waits 30 s for it
L13 (host)                     the guard process to write guard.ready     the guard's bundle loads rolldown, lightningcss
  P19Launchd.test-support.ts     within desktop.brain-stop-timeout (5 s)    and two oxc native addons it never uses
L15 (two tabs, W2)             tab t1's checklist field to show           likely a lost wakeup in the gateway: a knock that
  first-window.visual.test.ts    (the window is online)                     lands after a grant's drain is never woken
```

The fix in each case removes the cause. No timeout grows, nothing is retried, nothing is skipped.
All three slices land after PR 1562, which changes every file they touch (see "Who lands first").

## How sure, and the doubt at the top

| Flake | Cause | How sure | What would settle the doubt |
|---|---|---|---|
| tezgah focus L28/L30 | snapshot then a waiting per-name read | 90% | the plant law below hangs on today's `drawn` and passes on the fixed one |
| L13 (ticket 1167) | heavy guard bundle against a 5 s bound | 75% for the bundle; 95% that the wait is guard.ready | `guardMs` recorded in `runs/p19/host.json` on host runs before and after the split |
| L15 | gateway knock after the grant drain | 60% that this is what hit run 44216670632; 90% that the race exists in the code | the gateway law below goes red on today's `Gateway.ts`; the L15 failure message names the tab and shows whether it still shows a code |

## Records

What was read, so a reader can check each claim.

- Decisions: [0036](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0036-a-flaky-test-is-fixed.md),
  [0052](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0052-tests-never-depend-on-the-machine.md),
  [0178](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0178-host-only-laws-run-first.md),
  [0594](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0594-safe-checks-direct-mac-ci.md),
  [0536](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0536-real-resource-tests-run-only-on-the-schedule.md),
  and 0590's proof run (a hand-started `scheduled.yaml` run on a branch).
- Finding rows on main: `2026-11-18-tezgah-focus-runs-past-its-wait-limit`,
  `2026-11-18-l13-launchd-brain-stop-flakes-on-host` and
  `2026-11-18-p19-l13-times-out-once-after-the-settings-merge`, all in `field/findings/`. No row
  exists for L15 yet; one is in the last section.
- Code on main at 605a0e5, and on PR 1562's branch `fabrikalfa/effect-e88` (heads e85cee196 and
  ab29f23f): in the app's e2e folder, the files `tezgah.test-support.ts`,
  `tezgah-focus.visual.test.ts`, `tezgah-fold.visual.test.ts`, `electron-launchd.visual.test.ts`,
  `node/P19Launchd.test-support.ts`, `first-window.visual.test.ts` and `p14.test-support.ts`; in
  libfabrika, `gateway/Gateway.ts`, `gateway/internal/waiting.ts` and
  `settings/Declarations.ts`; and tuval's `browser/key.ts`.
- CI logs (GitHub job logs; no artifact was opened):
  - tezgah, failing: run 44243295809 job 134596389361 (attempt 1) and job 134602975180 (attempt 2),
    PR 1525 at 3ec74923. Passing: the same file at 31.5 s in main's run 44242548956 (from the
    finding row).
  - L13, failing: run 44243735833 job 134597528763 (PR 1562 at e85cee196) and run 44243040878 job
    134595233763 (PR 1494). Passing: run 44267539920 job 134677786250 (PR 1562 at ab29f23f), whose
    `runs/p19/host.json` the log prints.
  - L15, failing: run 44216670632 job 134508456856 (PR 1588 at 0d5efd6d).
- I did not find PR 1562's or PR 1583's own failed tezgah job: their cancelled runs' logs end
  before the vitest output. The PR 1525 jobs show the same stack at the same helper line.
- Nothing was run here: these laws need Chromium with the real `dev.ts`, or launchd and Electron
  (0594). No `node_modules` is installed in this box, so `plancheck.sh --draft` could not run
  either (it reads the installed fast-check).

## How others do it

- **Playwright** separates auto-waiting actions from reads. `locator.boundingBox()` resolves its
  locator first and waits up to the action timeout for one element to match. `locator.evaluateAll()`
  and `page.evaluate()` do not wait: they read what the page holds now. Playwright's advice for a
  value that settles is a retrying assertion (`expect.poll`, `toPass`) around a read that does not
  wait. `settle` here is that poll, so the reads inside it must not wait. (From the Playwright docs
  for `Locator`, read from memory and not fetched in this session; the test writer checks the
  installed version's `.d.ts` before relying on it.)
- **A lost wakeup** is the textbook bug of check-then-wait. The known fix is to register the
  waiter first and then check the condition: Linux's `prepare_to_wait` before testing the
  condition, a condition variable's wait inside a loop that re-checks the predicate under the
  lock, and Erlang's "monitor first, then look" (`erlang:monitor/2` before checking
  `is_process_alive`, as `gen:call` monitors before it sends). Not fetched; standard texts.
- **A guard process** in OTP is a small `heart`-like process with nothing but its job: it starts
  fast because it loads nothing else. Here the guard is bundled from the whole host check.

## Flake 1: tezgah focus L28/L30, and tezgah fold L33

**Cause (90%).** `drawn` reads the region names from one `ariaSnapshot()`, then asks for each
name's box with `getByRole("region", { name }).first().boundingBox()`, one call at a time
(`tezgah.test-support.ts:146-167` on main). `boundingBox` waits for its locator to match. If a
region leaves the page between the snapshot and its own read, the call blocks for the full 30 s
default and throws. `settle`'s 120 polls never get another turn. The same shape is in `foldDrawn`
(lines 398-418) for strips, and `main.boundingBox()` at line 167 has it for the main.

Evidence:

- Both failed attempts on PR 1525 hang on `checklist, t2`. t2 is the only tile the focus law
  closes (`C-b x`, `y`, at `tezgah-focus.visual.test.ts:237-240`), and `at(..., "t2 closed")`
  starts polling `drawn` right after the `y`.
- The file failed at 38.8 s and 38.2 s. It passes in 31.5 s, against a 420 s limit. So the law
  did not run "close to its limit", as the finding row says. It hung once, about 8 s in, for 30 s.
  The finding's wording is a wrong guess and should stay marked as one.
- In the same job, `tezgah-fold.visual.test.ts` failed the same way at `foldDrawn`'s line 412,
  waiting on the strip `open checklist, t7`. A strip leaves the page when Enter or a click opens it.

**Fix at the cause.** One read of the drawing happens in one page task, so nothing can leave
between the name and the box. A region that is gone is simply not in the read, and `differences`
says so, and `settle` polls again.

```ts
// Sketch, tezgah.test-support.ts. One evaluateAll over the main's regions by role: Playwright's
// role engine picks the elements once, and the callback reads every name and box in the same
// task. evaluateAll does not wait; an empty match gives [].
const read = (page: Page) =>
  promised(() =>
    page
      .getByRole("main")
      .getByRole("region")
      .evaluateAll((els) => ({
        mains: document.querySelectorAll('main, [role="main"]').length,
        main: rect(document.querySelector('main, [role="main"]')),
        regions: els.map((el) => ({ name: label(el), box: rect(el) })),
        // the facts drawn() already reads in page.evaluate: current, polite, status
      })),
  );
```

`foldDrawn` reads its strips the same way, over `getByRole("button")` filtered to names that
start `open `, in the same call. The names keep `tileName`'s words, so `regionName` and
`stripName` stay the checks. The test writer may keep `ariaSnapshot` as the source of names if
the role engine's accessible name is wanted over `aria-label`. The boxes then come from one
`page.evaluate` keyed by those names, giving `box: null` for a name that left. Either way,
**no read inside `drawn` or `foldDrawn` may wait**.

One value traced through: the focus law presses `C-b x`, `y`. The tab's next `drawn` reads
`{ regions: [{ name: "checklist, t1", box }] }` once t2 is gone, or both regions if it is still
there. If it is still there, `differences` returns `regions [...t1, t2], tezgah [t1]`, `settle`
sleeps 250 ms, and the next read agrees. Under today's code, if t2 leaves between the snapshot
and its `boundingBox`, the read blocks for 30 s and the law fails.

## Flake 2: L13, the launchd host law

Tracker ticket 1167. The coordinator reports a third sighting on PR 1583's host run tonight; I have not
read that job's log.

**Cause.** On PR 1562's head the 5 s `TimeoutError` comes from `P19Host.wait` at
`P19Launchd.test-support.ts:526`, called from `P19Host.check`. That line is
`wait(fs.exists(guard.ready), config.stopTimeout)` (main's line 527), and `config.stopTimeout` is
`desktop.brain-stop-timeout`, 5000 ms by default (libfabrika's `settings/Declarations.ts:154`). How
sure that this is the wait: 95%. The stack names the line, and both failing jobs' launchd samplers
saw no line for a `fabrika.brain.*` job: no brain was ever loaded, and the first load comes after
this wait. Both failures came about 8 s into the law, after the build and the three bundles.

Why the guard can be late (75%): the guard runs `node guard.mjs p19:guard`, and `guard.mjs` is
bundled from the whole `P19Launchd.test-support.ts`. That module imports `rolldown` and
`../../src/build.ts`, and through `@kampus/libfabrika/build` it imports `rolldown`,
`lightningcss`, `oxc-parser` and `oxc-transform-react`. `bundle` keeps all four external (its
`external` test). So the guard's first act is to load four native addons and the whole build and
settings graph, from a fresh `/tmp` folder, on a macOS runner. It uses none of them. The passing
run's `host.json` shows the same runner taking 5.7 s for the first brain start and about 4 s for
each later one, so cold first loads of several seconds are normal there. The guard's 5 s, borrowed
from a setting that measures something else, is the first bound such a load meets. The finding
`p19-l13-times-out-once-after-the-settings-merge` saw both failures just after PR 1427 grew this
module's settings imports. That fits, but proves nothing alone. The doubt: I could not measure the
guard's start here. A slow `ChildProcess.make` on a loaded runner would give the same signature.

**Fix at the cause.** The guard gets its own small entry, and the 5 s bound stays as it is:

```ts
// Sketch, e2e/node/P19Guard.test-support.ts: the guard and the few helpers both sides share
// (command, wait, alive, processes, signal, status, listening, Config). It imports effect,
// @effect/platform-node, LaunchdStatus and ProcessGroups, and nothing that builds.
export const guard = Effect.fn("P19Host.guard")(function* (file: string) { /* moved unchanged */ });
if (process.argv[2] === "p19:guard") NodeRuntime.runMain(/* as today */);

// P19Launchd.test-support.ts imports those helpers from P19Guard.test-support.ts, the heavy module
// depending on the light one, and bundles guard.mjs from P19Guard.test-support.ts.
yield* bundle(`import ${Formatter.formatJson(guardEntry)};`, guardFile, root);
const started = yield* Clock.currentTimeMillis;
// The ready file or the guard's exit, whichever comes first: a guard that crashes fails at once
// with its exit code, never as a 5 s timeout.
yield* Effect.raceFirst(
  wait(fs.exists(`${home}/guard.ready`), config.stopTimeout),
  watcher.exitCode.pipe(Effect.flatMap((code) => HostError.make({ reason: `guard-exited-${code}` }))),
);
const guardMs = (yield* Clock.currentTimeMillis) - started; // written to runs/p19/host.json
```

`guardMs` goes into `runs/p19/host.json` beside `starts` and `stops`, so every host run records
the guard's start. Today that fact is lost, and it is the one this plan's doubt turns on.

The pinned law `L13 bundles keep native dependencies resolvable` already bundles each entry and
checks its modes. It moves `p19:guard` to the new entry and adds one check: the guard's linked
files hold no `rolldown`, `lightningcss` or `oxc-*` path. That is the same check the brain entry
already has for rolldown.

## Flake 3: L15, two tabs (W2), first-window.visual.test.ts:441

**What waits.** L15 opens two tabs on one profile, then `online(h, tabs[0].page)` waits for *tab 0*
to show its code and grants that key at once. Then it waits for each tab's `checklist, t1`
"Add an item" field, tab 0 first. The failed run waited 30 s at line 441 on the first property
case (seed 119120, path 0, not shrunk). The message does not say which tab.

**Likely cause (60% that this hit the run; 90% that the race exists).** A lost wakeup in the
gateway (libfabrika's `gateway/Gateway.ts`):

- A tab's hello is refused `not_granted`. The members are read in `admit`, and later, in a
  separate `store.atomic`, the client is marked `waiting` (lines 578-643).
- The tab then calls `knock`, which adds or joins the key's waiting row (lines 726-757). It does
  not ask whether the key is granted now.
- A grant applies, reads `latest` members, then in one atomic step removes every waiting row
  whose key is now admitted, and sends `granted` news to those rows' clients (lines 1070-1086).
  This runs once.

If tab 1's hello reads the members before the grant, but its knock lands after the grant's
drain, tab 1 writes a fresh row for a key that is already granted. No one ever wakes it. It
shows its code until a person grants it again, and its field never appears. L14 does not hit
this, because it waits for *both* tabs to show their codes before it grants. L15 grants as soon
as tab 0 waits, while tab 1 may still be between its hello and its knock. That is why this law
flakes and its sibling does not.

What lowers my confidence: the log does not say that tab 1 was the one that failed. Tab 0's
field could also be late for another reason on a loaded runner (the file took 240 s in that
job). What CI must show: the gateway law below red on today's code, and the L15 failure naming
the tab and whether that tab still shows a grant code.

**Fix at the cause (lead approves: it builds the decided behavior, "the person's grant brings
both tabs online", which L14 and L15 already state; no new design call).** Register first, then
check, on both sides:

```ts
// Sketch, Gateway.ts. One helper both paths share: atomically take the rows for keys that are
// admitted now, then wake their clients. Only the caller that removed a row notifies it, so a
// race between the two paths wakes each client once.
const release = Effect.fnUntraced(function* (members: Members, at: number) {
  const taken = yield* store.atomic(() => {
    const live = waiting(at);
    const accepted = live.rows.filter((r) => !("reason" in admitted(members, r.key)));
    saveWaiting(stepWaiting(live, { type: "accepted", keys: accepted.map((r) => r.key) }));
    return accepted;
  });
  for (const row of taken) for (const client of row.clients) {
    yield* notify(client, News.cases.granted.make({ nonce: yield* challenge(ConnectionId.make(client)) }));
  }
});

// grant path: applyGrant (members written), then release(yield* clients.members, at): as today.
// knock: write the row (as today), THEN read the members and release(...): a grant that drained
// before this row existed is seen here, and a grant after it drains this row itself.
```

The window's own L15 failure message gets the tab index and the tab's body text. Then a future
red says "tab 1 still shows code 123456", or something else, rather than only "30 s".

Is this a setting? No. It is the order of two writes and two reads, with no value a person
picks.

## Laws

| Law | Kind | Generator | Plant |
|---|---|---|---|
| T1: `drawn` and `foldDrawn` never wait: on a static page whose regions and strips leave at generated moments during a read, each call returns within 2 s, and every name it returns is on the page with its box, or absent. 100 runs | test, visual (Chromium on a `page.setContent` page, no `dev.ts`) | fc.array: removals of 1 to 4 regions and strips, each at a generated read count; seed 119120 | put back today's per-name `boundingBox` read: a removal after the snapshot blocks for 30 s and the 2 s bound fails |
| T2: the focus and fold scenarios pass 30 times in a row on CI, with the count in the PR (0036's proof) | test, visual | scenario: the existing L28/L30 and L33 scenarios, unchanged | none: a count, not a law |
| G1: the guard's bundle links no compiler: no `rolldown`, `lightningcss` or `oxc-` path among its linked files, and it still dispatches `p19:guard` | test (the pinned L13 bundle law) | pinned: the guard entry as check bundles it | import `bundle` (rolldown) into the guard entry: the linked list holds rolldown |
| G2: L13 records `guardMs`, and a guard that exits before ready fails at once with `guard-exited-<code>` | test, host-only (launchd, real Electron, signals) | scenario: L13 on eligible disposable macOS CI | make the guard exit 3 before ready: the law fails with `guard-exited-3` in well under 5 s |
| G3: L13 passes 20 host runs in a row, each recording `guardMs`, with the count and the largest `guardMs` in the PR | test, host-only | scenario: L13, unchanged | none: a count |
| W1: for every order of hello, knock and grant across two clients of one key, every client that knocked ends with `granted` news, and no waiting row holds a granted key. 100 runs | test (a real gateway on an in-memory SQLite, the stand-in, so it runs on every PR) | fc.shuffledSubarray: the steps hello(A), knock(A), hello(B), knock(B), grant, repaired so each hello comes before its knock; seed 119120 | drop the knock's call to `release`: the order hello(B), grant, knock(B) leaves B with no news |
| W2: each client is woken once when knock and grant race. 100 runs | test, same stand-in | fc.shuffledSubarray: the same steps, both paths run concurrently; seed 119120 | let both paths notify without taking the row: B gets two `granted` news |
| W3: L15's failure names the tab and what it shows | test, visual | pinned: the message format | none: diagnostic |

Lint, type or test? Each of these is a behavior, so a test. A shape rule would fit one case: "no
auto-waiting Playwright read inside `drawn`". It cannot be told from a needed `waitFor` by syntax,
so it stays a review point, and T1 holds it.

Host-only laws: G2 and G3 need launchd, real Electron and real signals. They run first, before the
review, on eligible disposable macOS CI (`host.yaml`), never on the owner's Mac (0178, 0594). The
lead reads their signal and launchd lines before the review. T1 and the L15 diagnostic are
`*.visual.test.ts` (0536). W1 and W2 run on a stand-in. If the gateway world cannot be built on
`":memory:"`, they go in `GatewayRevocation.integration.test.ts` beside its knock laws, and the PR
says why.

## Files

| File | Change | Owner | Product lines expected |
|---|---|---|---|
| next/apps/fabrika/e2e/tezgah.test-support.ts | `drawn` and `foldDrawn` read names and boxes in one non-waiting call | tests | tests |
| next/apps/fabrika/e2e/tezgah-drawn.visual.test.ts | new: T1 | tests | tests |
| next/apps/fabrika/e2e/node/P19Guard.test-support.ts | new: the guard and its shared helpers, moved from P19Launchd | tests | tests |
| next/apps/fabrika/e2e/node/P19Launchd.test-support.ts | imports the helpers from P19Guard, bundles guard.mjs from it, races ready with exit, records `guardMs` | tests | tests |
| next/apps/fabrika/e2e/electron-launchd.visual.test.ts | pinned law: guard entry and G1 | tests | tests |
| next/packages/libfabrika/src/gateway/Gateway.ts | `release` shared by grant and knock; knock releases after its write | build | 40 |
| next/packages/libfabrika/src/gateway/GatewayWaiting.laws.test.ts | new: W1, W2 (or a describe in the integration file below) | tests | tests |
| next/packages/libfabrika/src/gateway/GatewayRevocation.integration.test.ts | only if the stand-in cannot build the gateway | tests | tests |
| next/apps/fabrika/e2e/first-window.visual.test.ts | L15's field waits name the tab and the tab's text on failure | tests | tests |

## Existing tools

- `next/apps/fabrika/e2e/node/P19Guard.test-support.ts`: searched the app's e2e `node` folder,
  libfabrika's `node/launchd/` and `rg "p19:guard"` for a guard entry of its own. Found none. The
  guard lives inside `P19Launchd.test-support.ts`. The new file holds that code, moved and not
  rewritten, so no new helper is written.
- `next/apps/fabrika/e2e/tezgah-drawn.visual.test.ts`: searched the app's e2e folder and
  tuval's browser visual laws for a law on `drawn` itself. There is none. It uses
  `p14.test-support.ts`'s `browser` and `profile` and Playwright's `page.setContent`, with no new
  helper.
- `release` in `Gateway.ts`: the grant path's drain at lines 1070-1086, moved into one function
  so knock reuses it. Searched `gateway/` and `access/` for an existing "wake the waiting rows"
  helper and found only that inline block.
- `next/packages/libfabrika/src/gateway/GatewayWaiting.laws.test.ts`: searched `gateway/` for a
  knock-and-grant order law. `GatewayRevocation.integration.test.ts` has knock and grant-target
  laws but no ordering law. The new file reuses its `world()` shape, on `nodeSql(":memory:")`.
- Read without wait: Playwright's own `locator.evaluateAll`; no new utility.

## Who lands first

PR 1562 changes `tezgah.test-support.ts`, `tezgah-focus.visual.test.ts`,
`tezgah-fold.visual.test.ts`, `electron-launchd.visual.test.ts`, `P19Launchd.test-support.ts`,
`first-window.visual.test.ts`, `Gateway.ts` and `gateway/internal/waiting.ts`. Its `drawn`,
`foldDrawn`, guard wait and knock/grant code keep the same shape there: the race and the heavy
guard are still on its head. So:

1. PR 1562 lands first, untouched by this plan.
2. Then the three slices below, each branched from main after 1562, each its own PR.
3. Under 0036, a rerun that unblocks a merge before these land is allowed only once the fix is in
   flight, and the rerun PR names the ticket.

## Size

1. Slice A, tezgah (tests only): `tezgah.test-support.ts` about 70 lines changed, T1 about 110
   lines. 180 lines. 85% sure of the size.
2. Slice B, L13 (tests only): about 170 lines moved into `P19Guard.test-support.ts`, about 40
   changed in `P19Launchd.test-support.ts`, about 15 in the pinned law. 225 lines. 75% sure.
3. Slice C, L15 (product and laws): `Gateway.ts` 40 product lines, W1 and W2 about 180 lines, the
   L15 message about 15. 235 lines. 70% sure: the stand-in may not build, and then the laws go in
   the integration file.

Order: A first (it hits the most PRs), then B (it holds the merge queue on host PRs), then C.

Steps: A is tests and review. B is tests, the host run and review. C is tests, build and review.
Add one likely send-back: 9 steps. Priced from recorded steps on 2026-11-15 to 2026-11-18 in
`field/runs/` (`listUsd` from 1.86 to 6.66 a step), at about $4 a step.

Estimate: 9 steps, $36

## What this cannot tell us

- Which tab failed in L15. The log names only the locator. Slice C's diagnostic is what tells us.
  If the next red names tab 0 and tab 0 shows no code, the gateway race was not this run's cause,
  and the cause is still open.
- How long the guard's cold start takes. Nothing records it today. G2 adds the record, and G3's
  20 runs give the margin under 5 s. If `guardMs` stays near 5 s after the split, the cause is the
  runner's process spawn or a stall, not the bundle. The next step then is a guard that is not a
  bundle at all, and that would be a new call.
- Whether other e2e helpers have the snapshot-then-wait shape. I read `tezgah.test-support.ts` and
  the call sites in the three tezgah laws. `p14.test-support.ts`'s `tile(...).box` and `live` use
  `waitFor`, which is meant to wait for something to appear, and those were not changed.
- The controller bundle is the same heavy module. Its waits use `desktop.brain-start-timeout`
  (60 s), so it has not flaked, but it pays the same load each start.
- No run here proves anything. Every claim comes from code and CI logs.

## Calls taken

Each builds a decided behavior or is an implementation choice, taken with its percentage:

- Atomic read with `evaluateAll`, rather than names from `ariaSnapshot` plus one keyed
  `page.evaluate`: 70%, and the test writer may take the second.
- The guard's 5 s bound stays: 90%. A bigger bound would be the widening 0036 forbids, and the
  split should leave seconds of room.
- Knock wakes through `granted` news, the same path the grant uses, not a new knock reply: 85%.
- Proof counts: 30 runs for the tezgah scenarios and 20 host runs for L13: 80%. At a 10% failure
  rate, 30 greens in a row happen by chance about 4% of the time, and 20 about 12%. Host minutes
  cost more, so L13 takes fewer.
- The tezgah finding row stays as written. Its "runs close to its limit" is a wrong guess, and
  slice A's PR says so (AGENTS.md: wrong guesses stay in the record, marked as wrong): 90%.

## Open questions

None.

## Findings

```json
{"_tag":"finding","id":"2026-11-18-l15-two-tabs-checklist-field-times-out","date":"2026-11-18","rule":"flaky_test","location":{"path":"next/apps/fabrika/e2e/first-window.visual.test.ts","line":441},"says":"In next/, L15 (use in two tabs, W2) waited 30 s for tab t1's checklist 'Add an item' textbox on its first property case (seed 119120, path 0), with no code change behind it. The likely cause is a lost wakeup in next/packages/libfabrika/src/gateway/Gateway.ts: a knock that lands after a grant's drain is never woken; L15 grants as soon as tab 0 waits, while tab 1 may not have knocked yet.","proof":"Run https://github.com/kamp-us/tea-fabrika/actions/runs/44216670632 job 134508456856, PR 1588 at 0d5efd6d: 'locator.waitFor: Timeout 30000ms exceeded ... checklist, t1 ... Add an item' at first-window.visual.test.ts:441:72. Gateway.ts on main: knock (lines 726-757) adds a waiting row without checking membership; the grant path (lines 1070-1086) drains waiting rows once, after the grant applies.","cost":"Any pull request whose e2e legs run first-window can go red at random, and a person who opens a second tab while granting the first can see it stuck waiting.","ticket":null,"pr":"kamp-us/tea-fabrika#1588"}
```
