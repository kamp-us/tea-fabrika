---
id: 0593
title: A program does not pay for its supervisor's bookkeeping writes, such as the healthy mark and restart counts
status: accepted
date: 2026-11-15
tags: [quotas, supervisor, writes, otp, kubernetes, recovery, metering]
---

# 0593: A program does not pay for its supervisor's bookkeeping writes

```ts
// Sketch: who a write is charged to.
type Charge =
  | { readonly _tag: "program"; readonly for: "its own write" }      // counts toward its quota
  | { readonly _tag: "supervisor"; readonly for: "healthy" | "restart" } // never counts
```

## Decision

The owner ruled on 2026-11-15, at about 11:35 PM Pacific: a program does not pay for its supervisor's
bookkeeping writes. The healthy mark and the restart counts are the supervisor's own state, not the
program's. The owner cited two makers who keep it the same way:

- **Erlang/OTP:** a supervisor keeps its children's restart intensity and state in its own process.
  A child is not billed for it.
- **Kubernetes:** a namespace's resource quota does not count the kubelet's status writes for its
  pods.

So no supervisor write counts toward a program's write quota.

## Evidence

The quotas follow-up (after [0143](0143-a-refused-write-is-counted-never-a-row.md) and
[0153](0153-the-doors-input-record-is-not-a-program-write.md)) found a write charged to the
program that should not be. The program's local account went from 15 writes to 16 across an
hour boundary. That sixteenth write was the supervisor's healthy mark, at
`supervisor.ts:601-604`, charged by `RecoveryStore.ts:278`.

## Consequences

- The cloud twin builds the fix as a follow-up through the steps. Supervisor writes are charged
  to the supervisor, and a law with a plant shows a program's write count unchanged by a healthy
  mark or a restart.
