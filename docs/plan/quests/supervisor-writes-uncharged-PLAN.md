
Plancheck-Version: 3

# Plan: a program pays nothing for its supervisor's bookkeeping saves

`next/` only (`next/packages/libfabrika`, plus two laws files in `next/apps/fabrika`). Today's
version is not touched. This plan builds three live decisions, each checked with
`records.ts resolve 0593 0143 0153` on `origin/main` at `701a651` (all three `accepted`):

- [0593](../../../.decisions/0593-a-program-does-not-pay-for-its-supervisors-bookkeeping.md)
  (owner, 2026-11-15): a program does not pay for its supervisor's bookkeeping writes, such as the
  healthy mark and restart counts. "Supervisor writes are charged to the supervisor, and a law
  with a plant shows a program's write count unchanged by a healthy mark or a restart."
- [0143](../../../.decisions/0143-a-refused-write-is-counted-never-a-row.md): a write the gateway
  refuses is counted by the hour and writes no row. This plan does not change it. It matters
  because the finding that led to 0593 was first read as a 0143 bug (a refused send that crossed
  the hour), and the tests step of that follow-up proved the extra write was the healthy mark.
- [0153](../../../.decisions/0153-the-doors-input-record-is-not-a-program-write.md): the door's
  own record of an input is door work, never a program write. 0593 is the same rule one level in:
  work the platform does for a program is not the program's write. This plan does not change 0153.

The plan is signed by the merge session, not the laptop lead. It only builds a decided note (0593),
so no part of it waits on the owner; the calls below are taken with their percentages.

```ts
// The whole idea, in RecoveryStore.save (sketch):
const charge: Charge =
  recoveryState(saved) || recoveryState(previous) ? "recovery"   // 0147: unchanged
  : bookkeeping(previous, saved, changed)          ? "supervisor" // 0593: new
  :                                                  "program";   // the program's own save
options.accounting?.change("journal", writes, growth, at, charge);
```

## Doubts, at the top

Each is a call taken with its lean. None contradicts a decision, so none is an open question.

- **Where a supervisor save is charged: a new `supervisor` tally in the name's own store, counted
  and never limited, not the brain's recovery reserve** (75%). 0593 says "charged to the
  supervisor", and its sketch tags that charge `supervisor` and says it "never counts". The other
  home would be the recovery account of
  [0147](../../../.decisions/0147-the-brain-keeps-reserved-room-for-recovery-writes.md). Against
  it: that account has a rate limit (0152) and a fault that stops the name, so a healthy program's
  healthy mark could stop it in a tight reserve (worker-quotas' `reserve` mode sets 1 write a
  minute); and two laws read "ordinary work spends no recovery room" right after a start
  (`next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts:1936`,
  `next/apps/fabrika/src/worker-quotas.integration.test.ts:359`), which a healthy mark charged to
  recovery would turn red on any run slower than 5 s. What would settle it: the owner saying the
  supervisor's account is the recovery reserve. Then the `Charge` value `"supervisor"` maps to the
  recovery account in `QuotasSql.ts`, one line, and the two laws above need a written reason.
- **The supervisor's first save of a new journal is bookkeeping too** (70%). At a process's first
  boot the runner saves a fresh journal (`Runner.ts:1009-1017`): name, policy, build, `healthyAt`,
  no receipts. That is the supervisor's child record, as OTP keeps a child spec in the supervisor.
  Today the program pays for it: one write and the whole journal row's bytes, most of the 934 bytes in the follow-up's measured case (not split out; the tests step reads the exact number). The
  doubt: someone may read 0147's "its journal" as the program's. If the owner says no, the rule
  "a first save with no receipts is bookkeeping" is dropped, one line, and L3's first-save case
  flips.
- **Restart counts stay on the recovery account** (85%). Every save that changes `restarts`,
  `crashes` up, `observations` or `requests` is made with the journal in or leaving a recovery
  state, so `RecoveryStore.ts:283` already charges it to recovery, never to the program. 0147
  binds "its restart" to the reserved room, and 0593 only says no supervisor write counts toward a
  program's quota, which holds. Moving restart saves to the `supervisor` tally would walk 0147
  back, so this plan does not. 0593's sketch lists `restart` under its `supervisor` charge; the
  plan reads that as "not the program", which both homes meet.

