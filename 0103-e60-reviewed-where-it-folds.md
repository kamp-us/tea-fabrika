# 0103: E60 is reviewed; which layer does it fold into?

E60 (`unstableApiUsage`) passed review. **I need your call on where it folds.**

- **Branch:** `fabrikalfa/effect-e60`, head `bd50372962b5d0b03a818a9c957f27c1142ad0fe`.
- **Base:** `eeb8ecdbb`, the stack top.
- **Review:** one send-back, fixed, then done.
- **Leak checks:** clean on its own commits and on the added lines that land.

## What it does

E1 had already done the rule side. E60:

- removes the 135 `@stability` lines left in PR 1366's 16 libfabrika files;
- deletes the `fabrika/no-stability-tag` "off" override in `.oxlintrc.json`;
- makes law 2 of `oxlint-plugins/no-stability-tag.test.ts` run all 26 paths, with plants.

## The recount

`unstableApiUsage`, alone at error over 13 tsconfigs, gives 3,582 hits. All of them are on 31
distinct Effect parts, and 0 come from our own `@kampus` exports. The top parts:

| Part | Hits |
|---|---|
| `@effect/vitest` | 1,716 |
| `effect/Arbitrary` | 409 |
| `effect/FileSystem` | 301 |
| `platform-node/NodeServices` | 229 |
| `effect/Path` | 204 |
| `ChildProcessSpawner` | 101 |
| `crypto/Digest` | 94 |
| `cli/Flag` | 75 |
| `ByteSize` | 62 |

The full list is in `field/runs/2026-11-16-effect-e60-step2.json`.

## Left on purpose for the integrator

E60 adds no lock and no `allowedUnstableApis` entry, and it sets `unstableApiUsage` to error
nowhere. The integrator names the 31 parts and adds the lock for every folder. The finding row is
`field/findings/2026-11-16-e60-plan-parts-left-undone.json`.

Left optional: the tagged-block cases in `jsdocs.test.ts` stay, because `jsdocs.ts` still accepts
the tag.

## Where it folds

E60's row is mechanical, but its branch sits on the stack top, `eeb8ecdbb`. That top holds 1507
and 1301, which sit above 1501. Mechanical round 2, `fabrikalfa/effect-mechanical-2`, bases on
1501. Merging E60 there would pull 1507 and 1301 under round 2.

The choices:

- **(a) Your layer 5:** fold E60 with the Effect judgment slices, since both sit on the stack top.
- **(b) A later layer of its own,** together with the lock PR that names the 31 parts.

I lean (a), at about 70%. It needs nothing new, and the lock is a later PR either way.

E100 (`apiStabilityLeak`) has started, after E60.
