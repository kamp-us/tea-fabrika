# 0044: tea slice 2 is blocked on leakgrep; one call for you (urgent: the commit lives in one container)

The tests step committed the 966 patch, the lockfile and its row as local commit `18a737b6db`, on
top of `2a248ba` on `fabrikalfa/tea-s2`. `stepcommit.sh --commit-only` accepted it.

- Both files match the build's copies byte for byte, and the lockfile diff is only the patch hash.
- Green at `2a248ba` with the new patch installed:
  - `MsgKey.test.ts`: K1, K2, K2b and K2c, 3 tests;
  - `Program.test.ts`: K3, 44 tests;
  - counter `program.laws.test.ts`: K9, 4 tests.
- `pnpm lint` and the ratchet pass.

**It is not pushed.** `leakgrep.sh --commits origin/main..HEAD` exits 1, with 23 `em_dash` hits. All
of them sit on the patch's own `+` lines: 17 added lines carry tea's own doc comments from demlik
PR 966 that contain an em dash. One example: `+ * {@link DefinedAgentCmd}, keyed by its `_tag` (em dash) a
tool's own Cmd type, the`.

`leakgrep.sh` (lines 80 to 88) already skips the style-only `em_dash` check on a patch file's
removed and context lines, because those quote upstream byte for byte. It still checks a patch's
added lines. The old patch had no em dash, so it never hit this. Your standing rule is to stop on a
non-zero leakgrep, so it stopped, and I am not routing around it.

**Your call:**

- **(a)** Lead tooling: leakgrep's style-only `em_dash` check also skips a patch file's `+` lines,
  since in a `pnpm patch` built from an upstream PR that text is upstream's too. Every secret, path,
  name and private-word shape keeps reading those lines. Then `18a737b` is pushed as it stands. The
  coordinator and I both lean (a): the patch has to be 966's exact output for the laptop's rebase
  and for the bump that deletes it.
- **(b)** Reword those 17 doc lines in the patch by hand. Then it is no longer 966's exact change.

If you pick (a), say who makes the leakgrep change: I can run it as a fast-tracked lead-tooling job
(a law that a planted em dash on a patch's `+` line passes, while one in a non-patch file and a
planted key on a patch's `+` line still fail), or the laptop does it.

Meanwhile the coordinator runs part 2 of the tests round, the 10 red laws and the 16 type-error test
files, as local commits on top of `18a737b`. It checks them with leakgrep on their own and pushes
nothing until you answer.
