
Plancheck-Version: 3

# Plan: a knock that lands after a grant is woken by `granted` news, and L15 names the tab it waits on, in next/ (ticket 1163, slice C of the two-flakes plan)

This builds only slice C of the approved two-flakes plan (`0001-two-flakes-plan.md` on the mail
branch `fabrikalfa/mail-session_01WuXcauHMQJS7qtW6UxMkzV`, commit 7937a668). Slices A (tezgah) and
B (L13 launchd) are other pull requests, and this one touches none of their files. Everything here
is about `next/`.

```ts
// Sketch, Gateway.ts. Register first, then check, on both sides. One helper both paths share:
// atomically take the rows whose keys are admitted now, then wake their clients. Only the caller
// that removed a row notifies it, so a race between the two paths wakes each client once.
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
// grant path: applyGrant, then release(yield* clients.members, at), as today.
// knock: write the row as today, THEN read the members and release(...).
```

## Doubts, read these first

| Claim | How sure | What would settle it |
|---|---|---|
| The race exists in today's `Gateway.ts` | 90% | W1 goes red on today's code |
| This race is what hit run 44216670632 | 60% | the next L15 red names the tab and whether it still shows a code (W3) |
| W1 and W2 can run on an in-memory gateway | 70% | the test writer builds the world on `":memory:"`; if not, they go in the integration file and the PR says why |

## The bug

Ticket 1163: L15 (two tabs, W2) waited 30 s at `next/apps/fabrika/e2e/first-window.visual.test.ts:441`
for tab t1's checklist "Add an item" field (run 44216670632, job 134508456856, PR 1588 at
0d5efd6d, seed 119120, path 0, not shrunk). The message does not say which tab.

In libfabrika's `gateway/Gateway.ts` on main at 84f51f80:

- A tab's hello is refused `not_granted`. `admit` reads the members (around line 608), and later,
  in a separate `store.atomic`, the client is marked `waiting` (lines 619-648).
- The tab then calls `knock` (lines 728-759), which adds or joins the key's waiting row. It does
  not ask whether the key is granted now.
- A grant applies, reads `latest` members, then in one atomic step removes every waiting row whose
  key is now admitted, and sends `granted` news to those rows' clients (lines 1066-1086). This
  runs once.

If tab 1's hello reads the members before the grant, but its knock lands after the grant's drain,
tab 1 writes a fresh row for a key that is already granted. Nothing wakes it. It shows its code
until a person grants it again, and its field never appears. L14 waits for both tabs to show their
codes before it grants, so it never meets this. L15 grants as soon as tab 0 waits, while tab 1 may
still be between its hello and its knock.

The client side already handles the fix's order. A `granted` news starts a new hello from any dial
state short of an outcome, `knocking` included (`transport/Handshake.ts`, the `granted` case), and
the knock's late answer then carries an id the new state no longer holds, so it is dropped. So the
knock may send `granted` news before its own reply, and no client change is needed.

## Records

What was read, so a reader can check each claim.

- Decisions: [0036](../../../.decisions/0036-a-flaky-test-is-fixed.md),
  [0052](../../../.decisions/0052-tests-never-depend-on-the-machine.md),
  [0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md) and
  [0594](../../../.decisions/0594-safe-checks-direct-mac-ci.md).
- The approved two-flakes plan, `0001-two-flakes-plan.md` at commit 7937a668 on the mail branch,
  its Flake 3 section, laws W1 to W3 and the Size section's slice C.
- Code on main at 84f51f80: libfabrika's `gateway/Gateway.ts` (`initializeChecked`, `knock`, the
  grant path's drain, `challenge`), `gateway/internal/waiting.ts` (the `knock` and `accepted`
  messages), `gateway/GatewayRevocation.integration.test.ts` (`world()`), and
  `transport/Handshake.ts` (the `granted` and `answer` cases).
- CI log: run 44216670632 job 134508456856 (PR 1588 at 0d5efd6d), as the two-flakes plan cites it.
  Not opened again here.

## How others do it

A lost wakeup is the textbook bug of check-then-wait. The known fix registers the waiter first and
then checks the condition: Linux's `prepare_to_wait` before it tests the condition, a condition
variable's wait in a loop that re-checks the predicate under the lock, and Erlang's "monitor first,
then look" (`gen:call` monitors before it sends). Standard texts, not fetched in this session.

## Fix at the cause

The fix builds the decided behavior "the person's grant brings both tabs online", which L14 and
L15 already state. No timeout grows, nothing is retried, nothing is skipped (0036).

1. The grant path's drain (lines 1066-1086) moves into one `release(members, at)` function, with
   no change in what it does.
2. `knock` writes its row as today. Then it reads the members and calls `release`. A grant that
   drained before this row existed is seen here, and a grant after this row drains the row itself.
3. Only the caller whose atomic step removed a row notifies that row's clients, so each client is
   woken once when the two paths race.
4. L15's field waits in `first-window.visual.test.ts` name the tab index and the tab's body text on
   failure, so a future red says "tab 1 still shows code 123456" or something else, rather than
   only "30 s".

One value traced through, the order the bug needs: hello(A) refused, knock(A) writes row k,
hello(B) refused, grant(k) applies and drains row k (wakes A), knock(B) writes a fresh row k. Today
B gets no news. With the fix, knock(B) writes the row, reads members that admit k, takes row k in
its own atomic step and sends B `granted` with a fresh nonce. B says hello again and is admitted.

Is this a setting? No. It is the order of two writes and two reads, with no value a person picks.

## Laws

