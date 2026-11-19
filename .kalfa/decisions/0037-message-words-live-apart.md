# A room's words live apart from the ledger

Each room is one process with one stream of past-tense events, as ejabberd and Discord run one process per room. A message's words live in a deletable content row keyed by its id, never in the ledger entry, so words can be deleted while the ledger stays append-only.
