# 0067: mock node-s1 needs a plan call (Stub.make's rest type); slice A's retry hit no-verdict again; exam slice E done

## Mock sweep node-s1: sent back to plan

`fabrikalfa/mock-node-s1` is at `08cd246b8`, pushed with leakgrep clean. No build or review has run.

**What is green:**
- M1: `plants.test.ts` 237 of 237, with the M1 plant red;
- M3: 11 of 11 in the box;
- lint.

**1. M4 cannot type-check without a cast.**
- Main's `Stub.make` (PR 1481, `next/packages/vitest/src/Stub.ts:18`) types `rest` as
  `(method: string) => A[keyof A]`, not the plan's `(...args) => unknown`.
- Cloudflare's `Rpc.Provider`-wrapped `msg` (the process stub) and `write` (the record stub) fit
  neither `own` nor `rest`. libfabrika's `tsc` gives TS2322 at
  `RunnerAdmission.integration.test.ts:134` and `:142`.
- Widening `rest` to `(method: string) => unknown` in `Stub.ts` type-checks. But that loosens a
  shared helper, and `Stub.ts` is outside this plan's files.
- Also: a misspelled member inside a Durable Object stub's `own` still compiles, so M4 holds only
  for plain interfaces.

**2. M2's plant** (`vi.fn().mockReturnValue(box)`) is the chained gap you ruled on. The pair comes in
group 1's amendment.

**3. M3's plan plant is too weak.** The plant "msg skips `box.admit`" leaves all 11 laws green. The
walk's unknown move is refused at the gateway before `msg` is reached, the same as on the old
`vi.fn` file. A second plant, "msg refuses every object message", turns 4 audit laws red.

**The call for you: how should node's process and record stubs be typed?**
- **(a)** Widen `Stub.make`'s `rest` to `(method: string) => unknown`. That is a small change to
  the shared helper. Since it loosens the helper's type, it needs your yes, and it would be its own
  slice.
- **(b)** Route `msg` and `write` through a typed service with a Recorder, as the Alchemy plan does
  for A5, so no generic platform stub is used.

My lean is (b), at about 65%: it follows the same principle as A5 and leaves the shared helper strict.

Either way, node's plan amendment also takes the second M3 plant, and the `vi` pair from group 1.
I told node-repositories-s1 and oxlint-plugins-s1 to wait for node-s1's reviewed row, and not to
merge its unreviewed lint half.

## Exam slice A: the no-verdict error came again

The fresh retry agent's very first Bash call errored. It was a `git fetch` plus `git show` of
`step-rules.md`. The error said: "The server-side auto mode classifier gave no verdict (error), so
auto mode cannot determine the safety of Bash. This is a transient failure of the check, not a
judgment about the action ... You may try the action again once, as-is." The agent stopped at
once.

- `fabrikalfa/exam-to-lint-a` is unchanged at `2621967`. Nothing was written or pushed.
- The coordinator's own Bash calls work.
- **Ask:** may one more fresh agent try after a longer pause, say 15 minutes? Or does slice A wait
  for the owner, or for the ticket you filed? Until you answer, it holds.

## Exam slice E: tests done at `efdc0b7`

- It recounted exactly 30 hits and fixed all 30, in laws files only:
  - 23 machines got `syncTest`, and 7 got a reason line;
  - 11 laws files moved from `<name>.test.ts` to `<name>.laws.test.ts`.
- `fabrika/machine-has-laws` is on at 0 hits. No machine fault was found, so no build is needed.
- **For its review to judge:**
  - the WindowMachine S2 law leaves out `said.messages`, which `loadedInto` empties on purpose;
  - `Testing.ts` moved from next-runtime to next-shared in `layer-rules.json`;
  - shard rows were renamed;
  - the rule is left off for `.agents/`, which has one hit, `flow/machine.ts`. A finding row for it
    is owed.
- **Still to do:** delete `laws-scan.integration.test.ts`. The next tests agent merges main (for
  1508), runs the old test, then removes it with `git rm`.
- Slice B's tests step and slice F's second fix round are still running.

## Typecheck port

Your hand check is passed on: the build goes ahead.
