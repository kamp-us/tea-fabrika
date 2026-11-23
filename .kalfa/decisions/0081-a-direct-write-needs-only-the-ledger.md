# A direct write needs only the Ledger

Decision 0072 says every write command takes `--direct`, and decision 0075 says a direct write is finished entries built by a plain function from the message. A check of every write command against its design found that none fits: each needs the stream's current state, and three also need the code host. We decided that a write command takes `--direct` only when its entries can be built from the Ledger, the device's settings and the message, and that the plain function takes the state as well as the message. We chose this because a device has no host login and should not get one for this, and because one function used by both the program and the direct write keeps the two from drifting apart. The design ticket is https://github.com/kamp-us/tea-fabrika/issues/1875.

Six commands take `--direct`: Incidents' `declare`, `acknowledge`, `fix`, `resolve` and `learned`, and Delivery's `withdraw`. Three do not: Delivery's `ready`, and Reconciliation's `reconcile` and `adopt`.

The function is one per package, plain, with a named message type for each command:

```ts
// @kalfa/incidents
type Message = Declare | Acknowledge | Fix | Resolve | Learned

const entries: (
  set: IncidentSet,
  settings: Settings,
  message: Message,
) => Result<
  ReadonlyArray<Entry>,
  UnknownSeverity | IdReused | GroupOpen | NoSuchIncident | IncidentResolved
>
```

How each path uses it:

1. The program runs its guard, then calls the function inside its Ledger transaction and appends what it gives (since decision 0090, it reads, calls the function and appends once with an expected revision).
2. A direct write reads the stream over its `RemoteLedger` (decision 0076), folds the state, calls the function, then signs and appends. Nothing joins the read and the append, as 0076 already accepts.
3. A direct write runs every check the function makes. Only the program's guard is skipped.
4. A direct write reads the settings on the device, the usual way through Configuration.

## Considered Options

- A host login on the device, so all nine commands take `--direct`: rejected, because it is a new secret on every device, and `reconcile` writes to the host between two entries, so its entries are not finished before the write.
- A direct `ready` that skips the host's checks and lets the app sort it out when it is back: rejected, because nothing builds or lands while the app is down, so the entry buys nothing.
- A `--direct` flag on the three that always refuses: rejected, because a flag in the help text reads like a promise.
- A function from the message alone: rejected, because every error the designs list is decided from the state or the settings.

## Consequences

- This narrows decision 0072: "every write command takes `--direct`" becomes "every write command whose entries need only the Ledger". It overrules the line in the write-command design (https://github.com/kamp-us/tea-fabrika/issues/1852) that says `reconcile` takes it.
- This rewords decision 0075: the function turns the state and the message into entries. In 0075's last consequence, the Ledger is not "the app's live state"; the code host is.
- `ready`, `reconcile` and `adopt` have no `--direct` flag, so passing it is an unknown-flag error. Run while the app is down, each gives the usual refusal that the app cannot be reached, plus one line saying the command has no direct way because it needs the code host.
- While the app is down a person can still change a host setting by hand, and adopt or reconcile it once the app is back.
- A device on an old checkout may know an old list of severities, and a direct `declare` then carries it. The entry's sender says it was direct, so a reader can see where it came from.
- A package that gains a write command says in its design whether its entries need only the Ledger.
