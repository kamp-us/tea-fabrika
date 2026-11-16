# 0029: setup script changed; merge calls sent on; PR 1462 box started

## Setup script (your yes from 0027)

- I tried both lines in my own box first.
  - `apt-get install -y openssh-client` works only after `apt-get update`. Then `ssh-keygen` is
    `OpenSSH_9.6p1`.
  - `pnpm exec playwright install --with-deps chromium`, run in `next/packages/tuval` (Playwright
    1.64.1), is **blocked by the network**:
    `request blocked: no rule or allowlist entry allows host "cdn.playwright.dev"`. At the repo root,
    `pnpm exec playwright` is 1.63.0 and finds its build 1243 already there, so it downloads
    nothing.
- As you said, I kept only the openssh lines. The owner approved the prompt, and the environment
  now runs `apt-get update` and `apt-get install -y openssh-client` before Node.
- To get build 1248, the environment would need `cdn.playwright.dev` on its allowed hosts, plus
  the install line run from `next/packages/tuval`. Say if the owner wants that proposed.
- A fresh box is checking the new script now: `ssh-keygen`, the Chromium builds present, and
  `key.laws.visual.test.ts` (expected to fail at launch on 1248, with no link made). Its result
  follows.

## PR 1462 slow laws

One fresh box at exactly `262c210b4` runs the whole `next-integration` and `next-visual` projects,
one after the other, with `--maxWorkers=3` under `nice -n 15`, and visual under `xvfb-run -a`. It
installs openssh-client and links the pinned Chromium paths to 1243 if they are missing, and says
so. Counts and any assertion text follow.

## Your merge-session calls, sent on

- 1494: the reflect-rest coordinator goes on with slice 9. Process calls take (A), Project calls
  take (C), L7 is as you wrote it, and the `Pick` sketch gets fixed. The L5 fix (count disable
  lines) comes in this round.
- 1497 (0580): the plan coordinator is amending all four fixes, and the `reads:` stacking with
  0591, where 0580's `{ scenario }` form wins.
- 1498 (0573): the plan coordinator keeps `no-context-tag` until ticket 486, swaps the other three,
  and counts 0592's override. It also adds the shared `no-restricted-properties` list note, and says
  whether E55's swap is in its scope.
- Digest calls: saved whole as `judgment-rulings-0026.md` on `fabrikalfa/twin-tools`.
  - The running coordinators got their parts: E31 to E34, E36, E30 (fix each other library hit;
    a Worker or DO entry gets a reasoned line) and E47 (subpath imports).
  - A new rulings-round coordinator does E61 (`"!effect/*"` plus plants), E53, E49, E58, E50, E42
    (split by folder, with `@effect/platform-node` as a `catalog:` devDependency of counter), and
    the E38 and E56 rows.
  - E43: a new coordinator gives all 135 left hits `Function.dual`, everywhere, split by folder if
    needed. The integrator's lock covers every folder it reaches.
  - E55 waits on 0573's swap.
