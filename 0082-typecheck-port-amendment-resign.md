# 0082: the typecheck port's option-(b) amendment is ready to sign, with one call against your words

The T766 port's plan amendment builds your option (b): `scripts/typecheck*` get a tsconfig program
of their own, and E3 is untouched. The amendment is pushed and ready for your re-sign. One part
differs from what you asked. You said a `@demlik/tea` import in `scripts/typecheck.ts` must turn
the typecheck red. The plan step found that typecheck cannot see that import, so lint holds it
instead. Please accept that or overturn it when you sign.

## What is ready

The branch is `fabrikalfa/port-typecheck`.

| Head | What it holds |
|---|---|
| `0ec6ba3` | **Cause 2 fixed.** Both TS377021 warnings are gone, through a typed `PropertyFailed` error, and the laws are unchanged. `scripts/typecheck.test.ts` and `typecheck-lock.test.ts` pass 8/8. The build's finding row is committed as `field/findings/2026-11-16-typecheck-port-t1-cannot-pass.json`, with rule `doc_drift` and ticket `null`, to fit `field-schema.ts`. |
| `e1a75cb` | **The plan amendment, to sign.** plan-sha256 `828a36a9ee439e2d4a207cc674901c88e32544e7762782c59f352cf90690af4d`. `plancheck --draft` passes on an unsigned copy, `pnpm lint` passes, and leakgrep is clean over `origin/main..e1a75cb`. |

## What the amendment does

- It adds a new workspace package, `@tea-fabrika/scripts`, with `scripts/package.json` and a
  `scripts/tsconfig.json` that extends the base.
- That package holds the 18 `scripts/typecheck*` files. The existing `pnpm -r typecheck` reaches
  it.
- E3 and `tsconfig.base.json` are untouched, and the `.agents` include lines come back out.

## The call: lint holds the tea plant, not typecheck

The plan step is 85% sure of this. It tested it on a scratch copy:

- **A `@demlik/tea` import:** typecheck stays green. The new program's file list holds only tea
  0.27.0, so there is no duplicate package to report.
- **A floating Effect:** typecheck still raises TS377001, so the program's Effect checks do work.

So the amendment adds lint law L2. oxlint's `no-restricted-imports` bans `@demlik/tea` and its
subpaths in those files. It repeats the earlier bans, with a plant that shows none was lost.

Making `pnpm typecheck` itself red would need a `paths` entry in `scripts/tsconfig.json` that
shadows tea, and no other program in the repo does that.

My lean is to accept it, at about 80%. It matches AGENTS.md's rule that a check on the shape of
code is a lint rule, never a test, and it holds the same thing your plant asked for.

## After the re-sign

1. A tests step, run in its own worktree, for L2, T1 and the workspace files.
2. The build.
3. One `pnpm typecheck`.
4. The Opus review.

## What this cannot tell you

Whether a future second tea version in the scripts package's own lockfile entry would bring the
duplicate error back. It would, but nothing plans one.
