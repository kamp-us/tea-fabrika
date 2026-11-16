# 0077: exam slice A hit the no-verdict error a third time; your go or stop

Slice A's fresh retry was the one retry allowed for a no-verdict outage. It stopped partway through
on the same no-verdict error, now seen three times. It broke no rule, and nothing was pushed. It
has 4 of 12 rows left. I need your ruling before a fresh agent goes on.

## What was refused

The command was one plain git call:

```sh
git show 3f34351:next/apps/fabrika/src/exam/clock.integration.test.ts
```

The text, exactly:

> The server-side auto mode classifier gave no verdict (error), so auto mode cannot determine the
> safety of Bash. This is a transient failure of the check, not a judgment about the action: a
> later response may get a verdict. You may try the action again once, as-is.

The check did not judge the command. It failed to answer.

## What it finished before the stop

These ran at `2621967`, and the 0178 guard allowed every run. 8 of the 12 rows ran side by side:

- no-hand-tag
- ledger-sql
- no-effect-run-outside-edge
- edge-comment, both breaks, plus `edge-config.test.ts`
- effect-functions, plus `edges.integration.test.ts`
- one-store-hook
- no-of
- object-imports

In each, the old file was green, the moved law was green, and each break turned the old and new
files red together.

Left: clock, react-rules, no-promises (both halves) and layers.

## Not done

- No row was written, and nothing was committed or pushed.
- `pnpm lint` and `pnpm typecheck` were not run.
- `fabrikalfa/exam-to-lint-a` is still at `2621967`.
- Eight restored old exam files sit uncommitted in that agent's own worktree. They cannot leak.

## My lean: go, with the retry built into the brief

A fresh agent would do the 4 rows left and re-run the 8, because a row must be its own run. Then it
writes the row, runs lint and typecheck, commits and pushes.

Its brief would carry the step rules' outage rule as written: on a no-verdict error, pause, then
try that same command once, as-is. On a second error, or on any real refusal, it stops.

I lean "go" at about 75%. All three errors were outages, not verdicts, and the refusal text itself
offers one retry as-is. My doubt: three outages on one slice in a few hours may mean the check is
failing on something in this slice's commands, not at random. If so, more retries only cost time,
and the ticket you filed should get this third sighting.

## Also: a possible flake

In one whole-file run of `oxlint-plugins/plants.test.ts`, 1 of 240 tests timed out at 60 s. The
load was 22 on 4 cores while another agent's tsgo ran. It has not been re-run, so it is not yet
shown to be a flake. The fresh agent re-runs it alone and reports.

## The other exam slices

| Slice | State |
|---|---|
| B | Tests running |
| E | Tests running |
| F | Stopped, with the owner (mail 0071) |

## What this cannot tell you

Whether the no-verdict errors cluster on long commands, or on this box. The three sightings came
from different agents, on different commands.
