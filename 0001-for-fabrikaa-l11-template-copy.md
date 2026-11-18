# For fabrikaa: L11 template copy, measured in one cloud box

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1616, branch `fabrikalfa/l11-template-copy`, head `f01509788b1e3e9022442497d63f6fee55cd83e5`. The law is in `next/`: `next/apps/fabrika/src/start-child.laws.integration.test.ts`. Plants from the throwaway branch `fabrikalfa/l11-template-copy-plants`, which nothing pushed to.

## The answer

- **Times.** On main (`84f51f8017e1d1a00b36f85dd1856f11b661da9b`) the law **fails here: it hits the 60 s test cap** (vitest reports 60018 ms; wall 64.5 s). Rerun with `--testTimeout=600000` it passes, with about 66 s of test time (wall 69.9 s). On the PR branch it **passes, with about 57 s of test time** (wall 60.2 s). So one run each says the PR saves about 9 s, or 14%, and leaves the law **within about 3 s of the 60 s cap** on this box.
- **Inventories.** Cold and template give the **same inventory, statement by statement, in all 16 flows: 901 cuts each.** Cold against cold and template against template are the same too. **Drift is 0** in both walks, in all five diagnostic runs: every cut threw at the statement the inventory named.
- **Plants.** **Both plants turn both walks red, with the same leaks.** The reply plant: 59 leaks in each walk, all to `reply`, and the two lists are equal line for line. The span plant: 172 leaks in each walk, all to `span`, equal line for line. Each plant was run twice, with the same result.

## Times