## What the supervisor saves, and who pays today

The recovery journal is one tea machine, `supervisor`
(`next/packages/libfabrika/src/runtime/internal/supervisor.ts:291-606`). The runner saves it in
two places only: `send` (`next/packages/libfabrika/src/runtime/Runner.ts:615-627`, every Msg,
saved when the model changed) and the first boot (`Runner.ts:1009-1017`). No other product code
calls `RecoveryStore.save` (searched `rg -n "\.save\(" next/packages/libfabrika/src`, and every
caller of `recoveryStore(` and `RecoveryStore.layer(`). `RecoveryStore.ts:277-284` picks the
account: recovery when the saved or the previous journal is in a recovery state, else the
program's Process-local account (`QuotasSql.ts:612-638`).

| Save | Sent at | Fields it changes | Charged today | After this plan |
|---|---|---|---|---|
| first boot, `supervisor.init` | `Runner.ts:1009-1017` | the whole new record, no receipts | program | supervisor |
| `healthy` | `Runner.ts:1093`, handler `supervisor.ts:601-604` | `crashes` to 0, `healthyAt` | program | supervisor |
| `swapped` | `Runner.ts:1270`, handler `supervisor.ts:336-337` | `build` | program | supervisor |
| `limited` while idle | `Runner.ts:1276`, handler `supervisor.ts:354-361` | `maxDeliveries` | program | supervisor |
| `begin` | `Runner.ts:1127`, `:1232` | `seq`, `journal` | program | program |
| `admitted` | `Runner.ts:2787` | `journal`, `receipts` | program | program |
| `refused` | `Runner.ts:2800` | `journal` (to `writing_reply`) | recovery (saved state) | recovery |
| `finished` | `Runner.ts:1205` | `journal` | program | program |
| `abandoned` | `Runner.ts:1105`, `:1121`, `:1179`, `:2776`, `:2794` | `journal` | program | program |
| `compacted` | `Runner.ts:2868` | a receipt's `input` to a `digest` | program | program |
| `reply_written`, `attempt_cleared` | `Runner.ts:791`, `:796` | `journal`, from a recovery state | recovery | recovery |
| `threw`, `check_threw`, `interrupted` (crash counts, `observe`, `supervisor.ts:222-233`) | `Runner.ts:1067`, `:1163`, `:1189-1190`, `:1250` | `crashes` up, `observations`, `receipts`, `journal` | recovery | recovery |
| `exit_written` (restart counts) | `Runner.ts:842` | `restarts`, `journal` | recovery | recovery |
| `checkpointed` (restart counts, healthy mark of the successor) | `Runner.ts:921` | `restarts`, `healthyAt`, `requests`, `build`, `journal` | recovery | recovery |
| `adopted` | `Runner.ts:1032` | `restarts`, `build`, `journal` | recovery | recovery |
| `dead_written`, `down_written`, `due`, `started`, `restart_requested`, `swap_prepared`, `swap_completed` | `Runner.ts:832`, `:855`, `:1086`, `:887`, `:2683`, `:2465`, `:765` | `journal` | recovery | recovery |

