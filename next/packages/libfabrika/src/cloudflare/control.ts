/**
 * The local runtime's control entrypoint: a private, token-guarded way to call a fixed set of
 * methods on the Project, a Process, the Record, the Worker Loader or the bucket.
 */
import { Effect, Equal, Predicate, Redacted, Result, Schema } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { Connection } from "../presence/Connections.ts";
import { ExitReason } from "../processes/ExitReason.ts";
import { From } from "../processes/Mailbox.ts";
import { Activity, Start } from "../processes/Process.ts";
import { BrainEvent } from "../runtime/BrainEvent.ts";
import { CodeEvent, Install } from "../runtime/Code.ts";
import { Deletion, Sent } from "../telemetry/Records.ts";
import { Chain } from "../telemetry/Trace.ts";
import { ConnectionId } from "./bindings.ts";
import { httpContext } from "./fetch.ts";
import { workerLoader, type ProgramSource } from "./index.ts";
import { ProcessClient, ProjectClient, RecordClient } from "./platform.ts";
import {
  checkedPut,
  bucketHead,
  processStub,
  projectStub,
  recordStub,
  rpc,
  settingsFailure,
  type Env,
} from "./runtime.ts";

const Request = Schema.Struct({
  target: Schema.Literals(["project", "process", "record", "loader", "bucket"]),
  project: Schema.String,
  name: Schema.String,
  method: Schema.String,
  args: Schema.Array(Schema.Unknown),
});

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

/** One table entry: it decodes a request's arguments, or fails `bad_row`, and hands back the call
 *  on a client. */
type Entry<C> = (
  args: ReadonlyArray<unknown>,
) => Effect.Effect<(client: C) => Effect.Effect<unknown, unknown>, LedgerError>;

/** Entries on one client type: each method's payload decodes the arguments, then `call` passes
 *  them on. */
const entries =
  <C>() =>
  <A extends ReadonlyArray<unknown>>(
    payload: Schema.Codec<A, unknown>,
    call: (client: C, args: A) => Effect.Effect<unknown, unknown>,
  ): Entry<C> =>
  (args) =>
    Schema.decodeEffect(payload)(args).pipe(
      Effect.mapBoth({
        onFailure: (cause) => new LedgerError({ reason: "bad_row", cause }),
        onSuccess: (decoded) => (client: C) => call(client, decoded),
      }),
    );

const onProject = entries<ProjectClient["Service"]>();
const onProcess = entries<ProcessClient["Service"]>();
const onRecord = entries<RecordClient["Service"]>();

/** One target's calls by name, keyed exactly as its payloads are. A Map, so a name such as
 *  `toString` finds nothing. */
const table = <T extends Readonly<Record<string, unknown>>, C>(calls: {
  readonly [M in keyof T]: Entry<C>;
}): ReadonlyMap<string, Entry<C>> => new Map(Object.entries(calls));

const projectCalls = table<typeof Payloads.project, ProjectClient["Service"]>({
  clientConnect: onProject(Payloads.project.clientConnect, (c) => c.clientConnect()),
  challenge: onProject(Payloads.project.challenge, (c, a) => c.challenge(...a)),
  initialize: onProject(Payloads.project.initialize, (c, a) => c.initialize(...a)),
  route: onProject(Payloads.project.route, (c, a) => c.route(...a)),
  grant: onProject(Payloads.project.grant, (c, a) => c.grant(...a)),
  read: onProject(Payloads.project.read, (c, a) => c.read(...a)),
  append: onProject(Payloads.project.append, (c, a) => c.append(...a)),
  wait: onProject(Payloads.project.wait, (c, a) => c.wait(...a)),
  start: onProject(Payloads.project.start, (c, a) => c.start(...a)),
  exit: onProject(Payloads.project.exit, (c, a) => c.exit(...a)),
  info: onProject(Payloads.project.info, (c) => c.info()),
  sign: onProject(Payloads.project.sign, (c, a) => c.sign(...a)),
  commit: onProject(Payloads.project.commit, (c, a) => c.commit(...a)),
  join: onProject(Payloads.project.join, (c, a) => c.join(...a)),
  leave: onProject(Payloads.project.leave, (c, a) => c.leave(...a)),
  online: onProject(Payloads.project.online, (c, a) => c.online(...a)),
  brain: onProject(Payloads.project.brain, (c, a) => c.brain(...a)),
  codeInstall: onProject(Payloads.project.codeInstall, (c, a) => c.codeInstall(...a)),
  codeFailed: onProject(Payloads.project.codeFailed, (c, a) => c.codeFailed(...a)),
});

