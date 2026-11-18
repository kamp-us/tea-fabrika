/**
 * The local runtime's control entrypoint: a private, token-guarded way to call a fixed set of
 * methods on the Project, a Process, the Record, the Worker Loader or the bucket.
 */
import { Effect, Equal, Redacted, Result, Schema } from "effect";
import * as Function from "effect/Function";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Str from "effect/String";
import { Connection } from "../presence/Connections.ts";
import { ExitReason } from "../processes/ExitReason.ts";
import { From } from "../processes/Mailbox.ts";
import { Activity, Start } from "../processes/Process.ts";
import { BrainEvent } from "../runtime/BrainEvent.ts";
import { CodeEvent, Install } from "../runtime/Code.ts";
import { Deletion, Sent } from "../telemetry/Records.ts";
import { Chain } from "../telemetry/Trace.ts";
import { ConnectionId } from "./bindings.ts";
import { Dispatcher, Request } from "./Dispatcher.ts";
import type { ProgramSource } from "./index.ts";
import type { Env } from "./runtime.ts";

/** No arguments: the empty list, and any argument is refused. It is an array of `Never` and not
 *  `Schema.Tuple([])`, whose empty tuple type crashes the TypeScript 7.0.2 API that
 *  `lint:promise-types` reads types through. */
const None = Schema.Array(Schema.Never);

/** A number as JSON carries it: never NaN or an infinity. */
const Num = Schema.Finite;

/** Who a client's hello says it is, as the door's caller vouches for it. */
const Trusted = Schema.Struct({
  url: Schema.String,
  tab: Schema.String,
  name: Schema.String,
  session: Schema.optionalKey(Schema.String),
});

/** A Project `commit`'s line: the append's input without its `process`, which the door refuses. */
const Commit = Schema.Struct({
  id: Schema.String,
  parent: Schema.String,
  kind: Schema.String,
  stream: Schema.String,
  event: Schema.Json,
});

/**
 * The door's table of argument schemas: for each target, one tuple per callable method, which
 * decodes that method's arguments from the request (the payload of Effect's `Rpc.make`).
 *
 * **Details**
 *
 * Each schema needs no service and its encoded side is JSON. A method with no arguments takes the
 * empty tuple. The keys are the only names the door calls.
 *
 * @category schemas
 */
export const Payloads = {
  project: {
    clientConnect: None,
    challenge: Schema.Tuple([ConnectionId]),
    initialize: Schema.Tuple([ConnectionId, Schema.Json, Trusted]),
    route: Schema.Tuple([ConnectionId, Schema.String, Schema.Json, Schema.optionalKey(Schema.String)]),
    grant: Schema.Tuple([Schema.Json]),
    read: Schema.Tuple([Schema.String, Num, Schema.String]),
    append: Schema.Tuple([Schema.String, Schema.String, Schema.Json]),
    wait: Schema.Tuple([Schema.String, Num, Schema.String]),
    start: Schema.Tuple([Start, From]),
    exit: Schema.Tuple([Schema.String, ExitReason, From]),
    info: None,
    sign: Schema.Tuple([Schema.String, Schema.String, Schema.String, Schema.String]),
    commit: Schema.Tuple([Schema.String, Commit]),
    join: Schema.Tuple([Connection]),
    leave: Schema.Tuple([Schema.String, Schema.String]),
    online: Schema.Tuple([Schema.String]),
    brain: Schema.Tuple([BrainEvent]),
    codeInstall: Schema.Tuple([Install]),
    codeFailed: Schema.Tuple([CodeEvent.cases["code.failed"]]),
  },
  process: {
    msg: Schema.Tuple([Schema.Json]),
    open: Schema.Tuple([Schema.String]),
    due: Schema.Tuple([Num]),
    restart: Schema.Tuple([Schema.Struct({ id: Schema.String, build: Schema.String })]),
    abort: None,
    activity: Schema.Tuple([Activity]),
    recover: None,
    savedAlarm: None,
  },
  record: {
    write: Schema.Tuple([Chain, Num, Schema.Array(Sent)]),
    read: Schema.Tuple([Chain, Num, Num]),
    content: Schema.Tuple([Chain, Num, Schema.String]),
    deleteContent: Schema.Tuple([Chain, Num, Schema.String, Deletion]),
  },
};

/**
 * Answers one control request: a JSON body naming a target, a project, a name, a method and its
 * arguments.
 *
 * **Details**
 *
 * A request whose bearer token is not `token` gets a 403, and a body that does not decode gets a 400
 * with reason `bad_input`. Only the listed methods of each target are called; another fails with
 * reason `unknown_method`, and a Project `commit` that names its own `process` with reason
 * `reserved`. A success answers `{ value }`, and a failure a 500 with `{ error: { reason } }`.
 *
 * @category combinators
 */
export const control = Effect.fn("runtime.control")(function* (
  request: globalThis.Request,
  env: Env,
  token: Redacted.Redacted<string>,
  programs: Readonly<Record<string, ProgramSource>>,
) {
  const bearer = Redacted.make(
    Function.pipe(
      request.headers.get("authorization") ?? "",
      Str.match(/^Bearer (.+)$/),
      Option.map((found) => found[1]),
      Option.getOrUndefined,
    ),
  );

  if (!Equal.equals(token, bearer)) {
    return new Response(null, { status: 403 });
  }

  // oxlint-disable-next-line fabrika/no-promises -- edge: a Request body returns a Promise
  const raw = yield* Effect.tryPromise({ try: () => request.json(), catch: () => null });
  const input = Schema.decodeUnknownResult(Request)(raw);

  if (Result.isFailure(input)) {
    return Response.json({ error: { reason: "bad_input" } }, { status: 400 });
  }

  // The service is read on each request, so a law that provides another one sees every dispatch.
  const dispatcher = yield* Dispatcher;
  const answer = yield* Effect.result(dispatcher.dispatch(env, programs, input.success));

  return Result.isSuccess(answer)
    ? Response.json({ value: answer.success ?? null })
    : Response.json(
        {
          error: {
            reason:
              Predicate.isObjectOrArray(answer.failure) && "reason" in answer.failure
                ? answer.failure.reason
                : "unreachable",
          },
        },
        { status: 500 },
      );
});
