
Plancheck-Version: 3

# Plan: a finished job's wake carries the trace of the finish that caused it

This is `next/`. It fixes the open finding
[`2026-11-15-a-finished-jobs-wake-carries-no-trace`](../../../field/findings/2026-11-15-a-finished-jobs-wake-carries-no-trace.json),
left by the sev1 fix in [pull request 1318](https://github.com/kamp-us/tea-fabrika/pull/1318). One
pull request, about 20 product lines.

```ts
// The whole idea, a sketch. Today (Gateway.ts:1114, 1167-1177):
route = Effect.fnUntraced(...)           // no span
  jobs branch:
    JobRoutes.route(...)                 // span "gateway.jobs", trace T1: the finish saves traceId T1
    wakeups.wake(name)                   // no span here: the wake sends no trace
                                         // -> runner.mailed opens a new root trace T2. T1 and T2 never meet.

// After: the jobs branch is its own named span, as every other branch of route already is.
routeJobs = Effect.fn("gateway.route")(...)  // span "gateway.route", trace T1
  JobRoutes.route(...)                   // child span "gateway.jobs", trace T1: the finish saves T1
  wakeups.wake(name)                     // current span is gateway.route: the wake sends { T1, its spanId }
                                         // -> runner.mailed is a child in trace T1
```

## What changes, in one paragraph

The gateway's `route` handles `jobs.*` calls in an inline branch with no span of its own. The finish
is recorded inside `JobRoutes.route`'s own span (`gateway.jobs`), but that span has ended before the
gateway wakes the requester, so the wake runs with no current span. Since pull request 1318 a wake
with no span is legal and sends no trace, so the requester's `runner.mailed` span starts a new
trace. The fix moves the jobs branch into one function written with `Effect.fn("gateway.route")`,
the same span name the branch for every other method already opens (`routeInput`, Gateway.ts:1467)
and the two early refusals open (`refuse`, `refuseRate`, Gateway.ts:88-96). The write turn, the
inner `gateway.jobs` span and the wake all run inside it, so the saved `traceId` and the wake share
one trace. `flush` stays after the span ends, as `routeInput`'s call does (Gateway.ts:1656-1657), so
the span is written by the flush that follows it. Nothing in `cloudflare/mail.ts` or
`JobRoutes.route` changes in behavior: the wake already sends the caller's span when there is one.

## How others do it

- **Effect:** a span is carried by the fiber's context, and any effect run inside
  `Effect.withSpan` or `Effect.fn("name")` sees it as `Effect.currentSpan`; a child span inherits its
  parent's trace id. The installed `effect@4.1.2`'s `AGENTS.md` says: use `Effect.fn("name")` "when
  the function should create a tracing span", and `Effect.fnUntraced` "when tracing is not needed".
  Read in the main checkout's `next/packages/libfabrika/node_modules/effect/AGENTS.md` (lines 51 to
  80) for this plan; the lockfile on `origin/main` pins that version.
- **OpenTelemetry:** context propagation. The span that handles an incoming request is the parent
  of the outgoing calls it makes, and the outgoing call injects that span's context
  (`traceparent`) so the callee continues the same trace. Our wake's `{ traceId, spanId }` argument
  to `ProcessClient.mailed` is that injection. From the OpenTelemetry context propagation docs, not
  fetched for this plan.
- **Erlang/OTP:** no built-in tracing context; `seq_trace` labels pass with each message a traced
  process sends, so a message sent while a trace token is set carries it. From the `seq_trace` docs,
  not fetched. Same idea: the cause travels with the message, not after it.
- **This repo:** [`Effect.fn` for traced functions](../../direction/effect-fn-for-traced-functions.md)
  ([0252](../../../.decisions/0252-effect-fn-for-exported-effects.md)) says a function that should
  have a span is `Effect.fn("<piece>.<verb>")`, and [0024](../../../.decisions/0024-next-records-with-spans-and-log-lines.md)
  says `next/` records with spans. Every other branch of `route` already has a `gateway.route` span.

## The shape

