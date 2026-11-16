---
date: 2026-11-16
from: session_015QKFcyNLy5pXJpaqP8sM7S
kind: fyi and needs answer
---

# Batches received; how I run them, and two questions

Got all five briefs: E4 to E19, Reflect slices 9 to 15, E20 to E100 (E60 on hold for PR 1366),
the kalfa lane (config slice 1 now on fabrikalfa/kalfa-config, PR 1427, ticket 1076), and the two
updates (up to 16 children; children may run their narrow, changed and reached `.integration.`
tests in their own box, never the full suite).

## How the steps run

Children may not use subagents, so each step is its own child session: a tests session, then a
build session when the slice has product hits, then an Opus review session, one after another on
the slice's branch. The plans are already approved (effect-sweep-PLAN.md on PR 1412,
reflect-ban-PLAN.md on main, kalfa-config-PLAN.md on PR 1427), so no plan step runs again.
Branches: `fabrikalfa/effect-eN`, `fabrikalfa/reflect-sN`; config slice 1 on
`fabrikalfa/kalfa-config`. First wave of 16: config slice 1 tests, then E4 to E18 tests.

## Facts from this box

- Node 26.13.0 is installed but not first on PATH (node 22 is). Every child puts
  `/opt/node-v26.13.0-linux-x64/bin` first.
- `pnpm install --frozen-lockfile` passes; `pnpm lint` passes on main 235a245.
- The checker's own quick fix is reachable: its language server (`effect-tsgo tsc --lsp --stdio`)
  answers a code action such as "Use a concise arrow body" once the check is on. A small client
  kept outside the repo asks for that fix hit by hit and applies the server's edits unchanged.
  Tried on 5 unnecessaryArrowBlock hits: all 5 fixed. One catch: the fix drops a comment inside
  the block it rewrites, so each child diffs for lost comment lines and puts them back.

## Two questions

1. **No step keys here.** `~/.fabrika/step-keys/` does not exist in a cloud box, so
   `stepcommit.sh` cannot sign. Children run `stepcommit.sh --commit-only` (its path, owner and
   exam checks, no signing), then leakgrep and a plain push. Commits stay unsigned, never amended
   or rebased, as the T955 cloud lane did. Signing is left to your side. Say if you want otherwise.
2. **A hit with no quick fix.** Where the checker offers no fix for a hit, my default is that the
   child stops on those hits and lists them, without editing them by hand (your rule 4 and 7).
   Do you allow an editor-style hand edit of exactly the change the checker's message names, one
   hit at a time, reported as hand edits in the PR? Until you answer, such hits stop their slice.
