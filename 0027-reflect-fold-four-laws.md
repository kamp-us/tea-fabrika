# 0027: reflect fold PR 1481, the four slow laws are green at 0c710f03b

All four files passed at `0c710f03b647c6d24680ade6fecabdf274148d3c`
(https://github.com/kamp-us/tea-fabrika/pull/1481). The box changed nothing in the repo, and its
tree is clean. Two files needed a box fix before they could run. Neither fix was in the code under
test.

| File | Final result | Command |
|---|---|---|
| `next/apps/fabrika/e2e/one-file.visual.test.ts` | 2 passed, 0 failed, 0 skipped | `xvfb-run -a nice -n 15 pnpm exec vitest run --maxWorkers=3 <file>` |
| `next/apps/fabrika/e2e/resources.laws.visual.test.ts` | 5 passed, 0 failed, 0 skipped (after installing `openssh-client`) | same, under `xvfb-run -a` |
| `next/packages/tuval/src/browser/key.laws.visual.test.ts` | 1 passed, 0 failed, 0 skipped (on Chromium headless shell build 1243, see below) | `nice -n 15 pnpm exec vitest run --maxWorkers=3 <file>` |
| `next/programs/counter/src/runner.laws.integration.test.ts` | 5 passed, 0 failed, 0 skipped | same |

## The first runs, and why they failed

- `resources.laws.visual`, first run: 2 failed, 3 passed.
  - `pinned: an interruption just after the port is held leaves no home, though the worker exits mid-release`
    failed with `Error: Test timed out in 120000ms.`
  - `generated fault walks over the first-window suite: success, setup failure, test failure and interruption after each reached acquisition`
    failed with `AssertionError: "plain": a passing suite exits 0 by itself: expected { code: 1, signal: null, ms: 1352 } to match object { code: +0, signal: null }`.
  - Cause: the child suite it starts (`first-window.visual.test.ts -t L11`), run alone, failed with
    `PlatformError: NotFound: ChildProcess.spawn (ssh-keygen ...) Caused by: Error: spawn ssh-keygen ENOENT`.
    The box had no `ssh-keygen`. After `apt-get install openssh-client`, all 5 passed.
- `key.laws.visual`, first run: failed at launch with `browserType.launch: Executable doesn't exist at
  <pw-browsers>/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`.
  The repo's Playwright 1.64.1 wants build 1248; the box has 1243. With that path linked to the
  1243 shell, the law passed. So it ran on 1243, not the pinned 1248.

## A gap seen many times: root cause and ask

The missing `ssh-keygen` has now broken box runs in many slices (the digest lists `box.test.ts`
and `commits-git-*`, and now this). The older Chromium build is the second gap. Both are the cloud
environment's setup, not the code. AGENTS.md says a gap seen a second time gets its root cause and
a ticket. I cannot reach the app's tracker from here, so:

- **Ticket for you to file:** the cloud environment lacks `openssh-client` and Playwright 1.64.1's
  Chromium build 1248, so `.visual.` and `commits-git-*` laws fail at setup in cloud boxes.
- **Fix I can propose:** a setup-script line on this cloud environment
  (`apt-get install -y openssh-client`, plus the Playwright browser install for the pinned version
  if the network allows it). Proposing it shows the owner an approval prompt. Say yes and I will.
