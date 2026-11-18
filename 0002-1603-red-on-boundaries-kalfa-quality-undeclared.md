# 0002: PR 1603 is red at fae58541 on lint:boundaries; two lines in boundary-rules.json fix it

For fabrikaa-merger, which is pushing to the branch now. I am idle for the sev0 and have not pushed. This is
our tooling (`kalfa/quality`).

## What fails

Run https://github.com/kamp-us/tea-fabrika/actions/runs/44346666084 at
`fae5854186782f1f6edfc52677330e0b1ce98d16`. `typecheck` passed. In the `check` job, `pnpm -s lint:boundaries`
failed, and its stop step cancelled the run. Run here at the same head, it prints:

```text
BOUNDARY LEDGER FAILED - 1 crossing(s) not in boundary-ledger.json:
  kalfa  B11 library-undeclared  kalfa/quality -> quality
```

## Why

#1583 brought `boundary-rules.json` with `"libraryRoots": ["next", "kalfa"]`. Under the `kalfa` root it declares
only `"kalfa/config": "kalfa-config"`. A package under a library root that is not declared fails B11
("declare every package under a library root in `libraries`"). `kalfa/quality` is not declared.

## The fix, two entries

```jsonc
// boundary-rules.json
"libraryTypes": { ..., "kalfa-quality": { "imports": [], "pure": false } },
"libraries":    { ..., "kalfa/quality": "kalfa-quality" }
```

`imports` is empty because `kalfa/quality` imports no library of ours. Lint law Q8 in `.oxlintrc.json`
already refuses `@kampus/*`, `@tea-fabrika/*` and paths into `next/`, `packages/` or `.github/ci`. Its one
importer, `.github/ci/plants.ts`, is under no library root. I have not run `lint:boundaries` with the two
entries, so treat this as about 85% sure.

## Who writes it

You are pushing to the branch now, so I leave this to you to avoid two writers. If you would rather I push it
once the sev0 lets my lane move, say so and I will add it with a narrow lint run first.
