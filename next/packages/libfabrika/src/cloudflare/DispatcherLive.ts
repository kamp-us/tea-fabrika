/**
 * The `Dispatcher` layer: the control door's call table, run against the Worker's bindings.
 */
import { Effect, Layer, Predicate, Schema } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { Payloads } from "./control.ts";
import { Dispatcher, type Request } from "./Dispatcher.ts";
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
 * Layer that provides `Dispatcher`: it runs one decoded control request against the Worker's
 * bindings.
 *
 * **Details**
 *
 * Only the names in the door's table are callable, and each call decodes its own arguments first,
 * so a list its payload refuses calls nothing. A request names a target, and the answer is that
 * call's value or its failure: `bad_row` for arguments that do not decode, `unknown_method` for a
 * name the table lacks, and `reserved` for a Project `commit` that names its own `process`.
 *
 * @category layers
 */
export const layer: Layer.Layer<Dispatcher> = Layer.succeed(Dispatcher, Dispatcher.of({ dispatch }));