```ts
// next/packages/libfabrika/src/gateway/Gateway.ts, a sketch of the new branch.
// One function, one span, for the whole jobs call: the write turn, the record and the wake.
const routeJobs = Effect.fn("gateway.route")(
  function* (client: ConnectionId) {
    const { answer, wake } = yield* Effect.gen(function* () {
      const fresh = yield* silent(Effect.result(authenticated(client)));

      if (Result.isFailure(fresh)) {
        return { answer: no("not_granted"), wake: null };
      }

      return yield* JobRoutes.route(jobs, fresh.success.attached, method, params);
    }).pipe(write);
    // The wake runs in this span, so it carries the trace the finish saved.
    const woke = wake === null ? Result.succeed(undefined) : yield* Effect.result(wakeups.wake(wake));
    return Result.isSuccess(woke) ? answer : no("unavailable");
  },
  Effect.tap((answer) => Effect.annotateCurrentSpan("fab.gateway.outcome", answer._tag)),
);

// In route, where the inline branch was:
if (method.startsWith("jobs.")) {
  const routed = yield* Effect.exit(routeJobs(client));
  yield* flush;
  return yield* routed; // an Exit is an Effect in effect@4
}
```

The builder picks whether `routeJobs` closes over `method` and `params` or takes them as arguments;
either is fine. What must hold: the wake runs inside the span, and `flush` runs after it. If
`yield* routed` does not type as shown, use the `Exit.isSuccess` line `route` already uses at
Gateway.ts:1658.

```ts
// next/packages/libfabrika/src/cloudflare/mail.ts, the doc on `wakeups` (lines 62-64).
// The behavior stays; one sentence about the gateway was true only before this fix.
// Before: "`wake(name)` asks nothing of its caller, and the gateway wakes outside any span."
// After:  "`wake(name)` asks nothing of its caller. The gateway wakes a finished job's requester
//          inside its `gateway.route` span, so the wake joins the finish's trace."
```

```ts
// next/packages/libfabrika/src/gateway/JobsTest.ts, the suite's MailWakeups fake records the trace too.
const wakes: Array<{
  readonly name: string;
  readonly free: boolean;
  readonly trace: { readonly traceId: string; readonly spanId: string } | undefined;
}> = [];
// in wake: const span = yield* Effect.option(Effect.currentSpan);
//          trace: Option.isSome(span) ? { traceId: span.value.traceId, spanId: span.value.spanId } : undefined
```

## One value traced: a first finish, then a repeat whose wake fails

1. A hands client sends `jobs.finish` for job `opaque-0`, requester name `wire:1`. `route` checks
   the rate budget (no span: it passed), then calls `routeJobs`. Effect opens span `gateway.route`,
   say trace `a1…` span `s1`.
2. Inside the write turn, `JobRoutes.route` opens child span `gateway.jobs` (trace `a1…`, span `s2`,
   parent `s1`). `record` reads `Effect.currentSpan` there and the `finished` event is saved with
   `traceId: "a1…"`.
3. The turn ends. `wakeups.wake("wire:1")` runs with current span `s1`, so it calls
   `ProcessClient.mailed({ traceId: "a1…", spanId: "s1" })`. In the requester's runner,
   `runner.mailed` (Runner.ts:2351) is a child of `s1`, in trace `a1…`.
4. `routeJobs` answers `ok`, its span gets `fab.gateway.outcome: "ok"` and ends. `flush` writes it.
5. The same finish is sent again, and the suite's fake fails this wake. A new `gateway.route` span
   opens, trace `b7…`. The job is unchanged (it keeps `traceId: "a1…"`), the inner `gateway.jobs`
   span is in `b7…`, and the wake carries `b7…`. It fails, so the answer is
   `refused unavailable`, and the span says `fab.gateway.outcome: "refused"`.

Today step 3 sends `undefined`, and `runner.mailed` is a root span in a new trace.

## What fact is lost today

