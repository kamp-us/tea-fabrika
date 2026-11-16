/**
 * Turns one incoming JSON-RPC text frame into the text to send back and the attachment to keep.
 */
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { REFUSED } from "../SpanTag.ts";
import { Routes } from "./Routes.ts";
import { Answer, Attached, RateCountFailure } from "./Wire.ts";

const Request = Schema.fromJsonString(
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.Union([Schema.String, Schema.Finite]),
    method: Schema.String,
    params: Schema.optional(Schema.Unknown),
  }),
);

/**
 * Answers one JSON-RPC 2.0 text frame by asking the `Routes` service, and shapes its answer for
 * the wire.
 *
 * **Details**
 *
 * Takes the text and the connection's current `Attached` state. The result is `{ send, attached }`:
 * `send` is the text to write back, or `null` when nothing is written, and `attached` is the state
 * to save. `Routes` is the only service it asks for, so it cannot reach the hello's admission. An
 * online connection passes its checked identity to `route`; any other connection passes `null`.
 *
 * - Text that is not a JSON-RPC 2.0 request sends nothing and keeps `attached`.
 * - A connection that is not online answers every request with a `no_hello` error, except that a
 *   waiting one may still call `gateway.knock`. `route` is not called for the refused request.
 * - An `ok` answer becomes a JSON-RPC result. A `refused` answer becomes a `-32000` error whose
 *   message and `data.reason` are the reason, plus `data.retryAfter` when the answer has one.
 * - A `parked` answer sends nothing. On an online connection it adds the request's id, stream and
 *   position to `waits`, so a later ring can answer it. Otherwise `attached` is unchanged.
 * - If `route` fails, nothing is sent and `attached` is unchanged. The failure is not rethrown.
 *
 * **Gotchas**
 *
 * A `reserved` or `rate_limited` refusal, and a failure that is a `RateCountFailure`, are also
 * recorded on the current span as the refused tag. The tag is `rate_limited` for that failure.
 *
 * @category combinators
 */
export const answerFrame = Effect.fn("transport.answerFrame")(function* <A extends typeof Attached.Type>(
  text: string,
  attached: A,
) {
  const routes = yield* Routes;
  const request = Schema.decodeResult(Request)(text);

  if (Result.isFailure(request)) {
    return { send: null, attached };
  }

  const { id, method, params } = request.success;

  if (attached._tag !== "online" && !(attached._tag === "waiting" && method === "gateway.knock")) {
    return {
      send: JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: "no_hello", data: { reason: "no_hello" } },
      }),
      attached,
    };
  }

  const exit = yield* Effect.exit(routes.route(method, params, attached._tag === "online" ? attached.identity : null));

  if (Exit.isFailure(exit)) {
    if (Option.exists(Exit.findErrorOption(exit), Schema.is(RateCountFailure))) {
      yield* Effect.annotateCurrentSpan(REFUSED, "rate_limited");
    }

    return { send: null, attached };
  }

  if (exit.value._tag === "refused" && ["reserved", "rate_limited"].includes(exit.value.reason)) {
    yield* Effect.annotateCurrentSpan(REFUSED, exit.value.reason);
  }

  return Answer.match(exit.value, {
    ok: ({ result }) => ({ send: JSON.stringify({ jsonrpc: "2.0", id, result }), attached }),
    refused: ({ reason, retryAfter }) => ({
      send: JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: reason, data: { reason, ...(retryAfter === undefined ? {} : { retryAfter }) } },
      }),
      attached,
    }),
    parked: ({ stream, after }) => ({
      send: null,
      attached:
        attached._tag === "online"
          ? Attached.cases.online.make({
              ...attached,
              waits: [...attached.waits, { id, stream, after }],
            })
          : attached,
    }),
  });
});
