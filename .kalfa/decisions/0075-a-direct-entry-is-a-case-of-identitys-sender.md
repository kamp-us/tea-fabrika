# A direct entry is a case of Identity's sender

Decision 0072 says a `--direct` entry is marked as direct, and decision 0073 says an act whose rule asks for presence cannot be done direct. Neither said where the mark lives, where the entry is written, or who refuses. We decided that the mark is the shape of the sender in Identity's slot: an entry's sender is either stamped by the gateway or direct, signed by the command's client key. A direct entry goes straight into the app's own Ledger, and the app's Ledger admission refuses one whose act asks for presence. We chose this because one rule then covers every package with write commands, and because a direct entry has no place to hold a gateway stamp or a presence proof by mistake. The design ticket is https://github.com/kamp-us/tea-fabrika/issues/1863.

A sketch of Identity's slot:

```ts
type Sent =
  | { _tag: "stamped"; sender: Sender; actsFor: Human }
  | { _tag: "direct"; sender: Sender; actsFor: Human; signature: Signature }
```

How a direct write runs:

1. The package turns its message into entries with a plain function, the same one its program uses. No guarded service is called, so no permission proof is made or faked.
2. Program's command-line entry point signs the entries with the command's client key and appends them to the app's Ledger. The sending and the direct write are both written there, once.
3. Identity's admission checks that the signature fits the entry and that the key is still in. This asks "is this really that key", which sign-in asks on the normal path. It is not the guard that 0072 skips.
4. The app's admission refuses a direct entry for an act whose rule asks for presence. Every other direct entry skips the program's guard only: the Ledger's admissions still run on it (decision 0078).

## Considered Options

- A field on each package's own entries: rejected, because four packages would each keep a copy, and a write-up would have to know each one.
- A slot of Program's: rejected, because who vouches for an entry is Identity's to say.
- A Ledger on the device, carried over when the app is back: rejected, because two logs would need a merge, and an incident declared on a laptop pages nobody.
- The readers refuse, or nothing does: rejected, because 0073 says the act cannot be done, and a reader can only hide an entry that is already kept.
- The command makes a permission proof with no check behind it: rejected, because a value that looks like proof and is not is worse than none.

## Consequences

- "The app is down" means the process that guards is not answering. If the store is down too, `--direct` cannot write either.
- Each app writes the presence line in its own admission. An app that forgets it lets the entry in; readers still never count a direct entry as present, and show it apart.
- Identity gains an admission, one more for the Ledger to join on one append. Decision 0078 says how they join.
- A write that needs the app's live state to build its entries cannot be done direct.
- Not checked yet: whether the store can answer on Cloudflare while the app's process cannot, and whether every write command's entries can be built on the device. Each has a research ticket under https://github.com/kamp-us/tea-fabrika/issues/1859.
