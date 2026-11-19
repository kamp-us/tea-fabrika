# Saved state holds a secret's name, never the secret

A saved state keeps only a secret's name, and a Cmd fetches the value from `Secrets` when it needs it; every store refuses a `Redacted` value. The shared record is read by every member and never deleted, so a secret written there would leak forever.

## Considered Options

Encrypting saved state with a project key: rejected, because every host would need the keyring and a lost key would lose every record.