The link between a finish and the wake it caused. The `finished` event on the job's ledger stream
holds `traceId` (the `Recorded` field, Jobs.ts:61-73, from the `gateway.jobs` span). The
requester's `runner.mailed` span row, in its process's span record, holds its own `traceId`. Today
those two ids differ and nothing on either row names the other. The link exists only at the moment
of the wake: a span row written with a fresh root trace can never be joined back. The finding notes
that no hands client sends finishes before hands slice 4, so no real row has been lost yet, which is
why this should land before slice 4 does.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| W2, rides W1's walk: every wake a taken finish causes, first or repeated, wake saved or failed, carries a trace; its `traceId` is the `traceId` of that same call's `gateway.jobs` span, whose parent span is the wake's `spanId`; and on the first finish that `traceId` is the one the `finished` event saved. Two calls' wakes never share a trace. Integration (node:sqlite), W1's runs: fast 10, full 60 | test | Effect Arbitrary: Tape | (a) today's code, no span around the branch: every wake's trace is undefined, W2 red; (b) open the span around the wake only: the trace is set but differs from the saved `traceId`, W2 red | next/packages/libfabrika/src/gateway/JobsTest.ts, run by next/packages/libfabrika/src/node/gateway/Jobs.integration.test.ts |
| W2b, the jobs branch's `gateway.route` span exists once per jobs call and holds `fab.gateway.outcome` with the answer's tag (`ok` or `refused`); a rate-refused jobs call still gets only `refuseRate`'s span, as today. Integration, same walk | test | Effect Arbitrary: Tape | drop the `Effect.tap` annotation: W2b red | next/packages/libfabrika/src/gateway/JobsTest.ts, run by next/packages/libfabrika/src/node/gateway/Jobs.integration.test.ts |
| R2, unchanged: the wake layer sends the caller's span or no trace, and fails only as unavailable. It must stay green: this plan does not move the "no span" case out of the layer | test | fc.string: name, with fc.boolean traced and rejects, 100 runs | (already planted by pull request 1318) | next/packages/libfabrika/src/cloudflare/mail.test.ts |
| A14, unchanged: the real Project takes, finishes and reads a job over a real socket on workerd. Host-only (real sockets, workerd): it runs only in CI's scheduled full run, never on the laptop | test | scenario: one real local instance on workerd, as the file runs today | none new | next/apps/fabrika/src/jobs-wire.integration.test.ts |

**Lint, type or test?** W2 and W2b are tests: they are about which span is current at run time,
which no type and no lint rule sees. A type could hold it only by making `MailWakeups.wake` take the
trace as an argument (see "Calls taken"), which this plan does not do.

**Where W2 runs.** JobsTest's suite runs only through `node/gateway/Jobs.integration.test.ts`, on
node:sqlite in a temp folder, so under
[0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md) a pull request leaves
it to the 3-hour schedule. The tests and build steps still run that one path narrowly on the laptop
while they work: it needs no real machine, no signal and no socket. No host-only law is new.

