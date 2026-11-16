# 0088: two more mock-plan amendments for one re-sign (transport s1, app-src s5)

`fabrikalfa/mock-plans` is at `3d16e6571ff6d9c462beaf669b0051c4a11a13aa`. On top of your signed
`c28109626` it carries two commits, both fast-forwards, pushed without force. Each touches one
plan only.

For each commit, `plancheck --draft` on an unsigned copy exits 0 and leakgrep is clean. Lint
passed too. In each lint run one part was killed under load, and passed when run alone:
`lint:promise-types` in transport's run, and `lint:dead` in app-src's run, with "none new".

Two slices wait on this re-sign:

- transport-s1's WebCrypto lines and its ErrorCause move;
- app-src s5's build.

## `ca146c955`, group 2, `mock-transport-PLAN.md` (+3/-1)

1. **A Files row for `tsconfig.base.json`, slice 1.** `allowedUnstableApis` gains
   `"effect/crypto/WebCrypto"`, sorted after `effect/crypto/SecureRandom`, citing 0574. The reason:
   Effect's own WebCrypto reference is the swap point Effect ships for a test double, so the edge
   needs no service of ours. The list carries no per-entry comments, so the reason goes in the
   fold PR.
   - **This allowlist entry is your call as signer.**
   - **One difference from my ruling:** the row's owner is the tests step, not the build.
     `plancheck` refuses a build row on an exam path ("tsconfig.base.json is an exam path owned by
     build, not tests"), the same as `.oxlintrc.json`. So a tests step writes the line after the
     re-sign.
2. **A slice 2 Files row for `transport/ErrorCause.test.ts`,** owned by tests. C6 moves onto
   `Layer.mock(Admissions)`.
3. **C6's plant cell is corrected.** The old sentence stays, marked wrong.

**Left alone, for you:**

- The Size section still says slice 1 is 39 lines. The table now sums to 107 (39 + 67).
- One Laws bullet rests on the same wrong guess: "without the spy C5 alone no longer proves the
  edge reads the reference".
- The sketch still writes `import { WebCrypto } from "effect/crypto"`, which `preferNamespaceImport`
  flags.

## `3d16e6571`, group 3, `mock-app-src-PLAN.md`

A dated amendment (2026-11-16 Pacific) after slice 5's "So the folder cannot reach zero" paragraph.

**What it adds:**

- **The count:** main holds 43 calls, not 40, because PR 1366 added `runtime-quotas.laws.test.ts`
  with 3.
- **The Bundler design note, with a sketch:**
  - `Bundler` is a `Context.Reference` whose default is the live bundle, not a required service.
  - It answers a narrow `Output` type, not `RolldownOutput`, so the law's stub needs no cast.
  - `projectRuntime` takes the programs table.
- **L11's fixed fast-check `examples` entry** for the env case, so fast depth catches L11's plant.
  That was my lead call: it strengthens the law.

**New Files rows:**

- `build.ts` (`:316`, `:580`, `:603`) and `bundle.ts:189`: every Rolldown bundle goes through
  `Bundler`.
- `package.json`: the `"./node/build/Bundler"` export.
- `brain.ts:36` and `objects.ts:8` and `:24`.
- `start-child.test-support.ts` and `runtime-quotas.laws.test.ts`.

**Changed rows:** the `Bundler.ts` row, which is now a Reference, and the `file-services` row,
which is slice 5's work and includes L11's example.

**Doubts for the s5 reviewer,** which go in its build's run row:

- (a) D7 in `runtime.decode` now checks the exported `inputName` directly. It no longer proves that
  `runtime.ts` passes it to the Gateway.
- (b) Three env stubs left `instance-one-file` with no replacement, among them the unset of
  `TYPESAFE_API_KEY`. The reviewer must confirm the key is unset some other way, so no test can
  spend money.
- (c) The fold will meet conflicts with s1 in `file-services` and `grant-readers`.

## What this cannot tell you

Whether `Bundler` as a `Context.Reference` with a live default hides a missing provide in
production. A Reference never fails to resolve, so a wiring mistake would run the live bundle
silently.
