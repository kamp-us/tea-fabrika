/**
 * The `HandsJobs` layer over `Jobs`, run in the Project inside its shared write turn.
 *
 * @stability unstable
 */
import { Effect, Layer } from "effect";
import { needs } from "../jobs/Job.ts";
import { Jobs, type JobsError } from "../jobs/Jobs.ts";
import type { From } from "../processes/Mailbox.ts";
import { type Ask, HandsJobs, HandsJobsError, Reply } from "./HandsJobs.ts";

/** A job that is not this process's is refused for good; every other job error is storage. */
const translated = (cause: JobsError) =>
  cause.reason === "conflict" || cause.reason === "wrong_process"
    ? Effect.succeed(Reply.cases.refused.make({ reason: "conflict" }))
    : Effect.fail(new HandsJobsError({ reason: "storage", cause }));

/**
 * Layer that supplies `HandsJobs` over `Jobs`. `target` is the person's `hands.target`, `null` when
 * unset, and `settings` the instance start's settings hash, the request's `settings`.
 *
 * **Details**
 *
 * `ask` reads the saved job first. With none, an unset target answers `refused` and writes nothing,
 * and a set one requests the job and answers `waiting`. A saved job that has no result answers
 * `waiting` with its request's receipt, and a finished one is collected by the asking process into
 * the Cmd's answer letter, `<id>/answer`, and answers `finished`. A retry never makes a second
 * request, so a target changed since never conflicts with the saved one. A saved job whose request
 * names another process is refused `conflict` in every state, with no receipt and no result.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (options: { readonly target: string | null; readonly settings: string }) =>
  Layer.effect(
    HandsJobs,
    Effect.gen(function* () {
      const jobs = yield* Jobs;

      const ask = Effect.fn("hands_jobs.ask")(
        function* (ask: typeof Ask.Type, from: From) {
          yield* Effect.annotateCurrentSpan({ "fab.hands.job": ask.id });
          const saved = yield* jobs.read(ask.id).pipe(
            Effect.catchIf(
              (error) => error.reason === "not_found",
              () => Effect.succeed(null),
            ),
          );

          if (saved === null) {
            if (options.target === null) {
              return Reply.cases.refused.make({ reason: "no_hands" });
            }

            const request = { ...ask, needs: needs(ask.command), target: options.target, settings: options.settings };
            return Reply.cases.waiting.make(yield* jobs.request(request, from));
          }

          const s = saved.state;

          // The job machine refuses another process only once a job is finished, so this check is
          // what keeps a requested, assigned or started job's receipt from another process.
          if (s._tag === "absent" || s.request.process !== ask.process) {
            return Reply.cases.refused.make({ reason: "conflict" });
          }

          if (s._tag !== "finished" && s._tag !== "collected") {
            const requested = saved.events.find((event) => event.event === "requested");

            if (requested === undefined) {
              return yield* new HandsJobsError({ reason: "storage" });
            }

            return Reply.cases.waiting.make({ rev: requested.rev, arrivedAt: requested.arrivedAt });
          }

          const receipt = yield* jobs.collected(ask.id, { process: ask.process, letter: `${ask.id}/answer` }, from);
          return Reply.cases.finished.make({ result: s.result, ...receipt });
        },
        Effect.catchTag("JobsError", translated),
      );

      return HandsJobs.of({ ask });
    }),
  );
