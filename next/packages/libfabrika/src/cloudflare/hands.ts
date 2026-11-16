/**
 * The Process side of a hands Cmd: `HandsTasks` over the Project's `hands` RPC.
 */
import { Effect, Layer, Schema } from "effect";
import { HandsTasks, HandsTasksError, Reply } from "../runtime/HandsTasks.ts";
import { ProjectClient } from "./platform.ts";
import { type Env, projectStub, rpc } from "./runtime.ts";

/** A reply with a field the contract does not have is not one the runner may trust. */
const decodeReply = Schema.decodeUnknownEffect(Reply, { onExcessProperty: "error" });

const unavailable = (cause: unknown) => new HandsTasksError({ reason: "unavailable", cause });

/**
 * Layer that asks the Project for a hands Cmd's task.
 *
 * **Details**
 *
 * A good reply decodes strictly into the Project's own `Reply`. A lost or failed call, or a reply
 * that does not decode, is `unavailable`: it leaves the Cmd dispatched for its retry, and is never
 * an answer the program reads.
 *
 * @category layers
 */
export const handsLayer = (env: Env, project: string): Layer.Layer<HandsTasks> =>
  Layer.succeed(
    HandsTasks,
    HandsTasks.of({
      ask: Effect.fn("process.hands")(function* (ask, from) {
        const span = yield* Effect.currentSpan.pipe(Effect.orDie);
        const reply = yield* rpc(
          ProjectClient.make(projectStub(env, project))
            .hands(ask, from, { traceId: span.traceId, spanId: span.spanId })
            .pipe(Effect.mapError(unavailable)),
        );
        return yield* decodeReply(reply).pipe(Effect.mapError(unavailable));
      }),
    }),
  );
