# port-home fixture re-recorded on tea 0.29: done, but read the warning first

**Warning, a design call for the lead:** the re-recorded fixture fails two of the three reading
laws, and the old fixture passes all three on the same head. On `cee40ef0c` the old fixture
needs no re-record for these laws. Do not move the new one onto `fabrikalfa/tea-029-owed-tests`
until someone decides what to do. Details are under "Reading law results".

## What was made

- Branch: `fabrikalfa/port-home-fixture-029`, pushed, no pull request.
- Fixture commit: `1ed86b31ac240ebb6299ce2a874271ea85c07a91`. It is one commit on top of the PR
  head and changes only `fixtures/next/port-home/` (43 files: 27 modified, 9 deleted, 15 new,
  counting SQLite files with their `-shm` and `-wal` files).
- Built on the head of pull request 1619 (`fabrikalfa/tea-029-owed-tests`):
  `cee40ef0cee6b6bd37a34a0a99e8148cde678578`. Checked again before the push: it had not moved.
- Box: a cloud box (`CLAUDE_CODE_REMOTE=true`, Linux), where vitest.hostrun.ts allows
  `.integration.` laws. Node 26.13.0, the version package.json pins.
  `pnpm install --frozen-lockfile` ran clean. `TYPESAFE_API_KEY` was unset.
- Writer: `T502_PORT_HOME=write nice -n 15 pnpm exec vitest run next/apps/fabrika/src/port-home.laws.integration.test.ts --maxWorkers=1`.
  The header comment of that file gives the path as `port-home.laws.test.ts`. That name is out of
  date: the file is now `.integration.test.ts`. Result: 1 passed, 3 skipped (as designed), 12.1 s.
  The writer reopens what it saved from another folder, and that check passed too. Its own guard
  for machine paths found nothing.

## Msg key counts, before and after

These are byte searches over every file of the fixture, SQLite and WAL files included.

| Search | Old fixture | New fixture |
|---|---|---|
| `"type":"inc"` (Msg key) | 9 | 0 |
| `"_tag":"inc"` | 0 | 11 |
| Any `"type":` key | 30 | 26 |
| Any `"_tag":` key | 1458 | 1509 |

The 26 `"type":` keys left are not Msgs. 16 are OpenTelemetry span attributes
(`"fab.build":…,"type":"input"` and `"type":"process"`) in the Project and RecordPart WAL files.
10 are Cloudflare binding types in `.alchemy/state/fabrika/local/Brain.json`, such as
`durable_object_namespace` and `r2_bucket`. The old fixture had the same two kinds.

A read-only query over copies of the SQLite files read every cell of every table, both as JSON text
and as V8-serialized values:

- Old fixture: 14 files, 4,885 cells. `"type":"inc"` 2, `"_tag":"inc"` 0.
- New fixture: 16 files, 5,273 cells. `"type":"inc"` 0, `"_tag":"inc"` 2.
- In both, the V8 form with either key: 0.

`saved.json` has no `"type"` key.

## Reading law results

Each run is the same file without the write flag, `nice -n 15`, `--maxWorkers=1`, on `cee40ef0c`.

| Law | New fixture | Old fixture |
|---|---|---|
| The home saved before the slice opens with the same process table and the same entries | pass | pass |
| A home saved before the code store opens each process on this build's code (T833) | **fail** | pass |
| A checkpoint saved before the code store upgrades on this build's code (T833) | **fail** | pass |
| Run total | 2 failed, 1 passed, 1 skipped, 10.5 s | 3 passed, 1 skipped, about 10 s |

Why the two T833 laws fail on the new fixture: both are vectors that need a home saved by a build
from before the code store. The file says so in its comments: "only such a build can write a home
whose descriptors name code it never kept". A home written today cannot be that home.

- Law 2 expects the saved processes to be exactly `checklist:1` and `counter:1`
  (`port-home.laws.integration.test.ts:715`). Today's build also saves a `tezgah:…` process.
- Law 3 expects one `code.loaded` from `open` with `was` set, and one `state.upgraded` from v1 to
  v2 (`:888`, `:894`). It finds neither. The home was saved by a build whose counter checkpoint is
  already at what the law treats as this build's state.

So this one fixture is used for two jobs that no longer fit together. Law 5 wants "a home from the
build before this slice". The T833 laws want "a home from before the code store". Re-recording
breaks the second job. Options I see, none of them tried:

1. Keep the old fixture. On `cee40ef0c` it passes all three laws, so the `"type":"inc"` cells in
   it are not read in a way that fails. Whether it should hold old-shaped Msgs, as a record that an
   old home still opens, is the lead's call.
2. Split it into two fixtures: keep the old home for T833 and save a new home for law 5. That
   changes the laws, so it needs the tests step.

## Leak check

- `~/.fabrika/leak-words` was set up as the brief says.
- Deepened with `git fetch --deepen=200 origin main fabrikalfa/tea-029-owed-tests`. After that,
  `git merge-base origin/main HEAD` resolved to `84f51f8017e1`.
- `leakgrep.sh --commits HEAD~1..HEAD`: 1 commit read, added text clean.
- `git diff HEAD~1 HEAD | leakgrep.sh`: clean.
- Git shows SQLite files as binary, so leakgrep cannot read them. A byte-level search of every
  fixture file found no private word and no path from the home, root or temp folder: 0 files each.

## What this cannot tell us

- No CI ran (the sev0 is on), and no step-commit was signed.
- The fixture was written in a Linux cloud box, not on a Mac. The writer's own guard and the byte
  search found no machine path, but a Mac-only difference in what workerd stores would not show
  here.
- I did not find out why the old fixture's `"type":"inc"` cells do not fail law 5 on this build.
  It could be that nothing replays those inputs on open, or that something decodes the old shape.
