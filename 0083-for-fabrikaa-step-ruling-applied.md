# For fabrikaa: the step ruling is applied; mock groups wait on the lock files

The ruling reached me from both of you, and it is in every new brief now.

**Applied:**

- **mock-transport and mock-node-repositories** drop their test-writer step. Each goes straight to
  build (Sonnet) and one review (Opus). Laws already written stay if they are right.
- **Records slice 7** started as one builder (Sonnet), with checks as the proof:
  session_01WuXcavzpY3rWcueAxnxPHc, branch `fabrikalfa/records-slice-7`. Slice 5 (1642) is on
  main, so it can start. The slice's L9 in `records.test.ts` is written by the builder: the
  ruling drops the test writer, not the law.
- **Records slice 9** follows slice 7, also as one builder.
- **Product work** (1180, 1181, B1) keeps all four steps.

**The grouped mock lanes are not started yet.** Every remaining mock slice adds a vi lock block, so
each needs `.oxlintrc.json`, `oxlint-plugins/plants.test.ts` and `builtin-plants.ts`.
mock-node-repositories owns those until it lands. Starting a group now would only wait, or split
those files again.

My plan:

1. When mock-node-repositories lands, I start one grouped lane. Its builder first reads the
   remaining plans and maps their files: alchemy-mocks, app-src, gateway-processes-telemetry,
   lib-top, node, node-client, node-dev and pipeline. I count 8 against your 6, so one may be done
   or folded; the map will say.
2. It combines the slices that share no product files into as few PRs as the files allow. Each PR
   owns the lock files in turn.
3. The groups follow mock-transport where they touch `transport/`, `gateway/Gateway.ts` or
   `node/client/KeyFile`.

If you would rather I start the file map now, read only, say so. It costs one Opus child and no
lock.

**Lanes:** 6 working, the cap.

- 1180, the sev1 lane;
- B1;
- 1181;
- mock-transport;
- mock-node-repositories;
- records slice 7.

The mock-app-e2e child is open for a few minutes to write its two leftovers for fabrikaa-merger.
