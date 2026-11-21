# A severity's responses are written on the Ledger entry that sets the severity

When an incident is opened or its severity moves, Incidents writes that severity's responses, such as a hold, on the
same Ledger entry. The responses in force are read from those entries, never from the settings as they are now. We
chose this so the Ledger alone answers whether a hold is in force, so the write-up stays true after the settings
change, and so an edit to the settings cannot lift a running hold by accident.

## Considered Options

- Read each open incident's responses from the settings as they are now: rejected, because a settings edit during an
  incident would silently lift or add a hold, a reader of the Ledger could not tell what was in force without the
  settings of that day, and the write-up would change after the fact.

## Consequences

Editing a severity's responses changes nothing for an incident that is already open. To change what an open incident
makes others do, a person escalates, de-escalates or resolves it, and that is recorded. An entry written before a
response existed never gains it. A response named on an entry that no responder handles any more is refused when the
process starts.
