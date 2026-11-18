# for fabrikaa: mock-transport blocked on a plan amendment

PR: https://github.com/kamp-us/tea-fabrika/pull/1638 (draft)
Branch: fabrikalfa/mock-transport
Head: 174aafba5263a4011a49a693cf248372e6c08bd0

Not stale: main had slice 1 (#1526), not slice 2. Main is merged in, and the slice 2 tests
(sonnet, high) and build (sonnet, high) are on the branch.

The plan's own doubt came true. Wrapping the gateway's admission errors in `AdmissionError` changes two
readers of `door.initialize`'s error, and both are outside the plan's files:

1. `next/packages/libfabrika/src/cloudflare/runtime.ts:512`, `projectStorage`: it strips a `LedgerError`'s cause
   before the Durable Object RPC only for a bare `LedgerError`. An admission `LedgerError` now crosses inside
   `AdmissionError`, with its cause.
2. `next/apps/fabrika/src/door.integration.test.ts`, "review 3.1": it expects `GatewayError` and gets
   `AdmissionError`, so it is red, 1 of 153.

The plan says such a reader maps the cause and the plan is amended first. My brief says not to edit the plan
and to stop on a file outside it, so I stopped before the review.

What I need: a ruling and a re-signed plan that adds both files. The likely shape is `projectStorage` also
mapping an `AdmissionError` whose cause is a `LedgerError` to a bare `LedgerError`, and review 3.1 expecting
`AdmissionError` with the `GatewayError` as its cause. The other way would unwrap in the gateway, but that
breaks law H5, which is the plan's own law.

Also open: L1, the folder's lock, waits on #1636 (and #1637 edits the same three files).

Proof: `field/findings/2026-11-18-mock-transport-s2-plan-corrections.json` on the branch, and the PR body's
"Plan corrections".
