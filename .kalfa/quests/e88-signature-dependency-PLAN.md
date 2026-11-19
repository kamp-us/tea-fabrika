Approved by the lead agent, builds 0574, 0054, 0177; body 3f3b8964be4c
Plancheck-Version: 3

# E88 names its chosen Signature dependency

This amends the approved E88 recovery plan, body `7c592decdaae`, for ticket1075 in `next/`.
It changes only the compiler's record of the Effect module that plan already chose. All other
recovery work, scope, laws and remote proof requirements stay in force.

```text
existing plan chooses Signature.privateKey for a validated32-byte Ed25519 seed
  ->0574 records that chosen unstable Effect module once
  ->unstableApiUsage stays error and all other imports remain checked
```

## Evidence and settled rule

The clean tracked snapshot at `8c5cc1d2dd195cea6105b2ffa4dcf6bed2c3dc99` failed the lead's final
typecheck at five Signature API uses in `Sshsig.test-support.ts:257-263`. The later SIGKILL was
pnpm canceling sibling compilers after that error, not evidence of an out-of-memory crash.

The approved recovery plan had already selected installed Effect4.1.3's `Signature.privateKey`
and its Ed25519 service to validate saved32-byte seeds and reuse the independent SSHSIG writer.
That choice preceded the compiler failure. No additional API or dependency is chosen here.

Decision0574 explicitly distinguishes `allowedUnstableApis` from an exception list for broken
code. Its setting names each intentionally chosen unstable Effect part once, with the reason in
the pull request. This entry is that dependency record. The check stays `error`. No diagnostic is
suppressed and no wildcard or per-line directive is added.

## How others do it

The installed Effect checker exposes `allowedUnstableApis` for deliberate module adoption.
Installed `effect/crypto/Signature` provides the seed constructor and signing service the approved
plan names. Reuse that API; do not recreate a seed parser, add a raw Node dependency, or weaken
its validation. Elm and OTP need no machine change for this test-support dependency record.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| tsconfig.base.json | tests | config | Add only the exact effect/crypto/Signature entry to the existing chosen-dependency setting. |
| field/runs/ | lead | records | Save the actual correction and later compiler result without rewriting earlier rows. |

The single existing E88 fix agent handles this bounded correction under0177. All other existing
ownership remains. No product implementation, dependency version, layer rule, checker severity,
lock or test assertion changes.

## Laws

| Law | Kind | Generator | Plant |
|---|---|---|---|
| The planned Signature seed helper typechecks while unstableApiUsage remains an error and other unchosen modules still fail | type | type | Remove only the selected Signature entry in a disposable validation copy; the same five diagnostics return. Restore before publication. |

This is a type/compiler rule, not a source-text test. It adds no new runtime law.

## Existing tools

Searched the approved plan, installed Signature API, existing tsconfig setting and0574. The
existing seed constructor, module selection and compiler suffice. No helper, parser, wrapper or
new dependency is needed. This is a compiler setting, not a fabrika.toml product choice.

## Validation

The fixer records the exact one-entry diff, uses normal formatting/lint and rechecks the five
sites through the installed compiler. The lead runs the one globally locked final typecheck on a
clean tracked snapshot after the correction. No broad local changed run, guarded law, signal,
launchd or Electron run. Existing remote R5/R6 proof and fresh whole review are still required.
A pass here is not runtime or remote proof. The fold's final whole review checks that the entry
names the already-chosen module and nothing else.

## Records

Keep the earlier blocked/fix rows unchanged. Add the exact selected module, reason from the
already-approved plan, failed and repaired compiler results, checked head and actual plant result
to a new correction row. Unknown usage stays null. No key or seed content is recorded.

## What this cannot tell us

This dependency record proves no runtime behavior, remote R5/R6 result or final fold review.
Those existing requirements remain. A compiler pass alone does not prove the seeded key signs
correctly; the existing seed/proof properties and remote interoperability law keep that job.

## Size

1. One config line plus the correction record, zero product lines. About0.1agent hour,95% confidence.
The helper/module choice and original recovery budget are unchanged. This records no measured spend.

Estimate: 1 steps, $1

## Open questions

None.
