# Secrets checks that a proof is for this secret, by reading the proof's object

A fetch or a signing asks for the proof the app's permission check gives, and `@kalfa/secrets` refuses a proof made for any other secret: it reads the proof's `object` field and compares it with the secret it was asked for, and a mismatch is a defect, not a typed error. Secrets imports nothing from `@kalfa/permissions`, so it knows a proof only by that one field's shape. We chose this because without it a permission covers a kind of thing and not one thing: one honest check on one secret would open every secret that uses the same permission.

## Considered Options

- Ask only that some proof of the right permission is present: rejected, because an app that checks one secret and then fetches another with the same permission class would compile and run.
- A table in the app's types that ties each secret name to its proof type: rejected, because it is a global pattern an Effect reader does not know, and it still cannot tell two secrets of one permission apart.
- Import the proof's type from `@kalfa/permissions`: rejected, because each kalfa package is usable alone, and a repo with its own permission check should be able to use Secrets.

## Consequences

`@kalfa/permissions` keeps `object` as a public, plain field on a proof for good; a rename there breaks Secrets, and no type says so. A law in Secrets' tests that builds a real Permissions proof closes that gap. Any other check that gives a value with an `object` field works as a proof for Secrets, so the seal on a proof is Permissions' to keep and not Secrets'.
