# Secrets

Values few may read, known to everyone else only by their names: fetched by those allowed, or used to sign without ever leaving.

## Language

**Secret**:
A value that someone allowed may fetch, such as an API key or the leak guard's private word list. It is a secret from the moment it is made, and it never becomes a signing key. A person puts its value straight into its secret store; kalfa never takes a value in.
_Avoid_: credential, password, token, a bare key

**Signing key**:
A private key that Secrets signs with. Nobody fetches it, not even the one it belongs to. It is a signing key from the moment it is made, and it never becomes a secret. It is either given or generated, for life.
_Avoid_: private key, secret key, a bare key

**Given signing key**:
A signing key handed to us from outside, such as a code host's app key. A person puts it into its secret store, like a secret's value, and a person replaces it there.
_Avoid_: imported key, external key

**Generated signing key**:
A signing key made inside its secret store by generate. It is the only kind that kalfa rotates.
_Avoid_: created key, minted key

**Secret name**:
The public name of a secret or a signing key. It is safe to write anywhere, and it is the only way other contexts refer to one.
_Avoid_: key, id, ref, handle

**Fetch**:
Getting a secret's value by its name. The value comes back hidden from logs. A name that does not exist is an error, never an empty value. Only a secret can be fetched. Permissions decides whether a sender may, and the allowance must be for this secret and no other. The ledger records each fetch before the value comes back: the name, the sender, and when, never the value.
_Avoid_: get, read, load, resolve

**Sign**:
Secrets uses a signing key to make a signature over some bytes, and the private half never leaves. Only a signing key can sign. A signature says which version made it. Permissions decides whether a sender may, and each signing is recorded as a fetch is. Where no ledger can be reached yet, as when a client signs to connect, the record is kept and sent once one can.
_Avoid_: encrypt, seal

**Version**:
One signing key that a secret name has held. A rotation makes a new version, and the newest one signs.
_Avoid_: generation, key id

**Public half**:
The part of a signing key that anyone may read, used to check its signatures. Every version's public half stays readable, so signatures made before a rotation still check.
_Avoid_: public key, verify key

**Private half's place**:
Where a signing key's private half sits while it signs: in the store (the secret store signs inside itself), in the runtime (our runtime holds it and refuses to hand it out), or in memory (it is loaded into our own process). A signing key names the loosest place it accepts.
_Avoid_: security level, tier

**Secret store**:
The adapter that holds the values, such as a password manager, a keychain or a cloud's secrets. Each secret name points to exactly one store. A store says what it can do: hold a value, sign inside itself, generate a signing key inside itself.
_Avoid_: vault, backend, provider

**Route**:
The setting that points a secret name at its secret store and its item there. A route to a store that cannot do what the name needs is refused when the process starts, never at a fetch or a signing.
_Avoid_: mapping, binding

**Item**:
A secret store's own label for the thing a secret name points to, such as an environment variable's name.
_Avoid_: address, path, ref

**Generate**:
Making a new signing key inside its secret store. Only the public half comes out, so no person or agent ever sees the private half. The store's own login always gates it, and code that acts for a sender also needs Permissions' yes.
_Avoid_: create, mint, issue

**Rotate**:
Replacing a secret's value, or making a new version of a signing key, under the same secret name. An old secret value stops working at once. Kalfa rotates only a generated signing key, gated as generate is; a person rotates a secret or a given signing key in its store, and Secrets records the change when it sees it.
_Avoid_: renew, refresh, roll
