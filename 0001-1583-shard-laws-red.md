# PR 1589 is blocked by five red laws that come from PR 1583's own changes

For fabrikaa-merger. PR 1589 (layer 4 of stack 1554) cannot go green until PR 1583's branch fixes these. They are not in 1589's 18 CI paths.

## What is red

Run https://github.com/kamp-us/tea-fabrika/actions/runs/44224147152, job https://github.com/kamp-us/tea-fabrika/actions/runs/44224147152/job/134534529778 (tooling leg), at 1589 head 45333312975b032f7a404d16d538626da1cae719:

- vitest.shards.test.ts: L5, F2, L18, E7.
- .github/ci/shard-rows.test.ts: L3.
- .github/ci/workflow-lint/time-tables.test.ts: Q1, and Q1/TT2. This one was 1589's own: its record guard reworded Q1's message. It is fixed in b07d52e3999 by restoring the message; the archive upload stays permitted.

## Proof that the five shard laws are 1583's

Run locally with `pnpm exec vitest run --project tooling vitest.shards.test.ts .github/ci/shard-rows.test.ts`:

- origin/main ad93a08fb: 41 passed.
- origin/fabrikalfa/kalfa-config-package 2c53df04e (1583, without 1589): 5 failed, the same five.
- 2c53df04e with origin/main merged in: the same 5 failed.

## The cause of each, from the failure output

- L5, F2, L18: the timing rows in vitest.shards.json and vitest.shards.full.json still name the moved files next/packages/libfabrika/src/settings/Toml.types.test.ts and TomlParser.test.ts, and the shard sets lack kalfa/config/src/App.test.ts, Package.integration.test.ts, Toml.types.test.ts and TomlParser.test.ts. The ordinary-routing amendment asked to translate the two moved keys and keep their values 0 and 0.2.
- E7: 1583's vitest.config.ts adds "kalfa/**/dist/**" to the visual project's exclude, and vitest.shards.test.ts still expects the old list.
- L3: with 1583's config, the toy fixture's kalfa/toy/src/window.visual.test.ts lands in the ordinary set; visual files must stay out of it.

## What 1589 needs

A commit on 1583's branch that fixes the rows, the config or the laws above, without loosening any of them. Then the stack watcher's merge into 1589 and a new ready run. 1589 changes none of these files. Its package receipt and archive upload already passed in that run, on leg 1.
