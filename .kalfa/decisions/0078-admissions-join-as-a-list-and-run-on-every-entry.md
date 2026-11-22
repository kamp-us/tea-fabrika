# Admissions join as a list and run on every entry

Ledger's protocol named one admission inside an append, but Identity, Permissions, the app's presence line and quotas each bring one, and the new Ledger reads no writer field, so nothing kept Permissions' relationships stream to real changes. We decided that the Ledger takes a list of admissions in the app's order, that Permissions guards its own stream by checking each change as it is kept, and that every admission runs on a direct entry too. We chose this because each package then ships its own rule and no app has to remember it, and because the store is still up when the app's process is down, so its checks have no reason to step aside. The design ticket is https://github.com/kamp-us/tea-fabrika/issues/1865.

A sketch:

```ts
// every admission must pass; the first refusal stops the append and is named
admit(entry: Entry, tx: Transaction): Result<void, Reason>
// append fails with AdmissionRefused { admission, reason }
```

How an append runs:

1. The entry id is checked first. A resend gets the first answer and a reused id is `IdReused`. No admission runs for either, so nothing is charged twice.
2. Each admission runs in the app's order, inside the append's synchronous transaction, with the same handle a transaction step has. It may read, which Permissions' check needs, and append, which a quota's charge needs. An append made by an admission runs no admissions.
3. A refusal undoes the whole transaction, a charge included. So the order changes only which reason comes back.

Permissions' admission, in `@kalfa/permissions/ledger`, checks every entry on the relationships stream: the entry's subject must hold the relation's own change permission, as the transaction sees the relationships. The app hands it one function from an entry to its subject and contextual relationships, so Permissions still imports nothing from Identity. The first holder of a one-relation needs no subject: it passes only when the object has no holder yet.

## Considered Options

- One admission the app composes by hand: rejected, because every app would have to remember each package's rule, and a refusal would not say whose it was.
- Count only entries written under the app's own key, as today's store and the industry's stores do (SpiceDB and OpenFGA guard writes with a service key; recalled, not looked up): rejected, because the new Ledger has no writer key to read, and a direct entry is signed by a person's key.
- The app's own admission guards the relationships stream: rejected, because an app that forgets it lets any entry count as a change.
- Refuse every direct entry on the relationships stream: rejected, because nobody could fix roles while the app is down.

## Consequences

- A direct write skips the program's guard and nothing else. This rewords decision 0075, which said a direct entry passes with no permission check: a direct entry on the relationships stream is checked like any other, so a key that is still in cannot make itself owner.
- A change to relationships is checked twice, once for its proof and once as it is kept. A change whose permission was lost in between is refused.
- An empty list admits everything, for tests and small tools. Each app keeps a law that its list holds Identity's and Permissions' admissions.
- A slow admission slows every append. Permissions' build measures a read of 10,000 changes inside an admission.
- This holds while the append stays synchronous. A switch to the async transaction would be its own decision.
