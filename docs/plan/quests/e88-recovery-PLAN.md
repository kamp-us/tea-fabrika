Approved by the lead agent, builds 0054, 0178, 0565, 0577, 0587, 0589; body 7c592decdaae
Plancheck-Version: 3
# E88 recovery: reuse SSHSIG test support and restore test behavior

Proposed destination: docs/plan/quests/e88-recovery-PLAN.md.  
Version: next/. Existing tracker ticket 1075. Owner away: no.  
This is an unsigned repair plan for the existing E88 slice.

```text
one bounded fix round
  reuse existing SSHSIG test helpers
  preserve the dirty workerd tree reuse
  restore loopback probes and library imports
  record the fix and missing evidence
then integration laws in a container
then a fresh review of the whole E88 diff
```

## Scope and starting facts

The approved E88 row is in origin/fabrikalfa/effect-sweep at
06cef430a7098a341a4f8f471c9178498d6b554d, in
docs/plan/quests/effect-sweep-PLAN.md. The whole plan was read.

E88 covers nodeBuiltinImport in the app's top src files and libfabrika's
cloudflare and runtime folders. Its row lists 86 hits and steps tests, review.
The tests record reports a later base count of 88. These are historical counts,
not measurements made by this planner.

Decision 0589's amendments govern delivery. Judgment slices add no checker lock,
LOCKED row or separate pull request. They are reviewed before joining the judgment
fold. E88 has no product build step.

Read-only inspection found:

- Main is 55ae19989916bacf063c1e418f72869fe1891957.
- The local E88 branch, origin/fabrikalfa/effect-e88 and ../tf-e88 all point to
  ca6d843c0cde39563456d15ece9575dd98c79737.
- E88's configured upstream is the gone origin/fabrikalfa/test-sqlite-store ref.
  No ref or upstream setting was changed.
- E88 adds two commits above eeb8ecdbb. Its code commit is d40629ad8.
  ca6d843c0 adds the review record.
- The actual merge base with main is
  5c94f12f4cb9fdea56da49bfbfafded95afa12bd.
- The dirty workerd.test-support.ts change already makes the workerd selector
  filter tree(parent), removing the repeated walk.
- Both untracked scratch files remain unchanged.
- This plan step started no worker. The handoff says no fix worker is active.

Work forward from the existing E88 head. Create no branch or worktree. Do not
reset, rebase, force push or rewrite history. Do not use the wrong upstream to
infer a base or push target.

## Verified faults

The committed review is field/runs/2026-11-16-effect-e88-review.json.
It sent E88 back for missing Existing tools entries and duplicate helpers.
Its reported green tests and five plants were not rerun here.

1. The new person-key helper repeats UTF-8 encoding, concatenation, RFC 4251
   strings and SSHSIG armor already present in libfabrika's Sshsig test support.
   The product also has writeSshsig and PublicKey.
2. dev-child.test-support.ts:start wraps Effect's scoped child handle, merged
   output and scope close. Its missing reuse explanation is real. Effect already
   owns spawning, signaling and waiting.
3. Committed workerd.test-support.ts repeats the descendant walk. The dirty hunk
   already removes that duplication. tree itself already filters its result to
   the requested parent and descendants. Preserve both facts.
4. Both probe conversions use NodeHttpServer.layerTest. Installed platform-node
   4.1.3 builds that layer with port 0 and no host. The old tests explicitly bound
   127.0.0.1. A loopback URL does not constrain the listener's bind.
5. E88 adds library barrel imports in ProjectAuditTest, entry-flows, readers,
   index, p14, Built and ProcessStore. Decision 0577 requires namespace imports,
   including paths such as effect/crypto/Digest. Unrelated import debt belongs
   to E61.
6. PersonKey conflicts with the glossary. A person key signs grants and never
   dials the door. E88 uses this fixture for hello signatures and several ranks.
   A generic test identity must not claim person rank.
7. The branch contains tests and review records, but no E88 finding additions or
   fix record. The five finding payloads named in the handoff were not found.

## How others do it

Elm and OTP require no new machine here. This repair changes test fixtures,
imports and resource adapters. It changes no product transition.