The law's own time comes from vitest's report where it printed one, and otherwise from "tests N%" of the file's duration. The walk times inside the diagnostic runs come from the walk's own `L11DIAG <walk> ms` line. Every run: Node 26.13.0 (the repo's pin), `FABRIKA_TEST_DEPTH=full`, `nice -n 15`, `--maxWorkers=1`, a fresh `pnpm install --frozen-lockfile` at the checkout, one run at a time.

| Run | Result | Law time | Wall time |
|---|---|---|---|
| main, as asked | fail: test timed out | 60018 ms (vitest) | 64.5 s |
| main, `--testTimeout=600000` (added, not in the brief) | pass | about 66 s (97% of 68.41 s) | 69.9 s |
| PR branch | pass | about 57 s (97% of 58.64 s) | 60.2 s |

Inside the diagnostic runs, where both walks run in one process, one after the other (template first):

| Commit, run | Template walk | Cold walk | Template as a share of cold |
|---|---|---|---|
| diagnostics `d0eee07e6` | 46.7 s, pass | 64.5 s, pass | 72% |
| reply plant `8485747d1`, run 1 | 45.8 s, fail | 55.1 s, fail | 83% |
| reply plant, run 2 | 58.2 s, fail | 70.0 s, fail | 83% |
| span plant `3232378da`, run 1 | 50.0 s, fail | 71.1 s, fail | 70% |
| span plant, run 2 | 57.7 s, fail | 72.2 s, fail | 80% |

The cold walk is the walk main has. In four of the five runs it took more than 60 s. The template walk took 46 to 58 s.

## Inventories, cold against template

From the diagnostic run with output on (`L11DIAG ... compare`):

```text
L11DIAG cold-vs-cold allSame true
L11DIAG cold-vs-template allSame true
L11DIAG template-vs-template allSame true
L11DIAG cold-vs-settled allSame false
L11DIAG template inventorySize 901
L11DIAG template perPath {"fresh":109,"saved":31,"already":27,"ended":27,"recovery":157,"migration":138,"configuration":42,"exit":131,"status":27,"isLive":27,"info":27,"resolve":27,"receive":28,"object":27,"read":21,"append":55}
L11DIAG template cuts 1369
L11DIAG template reached 901
L11DIAG template remaining 0
L11DIAG template driftCount 0
L11DIAG template leakCount 0
L11DIAG cold inventorySize 901
L11DIAG cold cuts 1369
L11DIAG cold reached 901
L11DIAG cold remaining 0
L11DIAG cold driftCount 0
L11DIAG cold leakCount 0
```

The cold walk prints the same `perPath` counts. Every flow matches in length and in each statement.

One thing does differ, and the PR does not use it. A template taken **after the boot's deliveries settled** (one pause) gives the same lengths, but its `recovery` flow differs from cold at position 46: cold has `INSERT INTO dev_descriptors (process,value) VALUES (?,?) ON CONFLICT(process) DO UPDATE SET value=excluded.value`, and the settled template has `process.descriptor`. The diagnostic prints only the first difference, so how many later positions differ is not known. The PR's template is taken at boot, and that one matches cold exactly. Taking the template later would change what recovery cuts.

## The plants

The leak lists of the two walks were compared in full, not just by count: nothing is only in the template walk and nothing is only in the cold walk.

**Reply plant** (`projectStorage` keeps a defect's text in `LedgerError`'s message): 59 leaks per walk, all `-> reply`. By flow: recovery 27, migration 21, configuration 4, fresh 4, saved 3. The 13 statements:

```text
17 SELECT value, pending FROM dev_descriptors WHERE process=? AND pending>0
 8 SELECT process FROM dev_descriptors WHERE process=?
 8 INSERT INTO dev_descriptors (process,value) VALUES (?,?) ON CONFLICT(process) DO UPDATE SET value=excluded.value
 6 SELECT value FROM dev_descriptors WHERE process=?
 5 INSERT OR IGNORE INTO dev_descriptors (process,value,pending) VALUES (?,?,2)
 3 UPDATE dev_descriptors SET pending=0 WHERE process=?
 2 CREATE TABLE IF NOT EXISTS dev_descriptors (process TEXT PRIMARY KEY, value TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0)
 2 PRAGMA table_info(dev_descriptors)
 2 CREATE TABLE IF NOT EXISTS dev_clients (client TEXT PRIMARY KEY, connection TEXT NOT NULL, session TEXT NOT NULL)
 2 CREATE TABLE IF NOT EXISTS dev_starts (id TEXT PRIMARY KEY, request TEXT NOT NULL, hash TEXT NOT NULL)
 2 SELECT process FROM dev_descriptors WHERE pending>0
 1 ALTER TABLE dev_descriptors ADD COLUMN pending INTEGER NOT NULL DEFAULT 0
 1 INSERT INTO dev_descriptors (process,value,pending) VALUES (?,?,?)
```

**Span plant** (`projectStorage`'s tracer keeps `fab.ledger.code`): 172 leaks per walk, all `-> span`. By flow: exit 93, append 32, receive 8, info 7, isLive 7, object 7, resolve 7, status 7, read 4. The 19 statements:

```text
72 SELECT * FROM entries WHERE stream = ? AND rev > ? ORDER BY rev
29 SELECT name FROM sqlite_master WHERE name='entries'
11 transaction.begin
11 transaction.commit
 5 INSERT INTO quota_restored (id,rev) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET rev=excluded.rev
 4 SELECT coalesce(max(pos), 0) AS pos FROM entries WHERE stream = ?
 4 SELECT rev FROM quota_restored WHERE id=1
 4 SELECT * FROM entries WHERE rev > ? ORDER BY rev
 4 SELECT value FROM quota_accounts WHERE account=?
 4 INSERT INTO quota_accounts (account,value) VALUES (?,?) ON CONFLICT(account) DO UPDATE SET value=excluded.value
 4 INSERT INTO quota_entries (rev,account,bytes) VALUES (?,?,?)
 4 INSERT INTO entries (rev, stream, pos, id, "arrivedAt", "by", "for", "sentAt", seen, parent, "traceId", build, "_tag", body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 4 DELETE FROM rings WHERE stream = ? AND after < ? RETURNING "to", after
 4 SELECT * FROM entries WHERE stream = ? AND id = ?
 4 SELECT rev, "arrivedAt" FROM entries ORDER BY rev DESC LIMIT 1
 1 INSERT INTO quota_steps (name,message,account,bytes,settled) VALUES (?,?,?,?,0)
 1 SELECT rev FROM quota_entries WHERE rev=?
 1 SELECT coalesce(max(rev), 0) AS head, coalesce(sum(rev > ?), 0) AS lag FROM entries WHERE stream = ?
 1 SELECT * FROM entries WHERE stream = ? AND rev > ? ORDER BY rev LIMIT ?
```

The vitest failure for each red walk read: `L11: 901 storage operations were cut; storage text or metadata reached these outputs: expected [ …(59) ] to deeply equal []` (172 for the span plant). Both plants leave `row` and `log` at 0, so neither tells us whether those two outputs would catch a leak.

## How it was run, and what went wrong on the way

- The first try ran on the box's Node 22, and the test config refused every run (the repo pins 26.13.0). Node 26.13.0 was then downloaded from nodejs.org, checked against its published SHA-256 sum, and put first on `PATH`. Every number above is from Node 26.13.0.
- Vitest hides console output from passing tests when its output is not a terminal (its default becomes `silent: "passed-only"`). So the first diagnostic run passed but printed none of its `L11DIAG` lines. The three throwaway commits were run a second time with `--silent=false`. The inventory comparison and the second plant runs come from that second pass. The first plant runs printed their lines anyway, because their walks failed.
- Main's second run with `--testTimeout=600000` was added to get a real "before" time. The brief did not ask for it.
- No commit went to any code branch, no CI run was started, and the plants branch was not pushed to.

## What this cannot tell us

- **One box, one run each.** The box has 4 cores and was busy with nothing else, but the same walk's time moved by about 12 s between runs (the template walk took 45.8 s in one run and 58.2 s in another), and the runs got slower over the session. The 9 s saving between the main and PR runs is smaller than that spread. The steadier number is the share inside one process: the template walk took 70% to 83% of the cold walk's time in all five runs.
- **How fast CI is.** This box is not a CI runner. On this box the PR's law is about 3 s under the 60 s cap, and main's law is over it. A CI runner that is faster or slower moves both, and only CI's own times say how much room the law has there.
- **The law's own time on the PR branch is an estimate.** Vitest printed no time for the passing law, so the 57 s is 97% of the file's 58.64 s.
- **The settled template.** Only the first difference from cold is printed, so how much of recovery would change is not known. The PR does not take its template that way.
- **Row and log.** Neither plant leaks to `row` or `log`, so these runs do not show that the law catches a leak on those two outputs.
