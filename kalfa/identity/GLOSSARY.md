# Identity

Who is acting: the keys, the clients that sign in with them, and the humans and agents they act for.
What someone may do is not here; that belongs to Permissions.

## Language

**Human**:
One person who belongs to a fabrika, acting through keys of kind `human`.
_Avoid_: person, user, account, member

**Client**:
A browser tab, app window, agent bridge or a machine that runs tasks, signed in with its own key.
_Avoid_: who, session, connection, user

**Client key**:
The key pair one client signs in with; only its public half ever leaves where it is kept.
_Avoid_: identity, credential

**Kind**:
What a key acts as: `human` (lets keys in and removes them), `window`, `agent` or `hands` (sign in as a client), or `recovery` (the sheet).
_Avoid_: rank, role, as, type, person key, device key, root key

**Device**:
One machine a human owns, holding a key of kind `human`; every device is an equal root, so dropping one never drops another.
_Avoid_: machine, computer, host

**Agent**:
Something that acts for a human, signs its own writes, never holds a key of kind `human`, and can do no more than its human may.
_Avoid_: bot, assistant, delegate, a bare `for` (name the field for what it means: `actsFor`)

**Recovery**:
A human getting back in after losing every device, by the printed sheet or by email.
_Avoid_: reset, restore, re-founding

**Grant**:
A signed entry, made by a key of kind `human`, that lets one new key in.
_Avoid_: approval, admission, invite

**Revoke**:
A signed entry that takes a key out, together with every key it let in.
_Avoid_: drop, remove, delete, ban

**Sender**:
The client an input came from, stamped by the gateway and never claimed by the input itself.
_Avoid_: writer, signer, author, who, a bare `by` (a field names what was done: `sentBy`, `createdBy`)

**Founding**:
The entry that starts a fabrika with its first human.
_Avoid_: create, init, setup, bootstrap

**Sign-in**:
A client proving its key to the gateway, which admits it or refuses it.
_Avoid_: hello, initialize, knock, handshake, login

**Invite**:
A one-time link a human makes so another human can join.
_Avoid_: invitation, referral, join link

**Passkey**:
A browser's own key of kind `human`, unlocked by the human each time it is used.
_Avoid_: WebAuthn key, security key

**Recovery sheet**:
The printed words that are a key of kind `recovery`, used once.
_Avoid_: seed phrase, backup codes, mnemonic
