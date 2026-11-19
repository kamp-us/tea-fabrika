# A change stays in local git until review

The ledger holds only a change's commit hash, never the change, because the ledger syncs to other people's machines and code would leave before anyone reviewed it. Review reads that commit from the local repo, and what is pushed later is the very commit review read.

## Consequences

This is the aim for `next/`. Today's hand-run steps still push a backup branch after each step.