`received` (`supervisor.ts:338-341`) is sent only by `supervisor.laws.test.ts`; no product code
sends it (a finding row below). So the supervisor-only saves the program pays for today are four:
the first boot, the healthy mark, `swapped` and `limited` while idle. The ruling names the healthy
mark; the other three fit its principle (the supervisor's own record of its child: which build,
which delivery limit, the record itself), so they move too (AGENTS.md, "a stated principle covers
every case it fits").

The activity marker (`ProcessStore.ts:236-243`) and the checkpoint (`ProcessStore.ts:345-352`,
`:381-388`) are not journal saves. They record the program's own step and stay the program's.
Replies (`RepliesSql.ts:76`) stay on recovery.

## How others do it

- **Erlang/OTP keeps restart bookkeeping in the supervisor.** The supervisor process holds its
  children's specs and the restart history it checks against intensity and period; a child's own
  state never holds it. Design principles, "Restart Intensity"
  (https://www.erlang.org/doc/system/sup_princ.html#restart-intensity): "If more than `MaxR`
  number of restarts occur in the last `MaxT` seconds, the supervisor terminates all the child
  processes and then itself." The `supervisor` reference, "Supervision Principles" and the
  `sup_flags` type (https://www.erlang.org/doc/apps/stdlib/supervisor.html#t:sup_flags/0): the
  supervisor's own flags carry `intensity` and `period`. Not fetched in this session: the session
  cannot reach www.erlang.org. The quotes are as experiment 239
  (`experiments/239-supervision-vs-otp.md`, read 2026-11-09) and experiment 254
  (`experiments/254-how-a-lane-should-stop.md`) read them; the anchors are the ones I believe
  correct. Our supervisor differs in one way the OTP table already records
  (`docs/direction/follows/otp.md`, row "Who supervises"): it is a tea machine stepped inside the
  program's own object, so its state shares the program's SQLite. That is why the store must tell
  the two apart by the record's fields; OTP gets it free from a second process.
- **Kubernetes does not count the kubelet's status writes against a namespace.** A
  `ResourceQuota` "provides constraints that limit aggregate resource consumption per namespace. It
  can limit the quantity of objects that can be created in a namespace by type, as well as the
  total amount of compute resources"
  (https://kubernetes.io/docs/concepts/policy/resource-quotas/, opening section "Resource Quotas").
  It counts objects and compute, never writes, so the kubelet's updates to a pod's `.status` are
  not charged to the namespace. The kubelet's own bookkeeping writes are its node's: "Nodes",
  section "Heartbeats" (https://kubernetes.io/docs/concepts/architecture/nodes/#node-heartbeats):
  heartbeats are "updates to the `.status` of a Node" and "Lease objects within the
  `kube-node-lease` namespace", a namespace of their own; "Leases", section "Node heartbeats"
  (https://kubernetes.io/docs/concepts/architecture/leases/#node-heart-beats). Their rate is held
  by API Priority and Fairness at a system priority level, not by a namespace's quota
  (https://kubernetes.io/docs/concepts/cluster-administration/flow-control/, "Defaults"). Not
  fetched in this session: the session cannot reach kubernetes.io. The quota page is the one
  `docs/direction/follows/kubernetes.md` cites as `[quotas]`; the section names and anchors for the
  other three are the ones I believe correct, and the tests step or the lead checks them before the
  pull request body cites them.
- **Elm.** The update is pure and returns the new model; who caused a change is the Msg, and the
  model's fields say whose state it is. The store sits below the machine and sees only the record,
  so the data-shape answer is to name which fields are the supervisor's, beside the machine's own
  schema, and let the store compare. That is the option chosen below.

## How the store tells a supervisor save from a program's

Three options, weighed by their properties.

1. **The store compares the record (chosen, 75%).** The supervisor's file names its bookkeeping
   fields. A save that leaves every receipt row and every other field unchanged is the
   supervisor's. Properties: no caller can forget or mislabel a save, since the fact is in the two
   records; every one of the about 30 test calls of `save` stays as it is; it is the same move the
   store already makes for recovery (`recoveryState`, from the record's shape); the rule is a pure
   function of two records, so a law can generate them. How it fails: a future program-caused
   change that only touched bookkeeping fields would be charged to the supervisor (under, the
   side 0593 leans to); a future supervisor field left off the list is charged to the program
   (today's behavior). The type law L6 ties the list to the schema, so a renamed field fails to
   compile.
2. **The save carries who wrote it** (`save(value, { by })`, with the Msg's type mapped to a
   writer in `supervisor.ts`). Properties: explicit, and a total map over Msg types gives a type
   law per Msg. Against it: `save` changes shape at about 30 test call sites, or takes a default
   that hides a forgotten label; a caller can say the wrong `by`; and the store still has to look
   at the record for recovery, so two rules decide one charge.
3. **Split the record into a supervisor row and a program row,** as OTP splits processes.
   Properties: the truest shape. Against it: every saved journal on disk changes shape and needs a
   migration, the schema filter (`supervisor.ts:95-149`) reads fields from both halves, and the
   charge comes out the same as option 1. Not taken: it costs a stored-data migration for no
   property option 1 lacks.

Cost of option 1: about 20 lines in `RecoveryStore.ts` and 10 in `supervisor.ts`. Under 80% sure
of nothing here: the doubt is only the edge cases above.

## The shape

### The charge (`next/packages/libfabrika/src/processes/Quotas.ts`)

```ts
/**
 * Schema for which account a store's write is charged to: the program's own, the brain's recovery
 * reserve (0147), or the supervisor's bookkeeping (0593), which is counted and never limited.
 */
export const Charge = Schema.Literals(["program", "recovery", "supervisor"]);
export type Charge = typeof Charge.Type;

export interface Accounting {
  // ...check, recordFault, protect, resume as today
  /** `charge` is required: every store says who pays. */
  readonly change: (operation: string, writes: number, bytes: number, at: number, charge: Charge) => void;
  readonly status: Effect.Effect<
    {
      readonly program: { readonly writes: number; readonly bytes: number };
      /** The supervisor's bookkeeping saves for this name: a record, never a wall. */
      readonly supervisor: { readonly writes: number; readonly bytes: number };
      readonly recovery: Use;
      readonly fault: RecoveryReserveExhausted | null;
    },
    QuotasError
  >;
}
```

The fifth argument was `recovery?: boolean`. Its callers change with it:
`RecoveryStore.ts:278-284` (the rule above), `RepliesSql.ts:76` (`true` becomes `"recovery"`),
`ProcessStore.ts:237-243`, `:345-352`, `:381-388` (`recovering(sql)` becomes
`recovering(sql) ? "recovery" : "program"`).

### The account (`next/packages/libfabrika/src/processes/internal/quota.ts`, `QuotasSql.ts`)

```ts
export const Account = Schema.TaggedUnion({
  program: { program: Schema.String },
  recovery: { name: Schema.String, location: Schema.Literals(["project", "process"]) },
  local: { name: Schema.String },
  /** A name's supervisor bookkeeping in its own store (0593). Like `local`, never over a limit. */
  supervisor: { name: Schema.String },
});
// quota.ts:130, sketch: neither `local` nor `supervisor` is ever exceeded.
const exceeded = account._tag === "recovery" || account._tag === "program" ? /* as today */ : false;
```

```ts
// QuotasSql.ts accounting(), sketch.
const supervisor = Quota.Account.cases.supervisor.make({ name: options.name });
change: (operation, writes, bytes, at, charge) => {
  const account = Match.value(charge).pipe(
    Match.when("recovery", () => recovery),
    Match.when("supervisor", () => supervisor),
    Match.orElse(() => local),
  );
  // the rest as today: a saved fault refuses every charge, a supervisor one too
},
status: /* ... */ ({ program: load(local).total, supervisor: load(supervisor).total, recovery: use(reserve), fault }),
```

A saved reserve fault still refuses a supervisor charge, as it refuses a program one today
(`QuotasSql.ts:619-623`): a stopped name writes nothing until a checked restart clears it.

### The rule (`next/packages/libfabrika/src/runtime/internal/supervisor.ts`, `RecoveryStore.ts`)

```ts
// supervisor.ts, beside Supervision. The fields only the supervisor writes: its child record and
// its restart bookkeeping (0593). `satisfies` ties each name to the schema.
/** @internal */
export const bookkeeping = [
  "build", "crashes", "healthyAt", "maxDeliveries", "observations", "policy", "requests", "restarts",
] as const satisfies ReadonlyArray<keyof Supervision>;
```

```ts
// RecoveryStore.ts, inside save's transaction, sketch.
/** The record without the supervisor's own fields: what a program's save changes. */
const owned = (record: Readonly<Record<string, unknown>>) =>
  Struct.omit(record, ...bookkeeping);
const charge: Charge =
  recoveryState(saved) || recoveryState(previous)
    ? "recovery"
    : changed.length === 0 &&
        (previous === null
          ? saved.receipts.length === 0
          : encode({ ...owned(saved), receipts: [] }) === encode({ ...owned(previous), receipts: [] }))
      ? "supervisor"
      : "program";
options.accounting?.change("journal", changed.length + (journal === text ? 0 : 1), growth, at, charge);
```

`Struct.omit` is Effect's (`effect/Struct`, `src/Struct.ts:348` in Effect 4.1.3 as installed). The comparison
reads the journal row text the store already encodes, so no new read. Bytes go with the write: a
supervisor save's whole `growth` (the journal row's change, and on a first save the generation row,
`RecoveryStore.ts:263-265`) is the supervisor's.

A save that changes both a program field and a bookkeeping field is the program's, whole. No idle
Msg does both today (the table above), so this costs nothing now; it is written down so a later Msg
that mixes them is a decision, not an accident.

## One value traced

The follow-up's measured case (`field/runs/2026-11-16-refusal-hour-charge-tests.json` on branch
`fabrikalfa/refusal-hour-charge`): a frozen clock, one accepted send and one `open("audit")`, then a
jump of 5,100 ms, then another `open("audit")`.

1. Before the jump the program's local account reads `{ writes: 15, bytes: 934 }` today. After this
   plan it reads less (the first boot save has moved to `supervisor`); call it `p`. The supervisor
   tally reads `s = { writes: 1, bytes: b0 }`, the first boot save.
2. The open's turn reaches `Runner.ts:1091-1094`: the journal is `idle`, so `send({ type:
   "healthy", at })`. `supervisor.ts:602`: `at - healthyAt` is 5,100, at least `resetAfterMs`
   (5,000, `supervisor.ts:22`), so the model becomes `{ ...s, crashes: 0, healthyAt: at }`.
3. `Runner.ts:622-623`: the model changed, so `recovery.save(next)`.
4. `RecoveryStore.ts`: `saved` and `previous` are both `idle`, so not recovery. No receipt row
   changed. Without the bookkeeping fields the two records encode the same. So `charge` is
   `"supervisor"`. `growth` is 0: `healthyAt` has 13 digits before and after, and `crashes` was
   already 0.
5. `QuotasSql.ts` `change("journal", 1, 0, at, "supervisor")`: the supervisor tally becomes
   `{ writes: 2, bytes: b0 }`.
6. The next read: program `p`, unchanged (today: `{ writes: 16, bytes: 934 }`); supervisor one
   write more; recovery unchanged.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L1, red today. An idle gap of at least `resetAfterMs` then one turn saves the healthy mark (the journal's `healthyAt` is the turn's time), and that save leaves the program's local writes and bytes as they were, adds one write and the journal row's exact byte change to the supervisor tally, and leaves recovery as it was; after a reopen the same, 40 runs | test | fc.record: the gap (5,000 to 120,000 ms), the name, and a tape of reopens | `RecoveryStore.ts` charges every non-recovery save to `"program"` (today's rule): the program gains one write and L1 fails | `next/packages/libfabrika/src/runtime/QuotaRunnerTest.ts`, run by `next/packages/libfabrika/src/node/QuotaRunner.test.ts` |
| L2, red today. The live objects of the finding: frozen clock, one accepted send and open, then a jump past the journal's own `resetAfterMs` (read from `process_recovery`, as the follow-up's law did) by a generated 100 to 900 ms, then an open: the healthy mark was saved (`healthyAt` moved), the program's local account equals its value before the jump (today 16 writes where the law wants 15, bytes 934 both), and the supervisor tally gained one write, 40 runs at full depth | test | fc.record: the extra milliseconds and whether a reopen comes between | the same plant as L1: the read after the jump shows the program one write more | `next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts` |
| L3. A program's own save is still charged, and only the supervisor's moves: on an idle journal, a tape of saves each one of a bookkeeping edit (`healthyAt`, `crashes`, `build`, `maxDeliveries`, `restarts`), a program edit (`seq` and `journal` to `checking`, a new receipt, a receipt compacted to a digest) or both at once; a program or mixed save charges the program exactly its changed receipt rows plus one when the journal row changed, with the exact growth, and leaves the supervisor tally; a bookkeeping save charges only the supervisor; a first save with no receipts is the supervisor's, 40 runs | test | fc.array: a tagged union of the three edits, 1 to 25 long | (a) classify by `seq` and `journal` alone, ignoring receipt rows: a compacted receipt goes to the supervisor and L3 fails; (b) charge everything to `"supervisor"`: a `begin` edit fails; (c) charge a mixed save to the supervisor: the mixed case fails | `next/packages/libfabrika/src/runtime/QuotaRunnerTest.ts`, with a new `save` member on the World in `next/packages/libfabrika/src/node/QuotaRunner.test.ts` |
| L4. A restart is not the program's: a name that crashes once or twice on a throwing letter and recovers leaves the supervisor tally unchanged and grows its recovery total; the program's local account grows by no more than the same name's earlier accepted letter cost it, 40 runs | test | fc.record: the crash count (1 or 2) and the name | `RecoveryStore.ts` reads only `recoveryState(saved)`: the successor's `checkpointed` save (from `checkpointing` to `idle`) goes to the program, with its restart counts, and L4 fails | `next/packages/libfabrika/src/runtime/QuotaRunnerTest.ts` |
| L5. `Accounting.change` takes its charge: a call with four arguments, or with `true` as the fifth, does not compile | type | type | make the fifth parameter optional: the `@ts-expect-error` line is unused and the typecheck fails | `next/packages/libfabrika/src/runtime/RecoveryStore.types.test.ts` |
| L6. Every name in `bookkeeping` is a field of `Supervision`, and `seq`, `journal`, `receipts` and `name` are not in it | type | type | add `"seq"` to the list, or rename `healthyAt` in the schema only: the typecheck fails | `next/packages/libfabrika/src/runtime/RecoveryStore.types.test.ts` |

Notes on the laws:

- **L1 is the stand-in form of L2** and runs on every pull request; L2 is the live objects of the
  finding, in the integration file that saw it. A stand-in does run L1's case; L2 exists because
  0593's evidence is that file's case, so the plan pins it there too. No new integration file.
- **Bytes in L1 and L2.** The law reads the journal row text before and after, so it asserts the
  exact byte change and never hardcodes 0.
- **Lint?** No law here is a shape check of code, so none is lint.
- **Every plant** is run once by the tests step, recorded in its run row, never committed.
- **No law is loosened.** No existing assertion changes. The status object gains a `supervisor`
  field; laws that compare whole status values with `toEqual` compare it on both sides.

**Must run whole and stay green, with no law loosened:**

- `next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts` (L2, and P34c's live-object
  laws, among them the Q9/Q12 door law at `:1910-2020`).
- `next/apps/fabrika/src/worker-quotas.integration.test.ts` (Q13, three modes; real workerd).
- `next/apps/fabrika/src/runtime-quotas.laws.test.ts` (Q12 live wiring).
- `next/packages/libfabrika/src/node/QuotaRunner.test.ts` (the `QuotaRunnerTest` suite: Q5, Q7,
  Q16, Q17, Q19, and L1, L3, L4).
- `next/packages/libfabrika/src/runtime/RecoveryStore.integration.test.ts` and
  `next/packages/libfabrika/src/node/RecoveryStoreReads.integration.test.ts` (the RecoveryStore
  laws and the `RecoveryStoreReadsTest` suite).
- `next/packages/libfabrika/src/node/Quotas.test.ts` (the `QuotasTest` suite).
- `next/packages/libfabrika/src/runtime/internal/supervisor.laws.test.ts`,
  `next/packages/libfabrika/src/runtime/RunnerSupervision.integration.test.ts`,
  `next/packages/libfabrika/src/runtime/ProcessStore.integration.test.ts` and
  `next/packages/libfabrika/src/cloudflare/supervision.laws.integration.test.ts`.

**Host-only laws: none new.** `worker-quotas.integration.test.ts` is an existing real-workerd law
(its own comment says it needs an isolated container). It runs before the first review, in the
step's container (0045, [0178](../../../.decisions/0178-host-only-laws-run-first.md)), never on the
owner's Mac. Its `before` read (`:357-359`) must still find recovery at zero; this plan keeps it so
by not charging the healthy mark to recovery.

## Existing tools

- `bookkeeping` in `next/packages/libfabrika/src/runtime/internal/supervisor.ts`, a new constant:
  searched `rg -n "healthyAt|crashes" next/packages/libfabrika/src` and `internal/recovery.ts`
  (`JournalState`, `Work`) for a list of the supervisor's own fields; none exists. `JournalState`
  is the model (a shape the store reads without the whole schema).
- `Charge` in `next/packages/libfabrika/src/processes/Quotas.ts`, a new schema: searched
  `Quotas.ts`, `QuotasSql.ts` and `internal/quota.ts` for a type naming the account a store
  charges. `Quota.Account` is close but carries names and locations and is internal; the store only
  says which of three, so a literal schema fits. `Authority` in `QuotasSql.ts:55-62` names who a
  ledger write is from (`ordinary`, `recovery`, `infrastructure`) and is a different context, the
  ledger's, so it is not reused.
- `owned`, a new local function in `next/packages/libfabrika/src/runtime/RecoveryStore.ts`:
  searched the installed Effect (`node_modules/effect/src/Struct.ts`) for an omit; `Struct.omit`
  is used rather than a hand-written omit.
- The `supervisor` case of `Account` in `next/packages/libfabrika/src/processes/internal/quota.ts`:
  searched the cases for one that counts and never limits; `local` does, but it is the program's
  own, so a second case keeps the two totals apart, as 0147 keeps recovery apart.

## Is this a setting?

- **The list of bookkeeping fields:** no. It is a fact about the record's shape, checked by a type
  law, not a choice a person makes.
- **A limit on the supervisor tally:** no limit exists, so there is no number to set. 0593 says a
  supervisor charge never counts; giving it a wall would be a new design call for the owner.

## What fact is lost if not recorded now

Which saves were the supervisor's. The local account keeps totals, not one row per save, so every
supervisor save made before this lands stays inside the program's total for good; no migration can
split it out. That is accepted: the total is a record, and nothing reads it to refuse. From this
pull request on, the `supervisor` tally records every one, so nothing more is lost.

## Where each file lives

All product changes are in libfabrika (`processes/` and `runtime/`): a from-scratch client would
need the same accounting, so none belongs in the app. The two app files are laws only.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| `next/packages/libfabrika/src/processes/Quotas.ts` | build | 12 | `Charge`; `change` takes it; `status` gains `supervisor` |
| `next/packages/libfabrika/src/processes/internal/quota.ts` | build | 5 | the `supervisor` case of `Account`, never exceeded |
| `next/packages/libfabrika/src/processes/QuotasSql.ts` | build | 10 | the third account, picked by `Match`; `status` reads it |
| `next/packages/libfabrika/src/runtime/internal/supervisor.ts` | build | 6 | `bookkeeping`, with `satisfies` |
| `next/packages/libfabrika/src/runtime/RecoveryStore.ts` | build | 20 | the charge rule, `owned`, and the head comment |
| `next/packages/libfabrika/src/runtime/ProcessStore.ts` | build | 3 | pass `"recovery"` or `"program"` |
| `next/packages/libfabrika/src/runtime/RepliesSql.ts` | build | 1 | pass `"recovery"` |
| `next/packages/libfabrika/src/runtime/QuotaRunnerTest.ts` | tests | tests | L1, L3, L4; `Local` gains `supervisor`; the World gains `save` |
| `next/packages/libfabrika/src/node/QuotaRunner.test.ts` | tests | tests | the World's `save` |
| `next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts` | tests | tests | L2 |
| `next/packages/libfabrika/src/runtime/RecoveryStore.types.test.ts` | tests | tests | L5, L6, new |
| `next/apps/fabrika/src/worker-quotas.integration.test.ts` | tests | none | not changed: runs whole |
| `next/apps/fabrika/src/runtime-quotas.laws.test.ts` | tests | none | not changed: runs whole |
| `next/packages/libfabrika/src/runtime/RecoveryStore.integration.test.ts` | tests | none | not changed: runs whole |
| `next/packages/libfabrika/src/node/RecoveryStoreReads.integration.test.ts` | tests | none | not changed: runs whole |
| `next/packages/libfabrika/src/node/Quotas.test.ts` | tests | none | not changed: runs whole |
| `next/packages/libfabrika/src/runtime/internal/supervisor.laws.test.ts` | tests | none | not changed: runs whole |
| `next/packages/libfabrika/src/runtime/RunnerSupervision.integration.test.ts` | tests | none | not changed: runs whole |
| `next/packages/libfabrika/src/runtime/ProcessStore.integration.test.ts` | tests | none | not changed: runs whole |
| `next/packages/libfabrika/src/cloudflare/supervision.laws.integration.test.ts` | tests | none | not changed: runs whole |
| `docs/direction/follows/otp.md` | build | docs | a row: who pays for the supervisor's state ([supref], [sup]); same in effect |
| `docs/direction/follows/kubernetes.md` | build | docs | the quota row: the kubelet's status writes are not the namespace's, and ours are not the program's |
| `.glossary/TERMS.md` | build | docs | a row for `supervisor (account)`, and `Charge` |

## Validation

The tests step runs L1 to L4 and each plant once, in the box, at its head, and the must-run files
above whole. The lead runs the typecheck that holds L5 and L6. The worker-quotas law runs in the
step's container before the first review.

## New names

For the pull request's `## New names` section:

- `Charge` (`next/packages/libfabrika/src/processes/Quotas.ts`): cost attribution, who a write is
  charged to. Source: 0593's own sketch names it `Charge`; Kubernetes "Resource Quotas"
  (https://kubernetes.io/docs/concepts/policy/resource-quotas/), the opening section, for charging
  use to its owner.
- `supervisor`, a case of `Account` and a field of `Accounting.status`: OTP's supervisor, whose
  own state holds restart bookkeeping. Source: https://www.erlang.org/doc/system/sup_princ.html,
  "Restart Intensity".
- `bookkeeping` (`next/packages/libfabrika/src/runtime/internal/supervisor.ts`, internal): the
  supervisor's own state, as 0593 says "bookkeeping writes". Source:
  https://www.erlang.org/doc/apps/stdlib/supervisor.html, "Supervision Principles".

## Size

One pull request that lands whole. Nothing a person sees changes.

1. A program pays nothing for its supervisor's saves: 57 lines in seven libfabrika files, about
   250 test lines in four files, and three docs rows.

Priced from similar steps in `field/runs/`: the refusal-hour-charge tests step (one law in the
same integration file, 16 minutes) and the P34c quota slices. Expected: tests about $6 (four
generated laws, two type laws, plants), build about $3, review about $4, one fix round about $4.
Confidence 70%: the doubt is L4's bound, which the tests step may need to tighten from "no more
than" to an exact count once it reads the crash path's saves.

Estimate: 4 steps, $17

## Records

- [0593](../../../.decisions/0593-a-program-does-not-pay-for-its-supervisors-bookkeeping.md): built.
- [0147](../../../.decisions/0147-the-brain-keeps-reserved-room-for-recovery-writes.md) and
  [0152](../../../.decisions/0152-the-recovery-byte-allowance-is-a-rate.md): kept; recovery saves
  stay on the reserve. Nothing walks them back.
- [0143](../../../.decisions/0143-a-refused-write-is-counted-never-a-row.md) and
  [0153](../../../.decisions/0153-the-doors-input-record-is-not-a-program-write.md): unchanged.
- [0017](../../../.decisions/0017-each-model-we-follow-has-one-table.md): the OTP and Kubernetes
  rows change in this pull request.
- [0214](../../../.decisions/0214-unions-are-tagged-with-tag.md): `Account` stays a `_tag` union;
  `Charge` is a plain literal value, not a union of objects.
- [0587](../../../.decisions/0587-new-helpers-and-names-cite-sources.md): the new names above.
- Searched with `records.ts find` for "supervisor write charge quota", "recovery reserve account
  brain writes", "healthy mark restart intensity" and "program account infrastructure writes
  charged"; every hit that applies is cited here.

## What this cannot tell us

- Whether the Kubernetes and OTP anchors are exact: neither site was reachable from this session.
- Whether any client reads the local program total today and would see it drop by the first boot
  save; a search found only tests and status reads.
- How large the supervisor tally grows over a long life. It is bounded by its causes (one first
  save per process, a healthy mark at most once per `resetAfterMs`, one `swapped` or `limited` per
  load), but nothing measures it yet.

## Open questions

None.

The three calls at the top only pick how the code does what 0593 says, so each is a call with
its percentage, not a question.

## Findings

```json
{"id": "2026-11-16-supervisor-received-msg-never-sent", "date": "2026-11-16", "version": "next", "where": "next/packages/libfabrika/src/runtime/internal/supervisor.ts:160 and :338-341", "what": "The supervisor's `received` Msg and its handler are sent only by next/packages/libfabrika/src/runtime/internal/supervisor.laws.test.ts (:222, :846); no product file sends it. Receipts enter through `admitted` and `check_threw`.", "proof": "rg -n 'type: \"received\"' next/packages/libfabrika/src finds only the two test lines, on origin/main at 701a651", "cost": "a Msg case the machine's laws exercise but the runner never takes, so its laws prove a path that does not run"}
```
