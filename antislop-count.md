# Count the anti-slop hits, per rule and per package (read-only)

PR 1373 (the anti-slop install) is on main. Read decisions 0560 to 0563 (and 0563's amendment),
0566 and 0567, `oxlint-plugins/README.md`'s anti-slop section, and `.oxlintrc.json`'s anti-slop
blocks. Then, on origin/main, count every hit of every taken anti-slop rule (and any rule 0566
adds, such as `no-unsafe-dictionary-type`, if it is taken on main), with the rule forced to
`error` everywhere in a scratch copy of the config outside the repo (never edit the repo's).

Output one table, rule by package: `next/packages/libfabrika` (and its `src/` module folders,
since a slice may be a module), `next/packages/tuval`, `next/packages/vitest`, each
`next/programs/*`, `next/apps/fabrika`, `.agents/`, `oxlint-plugins/`, `.github/ci/`. For each
cell: hits, hits in PR 1366's files (`pull_request_read` get_files 1366), and whether the rule
has a safe autofix that `pnpm format` (`lint.ts --fix`) applies. Write the table to your RESULT
only; commit nothing. Name the command you used, so a recount is the same.
