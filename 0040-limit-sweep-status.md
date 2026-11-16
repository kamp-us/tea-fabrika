# 0040: after the usage limit, one line per job

I read every child session. Sixteen had stopped on the limit at about 06:21 UTC (FAILED). Each
was resumed with its context intact, told to check its pushed branch, relaunch any subagent that
died, and re-read the updated `step-rules.md`. Two named jobs had been idle on a send-back since
before the limit, and I had missed them: pipe slice 1 and kalfa config. Both got fresh
coordinators. Nothing was stuck PENDING except the old E45 continuation: its branch never existed,
so it was archived and E45 started fresh earlier.

Heads are the `fabrikalfa/` branch heads on origin at 06:26 UTC.

## Urgent named jobs

- **Quotas door-gap round:** done, `p34c-s4` at `d1ccceee9` (mail 0031). It waits on the same
  reviewer's recheck.
- **tea slice 2 build:** stopped, then resumed. `tea-s2` at `2a248bace`.
- **pipe slice 1:** restarted with a fresh coordinator. `pipe-s1` at `c2a965cc6`. The build sent it
  back to tests on 6 law faults:
  - all of `PipeTest.ts`: bad TypeIDs in its ids, and no reader wake after a writer's DOWN in its
    Node world;
  - P4's fallback walk;
  - F5's expected `decodes`;
  - F8, whose sample no string can satisfy;
  - four type errors, all in tests.
  Now: a tests fix round, where each changed law is shown red first, then build and review.
- **kalfa config slice 1:** restarted with a fresh coordinator. `kalfa-config` at `e9158fe6f`.
  The build is done and K1 to K5 are green. Now: a tests round for the planned import lines, plus
  the `App.test.ts` type errors at 356, 359 and 374.
  - **One call for you:** `Files.test.ts` "T753 L3" compares each `Reference.Row` exactly. K2 needs
    each row to carry its app, so its expected row needs an added
    `app: { name: "fabrika", list: "fabrika settings" }`. That is still an exact match, now with one
    more field, so it does not loosen the law. But it goes beyond plan rule F1, "import lines only".
    May the tests step add it? Until you answer, it stays red and listed.
- **PR 1462 box:** running, at `262c210b4`. `next-integration` is still in its 2-hour background
  run, and `next-visual` comes after.
- **PR 1501 box:** running, at `aefa65123`. It waits for 1508 on main, then merges main in and runs
  both projects.
- **1508 guard-check box:** running. It waits for 1508 on main.

## Plans and builds

- **0580 law options:** running, `law-options-0580` at `381f5ecdc`. Slice 1 is in tests.
- **0573 trusted rules:** running, `trusted-rules-0573` at `24efb38cd`. PR 1 is in tests.
- **Exam to lint:** stopped, then resumed. `exam-to-lint` at `262d4dcb5`. It waits for the signed
  commit.
- **Typecheck port:** stopped, then resumed. `port-typecheck` at `3b9934b21`. The one plan-only
  commit (Answered Q1 and Q2, 0113/0410/0033) is not pushed yet.
- **0113 sweep:** stopped, then resumed. `port-scripts-0113` at `c756f0224`. It waits for the
  signed commit; no slice branch exists yet.
- **Mock plans:** running, `mock-plans` at `6de2b17ca`. The last commit (no interim lock,
  `mock-fold`, the row end time, decisions named) is in progress.
- **Reflect rest:** running, `reflect-rest` at `b9b70587a`, the re-signed commit. Told to pull it.
  Slice 9's build is running, then its review.

## Anti-slop

- **Mechanical:** running, `antislop-mechanical` at `021330e42`.
- **Stopped, then resumed:**
  - `require-safety-comment-1` at `34b9210cd`;
  - `require-safety-comment-2` at `b927c77d6`;
  - `no-unknown-parameters-1` at `4d25b5292`;
  - `no-unknown-parameters-2` (no branch yet);
  - `no-unknown-parameters-3` at `9553b1086`;
  - `no-unknown-returns-1` at `2a7e15b79`;
  - `max-ternary-depth-1` (no branch yet);
  - `no-unsafe-dictionary-type-1` (no branch yet);
  - `no-manual-tagged-type-1` at `516d0bbc0`.
- **Running:**
  - `require-safety-comment-3` at `385edb5c9`;
  - `require-safety-comment-4` at `7c140d54c`;
  - `no-runtime-typeof-1` at `f977ab2bf`;
  - `no-runtime-typeof-2` at `d27180154`;
  - `prefer-effect-match-1` at `aadb211a7`.
- **`no-unknown-type-aliases-1`:** done at `7ac2e91c7`, reviewed. One hit waits on PR 1366.
- **Not started yet:** the 14 slices for `no-manual-tagged-construction` and
  `no-manual-tag-comparison`.

## Effect judgment

- **Done and reviewed:** E26 (`d11a67bfa`), E27 (`3a33e5720`), E35 (`a1968b74b`), E37
  (`eb64719ae`), E40 (`7a10b6213`), E41 (`bf84c995d`), E44 (`a86d65b71`), E49 (`6771bed41`), E50
  (`4ca111ea9`), E51 (`e9b7d7db5`), E52 (`967a65360`), E53 (`2d257ba70`), E54 (`e52281c1f`), E56
  (`01f01aa8f`), E57 (`5ca6c6096`), E58 (`b2816ad69`), E59 (`cf2ce80bb`), E61 (`3e47e1956`), E62
  (`d45c79c64`), E77 (`3114d982c`), E78 (`75058f221`).
- **E39:** tests done at `78bea6481`. Its build waits, since schemaSync waits on the product
  contracts by your ruling.
- **Stopped, then resumed:**
  - E30 at `218dac0d3`;
  - E31 to E34 reviews (heads `5a4cc79b9`, `248c916c2`, `e6b94d52c`, `a72da398a`);
  - E45, fresh (no branch yet);
  - E48 at `8000c1ed9`;
  - E75 at `e9bb0f215`;
  - the rulings round for E38, E42, E49, E50, E53, E56, E58 and E61.
- **E29 and E36:** their background step agents may have died at the limit. Both were told to
  check and relaunch: E29 at `836fbe24d`, whose review is running, and E36 at `c3b78fb4f`, whose
  build is running.
- **Running:**
  - E28 at `87f777c9a`;
  - E38 at `51d034f5b`;
  - E43, the dual-everywhere round, at `df235a1f6`;
  - E46 at `eb4e2e70e`;
  - E47 at `5b84da983`;
  - E76 at `ab6db0d22`;
  - E79 at `ea7ec8b72`.
- **Effect mechanical integrator:** done, PR 1501 at `aefa65123`.
- **Not started yet:** E63 to E74 and E80 to E99, still last in your priority order.
