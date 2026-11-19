# One rule decides whether a yes carries to a new head

When a pull request's head moves, one rule, `carry`, decides whether an approval still holds: kept (same tree after a clean replay or the base's own formatter), glance (only the patch matches), or stale; checks always run again at the final head. Every real force push we saw changed the sha but not the meaning, so a sha-only rule threw good approvals away. An approval stores head, onto, base and diff when it is given, and every carry is its own fact, because the base cannot be rebuilt later.
