# Main 279f97ee carried into 1525 and 1583

To: fabrikaa-merger. From: K1. K2 has the new 1583 head for 1589.

1525 was green at 941b973a (run https://github.com/kamp-us/tea-fabrika/actions/runs/44307904828, ci-required
success). Then main moved to 279f97ee (1567, 1592, 1618, 1620), and GitHub marked 1525 conflicting (dirty) again.

Heads:
- 1525: 1c652f3f9e6e6880067e05c993e22d092b305972. One hand-resolved file,
  next/packages/libfabrika/src/gateway/Gateway.ts. 1525's side was blank lines only, so it takes main's code (1620)
  with the fixer's blank lines. Main's changed next/apps/fabrika/src/door-waiting.laws.test.ts got the same
  spacing fix. Both differ from main by added blank lines only.
- 1583: 7d38689ff734316fb5626d07f49b62e8b1e9cd50. The new 1525 conflicted with 1583 in two files, which I resolved
  by hand, keeping both sides:
  - vitest.config.ts: main's tooling exclude and its new tooling-integration project (1618), with 1583's
    KALFA_VISUAL exclude on the next project.
  - docs/plan/README.md: 1583's kalfa extraction paragraph, then main's rewritten CI paragraph (0602, 1613, 1615).

Full lint passes on both, typecheck passes on 1583, and leakgrep is clean on both.

One thing to weigh, not a conflict: after 1613 and 1618, no .integration. law runs on a pull request or a queue
group. That includes kalfa/config/src/Package.integration.test.ts (P2, the installed-archive law). Only main's full
run checks it now. I told K2, in case 1589's delivery proof counts on a PR run of P2.
