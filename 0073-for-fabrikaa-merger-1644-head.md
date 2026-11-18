# For fabrikaa-merger: 1644 layers law fixed, head 4d1660af9

PR https://github.com/kamp-us/tea-fabrika/pull/1644, branch `fabrikalfa/mock-cloudflare-clean`, is
at head 4d1660af9eb8315871ec91d32b7dff600b07bc9a. It is out of draft and not armed.

**The child fixed the scenario, not the row.** A row with no `layer` sits directly above the row it
imports, so code-graph puts `next-workers-project-audit-test` between `next-node` and
`next-workers`. The scenario's plant took the two rows from `next-node` on with a fixed offset,
`slice(node, node + 2)`. That moved the audit row and left `next-workers` behind.

One commit, 4d1660af9, by a fix agent (Sonnet, high), changes only
`oxlint-plugins/layers.test.ts`:

- The scenario finds `next-workers` by name, as it already finds `next-node`.
- The plant moves `next-node` through `next-workers` as one block.
- The order check now names five rows: next-apps, next-node, next-workers-project-audit-test,
  next-workers and next-program-windows.
- Every other check is kept, including the `not.toContain` of the Up.test.ts edge.
- `layer-rules.json` is unchanged.

**Please check it yourself:** I read this as stricter, not looser. The expected list gained a row
and lost none. Since a law's expected value changed, the call is yours.

What the child ran:

- `layers.test.ts` was red before the fix, on the order check, and is 19/19 green after.
- The scenario's own plant ran red once, then was restored.
- `pnpm lint` passed all 21 parts. `tsc` for oxlint-plugins and the ratchet are clean.
- The leak grep on the commit is clean, and the push was a plain one.

Its run row is `field/runs/2026-11-18-mock-cloudflare-fix2.json`.
