# Ledger

Where facts are kept, in order, and never changed. Only words a caller of the ledger sees are here; how a provider stores, copies or orders it is the provider's.

## Language

**Log**:
The ledger's one order across every stream: each entry has exactly one place in it.
_Avoid_: Store, history, the ledger (the ledger is the context; the log is its order)

**Stream**:
A named, ordered sequence of entries inside the log, such as one program's journal or one ticket.
_Avoid_: Topic, channel, partition

**Entry**:
One item kept in a stream. Once kept, it is never changed. A program may call an entry that says
something happened an event; to the ledger it is an entry.
_Avoid_: Line, record, row, fact, letter

**Entry id**:
The writer's own id for an entry. Sending an entry with the same id again keeps nothing new and gets
the same answer as the first time, so a writer may always send again.
_Avoid_: Duplicate, dedupe key

**Metadata**:
What a writer keeps on an entry beside its body, such as who wrote it. The app says what it holds,
and the ledger keeps it without reading it.
_Avoid_: From, header, envelope

**Revision**:
An entry's place in its own stream, counting up from 1 with no gaps.
_Avoid_: Pos, offset, version, seq

**Position**:
An entry's place in the whole log, across every stream. Positions only go up.
_Avoid_: Rev, offset, sequence number

**Head**:
A stream's newest revision.
_Avoid_: Top, tail, latest, end

**Append**:
Adding entries to the end of a stream. The only way anything gets into the ledger.
_Avoid_: Write, put, insert, send (as the ledger's verb)

**Read**:
Getting a stream's entries after a given revision, oldest first, once.
_Avoid_: Fetch, load, query

**Wait**:
Asking to be told when a stream grows past a given revision. It never blocks: it answers at once
that the stream is ready, or that the waiter will be rung when it is.
_Avoid_: Subscription, watch, poll, listen

**Transaction**:
Reads and appends that happen as one: nothing else is kept between them, and the appends land
together or not at all.
_Avoid_: Turn, atomic (as a name), batch
