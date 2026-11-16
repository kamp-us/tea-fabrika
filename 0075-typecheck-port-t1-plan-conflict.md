# 0075: the typecheck port (T766) hits a plan conflict at law T1; your call

The 0113 port of `scripts/typecheck.sh` to TypeScript is built. Every vitest law is green, but law
T1 is red, so `pnpm typecheck` exits 1. One cause conflicts with another signed plan's law and
needs your or the owner's call. The other cause is a small tests fix, and it is running now.

## Where it stands

- **Branch:** `fabrikalfa/port-typecheck`, build head `8172034`.
- **Checks:** leakgrep is clean. `loosening.sh` over `24b7a67..HEAD` has 0 hits. `pnpm lint`
  passes on the whole repo.
- **Green laws:**

  | Law file | Passed |
  |---|---|
  | `typecheck.test` | 5/5 |
  | `typecheck-lock.test` | 3/3 |
  | `typecheck.integration` | 7/7, over three runs, with no flake |
  | caps | 29/29 |
  | caches | 18/18 |
  | skillscheck | 9/9 |

## Cause 1: two plans conflict, and this needs your call

T1 adds `../scripts/typecheck*` to `.agents/tsconfig.json`. Every `scripts/` file in that program
then gets TS377051 `duplicatePackage`, because two `@demlik/tea` versions are installed. That
includes `Look.ts`, which imports only `effect`.

The only allowance for this is the override in `tsconfig.base.json` at line 123, with
`include: [".agents/**/*.ts"]`. But law E3, in `oxlint-plugins/duplicate-packages.test.ts`, comes
from the tea-msg-tag plan. It requires that include to hold `.agents/**` globs and nothing else.

The two ways out:

| Option | What it costs |
|---|---|
| (a) Widen E3 to also name the `scripts/typecheck*` globs | A change to a signed law. If it reads as a loosening, it needs the owner. |
| (b) Type-check `scripts/typecheck*` in another tsconfig program, outside `.agents/` | A plan amendment to the port's plan, which you re-sign. No law changes. |

**My lean: (b)**, at about 70%. It keeps E3 as written and keeps the duplicate-package allowance
as narrow as the tea-msg-tag plan meant it to be. My doubt is whether a new program for scripts
should share `.agents/tsconfig.json`'s settings. Reading why the base override was scoped to
`.agents/**` would settle it.

## Cause 2: a tests fix, running now

TS377021 `unknownInEffectCatch` fires at `scripts/typecheck.test.ts:241` and
`scripts/typecheck-lock.test.ts:539`. Both are `catch: (cause) => cause`. One fresh tests-step fix
agent is fixing both and committing the build's finding row. It then stops.

## What waits on your call

`pnpm typecheck`, the Opus review, and the build or tests change your T1 ruling needs.

## What this cannot tell you

Whether the second `@demlik/tea` version is meant to be there. If it is a lockfile slip, removing
it would make both options unneeded.
