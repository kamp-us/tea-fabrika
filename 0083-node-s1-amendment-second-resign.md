# 0083: node-s1's option (b) amendment is ready for the second re-sign

Group 2 has pushed the node-s1 amendment that builds your option (b). It is ready for the second
mock-plans re-sign.

- **Head:** `fabrikalfa/mock-plans` at `1551b60b8fc7adaac6de07ccbd219a3662318972`. That is one
  commit on top of your signed `7c84f1c35`, a fast-forward.
- **File:** it touches only `docs/plan/quests/mock-node-PLAN.md`.
- **Checks:** leakgrep is clean. `plancheck --draft` on an unsigned copy exits 0, and `pnpm lint`
  exits 0.
- **Open questions:** none.

## What option (b) turned out to need

It needs a product change, of about 105 lines. The law hands `projectLayer` a whole `Env`, and the
Project wraps each binding itself. One example is `runtime.ts:1240`,
`ProcessClient.make(processStub(...))`. Another is `runtime.ts:730`, `RecordManager.remote`.

The new shape:

- **Objects.ts** is a new contract file. It holds `ByName<S>`, `ProcessObjects` and `RecordObjects`.
- **Two layers** come with it: `ProcessObjectsRpc.ts` and `RecordObjectsRpc.ts`. One file per
  layer follows 0095.
- **runtime.ts:** the Project's seven calls ask `ProcessObjects`, and `recordLayer` reads
  `RecordObjects`.
- **projectLayer** keeps its signature and provides both layers. Its body becomes
  `projectLayerWithoutObjects`.
- **The test harness:** `ProjectAuditTest`'s Harness gains `objects(box, accept)`.
- **The law** uses two `Recorder.layer`s. `Stub.make` stays strict, and `Stub.ts` is unchanged.

## Plant changes

- **M2:** its plant is now the chained form. It turns red through `no-restricted-properties`.
- **M3:** its plant is "msg refuses every object message", as you asked.
- **M4:** restated to what the types hold. The types catch a misspelling in `Recorder`
  implementations and in a plain interface's own methods. They do not catch one inside a Durable
  Object stub's own methods, which M3 catches.

## After the re-sign

The work runs on `fabrikalfa/mock-node-s1` from `2d2f8bfb9`, in about 5 steps for an estimated
$25: tests round 2, then the build, then the review.

## Also from group 2

Transport-s1's build is done at `1ab5edd`. Its laws are all green and typecheck is 0. Its review
is running.

## The 0573 entry, for both re-signs

Group 1 found that main's 0573 law makes every override that sets `no-restricted-properties` carry
`Data.TaggedError`. The pair-lock blocks therefore restate it as a third entry, beside JSON.parse
and Reflect. The signed amendment does not name it. The slices follow the code, but you may want
the plans to say so.

## What this cannot tell you

Whether 105 product lines stay inside the mock-sweep plan's "test code first" spirit. The plan step
says the law cannot hold without them.
