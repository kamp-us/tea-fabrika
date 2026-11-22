# Identity

Who is acting: the keys, the clients that sign in with them, and the humans and agents they act for, in one project.
What someone may do is not here; that belongs to Permissions.

## Language

**Project**:
What a created entry starts: the humans who belong together, their agents and every key. Its roles (one owner, admins and members) are Permissions'; who invited and who granted each human is recorded from the start.
_Avoid_: fabrika, team, workspace, organization

**Human**:
One person who belongs to a project, acting through keys of kind `human`.
_Avoid_: person, user, account, member

**Client**:
A browser tab, app window, agent bridge, a machine that runs tasks, or the `kalfa` command on a device, signed in
with its own key.
_Avoid_: who, session, connection, user

**Client key**:
The key pair one client signs in with; Secrets keeps its private half, and only its public half ever leaves.
_Avoid_: identity, credential

**Kind**:
What a key acts as: `human` (lets keys in and removes them), `window`, `agent` or `hands` (sign in as a client), or `recovery` (the sheet).
_Avoid_: rank, role, as, type, person key, device key, root key

**Device**:
One machine a human owns, holding a key of kind `human`; every device is an equal root, so dropping one never drops another.
_Avoid_: machine, computer, host

**Agent**:
Something that acts for a human, with a name unique among that human's agents, and can do no more than its human may. An agent that another agent summoned has a parent, acts for its parent's human, and has a name unique among its parent's agents. Its writes are its own, never its human's. A summoned agent holds no key, and the brain stamps its writes; an agent that dials in on its own signs in with a key of kind `agent`. No agent holds a key of kind `human`. An agent's id is the id of the entry that joined it and is never used again; its name can be.
_Avoid_: bot, assistant, delegate, a bare `for` (name the field for what it means: `actsFor`)

**Parent**:
The agent that summoned another agent. When a parent leaves, every agent it summoned leaves with it.
_Avoid_: owner, summoner, supervisor (Program's)

**Created**:
The first entry of a project, naming its first human and that human's first device key. Every later entry is checked against what it set up.
_Avoid_: founding, founded, init, setup, bootstrap

**Invite**:
A one-time link, also shown as a QR code, that a human makes so another human can join. It is good for one day.
_Avoid_: invitation, referral, join link

**Accept**:
The invited human's new device answering an invite with its own new key. It lets nothing in alone: a human already in still grants that key.
_Avoid_: knock, claim, redeem

**Join**:
A human or agent coming into a project. A human joins when the key from their accepted invite is granted; an agent joins when a human summons it, in one step. When an agent summons one, the join carries the brain's stamp and no signature, since a summoned agent holds no key. Joining a talk is Conversation's, not this.
_Avoid_: enroll, onboard, sign up

**Leave**:
A summoned agent going out of a project: its human dismisses it, its parent dismisses it or leaves, or the key that summoned it is revoked. No other human can make it leave. Its name is free again, and its id is never used again. An agent whose harness ended has not left.
_Avoid_: remove, revoke (a key's), drop, dismiss (Agents')

**Grant**:
A signed entry, made by a key of kind `human`, that lets one new key in.
_Avoid_: approval, admission, invite

**Revoke**:
A signed entry that takes a key out, together with every key it let in and every agent it summoned.
_Avoid_: drop, remove, delete, ban

**Sender**:
The client or summoned agent an input came from, stamped by the gateway or the brain and never claimed by the input itself.
On a direct entry no gateway ran: the command names itself as the sender and signs the entry with its client key.
_Avoid_: writer, signer, author, who, a bare `by` (a field names what was done: `sentBy`, `createdBy`)

**Sign-in**:
A client proving its key to the gateway, which admits it or refuses it.
_Avoid_: hello, initialize, knock, handshake, login

**Recovery**:
A human getting back in after losing every device: by the printed sheet, by email, or by an admin's invite as the same human.
_Avoid_: reset, restore, a new project

**Passkey**:
A browser's own key of kind `human`, unlocked by the human each time it is used. A synced passkey counts, and its grant records whether it is backed up. It is also what gives presence.
_Avoid_: WebAuthn key, security key

**Recovery sheet**:
The printed words that are a key of kind `recovery`, used once.
_Avoid_: seed phrase, backup codes, mnemonic

**Outside account**:
An account on another site, such as GitHub, known by its numeric id and never by its login name. A host account (Code hosting) and a chat app's account (Conversation) are each one.
_Avoid_: alias, identity, login, user

**Link**:
The fact that an outside account belongs to a human, made when the human authorizes our app on that site and the site tells us the account's id. A link never lets a key in.
_Avoid_: connect, bind, proof

**Presence**:
Proof that a human was there and approved one message, given with a passkey. An app asks for it only on the acts
its own rules name.
_Avoid_: confirmation, second factor, step-up, sudo
