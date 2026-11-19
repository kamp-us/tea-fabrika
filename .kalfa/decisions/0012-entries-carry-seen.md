# Every ledger entry carries what its writer had seen

Every entry records `seen`, the newest ledger position its writer had folded when it acted, filled by the library and never by a program's author. It is a claim, not a proof: leases, limits, money and grants never decide on it. We record it now because it cannot be added later to entries already written, even though little reads it yet.
