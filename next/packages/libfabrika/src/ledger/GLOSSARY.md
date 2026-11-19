# Ledger

The ledger is the project's one ordered record of entries, and the coordination built on it. Every
other context writes its facts here and reads them back. These words were settled with the owner on
2026-11-18, one at a time.

| Term | Definition | Not |
|---|---|---|
| Transaction | A group of entries written to the ledger atomically: all of them land, or none do. | Turn, atomic (as a name), batch |
| Journal driver | The ledger's implementation of tea's journal driver, one stream per program. The journal itself is Runtime's word. | Journal (as a Ledger word) |
| Revision | An entry's place in its own stream, counting up from the stream's first entry. | `pos` (today's code), version, offset |
| Position | An entry's place in the whole log, across every stream. | `rev` (today's code; it means position, not revision), offset, sequence |
| Entry | One item stored in the ledger, never changed or removed once stored. | Line, record, row, fact, letter, event (an event is one kind of entry) |
| Entry id | The writer's own id for an entry. Sending the same entry id again stores nothing new and gets the first answer back, so a writer may always resend. | Duplicate, resent (as an outcome) |
| Expected revision | The revision a writer says its stream is still at. The append is refused if the stream has moved past it. | Seen, last rev |
| Read | One-time fetch of a stream's entries from a revision onward. | Fetch, load |
| Subscription | A standing read that delivers each new entry of a stream as it is stored. | Wait, watch, tail, park |
| Stream | A named, ordered sequence of entries inside the ledger. | Topic, channel, log (the log is all streams together) |
| Head | A stream's newest revision. | Top, tail, latest |
| Sequencer | The one place that puts entries in order and gives each its position. | Referee, ledger server, project object, leader |
| Refusal | The ledger's answer when an append may not be stored: the expected revision is stale, or the writer may not write there. | Rejection, error (a refusal is an answer, not a failure) |
| Append | Adding entries to a stream. The ledger's only way in. | Write, put, insert, send (as the Ledger's verb) |
| New entry | What a writer hands to append: an entry before the sequencer gives it a revision and a position. | Line, draft, event data |
| Log | The ledger's one global order across every stream, the thing positions count along. | Store, history, the ledger (the ledger is the context; the log is its order) |

Not Ledger words: who may write where is Access's (the ledger asks, Access answers, and the ledger
only names the refusal); a stream moving to a new storage object (roll, seal) is the storage
provider's, and no stream sees it.
