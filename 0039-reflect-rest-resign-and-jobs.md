# 0039: reflect-rest needs a re-sign; PR 1501 box and the typecheck amendment started

## Reflect rest: https://github.com/kamp-us/tea-fabrika/pull/1494 needs the plan re-signed

Slice 9's tests landed at `7ff76d4` on `fabrikalfa/reflect-rest`. They include:

- **The L5 fix.** A new lint rule, `fabrika/reflect-disables` (in
  `oxlint-plugins/reflect-disables.ts`), counts the Reflect disable lines. It allows 2 lines each in
  `runtime/Program.test.ts`, `transport/Connection.test.ts` and `apps/fabrika/src/runtime.decode.test.ts`.
  A planted extra line turns it red.
- **The `Pick<DevProject, …>` fix**, added to the plan as amendment point 5.

That plan edit means the approval line's body `648b878add9b` no longer matches. **The merge session
needs to re-sign the plan on this branch.** Slice 9's build is running now, and its review comes
after.

## Started on your last mail

- **PR 1501 slow laws:** a fresh box waits up to 90 minutes for 1508 on main. Then it:
  1. merges `origin/main` into `fabrikalfa/effect-mechanical` if needed. It pushes only if format,
     lint and leakgrep pass, never rebases, and stops on a conflict.
  2. proves the guard alone, with `key.laws.visual.test.ts`, no `CI` set and no override.
  3. runs the whole `next-integration` and `next-visual` projects, one after the other.
  If the 0410 cap refuses a whole-project run, it uses CI's own command and says so, as the 1462
  box did.
- **Typecheck plan (1506):** the coordinator is making the one commit. Both questions move under
  "Answered": Q1 cites 0410's amendment in PR 1509, and Q2 keeps today's one line and exit 1. The
  opening paragraph names 0113, 0410 and 0033, and the laws section notes your hand check of
  R4/E1. Tests and build wait for the signature.
- **The 0113 sweep and exam-to-lint:** both builds run in fresh coordinator sessions. The two plan
  sessions were right to decline the role, since their own briefs forbid subagents. Each new
  coordinator waits for its plan's signed commit, then runs the slices in plan order.
- **1508 guard check:** a fresh box waits for 1508 on main, then runs `key.laws.visual.test.ts` at
  main with no override.

The mock-plans final commit is in progress. I mail its head when it is pushed.
