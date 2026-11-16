# 0070: a ticket to file for compound-command refusals; E28 visual box; group 1 amendment

One ask: please file a tracker ticket, because the tracker is on the laptop. The worktree-isolation
check refused step agents three times today, each with a real verdict. Every time the cause was a
compound shell command it could not prove stays inside the worktree. I put the fix in the step
rules, but the step briefs and skills should carry it too.

## The ticket

The three refusals, all on exam slice E (`fabrikalfa/exam-to-lint-e`), all with a verdict:

1. git in a `for` loop with `$(...)`, after `cd ... ||`. The refusal said it was "too complex to
   verify that it stays inside the worktree".
2. `git -C .`. The refusal said it "points git at a directory computed at runtime".
3. A heredoc file edit (`python3 <<EOF || node -e`). The refusal said it was "too complex to verify
   that it stays inside the worktree".

The root cause: an agent in a worktree joins git and file edits into compound shell commands. The
fix is in `fabrikalfa/twin-tools` `step-rules.md` at `846e70d2e`, under "Plain git, one command per
call":

- Run each git command as its own plain call from the worktree root, with no `cd`, `-C`, loop,
  `$(...)` or `&&` chain.
- Read and search files with the Read and Grep tools.
- Edit and create files only with the Edit and Write tools: never a heredoc, `python`, `node -e`,
  `sed -i` or a redirect.

The ticket would put the same lines in the step skills (tests, build, review) and in the lead's
brief template, so laptop agents carry them too.

## Since 0069

| Job | State now |
|---|---|
| Exam slice E | Main is merged in at `6853640`, and leakgrep is clean. The only conflicts were import lines in three laws files. Lint is red on one hit main brought in: `fabrika/machine-has-laws` at `next/packages/libfabrika/src/processes/internal/quota.ts:75`, from PR 1366. A fresh tests agent is fixing it inside the slice: a `git mv` to `quota.laws.test.ts` and an S2 sync law. Then it finishes deleting `laws-scan.integration.test.ts` and writes the finding row. |
| Exam slices B, F and A | B: its tests step is running. F: the same reviewer is rechecking the second fix round at `cc90752`; a third send-back stops F. A: still held on your ruling about the no-verdict outage. |
| E28 | Its own box has only Chromium build 1243, because it was built before the setup script got 1248. A fresh box, `session_015QKFcySGcTgdXEW3YT89nH`, now runs E28's `.visual.` laws at `311512755`, with no override. Counts come in the next mail. Everything else in E28 is done and passed review. |
| Group 1, Effect patch | The Effect patch on app-e2e-s1 at `f02b31948` adds only `warnLines`, in src, dist `.js` and `.d.ts`. No fix is needed. |
| Group 1, plan amendment | One commit on top of `5ecab3938`. It cites oxc#29656 in every lock note, and Effect#10665 in app-e2e's patch note and pipeline's reader note. It also fixes any plan line that says the patch adds `errorLines`. Its head comes for your re-sign once it pushes. |
| Group 1, still open | `pnpm-workspace.yaml` on app-e2e-s1 still says the issue link goes there "once filed". That path belongs to the tests step, so the Effect#10665 link goes in with app-e2e's L5 tests round, after the re-sign. |
| Group 3 | Told not to push plan changes to `fabrikalfa/mock-app-src` until the amended plan is signed. |

## What this cannot tell you

- Whether the three refusals happen outside exam slice E. They are likely, since every slice
  coordinator briefs its agents the same way, but this is the only slice where they showed so far.
- E28's visual counts, and the head of group 1's amendment, are not in yet.
