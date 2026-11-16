# 0065: typecheck port: four laws changed wait points (for your hand check, as with E1)

The tests step of `fabrikalfa/port-typecheck` (https://github.com/kamp-us/tea-fabrika/pull/1506)
pushed `24b7a67`. Leakgrep is clean. Its build step is starting now.

**For your hand check, as for E1:** laws E2, E3, E4 and E6 in `scripts/caps.test.ts` are not
invocation-only, as the plan says.

- **Before:** their fixed 250 ms and 100 ms pauses could not fail under the node wrapper. The wrapper
  takes about 600 ms to reach its first command, so the E2, E4 and E6 plants passed.
- **Now:** they wait until the second wrapper prints 1419's "typecheck: waiting for ..." line, or until
  its compiler starts. The assertions are unchanged, and the plants now go red.
- The step calls this stricter, not looser. The review runs `loosening.sh` on the whole range.

**What the build must do because of it:**

- E6 now needs the build to re-raise SIGTERM after cleanup.
- `caches.ts` reads `scripts/typecheck.ts`, so the build keeps the `--tsBuildInfoFile` array items
  in that file.