**W2's done marks.** W1's `required` list gains `traced` (a first finish's wake checked) and
`traced@repeat` (a repeat's wake checked), so an empty walk cannot pass.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/gateway/JobsTest.ts | tests | tests | the fake records each wake's trace; W2 and W2b in `woke` and the retry branch; `traced`, `traced@repeat` in W1's required marks; the header comment names W2 and its plants |
| next/packages/libfabrika/src/gateway/Gateway.ts | build | 20 | `routeJobs`, `Effect.fn("gateway.route")` with the outcome tag; `route`'s jobs branch calls it, then `flush` |
| next/packages/libfabrika/src/cloudflare/mail.ts | build | 2 | the `wakeups` doc: the gateway now wakes inside its span |
| next/packages/libfabrika/src/node/gateway/Jobs.integration.test.ts | tests | 0 | no change: it runs JobsTest's suite, W2 included |
| next/packages/libfabrika/src/cloudflare/mail.test.ts | tests | 0 | no change: R2 must stay green |
| next/apps/fabrika/src/jobs-wire.integration.test.ts | tests | 0 | no change: A14 must stay green, in CI's scheduled full run only |

`Jobs.ts` does not change: its `record` comment ("`route` is a named `Effect.fn`, so a span is
always here") stays true. `mail.test.ts` does not change: R2's header comment describes the sev1 as
it was, and stays as history.

## Calls taken

- **The span is named `gateway.route`, not a new name.** Every other branch of `route` (the two
  refusals, `routeInput`) already opens one `gateway.route` span, so after this every routed call
  has exactly one. Cost: from this merge, `gateway.route`'s health rows (one per span, by name,
  Sink.ts:290) also count jobs calls, and their time includes the wake's RPC. Nothing is lost: no
  hands client sends jobs calls before slice 4, so no earlier hour is missing them, and the
  `sums` table counts only spans with a refused tag, which this span never sets. 0252 fixes the
  `<piece>.<verb>` form; this follows the name the piece already uses.
- **The span goes around the branch, not around all of `route`.** Making all of `route` an
  `Effect.fn("gateway.route")` would nest every other branch's `gateway.route` and `gateway.input`
  spans one level deeper and change the trace every other method writes today. That is outside
  this finding.
- **`MailWakeups.wake(name)` keeps its signature.** A wake that took its trace as an argument would
  make "no trace" unrepresentable at the gateway, but it would also put the trace on
  `MailDeliveryLive`'s two calls and walk back R2, which pull request 1318 wrote so that a wake asks
  nothing of its caller. Context propagation through the current span is how Effect and
  OpenTelemetry carry a trace; the span fix is the plain way. 85% sure; what would change it: a
  second caller of `wake` that also forgets its span.
- **Is this a setting?** No new choice here is one. The span name is a code name that readers of
  health rows match on, not a value a person flips ([0069](../../../.decisions/0069-choices-are-settings.md)).

## Validation

- tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3 next/packages/libfabrika/src/node/gateway/Jobs.integration.test.ts`
  shows W2 red on main for plant (a), then plant (b) red once the build lands.
- build step: the same path green, and `next/packages/libfabrika/src/cloudflare/mail.test.ts`
  green.
- The lead runs `--changed origin/main` and one `pnpm typecheck`; A14 runs only in CI's scheduled
  full run.

## Size

1. One pull request: about 22 product lines (Gateway.ts 20, mail.ts 2), plus the JobsTest.ts law.

About 1 agent hour across the steps, 85% sure: the change is one function, and the law extends a
walk that already reaches every finish case. The doubt is the suite's span checks: W1's fake has to
match its recorded wake to the right `gateway.jobs` span among many, which may take a send-back.
Budget basis: `field/runs.jsonl` list-price medians of about $1.2 per tests, build and review step
(as cited in `docs/plan/lanes/t1040-PLAN.md`), with room for one fix round on a gateway suite that
runs about 2 minutes a walk set.

Estimate: 4 steps, $10

## Records

- What is lost if not recorded now: the link from a `finished` event's `traceId` to the
  requester's `runner.mailed` span. It exists only when the wake is sent; see "What fact is lost
  today".
- The finding row `field/findings/2026-11-15-a-finished-jobs-wake-carries-no-trace.json` gets its
  `pr` set to this pull request, by the lead at merge.
- `field/runs/` rows for each step, by the lead.
- No `.decisions/` file and no glossary row: no owner ruling and no new word.

## What this cannot tell us

- W2 checks the trace the gateway hands to the wake layer, with a fake wake. It does not see the
  real `runner.mailed` span join the trace in a real Process object: R2 proves the layer forwards
  the trace, and Runner.ts's `runner.mailed` is already a child of its caller's span (ProgramMailTest
  checks that for mail). A real end-to-end check would need A14 to read span rows, and a hands
  client may not read spans.
- It cannot tell whether a slow wake shows up well in a trace viewer; nothing reads these traces on
  screen yet.

## Open questions

None.

Searched first: `.decisions/` (0024, 0069, 0252, 0536), `docs/direction/effect-fn-for-traced-functions.md`,
`docs/direction/a-job-record-holds-its-trace.md`, and the settled-search tool for "wake trace",
"span per request" and "trace id job finish", which found nothing more. The span's name and place
follow what `route`'s other branches do and 0252; the wake's signature stays as pull request 1318
left it, and its law R2 stands.

## Findings

None outside this task.
