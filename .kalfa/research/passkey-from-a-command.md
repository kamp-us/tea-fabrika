---
summary: Whether a Node command-line program can get a passkey (WebAuthn) approval of one message and have anyone check it later, checked against the W3C spec, the FIDO CTAP spec, browser and OS sources and docs, and password manager docs and code - what the checker reads (UP and UV flags inside the signed data), tying the challenge to a message, relying party id and localhost rules, approving on a phone (hybrid), whether each approval is asked anew, platform support, native routes with no browser, and verifier libraries; every claim cited, each gap marked not confirmed
---

# Asking for a passkey approval of one message from a command-line program

Question (ticket https://github.com/kamp-us/tea-fabrika/issues/1856): can a command-line program ask for a passkey
(WebAuthn) approval of one message, and what does that need? It builds on
https://github.com/kamp-us/tea-fabrika/issues/1854: a `kalfa` write command acts as the human who owns the device, a
coding agent with a shell on that device can run the same command, and a few writes should need the person's body. The
earlier note, [presence-signature.md](./presence-signature.md) (ticket
https://github.com/kamp-us/tea-fabrika/issues/1855), covered hardware keys through OpenSSH, bare Secure Enclave keys, and
how long `sudo` and 1Password keep an approval. This note does not repeat that. It covers the passkey route that note
left open.

Read on 2026-11-21. Primary sources only: the W3C WebAuthn and Secure Payment Confirmation specs, the FIDO CTAP spec,
browser source code (Chromium, Firefox, WebKit), Apple, Microsoft, Google and Mozilla docs, and each library's own
source. A line marked "my reading" is mine, not a source's claim. A line marked "not confirmed" says what I could not
check and what would settle it. I ran no passkey ceremony and touched no key. Source code was read at the commit named
in the Sources list. Step numbers in the WebAuthn spec are counted from the rendered numbered list of the 25 August 2026
text.

This note describes what each route guarantees. It is not a guide to getting around any of them.

## The short answer

1. **A browser hop works, and the proof is in the signed data.** An assertion carries a flags byte inside the data the
   authenticator signs. Bit 0 is "user present" (UP) and bit 2 is "user verified" (UV). Anyone who holds the credential's
   public key and knows the expected challenge, origin and relying party id can check the assertion later with no server
   state (WebAuthn Level 3, section 7.2). What an offline check cannot give is freshness: the same assertion stays valid
   for the same message, so the message needs a one-time nonce and someone must remember used nonces (my reading).
2. **A challenge that is a hash of nonce plus message is sound, with one big gap.** The spec wants random, unguessable,
   short-lived challenges of at least 16 bytes. A SHA-256 hash of a random nonce plus the message is 32 bytes and fits
   (my reading). The gap: no browser or OS passkey prompt shows the message. The prompts name the site. The only
   standard way to show signed details is Secure Payment Confirmation, which is payments-only and ships in Chrome and
   Edge. The old `txAuthSimple` extension was in Level 1, is gone from Levels 2 and 3, and I found no browser source that
   implements it. So the page must show the message, and the person must read it.
3. **`localhost` works, `app.example.com` credentials do not.** `http://localhost` counts as a secure context for WebAuthn
   in Chrome and Firefox (source) and, by the code I read, in Safari. A credential for `app.example.com` cannot be used
   from a `localhost` page, and Related Origin Requests cannot fix that. A command can serve its own page on
   `localhost` with its own credential for the relying party id `localhost`. That credential is not tied to a port, so
   any local web server can ask for it.
4. **A phone can approve, but only through a browser near it.** The hybrid transport (QR code) needs Bluetooth on the
   machine that runs the browser, and an internet connection on both devices. Where the command runs does not matter.
   Where the browser runs does. Over SSH or in a container it works if the person opens the printed link in a browser on
   their own device.
5. **Each `get()` is a request for a gesture, but the provider decides how strong it is.** The spec makes a test of user
   presence part of every assertion. Hardware keys clear their kept touch after each assertion (CTAP). Apple and
   Microsoft docs do not say whether their authenticators reuse an unlock between requests. Software passkey
   managers can do less: Bitwarden's source says in a comment that in its autofill flow it defaults UV to true with no
   prompt, "a product decision, rather than a decision based on the expected technical specifications", and
   1Password's own post says its browser extension alone falls back to an account password prompt. So the UV flag is the
   provider's claim. Require `userVerification: "required"`, check the UV bit, and treat it as strong only for
   credentials enrolled from an OS or hardware authenticator.
6. **With no browser, only Windows and hardware keys work for a plain program.** Windows' `webauthn.dll` can be called
   by any program that has a window handle. macOS's AuthenticationServices needs an entitlement and an associated domain,
   or a browser entitlement Apple reviews. Linux `libfido2` talks to hardware keys over USB and NFC only. For a plain
   Node program that must work on all three, with phone and synced passkeys, the browser hop is the only route I found.
7. **Checking in Node or a Worker is easy.** `@simplewebauthn/server` 14.1.0 (published 2026-11-06) checks the UP and UV
   flags, the challenge, the origin and the relying party id. Cloudflare Workers has Web Crypto verify for ECDSA P-256,
   RSASSA PKCS1 v1.5 and Ed25519. SimpleWebAuthn's README lists Workers as a compatible runtime but "actively
   supports" only Node and Deno. I did not run it on Workers.

My confidence that a page on a passkey is the right first route for a Node command: about 80%. The doubts: I ran no
ceremony on the owner's devices, the UV flag from a software passkey manager is only the manager's word (section 5), and
a prompt that never shows the message leaves room for an approval the person did not mean (section 2).

What this means for the lean in ticket 1854 (my reading). The lean holds if four things are true: the checker requires
the UV bit, the owner's credential was enrolled from an OS or hardware authenticator, the page shows the message and a
short code that the command also prints, and the message carries a one-time nonce. It costs an enrollment step, a page
the command can reach, and a nonce store. The enrollment step is the weak spot (section 1).

## The table

| Route | Proof a person was there | Asked each time or kept | Works when the command is on another machine | What it needs |
|---|---|---|---|---|
| Page on the app's https origin, OS passkey (Touch ID, Windows Hello, Chrome's password manager) | UP and UV bits signed in; UV is the OS's claim | Spec asks a gesture per `get()`; Apple and Microsoft docs do not say if they keep one (not confirmed) | Yes, if the person opens the link in a browser on their own device | App server up; credential enrolled for that relying party id; https |
| Same page, phone approves (hybrid) | Same bits; the phone does the check | Per assertion; a linked phone is still proved near by Bluetooth each time | Yes, if the browser's machine has Bluetooth and internet and the phone has internet | A QR scan or a linked phone; a tunnel service |
| Page the command serves on `http://localhost`, relying party id `localhost` | Same bits | Same | Only with a port forward to the person's browser | Separate credential for `localhost`; any local server on any port can ask for it; app need not be up |
| Software passkey manager extension (1Password, Bitwarden) | Bits are the manager's word | May keep: unlock can count as UV in some paths | Same as the first row | Vault unlocked; see section 5 |
| Native Windows `webauthn.dll` | Same bits | Per call (not confirmed that Windows never caches) | Needs a window on the person's Windows machine | Windows 11 per-app passkey consent; a window handle |
| Native macOS AuthenticationServices | Same bits | Not confirmed | No | Associated-domains entitlement and an app, or Apple's reviewed browser entitlement; a plain binary: no |
| `libfido2` with a hardware key | UP and UV from the key | Per assertion (the key clears its cached state) | Only if the key is on the command's machine | USB or NFC key; no synced passkeys, no phone |
| Secure Payment Confirmation | Same bits, plus browser-shown details signed in | Per assertion | Chrome and Edge only | Payments flow, `payment` extension, payee and amount fields |

## 1. What the checker reads

**Where the bits live.** The authenticator data is at least 37 bytes: a 32-byte hash of the relying party id, one flags
byte, and a 4-byte signature counter. Flags bit 0 is User Present, bit 2 is User Verified, bit 3 is Backup Eligibility,
bit 4 is Backup State. "The UP flag SHALL be set if and only if the authenticator performed a test of user presence.
The UV flag SHALL be set if and only if the authenticator performed user verification"
([WebAuthn Level 3, section 6.1](https://www.w3.org/TR/webauthn-3/)). A test of user presence is "(typically) simply
touching" the authenticator and "does not constitute user verification". User verification is the authenticator
locally authorizing the operation by "touch plus pin code, password entry, or ... biometric recognition" (same spec,
definitions "Test of User Presence" and "User Verification").

**They are inside what is signed.** The authenticator signs `authenticatorData || hash`, where `hash` is the SHA-256 of
the client data JSON (section 6.3.3, "Let signature be the assertion signature of the concatenation authenticatorData
|| hash"). The client data JSON holds the type, the challenge, and the origin (section 5.8.1). So one signature covers
the flags, the relying party id hash, the counter, the challenge and the origin together.

**What a verifier must check.** The spec's authentication ceremony, section 7.2, lists these steps (numbers counted from
the rendered list):

- Step 10: the client data `type` is `webauthn.get`.
- Step 11: "the value of C.challenge equals the base64url encoding of pkOptions.challenge".
- Step 12: "the value of C.origin is an origin expected by the Relying Party" (see section 13.4.9: the RP "MUST NOT accept
  unexpected values of origin").
- Steps 13 and 14: the cross-origin and top-origin checks, when those members are present.
- Step 15: "the rpIdHash in authData is the SHA-256 hash of the RP ID expected by the Relying Party".
- Step 16: "the UP bit of the flags in authData is set".
- Step 17: user verification "SHOULD be required if, and only if, pkOptions.userVerification is set to required". If it
  was, "verify that the UV bit of the flags in authData is set. Otherwise, ignore the value of the UV flag."
- Steps 18 and 19: if BE is not set, BS must not be set; backup state is compared with the stored record if the RP uses
  it.
- Steps 20 and 21: hash the client data with SHA-256 and "using credentialRecord.publicKey, verify that sig is a valid
  signature over the binary concatenation of authData and hash".
- Step 22: if either signature counter is non-zero, a new counter that is not greater than the stored one "is a signal,
  but not proof, that the authenticator may be cloned"; whether to fail is "Relying Party-specific". Counters are a
  clone hint, not a proof of presence (section 6.1.1: authenticators that keep none "leave the signCount ... constant at
  zero").

**Offline, with no server state: yes, for the proof; no, for freshness.** Steps 10 to 21 use only the three response
parts (`authenticatorData`, `clientDataJSON`, `signature`), the stored public key, and the expected challenge, origin
and relying party id. Nothing in them needs a live session. The spec does say the RP "SHOULD store the challenge
temporarily until the operation is complete" (section 13.4.3), because a stored one-time challenge stops replay. If the
challenge is recomputed from the message, nothing stops the same assertion from being presented again for the same
message. That needs a nonce in the message and a record of used nonces (my reading).

**What the flags do not prove.** Section 6.1 says these bindings "derive their trust from the WebAuthn Relying Party's
assessment of the security properties of the authenticator", and "in one extreme case, the authenticator may be
embedded in the client, and its bindings may be no more trustworthy than the client data". Attestation, at
registration, is the way to learn what kind of authenticator it was, and section 13.4.4 says attestation "provides no
means for a Relying Party to verify that an attestation object was generated by the authenticator the user intended"
against a man in the middle. After a secure registration, later assertions "are resistant to tampering". My reading:
the first enrollment of the public key is the step to protect, because after that the checker only knows "someone with
this key and this flag".

A browser can be given a virtual authenticator. Chrome's DevTools Protocol has `WebAuthn.addVirtualAuthenticator` with
`automaticPresenceSimulation` ("tests of user presence will succeed immediately") and `isUserVerified`
([WebAuthn.pdl](https://github.com/ChromeDevTools/devtools-protocol/blob/62afb853b4629b6059542166e4eeb2975ce52f58/pdl/domains/WebAuthn.pdl)).
It signs only with keys it holds, so it cannot sign for a key enrolled on the owner's real authenticator. My reading: it
can enroll its own key if enrollment is not itself gated by the owner.

## 2. Tying the approval to one message

**Is a hash of the message a sound challenge?** The spec says the challenge "MUST be randomly generated by Relying
Parties in an environment they trust", "MUST contain enough entropy to make guessing them infeasible" and "SHOULD
therefore be at least 16 bytes long". It says the RP SHOULD store the challenge until the operation ends, and that
challenges "SHOULD be valid for a duration similar to the upper limit of the recommended range and default for a
WebAuthn ceremony timeout" (section 13.4.3). That range is 300000 to 600000 milliseconds, default 300000
(section 15.1). The challenge exists "to avoid replay attacks".

My reading: `challenge = SHA-256(nonce || message)` meets the length (32 bytes) and the entropy, as long as the nonce is
random, single-use, made by the party that checks, and short-lived. It differs from the text in one way: the
challenge is derived, not stored. A verifier that holds the message and the nonce can recompute it, which is what
`@simplewebauthn/server` allows with an `expectedChallenge` that is a function
([`verifyAuthenticationResponse.ts` lines 118-126](https://github.com/MasterKale/SimpleWebAuthn/blob/01d1a640d5ded4fced0b45a9d806fd0ff44ad244/packages/server/src/authentication/verifyAuthenticationResponse.ts#L118-L126)).
A message with no nonce would give a challenge anyone can compute, and so an assertion that can be replayed.

**The prompt does not show the message.** The CTAP spec says: "If the authenticator has a display, show the rpId parameter value to the user, and request
permission to create an assertion" (CTAP 2.3, authenticatorGetAssertion procedure). Chrome's Touch ID prompt builds its text from the relying party id
(`IDS_WEBAUTHN_TOUCH_ID_PROMPT_REASON` with `request_.rp_id`, [`get_assertion_operation.mm`
lines 73-77](https://github.com/chromium/chromium/blob/a7b8222d1892bc9f37a46d2d1339603a36c23b77/device/fido/mac/get_assertion_operation.mm#L73-L77)).
The WebAuthn spec says an assertion signature "also asserts additional information, termed client data ... such as the
means by which user consent was provided, and the prompt shown to the user by the authenticator" (section 6), but the
client data it defines (type, challenge, origin, cross-origin and top-origin, section 5.8.1) has no member for a prompt
text; SPC adds one. So the approval binds the signature to the message, and the person's belief about the message comes only from what the page
showed. My reading: a program on the same machine that can start its own approval request can put a different message
on a page. A short code shown both in the terminal and on the page, and an assertion check on that code, narrows this
without changing the protocol.

**Known systems that sign a transaction with WebAuthn.**

- **`txAuthSimple`.** It is section 10.2 of WebAuthn Level 1 (Recommendation of 4 March 2019): the RP gives "a prompt
  string, intended for display on a trusted device on the authenticator", and "the authenticator MUST display the prompt
  to the user before performing either user verification or test of user presence"
  ([Level 1](https://www.w3.org/TR/webauthn-1/)). A text search of Levels 2 and 3 finds no `txAuth` section. The IANA
  extension registry still lists `txAuthSimple` and `txAuthGeneric` and points at the Level 1 sections
  ([IANA WebAuthn registries](https://www.iana.org/assignments/webauthn/webauthn.xhtml), last updated 2023-09-13). I
  searched GitHub code for `txAuthSimple` in the Chromium, Firefox and WebKit mirrors and got no hits, which is not
  proof that none implements it (code search on very large repos can miss files). Not confirmed; reading each engine's
  extension list would settle it.
- **Secure Payment Confirmation (SPC).** A W3C Candidate Recommendation Draft of 13 October 2026
  ([spec](https://www.w3.org/TR/secure-payment-confirmation/)). Its own motivation says that with plain WebAuthn, putting
  payment details in the challenge "is a misuse of the challenge field (which is intended to defeat replay attacks)",
  that each bank would "devise its own format", and that "Plain [webauthn-3] does not provide for this display:
  there is no specified UX associated with information stored in the challenge field". SPC instead has the browser show the
  payee, instrument and amount, and sign them into the client data (`payment` member with `rpId`, `topOrigin`,
  `payeeName`, `payeeOrigin`, `total`, `instrument`), and it "guarantees that the user agent has presented the
  payment-specific information to the user in a way that a malicious website ... cannot bypass". The `payment`
  authentication extension "can only be accessed via PaymentRequest with a 'secure-payment-confirmation' payment
  method", and SPC hard-codes `userVerification` to "required" ("because that is what Chrome's initial implementation
  supports"). Support: Chrome 95 and later (Edge mirrors it); Firefox and Safari: not supported
  ([MDN browser-compat-data, `PaymentRequest.json`](https://github.com/mdn/browser-compat-data/blob/1edef63031c8bbc2844b3f48e092433eecc4842e/api/PaymentRequest.json),
  marked experimental). My reading: its required fields (amount, currency, payee, instrument icon) make it a poor fit
  for a command's write.
- **Payment confirmation by banks with plain WebAuthn.** SPC's text describes this as the status quo. I did not read a
  specific bank's flow.

## 3. The relying party id and `localhost`

**The rule.** "A public key credential can only be used for authentication with the same entity (as identified by RP
ID) it was registered with." The RP ID "must be equal to the origin's effective domain, or a registrable domain suffix of
the origin's effective domain", and the origin's scheme must be https, or its host must be `localhost` with scheme http.
"The origin's port is unrestricted." Example in the spec: from `https://login.example.com:1337` the valid ids are
`login.example.com` and `example.com`, not `m.login.example.com` and not `com`
([WebAuthn Level 3, definition "Relying Party Identifier"](https://www.w3.org/TR/webauthn-3/)). "Only the domain format of
host is allowed" for the id, so an IP address is not a valid relying party id (section 5.1.4.1). The origin is signed into
every assertion, and the id hash is signed too (section 5 and 6.1).

**Secure context.** Clients "only expose the Web Authentication API in secure contexts" (sections 5 and 13.4.8). `localhost` is
potentially trustworthy in the Secure Contexts spec, when the browser follows the name-resolution rules that keep it
on the loopback address ([Secure Contexts, sections 3.1 and 5.2](https://www.w3.org/TR/secure-contexts/)).

- **Chrome.** Its check says "http origins are effectively restricted to just `localhost`", rejects IP-address hosts, and
  its unit tests list `http://localhost` and `https://localhost` as valid for the id `localhost`, `https://localhost`
  invalid for `example.com`, and `http://127.0.0.1` invalid
  ([`webauthn_security_utils.cc` lines 36-46](https://github.com/chromium/chromium/blob/a7b8222d1892bc9f37a46d2d1339603a36c23b77/components/webauthn/core/browser/webauthn_security_utils.cc#L36-L46),
  [`..._unittest.cc` lines 24-32, 73-79](https://github.com/chromium/chromium/blob/a7b8222d1892bc9f37a46d2d1339603a36c23b77/components/webauthn/core/browser/webauthn_security_utils_unittest.cc#L24-L79)).
  The page has to use the name `localhost`, not `127.0.0.1`.
- **Firefox.** Its code says it relaxes the spec's third condition slightly and exposes WebAuthn "in all secure
  contexts", and it requires the principal to be potentially trustworthy
  ([`WebAuthnUtil.cpp` lines 267-300](https://github.com/mozilla-firefox/firefox/blob/a3178f3cbfac6e25d5bc7b6365c4ff520a42205e/dom/webauthn/WebAuthnUtil.cpp#L267-L300)).
  Its tests include `http://localhost/` with the id `localhost`.
- **Safari (WebKit).** `PublicKeyCredential` and `CredentialsContainer` are `[SecureContext]` in the WebKit IDL
  ([`PublicKeyCredential.idl`](https://github.com/WebKit/WebKit/blob/277895b0a3253027044cbc9235ef0df48bae2fb4/Source/WebCore/Modules/webauthn/PublicKeyCredential.idl)),
  and WebKit's `SecurityOrigin::isPotentiallyTrustworthy` treats `localhost` and loopback addresses as trustworthy
  ([`SecurityOrigin.cpp` lines 90-105](https://github.com/WebKit/WebKit/blob/277895b0a3253027044cbc9235ef0df48bae2fb4/Source/WebCore/page/SecurityOrigin.cpp#L90-L105)).
  I did not find a WebAuthn-specific `localhost` check in `AuthenticatorCoordinator.cpp`. The platform passkey sheet is
  Apple's own (WebKit hands it to AuthenticationServicesCore), and its source is not public. Whether Safari shows a
  Touch ID passkey sheet for `http://localhost` in practice: not confirmed; opening a test page in Safari would settle
  it.

**Can a passkey made for `app.example.com` be used on a `localhost` page? No.** In the `get()` algorithm, if the given
`rpId` "is not a registrable domain suffix of and is not equal to effectiveDomain", the client throws a `SecurityError`,
unless it supports Related Origin Requests and the check passes (section 5.1.4.1, "If pkOptions.rpId is present ...").
Chrome's unit test `{"https://localhost", "example.com", false}` is this rule. The authenticator also checks that the id
matches the credential's id (section 6.1: "validated by the authenticator ... by verifying that the RP ID ... exactly
matches").

**Related Origin Requests change little here.** They let an RP list other origins in
`https://<rpId>/.well-known/webauthn`, which "MUST be served using HTTPS" with an `origins` array (section 5.11). The
validation loop reads each listed origin's "registrable origin label", skips an origin whose label is empty or null, and
returns true only on a same-origin match (section 5.11.1). "Registrable origin label" is "null if the registrable
domain is null" (definitions). My reading: `localhost` has no registrable domain, so a `localhost` origin cannot pass
this loop. Support: Chrome and Edge 128+, Safari on macOS 15+, iOS 18+, Firefox 152+ per
[passkeys.dev](https://github.com/passkeydeveloper/passkeys.dev/blob/e031b4c3dee34741ec349fe200db181553ac5641/content/en/device-support/index.md)
(a FIDO Alliance and W3C community site). The spec says clients must support at least five registrable origin labels.

**Can a command serve its own page on `localhost` with a credential made for `localhost`?** Yes by the rules above: the
origin is `http://localhost:<port>`, the id is `localhost`, and the port is unrestricted. Two consequences from the same
text. The credential is not tied to a port, so any program that serves a page on any port of that machine can ask the
authenticator for an assertion for the id `localhost`; the check on `C.origin` (step 12) has to name the exact port
the command chose. And the credential is a different one from the app's, enrolled separately.

**Does a synced passkey for `localhost` work across devices? Not confirmed.** Chrome's own authenticator accepts the id
`localhost` (above). The Google, Apple and Microsoft docs I read do not say whether a synced provider stores credentials
for it, and a provider's own ceremony for `localhost` was not run. A test with each provider on two devices would settle
it.

**Subdomains.** The rule above also means a page on `https://approve.example.com` may use a credential whose id is
`example.com`. My reading: choosing the id at the registrable domain lets any subdomain page use the credential, so the
origin check matters.

## 4. Approving on another device

**What hybrid is.** CTAP 2.3 section 11.5: "Hybrid transports decouple the proof that the client platform is physically
close to the authenticator ... from the transport of messages". It "is intended to connect authenticators with cameras,
typically phones, to a client platform". It "involves a data transfer channel and proof of device proximity. Bluetooth
LE (BLE) advertisements are used for proof of proximity." The channel "can either require network communication via a
service called a tunnel service, or use local communication". A tunnel service is "a highly available network service with
a domain name known to the authenticators that use it"; the assigned ones are `cable.ua5v.com` and `cable.auth.com`
([CTAP 2.3](https://fidoalliance.org/specs/fido-v2.3-ps-20260226/fido-client-to-authenticator-protocol-v2.3-ps-20260226.html)).

**What each side needs.**

- The client platform (the machine whose browser shows the page) shows a QR code that holds a public key and a 16-byte
  secret. It must receive a BLE advertisement from the phone: "This transport requires a proof of proximity ... Without a
  proof of proximity a web site could, for example, display a QR code and attempt to convince the user to scan it".
  So it needs a Bluetooth radio near the phone.
- The phone scans the QR code (it needs a camera), advertises over BLE, and connects to the tunnel service. Both sides
  reach the tunnel service over the internet, unless a local channel is used. Microsoft's docs say the same: "both the
  Windows device and the mobile device must have Bluetooth enabled and connected to the Internet"
  ([Microsoft Learn, Passkeys in Windows](https://learn.microsoft.com/en-us/windows/security/identity-protection/passkeys/)).
- A linked phone can be reached again with no QR code (state-assisted transactions), but the phone "will send its
  handshake message and start advertising over BLE as a proximity challenge", so Bluetooth proximity is still needed
  (CTAP 2.3, section 11.5.2).
- Phones as the approving device: Android 9 and later and iOS/iPadOS 16 and later as authenticators; Chrome and Edge on
  Linux, macOS 13 and later, and Windows 11 23H2 and later as hybrid clients
  ([passkeys.dev device support](https://github.com/passkeydeveloper/passkeys.dev/blob/e031b4c3dee34741ec349fe200db181553ac5641/content/en/device-support/index.md)).
  Google says "Chrome on all platforms supports cross-device authentication"
  ([Passkey support on Android and Chrome](https://developers.google.com/identity/passkeys/supported-environments), updated
  2025-05-19). Firefox on Linux does not: Mozilla's bug "Implement CTAP2 hybrid transport ... for platforms that use
  authenticator-rs (e.g. Linux)" is assigned, last changed 2026-10-29
  ([Bugzilla 1543674](https://bugzilla.mozilla.org/show_bug.cgi?id=1543674)).

**Over SSH or in a container.** Hybrid cares where the browser is, not where the command is. If the command runs on a
remote host or in a container and the person opens the printed link in a browser on a laptop or phone they hold, the
phone and that browser do the whole ceremony. A command inside a container or on a remote box usually has no browser
and no Bluetooth near the person, so it can only print a link (my reading, from the CTAP text above). The device-flow shape
fits: the command prints a link and a short code, the person opens it on any device, and the app's server (or the
command, if it served the page) gets the assertion. Two cases from section 3 follow. If the page is on the app's https
origin, the command waits on the server. If the page is the command's own `localhost` page on a remote host, the
person's browser must reach it through a port forward, and the origin the browser reports is then
`http://localhost:<local port>` on their machine; the checker must expect that exact origin (my reading).
If the person opens the link on the phone itself, no hybrid is needed: the phone is the client and the authenticator.

**What the phone can see.** CTAP gives an authenticator the relying party id and a client data hash, and one with a
display shows the id (section 2). The authenticator cannot tell which page or program asked (my reading: the inputs CTAP
lists for `authenticatorGetAssertion` are the relying party id, the client data hash, the allow list, options and
extensions, and no origin). So the phone's prompt names the site, not the message and not the program.

## 5. Asked anew each time?

**What the spec says.** In `authenticatorGetAssertion`, `requireUserPresence` is "the constant Boolean value true", and
the authenticator must "collect an authorization gesture confirming user consent for using selectedCredential"; "if
requireUserVerification is true, the authorization gesture MUST include user verification. If requireUserPresence is
true, the authorization gesture MUST include a test of user presence" (section 6.3.3). The only relaxation I found is for
credential creation with `mediation: "conditional"` (sections 5.1.3 and 6.3.2). What the person does to satisfy it is the
authenticator's or client's choice; "the prompt ... may be shown by the authenticator ... or by the user agent".

**`userVerification: "required"` guarantees what.** "The Relying Party requires user verification for the operation and
will fail the overall ceremony if the response does not have the UV flag set. The client MUST return an error if user
verification cannot be performed" (section 5.8.6). The flag is what the authenticator reports. The spec's own text on
trust is section 6.1 (section 1 above).

**Hardware keys keep nothing past the assertion.** CTAP 2.3: after a `getAssertion` with a PIN/UV auth token, the
authenticator "consumes both the 'user present state', sometimes referred to as the 'cached UP', and the 'user verified
state'". A user-present flag can be held for up to 30 seconds (USB, BLE and internal; 19.8 seconds on NFC), and
"authenticators MAY use other values ... including zero" ("user present time limit", section 6.5.2.1). So a key can
keep a touch for seconds before one assertion, never across assertions.

**Chrome and the platform authenticators.**

- **Chrome on macOS, its own profile authenticator.** Keys are made with `kSecAccessControlUserPresence`
  ([`touch_id_context.mm` line 60](https://github.com/chromium/chromium/blob/a7b8222d1892bc9f37a46d2d1339603a36c23b77/device/fido/mac/touch_id_context.mm#L60)),
  and the Touch ID prompt runs when UV is "required" or the device has biometrics
  (`ProfileAuthenticatorWillDoUserVerification`, [`util.mm` lines 195-200](https://github.com/chromium/chromium/blob/a7b8222d1892bc9f37a46d2d1339603a36c23b77/device/fido/mac/util.mm#L195-L200)).
  With `discouraged` and no biometrics, it signs with no prompt of that kind (`GenerateResponses(... has_uv=false)`).
- **Chrome with Google Password Manager (Windows, macOS, Linux).** Its code picks an enclave user-verification method
  per request. For `required` it always verifies. For `preferred` it verifies on Windows and Mac only if biometrics
  exist, and on Linux never; `discouraged` never
  ([`gpm_user_verification_policy.cc` lines 12-30](https://github.com/chromium/chromium/blob/a7b8222d1892bc9f37a46d2d1339603a36c23b77/components/webauthn/core/browser/gpm_user_verification_policy.cc#L12-L30)).
  The methods include `kUserPresenceOnly`, `kPIN` (the Google Password Manager PIN), `kUVKeyWithSystemUI` (system
  dialog), and `kImplicit`, used right after the person entered the PIN for recovery
  ([`gpm_enclave_controller.cc` lines 234-281](https://github.com/chromium/chromium/blob/a7b8222d1892bc9f37a46d2d1339603a36c23b77/chrome/browser/webauthn/gpm_enclave_controller.cc#L234-L281),
  [`gpm_enclave_transaction.cc` lines 163-215](https://github.com/chromium/chromium/blob/a7b8222d1892bc9f37a46d2d1339603a36c23b77/chrome/browser/webauthn/gpm_enclave_transaction.cc#L163-L215)).
  The client-key types in the enclave code say a hardware key "can be used silently", while a user-verified key "can
  only be used for signing after the user has performed some explicit action such as providing a local biometric or
  PIN" ([`types.h` lines 40-54](https://github.com/chromium/chromium/blob/a7b8222d1892bc9f37a46d2d1339603a36c23b77/device/fido/enclave/types.h#L40-L54)).
  My reading: with `required`, Chrome's Google Password Manager asks for UV on each request; I read the selection logic,
  not a run. Whether Chrome keeps a PIN entry between requests: not confirmed.
- **Safari and iCloud Keychain.** Apple's docs say passkeys "rely on biometric identification, such as Touch ID and Face
  ID in iOS, or a specific confirmation in macOS" ([Supporting passkeys](https://developer.apple.com/documentation/authenticationservices/supporting-passkeys)),
  and Apple's security article says Touch ID or Face ID "can be used to authorize use of the passkey"
  ([About the security of passkeys](https://support.apple.com/en-us/102195)). Neither says whether it asks every time.
  Not confirmed; testing two sign-ins in a row on a Mac would settle it.
- **Windows Hello.** "The private keys can only be used after they're unlocked by the user using the Windows Hello unlock
  factor (biometrics or PIN)" ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/security/identity-protection/passkeys/)).
  The docs say nothing on keeping an unlock between requests: not confirmed.
- **Android.** Passkeys are used with "device's built-in unlock mechanisms such as pattern, PIN, password or biometrics"
  ([Android Developers, About passkeys](https://developer.android.com/identity/passkeys), updated 2026-11-18); each-time
  behavior: not confirmed.

**Third-party providers.**

- **Bitwarden** (source at the commit in Sources). The assertion code sets `userPresence: true` in the flags it builds
  and `userVerification: userVerified`
  ([`fido2-authenticator.service.ts` lines 336-343](https://github.com/bitwarden/clients/blob/f9c68e008ba91dc19edf519305a82d3a994a7baa/libs/common/src/platform/services/fido2/fido2-authenticator.service.ts#L336-L343)).
  The prompt is skipped when the request is a conditional (autofill) one and a single credential matches
  (`assumeUserPresence`), unless the item has a master password reprompt
  ([`fido2-client.service.ts` lines 399-436](https://github.com/bitwarden/clients/blob/f9c68e008ba91dc19edf519305a82d3a994a7baa/libs/common/src/platform/services/fido2/fido2-client.service.ts#L399-L436)).
  In that path the comment reads: "we are defaulting to a userVerified status of `true` when the request is for a
  conditionally mediated authentication ... This is a product decision, rather than a decision based on the expected
  technical specifications", and the code returns the request's own `userVerification` value as the result
  ([`browser-fido2-user-interface.service.ts` lines 247-253](https://github.com/bitwarden/clients/blob/f9c68e008ba91dc19edf519305a82d3a994a7baa/apps/browser/src/autofill/fido2/services/browser-fido2-user-interface.service.ts#L247-L253)).
  So there UV is true because the site asked for it, with no check. In the other paths, the browser extension's
  verification service says "If the request is from the lock screen, treat unlocking the vault as user verification,
  unless a master password reprompt is required", and otherwise shows a verification dialog when UV is requested
  ([`fido2-user-verification.service.ts` lines 27-50](https://github.com/bitwarden/clients/blob/f9c68e008ba91dc19edf519305a82d3a994a7baa/apps/browser/src/vault/services/fido2-user-verification.service.ts#L27-L50)).
  A page that calls `get()` without `mediation: "conditional"` does not take the conditional path. Which dialog (master
  password, PIN, or biometric) appears in each build: not confirmed.
- **1Password.** Its own post of 19 October 2026 says UV "is a local identity check a website can require", that the
  decision "belongs to the website, not 1Password", and that since 27 August the mobile and desktop apps "prompted for UV
  whenever a passkey flow requires it", using "native APIs provided by the operating system". For the browser extension
  alone: "If a website requires UV in an extension-only flow, we are of the opinion that the only viable fallback today
  is another 1Password account password prompt", and the fix they propose (`browser.secureCache`) is a draft
  ([A path to user verification in 1Password](https://1password.com/blog/user-verification-passkeys)). The support pages I
  read say nothing on whether a request that does not require UV is approved with no prompt once the vault is unlocked
  ([passkey-security](https://support.1password.com/cs/passkey-security/), [passkeys](https://support.1password.com/cs/passkeys/)).
  Not confirmed; a test with `userVerification: "discouraged"` on an unlocked vault would settle it.
- **Browser's own manager.** Covered above (Chrome); Firefox on macOS uses iCloud Keychain passkeys since version 122
  ([Firefox 122 release notes](https://www.mozilla.org/en-US/firefox/122.0/releasenotes/)).

**What this means for the checker (my reading).** The UP bit alone proves little: it can be set after a click. The UV
bit is stronger when the credential lives in an OS or hardware authenticator that does the check itself, and weaker when
a software manager reports it. `required` forces the check on the paths I read, but the flag is still the provider's
word (section 1). If the owner's enrolled credential must be a hardware or OS one, the checker needs a way to know
that: attestation (not available from synced providers; passkeys.dev lists device-bound passkey attestation as available
only on Windows) or a rule at enrollment, such as "enroll with the security key or the Touch ID platform
authenticator".

## 6. Platform support

| Platform | What is there | Source |
|---|---|---|
| macOS, Safari | Touch ID or Face ID passkeys in iCloud Keychain, hybrid client (macOS 13 and later) | Apple docs; passkeys.dev |
| macOS, Chrome | Google Password Manager, iCloud Keychain (macOS 13.5 and later), or a Chrome profile key behind Touch ID | Google, Chromium source |
| macOS, Firefox | iCloud Keychain passkeys since Firefox 122; the Touch ID prompt itself: not confirmed | Mozilla release notes |
| Windows, Chrome/Edge/Firefox | Windows Hello (face, fingerprint, PIN), plugin passkey managers on newer builds, hybrid client from 23H2 | Microsoft Learn; passkeys.dev |
| Linux, Chrome | Google Password Manager with a PIN (the first save asks to make one), hybrid client | Google; Chrome blog |
| Linux, Firefox | Hardware security keys; no hybrid (bug 1543674 open); no platform authenticator found | Mozilla bug tracker |
| iOS, iPadOS | iCloud Keychain with Face ID or Touch ID; the approving device for hybrid | Apple; CTAP; passkeys.dev |
| Android | Credential Manager with Google Password Manager; screen lock, PIN or biometrics; approving device for hybrid (Android 9 and later) | Android Developers; Google |

Details I read:

- **Linux with no phone and no hardware key.** Chrome on Linux has passkeys in Google Password Manager: "Passkeys created
  in Chrome on Linux are stored in the Google Password Manager". If the first passkey is created on desktop,
  "Chrome asks to create a Google Password Manager PIN", and the person "will need to know either their Google Password Manager PIN, or the unlock method used by
  their Android device" on a new device ([Google](https://developers.google.com/identity/passkeys/supported-environments),
  [Chrome blog](https://developer.chrome.com/blog/passkeys-gpm-desktop)). passkeys.dev lists Ubuntu synced passkeys
  as "Browser Extensions" and native platform APIs as "Planned". So on a Linux desktop the options are Chrome's manager
  (a PIN, not a body check), a browser-extension manager, a hardware key, or a phone over hybrid in Chrome or Edge.
  No system-wide Linux platform authenticator was found. Mozilla's bug thread links two proposals for a portal-style
  one, which I did not read (comment 2025-01-09 on Bugzilla 1543674).
- **Windows.** Starting in Windows 11 24H2 "users are prompted for privacy consent before applications can access
  passkeys" and can allow or block an application under Settings, Privacy and security, Passkey access (Microsoft Learn,
  page above). That applies to native applications too (section 7), and I do not know how it treats a console program run
  by another program: not confirmed.
- **Touch ID.** Apple's Touch ID needs a login session. The earlier note, [presence-signature.md](./presence-signature.md)
  section 2, covers where Touch ID stops (SSH, tmux, locked screen, lid closed). The browser route avoids those limits
  only when the person is at a logged-in screen with the browser.

## 7. With no browser

**Apple (AuthenticationServices).** Apple's page says "You need to have an associated domain with the `webcredentials`
service type when making a registration or assertion request; otherwise, the request returns an error"
([Supporting passkeys](https://developer.apple.com/documentation/authenticationservices/supporting-passkeys)). The associated
domain means the entitlement `com.apple.developer.associated-domains` in the app, and an `apple-app-site-association`
file on the site that lists the app ("the apps in the apple-app-site-association file on your website must have a
matching com.apple.developer.associated-domains")
([Supporting associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains)). Adding it
in Xcode adds "the associated domains feature to your app ID", which my reading takes to mean a provisioning profile and
an app bundle; the earlier note read Apple's rule that restricted entitlements need a profile and an app-like bundle that
a command-line tool does not have ([presence-signature.md](./presence-signature.md) section 2, citing TN3137). For a
request on any relying party id, Apple has a separate entitlement:
`com.apple.developer.web-browser.public-key-credential` "lets your app make registration and assertion requests for
passkeys and security keys for any relying party identifier. Only add this entitlement if your app can act as a user's
web browser", and Apple reviews each request
([entitlement page](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.web-browser.public-key-credential)).
So a plain command-line binary cannot do it, on the docs. A signed helper app that the command launches could ask for
passkeys for the app's own domain (my reading; not tried). Not confirmed; signing a test app and a bare binary with the
entitlement would settle it.

**Windows (`webauthn.dll`).** `WebAuthNAuthenticatorGetAssertion(HWND hWnd, LPCWSTR pwszRpId, PCWEBAUTHN_CLIENT_DATA ..., ...)`
produces "an assertion signature representing an assertion by the authenticator that the user has consented to a
specific transaction"; `hWnd` is "the handle for the window that will be used to display the UI", and the caller gives the
client data as "UTF-8 encoded JSON serialization of the client data" with its own hash algorithm
([function page](https://learn.microsoft.com/en-us/windows/win32/api/webauthn/nf-webauthn-webauthnauthenticatorgetassertion),
[client data page](https://learn.microsoft.com/en-us/windows/win32/api/webauthn/ns-webauthn-webauthn_client_data)). The
options carry `dwUserVerificationRequirement` and a linked-device field for hybrid
([options page](https://learn.microsoft.com/en-us/windows/win32/api/webauthn/ns-webauthn-webauthn_authenticator_get_assertion_options)).
`libfido2` calls this API and takes the foreground window as the handle
([`winhello.c` lines 997 and 1074](https://github.com/Yubico/libfido2/blob/308b5e7ea66a465378ce31ffaa435637f06539b9/src/winhello.c#L997)).
My reading: a Node addon or a small helper can call it from a console program. Because the caller writes the client
data JSON, the origin string is the caller's word, so the checker's origin check proves what the program claimed, and
the relying party id still decides which credential can sign. Whether Windows shows the Hello prompt when the calling
program was started by an agent in a non-interactive session: not confirmed.

**Linux (`libfido2`).** "Provides library functionality and command-line tools to communicate with a FIDO device over
USB or NFC, and to verify attestation and assertion signatures" ([README](https://github.com/Yubico/libfido2/blob/308b5e7ea66a465378ce31ffaa435637f06539b9/README.adoc)).
`fido2-assert` takes a client data hash and a relying party id (and a credential id for a non-resident credential) and
prints an assertion; it has `up` and `uv` options
([`fido2-assert.1`](https://github.com/Yubico/libfido2/blob/308b5e7ea66a465378ce31ffaa435637f06539b9/man/fido2-assert.1)).
No browser or origin is involved. This is the hardware-key route again (the earlier note covers keys through OpenSSH):
no synced passkeys, no hybrid phone, and `up` or `uv` set to `false` on a key that allows it removes that check, so the
verifier still has to read the bits.

**Is a browser hop the only route for a plain Node program on all three?** For synced and phone passkeys, on what I
read, yes. Windows has a native route (needs a helper), Mac has none without an app, Linux has hardware keys only. A
Node program that wants the same code path everywhere would open the browser (or print a link) on all three.

## 8. Checking it in Node or in a Worker

All three checked 2026-11-21 against the npm registry and each project's source.

- **`@simplewebauthn/server`**: latest 14.1.0, published 2026-11-06, first published 2020-05-26, MIT, Node 22 or later,
  one maintainer account. `verifyAuthenticationResponse()` takes the credential's public key and counter, the expected
  challenge (a string or a function), origin and relying party id. It requires the UP bit and, by default
  (`requireUserVerification = true`), the UV bit, and returns `authenticationInfo.userVerified`, the new counter, the
  origin and the id ([`verifyAuthenticationResponse.ts` lines 59-66, 224-262, 291-304](https://github.com/MasterKale/SimpleWebAuthn/blob/01d1a640d5ded4fced0b45a9d806fd0ff44ad244/packages/server/src/authentication/verifyAuthenticationResponse.ts)).
  The UP flag is enforced, not returned. It has no database access: the caller supplies the stored credential. Runtimes:
  the README lists "Node LTS 22.x and higher, Deno v2.4.x and higher ... and other compatible runtimes (Cloudflare
  Workers, Bun, etc...)" and says it "actively supports" Node and Deno
  ([README](https://github.com/MasterKale/SimpleWebAuthn/blob/01d1a640d5ded4fced0b45a9d806fd0ff44ad244/README.md)). It
  reaches for `globalThis.crypto`
  ([`getWebCrypto.ts`](https://github.com/MasterKale/SimpleWebAuthn/blob/01d1a640d5ded4fced0b45a9d806fd0ff44ad244/packages/server/src/helpers/iso/isoCrypto/getWebCrypto.ts)).
  Its dependency list includes `@peculiar/x509`, `reflect-metadata` and ASN.1 packages (npm registry). Whether the package
  loads and verifies on Workers: not confirmed; a deploy of one check to a Worker would settle it.
- **Workers' own Web Crypto.** Workers' `verify` supports ECDSA (P-256, P-384, P-521), RSASSA PKCS1 v1.5 and Ed25519
  ([Cloudflare Workers, Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)). Those cover the
  signature kinds in the spec's own sample code (EdDSA, ES256 and RS256, section 1.3).
- **`@oslojs/webauthn`**: 1.0.0, published 2024-09-19, last repository push 2024-09-22, one maintainer account, MIT. A
  low-level parser: `AuthenticatorData` has `userPresent`, `userVerified`, `verifyRelyingPartyIdHash()`, and a
  `createAssertionSignatureMessage()` helper; it enforces no policy, so the caller writes every check from section 1
  ([`auth.ts`](https://github.com/oslo-project/webauthn/blob/c18f66408797c4f264b662e55024d9a0de34ab4e/src/auth.ts),
  [`signature.ts`](https://github.com/oslo-project/webauthn/blob/c18f66408797c4f264b662e55024d9a0de34ab4e/src/signature.ts)).
  Workers support: not confirmed.
- **`fido2-lib`**: 4.0.1, published 2026-11-02, MIT, Node 22 or later, two maintainer accounts. Takes expectations with
  `flags` of `UP`, `UV` or `UP-or-UV`
  ([`validator.js` lines 98-106, 473-500](https://github.com/webauthn-open-source/fido2-lib/blob/95fdbaeec04b8ef53b4d2acbbd951de9b19a15bd/lib/validator.js#L473-L500)).
  Its README and test badge name Node and Deno, not Workers.
- **Node's own `crypto.verify`** can check the signature once the parts are parsed, as the earlier note found for FIDO
  keys.
- **`@passwordless-id/webauthn`** 2.4.1 (published 2026-10-06) exists with no dependencies. I did not read its source, so I
  do not know how it exposes the flags: not confirmed.

## 9. What this cannot tell us

- **Whether any route works on the owner's devices.** I ran no ceremony, no `get()` and no native call. Everything about
  Touch ID, Windows Hello, the Google Password Manager and hybrid is from docs and source.
- **Whether a prompt is asked anew on Apple and Windows.** Apple and Microsoft say what authorizes a passkey, not whether an
  unlock is reused between two requests. Two sign-ins in a row on each would settle it.
- **What 1Password and Bitwarden do in each browser build.** I read Bitwarden's source at one commit and 1Password's own
  post. The path a modal `get()` takes through the verification dialog, and what 1Password does when UV is not required,
  are not confirmed.
- **Safari on `http://localhost`.** Source says it is a secure context for the API; I did not see the passkey sheet.
- **Synced passkeys for `localhost`.** Not confirmed on any provider.
- **`txAuthSimple` in browsers.** A code search found nothing in three engine mirrors; that is weak evidence of absence.
- **Native macOS from a command-line tool.** The docs point to an entitlement and an app. I did not sign a test.
- **Windows from a non-interactive session.** I do not know if the consent and Hello prompts appear.
- **Linux platform authenticator.** I found none in system software; proposals exist, unread.
- **Whether an assertion from a synced software provider is trustworthy enough.** That is a policy choice for the design,
  not something a source can settle.
- **What a person understands from a prompt that shows only a site name.** The spec and engine code show what is on
  screen; they do not show whether a person, shown a page with a message, would catch a different one. A usability test
  would.
- **Package health beyond dates and source reading.** I did not run any verifier library. Their counts of users and
  maintainers are not measured.
- **Numbers change.** The Chrome, 1Password, Firefox and Windows facts are today's docs and source.

## Sources

Read on 2026-11-21. Code was read at the commit named here; web pages as served that day.

- W3C Web Authentication Level 3, Recommendation of 25 August 2026: https://www.w3.org/TR/webauthn-3/ (sections 4, 5.1.3,
  5.1.4, 5.8.1, 5.8.6, 5.11, 6.1, 6.1.1, 6.3.3, 7.2, 13.4.3, 13.4.4, 13.4.9, 15.1). Level 1 (4 March 2019, section 10.2):
  https://www.w3.org/TR/webauthn-1/ ; Level 2 (8 April 2021): https://www.w3.org/TR/webauthn-2/
- IANA WebAuthn registries: https://www.iana.org/assignments/webauthn/webauthn.xhtml
- W3C Secure Payment Confirmation, Candidate Recommendation Draft of 13 October 2026:
  https://www.w3.org/TR/secure-payment-confirmation/
- W3C Secure Contexts, Candidate Recommendation Draft of 10 November 2023: https://www.w3.org/TR/secure-contexts/
- FIDO Alliance, Client to Authenticator Protocol 2.3, Proposed Standard of 26 February 2026:
  https://fidoalliance.org/specs/fido-v2.3-ps-20260226/fido-client-to-authenticator-protocol-v2.3-ps-20260226.html
- Chromium, `chromium/chromium` at `a7b8222d1892bc9f37a46d2d1339603a36c23b77`:
  `components/webauthn/core/browser/webauthn_security_utils.cc` and `_unittest.cc`,
  `components/webauthn/core/browser/gpm_user_verification_policy.cc`, `chrome/browser/webauthn/gpm_enclave_controller.cc`,
  `chrome/browser/webauthn/gpm_enclave_transaction.cc`, `device/fido/enclave/types.h`, `device/fido/mac/touch_id_context.mm`,
  `device/fido/mac/get_assertion_operation.mm`, `device/fido/mac/util.mm`:
  https://github.com/chromium/chromium/tree/a7b8222d1892bc9f37a46d2d1339603a36c23b77
- Firefox, `mozilla-firefox/firefox` at `a3178f3cbfac6e25d5bc7b6365c4ff520a42205e`: `dom/webauthn/WebAuthnUtil.cpp`,
  `dom/webauthn/tests/gtest/TestWebAuthnRpIdCommon.h`: https://github.com/mozilla-firefox/firefox
- WebKit, `WebKit/WebKit` at `277895b0a3253027044cbc9235ef0df48bae2fb4`: `Source/WebCore/Modules/webauthn/PublicKeyCredential.idl`,
  `Source/WebCore/Modules/webauthn/AuthenticatorCoordinator.cpp`, `Source/WebCore/page/SecurityOrigin.cpp`:
  https://github.com/WebKit/WebKit
- Mozilla: Bugzilla 1543674 https://bugzilla.mozilla.org/show_bug.cgi?id=1543674 ; Firefox 122 release notes
  https://www.mozilla.org/en-US/firefox/122.0/releasenotes/
- Google: Passkey support on Android and Chrome (updated 2025-05-19)
  https://developers.google.com/identity/passkeys/supported-environments ; Chrome blog
  https://developer.chrome.com/blog/passkeys-gpm-desktop ; Android Developers, About passkeys (updated 2026-11-18)
  https://developer.android.com/identity/passkeys
- Chrome DevTools Protocol, `ChromeDevTools/devtools-protocol` at `62afb853b4629b6059542166e4eeb2975ce52f58`,
  `pdl/domains/WebAuthn.pdl`: https://github.com/ChromeDevTools/devtools-protocol
- Apple: Supporting passkeys https://developer.apple.com/documentation/authenticationservices/supporting-passkeys ;
  Supporting associated domains https://developer.apple.com/documentation/xcode/supporting-associated-domains ; entitlement
  `com.apple.developer.web-browser.public-key-credential` (bundleresources/entitlements) ; About the security of passkeys
  https://support.apple.com/en-us/102195
- Microsoft Learn: Passkeys in Windows https://learn.microsoft.com/en-us/windows/security/identity-protection/passkeys/ ;
  WebAuthNAuthenticatorGetAssertion, WEBAUTHN_CLIENT_DATA, WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS (win32 api webauthn)
- libfido2, `Yubico/libfido2` at `308b5e7ea66a465378ce31ffaa435637f06539b9`: `README.adoc`, `man/fido2-assert.1`,
  `src/winhello.c`: https://github.com/Yubico/libfido2
- 1Password: A path to user verification in 1Password (19 October 2026) https://1password.com/blog/user-verification-passkeys ;
  https://support.1password.com/cs/passkey-security/ and https://support.1password.com/cs/passkeys/
- Bitwarden, `bitwarden/clients` at `f9c68e008ba91dc19edf519305a82d3a994a7baa`:
  `libs/common/src/platform/services/fido2/fido2-authenticator.service.ts`, `fido2-client.service.ts`,
  `apps/browser/src/autofill/fido2/services/browser-fido2-user-interface.service.ts`,
  `apps/browser/src/vault/services/fido2-user-verification.service.ts`: https://github.com/bitwarden/clients
- passkeys.dev, `passkeydeveloper/passkeys.dev` at `e031b4c3dee34741ec349fe200db181553ac5641`,
  `content/en/device-support/index.md` (a community site run for the FIDO Alliance and the W3C; secondary to the specs):
  https://github.com/passkeydeveloper/passkeys.dev
- MDN, `mdn/browser-compat-data` at `1edef63031c8bbc2844b3f48e092433eecc4842e`, `api/PaymentRequest.json`; `mdn/content`
  at `df622a2a1c1e9626976cb3c091622d35e799b0cf`, "Using Secure Payment Confirmation"
- SimpleWebAuthn, `MasterKale/SimpleWebAuthn` at `01d1a640d5ded4fced0b45a9d806fd0ff44ad244`;
  `oslo-project/webauthn` at `c18f66408797c4f264b662e55024d9a0de34ab4e`; `webauthn-open-source/fido2-lib` at
  `95fdbaeec04b8ef53b4d2acbbd951de9b19a15bd`
- Cloudflare Workers, Web Crypto: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- npm registry entries, read 2026-11-21: `@simplewebauthn/server`, `@oslojs/webauthn`, `fido2-lib`,
  `@passwordless-id/webauthn`