const processCalls = table<typeof Payloads.process, ProcessClient["Service"]>({
  msg: onProcess(Payloads.process.msg, (c, a) => c.msg(...a)),
  open: onProcess(Payloads.process.open, (c, a) => c.open(...a)),
  due: onProcess(Payloads.process.due, (c, a) => c.due(...a)),
  restart: onProcess(Payloads.process.restart, (c, a) => c.restart(...a)),
  abort: onProcess(Payloads.process.abort, (c) => c.abort()),
  activity: onProcess(Payloads.process.activity, (c, a) => c.activity(...a)),
  recover: onProcess(Payloads.process.recover, (c) => c.recover()),
  savedAlarm: onProcess(Payloads.process.savedAlarm, (c) => c.savedAlarm()),
});

const recordCalls = table<typeof Payloads.record, RecordClient["Service"]>({
  write: onRecord(Payloads.record.write, (c, a) => c.write(...a)),
  read: onRecord(Payloads.record.read, (c, a) => c.read(...a)),
  content: onRecord(Payloads.record.content, (c, a) => c.content(...a)),
  deleteContent: onRecord(Payloads.record.deleteContent, (c, a) => c.deleteContent(...a)),
});

const dispatch = Effect.fnUntraced(function* (
  env: Env,
  programs: Readonly<Record<string, ProgramSource>>,
  request: typeof Request.Type,
) {
  const { target, project, name, method, args } = request;

  if (target === "loader" || target === "bucket") {
    yield* settingsFailure(httpContext(env));
  }

  if (target === "loader") {
    const loaded = yield* workerLoader(env.LOADER, programs).load(name, project);

    if (method === "init") {
      return yield* loaded.execution.init(args[0]);
    }

    if (method === "step") {
      return yield* loaded.execution.step(args[0], args[1]);
    }

    return yield* Effect.fail({ reason: "unknown_method" });
  }

  if (target === "bucket") {
    if (method === "put") {
      const [key, bytes, checksum] = yield* Schema.decodeUnknownEffect(
        Schema.Tuple([Schema.String, Schema.Array(Schema.Number), Schema.String]),
      )(args).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));

      return yield* checkedPut(env.MEASUREMENTS, key, Uint8Array.from(bytes), checksum);
    }

    if (method === "head") {
      const [key] = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.String]))(args).pipe(
        Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
      );

      return yield* bucketHead(env.MEASUREMENTS, key);
    }

    return yield* Effect.fail({ reason: "unknown_method" });
  }

  // Only the names in the table above are callable. Public fetch never reaches this entrypoint.
  // Each call decodes its own arguments first: a list its payload refuses calls nothing.
  if (target === "project") {
    const entry = projectCalls.get(method);

    if (entry === undefined) {
      return yield* Effect.fail({ reason: "unknown_method" });
    }

    if (method === "commit" && Predicate.hasProperty(args[1], "process")) {
      return yield* Effect.fail({ reason: "reserved" });
    }

    const call = yield* entry(args);
    return yield* rpc(call(ProjectClient.make(projectStub(env, project))));
  }

  if (target === "process") {
    const entry = processCalls.get(method);

    if (entry === undefined) {
      return yield* Effect.fail({ reason: "unknown_method" });
    }

    const call = yield* entry(args);
    // A process ID reaches the object its registered name owns; the Project refuses an unknown ID.
    const client = ProcessClient.make(
      processStub(env, project, yield* rpc(ProjectClient.make(projectStub(env, project)).processObject(name))),
    );
    const answer = call(client);
    return yield* method === "abort" ? answer.pipe(Effect.ignore) : rpc(answer);
  }

  const entry = recordCalls.get(method);

  if (entry === undefined) {
    return yield* Effect.fail({ reason: "unknown_method" });
  }

  const call = yield* entry(args);
  return yield* rpc(call(RecordClient.make(recordStub(env, project, name))));
});

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
  const bearer = Redacted.make(request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]);

  if (!Equal.equals(token, bearer)) {
    return new Response(null, { status: 403 });
  }

  // oxlint-disable-next-line fabrika/no-promises -- edge: a Request body returns a Promise
  const raw = yield* Effect.tryPromise({ try: () => request.json(), catch: () => null });
  const input = Schema.decodeUnknownResult(Request)(raw);

  if (Result.isFailure(input)) {
    return Response.json({ error: { reason: "bad_input" } }, { status: 400 });
  }

  const answer = yield* Effect.result(dispatch(env, programs, input.success));

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
