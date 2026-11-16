# Where we follow Kubernetes

We take a few behaviors from Kubernetes: its restart backoff
([experiment 100](../../../experiments/100-supervision-tree.md), C4 in
[the five layers](../a-local-first-sync-engine.md#layer-3-coordination-decided-2026-10-31)), its
`resourceVersion` ([saved state](../saved-state.md)), its limits ([tea-program](../tea-program.md)),
its labels and `status` ([label guidelines](../label-guidelines.md)), its node affinity
([talk where you work](../talk-where-you-work.md)) and its word `reason`
([AGENTS.md](../../../AGENTS.md)). Leases follow etcd's keepalive, which Kubernetes' own leases sit
on (C3). This table is about `next/`. One row per behavior. Paths are under
`next/packages/libfabrika/src/`. A pull request that changes one of these behaviors updates its
row in the same pull request ([0017](../../../.decisions/0017-each-model-we-follow-has-one-table.md)).

Seeded 2026-11-09 from the notes above, checked against main at `5b1171ed`.

| Behavior | What Kubernetes does | What we do | Same or differs |
|---|---|---|---|
| Restart backoff | Doubling from 10 s, capped at 5 minutes ([restart policy][restart]) | Doubling from 100 ms, capped at 800 ms (`app/supervisor.ts:11`, `:103-107`) | differs, because a restart here is a wake in the same object, so the shape is Kubernetes' and the scale is not ([experiment 100](../../../experiments/100-supervision-tree.md)) |
| Backoff reset | Reset after 10 minutes running without a problem ([restart]) | Reset after 5 s live (`app/supervisor.ts:147-149`) | differs, because the scale follows the 800 ms cap |
| A crash loop never gives up | `restartPolicy: Always` keeps trying at the capped wait ([restart]) | Past the brake, `down` until the window has room, then a new start, forever (`app/supervisor.ts:116-136`) | differs, because our wait between brakes stays near 5 s; 0016 picks OTP's give-up instead |
| Which exits restart | `Always`, `OnFailure` or `Never`, picked per pod ([restart]) | Only a throw restarts, like `OnFailure`, with no choice (`app/supervisor.ts:84-131`) | differs, because restart types wait for Tier 4 ([OTP table](./otp.md)) |
| A stale write | `resourceVersion` lets the API server reject a client that is out of date ([versions]) | Each line keeps `seen`; a `seen` past the head is `refused {why: "seen_ahead"}` (`data/ledger-store.ts:128-132`); a stale `seen` still lands | differs, because append stays plain and `seen` is not a lock ([saved state](../saved-state.md), D1) |
| State is observed, not set | `status` holds "the most recent observations of actual state" ([conventions]) | A process's `live`, `ended` or `down` is folded from its facts (`coordination/process.ts:39-43`), never written by hand | same |
| A condition's `reason` key | A condition has a machine-readable `reason` and a human `message` ([conventions]) | `next/` still says `why` (`coordination/process.ts:48`) | differs, because main's `next/` code is renamed by a sweep (ticket 337) |
| Limits end a run | `activeDeadlineSeconds` ends a Job ([job]); going over memory is `OOMKilled` ([resources]) | Not built: `LimitManager` (A2 in [the five layers](../a-local-first-sync-engine.md)) | differs, because not built yet |
| A quota per namespace | `ResourceQuota` caps what one namespace may use, and a request over it is refused ([quotas]). It counts objects and the resources they use, so the kubelet's own `.status` updates and its node heartbeats, kept as Leases in the `kube-node-lease` namespace ([heartbeats], [leases]), are not charged to the namespace | A program's account caps its writes per minute and its storage, and a charge over it is refused (`processes/QuotasSql.ts`, `processes/internal/quota.ts`, [0020](../../../.decisions/0020-programs-get-hard-walls.md), P34c). The brain's recovery writes go to a reserve of their own ([0147](../../../.decisions/0147-the-brain-keeps-reserved-room-for-recovery-writes.md)), and the supervisor's bookkeeping saves, such as the healthy mark, to the name's `supervisor` tally, counted and never limited (`runtime/RecoveryStore.ts`, [0593](../../../.decisions/0593-a-program-does-not-pay-for-its-supervisors-bookkeeping.md)) | same in effect: the platform's bookkeeping for a program is not the program's, as the kubelet's is not the namespace's; differs in what is counted, writes and bytes rather than objects, because a write is what an object's storage bills |
| A CPU limit per container | `limits.cpu` throttles a container at its cap ([resources]) | Not built: `limits.cpuMs` is unset on each process's isolate (`workers/index.ts:25`; [Tier 1's detail](../../plan/tier-1-detail.md)) | differs, because not built yet; 0020 sets it from a measured step, built by P34c. Cloudflare ends a step over `cpuMs`; Kubernetes slows it |
| Labels carry no meaning to the core | Labels "do not directly imply semantics to the core system" ([labels]) | Not built in `next/`: the tracker is a later tier ([tier 1](../../plan/tier-1.md), "Later tiers") | differs, because not built yet |
| Where work runs | Required and preferred node affinity ([affinity]) | Not built: hands and the order a turn is offered in are a later tier | differs, because not built yet |
| Leases | A `Lease` with a holder, a duration and a renew time ([leases]) | Not built: C3's 30 s claim renewed every 10 s waits for hands, a later tier | differs, because not built yet |
| A wait on an outside service | A failed image pull is tried again with a growing wait, up to 300 seconds; a restart's wait doubles to the same 5 minutes ([images], [restart]) | The merger waits after each outside fault (the code host or CI down, a lost check): doubling from `merger.poll`, 30 s, capped at `merger.backoff`, 300 s, kept as the one saved alarm (`next/programs/pipeline/src/Merger.ts:107-111`, `next/programs/pipeline/src/Settings.ts:40-42`) | same cap and shape; differs in the start, 30 s for Kubernetes' 10 s, because 30 s is the poll today's landing script uses, and both numbers are settings |
| List, then watch from its version | A client lists with a selector, such as the kubelet's pods for its own node (`spec.nodeName`), takes the list's `resourceVersion`, then watches from it and gets each change as an event; a watch too old for the server is `410 Gone`, and the client lists again ([changes]) | The hands client calls `tasks.list`, which answers its key's open tasks as pointers and the `rev` of its `target:` stream, then `tasks.wait { after: rev }`, which parks until a request for that key lands and answers only the new `rev`; the client then lists again (`gateway/Tasks.ts`, `gateway/Gateway.ts`, `client/HandsMachine.ts`). A take refused for a reason that cannot change by itself skips that task until a list answers another rev | differs, because the wait is a doorbell, not an event stream: it says only that something changed, and the list stays the one place that says what, so a lost wake costs one list. The selector is the authenticated key, never a param ([0102](../../../.decisions/0102-hands-is-a-grant-rank-and-work-is-taken.md)). No `410`: the ledger keeps every rev. Today a list reads the key's whole `target:` stream from rev 0 (finding `2026-11-15-jobs-list-reads-a-keys-whole-history`) |

