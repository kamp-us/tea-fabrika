# 0124: the typecheck port's second amendment is ready to sign; the build fix round is in

## The build fix round, pushed at `1d209964c`

- **Breaking a dead `.break`:** `breakStale(breaker)` breaks a dead `.break` under its own `.break`,
  recursively. It passes the inner answer through, so a live `.break.break` reads busy and sleeps.
  The coordinator is 85% sure of that behavior.
- **Removing a `.break`:** only while it names this process, through `removeIfOurs`, which `release`
  shares.
- **Comments:** the wrong comment is gone.
- **The 8 product `_tag` sites** now use `Predicate.isTagged`, `Seen.match` and its guards,
  `Liveness.match`, and `Listing`'s guards.
- **Laws:** N7 is green, and its plant, which puts `fs.remove(breaker)` back, is red.

| Check | Result |
|---|---|
| `typecheck.test` | 5 green |
| `typecheck-lock.test` | 4 green |
| integration | 7 green |
| caps | 29 green |
| the scripts package's tsc, and one `pnpm typecheck` | both exit 0 |
| `loosening.sh` over `0df871b21..HEAD` | 0 hits |
| lint | red only on the 4 zero-lock lines, which the amendment covers |

## The amendment, for re-sign

The plan commit is `32f247db5`, merged with the build into branch head `7c7a4f9a4`.

- **plancheck:** `--draft` passes on an unsigned copy, with plan-sha256
  `a58db1a88a8c54f04c5f27e0a82a225934e0fc1656515ce5787496fb555ef1da`.
- **leakgrep:** clean over `origin/main..7c7a4f9a4`.

**Your condition, the count.** It was taken read-only at `0df871b21`: all ten anti-slop rules over
`scripts/`, giving 207 hits.

- `no-manual-tag-comparison` fires on 7 of the 8 known lines. The eighth, `LocksFile.ts:19`,
  compares against a parameter, which the rule does not see.
- It also fires on **3 unplanned lines outside the port:** `scripts/effect-arbitrary.test.ts:72`,
  `:90` and `:132`.

**So the scope is only the port's four globs, not `scripts/**`:**

- `folders()` and `ROOTS` in `oxlint-plugins/anti-slop.ts` gain the four globs.
- The lock then asks for 28 new zero-hit entries in other rules' blocks in `.oxlintrc.json`.

**New laws,** all owned by the tests step, because they sit on exam paths:

| Law | Kind | Plants |
|---|---|---|
| L8 | a test in `oxlint-plugins/anti-slop.test.ts` | drop the globs from `folders()` |
| L9 | the lock itself | drop them from `ROOTS`; remove one of the 28 entries |

**The `_trylock` cite** is fixed to lines 298 to 343.

**One call for the owner, at 85%.** 0563 names `.agents`, `.github/ci` and `oxlint-plugins` as our
tooling. The plan treats `scripts/typecheck*` as tooling too. The other `scripts/` files stay
outside the lock, so the 3 lines in `effect-arbitrary.test.ts` are left as they are.

## PR 1523 is on main

It landed at `a00c7228a`. After your re-sign, the order is:

1. Tests: L8, L9, the 28 entries and `anti-slop.ts`.
2. The merge of main, once. `named()` is resolved toward 1523: keep the pipe wait, and drop the
   named-ready file and its second `until()` poll. That goes in a build row.
3. The proof run.
4. The same reviewer's recheck.
