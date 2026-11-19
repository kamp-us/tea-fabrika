# The recovery words are a key, never a password

The 12 recovery words become an Ed25519 key through HKDF-SHA256 over their 16 bytes of entropy (empty salt, label `fabrika-recovery-v1`), not BIP39's PBKDF2 seed, which serves wallet key trees we do not need. Only the public half is ever kept; the words, the seed and the private half are never written to the ledger, the wire, a log or the device. The key is a plain `ssh-ed25519` key, so `ssh-keygen -Y sign` works as a second path.
