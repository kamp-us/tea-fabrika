# 0063: Reflect rest needs a re-sign (point 7); E98 correction; a lint:dead false alarm for the owner

## Reflect rest (PR 1494): amendment point 7, for your re-sign

**Amendment point 7 is pushed at `2da186e77`.** It is a recount after 1366 and Stub.make, with no
design call. `plancheck --draft` digest: `99b6b4930280`.

| Slice | Recount |
|---|---|
| 10 | 28 fires in 5 files, unchanged |
| 14 | 43 in 14, up from 37, because 1366 added `runtime-quotas.laws.test.ts` (5 fires) and `worker-quotas.integration.test.ts` (1) |
| 13 | 15, unchanged |

- It also records Stub.make's real, stricter signature:
  - its rest returns `A[keyof A]`;
  - each use names its type;
  - a canned answer that no member accepts takes a kind-10 `@ts-expect-error`.
- `mock-cloudflare-s2` is not on origin yet, so slice 10 starts without it. The later of the two
  carries the other's lines.
- **Next:** the coordinator starts slice 10's tests once your signature is on the branch.

**PR 1494's body now has `## New names`:**

- **From the diff:**
  - `RemoteCall`, `Remote` and `ProcessObjectCalls` (in `runtime/ObjectCalls.ts`);
  - `DevProject`, `DevProcess` and `DevGateways` (in `node/dev/dev.ts`);
  - `reflectDisables`, the `fabrika/reflect-disables` rule.
- **Sources:**
  - Comlink's `Remote<T>`, checked at github.com/GoogleChromeLabs/comlink#typescript;
  - the installed `@cloudflare/workers-types` (`Rpc.Provider`, `DurableObjectStub`).
- **Not fetched:** developers.cloudflare.com, eslint.org and eslint-community.github.io do not
  resolve from this box. The match to eslint-comments' `no-restricted-disable` is cited through
  `oxlint-plugins/README.md` instead.
- **Stop-hook flag:** the hook marks `2da186e77` as Unverified. Its committer is the fabrikalfa bot
  email, which `stepcommit.sh` sets for every step commit. Nothing was amended or force-pushed.

## Correction to mail 0062: E98 was not refused in the end

E98's coordinator says the review row was committed and pushed before my "don't" arrived. A stop
hook prompted it, and the commit went through. `fabrikalfa/effect-e98` is now at `40cf509fc`, one
row on top of the reviewed `773588d`, and leakgrep is clean. Its two finding rows are being committed
the normal way. So E98 is not a second refusal sighting.

The open sighting is exam slice A's 9 refusals with no verdict, and its one retry is still out. If
that retry is refused too, I mail you at once.

## lint:dead false alarm, for the owner (AGENTS.md: a wrong lint:dead finding goes to the owner)

Mock sweep `lib-top-s1` (`fabrikalfa/mock-lib-top-s1` at `8d92196df`) finished its tests step. Every
law is written, and every plant, T4's included, turned its law red. Its build is running.

**The false alarm:** `pnpm lint:dead` flags `Id.test-support.ts:generatorWith` as called only from
tests.

- **Cause:** code-graph's `testSupportFilePatterns`, which `node-kinds.json` can set, do not list
  `*.test-support.ts`, which is the repo's place for test helpers (0538).
- **Likely fix:** one entry in `node-kinds.json`, outside the plan.
- The slice has not made that fix, as AGENTS.md says. Its finding row is being committed on the
  slice branch.

**Ask:** may a small lead-tooling fix add `*.test-support.ts` to `testSupportFilePatterns`, or does
the owner file it as a code-graph bug?

**Fold note:** `lib-top-s1` also created `VI_METHODS` and the first
`vitest/no-restricted-vi-methods` block, listing only lib-top's globs. The fold unions it with the
other slices' globs.
