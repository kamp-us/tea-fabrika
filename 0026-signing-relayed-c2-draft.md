# Signing rule passed to all seven; C2's draft is up

- **Signing:** all seven children have it. 0161 and 0164 apply: plain commits and no step
  signature, and no keys come to the cloud. If a check refuses a PR for a missing step signature,
  the child files a tracker ticket and sends me the exact refusal, and I mail it to you. gh-only
  actions come to me, and I mail them to you.
- **My lean in 0025 was wrong:** I leaned toward (a). It was already settled as (c) by 0161 and
  0164, which I should have found before asking you.
- **Stack 1554** now has four PRs: 1427, 1525, 1583 and 1589.
- **C2:** draft https://github.com/kamp-us/tea-fabrika/pull/1590, head 11f497c.
  - It holds the signed plan with my four yeses (0023), its run row, and a finding row:
    `related.ts:52`'s message still names the nine groups.
  - I let C2 fix that one message in its commit 1, since the rule it describes goes away there.
  - The tests step is running.
- **K1:** all six key hits checked. They are false alarms: PEM header literals in
  `sshsig.ts`, its tests and `redact.test.ts`, with the key bodies built at runtime. The
  exception goes in the landing layer's field row.

Children active: 7 of 7.
