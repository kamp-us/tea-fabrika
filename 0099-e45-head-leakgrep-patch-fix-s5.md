# 0099: E45's new head; a leakgrep fix for patch files; the 0113 S5 lead call; the refined ignore rule

## E45: a new head for layer 5

`fabrikalfa/effect-e45` is at `86cfd8270bd5f5d3db4b49e99a6e930ef09bfe4d`. It adds one run row,
`field/runs/2026-11-16-effect-e45-coordinator1.json`, and changes no code. The row records:

- E45 covers E90's folders: lib:runtime and app:src, 55 sites.
- The two lock globs: `next/apps/fabrika/src/*.ts` and `next/packages/libfabrika/src/runtime/**/*.ts`.
- The four pre-install `.github/ci` `.mjs` paths, for the lock's exclude.

Leakgrep is clean, and it took no main. Fold `86cfd8270` in place of `43c36a72c`.

## Tea slice 2 is still held, on a second leakgrep limit; a fix is started

Even with 1510, main's leakgrep exits 1 on commit `18a737b`: 8 `em_dash` hits. All are in one
file, `patches/@demlik__tea@0.27.0.patch`, inside that patch's own hunks, on `+ `, `+-` and `++`
lines alike.

- **The cause:** leakgrep numbers lines in `git diff --unified=0`, and its Quotes state resets at
  every outer `@@`. It marks a line as quoted only after it sees the patch's own `@@ ` header on
  an outer `+` or context line. Under `-U0`, git usually starts the outer hunk in the middle of one
  of the patch's hunks.
  - In 4 of the 8 cases, the inner header is not there at all.
  - In the other 4, the inner header appears only as a removed line, and Quotes never reads
    removed lines.
- **leakgrep already names this limit,** in its comment at main's lines 128 to 130. For a patch
  that is rewritten, it is the usual case, not an edge case.
- **The fix, as lead tooling, which is fast-tracked:** a coordinator is started on
  `fabrikalfa/leakgrep-patch-blob-quotes`. For a file under `patches/`, leakgrep decides whether a
  line is quoted from the new blob's own hunk structure, looked up by the new line number. It does
  not depend on where git cuts the outer hunks.
  - Laws red first, for a hunk that starts in the middle and for a header seen only as a removed
    line.
  - A plant shows that a real leak outside the patch's hunks still fails.
  - It opens one draft PR, then gets one review.
- **The ask: this is the second patch-line leakgrep limit, so it needs a tracker ticket.**

The tea slice 2 commits stay local until the fix lands on main. Then the box reruns main's
leakgrep and pushes.

## The 0113 sweep, slice S5: my lead call

The S5 tests step made two local commits. The first, `e14ccebc0`, holds made-up fixture disk paths
shaped like a real user's home folder, which gives 16 `machine_path` hits. The second,
`f9143b4c4`, renames them to a made-up root. leakgrep reads every commit, so the branch cannot pass as it is.

**My call:** a fresh branch, `fabrikalfa/port-0113-s05`, from `f074a55`, with the final files in
one commit. The bad commit never leaves the box, and nothing pushed is rewritten. The local branch
that holds it is deleted locally only.

Before S5's build, one plan commit adds:

- a Files row for `redact/RedactFs.ts`, the real layer (0095 keeps the contract free of layers);
- `--` before the command in `box.sh` and `runplan.sh`, because effect/cli refuses flag-like words
  after a positional;
- a law that pins the redacted count as a number. `drive.ts:1425` and `chain.ts:1395` record
  `Number("redacted N")`, which is NaN, so every row's `redacted` field is null today;
- a finding row: no law covers LockFs.

I will mail that head for your re-sign.

Integrator 1 (PR 1517) now holds S1 to S4, at `7c34253`. On it, 62 of 62 touched tests pass, lint
passes 19 of 19, and leakgrep is clean. `boxrm.test.ts`'s T318 laws time out at 5 s under load,
on the fold and at S1's head alike. The existing row `2026-11-11-catchup-cleanup-t318-timeout`
covers it.

## The refined ignore rule

It is in the step rules at `2d5ada593`, with your wording. A slice takes out an ignore line only
where TS377000 reports it, and a working line stays. In both cases the line goes in the row. The
17 coordinators are getting the correction now.

## Group 1

- `app-e2e-s1`'s L5 is pushed at `5abfe396b`:
  - two lock blocks over `e2e`, with the `VI_PROPERTIES` plant;
  - `plants.test` passes 255;
  - the EPIPE finding row is committed, with a fourth sighting.
- A small build round is fixing `next/AGENTS.md`'s "What lint holds" row, which still says the
  rule misses chained calls.
- `lib-top-s1`'s review is running.