Count: 15 rows, 3 same, 12 differ. Of the 12, 5 are not built yet (limits, a CPU limit per
container, labels, node affinity, leases).

Coming: [0016](../../../.decisions/0016-tier-1-supervision-is-otps-top-level-supervisor.md)
drops the backoff for OTP's restart at once, and past its limit a name waits for a person. P34c's
pull request updates the first four rows; they may then leave this table. It also builds the
quota and CPU limit rows ([0020](../../../.decisions/0020-programs-get-hard-walls.md)).

[restart]: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#restart-policy
[versions]: https://kubernetes.io/docs/reference/using-api/api-concepts/#resource-versions
[conventions]: https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md#typical-status-properties
[job]: https://kubernetes.io/docs/concepts/workloads/controllers/job/#job-termination-and-cleanup
[resources]: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
[labels]: https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
[affinity]: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#node-affinity
[leases]: https://kubernetes.io/docs/concepts/architecture/leases/
[quotas]: https://kubernetes.io/docs/concepts/policy/resource-quotas/
[heartbeats]: https://kubernetes.io/docs/concepts/architecture/nodes/#node-heartbeats
[images]: https://kubernetes.io/docs/concepts/containers/images/#imagepullbackoff
[changes]: https://kubernetes.io/docs/reference/using-api/api-concepts/#efficient-detection-of-changes
