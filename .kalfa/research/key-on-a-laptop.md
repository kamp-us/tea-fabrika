---
summary: How a Node command-line tool can keep a self-generated Ed25519 or ECDSA signing key on a person's own machine so it survives a restart, checked per route (macOS file-based and data-protection keychains, Linux Secret Service, kernel keyring, pass and a 0600 key file, Windows Credential Manager, DPAPI and CNG, ssh-agent and 1Password's agent, Node Web Crypto) with what each needs, what a person sees, whether it works over SSH and in a container, whether another program run by the same person can read or use the key without a prompt, and how known tools (gh, git credential helpers, OpenSSH, age, 1Password, Docker) pick a default and a fallback; every claim cited
---

# Keeping a signing key on a person's own machine: what a Node command can use

Question (ticket https://github.com/kamp-us/tea-fabrika/issues/1860): what are the ways a Node program can keep a private
key on a laptop so that it survives a restart and other programs cannot simply read it? Why it matters, from
https://github.com/kamp-us/tea-fabrika/issues/1861: the planned `@kalfa/secrets` package builds three stores first
(Cloudflare, environment variables, memory), and none keeps a generated key on a laptop. The package's answer comment
(https://github.com/kamp-us/tea-fabrika/issues/1752) says a store can hold a value (`Holds`), sign (`Signs`) or generate
(`Generates`), and that the private half has a place: in the store, in the runtime, or in memory. This note uses those
words. The two earlier notes, [presence-signature.md](./presence-signature.md) and
[passkey-from-a-command.md](./passkey-from-a-command.md), covered keys that need a touch (FIDO keys, Secure Enclave,
passkeys). This note does not repeat them. It covers plain storage, with no touch.

Read on 2026-11-21. Primary sources only: Apple, Microsoft, freedesktop.org, kernel and Node docs, man pages, the IETF
agent draft, and each tool's own source code, read at the commit named in the Sources list. A line marked "my reading" is
mine, not a source's claim. A line marked "not confirmed" says what I could not check and what would settle it. I ran
no keychain, agent or key command. I ran one small Node test on my own machine (section 6), and I read the macOS
`security` man page on the one Mac I used (macOS 14.3.1).

This note describes what each route guarantees. It is not a guide to getting around any of them.

## The short answer

1. **No plain storage route stops another program run by the same person from using the key.** Routes differ in two other
   ways: whether a program can copy the key off the machine, and whether it survives a restart. Only a prompt on every use
   (a touch, covered in the earlier notes) stops use. The closest plain route is the macOS keychain, which asks the first
   time a new program asks. Then the program is trusted by its identity. For a Node tool that identity is the `node`
   program itself, so any script run with the same `node` is trusted too (my reading of the man page and the ACL rules;
   not run).
2. **For a store that holds a value, use the system's own store where one exists, with a plain file as the fallback.** That
   is macOS login keychain, Windows Credential Manager, and Linux Secret Service. One maintained npm package reaches all
   three: `@napi-rs/keyring` 2.1.2 (published 2026-10-19, prebuilt binaries for 12 targets). Two traps: on Linux it
   falls back without a word to the kernel keyring, which a reboot clears, and the Windows store's default persistence
   may roam to the person's other computers.
3. **For a store that signs and cannot be copied from, three routes exist, and none stops use by another program.** An
   `ssh-agent` (Ed25519 or ECDSA, any system, but the key is made outside and loaded in), a macOS key made non-extractable
   (ECDSA P-256 only), and a Windows CNG key made non-exportable (ECDSA only in what I read). The last two need a small
   native helper. I found no vetted npm package for either.
4. **A machine with no usable store is the normal case, not the exception.** Every known tool falls back to a plain file:
   `gh` writes the token to a text file, Docker writes base64 into `config.json`, `git-credential-store` writes plaintext,
   OpenSSH and `age` use a key file with mode 0600. A 0600 file stops other users. It does not stop another program run by
   the same person.
5. **Node's own Web Crypto cannot do it.** A non-extractable key lives only in the process. I tested it: it does not
   survive being saved and loaded, and a restart ends it.

My confidence in the points above is about 85%. The doubts: I could not run any macOS, Linux Secret Service or Windows
route against a real prompt, so every "what a person sees" line comes from docs, and two same-user claims (macOS ACL
trust of `node`, GNOME Keyring's per-program behavior) are my reading, not a tested result.

## The table

| Route | Survives a restart | Another program run by the same person can read or use it without a prompt | Over SSH | In a container | What it needs | What Node calls |
|---|---|---|---|---|---|---|
| macOS login keychain, key as bytes | Yes (a file; may be locked) | Use: yes if that program is on the item's trusted list; the creator is on it by default; others get a prompt once | Prompts cannot show; not confirmed for an already trusted item | No | A Mac; a plain program may use only the file-based keychain | `@napi-rs/keyring`, or `security` child process |
| macOS key made non-extractable (ECDSA P-256 only) | Yes | Use: same rule. Copy: no | Same as above | No | A small native helper | Child process (no vetted package found) |
| Linux Secret Service | Yes, but locked after a reboot | Probably yes once unlocked (the spec lets a service allow any client; GNOME Keyring's own rule not confirmed) | Only with a reachable session bus and an unlocked collection | Only with a bus and a provider inside | Session D-Bus; GNOME Keyring, KWallet or another provider | `@napi-rs/keyring`, or `secret-tool` child |
| Linux kernel keyring | No (cleared at reboot; persistent keyring expires) | Yes (same user ID; key permissions apply) | Yes, no window needed | Docker's default profile blocks it | The Linux kernel | `@napi-rs/keyring` fallback, or `keyctl` child |
| Key file, mode 0600 | Yes | Yes | Yes | Yes, on a mounted volume | Nothing | `node:fs` |
| `pass` (GPG-encrypted files) | Yes | Yes while `gpg-agent` has the passphrase cached (10 minutes default, 2 hours at most) | Yes with a terminal passphrase prompt | Needs `gpg` and a key pair | `pass`, `gpg` | `pass` child process |
| Windows Credential Manager | Yes | Yes (a read returns the logon session's credentials) | No for key-based SSH logins | Not confirmed | A Windows logon session | `@napi-rs/keyring` |
| Windows DPAPI file | Yes | Yes (same user; optional entropy is not secret from the same user, my reading) | No for key-based SSH logins (a contributor's comment) | Not confirmed | Windows | PowerShell or .NET `ProtectedData` child |
| Windows CNG key made non-exportable (ECDSA) | Yes | Use: yes. Copy: no | Same as DPAPI | Not confirmed | Windows | PowerShell or .NET `CngKey` child |
| `ssh-agent` holding a software key | No (memory), except Windows (registry, DPAPI) or a keychain reload on macOS | Yes (man page: "easily abused by ... another instance of the same user") | Yes, through the socket | Only with the socket mounted | OpenSSH; an agent running | `ssh-keygen -Y sign` child |
| 1Password SSH agent | Yes (in the vault) | No by default (approval per program); yes if the person ticks "approve for all applications" | The app prompts, so not headless | No | The desktop app, unlocked | `ssh-keygen -Y sign` child, with `SSH_AUTH_SOCK` set |
| Node Web Crypto, non-extractable | No | Not applicable (only that process holds it) | Yes | Yes | Node | `crypto.subtle` |

## 1. macOS

**Two keychains exist, and a plain program gets one of them.** Apple's TN3137 says macOS has a file-based keychain and a
data protection keychain. The `SecItem` API "defaults to targeting the file-based keychain", and the data protection one is
chosen with `kSecUseDataProtectionKeychain`. The data protection keychain gets its access groups from code signing
entitlements, and "These entitlements must be authorized by a provisioning profile. Your program needs an app-like bundle
structure in which to embed that profile. This is standard for app and app extensions but not for command-line tools."
([TN3137](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains),
[kSecUseDataProtectionKeychain](https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain)).
So a plain binary uses the file-based keychain. The Rust store that `@napi-rs/keyring` builds on says the same: for
"client apps that are _not_ code-signed by a provisioning profile (e.g., command-line apps)" use its `keychain` module, and
its `protected` module is for signed apps
([apple-native-keyring-store README](https://github.com/open-source-cooperative/apple-native-keyring-store/blob/1c6d6145dbcd217c30a79112ec7aedff9610a66d/README.md)).
Git's `osxkeychain` helper calls `SecItemAdd` and never sets the data protection attribute, so it also uses the file-based
one ([`git-credential-osxkeychain.c`](https://github.com/git/git/blob/f7de81456940dd6f3274e461149bba12965de609/contrib/credential/osxkeychain/git-credential-osxkeychain.c#L377)).
Features that need the data protection keychain, such as biometric protection and the Secure Enclave, are listed in TN3137
and are out of reach for a plain binary. The earlier presence note covers them. Apple also calls the file-based keychain
"on the road to deprecation" ("not officially deprecated, but some of the APIs surrounding it are"). That is a cost of this
route.

**What a person sees.** Access uses a list of trusted programs, called an access control list: "The file-based keychain
uses access control lists (SecAccess)" (TN3137). The `security` man page on macOS 14.3.1 says: "By default, the application
which creates an item is trusted to access its data without warning. You can remove this default access by explicitly
specifying an empty app pathname: -T ''." `-T appPath` adds a trusted program, and `-A` allows "any application to access
this item without warning (insecure, not recommended!)". The man page also describes a "partition list", "an extra parameter
in the ACL which limits access to the item based on an application's code signature". When an unlisted program asks,
Apple's guide says the person gets three buttons: Deny, Allow Once ("You're asked again the next time the app needs to
access the password") and Always Allow ("Allow the app to always retrieve the password without asking")
([Mac User Guide](https://support.apple.com/guide/mac-help/kychn002/mac)). "Always Allow" therefore adds a program to the
trusted list for that item (my reading; Apple's page states the effect, not the mechanism).

**Same person, another program.** From the man page rule above, an item created through the `security` command is
trusted for the `security` command. `zalando/go-keyring`, which `gh` uses, creates items by running `/usr/bin/security`
with `add-generic-password` and reads them by running `security find-generic-password`
([`keyring_darwin.go`](https://github.com/zalando/go-keyring/blob/62684098251952caaa79470ad0046a5cbec2b437/keyring_darwin.go#L29)).
My reading: any program the person runs could run the same `security` command and read such an item with no prompt, while
the keychain is unlocked. I did not run this, because testing it needs a real keychain item. A test in a throwaway
keychain file, read by a second process, would confirm it. For a Node program that calls the Security framework itself
(as `@napi-rs/keyring` does), the creator is the `node` binary, so by the same rule any script run with that `node` is
trusted (my reading). Whether a new Node version, which is a different binary, prompts again: not confirmed.

**Over SSH and with no window.** Apple's TN2083 says "When you log in via ssh, the system creates a new per-session
bootstrap namespace for your session", different from the one the GUI uses, and "A daemon cannot display any GUI"
([TN2083](https://developer.apple.com/library/archive/technotes/tn2083/_index.html)). The Security framework has an
error for this case: `errSecInteractionNotAllowed`, "Interaction with the Security Server is not allowed"
([page](https://developer.apple.com/documentation/security/errsecinteractionnotallowed)). My reading: a keychain access that
needs a prompt cannot succeed in an SSH session. Not confirmed: whether an item that needs no prompt can be read over SSH
when the login keychain is unlocked, and when the keychain unlocks after a restart. TN3137 does not say. The `security`
command has `unlock-keychain` and `set-keychain-settings` (lock on sleep, lock after a timeout; man page), so a keychain
can lock. A test over SSH on a test account would settle both. `gh` wraps every keyring call in a 60-second timeout and
returns "timeout while trying to get secret from keyring"
([`internal/keyring/keyring.go`](https://github.com/cli/cli/blob/de06af2c2ea536d5722fda35dc2001565f9b9f64/internal/keyring/keyring.go#L31)),
which fits a prompt that nobody can answer.

**Generated inside, never leaving?** Partly, and not for Ed25519.

- `SecKeyCreateRandomKey` makes a key pair. With `kSecAttrIsPermanent` the private key is stored in the default keychain
  as it is made ([Generating New Cryptographic Keys](https://developer.apple.com/documentation/security/generating-new-cryptographic-keys)).
- `SecKeyCopyExternalRepresentation` "fails in macOS if the key has the attribute kSecKeyExtractable set to false"
  ([page](https://developer.apple.com/documentation/security/seckeycopyexternalrepresentation(_:_:))). So a software
  ECDSA key can be made non-extractable. The page for `kSecAttrIsExtractable` is a one-line description, so what other
  ways might read such a key out of the keychain file: not confirmed.
- `SecKeyAlgorithm` lists ECDSA signature algorithms (`ecdsaSignatureMessageX962SHA256` and others) and, in the list I
  read, nothing for Ed25519
  ([SecKeyAlgorithm](https://developer.apple.com/documentation/security/seckeyalgorithm)). Apple's CryptoKit sample says
  key types with "no direct keychain corollary" are stored "as generic passwords"
  ([Storing CryptoKit Keys in the Keychain](https://developer.apple.com/documentation/cryptokit/storing-cryptokit-keys-in-the-keychain)).
  My reading: an Ed25519 key on macOS is stored as bytes, so any program allowed to read the item can copy it. Only ECDSA
  P-256 can be both non-extractable and in a plain-binary keychain. Not confirmed: whether any macOS API signs with
  Ed25519 inside the keychain.
- The `security create-keypair` command offers `rsa`, `dh`, `dsa` or `fee` (man page), not ECDSA. A Node program that wants
  a non-extractable ECDSA key needs a small helper that calls the Security framework. The earlier note found Node
  packages for the Secure Enclave and rejected them as young and thinly used. I did not search for software-key packages:
  not confirmed that none exists.

## 2. Linux

**Secret Service.** The freedesktop spec says it lets applications "store secrets securely in a service running in the
user's login session", and a session "is bound to calling application's connection to the D-Bus session bus"
([intro](https://specifications.freedesktop.org/secret-service/latest/ch01.html),
[sessions](https://specifications.freedesktop.org/secret-service/latest/sessions.html)). A collection can be locked, and
"The secrets of locked items cannot be accessed." Unlocking may need a prompt: "the service may need to prompt the user for
additional information, such as a master password" ([unlocking](https://specifications.freedesktop.org/secret-service/latest/unlocking.html)).
On access between programs, the spec says: "A service may choose to unlock items or collections just for a single client
application. Alternatively the service may choose to allow any client application to access items or collections unlocked
by another client application." So the spec leaves the same-user rule to each provider. For GNOME Keyring I found no
per-program rule in the daemon code I looked at (`gkd-secret-objects.c` uses the caller's bus name to find that caller's
session, not to check which program it is), but I did not read every file: not confirmed. A test with two unrelated
programs against an unlocked login keyring would settle it. `libsecret` is the client library. It stores secrets in the
Secret Service, and "Otherwise, secrets are stored in a file that is encrypted using a master secret that was provided by
the secret portal" ([README](https://gitlab.gnome.org/GNOME/libsecret/-/blob/7ab0b42f5581e5793d6fd32df3f0eea9a20f41b9/README.md)).
The source shows that file backend is used only inside Flatpak or Snap, or when the `SECRET_BACKEND` variable asks for it
([`secret-backend.c`](https://gitlab.gnome.org/GNOME/libsecret/-/blob/7ab0b42f5581e5793d6fd32df3f0eea9a20f41b9/libsecret/secret-backend.c#L156)).
So on a plain server or container it needs a real provider on a session bus.

**What it needs, with no desktop.** Git Credential Manager's docs are the clearest primary statement:

- Its `secretservice` store "Requires a D-Bus session bus and a Secret Service provider." The provider "handles prompts to
  create or unlock collections; these prompts may require a graphical user interface."
- "A graphical session is not required to access an already-unlocked collection." In a headless or SSH session the tool
  must reach the same session bus and the collection must already be unlocked.
- "Starting the bus or provider is not the same as unlocking a collection ... After a reboot or provider restart, it must be
  unlocked again."
- "GCM cannot provision a D-Bus session or replace the provider's unlock prompts with terminal or pinentry prompts. For
  environments without D-Bus, consider the GPG/`pass` credential store or Git's in-memory credential cache."

([credstores.md](https://github.com/git-ecosystem/git-credential-manager/blob/f0ee0c7708efec2c16111068507249d5d5583924/docs/credstores.md#L104-L139),
[headless guide](https://github.com/git-ecosystem/git-credential-manager/blob/f0ee0c7708efec2c16111068507249d5d5583924/docs/secretservice-headless.md)).
GNOME Keyring's own man page says the daemon "is normally started automatically when a user logs into a desktop session",
`--unlock` "Read[s] a password from stdin" to unlock the login keyring, and `--login` is for PAM
([gnome-keyring-daemon](https://gitlab.gnome.org/GNOME/gnome-keyring/-/blob/8561976b6b4662330caeb16c921472a89e891ed1/docs/gnome-keyring-daemon.xml)).
KWallet's daemon was converted into a Secret Service provider named `ksecretd` in a merge request merged 2025-04-14
([KWallet MR 97](https://invent.kde.org/frameworks/kwallet/-/merge_requests/97)); which release first shipped it: not
confirmed. `secret-tool store` reads the secret from standard input (or a terminal prompt), so the secret does not appear
in the command line ([`secret-tool.c`](https://gitlab.gnome.org/GNOME/libsecret/-/blob/7ab0b42f5581e5793d6fd32df3f0eea9a20f41b9/tool/secret-tool.c)).
The API's calls are "GetSecret(), SetSecret()" and "GetSecrets()"
([description](https://specifications.freedesktop.org/secret-service/latest/description.html)), and `secret-tool` stores a
value with content type `text/plain`, so a Secret Service holds a key but never signs: the private half comes out into the
caller (my reading).

**Kernel keyring.** `keyrings(7)` says each user ID has a user keyring and a persistent keyring that "may persist beyond
the life of the UID record" but expires, with a timer that "defaults to 3 days"; session keyrings are linked at login by
`pam_keyinit`. Access follows the key's permission mask ("user" rights apply when the key's user ID matches the caller's)
([keyrings(7)](https://man7.org/linux/man-pages/man7/keyrings.7.html),
[persistent-keyring(7)](https://man7.org/linux/man-pages/man7/persistent-keyring.7.html)). `add_key(2)` says a `user` key
"is kept entirely within kernel memory" and a `logon` key "does not permit the key to read" from user space
([add_key(2)](https://man7.org/linux/man-pages/man2/add_key.2.html)). Neither page mentions a reboot. The Rust store that
`@napi-rs/keyring` uses states it plainly: "completely in-memory and will not persist across reboots ... Consider the
keyring a secure cache" and "a reboot clears all keyrings"
([`linux-keyutils-keyring-store`](https://github.com/open-source-cooperative/linux-keyutils-keyring-store/blob/a0796523d57ae90b20df4b7952c3d9550bb174aa/src/lib.rs#L40)).
So the kernel keyring does not meet "survives a restart". It also needs no window, so it works over SSH, but Docker's
default seccomp profile blocks `add_key`, `keyctl` and `request_key`: "Prevent containers from using the kernel keyring,
which is not namespaced" ([Docker seccomp docs](https://docs.docker.com/engine/security/seccomp/)). A `logon` key stops a
program reading the bytes back, but the kernel itself, not user space, would have to use the key, and Linux user space
cannot sign with it (my reading; I found no user-space sign call in these pages).

**`pass` and `gpg-agent`.** `pass` keeps each secret in a file "encrypted using the gpg key set with init"
([`pass.1`](https://git.zx2c4.com/password-store/plain/man/pass.1?id=f554f7974def2e25babfc4c5d15524acb01f42f7)). It protects
the file at rest. A use needs `gpg` to decrypt, and `gpg-agent` caches the passphrase: `default-cache-ttl` is 600 seconds
and `max-cache-ttl` is 2 hours ([GnuPG agent options](https://www.gnupg.org/documentation/manuals/gnupg/Agent-Options.html)).
Who may talk to the agent's socket: the page does not say, so not confirmed. My reading: while the passphrase is cached, a
program run by the same person that can reach the socket can ask `gpg` to decrypt. With no cached passphrase a prompt
appears (a terminal one works over SSH if a terminal pinentry is set up; not confirmed).

**A key file at mode 0600.** It stops other users of the machine. Another program run by the same person can read it, as
the file is theirs. OpenSSH shows this is the accepted floor: `ssh` "will simply ignore a private key file if it is
accessible by others", and it writes new key files with `umask(077)`
([`ssh.1`](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh.1#L1498-L1512),
[`authfile.c`](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/authfile.c#L96-L104)).
`git-credential-store` is blunt: "this helper will store your passwords unencrypted on disk, protected only by filesystem
permissions"
([docs](https://github.com/git/git/blob/f7de81456940dd6f3274e461149bba12965de609/Documentation/git-credential-store.adoc#L17-L19)).
On Linux, the Yama setting `ptrace_scope` set to 0 means "a process can PTRACE_ATTACH to any other process running under
the same uid, as long as it is dumpable", so a program's memory is also open to its owner's other programs unless the
setting is raised or the program turns tracing off
([Yama](https://www.kernel.org/doc/html/latest/admin-guide/LSM/Yama.html); `ssh-agent` turns tracing off with
`platform_disable_tracing`, [`ssh-agent.c` line 2356](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh-agent.c#L2356)).
Protection against theft of the disk (full-disk encryption) is a separate matter I did not research.

## 3. Windows

**Credential Manager.** `CredWrite` and `CredRead` keep a credential per logon session's credential set. `CredRead` "reads
a credential from the user's credential set. The credential set used is the one associated with the logon session of the
current token", and "Network logon sessions do not have an associated credential set"
([CredReadW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credreadw)). A generic credential is
"stored securely but has no other significant characteristics", the blob is "defined by the application", and it cannot be
larger than 5 x 512 = 2,560 bytes
([CREDENTIALA](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentiala)). A raw Ed25519 or
ECDSA key fits. Persistence has three values: `CRED_PERSIST_SESSION` (gone at logoff), `CRED_PERSIST_LOCAL_MACHINE`
(visible to other logon sessions of this user on this computer) and `CRED_PERSIST_ENTERPRISE` (also to the user's other
computers, "can be implemented as locally persisted" when the user has no roaming state). The Rust store under
`@napi-rs/keyring` writes `Enterprise` by default unless the caller says otherwise
([`windows-native-keyring-store`](https://github.com/open-source-cooperative/windows-native-keyring-store/blob/66a9bcd75dc48509e4fbf04b9c42b9fbb686853d/src/store.rs#L121-L125)).
Whether `@napi-rs/keyring` changes that default: not confirmed. For a signing key meant to stay on one laptop, the default
should be checked or set to `Local`.

**Same person, another program.** Windows has no per-program rule here. Any program running with the person's token, in
that logon session, reads the same credential set (CredRead page above, my reading).

**DPAPI.** `CryptProtectData`: "Typically, only a user with the same logon credential as the user who encrypted the data
can decrypt the data", on the same computer, and with `CRYPTPROTECT_LOCAL_MACHINE` "any user on the computer ... can use
CryptUnprotectData to decrypt the data". An optional entropy blob "contains a password or other additional entropy"
([CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)). My reading:
entropy a program holds in its own code is no secret from another program run by the same person. .NET's `ProtectedData`
class wraps it, with `DataProtectionScope.CurrentUser`, "supported on the Windows platform only"
([ProtectedData](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata)). DPAPI protects
a key file at rest. It does not make the key non-copyable by the same user.

**CNG non-exportable keys.** `NCryptCreatePersistedKey` makes a named key that cannot be used until `NCryptFinalizeKey` is called. With no
name, it makes "an ephemeral key that is not persisted"
([page](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptcreatepersistedkey)). The export policy
property `NCRYPT_EXPORT_POLICY_PROPERTY` takes "zero or a combination" of flags (`NCRYPT_ALLOW_EXPORT_FLAG` and others), so a key made with
none of them is non-exportable (my reading; [property list](https://learn.microsoft.com/en-us/windows/win32/seccng/key-storage-property-identifiers),
and .NET's `CngExportPolicies` has a `None` value). Long-lived keys "must be isolated so that they are never present in the
application process"; Microsoft's software KSP runs in the key isolation service in the LSA process, and "All access to
private keys goes through the key storage router and is audited by CNG"
([Key Storage and Retrieval](https://learn.microsoft.com/en-us/windows/win32/seccng/key-storage-and-retrieval)). That is a
real guarantee that a program in the person's session cannot copy the key bytes out of a program's memory. Another
program run by the same person can still ask CNG to sign (my reading; the page describes isolation, not a per-program
rule). The key can also get a security descriptor (`NCRYPT_SECURITY_DESCR_PROPERTY`: "access control information for the
key"), which is by account, not by program (my reading), and a "strong key" prompt policy (`NCRYPT_UI_POLICY_PROPERTY`)
that shows a dialog when the key is used. Whether a console program with no window handle can show that prompt: not
confirmed. The CNG algorithm list I read names `ECDSA_P256`, `ECDSA_P384` and ECDSA P-521, with no Ed25519
([CNG algorithm identifiers](https://learn.microsoft.com/en-us/windows/win32/seccng/cng-algorithm-identifiers)). Not
confirmed that no other Windows API signs with Ed25519 inside a key store.

**Over SSH.** Git Credential Manager's docs: "When connecting to a Windows machine over a network session (such as SSH),
GCM is unable to persist credentials to the Windows Credential Manager due to limitations in Windows. Connecting by Remote
Desktop doesn't suffer from this limitation" (credstores.md line 56 above). In Win32-OpenSSH's tracker, a contributor
explains that with key-based login "you cannot unlock the DPAPI store for that user and access its secrets" because the
logon session never saw the user's password, and the same applies to the private key store
([issue 1950](https://github.com/PowerShell/Win32-OpenSSH/issues/1950),
[issue 1935](https://github.com/PowerShell/Win32-OpenSSH/issues/1935)). That is a contributor's comment in an open issue,
not Microsoft documentation. What would confirm it: a test over key-based SSH on Windows.

## 4. An agent process

**What the protocol allows.** The agent protocol's sign request is `SSH_AGENTC_SIGN_REQUEST` with a key blob, `data` ("the
data to be signed") and flags. The agent replies with a signature, or with failure if "unable or unwilling to generate the
signature (for example, because ... the user refused confirmation of a constrained key)"
([draft-ietf-sshm-ssh-agent-16, section 3.6](https://www.ietf.org/archive/id/draft-ietf-sshm-ssh-agent-16.txt)). The data is
any bytes. The draft's security section: "the agent protocol itself does not include any authentication or transport
security; ability to communicate with an agent is usually sufficient to invoke it to perform private key operations", and
"an attacker with unprivileged access to their victim's agent should be prevented from gaining a copy of any keys ... This
may not preclude the attacker from stealing use of those keys (e.g. if they have been loaded without a confirmation
constraint)." The signature formats cover `ssh-ed25519` and `ecdsa-sha2-*` keys, so both key kinds in the question work.
Keys are added by the client, which sends the private key to the agent (`SSH_AGENTC_ADD_IDENTITY`, section 3.2), so the
agent never generates a key: the key is made by the client (for example `ssh-keygen`) and then loaded. 1Password's agent
is the exception, because the app makes the key itself
([1Password SSH get-started](https://www.1password.dev/ssh/get-started/): "You can generate a key in 1Password").

**Signing any bytes through `ssh-keygen`.** `ssh-keygen -Y sign -f <public key file> -n <namespace>` uses the agent if the
agent has that key: `sig_sign` loads the public key, opens the agent socket, and calls `ssh_agent_has_key`
([`ssh-keygen.c`, lines 2799-2850](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh-keygen.c#L2799-L2850)).
Only if the agent lacks the key does it try to load a private key file. The namespace goes into the signed data, which
separates uses from each other when the signature is checked
([PROTOCOL.sshsig](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/PROTOCOL.sshsig)).
A raw sign request has no namespace at all (my reading of the draft).

**What restricts what an agent will sign.** For an ordinary software key (Ed25519 or ECDSA), the agent code checks only
the optional rules the key was loaded with, and I found no check on what the bytes are:

- Confirmation: `ssh-add -c` makes the agent ask before each use; "Confirmation is performed by ssh-askpass(1)"
  ([`ssh-add.1`](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh-add.1#L102-L109)).
  The code path is `confirm_key` and `ask_permission`, run from the sign request when `id->confirm` is set
  ([`ssh-agent.c` lines 629-641 and 971](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh-agent.c#L971)).
  A confirm needs a way to ask (a window or an askpass program); over SSH with no askpass, whether the key then signs or
  refuses: not confirmed. The refusal path is what the draft says ("MUST reply with SSH_AGENT_FAILURE"), so I expect a
  refusal.
- Lifetime: `ssh-add -t` and `ssh-agent -t` set a time limit.
- Destination constraints: `ssh-add -h` limits a key to named hosts, but "destination constraints can only be enforced by
  ssh-agent when a key is used, or when it is forwarded by a cooperating ssh", added in OpenSSH 8.9
  ([`ssh-add.1`](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh-add.1#L158-L218)).
- The "websafe" check applies only to FIDO keys whose application string does not start with `ssh:`
  (`check_websafe_message_contents`, `ssh-agent.c` line 851). Software keys skip it.

So an agent is a good fit for a store that only signs, but it does not decide what is signed. A program of the same user
that can reach the socket can ask for any bytes to be signed (my reading of the draft and the code). OpenSSH's man page
says it directly: `SSH_AUTH_SOCK` "is accessible only to the current user, but is easily abused by root or another
instance of the same user"
([`ssh-agent.1`, line 327](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh-agent.1#L327)),
and the code checks the peer's user ID and accepts the same user or root (`handle_socket_read`, `ssh-agent.c` lines
2062-2071). Because the person's login agent may hold their real SSH keys, a tool that uses an agent would be better off
with its own agent and its own key (my reading, not a source's rule).

**How each system starts one.**

- **macOS.** A launch agent file ships with the system: `com.openssh.ssh-agent`, running `/usr/bin/ssh-agent -l`, with a
  socket named by `SSH_AUTH_SOCK` (read on macOS 14.3.1, in the system's launch agents folder). Keys do not stay in the agent
  across a restart. `ssh-add` has `--apple-use-keychain`, which stores each key's passphrase in the user's keychain, and
  `--apple-load-keychain`, which adds identities to the agent "using any passphrase stored in the user's keychain" (macOS
  `ssh-add` man page). The key files stay on disk.
- **Linux.** Upstream OpenSSH ships no systemd unit or launcher in its source tree (I searched the tree). Its man page
  says `ssh-agent` can run "via socket activation from a supervising process, such as systemd"
  ([`ssh-agent.1`, line 265](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh-agent.1#L263-L268)).
  GNOME Keyring's daemon "also implements a GnuPG and SSH agent" that load keys and prompt for passwords. Which
  distributions ship a user unit: not confirmed.
- **Windows.** "By default, the ssh-agent service is disabled" and must be set to start automatically from an elevated
  prompt ([Microsoft: OpenSSH key management](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement)).
  In the Win32-OpenSSH source, the agent stores added keys in the registry, protected with `CryptProtectData` under the
  client's identity, in a registry key that only SYSTEM and Administrators may open, and its named pipe lets
  "Authenticated users" connect with limited rights
  ([`keyagent-request.c`](https://github.com/PowerShell/openssh-portable/blob/0172cc6adb99d8b4324b8f0391b5b1fd6f39b2c6/contrib/win32/win32compat/ssh-agent/keyagent-request.c#L107),
  [`agent.c`](https://github.com/PowerShell/openssh-portable/blob/0172cc6adb99d8b4324b8f0391b5b1fd6f39b2c6/contrib/win32/win32compat/ssh-agent/agent.c#L108-L112)).
  So on Windows, keys survive a restart.

**Containers and SSH.** An agent works over SSH through its socket, and in a container only when the socket is mounted or
forwarded. The earlier presence note covers forwarding (its section 1). The 1Password agent needs the desktop app: "If
1Password is locked, you'll also be prompted to unlock the app", it "doesn't work with Flatpak or Snap Store installations",
and its sockets are `~/.1password/agent.sock` on Linux and `~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock`
on macOS ([get-started](https://www.1password.dev/ssh/get-started/)). Its approval is "per key, per application" by
default, and "Approve for all applications" lets "every process under the current OS user" use the key, "only restricted by
file permissions on the agent socket" ([agent security](https://www.1password.dev/ssh/agent/security/)). The page does not
address SSH sessions or containers.

## 5. How known tools do it

Each tool's default, and its fallback with no keyring.

| Tool | Default | Fallback with no keyring |
|---|---|---|
| GitHub CLI (`gh`) | Token in the system credential store, through `go-keyring` | Plain text file |
| Git credential helpers | Chosen by the person: `osxkeychain`, `libsecret`, `manager` (Git Credential Manager) | `store` (plaintext file), `cache` (memory) |
| Git Credential Manager | macOS Keychain on macOS, Credential Manager on Windows, none on Linux | `gpg`/`pass`, `cache`, plaintext |
| OpenSSH | Key file, mode 0600, optional passphrase | Same file; the agent is optional |
| `age` | Key file, mode 0600 | Same; optional passphrase-protected file |
| Docker | `osxkeychain`, `wincred`, `pass` (then `secretservice`) | base64 in `config.json` |
| 1Password CLI and agent | Desktop app (unlocked) | Service account token, or manual sign-in |

- **`gh`.** `gh auth login` stores the token "securely in the system credential store. If a credential store is not found
  or there is an issue using it gh will fallback to writing the token to a plain text file"
  ([`login.go` lines 78-86](https://github.com/cli/cli/blob/de06af2c2ea536d5722fda35dc2001565f9b9f64/pkg/cmd/auth/login/login.go#L78-L86)).
  The code: if `keyring.Set` fails, it writes the token into `hosts.yml` and reports that insecure storage was used
  ([`config.go` lines 503-543](https://github.com/cli/cli/blob/de06af2c2ea536d5722fda35dc2001565f9b9f64/internal/config/config.go#L503-L543)).
  `--insecure-storage` forces the plain file ([`login.go` line 194](https://github.com/cli/cli/blob/de06af2c2ea536d5722fda35dc2001565f9b9f64/pkg/cmd/auth/login/login.go#L194)),
  and the manual says environment variables such as `GH_TOKEN` are the most suitable way to run `gh` in a "headless" setting such as automation ([manual](https://cli.github.com/manual/gh_auth_login)).
  `gh` uses `go-keyring` v0.2.8 (`go.mod`), which on macOS runs the `security` command, on Linux talks to the Secret
  Service over D-Bus, and on Windows uses Credential Manager and refuses a secret over 2,560 bytes
  ([`keyring_windows.go`](https://github.com/zalando/go-keyring/blob/62684098251952caaa79470ad0046a5cbec2b437/keyring_windows.go#L30)).
  `go-keyring` has no kernel keyring route, so a machine with no Secret Service gets the plain file.
- **Git.** `gitcredentials` lets a person pick a helper. `osxkeychain` uses the macOS keychain, `libsecret` the Secret
  Service (`secret_service_search_sync`,
  [`git-credential-libsecret.c`](https://github.com/git/git/blob/f7de81456940dd6f3274e461149bba12965de609/contrib/credential/libsecret/git-credential-libsecret.c#L118)),
  `store` a plaintext file, and `cache` keeps credentials "in memory of the cache-daemon" for 900 seconds by default
  behind a Unix socket "restricted to the current user"
  ([`git-credential-cache`](https://github.com/git/git/blob/f7de81456940dd6f3274e461149bba12965de609/Documentation/git-credential-cache.adoc#L18-L34)).
  Git Credential Manager's defaults, from its docs: "The default credential stores on macOS and Windows are the macOS
  Keychain and the Windows Credential Manager, respectively. GCM comes without a default store on Linux distributions"
  (credstores.md line 14).
- **OpenSSH key files.** A key file in `~/.ssh` "should be readable by the user but not accessible by others", and `ssh`
  ignores one that is open to others. A passphrase "will be used to encrypt the sensitive part of this file using
  AES-128" (`ssh.1` above). `ssh-keygen` lets the passphrase be empty ("The passphrase may be empty to indicate no
  passphrase", [`ssh-keygen.1` line 225](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh-keygen.1#L225)).
  The agent is how a person avoids typing the passphrase each time.
- **`age`.** `age-keygen -o key.txt` opens the file with mode 0600 and fails if it exists
  ([`keygen.go` line 111](https://github.com/FiloSottile/age/blob/b74dce4cdbe35b5e5f66c06d9612b72f89028758/cmd/age-keygen/keygen.go#L111)),
  and warns on "writing secret key to a world-readable file". The README shows `age-keygen | age -p > key.age` for a
  passphrase-protected identity and says such files "are not necessary for most use cases, where access to the encrypted
  identity file implies access to the whole system" ([README](https://github.com/FiloSottile/age/blob/b74dce4cdbe35b5e5f66c06d9612b72f89028758/README.md#L271-L280)).
  That is the project's own statement of the same-person limit.
- **Docker.** "By default, Docker looks for the native binary on each of the platforms, i.e. osxkeychain on macOS, wincred
  on Windows, and pass on Linux. A special case is that on Linux, Docker will fall back to the secretservice binary if it
  cannot find the pass binary. If none of these binaries are present, it stores the base64-encoded credentials in the
  config.json" ([`docker login`](https://docs.docker.com/reference/cli/docker/login/)). The `secretservice` helper uses
  "the D-Bus secret service" ([README](https://github.com/docker/docker-credential-helpers/blob/e8a52cbcf9ee5e522780b1bbf111fd7503ccb749/README.md)).
- **1Password's command-line tool.** With the desktop app the person signs in "with Touch ID, Windows Hello, or another system
  authentication option". For "headless server authentication" the docs recommend a service account token. Manual sign-in
  is the fallback, and the docs warn: "any process running under the current user can, on some platforms, potentially
  access your 1Password account" ([get started](https://www.1password.dev/cli/get-started/),
  [manual sign-in](https://www.1password.dev/cli/sign-in-manually/)).

The pattern across all of them: try the native store, then fall back to a plain file or an environment variable, and say
so out loud when they do. None of them use the kernel keyring.

## 6. What Node calls

**Child processes, with no package.**

- `security` (macOS): `add-generic-password`, `find-generic-password -w`. The man page says to put `-w` last "to be
  prompted (recommended)"; a password given on the command line is visible to other programs that list processes (my
  reading). `go-keyring` avoids that by sending the command to `security -i` on standard input
  (`keyring_darwin.go`, line 70 onward), so a Node child process should do the same.
- `secret-tool` (Linux): `store`, `lookup`, `clear`, with the secret on standard input. It ships in a package that is often
  separate (Git Credential Manager's setup names `libsecret-tools` on Ubuntu).
- `ssh-keygen -Y sign` and `ssh-add` (all systems, where OpenSSH is installed): the sign route in section 4.
- PowerShell or .NET (`ProtectedData`, `CngKey`): the Windows routes. I did not check which Windows versions ship what.
- `keyctl` (Linux).

**A maintained native package.** I read each package's registry record and source on 2026-11-21.

| Package | Last release | Binaries | Status |
|---|---|---|---|
| `@napi-rs/keyring` 2.1.2 | 2026-10-19 (2.1.0 on 2026-09-13, 2.1.1 on 2026-10-10) | Prebuilt for macOS arm64 and x64, Windows x64, ia32 and arm64, Linux x64 and arm64 (gnu and musl), arm, riscv64, FreeBSD x64 | Maintained; 33.5 million downloads in the 30 days to 2026-11-20 |
| `keytar` 7.9.0 | 2022-02-17 | Builds on install (`prebuild-install \|\| npm run build`) | Repository archived on 2022-12-12; 16.7 million downloads in the same 30 days |
| `@github/keytar` 7.10.6 | 2026-02-06 | Builds on install | Registry marks it deprecated: "Package no longer supported" |
| `cross-keychain` 2.0.0 | 2026-11-08 | Uses `@napi-rs/keyring` | Wraps it |

Sources: the [npm registry records](https://registry.npmjs.org/@napi-rs%2Fkeyring) and
[download counts](https://api.npmjs.org/downloads/point/last-month/@napi-rs/keyring), and the
[`node-keytar` repository](https://github.com/atom/node-keytar) (archived). Download counts are npm's own numbers; I could
not check them.

What `@napi-rs/keyring` does, from its source
([`Cargo.toml`](https://github.com/Brooooooklyn/keyring-node/blob/218f7e7932cb16f66f699add68ca8953f20e501e/Cargo.toml),
[`linux_credential_builder.rs`](https://github.com/Brooooooklyn/keyring-node/blob/218f7e7932cb16f66f699add68ca8953f20e501e/src/linux_credential_builder.rs)):

- It stores bytes (`Entry.setSecret(Uint8Array)`, `getSecret`) or a string. It holds a key. It does not sign. So the
  `Holds` store, with `Store.signingFromHeld` signing in memory, is what it gives.
- On macOS it uses the file-based `keychain` module of `apple-native-keyring-store`, with the `protected` module left out,
  so the host process is the `node` binary.
- On Linux it tries Secret Service first and, "if it fails", falls back to the kernel keyring (`KeyutilsStore`; the code comment reads "fallback to keyutils if it fails") with no
  error to the caller. Section 2 shows that store is cleared at reboot. The package has an option to pin one store, so the
  fallback can be turned into an error (`options.linux.store`, `entry_builder.rs`). My reading: a persistent key needs that
  option, or the caller loses the key at the next reboot and may not know.
- On Windows it uses Credential Manager with a default of `Enterprise` persistence in the store crate it depends on.

**Web Crypto.** Node's `crypto.subtle` supports `Ed25519` ("now stable") and ECDSA, and a `CryptoKey` has an `extractable`
flag: "When `true`, the CryptoKey can be extracted using either `subtle.exportKey()` or `subtle.wrapKey()`"
([Node webcrypto docs](https://github.com/nodejs/node/blob/2b365b28928d9ab36f1e9b41f81beaca83fa772a/doc/api/webcrypto.md)).
Node's docs do not say a key can be saved. The W3C draft says `CryptoKey` objects are serializable and "storing
serializable objects can be used to store CryptoKey objects" with IndexedDB, which is a browser store
([WebCrypto section 13.5](https://www.w3.org/TR/WebCryptoAPI/)). Node has no IndexedDB. I ran this on Node 22.22.3: a
key made with `extractable: false` refuses `exportKey` (`InvalidAccessError`), `structuredClone` copies it inside the same
process, and `v8.serialize` returns 5 bytes that load back as a plain empty object, not a `CryptoKey`, which then fails
to sign (`TypeError`). So in Node a non-extractable key lasts only as long as the process. The later `/webcrypto` entry
point in the answer comment ("signs and generates in the runtime") fits the browser, and in Node it would be `memory`
in effect (my reading). I tested Node 22 only: not confirmed on newer versions, though the docs I read (current `main`)
list no persistence method.

## 7. Same person, another program: what each route guarantees

Plain statements, with the most important first. "Use" means asking the key to sign. "Copy" means getting the bytes.

- **macOS file-based keychain, bytes.** Another program can copy the bytes if it is on the item's trusted list (the
  creator, plus anyone the person approved with Always Allow). Others get a prompt, which cannot show in an SSH session.
  The trusted "program" for a Node tool is `node`, so any script run with the same `node` is trusted (my reading, not
  run).
- **macOS non-extractable ECDSA key.** Copy: no. Use: same list rule as above.
- **Linux Secret Service.** The spec leaves it to the provider. After unlock, other programs of the same user on the
  same bus may be able to read items with no prompt (not confirmed for GNOME Keyring or KWallet).
- **Linux kernel keyring.** Same user ID reads it, within the key's permission mask. A `logon` key blocks reading from
  user space.
- **Key file 0600, and a passphrase-protected file once unlocked.** The same user can read the file. The passphrase
  stops a program that has not got it, but a program in the same session can wait for the person to unlock it (my
  reading).
- **`pass`.** Reading needs `gpg`, which needs the passphrase, cached for up to 10 minutes after each use.
- **Windows Credential Manager and DPAPI.** Any program in the person's logon session reads them. DPAPI separates users,
  not programs.
- **Windows CNG non-exportable key.** Copy: no. Use: a program in the session may ask CNG to sign (my reading).
- **`ssh-agent` with a software key.** Any program that can reach the socket as that user can ask for a signature on any
  bytes, unless the key was loaded with `-c` (confirm) or a lifetime. The man page says it is "easily abused by ... another
  instance of the same user".
- **1Password SSH agent.** A prompt per program by default, with a setting that removes it.
- **Node Web Crypto.** Nothing outside the process holds the key.

One thing all of these share: the only guarantee against same-user use is a prompt on every use that a person must act
on, and the earlier notes cover those. This note's routes only protect against other users, against copying (for the
non-extractable routes), or against theft of the disk (not researched here).

## 8. How this fits the store words (my reading)

- **`Holds`**: Credential Manager, the macOS keychain with bytes, Secret Service, the kernel keyring (loses data at
  reboot), a key file, `pass`. All through `@napi-rs/keyring` or a file. `Store.signingFromHeld` then signs with the
  private half "in memory" (the answer comment's place word). The kernel keyring does not meet "survives a restart", so a
  store built on it should refuse that route when the name needs a persistent key (the comment's route check at start).
- **`Signs`**: an `ssh-agent` (place: in the store) and non-extractable keys on macOS and Windows (ECDSA only). A
  signing store can sign but cannot put the key back, which fits `Signs` without `Generates`.
- **`Generates`**: `ssh-keygen` makes a key file or a key to load into an agent. `SecKeyCreateRandomKey` (macOS) and
  `NCryptCreatePersistedKey` (Windows) make a key inside the store, ECDSA only in what I read. An agent cannot generate. So
  an Ed25519 key that "never leaves the store" does not exist on macOS or Windows in what I found. Ed25519 is "in memory"
  or in an agent.
- **No store at all** (a container, a server with no Secret Service): the fallback every known tool picks is a plain file
  with mode 0600. The route check at start can refuse a name that wants more than the machine gives.

## What this cannot tell us

- I ran no keychain, Secret Service, Credential Manager, DPAPI, CNG or agent command. Every "what a person sees" and
  "works over SSH" line comes from documentation or source. The two claims that matter most and are my reading: that the
  `node` binary is the trusted program for a Node tool's macOS keychain items, and that GNOME Keyring lets any program of
  the same user read an unlocked item. A two-process test on each system would settle them. I did not run a throwaway
  keychain test because creating a keychain file changes the person's keychain search list.
- Not confirmed: when the macOS login keychain unlocks after a restart and over SSH; whether a macOS item already trusted
  for the caller can be read in an SSH session; whether a new Node binary prompts again; any other way to read a
  non-extractable software key out of a macOS keychain file; whether any macOS or Windows API signs with Ed25519 inside a
  store; whether a console program can show CNG's key prompt; whether Windows containers can reach Credential Manager;
  which Linux distributions ship a user unit for `ssh-agent`; which KWallet release first shipped `ksecretd`; who may
  connect to a `gpg-agent` socket; whether `@napi-rs/keyring` changes the Windows `Enterprise` persistence default; what
  happens to an agent's `-c` confirm over SSH with no askpass program.
- The Windows-over-SSH limit rests on Git Credential Manager's docs and a contributor's comments, not a Microsoft page.
- The Web Crypto test ran on Node 22.22.3 only.
- Download counts are npm's own. I did not check how many of them are real installs.
- I did not look for macOS or Windows software-key packages on npm, so "I found no vetted package" means I did not look
  hard, not that none exists. The earlier note vetted only Secure Enclave and hardware-key packages.
- Full-disk encryption, a stolen laptop, and malware running as the person are different threats from the ones asked
  about here, and I did not research how each route holds up against them.

## Sources

Read on 2026-11-21. Code and docs at pinned commits, so the line numbers stay true.

- OpenSSH portable at [`fa4b2a8`](https://github.com/openssh/openssh-portable/tree/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0):
  `ssh-agent.c`, `ssh-agent.1`, `ssh-add.1`, `ssh-keygen.c`, `ssh-keygen.1`, `ssh.1`, `authfile.c`, `PROTOCOL.sshsig`,
  `platform-tracing.c`.
- Win32-OpenSSH fork at [`0172cc6`](https://github.com/PowerShell/openssh-portable/tree/0172cc6adb99d8b4324b8f0391b5b1fd6f39b2c6):
  `contrib/win32/win32compat/ssh-agent/`. Issues [1950](https://github.com/PowerShell/Win32-OpenSSH/issues/1950) and
  [1935](https://github.com/PowerShell/Win32-OpenSSH/issues/1935).
- [SSH Agent Protocol, draft-ietf-sshm-ssh-agent-16](https://www.ietf.org/archive/id/draft-ietf-sshm-ssh-agent-16.txt)
  (19 February 2026).
- Apple: [TN3137](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains),
  [TN2083](https://developer.apple.com/library/archive/technotes/tn2083/_index.html),
  [kSecUseDataProtectionKeychain](https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain),
  [SecKeyCopyExternalRepresentation](https://developer.apple.com/documentation/security/seckeycopyexternalrepresentation(_:_:)),
  [Generating New Cryptographic Keys](https://developer.apple.com/documentation/security/generating-new-cryptographic-keys),
  [SecKeyAlgorithm](https://developer.apple.com/documentation/security/seckeyalgorithm),
  [Storing CryptoKit Keys in the Keychain](https://developer.apple.com/documentation/cryptokit/storing-cryptokit-keys-in-the-keychain),
  [errSecInteractionNotAllowed](https://developer.apple.com/documentation/security/errsecinteractionnotallowed),
  [Mac User Guide: keychain prompts](https://support.apple.com/guide/mac-help/kychn002/mac). On the Mac I used (macOS
  14.3.1): the `security` and `ssh-add` man pages, and the system's `com.openssh.ssh-agent` launch agent file.
- freedesktop.org [Secret Service API](https://specifications.freedesktop.org/secret-service/latest/) (introduction,
  sessions, locking and unlocking). libsecret at [`7ab0b42`](https://gitlab.gnome.org/GNOME/libsecret/-/tree/7ab0b42f5581e5793d6fd32df3f0eea9a20f41b9)
  (`README.md`, `libsecret/secret-backend.c`, `tool/secret-tool.c`). gnome-keyring at
  [`8561976`](https://gitlab.gnome.org/GNOME/gnome-keyring/-/tree/8561976b6b4662330caeb16c921472a89e891ed1)
  (`docs/gnome-keyring-daemon.xml`, `daemon/dbus/gkd-secret-objects.c`).
  [KWallet MR 97](https://invent.kde.org/frameworks/kwallet/-/merge_requests/97).
- Kernel and Linux man pages: [keyrings(7)](https://man7.org/linux/man-pages/man7/keyrings.7.html),
  [persistent-keyring(7)](https://man7.org/linux/man-pages/man7/persistent-keyring.7.html),
  [add_key(2)](https://man7.org/linux/man-pages/man2/add_key.2.html),
  [Yama](https://www.kernel.org/doc/html/latest/admin-guide/LSM/Yama.html),
  [Docker seccomp](https://docs.docker.com/engine/security/seccomp/),
  [GnuPG agent options](https://www.gnupg.org/documentation/manuals/gnupg/Agent-Options.html),
  [`pass.1`](https://git.zx2c4.com/password-store/plain/man/pass.1?id=f554f7974def2e25babfc4c5d15524acb01f42f7).
- Microsoft Learn: [CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata),
  [CredReadW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credreadw),
  [CREDENTIALA](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentiala),
  [Key Storage and Retrieval](https://learn.microsoft.com/en-us/windows/win32/seccng/key-storage-and-retrieval),
  [key storage property identifiers](https://learn.microsoft.com/en-us/windows/win32/seccng/key-storage-property-identifiers),
  [NCryptCreatePersistedKey](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptcreatepersistedkey),
  [NCRYPT_UI_POLICY](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/ns-ncrypt-ncrypt_ui_policy),
  [CNG algorithm identifiers](https://learn.microsoft.com/en-us/windows/win32/seccng/cng-algorithm-identifiers),
  [ProtectedData](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata),
  [OpenSSH key management](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement).
- Known tools: GitHub CLI at [`de06af2`](https://github.com/cli/cli/tree/de06af2c2ea536d5722fda35dc2001565f9b9f64)
  (`internal/keyring/keyring.go`, `internal/config/config.go`, `pkg/cmd/auth/login/login.go`, `go.mod`) and
  [manual](https://cli.github.com/manual/gh_auth_login); `go-keyring` at
  [`6268409`](https://github.com/zalando/go-keyring/tree/62684098251952caaa79470ad0046a5cbec2b437); git at
  [`f7de814`](https://github.com/git/git/tree/f7de81456940dd6f3274e461149bba12965de609) (`contrib/credential/`,
  `Documentation/git-credential-store.adoc`, `git-credential-cache.adoc`); Git Credential Manager at
  [`f0ee0c7`](https://github.com/git-ecosystem/git-credential-manager/tree/f0ee0c7708efec2c16111068507249d5d5583924)
  (`docs/credstores.md`, `docs/secretservice-headless.md`); `age` at
  [`b74dce4`](https://github.com/FiloSottile/age/tree/b74dce4cdbe35b5e5f66c06d9612b72f89028758); Docker
  [`docker login`](https://docs.docker.com/reference/cli/docker/login/) and
  [docker-credential-helpers](https://github.com/docker/docker-credential-helpers/tree/e8a52cbcf9ee5e522780b1bbf111fd7503ccb749);
  1Password [SSH get started](https://www.1password.dev/ssh/get-started/),
  [agent security](https://www.1password.dev/ssh/agent/security/),
  [CLI get started](https://www.1password.dev/cli/get-started/),
  [manual sign-in](https://www.1password.dev/cli/sign-in-manually/).
- Node packages: [`keyring-node`](https://github.com/Brooooooklyn/keyring-node/tree/218f7e7932cb16f66f699add68ca8953f20e501e)
  at `218f7e7`; [`apple-native-keyring-store`](https://github.com/open-source-cooperative/apple-native-keyring-store/tree/1c6d6145dbcd217c30a79112ec7aedff9610a66d),
  [`linux-keyutils-keyring-store`](https://github.com/open-source-cooperative/linux-keyutils-keyring-store/tree/a0796523d57ae90b20df4b7952c3d9550bb174aa),
  [`windows-native-keyring-store`](https://github.com/open-source-cooperative/windows-native-keyring-store/tree/66a9bcd75dc48509e4fbf04b9c42b9fbb686853d);
  npm registry records and download counts for `@napi-rs/keyring`, `keytar`, `@github/keytar`, `cross-keychain`;
  [`node-keytar`](https://github.com/atom/node-keytar) (archived). Node
  [`webcrypto.md`](https://github.com/nodejs/node/blob/2b365b28928d9ab36f1e9b41f81beaca83fa772a/doc/api/webcrypto.md) at
  `2b365b2`; [W3C Web Cryptography API](https://www.w3.org/TR/WebCryptoAPI/) (First Public Working Draft, 22 April 2025).
