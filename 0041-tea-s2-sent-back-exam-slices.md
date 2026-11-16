# 0041: tea slice 2 build sent back to tests; exam-to-lint slices running

## tea slice 2: https://github.com/kamp-us/tea-fabrika/pull/1431, `fabrikalfa/tea-s2` at `2a248bac`

**Tests step**, at `fc97e96`:
- It added law K2c in `runtime/MsgKey.test.ts`, modeled on 966's `tagged-union-machine.test.ts`. It
  is a property test over both engines across a restart from saved State, and two plants turned it
  red.
- It left out 966's "old type-keyed row is dropped" half, because we import no `@demlik/tea/do`
  and K3 already covers our old row.
- While it ran, the branch was rebuilt on new main. The step cherry-picked onto `669dc97` and
  fast-forwarded, with no force push.

**Build step**, sent back:
- The adapted 966 script renamed 480 lines in 66 files. By hand: 1,675 lines in 69 files and 10
  docs.
- 36 `fabrika/no-hand-tag` ignores, where the plan expected about 20.
- `Mail.Reply` is flat, with `Schema.is(Mail.Reply)`, and there is one queue port per reply kind.
- **The 966 patch is built but not committed.**
  - It comes from demlik's tea at 0.27.0 (`052e865`) plus 966's source change, built with tsup and
    mapped to 0.27.0's chunk names: 584 lines in 57 dist files.
  - `stepcommit.sh` refused it, rightly: patches and the lockfile are exam paths, so the tests step
    owns them.
  - It exists only in that container, so the tests round commits it first. I told it so.
- **966's patch renames more than ours did:** tea's semantic events, the engine phase and
  `saveStatus`, the extension envelope, the durable-effects log, the JSDoc examples, and the Sub id
  hash input. Both keep `type` on ContentPart, MediaSource, TraceBreadcrumb, MinimalEvent and Jev.
  K1, K2, K2b, K2c, K3 and K9 are green on it.
- **Laws the build calls wrong**, sent to tests:
  - Tezgah L11;
  - WindowMachine L9 and L10;
  - `stepFault.test-support.ts:36`, which spreads `_tag: "arm"` into `Model.cases.armed.make`;
  - RunnerRecovery P34, whose Tag has no boom case;
  - handsDelivery D1;
  - `Runner.integration.test.ts`, which calls `Msg.members` on a TaggedUnion (lines 446, 969, 1093);
  - `Chunk.test.ts` L1, where the build is 80% sure the law is wrong.
  Plus type errors in 16 test files.
- **One plan deviation for the reviewer:** Runner keeps writing `<cmd>_ok` and `<cmd>_err` under an
  ignore, against the plan (75% sure). It holds no defs, `AnyCmdDef` has no ok or err makers, and
  `bad_cmd` has no def. I left it for the review to judge.

**Ran:**
- unit: 64 changed law files, 552 of 558 passing;
- neighbor files: 15, with 73 of 75 passing;
- integration: 50 files and 697 tests, red only in Runner.integration, chaos.laws and
  instance-wire (no ssh-keygen in that box);
- `pnpm lint`, the ratchet and loosening (0 hits) pass;
- one `pnpm typecheck` is red on test files only.

Those integration runs started under the old override rule, before it was withdrawn; nothing has
set it since.

**Now:** a tests round. It commits the patch and the lockfile first, then fixes the listed laws and
type errors, each changed law red under a plant first. A build follows only if product code must
change. It stops before review, as you briefed.

## Exam to lint: https://github.com/kamp-us/tea-fabrika/pull/1504

The plan is approved: `plancheck --approved` exits 0 at `262d4dc`.
- The tests steps for slices A, E and F are running, on `fabrikalfa/exam-to-lint-a`, `-e` and
  `-f`.
- B starts after A, because it builds beside A's moved `promise-types.ts`.
- C waits on 0580's slice 1, and D waits on C and PR 1496.
- 1508 is not on main yet, so guarded laws are listed as "not run: 0178 guard".
