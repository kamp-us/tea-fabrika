# A key on a person's laptop is held, not locked in

A `kalfa` command needs its own client key on a person's laptop (0072), and no secret store built so far keeps one there. We decided that Secrets gets two stores for it, both of which hold the key's bytes and sign in our own process: `/keychain`, the system's own store on macOS, Linux and Windows, and `/file`, key files only their owner can read. We chose holding because no plain storage stops another program the same person runs from using a key; the routes differ only in whether the key can also be copied. The routes that prevent copying each cost more than that is worth here: macOS cannot lock in an Ed25519 key, `ssh-agent` forgets a key at a restart, and the system keys need native code we would write and keep per system. The design ticket is https://github.com/kamp-us/tea-fabrika/issues/1861, and the facts are in `.kalfa/research/key-on-a-laptop.md` on its research branch.

How it works:

1. Both stores generate and rotate. Our process makes the key, writes it to the store at once, and gives out only the public half. Such a key's place is in memory.
2. There is no silent fallback. A route to a keychain that is not there stops the start and names the file store. The keychain store refuses the Linux kernel keyring, which a restart clears, and turns off Windows roaming.
3. On a fresh machine `kalfa identity accept` picks the keychain store when the system's store answers, and the file store otherwise. It saves the route in the user configuration and prints where the key went.
4. A route to either store may be set only in the user configuration, so a repo a person clones cannot point their key at a place it chose.
5. The file store keeps one file per secret name in a `keys` folder in the config home (`secrets.file.dir`). It refuses a file that others can read.

## Considered Options

- `ssh-agent` signs and the key never enters our process: rejected as the one way, because the agent forgets the key at a restart and the key is made outside it.
- A system key that cannot be copied, behind a small native helper: rejected, because macOS offers it for ECDSA P-256 only, and the helpers are native code with no vetted package.
- One store that quietly uses a file when the keychain is missing: rejected, because a person should know where their key is, and a quiet fallback is how a key ends up in the Linux kernel keyring and is gone after a restart.

## Consequences

- A program a person runs can copy the client key, not only use it. Revoking the command's key on that device (0072) is the answer, and the acts that must be a person's own are guarded by presence (0073).
- The client key's declaration accepts the place in memory on a laptop.
- A given signing key, such as a GitHub App's key for the lead tooling, uses the same two stores. A person puts it in by hand, because kalfa never takes a value in.
- A pick made at accept can go stale: a Linux machine that later gets a keyring stays on the file store until a person changes the route.
- `@kalfa/secrets/keychain` brings one native dependency, `@napi-rs/keyring`, with prebuilt binaries.
- Not tried yet: a real keychain on any of the three systems, a keychain read over SSH, and what owner-only means for a file on Windows. The first build tickets try these before anything else.
