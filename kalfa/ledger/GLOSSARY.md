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
something happened an event; to the ledger it is an entry. Its tag (Shared names) says what kind
of entry it is.
_Avoid_: Line, record, row, fact, letter

**Entry id**:
The writer's own id for an entry, unique in its stream: the same id in another stream is another
entry. Sending an entry with the same id and the same body again keeps
nothing new and gets the same answer as the first time, so a writer may always send again. The same
id with a different body is refused.
_Avoid_: Duplicate, dedupe key

**Metadata**:
What is kept on an entry beside its body, such as who wrote it, in slots. The ledger keeps it
without reading it, and it takes no part in telling a resend apart.
_Avoid_: From, header, envelope, notes

**Slot**:
One named part of an entry's metadata, owned by one context, which alone says what it holds and
reads it back.
_Avoid_: Key, field, section

**Stamp**:
What a context adds to every entry on its way into the ledger: its own slot, filled in.
_Avoid_: Middleware (as the word), hook, decorator

**Revision**:
An entry's place in its own stream, counting up from 1 with no gaps.
_Avoid_: Pos, offset, version, seq

**Position**:
An entry's place in the whole log, across every stream. Positions only go up.
_Avoid_: Rev, offset, sequence number

**Head**:
A stream's newest entry, given as both its revision and its position.
_Avoid_: Top, tail, latest, end

**Append**:
Adding entries to the end of a stream. The only way anything gets into the ledger.
_Avoid_: Write, put, insert, send (as the ledger's verb)

**Read**:
Getting a stream's entries after a given revision, oldest first, once, all of them or only those
with given tags.
_Avoid_: Fetch, load, query

**Wait**:
Asking to be told when a stream grows past a given revision. It answers once the stream has grown,
at once if it already has.
_Avoid_: Subscription, watch, poll, listen

**Transaction**:
Reads and appends that happen as one: nothing else is kept between them, and the appends land
together or not at all.
_Avoid_: Turn, transact, atomic (as a name), batch

**Admission**:
A rule a package or the app adds that lets an entry in or refuses it, inside the append. Every admission
must let the entry in.
_Avoid_: Write policy, guard (a program's), validator, hook

**Remote ledger**:
The ledger as a client reaches it over a connection: append, read, wait and listing streams, and
no transaction.
_Avoid_: Far ledger, client ledger, proxy
