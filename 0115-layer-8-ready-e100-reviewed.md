# 0115: stack layer 8 (Reflect) is ready, at `405e3a21b`; E100 is reviewed

## Layer 8: ready, and holding nothing unreviewed

The branch is `fabrikalfa/reflect-fold-1`, head `405e3a21b`.

It holds `reflect-rest` at `cc7bd5ca5`, layer 7 at `299c2819b`, and Reflect slice 10's reviewed
head, `e8d0dc607`. The fold also made two edits that the base's checks forced. Slice 10's same
reviewer read both, and both are done:

- **`29041907b`** deletes only three `@stability` doc lines, as 0574 requires. Main had already
  dropped the same tag in `control.ts`.
- **`836896217`** folds the same decode and mapping into one `Effect.mapBoth`. `bad_row` still
  comes before any call, the type stays `Entry<C>`, and it adds no cast and no disable line.

**Checks at `405e3a21b`:**

- **`pnpm lint`:** 17 of 18 parts passed in the full run. `lint:promise-types` was killed for
  memory there and passed alone with 0 findings, so all 18 parts pass. Lint changed no file.
- **`pnpm typecheck`:** one run, passed.
- **Slice 10's 13 law files:** all passed, plus `chaos-revoke` 1/1 and `dev-control` 3/3. No
  override was set.
- **leakgrep:** both checks are clean.
- **Root:** one, `6e9a51046`.

**Not in it yet:**

- **Layer 7's newer head.** Layer 7 has since folded app-src s1's final head, lib-top-s1,
  gateway-processes-telemetry s1 and transport-s1, and the plans at `4a17276e0`. I will send layer
  8 that head once those folds finish, and layer 8 merges it once.
- **Reflect slice 14.** Its tests step is running, and it folds in batch 3 once reviewed.
- **Reflect slice 13.** It waits on PRs 1099 and 1312.

PR 1494's body already lists slice 10 and its new names.

## E100 (`apiStabilityLeak`): reviewed, done; for your layer 5

The branch is `fabrikalfa/effect-e100`, head `f24e58362e3225f8c0c803d3b0422c39bb8341a6`. It is
based on E60's `bd5037296`, and its diff against E60 is run rows only, with no source. A head with
its finding row comes next. Leak checks are clean on its own commits and on the added lines that
land.

**The recount, with every tag gone:** 424 hits at 180 sites.

| Where | Hits |
|---|---|
| libfabrika | 221 |
| `next/apps/fabrika` | 86 |
| `.agents` | 117, of which 44 were found only by per-file passes |
| oxlint-plugins, tuval, vitest, the programs | 0 |

`.github/ci` was not re-run by the reviewer.

**All 424 name an unstable Effect type** that one of our exports shows. The biggest are
FileSystem 78, ChildProcessSpawner 65, Path 65, PlatformError 49, ByteSize 30,
`Schema.ByteSizeFromString` 26 and `crypto/Digest` 26. The reviewer checked every related
"declared unstable here" location by script: all are in effect@4.1.3's dist, and none are ours.

So, under 0574, the check stays off everywhere. Nothing is swept, and there is no tsconfig, ignore
or lock change. The plan's 242 rose to 424 because tags no longer mask the leaks, plus the 44
per-file hits.

**A reading for you or the owner.** 0574's title says "error only where it recounts at zero". That
could be read as locking the folders that count zero: oxlint-plugins, tuval, vitest and the
programs. The decision's body, its binding constraint and the plan row all say off. The reviewer
agrees with off, at 75%, and so do I. Locking only the zero folders would guard almost nothing,
since those folders export no unstable types today.

A finding row is being committed: E100's limits line wrongly says the root tsconfig and
`stylelint.config.ts` went uncounted. Both sit in `oxlint-plugins/tsconfig.json`, which counted 0.
E60 and E100 are both done.
