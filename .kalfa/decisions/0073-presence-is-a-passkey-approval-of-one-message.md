# Presence is a passkey approval of one message

A write command acts as the human who owns the device (0072), and anything with a shell on that device can run it, an agent included. For the few acts that must be a person's own, the app asks for presence: the human approves that one message with a passkey (WebAuthn), on a page the app serves, and the signature itself carries the proof. We chose a passkey because it is the open standard for this, because one flow covers a Mac's Touch ID, Windows Hello, a phone and a hardware security key with nothing to buy, and because the proof sits inside the signed data where anyone can check it. The design ticket is https://github.com/kamp-us/tea-fabrika/issues/1854, and the facts are in `.kalfa/research/passkey-from-a-command.md` and `.kalfa/research/presence-signature.md` on their research branches.

How it works:

1. Presence is a fact the app hands to its permission check, like any other fact about the message. An act needs it only when the app's rule asks for it, as in `intersection(owner, present)`. Permissions gains nothing.
2. The command prints or opens a link to a page the app serves. The page shows the message and a short code that the command prints too.
3. The passkey signs a fingerprint made from the name of the stream the message is kept in, the message's own id and a hash of the message's exact bytes (decision 0085 added the hash). A stream never takes the same id twice, so one approval is good for one message.
4. Identity checks the signature, the page's address, and the two marks in the signed data: a person was present, and the person was verified. Without both, `present` is false.

## Considered Options

- A hardware security key through OpenSSH: rejected as the one way, because nobody should have to buy a key to use the suite. A hardware key still works, as a passkey holder.
- A Touch ID key with no passkey: rejected, because its signature carries no mark of presence, so a checker has to trust how the key was made, and it works on a Mac only.
- A field where a command says an agent ran it: rejected, because it is only a claim, and a record that looks like proof is worse than none.
- A second passkey for a page the command serves itself, for when the app is down: rejected, because any program on the device can serve such a page and ask for that passkey.

## Consequences

- Each guarded act costs a hop to a browser. Where the command runs does not matter: over SSH or in a box, the human opens the link on their own device, and a phone can approve.
- A direct entry (0072) never counts as present. An act whose rule asks for presence cannot be done while the app is down.
- The second mark, verified, is the passkey holder's word. The system's own passkeys and hardware keys ask each time; a password manager may not. Which holders count is a setting, open by default, and the advice is the system's own or a hardware key.
- No prompt from a browser or a system shows the message, only the app's name. The page showing the message and the matching code is what ties the touch to the act; a touch shows the human was there, not that they read it.
- Adding a human's first passkey is the moment that needs the most care. Decision 0085 says who may add it, and what every later one needs.
- An everyday write that an agent runs for its human still reads as the human's. Only the acts a rule guards are safe from that.
- Not tried yet: whether a system reuses one unlock for two requests in a row. The first build ticket tries it before anything else.
