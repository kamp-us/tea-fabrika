# The recovery words become a key by HKDF

The 12 recovery words become an Ed25519 key through HKDF-SHA256 over their 16 bytes of entropy (empty salt, label `fabrika-recovery-v1`), not BIP39's PBKDF2 seed, which serves wallet key trees we do not need. The key is a plain `ssh-ed25519` key, so `ssh-keygen -Y sign` works as a second path. 12 words give 128 bits, about what Ed25519 gives, so more words add typing and no safety.