| Law | Kind | Generator | Plant |
|---|---|---|---|
| W1: for every order of hello, knock and grant across two clients of one key, every client that knocked ends with `granted` news, and no waiting row holds a granted key. 100 runs | test (a real gateway on an in-memory SQLite, the stand-in, so it runs on every PR) | fc.shuffledSubarray: the steps hello(A), knock(A), hello(B), knock(B), grant, repaired so each hello comes before its knock; seed 119120 | drop the knock's call to `release`: the order hello(B), grant, knock(B) leaves B with no news |
| W2: each client is woken once when knock and grant race. 100 runs | test, same stand-in | fc.shuffledSubarray: the same steps, both paths run concurrently; seed 119120 | let both paths notify without taking the row: B gets two `granted` news |
| W3: L15's failure names the tab and what it shows | test, visual | pinned: the message format | none: diagnostic |

Lint, type or test? Each of these is a behavior, so a test. W1 and W2 run on a stand-in. If the
gateway world cannot be built on `":memory:"`, they go in `GatewayRevocation.integration.test.ts`
beside its knock laws, and the PR says why. W3 lives in a `*.visual.test.ts` file (0536), so it runs
only on eligible CI (0594), never here.

## Files

| File | Change | Owner | Product lines expected |
|---|---|---|---|
| next/packages/libfabrika/src/gateway/Gateway.ts | `release` shared by grant and knock; knock releases after its write | build | 40 |
| next/packages/libfabrika/src/gateway/GatewayWaiting.laws.test.ts | new: W1, W2 (or a describe in the integration file below) | tests | tests |
| next/packages/libfabrika/src/gateway/GatewayRevocation.integration.test.ts | only if the stand-in cannot build the gateway | tests | tests |
| next/apps/fabrika/e2e/first-window.visual.test.ts | W3: L15's field waits name the tab and the tab's text on failure | tests | tests |
| docs/plan/quests/l15-gateway-wake-PLAN.md | this plan | lead | 0 |
| field/runs/2026-11-18-l15-gateway-wake-tests1.json | the tests step's run row | lead | 0 |
| field/runs/2026-11-18-l15-gateway-wake-build1.json | the build step's run row | lead | 0 |
| field/runs/2026-11-18-l15-gateway-wake-review1.json | the review's run row | lead | 0 |
| field/findings/2026-11-18-l15-two-tabs-checklist-field-times-out.json | the finding row, with ticket 1163 | lead | 0 |

## Existing tools

- `release` in `Gateway.ts`: the grant path's drain at lines 1066-1086, moved into one function so
  knock reuses it. Searched `gateway/` and `access/` for an existing "wake the waiting rows" helper
  and found only that inline block.
- `next/packages/libfabrika/src/gateway/GatewayWaiting.laws.test.ts`: searched `gateway/` for a
  knock-and-grant order law. `GatewayRevocation.integration.test.ts` has knock and grant-target
  laws but no ordering law. The new file reuses its `world()` shape, on `nodeSql(":memory:")`.

## Other open pull requests on these files

Slices A and B own the tezgah and P19 files, and this plan touches none of them. Older open pull
requests also change `Gateway.ts` (1232, 1312, 1431, 1525, 1526, 1583, 1589) or
`first-window.visual.test.ts` (1431, 1504). None changes the knock or the grant drain's lines as far
as a read of their diffs shows, so whichever lands second merges main in.

## Validation

The tests step sees W1 and W2 fail on today's `Gateway.ts`, with the order that fails. The build
makes them pass. W3 and L15 run only on eligible CI, with the `visual` label (0536, 0594). 0036's
proof: L15 run many times in a row on CI, with the count in the PR.

## Size

`Gateway.ts` about 40 product lines, W1 and W2 about 180 lines, the L15 message about 15. 235
lines. 70% sure: the stand-in may not build, and then the laws go in the integration file.

Steps: tests, build and one review, plus one likely send-back: 4 steps, at about $4 a step, priced
from recorded steps on 2026-11-15 to 2026-11-18 in `field/runs/` (`listUsd` from 1.86 to 6.66 a
step).

Estimate: 4 steps, $16

## What this cannot tell us

- Which tab failed in run 44216670632. The log names only the locator. W3 is what tells us. If the
  next red names tab 0 and tab 0 shows no code, the gateway race was not that run's cause, and the
  cause is still open.
- No run here proves L15 itself: it needs Chromium with the real `dev.ts`, so it runs on eligible
  CI only.

## Calls taken

- Knock wakes through `granted` news, the same path the grant uses, not a new knock reply: 85%.
  The client already reads that news in the knocking state.

## Open questions

None.

## Findings

```json
{"_tag":"finding","id":"2026-11-18-l15-two-tabs-checklist-field-times-out","date":"2026-11-18","rule":"flaky_test","location":{"path":"next/apps/fabrika/e2e/first-window.visual.test.ts","line":441},"says":"In next/, L15 (use in two tabs, W2) waited 30 s for tab t1's checklist 'Add an item' textbox on its first property case (seed 119120, path 0), with no code change behind it. The likely cause is a lost wakeup in next/packages/libfabrika/src/gateway/Gateway.ts: a knock that lands after a grant's drain is never woken; L15 grants as soon as tab 0 waits, while tab 1 may not have knocked yet.","proof":"Run https://github.com/kamp-us/tea-fabrika/actions/runs/44216670632 job 134508456856, PR 1588 at 0d5efd6d: 'locator.waitFor: Timeout 30000ms exceeded ... checklist, t1 ... Add an item' at first-window.visual.test.ts:441:72. Gateway.ts on main: knock adds a waiting row without checking membership; the grant path drains waiting rows once, after the grant applies.","cost":"Any pull request whose e2e legs run first-window can go red at random, and a person who opens a second tab while granting the first can see it stuck waiting.","ticket":1163,"pr":"kamp-us/tea-fabrika#1588"}
```
