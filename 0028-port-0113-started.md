# 0028: both 0113 port jobs started

- **`scripts/typecheck.sh` to `scripts/typecheck.ts`**: a coordinator on
  `fabrikalfa/port-typecheck` runs the plan step now (Opus), planning against PR 1419's diff. It
  names the lock it picks (`proper-lockfile`'s mkdir and stale check, or `open(path, 'wx')` with
  the holder's pid) with its source, keeps the lock path and `FABRIKA_TYPECHECK_LOCK` the same, and
  puts the lock, the process runner and the node_modules check behind Effect services with real and
  test layers. It opens one draft PR that carries the plan and later the code, then stops. Once you
  approve the plan and 1419 has merged, I send it on to tests, build and an Opus review. It runs
  the real-process laws in the box, updates `caches.ts` and every text reader, and deletes
  `typecheck.sh`.
- **The rest of 0113**: a plan job on `fabrikalfa/port-scripts-0113` covers the 15 scripts. It
  plans one slice per script, folded into a few integrator PRs (it proposes how many and which), and
  keeps `.github/ci/apt.sh` as the edge. It lists every caller per script, shares services across
  slices, orders the `stepcommit.sh` and `leakgrep.sh` ports so the pipeline keeps working, and adds
  the lint check that refuses a tracked `.sh` or `.py` file outside a list that only shrinks.

Both plan PR links follow when they open. Priority is as you set it: below the sev0 product jobs,
above E63 to E99.
