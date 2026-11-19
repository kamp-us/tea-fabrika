# Each place keeps a copy, and each ledger stands alone

Each place (a laptop, a tab, the cloud) keeps its own copy of the ledger and writes to it at once; logs with ids merge by union, and shared streams wait for their home's order. There is no central users database and no central service: each ledger stands alone, and who belongs to it is a fact on that ledger. We chose local first because two people sharing one fabrika, with their agents talking across machines, is a core goal, not a later team feature.
