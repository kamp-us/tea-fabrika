# Secrets

Values few may read, known to everyone else only by their names: fetched by those allowed, or used to sign without ever leaving.

## Language

**Secret**:
A value that someone allowed may fetch, such as an API key or the leak guard's private word list. It is a secret from the moment it is made, and it never becomes a signing key. A person puts its value straight into its secret store; kalfa never takes a value in.
_Avoid_: credential, password, token, a bare key

**Signing key**:
A private key that Secrets signs with. Nobody fetches it, not even the one it belongs to. It is a signing key from the moment it is made, and it never becomes a secret.
_Avoid_: private key, secret key, a bare key

**Secret name**:
The public name of a secret or a signing key. It is safe to write anywhere, and it is the only way other contexts refer to one.
_Avoid_: key, id, ref, handle

**Fetch**:
Getting a secret's value by its name. The value comes back hidden from logs. A name that does not exist is an error, never an empty value. Only a secret can be fetched. Permissions decides who may, and the ledger records each fetch: the name, who, and when, never the value.
_Avoid_: get, read, load, resolve

**Sign**:
Secrets uses a signing key to make a signature over some bytes, and the private half never leaves. Only a signing key can sign. Permissions decides who may, and the ledger records each signing.
_Avoid_: encrypt, seal

**Public half**:
The part of a signing key that anyone may read, used to check its signatures.
_Avoid_: public key, verify key

**Secret store**:
The adapter that holds the values, such as a password manager, a keychain or a cloud's secrets. Each secret name points to exactly one store.
_Avoid_: vault, backend, provider

**Generate**:
Making a new signing key inside its secret store. Only the public half comes out, so no person or agent ever sees the private half. A key given to us from outside is put in by a person, like a secret's value.
_Avoid_: create, mint, issue

**Rotate**:
Replacing a secret's value, or making a new signing key, under the same secret name. An old secret value stops working at once. An old signing key's public half stays readable, so signatures made before still check.
_Avoid_: renew, refresh, roll
