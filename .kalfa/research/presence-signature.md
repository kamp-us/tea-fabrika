---
summary: How a command-line program can make a signature that needs a person's touch or biometric on that use, checked per mechanism (OpenSSH FIDO "-sk" keys with ssh-keygen -Y sign, macOS Secure Enclave from a plain binary, Linux and Windows options, sudo with Touch ID, 1Password CLI, git SSH signing, age plugins), with what each one needs, whether the approval is per use or kept, where it stops working (SSH, tmux, containers, lid closed), and how a Node program would call it; every claim cited
---

# Making a signature that needs the human's presence: what a command-line program can use

Question (ticket https://github.com/kamp-us/tea-fabrika/issues/1855): how can a command-line program make a signature
that needs the human's presence (a touch or a prompt) on that use, and where does that stop working? It waits on
https://github.com/kamp-us/tea-fabrika/issues/1854: a `kalfa` write command signs with a key on a person's device, a
coding agent with a shell on that device can run the same command, and some writes should need the person's body.

Read on 2026-11-21. Primary sources only: OpenSSH source and man pages, Apple developer docs, specs, each tool's own
docs and source. A line marked "my reading" is mine, not a source's claim. A line marked "not confirmed" says what I
could not check and what would settle it. I ran no signing command and touched no key. Source code was read at the
commit named in the Sources list.

This note describes what each mechanism guarantees. It is not a guide to getting around any of them.

## The short answer

1. **Best fit: an OpenSSH FIDO key (`ed25519-sk` or `ecdsa-sk`) used through `ssh-keygen -Y sign`.** The touch happens
   inside the key. The key makes the signature only after a touch, and it writes a "user present" bit into the
   signed data. A verifier can check that bit on every signature. From the code and docs it needs no Apple entitlement and no
   window session, and should work over SSH when the key sits on the machine that runs the command, and through a
   forwarded `ssh-agent`. I did not run it.
2. **The catch: `ssh-keygen -Y verify` does not check that bit.** Its source reads the flags and only logs them at
   debug level. `sshd` is the code that enforces them. Our verifier must test the bit itself.
3. **macOS Secure Enclave with Touch ID works from a plain binary, with no entitlement, if the key's encrypted blob is
   kept in a file and not in the keychain.** `age-plugin-se` does exactly that, and its design note says CryptoKit
   "does not require special entitlements" (I read its source; I did not run it). The keychain route needs an app-like
   bundle, an entitlement and a provisioning profile. The Secure Enclave signature does not carry a presence bit, so
   presence is a property of the key, not of each signature.
4. **A check next to a key is not a check on a key.** `sudo` with Touch ID, fingerprint login on Linux, and a "ask
   Windows Hello first" call guard a program. If the signing key is a plain file the program can read, the guard can be
   skipped by whoever runs the program (my reading). Only a key held in hardware that wants the touch is a real gate.
5. **Several known tools keep the approval for minutes.** `sudo` keeps it 5 minutes per terminal by default. The 1Password
   command-line tool keeps it 10 minutes after the last use, up to 12 hours, and shares it with sub-shells. A kept
   approval is the wrong fit for an act that must be the owner's. FIDO keys and one-shot Secure Enclave processes ask each time.

My confidence that the FIDO route through `ssh-keygen` is the best first mechanism: about 80%. The doubts: I did not run
it on the owner's devices, Apple's own `ssh-keygen` has no built-in USB key support (see section 1), and a touch proves a
person was there, not that they saw what they signed (section 7).

## The table

| Mechanism | Per use or kept | Over SSH | In a container | What it needs |
|---|---|---|---|---|
| FIDO `-sk` key, `ssh-keygen -Y sign` | Per signature | Expected yes (not run) if the key is on that host, or through a forwarded agent | Only with the device passed in, or the agent socket forwarded | An OpenSSH with security-key support, a USB key, a udev rule on Linux; on macOS a non-Apple provider library |
| Same key through `ssh-agent` | Per signature | Touch happens on the agent's machine | Docker Desktop (Mac, Linux) can pass the host agent socket | `ssh-add` the key; agent refuses non-SSH data for non-`ssh:` keys |
| macOS Secure Enclave key, blob in a file, plain binary | Per process (one prompt each run) | Not confirmed; Apple's notes say GUI services are missing in SSH sessions | No: needs the Mac's own hardware | Mac with Touch ID or Magic Keyboard with Touch ID; a small Swift helper; no entitlement |
| macOS Secure Enclave key in the keychain (Secretive style) | Per use by default; kept 1 min to 24 h if the person opts in | Yes through a forwarded agent socket, prompt shows on the Mac | Socket forwarding only | A signed app with `keychain-access-groups` entitlement |
| Windows Hello key credential | Per call; newer builds add an optional cache | Not confirmed | Not confirmed | A Windows app; RSA 2048 only on the documented call |
| Linux fingerprint or FIDO through PAM or polkit | Depends on the PAM stack | Not confirmed | Not confirmed | Gates a program only; no key behind it |
| TPM 2.0 key | No standard human test for ordinary key use | n/a | n/a | A policy can ask for a password, not for presence |
| `sudo` with Touch ID (`pam_tid`) | Kept 5 minutes per terminal by default | `pam_tid` skips the prompt over SSH; broken in tmux without a helper | No | Mac; a line in `/etc/pam.d/sudo_local` |
| 1Password CLI biometric unlock | Kept 10 minutes after last use, 12 hour cap, per terminal, includes sub-shells (Mac, Linux) | Not covered by the docs | Not covered by the docs | The 1Password desktop app |

## 1. FIDO keys through OpenSSH

**What the key does.** The OpenSSH protocol note says FIDO keys "can be configured to require indication of 'user
presence' for each signature operation (typically achieved by requiring the user touch the key)". Key creation makes a
key handle stored in the private key file on disk, and a per-device secret that "cannot be exported from the
authenticator hardware"; the two are combined by the hardware when it signs
([PROTOCOL.u2f](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/PROTOCOL.u2f),
[ssh-keygen(1), FIDO section](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh-keygen.1)).
So a copy of the key file alone does not sign.

**Touch is the default.** `ssh-keygen` starts key creation with the user-presence flag on
([`ssh-keygen.c` line 3441](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh-keygen.c#L3441)).
The option `no-touch-required` turns it off for that key, and `verify-required` makes a PIN part of each signature
("Currently PIN authentication is the only supported verification method", ssh-keygen(1)). The `verify-required` option
arrived in OpenSSH 8.4 ([release notes 8.4](https://www.openssh.com/txt/release-8.4)).

**Signing any text.** `ssh-keygen -Y sign -f <key> -n <namespace>` signs files or standard input. The key can be a
private key file, or a public key whose private half is in `ssh-agent`. The namespace is an arbitrary string, and for
custom uses the man page recommends `NAMESPACE@YOUR.DOMAIN`. `-Y verify` takes the allowed-signers file, an identity,
the namespace and the signature file ([ssh-keygen(1)](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh-keygen.1),
[PROTOCOL.sshsig](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/PROTOCOL.sshsig)).
When the key wants presence, `ssh-keygen` prints "Confirm user presence for key ..." to standard error before it signs
([`ssh-keygen.c` lines 2679-2692](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh-keygen.c#L2679-L2692)).
`-Y sign` was added in OpenSSH 8.1 ("an experimental lightweight signature and verification ability",
[release notes 8.1](https://www.openssh.com/txt/release-8.1)); FIDO support in 8.2
([release notes 8.2](https://www.openssh.com/txt/release-8.2)).

**Does the signature prove a touch? Yes, in the signed data.** The signature carries a flags byte and a counter, and
the key signs over "SHA256(application), flags, counter, SHA256(message)" (PROTOCOL.u2f, "SSH U2F signatures"). The
verify code for `ed25519-sk` rebuilds that blob with the flags from the signature, so changing the flags breaks the
signature
([`ssh-ed25519-sk.c` lines 122-230, flags at line 203](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh-ed25519-sk.c#L203)).
The bits are `0x01` user present and `0x04` user verified, from `sk-api.h`, and match the WebAuthn flags table (bit 0 UP,
bit 2 UV) ([`sk-api.h`](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/sk-api.h),
[WebAuthn Level 3, authenticator data](https://www.w3.org/TR/webauthn-3/)). WebAuthn defines a test of user presence as
a simple gesture, typically touching the authenticator, and says it is not user verification.

**But the stock verifier does not check the bit.** `ssh-keygen -Y verify` calls `sshsig_verify_fd`, receives the signature
details, and only writes `signature details: counter = %u, flags = 0x%02x` at debug level 2
([`ssh-keygen.c` `sig_verify`, lines 2916-2919](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh-keygen.c#L2916-L2919)).
The only options `-Y` accepts are `hashalg`, `print-pubkey` and `verify-time`, and the allowed-signers options are
`cert-authority`, `namespaces`, `valid-after` and `valid-before` (same man page, `sig_process_opts` in `ssh-keygen.c`).
I searched `ssh-keygen.c` and `sshsig.c` for a presence check and found none. The code that does enforce it is `sshd`:
it rejects a signature without the user-present bit unless the key has `no-touch-required`, and rejects one without the
user-verified bit when `verify-required` is set
([`auth2-pubkey.c` lines 252-280](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/auth2-pubkey.c#L252-L280)).
My reading: a verifier built on `ssh-keygen -Y verify` (git does this, section 4) accepts a signature from a key
created with `no-touch-required`. Ours must parse the flags and require `0x01` itself (section 6).

**What the bit does not prove.** It proves the authenticator said "user present". It does not say the device is real
hardware. PROTOCOL.u2f describes an attestation, saved only if asked (`-O write-attestation`, "By default, this
information is discarded"), and OpenSSH 10.0 notes a work-in-progress tool to verify those blobs, not installed by
default ([release notes 10.0](https://www.openssh.com/txt/release-10.0)). PROTOCOL.u2f also says the counter "can be used
(at scale) to detect concurrent use of a private key, should it be extracted from hardware". The note's own caution: a
security key "constitutes a single factor of authentication" from sshd's view, even with a PIN.

**Platforms.**

- **macOS, no entitlement named by anyone I read.** OpenSSH's USB support needs libfido2
  ([INSTALL](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/INSTALL),
  `configure.ac` options `--with-security-key-builtin` and `--with-security-key-standalone`), and libfido2 lists macOS as
  supported (`brew install libfido2`), with its macOS code built on IOKit HID
  ([libfido2 README](https://github.com/Yubico/libfido2/blob/308b5e7ea66a465378ce31ffaa435637f06539b9/README.adoc),
  [`hid_osx.c`](https://github.com/Yubico/libfido2/blob/308b5e7ea66a465378ce31ffaa435637f06539b9/src/hid_osx.c)). I searched
  the libfido2 tree for "entitlement" and "Input Monitoring" and found nothing. Not confirmed by running it. **Apple's own
  OpenSSH is the catch.** On macOS 14.3.1 (the one machine I looked at), `ssh -Q key` lists the `sk-` key types, but the
  `ssh-sk-helper` binary contains the text "internal security key support not enabled", and `ssh-keygen` contains the
  OpenSSH FIDO option strings. My reading: Apple's build has the key types but no built-in USB support, so a person
  needs a provider library (`SecurityKeyProvider`, or the `SSH_SK_PROVIDER` environment variable) such as the
  standalone `sk-libfido2` build, or an OpenSSH from another source. Apple's helper also carries the private
  entitlement `com.apple.private.security.clear-library-validation`, which fits loading a provider library (my reading).
  Not confirmed on newer macOS versions; `strings` and `codesign -d --entitlements` on the target Mac would settle it.
- **Linux.** libfido2 is supported; the device needs a udev rule so a normal user can open the HID device (the README
  shows one for Yubico devices). Which distributions build OpenSSH with security-key support: not confirmed.
- **Windows.** Win32-OpenSSH gained FIDO/U2F support in v8.9.0.0p1-Beta (2022-03-18) and has tracked newer libfido2
  since ([release notes](https://github.com/PowerShell/Win32-OpenSSH/releases)). libfido2 can present Windows Hello as a
  FIDO device (`USE_WINHELLO`, default ON, via `webauthn.dll`)
  ([libfido2 `CMakeLists.txt`](https://github.com/Yubico/libfido2/blob/308b5e7ea66a465378ce31ffaa435637f06539b9/CMakeLists.txt),
  [`winhello.c`](https://github.com/Yubico/libfido2/blob/308b5e7ea66a465378ce31ffaa435637f06539b9/src/winhello.c)). OpenSSH 8.3
  moved hashing into the middleware so that "security key middlewares that perform the hashing implicitly, such as
  Windows Hello" can work ([release notes 8.3](https://www.openssh.com/txt/release-8.3)). Whether Windows Hello can hold
  an `ed25519-sk` key, and whether it counts as "a touch" in the sense our verifier needs: not confirmed.
- **No window session.** A USB key needs a finger on the key, not a screen, so I see no GUI dependence in the OpenSSH
  code path. I did not run it over SSH or in tmux: not confirmed. Running `ssh-keygen -Y sign` on a Mac over SSH with
  the key plugged into that Mac would settle it.

**Agent forwarding.** `ssh-agent` signs by calling the key helper on every sign request, and it prints a "Confirm user
presence" notice when the key wants a touch
([`ssh-agent.c` lines 975-1000](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh-agent.c#L975-L1000)).
I found no setting in `ssh-agent(1)`, `ssh-add(1)` or `ssh-keygen(1)` that keeps a touch for later. The touch happens at
the machine that runs the agent, so with `ssh -A` it is the owner's laptop, not the remote host. Two guards: by default
the agent refuses to sign with a FIDO key whose application string does not start with `ssh:` unless the data looks like
an SSH login or an `ssh-keygen` signature (the "websafe" check), so a forwarded agent cannot be turned into a web
sign-in (`-O no-restrict-websafe` turns that off) ([ssh-agent(1)](https://github.com/openssh/openssh-portable/blob/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0/ssh-agent.1),
[release notes 8.4](https://www.openssh.com/txt/release-8.4)); and by default clients of a forwarded agent cannot load
provider libraries (`allow-remote-pkcs11`, same man page).

**Containers.** A container has no USB device by default. Docker's `--device` flag exposes a host device to a container ("It's often necessary to directly expose devices to a
container. The `--device` option enables that"), and `--privileged` "grants access to all host devices" ([docker run reference](https://docs.docker.com/reference/cli/docker/container/run/)).
The simpler route is the host's agent: "Docker Desktop for Mac and Linux lets you use the host's SSH agent inside a
container" through a bind mount of `/run/host-services/ssh-auth.sock`
([Docker Desktop networking how-tos](https://docs.docker.com/desktop/features/networking/networking-how-tos/)). The touch
then happens on the host. Whether a USB key can be passed through Docker Desktop's Mac virtual machine: not stated on
the pages I read; not confirmed.

## 2. macOS Secure Enclave with Touch ID

**What Apple says the Secure Enclave is.** A hardware key manager isolated from the main processor. It "works only
with NIST P-256 elliptic curve keys", for signatures and key agreement, "can't encode preexisting keys", and needs a Mac
with "the Touch Bar and Touch ID or with an M1 or later processor"
([Protecting keys with the Secure Enclave](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave)).
Access control comes from `SecAccessControlCreateWithFlags`. The flag `privateKeyUsage` is needed for signing ("Without
the flag, key generation still succeeds, but signing operations that attempt to use it fail"). `biometryAny` means
Touch ID "for any enrolled fingers", `biometryCurrentSet` "for currently enrolled fingers", `devicePasscode` a passcode,
and `userPresence` "either biometry or passcode"
([SecAccessControlCreateFlags](https://developer.apple.com/documentation/security/secaccesscontrolcreateflags)). My reading:
`userPresence` lets a typed password count, so use a biometry-only flag when "a finger" is the point.

**The keychain route needs more than a bare binary.** Apple's Mac keychain note says "Protecting a key with the Secure
Enclave" is among the features that "require the data protection keychain", that this keychain builds its access groups
"from its code signing entitlements", that those "must be authorized by a provisioning profile", and that the profile
needs "an app-like bundle structure ... standard for app and app extensions but not for command-line tools"
([TN3137](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains),
[Signing a daemon with a restricted entitlement](https://developer.apple.com/documentation/xcode/signing-a-daemon-with-a-restricted-entitlement),
[Sharing access to keychain items](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps)).
The two Secure Enclave SSH agents agree. Secretive "relies on Keychain APIs", and its agent ships a
`keychain-access-groups` entitlement
([README](https://github.com/maxgoedjen/secretive/blob/479075490df3a8d63da184f2997cb37142fd7fda/README.md),
[`SecretAgent.entitlements`](https://github.com/maxgoedjen/secretive/blob/479075490df3a8d63da184f2997cb37142fd7fda/Sources/SecretAgent/SecretAgent.entitlements)).
Sekey says it cannot have a Homebrew formula "because KeyChain API requires entitlements, so the binary has to be
signed to work" ([README](https://github.com/sekey/sekey/blob/master/README.md); last commit January 2019, so unmaintained).

**The file route works from a plain binary.** CryptoKit creates a Secure Enclave key whose `dataRepresentation` the
caller keeps ([SecureEnclave.P256.Signing.PrivateKey](https://developer.apple.com/documentation/cryptokit/secureenclave/p256/signing/privatekey)).
`age-plugin-se` is a command-line Swift program that does exactly this. It builds the access-control object with
`.privateKeyUsage` plus `.biometryAny`, `.biometryCurrentSet`, `.devicePasscode` or `.userPresence`, creates the key
through CryptoKit, and writes the key blob into an identity file. Its README says the private key "is bound to the
secure enclave of your machine, so it cannot be transferred to another machine", and its options are `none`,
`passcode`, `any-biometry`, `any-biometry-and-passcode`, `any-biometry-or-passcode` (default), `current-biometry`,
`current-biometry-and-passcode`
([README](https://github.com/remko/age-plugin-se/blob/57ccea12fc1a3d3bb81b8866745be4d2951c4eaf/README.md),
[`Plugin.swift`](https://github.com/remko/age-plugin-se/blob/57ccea12fc1a3d3bb81b8866745be4d2951c4eaf/Sources/Plugin.swift),
[`Crypto.swift`](https://github.com/remko/age-plugin-se/blob/57ccea12fc1a3d3bb81b8866745be4d2951c4eaf/Sources/Crypto.swift)).
Its design note says the Security-framework route "requires your app to have special entitlements" and a macOS app
structure, while CryptoKit "accesses the Secure Enclave directly, using a very simple API that does not require special
entitlements"
([`Documentation/Design.md`](https://github.com/remko/age-plugin-se/blob/57ccea12fc1a3d3bb81b8866745be4d2951c4eaf/Documentation/Design.md)).
I searched its tree for "codesign", "entitlement" and "notariz" and found them only in that note: no entitlements file
and no signing step in the `Makefile`. The install note for the pre-built binary is "Trust `age-plugin-se` once by Control-clicking the file in Finder", which is the Gatekeeper
prompt, not an entitlement. It uses the key for key agreement (decrypt), and CryptoKit has the signing twin of the
same API. A Node library's README makes the same split: a Secure Enclave key that lives only for the process "works
with any binary including unsigned `node`", while a saved key "requires binary codesigned with the
`keychain-access-groups` entitlement" or the call fails with `errSecMissingEntitlement (-34018)`
([hardware-keys README](https://github.com/nodelibdev/hardware-keys), a three-star project, so a maintainer's claim, not
Apple's). I did not build or run `age-plugin-se`; I did not confirm that a binary with only the linker's default
signature gets a prompt on Apple silicon. My reading from the three sources together is that it does.

**Presence is a property of the key, not of each signature.** An ECDSA P-256 signature from the Secure Enclave carries
no presence bit. The hardware refuses to sign without Touch ID, but a verifier only sees a valid signature. So the
verifier must trust that the public key was registered by the owner with the right access control. I found no key
attestation for Mac Secure Enclave keys in the Apple pages I read (not confirmed that none exists; Apple's Security
and CryptoKit pages for `SecureEnclave` would show it).

**What a process on the same account can and cannot do.** My reading: a process that can read the key blob can ask
the Secure Enclave to sign, and the system then shows the Touch ID prompt; it cannot make the signature without the
finger. It can cause prompts. That matters (section 7). Keys kept in the keychain are narrower: "Keychain restricts
reads of keys to the app (and specifically, the bundle ID) that created them" (Secretive README).

**Where Touch ID stops.**

- **Over SSH or in tmux.** Apple's daemon note says an SSH login gets "a non-GUI per-session bootstrap namespace", and
  "GUI-based services ... only register themselves in GUI per-session bootstrap namespaces"
  ([TN2083](https://developer.apple.com/library/archive/technotes/tn2083/_index.html), an archived note). The
  `pam_reattach` README says Touch ID is among the services "mostly related to the GUI" that are "strictly tied to the
  login session of a user", so a program in a background session such as tmux cannot use it
  ([README](https://github.com/fabianishere/pam_reattach/blob/master/README.md)). Neither page tests a Secure Enclave
  key from an SSH shell. Not confirmed for Secure Enclave keys; a test of a biometry-protected key from a
  `ssh localhost` shell would settle it. A forwarded agent avoids the problem: Secretive's FAQ says that with
  `ForwardAgent yes` "any use of one of your SSH keys on the remote host must be authenticated through Secretive", so
  the prompt shows on the Mac.
- **Screen locked.** A Secretive user report says new SSH sessions fail with "agent refused operation" once the screen
  is locked, while an already-open session still worked
  ([issue 462](https://github.com/maxgoedjen/secretive/issues/462), open, a user's report). Secretive's own key options include one that is usable only while the Mac is unlocked ("Authentication is not permitted
  while the device is locked", `CreationOptions.swift`), so a locked Mac is a known limit.
- **Lid closed.** Not covered by Apple's Touch ID guide, which I read for it
  ([Use Touch ID on Mac](https://support.apple.com/guide/mac-help/use-touch-id-mchl16fbf90a/mac)). A Secretive user
  reports a password prompt instead of Touch ID in clamshell mode
  ([issue 466](https://github.com/maxgoedjen/secretive/issues/466), open, a user's report). Apple's security guide describes a
  Magic Keyboard with Touch ID as a way to get Touch ID on any Mac with Apple silicon, paired to the Secure Enclave
  ([Magic Keyboard with Touch ID](https://support.apple.com/guide/security/magic-keyboard-with-touch-id-secf60513daa/web)).
  Not confirmed: that it carries the prompt for a laptop with the lid closed.
- **Password instead of finger.** "Users must re-enter their password every 48 hours and after five incorrect
  fingerprint attempts" ([Use Touch ID on Mac](https://support.apple.com/guide/mac-help/use-touch-id-mchl16fbf90a/mac)).
  The passcode is also required after restart or logout
  ([Touch ID and Face ID security](https://support.apple.com/guide/security/touch-id-and-face-id-security-sec067eb0c9e/web)).
  With a key that allows a passcode fallback, those cases are a typed password, which is weaker than "a person's finger".

**The prompt can say why.** An `LAContext` has a `localizedReason`, and Secretive fills it with the requesting app and
key name ([`AuthenticationHandler.swift`](https://github.com/maxgoedjen/secretive/blob/479075490df3a8d63da184f2997cb37142fd7fda/Sources/Packages/Sources/SecretAgentKit/AuthenticationHandler.swift)).
It also lists the chain of requesting processes in its notification (`SigningRequestProvenance.swift`: for example
`ssh` -> `git` -> `zsh` -> `login` -> `Terminal.app`). A FIDO key has no screen (section 7).

## 3. Linux and Windows

**A check beside a key versus a check on a key.** On Linux, `fprintd` is "a daemon that provides fingerprint scanning
functionality over D-Bus" and "includes a PAM module to implement user login"
([fprint.freedesktop.org](https://fprint.freedesktop.org/)). Yubico's `pam-u2f` can ask for a touch with `userpresence=1`
and for a PIN or fingerprint with `userverification=1`
([README](https://github.com/Yubico/pam-u2f/blob/master/README.adoc)). Both answer one question for a program: did a
person pass a check? Neither holds a key. I did not find a Linux tool that uses `fprintd` to unlock a signing key per
use: not confirmed (a search of distribution and `fprintd` documentation for such a tool would settle it). Polkit
itself: the `fprintd` page does not mention it; not confirmed.

**TPM 2.0.** A TPM key can be bound to an authorization value or a policy. The spec's idea of "physical presence" is an
"out-of-band authorization" for commands that use platform or hierarchy authority, such as "a dedicated pin in the TPM,
a special signaling method through the TPM interface, or any desired alternative", and it "does not mean that the
signaling requires a human to be physically present"
([TPM 2.0 Part 1, section 19.3](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part1_Architecture_pub.pdf)).
A policy command `TPM2_PolicyPhysicalPresence` exists
([Part 3, section 23.12](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part3_Commands_pub.pdf)), but the
table of commands that need it is platform-specific, and Part 1 says only commands with a platform-hierarchy handle can be put in that
table. The Part 3 text says the command "indicates that physical presence will need to be asserted at the time the
authorization is performed", and does not say how. My reading: the TPM has no standard human-presence test for ordinary use of a signing key. A policy can require a
password (`TPM2_PolicyAuthValue` and `TPM2_PolicyPassword` exist in
[`tss2_tpm2_types.h`](https://github.com/tpm2-software/tpm2-tss/blob/8de0ea01520718789c0e09b07480543f13969c14/include/tss2/tss2_tpm2_types.h)),
which is something a person knows, not a touch.

**Windows Hello.** `KeyCredentialManager.RequestCreateAsync` "generates a new RSA 2048-bit key credential" for "the
current user and application", and `KeyCredential.RequestSignAsync` "prompts the user to cryptographically sign data
using their key credential"
([RequestCreateAsync](https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.keycredentialmanager.requestcreateasync),
[RequestSignAsync](https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.keycredential.requestsignasync)).
On Windows builds 26100 and later, a `KeyCredentialCacheConfiguration` takes a cache option, a timeout and a usage
count ([page](https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.keycredentialcacheconfiguration));
the defaults are not on the page, so I do not know if a call with no configuration prompts every time (my reading is
that it does; not confirmed). I do not know if a console program with no window can show the prompt: not confirmed.
The Node library above implements "Windows TPM" signing as a Windows Hello consent check before the call, not as a
key-bound prompt ("`requireBiometric` ... require Windows Hello via `UserConsentVerifier` before every signing
operation", hardware-keys README). That is a check beside the key.

**FIDO keys on both.** Section 1 covers them. They are the one option that is the same shape on macOS, Linux and
Windows.

## 4. How known tools do it

- **`sudo` with Touch ID (`pam_tid`).** macOS ships `/etc/pam.d/sudo_local.template`, whose own comment says to uncomment
  `auth sufficient pam_tid.so` to enable Touch ID for sudo (read on macOS 14.3.1). `pam_reattach` says `pam_tid` "will try
  to avoid prompting for a touch when connected via SSH", and that programs run under tmux or screen live in a
  background session where the Touch ID service is unavailable, which is why its helper module moves the program into
  the active login session. `sudo` then keeps the approval: "5 minutes unless overridden by the `timestamp_timeout` option",
  with "a separate record for each terminal" (the `tty` default of `timestamp_type`; sudo 1.9.13p2 man page on that Mac).
  `timestamp_timeout` of 0 "always prompt[s]". So Touch ID for sudo is kept, per terminal.
- **1Password command-line tool.** Biometric unlock is asked per account, in each new terminal window or tab. "This
  authorization establishes a 10-minute session that automatically refreshes on each use", "expires after 10 minutes of
  inactivity", with "a hard limit of 12 hours". The session is identified by the terminal: "based on the current `tty`,
  plus the start time" on macOS and Linux, and by process id plus start time on Windows. On macOS and Linux it
  "extends to sub-shell processes in that window"; on Windows sub-shell commands "require separate authorization". The
  prompt names the process. It uses the OS prompt on macOS, PolKit on Linux and Windows Hello on Windows. The page
  warns: when the app locks "all prior authorization is revoked"; a running process "will be able to finish its task";
  root or administrator users "may be able to circumvent one or more security measures"; and on macOS "applications that
  are granted accessibility permissions ... may be able to circumvent the authorization prompt"
  ([App integration security](https://developer.1password.com/docs/cli/app-integration-security/), which redirects to
  https://www.1password.dev/cli/app-integration-security/; I read the redirected page). The setup page covers neither
  SSH nor containers, and gives no process-tree rule
  ([App integration](https://developer.1password.com/docs/cli/app-integration/), redirected to
  https://www.1password.dev/cli/app-integration/).
- **Git commit signing with SSH keys.** Git runs `ssh-keygen -Y sign -n git` and checks with `ssh-keygen -Y verify -n git`
  (or `-Y check-novalidate`)
  ([`gpg-interface.c`, line 1106](https://github.com/git/git/blob/f7de81456940dd6f3274e461149bba12965de609/gpg-interface.c#L1106)).
  The settings are `gpg.format ssh` and `gpg.ssh.allowedSignersFile`
  ([git config, gpg](https://github.com/git/git/blob/f7de81456940dd6f3274e461149bba12965de609/Documentation/config/gpg.adoc)).
  So an `-sk` key gives a touch per commit. My reading, from section 1: git's verifier does not check the touch bit.
- **`age-plugin-yubikey`.** Touch policy defaults to "always"
  ([`builder.rs`](https://github.com/str4d/age-plugin-yubikey/blob/cafbc75fbd309e6f7ab62749052f98a91a89764e/src/builder.rs)),
  and its code treats a "cached" policy as 15 seconds (`FIFTEEN_SECONDS` in `key.rs`). The YubiKey's own rule for cached
  touch I did not read. PIN policy `once` keeps the PIN while the key stays in the same applet session
  ([README](https://github.com/str4d/age-plugin-yubikey/blob/cafbc75fbd309e6f7ab62749052f98a91a89764e/README.md)). This
  plugin uses the YubiKey's smart-card (PIV) mode, not the FIDO mode that OpenSSH uses.
- **`age-plugin-se` and Secretive.** Section 2.

## 5. Per use or kept

For each mechanism, the setting and the default:

- **FIDO `-sk` key.** Per signature. No keep-for-later setting in `ssh-agent`, `ssh-add` or `ssh-keygen` (I searched the
  three man pages). Key option `no-touch-required` removes the touch, so a verifier must reject signatures without the
  bit. Default at key creation: touch required.
- **Secure Enclave key, one process per signature.** The prompt comes from the key's access control, and each new
  process starts a new `LAContext` (age-plugin-se creates one per run). The reuse setting is
  `touchIDAuthenticationAllowableReuseDuration`: "The default value is 0, meaning that Touch ID authentication isn't
  reused", and there is a maximum constant `LATouchIDAuthenticationMaximumAllowableReuseDuration`
  ([property](https://developer.apple.com/documentation/localauthentication/lacontext/touchidauthenticationallowablereuseduration),
  [constant](https://developer.apple.com/documentation/localauthentication/latouchidauthenticationmaximumallowablereuseduration)).
  The maximum's value is not on that page: not confirmed.
- **Secure Enclave key behind a long-running agent (Secretive).** Per use by default. When the person opts in, the
  notification offers to keep approval for 1 minute, 5 minutes, 1 hour or 24 hours
  ([`Notifier.swift`](https://github.com/maxgoedjen/secretive/blob/479075490df3a8d63da184f2997cb37142fd7fda/Sources/SecretAgent/Notifier.swift)).
  The kept approval is stored per key and checked by time, not by process
  ([`AuthenticationHandler.swift`](https://github.com/maxgoedjen/secretive/blob/479075490df3a8d63da184f2997cb37142fd7fda/Sources/Packages/Sources/SecretAgentKit/AuthenticationHandler.swift),
  `authenticatedContexts[AnySecret(secret)]`). While it lasts, any process that can reach the agent socket gets signatures.
- **`sudo` with Touch ID.** 5 minutes per terminal (`timestamp_timeout`, `timestamp_type`).
- **1Password CLI.** 10 minutes after last use, 12 hour cap, per terminal, shared with sub-shells on macOS and Linux.
- **Windows Hello key credential.** Per call; the cache setting is new and its default is unread.
- **`age-plugin-yubikey`.** Touch "always" by default, "cached" 15 seconds in the plugin; PIN "once".

What this means for us (my reading): a kept approval lets another process in the same terminal, or that can reach the same
agent socket, ride on the person's earlier touch. For acts that must be the owner's, the approval should be per
signature: the FIDO key as shipped, or a Secure Enclave key used by a one-shot process with the reuse duration left at 0.

## 6. Calling it from Node

The `kalfa` command is a Node program. For each mechanism that works:

- **FIDO key: a child process, no package needed.** Run `ssh-keygen -Y sign -f <key file> -n <our namespace>` with
  `execFile` (no shell), send the message on standard input, read the armored signature from standard output; the
  "Confirm user presence" line arrives on standard error, which a Node program can show or pass through to the
  person's terminal. Git does the same call
  ([`gpg-interface.c`](https://github.com/git/git/blob/f7de81456940dd6f3274e461149bba12965de609/gpg-interface.c#L1106)).
  On macOS this needs an OpenSSH that can talk to the key (section 1); the command to find the one in use is
  `ssh -Q key` plus a real test, which I did not run.
- **FIDO key: verifying.** Parse the signature ourselves and check the flags. Node's own `crypto.verify` checks ECDSA
  P-256 (after turning the signature's r and s into a format Node reads) and Ed25519 signatures with a public `KeyObject` ([Node `crypto.verify`](https://github.com/nodejs/node/blob/2b365b28928d9ab36f1e9b41f81beaca83fa772a/doc/api/crypto.md)),
  so the one extra step is rebuilding the signed blob from PROTOCOL.u2f and rejecting a flags byte without `0x01`
  (and `0x04` where a PIN is required). An npm package exists: `sshsig` 0.3.1, pure TypeScript, "SSH U2F signatures
  (ECDSA and ed25519)" supported, published 2024-03-12, repository last pushed 2025-07-21, one maintainer. I read its
  source: it parses the flags and the counter into the result (`sig_parser.ts`) and uses them to rebuild the signed blob
  (`verifier.ts`), and I found no presence-bit test, so the caller must add it
  ([repo at `cb28ef2`](https://github.com/wiktor-k/ssh-sig/tree/cb28ef2c6415b918c6441eb6d19fab0916eeb3f5),
  [npm](https://www.npmjs.com/package/sshsig)). I did not run it. It is small enough that a pinned copy or our own
  200-line parser is a fair alternative.
- **Secure Enclave: a small native helper, called as a child process.** A Swift binary like `age-plugin-se` that creates
  a key with a chosen access control, prints the public key, and signs the bytes on its standard input. This is how
  `age` itself calls `age-plugin-se`. No npm package replaces it that I would trust. I checked three: `hardware-keys`
  0.11.17 (Secure Enclave, YubiKey PIV, Windows TPM; N-API prebuilt binaries; published 2026-09-24; first published
  2026-05-22; 3 stars; one maintainer; 841 downloads in the last month), `@authmesh/keystore` 0.7.0 (Secure Enclave,
  keychain, TPM; first published 2026-03-30; 488 downloads in the last month), and `node-mac-auth` 1.1.0 (a Touch ID
  prompt only; last published 2024-06-04). The first two are months old with tiny use. `node-mac-auth` is a yes-or-no
  prompt not tied to any key, and its README says it "will have no effect unless there's an app bundle to own it", so
  it proves nothing about a signature. None is vetted by me. Saved Secure Enclave keys from `hardware-keys` need a
  signed binary with the keychain entitlement, which a plain `node` is not (section 2).
- **Browser WebAuthn (Touch ID passkey, Windows Hello, any security key), as a third route.** A CLI could open a local
  page, let the person approve in the browser, and verify the answer in Node. `@simplewebauthn/server` 14.1.0
  (published 2026-11-06) rejects an assertion without the user-present flag and, by default, one without user
  verification ([`verifyAuthenticationResponse.ts`](https://github.com/MasterKale/SimpleWebAuthn/blob/01d1a640d5ded4fced0b45a9d806fd0ff44ad244/packages/server/src/authentication/verifyAuthenticationResponse.ts)).
  It needs a browser and a window on the same machine, and so it fails over SSH and in a container. I did not check
  how a CLI would host the ceremony or which browsers expose Touch ID passkeys to a `localhost` page: not confirmed.
- **Windows Hello, `sudo`-style PAM checks, 1Password CLI:** each can be run as a child process, but each is a check
  beside a key or a kept approval (sections 3 to 5), not a per-signature proof.

## 7. What this cannot tell us

- **Whether it works on the owner's devices.** I ran no signing and read no device. All platform behavior above is from
  docs, source, and three small local looks at macOS 14.3.1 (`ssh -Q key`, `strings` on `ssh-sk-helper`, `man sudoers`,
  `/etc/pam.d`). Which OpenSSH build each device would use, and which key hardware, is open.
- **Secure Enclave from an SSH shell, in tmux, and with the lid closed.** The Apple pages I could read do not test it;
  the evidence is two user reports and a background-session note. A test on one Mac settles it.
- **What a touch means.** A FIDO key shows nothing; the signed data holds only a hash of the message (PROTOCOL.u2f). So
  the person's touch says "I am here", not "I approve this write". An agent that starts a signing request at the moment
  the person is touching a key for something else could get a signature the person did not mean (my reading; I did not
  check if two requests can queue on one authenticator). A Secure Enclave helper can put a sentence in the prompt
  (`localizedReason`), which helps; a screenless key cannot. Putting a short summary on screen before the key is
  touched is a design choice for a later step.
- **Whether the signature came from real hardware.** The presence bit comes from whatever the key provider says. Only
  attestation saved at enrollment can tie a key to real hardware, and OpenSSH discards it by default. Whether our design
  needs that: not decided here.
- **Secure Enclave attestation on a Mac.** I found none on the pages I read. Not confirmed that none exists.
- **Windows.** I did not confirm that a console program can show a Windows Hello prompt, what the cache default is, or
  that Windows Hello can hold an `ed25519-sk` key.
- **Linux distributions.** Which build OpenSSH with security-key support, and whether a polkit or `fprintd` flow can gate
  a key in practice, is not confirmed.
- **Docker Desktop on a Mac and USB.** Not covered by the pages I read.
- **Package health.** The npm packages named are checked for existence, dates and download counts only. None was run.
  `hardware-keys`, `@authmesh/keystore` and `node-mac-auth` are young or old and small; not recommended.
- **The kept-approval numbers can change.** The 1Password, Secretive and sudo numbers are today's docs and source; the
  Apple reuse maximum is not read.

## Sources

Read on 2026-11-21. Code was read at the commit named here; web pages as served that day.

- OpenSSH portable, `openssh/openssh-portable` at commit `fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0` (2026-11-18):
  `PROTOCOL.u2f`, `PROTOCOL.sshsig`, `ssh-keygen.1`, `ssh-keygen.c`, `ssh-agent.1`, `ssh-agent.c`, `sshsig.c`,
  `ssh-ed25519-sk.c`, `auth2-pubkey.c`, `sk-api.h`, `INSTALL`:
  https://github.com/openssh/openssh-portable/tree/fa4b2a82be7df9768272cfabc2d78e4a12c2b3c0
- OpenSSH release notes 8.1, 8.2, 8.3, 8.4, 10.0: https://www.openssh.com/txt/release-8.1 (and `-8.2`, `-8.3`, `-8.4`,
  `-10.0`)
- Win32-OpenSSH releases: https://github.com/PowerShell/Win32-OpenSSH/releases
- libfido2 at commit `308b5e7ea66a465378ce31ffaa435637f06539b9`: https://github.com/Yubico/libfido2
- W3C Web Authentication Level 3, Recommendation 25 August 2026: https://www.w3.org/TR/webauthn-3/
- Apple: Protecting keys with the Secure Enclave
  (https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave), SecAccessControlCreateFlags,
  CryptoKit SecureEnclave P256 Signing PrivateKey, LAContext `touchIDAuthenticationAllowableReuseDuration`, TN3137
  (https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains), Signing a daemon with a restricted
  entitlement, Sharing access to keychain items, TN2083 (archived), Use Touch ID on Mac, Magic Keyboard with Touch ID, Touch
  ID and Face ID security (support.apple.com/guide/security)
- `remko/age-plugin-se` at `57ccea12fc1a3d3bb81b8866745be4d2951c4eaf`: https://github.com/remko/age-plugin-se
- `maxgoedjen/secretive` at `479075490df3a8d63da184f2997cb37142fd7fda`: https://github.com/maxgoedjen/secretive
- `sekey/sekey` README: https://github.com/sekey/sekey
- `fabianishere/pam_reattach` README: https://github.com/fabianishere/pam_reattach
- `Yubico/pam-u2f` README: https://github.com/Yubico/pam-u2f; fprintd: https://fprint.freedesktop.org/
- TCG TPM 2.0 Library Revision 01.59, Part 1 and Part 3 (8 November 2019):
  https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part1_Architecture_pub.pdf and `..._Part3_Commands_pub.pdf`;
  `tpm2-software/tpm2-tss` at `8de0ea01520718789c0e09b07480543f13969c14`
- Microsoft Learn, Windows.Security.Credentials: KeyCredentialManager.RequestCreateAsync, KeyCredential.RequestSignAsync,
  KeyCredentialCacheConfiguration
- 1Password CLI docs: https://developer.1password.com/docs/cli/app-integration-security/ and `/app-integration/`
  (redirected to https://www.1password.dev/cli/)
- Git at commit `f7de81456940dd6f3274e461149bba12965de609`: `gpg-interface.c`, `Documentation/config/gpg.adoc`
- `str4d/age-plugin-yubikey` at `cafbc75fbd309e6f7ab62749052f98a91a89764e`: https://github.com/str4d/age-plugin-yubikey
- sudoers(5), sudo 1.9.13p2, and `/etc/pam.d/sudo_local.template`, as shipped on macOS 14.3.1 (read locally)
- Docker: https://docs.docker.com/reference/cli/docker/container/run/ and
  https://docs.docker.com/desktop/features/networking/networking-how-tos/
- Node `crypto.verify`, `nodejs/node` at `2b365b28928d9ab36f1e9b41f81beaca83fa772a`, `doc/api/crypto.md`
- npm registry entries, read 2026-11-21: `sshsig` (repo `wiktor-k/ssh-sig` at `cb28ef2c6415b918c6441eb6d19fab0916eeb3f5`),
  `@simplewebauthn/server` (repo `MasterKale/SimpleWebAuthn` at `01d1a640d5ded4fced0b45a9d806fd0ff44ad244`),
  `hardware-keys`, `@authmesh/keystore`, `node-mac-auth`
