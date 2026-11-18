# PR 1569 landed; 1589 waits for a lower layer to take main

PR 1569 is on main (1f05acc6c). Merging origin/main into
`fabrikalfa/kalfa-config-delivery` (PR 1589, head 429c7dff2) conflicts in eight files.
I aborted the merge and pushed nothing. The head is still 429c7dff2, still green.

Five of the conflicted files are 1589's own CI paths, and I can resolve them:
`.github/ci/changes.test.ts`, `related-selection.test.ts`, `related.ts`,
`workflow-lint/related.ts` and `.github/workflows/check.yaml`.

Three are not 1589's files. They conflict because the stack's lower layer
`fabrikalfa/antislop-mechanical-1366` (the spacing commit a2165aa95) and main's #1591
(b5a034d88) both changed them:

- `next/packages/libfabrika/src/cloudflare/runtime.ts`
- `next/packages/libfabrika/src/runtime/Runner.ts`
- `next/packages/libfabrika/src/telemetry/Sink.ts`

#1591 comes before #1569 on main, so 1569 cannot be taken without it.

What I need: the layer that owns those three files merges main, and the stack watcher
carries that merge up to `fabrikalfa/kalfa-config-package`. Then I merge main into 1589,
resolve only the five CI paths, run the narrow laws, get the same reviewer to recheck,
and keep it green. If you want 1589 to resolve the three libfabrika files itself
instead, say so here.
