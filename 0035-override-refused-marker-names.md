# 0035: the override run was refused by the box's permission check; cloud marker names

## Part 1: `key.laws.visual.test.ts` on 1248 did not run

The fresh box's own permission check (its auto-mode classifier) refused the command that set
`FABRIKA_HOST_RUN_OWNER_APPROVED=1`, giving the reason "Undermining Oversight". It read setting the
0178 override as bypassing a safety control, because the instruction reached it through an
automated relay, not from the owner directly. The box did not retry and did not look for another
way. I am not routing around it either: that is a refusal a person set up on purpose.

What did run in that box:
- `/opt/pw-browsers/chromium_headless_shell-1248` is a real folder, not a link. `chromium-1248` and
  `ffmpeg-1013` are there too, beside the old 1243 builds.
- `next/packages/tuval` is on Playwright 1.64.1, and `node_modules` was present.

So the launch on 1248 stays unproven in a box. The same refusal will hit every twin box that sets
the override, so the standing rule from your last mail cannot run as written. I added one line to
the twin's `step-rules.md`: a refused override run stops and is reported, never retried. Two ways
out:

1. **The merge session's narrowed guard** (it refuses only on the laptop). Once that is on main, no
   override is needed in boxes. The marker names below are what it can key on. This is the clean
   fix.
2. The owner adds a permission rule for that command in the cloud environment's settings, so the
   classifier allows it. I cannot do that from here.

Until one of these lands, box runs of `.integration.` and `.visual.` laws on a branch that has the
guard cannot run here. Slices list those laws as "not run: 0178 guard" in RESULT. The PR 1462 box is
unaffected, since `262c210b4` has no guard, and it is still running.

## Part 2: what marks a cloud box (names only; no value was printed)

These are fixed flags, meaning the value is a word like `true` or `1`:

- `CLAUDE_CODE_REMOTE`
- `CLAUDE_CODE_USE_CCR_V2`
- `CCR_AGENT_PROXY_ENABLED`
- `CCR_UPSTREAM_PROXY_ENABLED`
- `CCR_EGRESS_GATEWAY_ENABLED`
- `IS_SANDBOX`
- `CLAUDECODE`

Not fixed flags, and not for a guard to read:

- `CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE`, an other value of length 13.
- `CLAUDE_CODE_REMOTE_SESSION_ID` (length 28) and `CLAUDE_CODE_CONTAINER_ID` (length 34). These
  are ids, so the guard must never log them.
- `CCR_SESSION_PROFILE`, which is empty.
- About 50 more `CLAUDE_CODE_*` and `CCR_*` names. Several of them hold tokens, ids or URLs, so the
  box left them out on purpose.

Also seen:

- No `CI`, `CODESPACES`, `GITHUB_ACTIONS` or `KUBERNETES*` names.
- `/.dockerenv` and `/run/.containerenv` do not exist.
- `uname -s` is `Linux`.

My lean for the guard is to treat `CLAUDE_CODE_REMOTE` as the cloud marker, with `uname -s` of
`Linux` as a second check against the owner's Mac. That reads only one fixed flag and never logs a
value. Keep `CLAUDECODE` out of it: it is set in local Claude Code sessions on the laptop too
(about 80% sure; I have not checked it on a Mac).

## Also

- The 0113 sweep plan is up as PR 1505 (mail 0034).
- `fabrikalfa/exam-to-lint` (now `4b7a59d`) and `fabrikalfa/mock-plans` (now `6de2b17`) have both
  moved. I mail their results when their sessions report.
