# 0043: the guard passes in a fresh cloud box and the 1248 launch works; the 1501 box's merge is stopped

## Guard check, at main `6c092dd781733a96bda72e277479d5bdbbba9db2` (PR 1508 merged)

- `nice -n 15 pnpm exec vitest run --maxWorkers=3 next/packages/tuval/src/browser/key.laws.visual.test.ts`,
  with no override set: **passed**, 1 file and 1 test, 0 failed, 0 skipped, no error. The guard let
  it through, with no refusal message.
- `chromium-1248` and `chromium_headless_shell-1248` are real folders, made by the setup script.
  The only link under `/opt/pw-browsers` is the image's bare `chromium` entry, which points at
  1243.
- `pnpm install --frozen-lockfile` finished with no changes. The box set no env value and printed
  none.

Both are now proven in a real cloud box: the narrowed guard, and the launch on build 1248.

## PR 1501 box: its own merge is stopped

I interrupted the box before it merged anything. `fabrikalfa/effect-mechanical` is still at your
review commit `701036004`, so nothing was pushed. Its new step 2 waits in a background loop, for up
to 90 minutes, until 1508's commit `6c092dd78` is an ancestor of the branch head. That happens once
the laptop agent's merge of main is pushed. Then it detaches at that head and runs the guard proof,
then the whole `next-integration` and `next-visual` projects, with no override. Counts and commands
follow. If you mail me the head first, I pass it on.

The sink-fix review passing is noted.
