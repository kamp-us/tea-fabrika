# 0026: rulings digest; plan PRs; anti-slop cut; jobs started

## Started on your rulings

- **Mock plans amendment** (PR https://github.com/kamp-us/tea-fabrika/pull/1491): one child amends
  the seven plans in one commit on `fabrikalfa/mock-plans`, with all five sweep-wide points, the
  per-plan rulings, the cloudflare `readers.laws.test.ts` item (three `Effect.result` spies replaced
  by a typed service and a Recorder, 0555) and the stdout/stderr ban in both mock-cloudflare and
  mock-node-dev. Link when pushed.
- **Exam to lint (0591)**: the plan job is running on `fabrikalfa/exam-to-lint`, built on main's
  0591, with your added rule (each replacing rule proves it catches the same things with the exam
  check's own plants before the exam test goes). It coordinates with 1498 (0573) and stacks on 1497
  (0580). I mail the plan link when its draft PR opens.
- **Door gap round** on `fabrikalfa/p34c-s4`: tests (door-store clause, red first), then build
  (`quota` marked in `ordinary()`), then both whole files and the door plant in the box. It stops
  before review, for the same reviewer's recheck. Head and box results to follow.

## Plan PRs open (drafts, for the merge session)

- 0580, law options on `@kalfa/vitest`: https://github.com/kamp-us/tea-fabrika/pull/1497 . Lint and
  plancheck pass. Two open owner questions in the plan: plant gating, and the wording against 0579.
- 0573, trusted rules replace ours: https://github.com/kamp-us/tea-fabrika/pull/1498 . One open owner
  question in the plan: the no-context-tag rule.
- Reflect rest, slices 11 and 12 plus the slice 9 to 14 amendment:
  https://github.com/kamp-us/tea-fabrika/pull/1494 (head `88df38dd`). Both slice reviews came back
  merge-ready. It needs the merge session to:
  - sign the amendment, which settles slice 9's Project half: signing accepts (C), where `dev.ts`
    writes its own Project method types and a type law keeps them equal to `ProjectBinding`;
    sending it back picks (B), a `layer-rules.json` edit;
  - close PRs 1465 and 1461, which it replaces.
  A finding row came with it: the plan's L5 does not count disable lines, so a planted one passes.

## Slice PRs opened before the no-PR fix (for the merge session to close)

1482 (E26), 1486 (E31), 1487 (E34), 1489 (E28), 1492 (E32), 1493 (E39), plus 1473, 1479, 1483,
1485 and 1463 from my earlier list. The judgment integrator folds their branches in.

## E30

The build fixed 9 of the 10 ruled hits on `fabrikalfa/effect-e30` (head `2cf58c1`). The 14 ruled
entry-point lines raise TS377000 "directive has no effect" while strictEffectProvide is off. My
call, inside your ruling: the lines stay, and the lock lands with them in the one judgment sweep PR.
For `bundle.ts:92`, a tests step makes `build-assets.integration.test.ts` provide the Path layer as
the caller, then the build drops the provide. Then one Opus review judges `plant.ts:52` and the
`dev.ts`/`hands.ts` entry-point reading. Running now.

E35 is done at `a1968b7`: 678 hits met, 47 of 47 box tests, lint green. One call for you: keep or
drop the `id-denylist` disable at `drive.ts:1485` (in `.agents`). Its reason is in the slice's row.

## Anti-slop

The count is on main at `9186e6c49`: 23,626 hits in all, 579 of them in PR 1366's files.
`require-readable-spacing` has 15,791 hits. It is the only rule with an autofix, so it goes in the
mechanical PR (`fabrikalfa/antislop-mechanical`, still running).

The other 11 rules leave 7,254 hits outside PR 1366's files. A slice for every rule and package
would make about 200 slices, most of them tiny. So I cut **29 slices**, each one rule over a group
of packages, at most about 300 hits per slice, with packages kept whole:

| Rule | Slices | Hits |
|---|---|---|
| max-ternary-depth | 1 | 142 |
| require-safety-comment-for-type-assertion | 4 | 972 |
| no-unknown-parameters | 3 | 678 |
| no-unknown-returns | 1 | 133 |
| no-runtime-typeof | 2 | 549 |
| no-unknown-type-aliases | 1 | 3 |
| no-unsafe-dictionary-type | 1 | 280 |
| no-manual-tagged-construction | 6 | 1,803 |
| no-manual-tagged-type | 1 | 155 |
| no-manual-tag-comparison | 8 | 2,291 |
| prefer-effect-match | 1 | 248 |

Branches are `fabrikalfa/antislop-<rule>-<n>`. Each is a coordinator with Opus steps (tests,
build, review). No PR and no lock line; the integrator folds them into
`fabrikalfa/antislop-judgment`. Two of the rules (`no-unknown-type-aliases` and
`no-unsafe-dictionary-type`) are not loaded by main's `.oxlintrc.json` yet. 0563's amendment says
the owner took them, so their slices load them only in a scratch config. I start them in waves as
capacity frees. Say if you want the cut changed.

## The rulings digest (Effect judgment slices E26 to E79)

Below is the digest job's whole report. It is read from the field rows only, and no checker was
re-run. Some of it your earlier rulings already settled: E30's entry-point lines (Q1), and lock
timing (Q2) by the call above.

# Effect-sweep digest for ticket 1075: open owner questions, slices E26–E79

**Scope.** I fetched 66 of the requested 68 branches. `fabrikalfa/effect-e45` and `-e46` do not exist, and `-e60` and `-e63` to `-e74` were outside the request. I read the field rows each slice added under `field/runs/`. Commit heads are in the table below, and the full run notes (the "why" and "note" fields) are in the rows on each branch.

**No row:** E38 added no run row, only its commit ("341 hits", branch head `ee56fee`). I did not review its diff.

**Weak spot:** the rulings below are my reading of the rows. I did not re-run the checker on any branch.

## Summary: the rulings that settle the most

1. **Entry-point disable line** (Q1). Settles 14 or more lines in E30 and E58, and the class in E50, E29 and E54.
2. **Lock timing** (Q2). Settles the TS377000 failure in E30, E29, E50 and E54.
3. **Test-only classes** (Q3). Settles roughly 1,500 hits across E32, E41, E43, E56, E78 and E50.
4. **No-install `.mjs` files** (Q4). Settles about 195 hits across E31, E33, E34, E36, E47, E49 and E35.
5. **Lint rule versus checker clash** (Q5). This is E32's two clashes. It also settles the E31, E34, E36 and E47 `no-raw-try-catch` fallout.
6. **Disables a slice added or proposes** (Q6).
7. **Product design calls** (Q7).
8. **Split requests and other notes** (Q8).

Branch heads (`git rev-parse --short`):

| Slice | Head | Slice | Head | Slice | Head |
|---|---|---|---|---|---|
| E26 | 9b1caa6 | E27 | 9f9e60d | E28 | d7c1ae1 |
| E29 | 74cf479 | E30 | 2cf58c1 | E31 | 8f7b341 |
| E32 | 6b1bbfc | E33 | e6b94d5 | E34 | a72da39 |
| E35 | a1968b7 | E36 | c3b78fb | E37 | eb64719 |
| E38 | ee56fee | E39 | 78bea64 | E40 | 18b14ed |
| E41 | 73c538f | E42 | 0765059 | E43 | df235a1 |
| E44 | c954b22 | E47 | e0d91fd | E48 | 84154d8 |
| E49 | 6771bed | E50 | 4ca111e | E51 | e9b7d7d |
| E52 | 967a653 | E53 | 2d257ba | E54 | e52281c |
| E55 | 9a9c5c7 | E56 | 01f01aa | E57 | 5ca6c60 |
| E58 | b2816ad | E59 | cf2ce80 | E61 | 1dd7406 |
| E62 | d45c79c | E75 | 2483820 | E76 | 2639f4d |
| E77 | 36b5ff2 | E78 | 75058f2 | E79 | c18e222 |

---

## Q1. Entry points: may a reasoned disable line stand where the code is a real entry point?

The checker's own message for `strictEffectProvide` says: "If this is an entry point, you can safely disable this diagnostic." Today the sweep allows no disable. Slices handle the same class three ways.

| Slice (head) | Where | What it did |
|---|---|---|
| E30 (`2cf58c1`) | 14 lines: 8 exam entry points (`commits.ts`, `compiler.ts`, `edges.ts`, `promise-types.ts`, `ratchet.ts`, `twin.ts`, `fixtures/next/p19-launchd/brain.ts`, `exam/plant.ts:52`) and 6 app entry points (`build.ts:15`, `dev.ts:110` and `:181`, `hands.ts:109`, `settings-generate.ts:29`, `src/entry/browser.tsx:26`) | Added `// @effect-diagnostics-next-line strictEffectProvide:off -- entry point: "…"` above each, as "the ruling" says. |
| E58 (`b2816ad`) | `oxlint-plugins/parallel.ts:163`, a `NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)))` | Left it. A probe showed the `-- reason` tail is accepted and takes the count to 0, but no disable is allowed yet. It waits on this ruling and on E0 (`no-bare-disable` learning the reasoned line, law L4). |
| E50 (`4ca111e`) | `.agents`: 15 script entry points | Left them. Also 13 law edges where Vitest runs a law with its layer. |
| E29 (`74cf479`) | 28 `preferEffectArray` hits inside Playwright `evaluate`, `evaluateAll` and `waitForFunction` callbacks, where `effect` is not loaded | Left them. The right form is the checker's own next-line comment, which "lands with the judgment lock pull request". |
| E54 (`e52281c`) | 9 `newPromise` hits inside `page.evaluate` in `instance.visual`, `reload.visual` and `tuval key.laws.visual` | Kept as `newPromise:off -- this runs inside the browser page, where Effect is not loaded`. A lock was added in the fix round. |
| E27 (`9f9e60d`) | 21 `preferEffectString` hits inside Playwright `evaluate` bodies | Left them. |
| E44 (`c954b22`) | 2 `padStart` calls in a `page.evaluate` | Left them. |

Options:

```ts
// A. Reasoned checker comment, one line per entry point (E30 and E54 already do this)
// @effect-diagnostics-next-line strictEffectProvide:off -- entry point: "If this is an entry point, you can safely disable this diagnostic."
NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)))

// B. Change the call so the checker does not fire. Where the provide is moved
//    onto the program, the rule's own fix is "the caller provides".
main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)

// C. Turn the check off by glob for entry files in tsconfig. This is a bigger
//    change and needs the check's own file glob to be read first.
```

- **E30's lean:** option A, and the lock must land with, or before, the 14 lines (see Q2).
- **E58's lean:** option A, together with E0 teaching `no-bare-disable` the reasoned `@effect-diagnostics` form.
- **E54's lean:** option A, with the lock, for browser-page code.

## Q2. Lock timing: does the lock land with the slice, or only in the one lock pull request?

`@effect-diagnostics-next-line X:off` is reported as `warning TS377000: directive has no effect` while check X is off in the tsconfig, and that makes `tsc` exit 1. Three slices hit it:

- **E30:** 14 lines fail `next/apps/fabrika`'s typecheck (6 added by the build, 8 added by the tests step at `c752a59`). `exam/plant.ts:52` also fails `oxlint-plugins`' typecheck. The row says "Only the lock line makes those lines take effect, so the lead must decide whether the lock lands with this slice or the 14 lines wait for it."
- **E50:** the same warning blocked 28 entry and edge hits. They wait for the lock pull request.
- **E54:** review 1 sent the slice back because the 9 ignore lines failed `tsc` with no lock. The fix round added `newPromise` at error under the `@effect/language-service` overrides in three package tsconfigs: `next/apps/fabrika` (`e2e/**/*.ts` only), `next/packages/tuval` and `next/packages/libfabrika`. Review 2 passed it, and `pnpm typecheck` exits 0.

E54 is the only slice with a lock, and the owner's no-lock ruling for judgment slices does not cover it.

```jsonc
// A. Lock lands with the slice (E54's shape), in the package tsconfig
"plugins": [{ "name": "@effect/language-service",
  "diagnosticSeverity": { "strictEffectProvide": "error" } }]
// B. Lines wait: remove the disable lines from the slice, add them in the lock PR
```

**Related open point:** E49's review has a finding, "lib:runtime reached zero and was not locked". That folder needs a lock decision too.

## Q3. Test-only classes: is a class that the check was not made for ruled out of the lock, or does it take lines, or does the check go off for tests?

Decision 0565 says "counted and reported for the owner, not bulk-fixed". These classes are stopped on that rule.

| Slice (head) | Check | Count and class |
|---|---|---|
| E30 (`2cf58c1`) | `strictEffectProvide` | 757 hits in 129 test files (`*.test.ts`, `*.test-support.ts`, `*Test.ts` suites). Each law builds a fresh layer from its own test state, so each test is its own entry point. `it.layer` would share one layer across tests and break isolation, and `Layer.build` plus `provideContext` only hides it from the checker. The ruling puts them outside the lock. |
| E50 (`4ca111e`) | `strictEffectProvide` | 28 laws that hand a call its own fake world on purpose (`Incident.test.ts` 14, `walk.test.ts` 9, `Freeze.test.ts` 2, `BoxTest.ts`, `clauderow.test.ts:114`, `mutbox.test.ts:1040`). "Go back to the owner as one class." |
| E41 (`73c538f`) | `anyUnknownInErrorContext` | 220 exam hits left: 205 are 0565's false-alarm class (a shared suite or law helper whose parameter takes an effect of any error). Plus 9 rooted in other slices' product types (`lib:runtime Entry.ts`, `lib:cloudflare` settingsWire, `control`, `ConnectionService`, `projectLayer`; E82), 4 from an untyped dynamic `import` of Alchemy, and 2 rooted in `.agents` `BoxTest.ts`. Product left: `box/BoxTest.ts:268, 307, 359` (plus `box.rm.test.ts:8, 10`) and `access/SessionSenders.ts:58` (needs `cloudflare/bindings.ts:202` typed first). |
| E43 (`df235a1`) | `missingPipeableSignature` | 154 exam hits, all "outside what the check is made for": 72 test helpers and shared suites, 53 CI scripts, 11 lint helpers, 11 exam programs, 4 `Schema.decodeUnknownOption` constants, 2 equivalence helpers, 1 test `Layer` constructor. 135 product hits are also left (see Q7). |
| E56 (`01f01aa`) | `extendsNativeError` | 6 hits, all test files, none changed: `libfabrika/src/cloudflare/platform.test.ts:15`, `cloudflare/supervision.laws.integration.test.ts:34`, `ledger/LedgerSpans.integration.test.ts:584`, `node/dev/supervision-spans.integration.test.ts:216`, `telemetry/Sink.integration.test.ts:1169`, `apps/fabrika/src/runtime.laws.integration.test.ts:985`. Each is a class made on purpose to stand for a foreign, untagged throw. `Data.TaggedError` would add a `_tag`, and `Sink.ts` `summary()` swaps a tagged error's message for its reason word, so the law would fail. |
| E78 (`75058f2`) | `asyncFunction` | 626 left, by class for the owner: A 265 (vitest or fast-check callbacks that want async; 186 of them wrap `Effect.runPromise` and could become `it.effect` one by one, 160 in `.integration.` files), B 210 (stand-ins for Promise-returning platform interfaces such as Durable Object storage and RPC stubs, fetch, `vi.mock` factories), C 132 (Promise helpers of real-instance harnesses, 130 in `.integration.`), D 18 (`Effect.promise(async …)` in `.integration.`), E 1 (`runtime/Program.test.ts:1016`, `:1015` at the head, an async function a program declaration must refuse). |
| E32 (`6b1bbfc`) | `asyncFunction` | 436 left (see Q5). |
| E39 (`78bea64`) | `schemaSync`, `schemaSyncInEffect` | 28 exam hits wait on product contracts, not a ruling: `syncTest` bare `encode` and `decode` (17), `windowMachineFor`'s never-called `decode` option (7), E81 (4). |

Choices for any of these classes:

```ts
// A. Class is outside the lock. The check stays off for these paths, by glob.
//    "plugins": [{ "name": "@effect/language-service",
//                  "ignore": ["**/*.test.ts", "**/*.test-support.ts", "**/*Test.ts"] }]
// B. Reasoned line per hit (753 or more lines for E30 alone: not recommended).
// C. Fix by code. E30 says it.layer or Layer.build only hides the problem, and
//    E56 says Data.TaggedError makes the law stop testing a foreign throw.
```

**Leans.**
- E30: the 757 are outside the lock.
- E56: choose between "six reasoned ignore lines and a lock" and "the check off for test files". It also notes its own row's `ended` time, 20:52:00, is after its commit at 20:50:52, so it is not a real reading.
- E43: one-argument signatures or `Function.dual` are the only ways to quiet a hit, and that changes an API nobody pipes.
- No other slice gave a lean.

## Q4. The `.mjs` files that run on the runner's bare Node, before any install

`changes.mjs`, `required.mjs`, `scheduled.mjs` and `gitignore.mjs` in `.github/ci/` run before `pnpm install`, so they cannot import `effect`. Every slice that touches them leaves the same hits and calls it "an owner design call".

| Slice | Check | Left |
|---|---|---|
| E31 (`8f7b341`) | `preferEffectArray` | `gitignore.mjs` lines 15, 25, 25 (3). Needs "an ignore line or narrower glob there" in the lock PR. |
| E33 (`e6b94d5`) | `preferEffectString` | 37 hits in three `.mjs` files. |
| E34 (`a72da39`) | `preferEffectArray` | 61 hits: `changes.mjs` 21, `required.mjs` 5, `scheduled.mjs` 35. "An owner design call." |
| E36 (`c3b78fb`) | `preferEffectRecord` | 9 hits in the three `.github/ci` `.mjs` scripts. |
| E47 (`e0d91fd`) | `globalConsole`, `globalConsoleInEffect` | `changes.mjs` 1, `required.mjs` 2, `scheduled.mjs` 2, `gitignore.mjs` 1 (6, plus 1 in `program-package-layout.test.ts`). |
| E49 (`6771bed`) | `processEnvInEffect`, `processEnv` | `changes.mjs` 5, `required.mjs` 1, `scheduled.mjs` 1 (7). |
| E35 (`a1968b7`) | `preferEffectArray` | No `.mjs` left (see Q6). |

The rows contradict each other on one point. E34's own review says `scheduled.mjs` has 35 hits, and E47 says 2 `globalConsole` hits in the same file. That is not a conflict, because each is a different check.

```js
// A. Ignore the four .mjs files in the language-service config for these checks
//    "ignore": [".github/ci/*.mjs"]
// B. Bootstrap install first, so the .mjs files may import effect.
//    Cost: CI's first jobs wait on install. Needs a design call.
// C. Port the four scripts to .ts and run them with a TS runner after install.
//    The same "install first" cost.
```

No slice gave a lean. E34 and E47 call it an owner design call.

## Q5. Clashes: the checker versus our own lint rules (blocking rules)

| Slice | Clash | Count |
|---|---|---|
| **E32** (`6b1bbfc`), `asyncFunction`, 682 hits, all exam. 246 fixed, 436 left. | **(1)** 168 `fc.asyncProperty` predicates that "wait on the 0579 move" (plus 16 `it` bodies that run an Effect inside one). **(2)** 111 tests that `await` a Promise API in folders where `fabrika/no-effect-promise` blocks (the first try gave 152 blocking lint lines). **(3)** 19 async `describe` callbacks, and helpers, platform callbacks, CI scripts and hooks "whose fix is not clear in this slice". | 436 |
| **E33** (`e6b94d5`), `preferEffectString`, 676 hits, 447 fixed. | 37 in three `.mjs` files (Q4). 104 in 14 files where importing `effect` turns on the blocking `no-raw-try-catch` rule at a native `try`/`catch`. 82 in `effect-jsdocs.ts`, a port of Effect's own code whose header lists every change from upstream for the next bump's diff. 6 others: two `matchAll` (Effect's type drops the match index), an `indexOf` with a start position, two function replacers with real logic, one optional chain in a template. | 229 |
| E31 (`8f7b341`), E34 (`a72da39`), E36 (`c3b78fb`), E47 (`e0d91fd`) | `no-raw-try-catch` wakes on a file once it imports `effect`. E31 added 7 reasoned disables (see Q6). E34 turned 11 blocks into `Result.try`. E36 left 42 hits in 11 files. E47 turned them into `Effect.try` and a typed error, and left `program-package-layout.test.ts` 1. |, |
| E36 (`c3b78fb`) | Also: 11 hits where `Record`'s types do not fit the value (an AST node, a service class, a `Partial` record, `unknown` narrowed to object, a key outside the narrowed type). | 62 left in all (9 `.mjs`, 42 try/catch, 11 type) |
| E47 (`e0d91fd`) | Cost seen: an `effect` barrel import adds about 250 ms per start of a short script. `oxlint-plugins/exact-versions.test.ts`, which starts the script 56 times, went from 7.75 s to 21.7 s. With subpath imports it took 12.4 s, which the barrel form that call 2 sets for tooling would refuse. |, |

Questions for the owner:

- **E32.** Does `fabrika/no-effect-promise` yield where the test only waits on a Promise API, or does the check go off there? E32 says `lib:settings` "cannot reach zero before the owner rules on the two clashes".
- **E32.** Does fast-check's `asyncProperty` get an exception for `asyncFunction`, or does the move 0579 describes land first?
- **E33.** Does `no-raw-try-catch` count an import of only `String` or `Array`, or fire only when `effect` code runs in the same function? E31 raised this question and E33 repeats it.
- **E33.** Does `effect-jsdocs.ts` (82 hits) get an ignore, since it is a port with an upstream diff header?

```ts
// no-raw-try-catch option A: the rule skips a try/catch in a function with no Effect in it.
// option B: the file gets one reasoned disable (E31's shape, see Q6).
// option C: turn the try/catch into Effect.try or Result.try (E34, E36, E47 did that,
//           which is a code change in a plain script).
```

## Q6. Every disable or ignore line a slice added, left, or proposes

| Slice (head) | Line | File | Status |
|---|---|---|---|
| E30 (`2cf58c1`) | `@effect-diagnostics-next-line strictEffectProvide:off -- entry point: "…"` | 14 lines, see Q1 | Added, and typecheck currently fails on all of them. |
| E31 (`8f7b341`) | `oxlint-disable … fabrika/no-raw-try-catch` | `lint.ts:92`, `stylelint.ts:31`, `exact-versions.ts:108`, `workspace-reach.ts:125`, `program-package-layout.test.ts:125`, `program-package-layout.ts:282` and `:525` | Added. "The review judges these, or whether the rule should not count an import of only Array." |
| E35 (`a1968b7`) | `oxlint-disable-next-line eslint/id-denylist -- the quest's state file keeps today's key, and flow/host.ts reads it` | `.agents/skills/lead/scripts/drive.ts:1485` | Added in `f236a40`, in place of the `agents-ledger.json` row the edit pruned. It guards the `why:` state-file key and is "left for the lead's read". The same file has two older lines of the same rule at `:583` and `:656` ("today's outcome shape, as outcomesOf writes it"). |
| E47 (`e0d91fd`) | `edge comment for no-cause-squash` (`chain.ts`) and `edge comment for no-effect-run-outside-edge` (`gc.ts`, `Effect.runSync` because gc is sync from start to end and gcloop stops it with SIGTERM) | `.agents` | Added. |
| E49 (`6771bed`) | none added. Left as hits: `Depth.ts:30`, which is read at load, "where a run needs an edge comment the owner reads". Also `mutbox.test.ts` 1 and `p14.test-support.ts` 3, read at collection or load. |, | Needs an edge comment. |
| E53 (`2d257ba`) | `oxlint-disable-next-line fabrika/no-redacted-value` kept above `Redacted.value` | `BrainControlLaunchd.ts:134` | Kept, not new. |
| E54 (`e52281c`) | `@effect-diagnostics-next-line newPromise:off -- this runs inside the browser page, where Effect is not loaded` | 9 lines: `e2e/instance.visual.test.ts` 147, 154, 163, 206, 226; `e2e/reload.visual.test.ts` 120, 139; `tuval src/browser/key.laws.visual.test.ts` 153, 161 | Added, with the lock. |
| E56 (`01f01aa`) | Proposed: six reasoned ignore lines plus a lock, or the check off for test files | six test files, Q3 | Owner's call. |
| E58 (`b2816ad`) | Proposed: the reasoned entry-point line | `oxlint-plugins/parallel.ts:163` | Waits on E0 (`no-bare-disable` learning it, law L4) and on this ruling. |

## Q7. Product design calls the slice could not make

**E30** (`2cf58c1`), build step.
- 9 of the 10 hits the ruling names are fixed. `Headless.ts` now uses `Layer.build` in the owning Scope, and `watch.ts` and `OpenRepository.ts` use the new plain value `Id.Generator.make`.
- **Left:** `next/packages/libfabrika/src/node/build/bundle.ts:92`, `Path.Path.pipe(Effect.provide(Path.layer))`. The checker's fix (the caller provides `Path`) changes `bundle`'s requirements. `build-assets.integration.test.ts` runs it with `Effect.runPromise` and nothing provided, and Effect exports no plain `Path` value.
- **Not in the ruling and not fixed:**
  - `instance.ts:62`, `:63` and `runtime.ts:57` in `next/apps/fabrika/src`.
  - In libfabrika: `cloudflare/runtime.ts` (907, 911, 920, 945, 958, 1242, 1260, 1273, 2416), `cloudflare/SettingsInput.ts` (53, 91), `cloudflare/SettingsRecorded.ts:43`, `cloudflare/SettingsStartsLedger.ts` (145, 146).
  - `gateway/Gateway.ts` (406, 420), `runtime/Built.ts:35`, `runtime/ProcessStore.ts:194`, `runtime/Runner.ts` (516, 529).
- **Choices for `bundle.ts:92`:** a new plain `Path` value from `libfabrika`, or let the caller provide it and give the integration test a layer, or a reasoned line (Q1). E30 gave no lean here.

**E53** (`2d257ba`), `missedPipeableOpportunity`.
- Hit: `next/packages/libfabrika/src/codehost/CodeHost.ts:62`.
- The check asks for `Path.pipe(Schema.Array, Schema.NullOr)` where the code has `Schema.NullOr(Schema.Array(Path))`. The build and the review both call it a false alarm.
- It is left with no ignore and no lock. "Needs a ruling before `lib:codehost` can be locked for this check."
- On 0565's false-alarm count, E53 reports 1 of 22 wrong, 4 style only, 17 right. That is far from the "about half wrong" 0565's read found.

**E55** (`9a9c5c7`), `deterministicKeys`, row outcome `parked`, 14 hits.
- 0575 step 1 was proved by running the checker. `keyPatterns` cannot give our dot form, so IDs take the checker's default (`@kampus/libfabrika/ledger/Ledger/Doorbell`, `Doorbell`, `…/Ledger/Doorbell`).
- The checker's default `skipLeadingPath` is `src/`, already the source folder of libfabrika and the app, so no tsconfig option is needed there. The row says the 5 `.agents` hits are "product files outside `service-id`'s folder, left for the build". It says nothing about `skipLeadingPath` for `.agents`, so I would not assume `.agents` takes the same default.
- The 3 app hits (`Wire`, `World`, `SpinSample`) are fixed.
- **Blocked on timing:** renaming a libfabrika ID (`Ledger.Doorbell`) makes the lint rule `service-id` fail at `Ledger.ts:55` and `service-id.test.ts`'s replay law go red. The brief keeps `service-id` until E93, and 0575 forbids a gap between the two.
- **Left:** 2 exam hits (`ci/CiTest.ts:38`, `codehost/CodeHostTest.ts:52`) and 4 product hits (`Id.ts:152`, `access/SessionManager.ts:164`, `ledger/Ledger.ts:55`, `processes/Mailbox.ts:30`).
- **Question:** may `service-id` and `deterministicKeys` swap together in one pull request, or does E93 (the `service-id` retirement) land first?

**E49** (`6771bed`), `processEnv` and `processEnvInEffect`. 5 product hits left:
- `chain.ts:1868` (the pin variable) and `drive.ts:1160` and `:2123` (`PATH`, `DRIVE_MINUTES`) sit in plain synchronous code, where `Config` needs an `Effect.runSync`. That breaks `fabrika/no-effect-run-outside-edge`, and `agents-ledger.json` refuses a new entry.
- `Depth.ts:30` is read synchronously at load. It needs an edge comment "the owner reads", as the tests step left `p14` and `mutbox`.
- `dev.ts:74` writes `DO_NOT_TRACK` for Alchemy's telemetry check, which reads `process.env` itself. `Config` cannot write a variable.
- There are also 32 exam hits left. The 3 `.mjs` files (7) are Q4. The rest are `field-check.ts` 4 (the `effect` import would trip `no-raw-try-catch`), `mutbox.test.ts` 1, `p14.test-support.ts` 3, and 18 that set and restore a variable a child or the code under test reads (`chaos-revoke` 8, `one-file` 5, `BrainControlLaunchd L10` 4, plus 1).
- It also needs a lock decision for `lib:runtime` (Q2).

**E43** (`df235a1`), `missingPipeableSignature`. 135 product hits left, by class:
- 86 lead tooling scripts, 11 `Layer` constructors, 4 comparators or equivalences, 10 app, program and window helpers, 3 test-tooling functions, 21 libfabrika functions.
- The libfabrika functions are constructors, symmetric, fold or update steps, or handle-first, or sit in `internal/`. The review lists 31 of them in the slice's libfabrika folders (`Id.ts:124`, `access/AccessFold.ts:45`, `ci/Ci.ts:64`, `client/Keys.ts:112, 134, 144`, and others).
- E43 ran `Function.dual` for 16 exported functions and changed no caller. The review confirmed no function had an optional argument except `Layout.rects`, whose dual decides by a predicate on the first argument.
- **Class table the owner can rule on one at a time:** lead tooling scripts (86), `Layer` constructors, comparators or equivalences, handle-first or symmetric functions.
- The review notes its commit trailer: every commit on the branch carries a `Co-authored-by` trailer for Claude added by the commit script. "Noted, not fixed."

```ts
// missingPipeableSignature, one choice per class:
export const f = Function.dual(2, (self: A, b: B) => …) // A. dual: pipeable, API unchanged for data-first callers
export const f = (self: A) => (b: B) => …              // B. curried: breaks callers
// C. check off for the class (lead scripts, Layer constructors, comparators)
```

**E41** (`73c538f`), product hits left: `.agents` `box/BoxTest.ts:268, 307, 359` and `libfabrika access/SessionSenders.ts:58`. Both follow from Q3 and are blocked on another slice's folder (`lib:cloudflare`, E82).

**E48** (`84154d8`): 35 `globalDate` and `globalDateInEffect` product hits are "left for the build". No ruling needed. The 2 `.visual.` laws changed (`page-runtime`, `resources`) were not run.

**E32 detail** (`6b1bbfc`): the "three rulings, 436 hits" the brief asks about are Q5's three items for the 436. The row itself names two clashes and lumps the rest as "not clear in this slice".

## Q8. Split requests, lock changes and other notes

**E42** (`0765059`), `nodeBuiltinImport`. 320 hits in 14 folders. 38 fixed, 282 left, and the slice is deliberately incomplete: "whole folders not reached in this run".
- Left on purpose, 6 hits: `lib:transport` 2 (`Sshsig.test-support.ts:4-5`) and `lib:processes` 2 (`Process.test-support.ts:4, 6`), where `no-promises` refuses a top-level `await` and the fix reshapes every caller; and `prog:counter` 2, where `next/programs/counter` has no `@effect/platform-node` dependency and adding it changes the lockfile.
- **Split by folder, as the slice implies:** not reached are `lib:node` 44, `app:exam` 50, `app:e2e` 19, `oxlint-plugins` 83, `.github/ci` 51, `.agents` 21 in exam paths plus 8 product. It looks like the slice needs to be cut into per-folder slices. The row does not say so outright.
- Question: may `programs/counter` take `@effect/platform-node` as a new dependency?

**E61** (`1dd7406`), `preferNamespaceImport`, decision 0577.
- It changed `.oxlintrc.json`. The three settings `no-restricted-imports` rules now accept `effect/**` subpaths (`"!effect/**"` added to the groups). They also ban `effect/Layer`, `effect/ManagedRuntime` and `effect/ScopedCache` where the old ban named `Layer`, `ManagedRuntime` and `ScopedCache`.
- **Question:** is that rule change fine to land inside a judgment slice? The row calls the lock line an "owner change", and it does not state whether the `.oxlintrc.json` edit needs the owner's yes.
- 1,217 hits in the folders (the plan said 1,215). 1,044 fixed. 3 left on purpose: `cloudflare/control.ts:9`, `cloudflare/readers.laws.test.ts:13` and `cloudflare/SettingsRuntime.ts:8`. Laws spy on a mocked barrel object, which a module namespace cannot be, so those laws "need a new seam first".
- 170 hits wait on pull request 1366.

**E26**, **E28**, **E29**, **E30** and others opened draft pull requests before the coordinator ruled that judgment slices open none. E26 (PR 1482), E28 (PR 1489), E31 (PR 1486), E34 (PR 1487) and E39 (PR 1493) all say they were "left as is". The owner may want those closed or folded into `fabrikalfa/effect-judgment`.

**Recurring ruling-like items that are not owner rulings:**
- **Missing tooling in the box.** `ssh-keygen` and Playwright's Chromium are absent, so `box.test.ts`, `commits-git-*` and the `.visual.` tests fail at setup. This is not caused by any slice, and most rows installed `openssh-client` and passed.
- **E32 and E47:** `--changed origin/main` is refused locally because it is a full run.
- **E51:** 9 hits in `lib:runtime` wait for E98 (`Runner.integration.test.ts` is a 1366 file).
- **1366 waits:** E61 170, E62 216, E75 99, E76 34, E77 48, E78 128, E79 91.

## What this digest cannot tell you

- Counts are from the rows. I did not re-run the checker, and some rows' counts differ from the plan's: E30 775 vs the plan, E40 360 vs 358, E42 320 vs 321, E61 1,217 vs 1,215.
- I read only rows named for each slice. Branches also carry earlier slices' rows (`t1062-*`, the findings), which I did not read.
- E27 was a recovery run after an earlier session was stopped with no row. E27's 138 product hits are for a build step.
- E38 has no row.
- The user's brief called E32's rulings "three"; the row calls them "two clashes" (Q5). I show the three classes behind the 436.
- The "E55 `.agents` hits with `skipLeadingPath`" in the brief: the row does not mention `skipLeadingPath` for `.agents` (Q7).
