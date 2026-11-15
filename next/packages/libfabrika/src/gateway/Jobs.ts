/**
 * Job methods over an authenticated connection, called inside the shared write turn.
 *
 * @stability unstable
 */
import { Effect, Result, Schema, Stream } from "effect";
import { Job, Result as JobResult, type Recorded } from "../jobs/Job.ts";
import { type Jobs, targetStream } from "../jobs/Jobs.ts";
import { ProcessId } from "../ProcessId.ts";
import { Rev } from "../Rev.ts";
import { Answer, type Attached } from "../transport/Wire.ts";
import * as JobAccess from "./JobAccess.ts";

const Meta = { sentAt: Schema.String, seen: Rev };
const Take = Schema.Struct({ process: ProcessId, ...Meta });
const Read = Schema.Struct({ process: ProcessId, job: Schema.NonEmptyString });
const Started = Schema.Struct({ ...Read.fields, execution: Schema.NonEmptyString, ...Meta });
const Finish = Schema.Struct({ ...Started.fields, result: JobResult });
/** `jobs.list` takes nothing: the stream it reads comes from the caller's own key. An empty
 *  `Struct` lets any field through even when strict, so no field at all is a record of nothing. */
const List = Schema.Record(Schema.String, Schema.Never);
/** `jobs.wait` takes only the rev it waits past, never a stream or a key. */
const Wait = Schema.Struct({ after: Rev });

const TakeReply = Schema.TaggedUnion({
  idle: {},
  assigned: { job: Job },
  refused: { reason: Schema.String },
});

const strict = { onExcessProperty: "error" } as const;

/** What one job call answers, and the registered name to wake once the write turn is free: the
 *  requester's, after a finish was accepted or repeated, so its program collects the result. */
type Routed = { readonly answer: typeof Answer.Type; readonly wake: string | null };

const no = (reason: string): Routed => ({ answer: Answer.cases.refused.make({ reason }), wake: null });

/** The refusal a call from someone other than a hands client that said hello gets, or null. */
const refusal = (attached: typeof Attached.cases.online.Type): string | null =>
  attached.identity.as !== "hands"
    ? "not_allowed"
    : attached.has === undefined || attached.build === undefined
      ? "no_hello"
      : null;

/**
 * What one `jobs.wait` parks on: the caller's own `target:` stream past `after`, or the reason it is
 * refused. The stream comes from the authenticated key, never from the params, which hold `after`
 * and nothing else. The gateway parks it outside the write turn, on the path `ledger.wait` takes.
 *
 * @stability unstable
 * @category routing
 */
export const waitOn = (
  attached: typeof Attached.cases.online.Type,
  input: unknown,
): Result.Result<{ readonly stream: string; readonly after: Rev }, string> => {
  const refused = refusal(attached);

  if (refused !== null) {
    return Result.fail(refused);
  }

  const decoded = Schema.decodeUnknownResult(Wait, strict)(input);
  return Result.isFailure(decoded)
    ? Result.fail("bad_input")
    : Result.succeed({ stream: targetStream(attached.identity.key), after: decoded.success.after });
};

const ok = (result: Schema.Json, wake: string | null = null): Routed => ({
  answer: Answer.cases.ok.make({ result }),
  wake,
});

/**
 * Routes one job call after fresh authentication inside the Project's shared write turn. A taken
 * finish names its requester to wake; the caller wakes it after the turn and before it answers.
 *
 * @stability unstable
 * @category routing
 */
export const route = Effect.fn("gateway.jobs")(
  function* (jobs: Jobs["Service"], attached: typeof Attached.cases.online.Type, method: string, input: unknown) {
    const { identity, has, build, client } = attached;
    const refused = refusal(attached);

    if (refused !== null || has === undefined || build === undefined) {
      return no(refused ?? "no_hello");
    }

    if (method === "jobs.list") {
      if (Result.isFailure(Schema.decodeUnknownResult(List)(input))) {
        return no("bad_input");
      }

      // Pointers only: the command stays behind `jobs.take`, the one door work reaches a machine by.
      const listed = yield* jobs.forTarget(identity.key);
      const pointers = listed.jobs.flatMap(({ state }) =>
        state._tag === "absent" ? [] : [{ id: state.request.id, process: state.request.process }],
      );
      return ok({ jobs: pointers, rev: listed.rev });
    }

    const subject = { key: identity.key };
    const record = Effect.fnUntraced(function* (job: Job, meta: typeof Take.Type): Effect.fn.Return<Recorded> {
      // `route` is a named `Effect.fn`, so a span is always here: its absence is a defect.
      const span = yield* Effect.currentSpan.pipe(Effect.orDie);
      return {
        by: identity.key,
        for: identity.person,
        sentAt: meta.sentAt,
        seen: meta.seen,
        parent: job.state._tag === "absent" ? null : job.state.request.parent,
        traceId: span.traceId,
        build,
        connection: client,
        has,
      };
    });

    if (method === "jobs.take") {
      const decoded = Schema.decodeUnknownResult(Take, strict)(input);

      if (Result.isFailure(decoded)) {
        return no("bad_input");
      }

      const params = decoded.success;
      const values = yield* Stream.runCollect(jobs.forProcess(params.process));
      const selected = JobAccess.select(values, { ...subject, process: params.process });

      if (Result.isFailure(selected)) {
        return ok(TakeReply.cases.refused.make({ reason: selected.failure }));
      }

      const job = selected.success;

      if (job === null) {
        return ok(TakeReply.cases.idle.make({}));
      }

      if (!JobAccess.owns(job, { ...subject, process: params.process }) || job.state._tag === "absent") {
        return no("not_allowed");
      }

      if (!job.state.request.needs.every((need) => has.includes(need))) {
        return no("lacks_capability");
      }

      yield* jobs.take(
        job.state.request.id,
        { key: identity.key, connection: client, has, build },
        yield* record(job, params),
      );
      return ok(TakeReply.cases.assigned.make({ job: yield* jobs.read(job.state.request.id) }));
    }

    if (method === "jobs.read") {
      const decoded = Schema.decodeUnknownResult(Read, strict)(input);

      if (Result.isFailure(decoded)) {
        return no("bad_input");
      }

      const params = decoded.success;
      const job = yield* jobs.read(params.job);
      return JobAccess.owns(job, { ...subject, process: params.process }) ? ok(job) : no("not_allowed");
    }

    if (method === "jobs.started" || method === "jobs.finish") {
      const decoded =
        method === "jobs.started"
          ? Schema.decodeUnknownResult(Started, strict)(input)
          : Schema.decodeUnknownResult(Finish, strict)(input);

      if (Result.isFailure(decoded)) {
        return no("bad_input");
      }

      // Only a finish carries a result: `Started` refuses one as an excess property.
      const params: typeof Started.Type & { readonly result?: JobResult } = decoded.success;
      const job = yield* jobs.read(params.job);

      if (
        !JobAccess.owns(job, { ...subject, process: params.process, execution: params.execution }) ||
        job.state._tag === "absent"
      ) {
        return no("not_allowed");
      }

      if (!job.state.request.needs.every((need) => has.includes(need))) {
        return no("lacks_capability");
      }

      const recorded = yield* record(job, params);

      if (params.result === undefined) {
        return ok(yield* jobs.started(params.job, params.execution, recorded));
      }

      return ok(yield* jobs.finish(params.job, params.execution, params.result, recorded), job.state.request.name);
    }

    return no("unknown_method");
  },
  Effect.catchTag("JobsError", (error) => Effect.succeed(no(error.reason))),
);
