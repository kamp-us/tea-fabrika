---
id: 0055
title: A module's own error is named by the service that fails, one per service, so processes/ has MailboxError and ProcessManagerError and keeps ProcessError as its refusal
status: accepted
date: 2026-11-10
tags: [errors, services, modules, processes, mailbox, process-manager, cause, libfabrika, next]
---

# 0055: A module's own error is named by the service that fails, one per service, so processes/ has MailboxError and ProcessManagerError and keeps ProcessError as its refusal

**What this decides:** in `next/`, each service fails with an error named after it, so one module
may hold several error types, one per service.

```mermaid
flowchart LR
  runtime["runtime/"] -->|"send, receive, read"| mailbox["Mailbox"]
  runtime -->|"start, exit, monitor"| pm["ProcessManager"]
  mailbox -->|"fails with"| merr["MailboxError {cause}"]
  pm -->|"fails with"| pmerr["ProcessManagerError {cause}"]
  mailbox --> ledger["ledger/ Ledger"]
  pm --> ledger
  ledger -->|"LedgerError, kept as cause"| merr
  ledger -->|"LedgerError, kept as cause"| pmerr
```

```ts
// sketch: processes/, after the move
export class MailboxError extends Schema.TaggedError<MailboxError>()("MailboxError", {
  reason: Schema.Literals(["ledger"]),
  cause: Schema.Defect(),
}) {}

export class ProcessManagerError extends Schema.TaggedError<ProcessManagerError>()("ProcessManagerError", {
  reason: Schema.Literals(["ledger"]),
  cause: Schema.Defect(),
}) {}

// ProcessError stays: the module's refusal, as it is today in coordination/process.ts:150.
```

The fields are a sketch. The names and the `cause` are the decision.

## Context

The folder move (ticket 477) gives `processes/` its own error for a fault from below, by
[0043](0043-rooms-on-floors.md)'s rule 12. Its text says "`processes/` gets an error of its own",
in the singular. The move plan's open question 4, for PR 10 onward, asked what that error is called
and whether one error covers the whole module. Today `Mailbox.send`, `receive` and `read`
(`coordination/mailbox.ts`) and `ProcessManager` (`coordination/process-manager.ts`) both fail with
`LedgerError`, the ledger's own error (`data/ledger.ts:11`).

Effect names an error by the service that fails: in `node_modules/effect/AGENTS.md`
(the version `pnpm-workspace.yaml`'s `effect` catalog entry pins, "Services"), the `Database`
service's `query` fails with `DatabaseError`, a `Schema.TaggedError` with
`cause: Schema.Defect()`. This record follows that.

This amends [0043](0043-rooms-on-floors.md) in part: rule 12's "an error of its own" reads as one
per service, not one per module.

## Decision

**A module's own error is named by the service that fails: a service called `X` fails with
`XError`.**

- In `processes/`, `Mailbox` fails with `MailboxError` and `ProcessManager` fails with
  `ProcessManagerError`.
- `ProcessError` stays. It is the module's refusal, not a fault from below.
- Each service translates a lower module's fault where it calls that module, and keeps the original
  as `cause` (0043's rule 12, [an error keeps its cause](../.patterns/effect-errors-keep-their-cause.md)).
- So a module may hold more than one error type, one per service it offers.

**Binding constraints:**

- No service's signature names `LedgerError` once its module has moved: it names its own error.
- A new service in any module gets its own `<Service>Error`, not a shared module-wide error.
- The rename rides with the move pull request that moves the service (ticket 477, PR 10 onward).

## Consequences

- The move plan's open question 4 is answered. The plan names the two errors in its rows.
- The runner's 15 `new LedgerError` (counted in 0043) become the runtime's own errors, named by the
  runtime service that fails, by this same rule.
- `door/store.ts`, `door/nonce.ts` and `coordination/recovery-store.ts`, which use `LedgerError` for
  their own SQLite faults today, get the error of the service they serve.
- The cost: more error classes, one per service. A caller that handles a whole module's faults
  matches more than one `_tag`.
- Not decided here: the `reason` values of each error. Each build plan picks them.

## Records

- [`.glossary/TERMS.md`](../.glossary/TERMS.md), Ledger section, new rows: `MailboxError` and
  `ProcessManagerError`.
- Same pull request, not part of this decision: the owner answered the move plan's open question 3
  on 2026-11-10 (no module imports two layers down, no exemption), for the door and `access/`.
