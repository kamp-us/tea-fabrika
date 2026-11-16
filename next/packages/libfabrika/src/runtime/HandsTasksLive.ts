/**
 * The `HandsTasks` layer over `Tasks`, run in the Project inside its shared write turn.
 *
 * @stability unstable
 */
import { Effect, Layer } from "effect";
import type { From } from "../processes/Mailbox.ts";
import { needs } from "../tasks/Task.ts";
import { Tasks, type TasksError } from "../tasks/Tasks.ts";
import { type Ask, HandsTasks, HandsTasksError, Reply } from "./HandsTasks.ts";

/** A task that is not this process's is refused `id_reused` for good (the tasks module says `conflict` or `wrong_process`); every other task error is storage. */
const translated = (cause: TasksError) =>
  cause.reason === "conflict" || cause.reason === "wrong_process"
    ? Effect.succeed(Reply.cases.refused.make({ reason: "id_reused" }))
    : Effect.fail(HandsTasksError.make({ reason: "storage", cause }));

/**
 * Layer that supplies `HandsTasks` over `Tasks`. `target` is the person's `hands.target`, `null` when
 * unset, and `settings` the instance start's settings hash, the request's `settings`.
 *
 * **Details**
 *
 * `ask` reads the saved task first. With none, an unset target answers `refused` and writes nothing,
 * and a set one requests the task and answers `waiting`. A saved task that has no result answers
 * `waiting` with its request's receipt, and a finished one is collected by the asking process into
 * the Cmd's answer letter, `<id>/answer`, and answers `finished`. A retry never makes a second
 * request, so a target changed since never conflicts with the saved one. A saved task whose request
 * names another process is refused `id_reused` in every state, with no receipt and no result.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (options: { readonly target: string | null; readonly settings: string }) =>
  Layer.effect(
    HandsTasks,
    Effect.gen(function* () {
      const tasks = yield* Tasks;

      const ask = Effect.fn("hands_tasks.ask")(
        function* (ask: typeof Ask.Type, from: From) {
          yield* Effect.annotateCurrentSpan({ "fab.hands.task": ask.id });
          const saved = yield* tasks.read(ask.id).pipe(
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
            return Reply.cases.waiting.make(yield* tasks.request(request, from));
          }

          const s = saved.state;

          // The task machine refuses another process only once a task is finished, so this check is
          // what keeps a requested, assigned or started task's receipt from another process.
          if (s._tag === "absent" || s.request.process !== ask.process) {
            return Reply.cases.refused.make({ reason: "id_reused" });
          }

          if (s._tag !== "finished" && s._tag !== "collected") {
            const requested = saved.events.find((event) => event.event === "requested");

            if (requested === undefined) {
              return yield* HandsTasksError.make({ reason: "storage" });
            }

            return Reply.cases.waiting.make({ rev: requested.rev, arrivedAt: requested.arrivedAt });
          }

          const receipt = yield* tasks.collected(ask.id, { process: ask.process, letter: `${ask.id}/answer` }, from);
          return Reply.cases.finished.make({ result: s.result, ...receipt });
        },
        Effect.catchTag("TasksError", translated),
      );

      return HandsTasks.of({ ask });
    }),
  );