Effect's installed 4.1.3 source is the API authority. Its process modules provide
scoped handles with pid, all, isRunning, exitCode and kill. Its Node implementation
owns process-group cleanup. A descendant snapshot remains a separate observation
through ps. The spawner has no command-bearing descendant-query API.

Installed NodeHttpServer exposes configurable listen options through layer and
make, but those require a native server factory. layerTest supplies that factory
and hardcodes port 0. Its shipped source and guidance provide no host setting for
layerTest. No relevant package decision was found in the shipped files. The
[upstream implementation](https://github.com/Effect-TS/effect/blob/main/packages/platform/node/src/NodeHttpServer.ts)
uses the same construction.

OpenSSH specifies distinct signed bytes and signature-blob bytes. Keep the test
writer independent of the product writer and reuse the existing protocol test
functions. [PROTOCOL.sshsig](https://raw.githubusercontent.com/openssh/openssh-portable/master/PROTOCOL.sshsig).

Installed versions read: effect and platform-node 4.1.3, tsgo 0.63.0,
tea 0.27.0, Vitest 5.0.5 and fast-check 4.10.2. The existing Effect patch changes
Arbitrary shrinking, not these APIs. No tea or Alchemy change is planned.

## Existing tools

- next/apps/fabrika/src/person-key.test-support.ts: searched for SSHSIG,
  writeSshsig, PublicKey, freshKey and identity. Found the existing transport
  test-support module and product Sshsig, PublicKey and ClientKey modules.
  Remove the app helper and reuse library test support. Its independent writer
  fits the test's role. ClientKey.Identity includes storage-specific fields,
  so reuse its public-field types without inventing a store.
- next/packages/libfabrika/src/transport/Sshsig.test-support.ts:identity:
  searched freshKey, signWith and Signature.generateKeyPair. Reuse freshKey and
  signWith. Their existing values supply the public bytes and signer.
- next/packages/libfabrika/src/transport/Sshsig.test-support.ts:identityFrom:
  searched seeded-key helpers and Signature.privateKey. Use the latter's
  validated 32-byte Ed25519 seed constructor. Add no seed parser.
- next/packages/libfabrika/src/transport/Sshsig.test-support.ts:fromSigner:
  searched the existing identity shapes and PublicKey. This private composition
  takes public bytes and a raw signer, then supplies the fixture's public fields,
  fingerprints and proof function. It adds no protocol encoder.
- next/packages/libfabrika/src/transport/Sshsig.test-support.ts:sign:
  reuse signWith for fresh keys and Signature.sign for seeded keys. Crypto
  failure remains a test defect.
- next/packages/libfabrika/src/transport/Sshsig.test-support.ts:fingerprint:
  reuse the existing digest and base64 helpers. Keep independently calculated
  bytes for the comparison with PublicKey.
- next/packages/libfabrika/src/transport/Sshsig.test-support.ts:proof:
  reuse signedByHand, toSign, build, armor, keyBlob, str and join8.
  Change signedByHand to accept public bytes and a raw-sign callback. Adapt its
  three existing calls. Do not copy its body into proof.
- next/apps/fabrika/src/dev-child.test-support.ts:start:
  searched app support, libfabrika process helpers and installed
  ChildProcessSpawner. Keep only the adapter its callers need: pid, current
  running state, streamed output and explicit stop. Reuse handle and scope APIs.
  [Execa](https://github.com/sindresorhus/execa) offers another process API built
  on Promises, without a capability these callers lack.
- next/apps/fabrika/src/workerd.test-support.ts:tree:
  searched the old brain-life reader, neighboring workerd selector and Effect
  process source. Reuse this single snapshot reader.
  [pidtree](https://github.com/simonepri/pidtree) returns pid/ppid information;
  these laws also need command text. Keep the existing ps adapter and algorithm.
- next/apps/fabrika/src/instance-one-file.integration.test.ts:probeServer:
  searched both probes and installed NodeHttpServer. Keep the scoped server and
  callback. Restore its bind through the test-layer patch below.
- patches/@effect__platform-node@4.1.3.patch:
  searched layerTest, layerConfig, layerServer and make. The configurable forms
  require a native HTTP factory. Patch only layerTest's options to include
  host 127.0.0.1 in source and shipped JavaScript. Reuse its server, handler,
  client and cleanup code.
- The npm search also covered SSHSIG packages. No new dependency is needed beside
  the existing protocol helpers. Some npm pages could not be fetched. No claim
  about an unread package API supports this plan.

## Repair shape

This is a sketch. Identity is test support, not a new service or membership rank.

```ts
// Existing transport test-support module.
// Library imports follow 0577.
export type Identity = Pick<ClientKey.Identity, "raw" | "line" | "fingerprint"> & {
  readonly sshFingerprint: string
  readonly sign: (bytes: Uint8Array) => Effect.Effect<Uint8Array>
  readonly proof: (text: string) => Effect.Effect<string>
}

export const identity: Effect.Effect<Identity> =
  /* freshKey, signWith, fromSigner */

export const identityFrom: (seed: Uint8Array) => Effect.Effect<Identity> =
  /* Signature.privateKey, then the same composition */

// Existing writer, with a reusable signer contract.
export const signedByHand = (
  publicKey: Uint8Array,
  sign: (bytes: Uint8Array) => Effect.Effect<Uint8Array>,
  hash: string,
  digested: Uint8Array
) => /* existing toSign, build and armor, once */
```

1. Put the composite identity in existing transport test support. Remove the
   duplicate app helper. Move its property into the existing Sshsig law file,
   retaining every assertion. Use fast-check without adding an import forbidden
   by transport's layer. Run 100 cases, preserving the old full-run count and
   increasing the fast-run count from 20.
2. Update all E88 callers to read SshsigTest.identity, identityFrom and Identity
   through the existing transport export. Remove PersonKey and personKey names
   introduced by E88. Leave the glossary and real product PersonKey services
   unchanged.
3. In ProjectAuditTest, replace the local public-key field encoder and
   fingerprint formatting with PublicKey.line and fingerprint. Retain its
   product writeSshsig call and raw-sign callback.
4. Retain dev-child's small adapter. Preserve command options, output,
   detached-group behavior and stop's wait. Add no timer, retry, signal change
   or cleanup policy.
5. Preserve the dirty workerd hunk. Filter tree(parent), then keep the exact-one
   check. Retain descendant filtering, command matching, zero/multiple rejection
   and SIGKILL behavior.
6. Restore namespace imports for every library import E88 adds or changes.
   Do not convert unrelated E61 debt or change import-check settings.
7. Apply the platform-node test-layer patch. Leave production layer and make
   behavior unchanged. In both probe laws assert the actual server address is
   127.0.0.1 and its port is nonzero. Keep the reachable control request and the
   sealed program's denial and hit-count assertions.
8. Add the fix record, fresh-review record and evidence accounting below.

The patch follows 0054 and patch-upstream-locally. Its gap was verified against
installed source. First prove the address assertion red without the patch, then
green with it. The lead files one upstream issue with that repro and patch, and
records its full URL. Remove the patch when a release includes the fix.

This changes a test layer inside the bounded fix round. E88 gains no product
build step.

No new fabrika.toml setting is needed. The SSHSIG namespace is an existing
contract. Loopback is the probes' original boundary. Ed25519 defines the seed
length. There is no new persisted state or state machine.

## One value traced through

For a generated 32-byte seed:

1. identityFrom calls Signature.privateKey. The installed service derives the
   public bytes.
2. Existing keyBlob and lineFor produce the SSH line. KeyLine decodes it once.
   raw is base64url of the 32 public bytes.
3. fingerprint hashes those 32 bytes. sshFingerprint hashes the whole SSH blob.
   They remain different values with different uses.
4. proof hashes the hello text with SHA-512 and calls shared signedByHand with
   the identity's raw signer.
5. The existing hello flow sends that proof. Product checkSshsig accepts the
   right text and key and refuses a different text or key.
6. The law repeats the seed and checks the same public identity. No private
   seed or key enters a field record.

## Laws

| Law | Lint, type or test | Generator | Plant |
|---|---|---|---|
| R1. E88's three scopes have zero nodeBuiltinImport hits with the diagnostic at error | type | type | Add node:fs in a disposable validation copy of an E88 source file; recount reports it, then remove it |
| R2. Library imports added or changed by E88 follow 0577 | type | type | Change one repaired Digest import back to the crypto barrel; the checker identifies it |
| R3. Shared identity preserves proof acceptance, wrong-text/key rejection, both fingerprints, line encoding and seed stability | test | fc.tuple: two strings and a 32-byte Uint8Array, 100 runs, seed 119120 | Sign changed text; hash the blob for the raw fingerprint; change the namespace, version or signature wrapper. Run and undo each plant |
| R4. The independent writer still round-trips saved OpenSSH bytes and checks hash names | test | vector: existing saved OpenSSH signatures, plus existing generated Sshsig laws | Alter a shared field length or include the version in signed bytes; existing laws fail |
| R5. Both probes bind IPv4 loopback, answer the control and remain unreachable to the sealed program | test | scenario: existing instance-one-file and instance-records probe laws | Remove the patch's host; actual-address assertion fails. Remove outbound isolation; the existing denial/hit assertion fails |
| R6. Child cleanup and workerd selection retain their existing behavior | test | scenario: existing brain-life, instance-wire and worker-supervision crash and cleanup laws | Select a workerd outside the requested tree; the crash/replacement law fails. Use only disposable container processes |

R1 and R2 use the checker, not new tests of code spelling. R2 requires no new
E88 import violations, not zero preexisting E61 hits.

R3 moves intact. Its five named plants are planned verification, not a
reconstruction of the previous review's unrecorded plant details.

R5 and R6 use real sockets and processes. They run in a container before review.
A stand-in cannot prove a real bind address, OS cleanup or workerd replacement.
There is no Mac-only, launchd or Electron law in this repair. E88's changed
browser visual law also runs in a suitable container before review.

## Files

Owner tests includes the single fix agent's exam changes. Read-only rows grant
no edit permission.

| File | Owner | Product lines expected | What changes |
|---|---|---|---|
| next/apps/fabrika/src/person-key.test-support.ts | tests | tests | Remove after callers use shared support |
| next/apps/fabrika/src/person-key.test.ts | tests | tests | Move all assertions into Sshsig laws, then remove |
| next/packages/libfabrika/src/transport/Sshsig.test-support.ts | tests | tests | Shared identity and one independent writer |
| next/packages/libfabrika/src/transport/Sshsig.test.ts | tests | tests | Moved property and existing writer callers |
| next/packages/libfabrika/src/transport/Sshsig.integration.test.ts | tests | tests | Read and run; no assertion change expected |
| next/apps/fabrika/src/dev-child.test-support.ts | tests | tests | Retain bounded adapter and document reuse |
| next/apps/fabrika/src/workerd.test-support.ts | tests | tests | Preserve dirty reuse and exact-one selection |
| next/apps/fabrika/src/brain-life.integration.test.ts | tests | tests | Existing child/tree and cleanup coverage |
| next/apps/fabrika/src/port-home.laws.integration.test.ts | tests | tests | Existing child-adapter coverage |
| next/apps/fabrika/src/instance-one-file.integration.test.ts | tests | tests | Shared identity and loopback-address assertion |
| next/apps/fabrika/src/instance-records.integration.test.ts | tests | tests | Shared identity and loopback-address assertion |
| next/apps/fabrika/src/instance-wire.integration.test.ts | tests | tests | Shared identity and existing crash laws |
| next/apps/fabrika/src/worker-supervision.integration.test.ts | tests | tests | Shared identity and existing crash laws |
| next/apps/fabrika/src/*.test.ts | tests | tests | Only E88 identity callers; run changed laws |
| next/apps/fabrika/src/*.test-support.ts | tests | tests | Only E88 identity callers |
| next/apps/fabrika/e2e/ next/apps/fabrika/e2e/** | tests | tests | Run changed browser and chaos laws; only required identity callers change |
| next/packages/libfabrika/src/cloudflare/ProjectAuditTest.ts | tests | tests | Reuse PublicKey and repair added imports |
| next/packages/libfabrika/src/cloudflare/*.test.ts | tests | tests | Repair E88 imports and run changed laws |
| next/packages/libfabrika/src/runtime/*.test.ts | tests | tests | Repair E88 imports and run changed laws |
| next/packages/libfabrika/src/node/**/*.integration.test.ts | tests | tests | Run files already changed by E88 |
| next/packages/libfabrika/src/settings/StartsTest.ts | tests | tests | Review and run E88 caller coverage |
| patches/ patches/@effect__platform-node@4.1.3.patch | tests | tests | Only layerTest's host in source and shipped JavaScript |
| pnpm-workspace.yaml | tests | tests | Exact-version patch and upstream link |
| pnpm-lock.yaml | tests | tests | Patch hash; no version bump |
| next/apps/fabrika/src/zz-probe-scratch.ts | tests | 0 | Preserve untracked, read-only |
| next/apps/fabrika/tsconfig.zz-scratch.json | tests | 0 | Preserve untracked, read-only |
| field/runs/2026-11-16-effect-e88-tests.json | lead | docs | Immutable evidence, read-only |
| field/runs/2026-11-16-effect-e88-review.json | lead | docs | Immutable review, read-only |
| field/runs/2026-11-16-effect-e88-fix1.json | tests | docs | New fix run; use execution date if later |
| field/runs/2026-11-16-effect-e88-review2.json | review | docs | Fresh whole-diff review; use execution date if later |
| field/findings/ | lead | docs | Only recovered or newly proved observations |
| docs/plan/quests/e88-recovery-PLAN.md | lead | docs | Save and approve this plan |

## Validation and handoff

This plan step ran no product test, typecheck, install, Docker, local instance,
Electron, launchctl or workerd. It changed no checkout file or ref.

The record-search command attempted a fetch and failed because FETCH_HEAD was
read-only. It did not establish freshness. Direct reads of available refs,
decisions, glossary, plans, source and records supplied the evidence.

The lead saves this unsigned text outside the checkout and runs
plancheck.sh --draft before approval. The checker's format, owner and law checks
were exercised in memory during drafting. The full saved-file command, including
its leak check and size report, remains for the lead.

The single fixer:

1. Captures status and the dirty workerd diff before editing. Retains that hunk
   as repair input. Does not stage, remove, rename or rewrite either scratch
   file. Stages only named repair paths.
2. Runs pnpm format first on its repair state, checks preserved files and runs
   pnpm lint. Uses pnpm's patch workflow for the exact-version test-layer patch.
   No install or patch operation belongs to this plan step.
3. Runs narrow plain laws from the repository root with
   nice -n 15 pnpm exec vitest run --maxWorkers=3.
   With concurrent code agents, uses nice -n 19 and one worker.
4. Populates the validation container from the repaired committed tree.
   The untracked scratch source imports node:http. Excluding untracked files
   from a commit snapshot is not a new checker exclusion.
5. Uses git diff --name-only eeb8ecdbb HEAD to enumerate every E88 changed
   integration and visual law. Runs all of them in the container, including app,
   e2e, libfabrika node and runtime files. Also runs the transport interoperability
   law reached by this repair. Keeps existing assertions and timeouts.
6. Recounts E88's exact scopes with nodeBuiltinImport at error through disposable
   checker input outside source. Reports remaining hits elsewhere separately.
   Compares repaired imports against the same base under 0577 and proves no
   additional E88 violation.
7. Runs and removes each plant. Uses only controlled container processes for
   wrong-tree selection. Never signals an unrelated host process.
8. Records commands, per-file results and the exact checked head.

The lead runs one final typecheck, waiting for any existing compiler. The
lockfile changes, so the lead uses explicit affected test paths instead of a
changed-test command that would select the full suite. Never run the full local
suite. CI supplies the required broader dependency proof.

Integration results must exist at the repaired head before review. A failed or
unavailable container run is a blocker. It permits no skip, weaker assertion,
raised timeout, new allow-list entry, lowered rule or layer-rule edit.

Then start a fresh review agent. The prior Claude reviewer cannot be resumed
here. This is a new whole-diff review, not the original reviewer's recheck.

The new reviewer reads eeb8ecdbb through the repaired head, this repair plan, the
approved sweep plan, all records and container results. It checks every named
fault, propagated caller change, patch line and removed assertion. It does not
inherit the old review's pass claims. No product build step is added.

The lead owns later integration with main and the judgment fold. This plan
authorizes no history rewrite or separate E88 pull request.

## New names

- Identity, identity and identityFrom use the cryptographic identity meaning
  already present in transport/ClientKey. They claim no membership rank.
  The glossary's person-key entry remains unchanged.
- fromSigner is private fixture composition. sign and proof retain their
  signature meanings from PROTOCOL.sshsig.
- Child and start retain Effect's child-process terms. tree, pid, parent and
  command describe ps process rows. No new product term is coined.
- The fold description carries these names and sources under 0587's New names
  section.

## Records

Preserve old tests and review rows. Add one fix row and one fresh-review row
with actual dates, times, models, heads and parent links. The fix names the prior
review as parent. The new review names the fix as parent and explicitly records
its whole-diff scope.

Correct an earlier factual claim through a new row with corrects. Never rewrite
an existing row.

Record the historical 86-versus-88 difference, new scope counts, import counts,
carried workerd hunk, command results, plant outcomes and upstream patch issue
URL. Missing usage or billing data stays null. Price actual usage using the
executing model's published rate, with source and date. This plan's budget is
not a bill.

Recovery searches found no E88 finding additions in the branch's two commits.
The committed tests and review files do not contain the five finding payloads.
The review's five plants are not five findings. The original payloads remain
unrecovered.

If another committed source is found during the fix, preserve each payload's
actual observation and proof. Otherwise record that five payloads were
unavailable. Do not invent observations, rate findings, manufacture timestamps
or mark missing records recovered.

Facts that must be recorded now are the inherited dirty input, checked heads,
failure and plant results, replacement-review reason and unsuccessful recovery.
No private key, seed, secret value or scratch transcript enters public records.

## Calls taken

- Reuse independent SSHSIG test support, 95% confidence. It removes the duplicate
  encoder while preserving independent inputs. The cost is a small signer
  contract change and three existing callers.
- Put reusable identity support in transport, 95% confidence. Existing imports
  already allow app and cloudflare tests to use it. No layer change is needed.
- Patch only layerTest's default host, 85% confidence. Installed source proves
  the missing option. This restores the probes without a raw Node import or
  suppression. The cost is carrying the patch until an upstream release.
- Retain the child adapter and descendant reader, 95% confidence. Effect supplies
  resource handling. Another dependency adds no needed capability.
- Use a fresh whole-diff reviewer, 100% confidence. The recovery brief requires
  it. The cost is rereading E88 instead of inspecting only the repair.

## Size

Size confidence: 65%. About 35 to 45 repair paths, mainly test-support imports
and tests. No product implementation lines are expected. Allow about 2 to 3
agent hours including container validation and fresh review.

1. One E88 repair slice: about 260 lines of tests, support and patch metadata,
   plus about 550 lines of plan and field records. No separate product build.

The remaining runs are the bounded fixer and fresh reviewer. The $18 allowance
starts from the approved sweep's $4.40 tests and $3.06 review planning averages,
with room for the patch and container checks. E88's old records contain no
measured token cost. Budget confidence: 60%.

Estimate: 2 steps, $18

## Open questions

None.

## What this cannot tell us

No product law ran during planning. Old green results do not prove this repair
or the previously unrun integration paths.

The installed checker package does not ship its Go rule source. Current upstream
docs and source were read, but an exact 0.63.0 source fetch was unavailable.
The fixer must prove recounts using the installed binary.

The five historical finding observations remain unknown. The full saved-file
plancheck and leak check must run after runplan.sh saves this output.

## Findings

No additional outside-task finding was proved during this read-only pass.
The five historical payloads remain unavailable unless their actual evidence
is recovered.

