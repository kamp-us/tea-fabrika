# A passkey only approves, and its approval covers the message's body

Decision 0073 gave a human a passkey for presence and left three things open: what kind of key a passkey is, who lets one in, and what ties an approval to the message's body. We decided that a passkey is a key of its own kind, `passkey`, that can do one thing, approve a message, and that the fingerprint it signs also holds a hash of the message's exact bytes. We chose this because a passkey of kind `human` would be able to let keys in and take them out, a power presence never needs, and because an approval of only the stream and the id leaves the body to code that nobody outside the app can check. The design ticket is https://github.com/kamp-us/tea-fabrika/issues/1901.

How it works:

1. A key of kind `passkey` never signs a client in, never grants and never revokes.
2. A passkey comes in by a `granted` change. A human's first passkey ever is granted by one of that human's keys of kind `human`, never by a key of kind `command`, since anything with a shell on the device can run the command.
3. Once a human has held a passkey, a new one needs an approval from a passkey that human holds now, or the recovery sheet. A key of kind `human` alone is not enough, even when the human holds no passkey right now. Only an invite as the same human (decision 0086) starts this over.
4. Any of the human's keys of kind `human` may revoke a passkey.
5. A human who lost every passkey comes back by the recovery sheet. It lets one new passkey in and revokes the old ones, and is then spent, as decision 0023 says for a device. A human who lost the sheet too comes back by an invite as the same human, or not at all (decision 0086).
6. The fingerprint a passkey signs is made from the stream's name, the message's id and a hash of the message's exact bytes. The exact bytes are the ones every signed change uses: schema-ordered JSON plus a line feed. This replaces point 3 of decision 0073.

## Considered Options

- A passkey as a key of kind `human`: rejected, because it could then let keys in and remove them.
- "First" meaning the human holds no passkey now: rejected, because a stolen key of kind `human` could revoke every passkey and then add its own.
- A reset that a key of kind `human` asks for and that takes effect after a wait, unless a passkey cancels it: rejected, because the recovery sheet and the invite as the same human already cover every case but one, and that one is the owner's own risk (decision 0086).
- The app holds the message it showed, and the fingerprint stays as it was: rejected as the only tie. It works, but the proof would lean on the app's own code. The app still holds the message while the page is open.

## Consequences

- A human who has used a passkey and loses every passkey and the sheet cannot give presence again until someone above them invites them as the same human. For the owner nobody can, so those acts stay closed.
- A reader of the Ledger can check an approval against the kept message with no trust in the app.
