/**
 * The Cloudflare runtime of a brain: the Project and Process Durable Objects' services and layers, the
 * stubs and RPC replies they talk through, and the bucket and recording layers they share.
 */
import { makeRpcStub } from "@alchemy.run/cloudflare/Bridge";
import { applyCell } from "@demlik/tea";
import {
  type Cause,
  Clock,
  Context,
  Effect,
  Equal,
  Exit,
  Fiber,
  Layer,
  Option,
  Predicate,
  Result,
  Schema,
  Semaphore,
  Stream,
  Tracer,
} from "effect";
import { Base64, Base64Url } from "effect/encoding";
import * as Formatter from "effect/Formatter";
import * as Rec from "effect/Record";
import * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import { admitted } from "../access/Access.ts";
import { ClientManager } from "../access/ClientManager.ts";
import * as ClientManagerLedger from "../access/ClientManagerLedger.ts";
import {
  NotGranted,
  type SessionManagerError,
  SigningRefused,
  Writer,
  type Session,
} from "../access/SessionManager.ts";
import * as SessionSenders from "../access/SessionSenders.ts";
import * as Id from "../Id.ts";
import { Doorbell, Ledger, LedgerError } from "../ledger/Ledger.ts";
import * as LedgerRemote from "../ledger/LedgerRemote.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import { LedgerStreams } from "../ledger/LedgerStreams.ts";
import * as LedgerStreamsSql from "../ledger/LedgerStreamsSql.ts";
import { LedgerTransaction } from "../ledger/LedgerTransaction.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { type Appended, type Entry, fromHere, Line, lineFor, valueFor, type Waited } from "../ledger/Log.ts";
import { Referee } from "../ledger/Referee.ts";
import * as RefereeSql from "../ledger/RefereeSql.ts";
import { WritePolicy } from "../ledger/WritePolicy.ts";
import { Model } from "../permissions/Model.ts";
import * as Relation from "../permissions/Relation.ts";
import { Relations } from "../permissions/Relations.ts";
import * as RelationsLedger from "../permissions/RelationsLedger.ts";
import { Senders } from "../permissions/Senders.ts";
import { Connections } from "../presence/Connections.ts";
import {
  type Child,
  Children,
  ChildrenError,
  type ChildStop,
  type StartGrant,
  type Started,
} from "../processes/Children.ts";
import * as ChildrenLedger from "../processes/ChildrenLedger.ts";
import { decodeExitReason, type ExitReason } from "../processes/ExitReason.ts";
import { Mailbox, type From, type Letter } from "../processes/Mailbox.ts";
import { Monitors, MonitorsError, type Unwatch, type Watch, type Watched } from "../processes/Monitors.ts";
import * as MonitorsLedger from "../processes/MonitorsLedger.ts";
import {
  type Activity,
  type DeadInput,
  Owner,
  ProcessError,
  type ProcessInfo,
  Recipient,
  type Recovered,
  recoverActivity,
  Start,
  type StartAnswer,
  type State,
} from "../processes/Process.ts";
import { ProcessIdGenerator } from "../processes/ProcessIdGenerator.ts";
import { ProcessManager, remoteProcessManager, type ProcessCalls } from "../processes/ProcessManager.ts";
import { ProgramMail, type ProgramMailError, type Delivery, type Grants } from "../processes/ProgramMail.ts";
import * as ProgramMailLedger from "../processes/ProgramMailLedger.ts";
import { Quotas, type QuotasError } from "../processes/Quotas.ts";
import * as Audit from "../runtime/Audit.ts";
import type { BrainEvent } from "../runtime/BrainEvent.ts";
import { BuiltProgram } from "../runtime/Built.ts";
import type { Selected } from "../runtime/Code.ts";
import { code as codeMachine, CodeEvent, Install, Installed } from "../runtime/Code.ts";
import { CodeStore, type CodeStoreError } from "../runtime/CodeStore.ts";
import * as CodeStoreSql from "../runtime/CodeStoreSql.ts";
import { Alarm, CheckedWriter, Recording, type Incoming } from "../runtime/Entry.ts";
import type { Declaration } from "../runtime/Execution.ts";
import { type Ask, HandsTasks, type HandsTasksError, type Reply as HandsReply } from "../runtime/HandsTasks.ts";
import * as HandsTasksLive from "../runtime/HandsTasksLive.ts";
import * as IsolateUsage from "../runtime/IsolateUsage.ts";
import { MailWakeups } from "../runtime/MailWakeups.ts";
import { type News, Published } from "../runtime/News.ts";
import { Checkpoint, ProcessStore, RuntimeRecord } from "../runtime/ProcessStore.ts";
import { ProgramDown } from "../runtime/Program.ts";
import * as QuotaRunner from "../runtime/QuotaRunner.ts";
import type { RecoveryStoreError } from "../runtime/RecoveryStore.ts";
import type { RepliesError } from "../runtime/Replies.ts";
import type { Descriptor, Opened, RunnerError, Swapped } from "../runtime/Runner.ts";
import { defaultPolicy, ProgramRunner, Sent } from "../runtime/Runner.ts";
import type { Publication } from "../runtime/WatcherManager.ts";
import type { WatchersError } from "../runtime/Watchers.ts";
import { RecordedStart } from "../settings/RecordedStart.ts";
import * as SettingsStart from "../settings/Start.ts";
import * as Starts from "../settings/Starts.ts";
import { type Sql } from "../Sql.ts";
import type { Tasks } from "../tasks/Tasks.ts";
import * as TasksLedger from "../tasks/TasksLedger.ts";
import { Archive, type BucketCalls } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { SinkError } from "../telemetry/Trace.ts";
import { Answer, RateCountFailure } from "../transport/Wire.ts";
import {
  ChildReplies,
  StopReplies,
  MonitorReplies,
  CommitReply,
  MailReplies,
  type MailReply,
  ProcessReplies,
  SigningReply,
  type ConnectionId,
  type GatewayCalls,
  type ConnectionBinding,
  type ProcessBinding,
  type ProcessReply,
  type ProjectBinding,
  type RecordBinding,
} from "./bindings.ts";
import { cloudflareSql } from "./CloudflareSql.ts";
import { handsLayer } from "./hands.ts";
import { workerLoader, type ProgramSource } from "./index.ts";
import { mailLayer, wakeups } from "./mail.ts";
import type { RecordShape } from "./objects.ts";
import { BucketClient, GatewayClient, ProcessClient, ProjectClient, StorageClient } from "./platform.ts";
import * as Publish from "./Publish.ts";
import * as ProjectQuotas from "./quotas.ts";
import * as SettingsInput from "./SettingsInput.ts";
import * as SettingsRecorded from "./SettingsRecorded.ts";
import * as SettingsRuntime from "./SettingsRuntime.ts";
import * as SettingsStartsLedger from "./SettingsStartsLedger.ts";
import * as SettingsStartsRemote from "./SettingsStartsRemote.ts";
import { bind as bindTail } from "./tail.ts";
import * as WatcherManagerRemote from "./WatcherManagerRemote.ts";

const Event = Schema.declare<Parameters<typeof lineFor>[1]>(
  (value): value is Parameters<typeof lineFor>[1] =>
    Schema.is(Schema.JsonObject)(value) && Predicate.isString(value._tag),
);

const SavedDescriptor = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  program: Schema.String,
  build: Schema.String,
  owner: Writer,
});

/**
 * The bindings a brain's Worker and objects read: the start's `INSTANCE` JSON, the four Durable Object
 * namespaces, the Worker Loader and the measurements bucket.
 *
 * @category models
 */
export interface Env {
  readonly INSTANCE: string;
  readonly PROJECT: DurableObjectNamespace<ProjectBinding>;
  readonly PROCESS: DurableObjectNamespace<ProcessBinding>;
  readonly CONNECTION: DurableObjectNamespace<ConnectionBinding>;
  readonly RECORD: DurableObjectNamespace<RecordBinding>;
  readonly LOADER: WorkerLoader;
  readonly MEASUREMENTS: R2Bucket;
}

/**
 * The start's input a brain is configured with, as `SettingsStart.Input`.
 *
 * @category models
 */
export type BrainOptions = SettingsStart.Input;

/**
 * Decodes the `INSTANCE` binding's JSON as a start's input and checks its settings. Returns the
 * input, the decoded values and the snapshot in its canonical encoding. It records nothing.
 *
 * @category decoding
 */
export const settings = (env: Pick<Env, "INSTANCE">) => SettingsInput.decode(env.INSTANCE);

const checkedSettings = (env: Env) =>
  settings(env).pipe(Effect.mapError((cause) => new Starts.StartsError({ reason: new Starts.Decode({ cause }) })));

type CheckedSettings = Effect.Success<ReturnType<typeof settings>>;

/**
 * Layer that provides `RecordedStart` to a Worker or an object by recording the start with the
 * Project object.
 *
 * **Details**
 *
 * It takes the start's input from the `INSTANCE` binding, or from `input` when one is given, and
 * records it over RPC with the Project object the input names. The Project object does not use
 * this layer: it records the start in its own ledger.
 *
 * @category layers
 */
export function recordedLayer(env: Env): Layer.Layer<RecordedStart, Starts.StartsError>;
export function recordedLayer(
  env: Env,
  input: Effect.Effect<CheckedSettings, LedgerError>,
): Layer.Layer<RecordedStart, LedgerError | Starts.StartsError>;
export function recordedLayer(
  env: Env,
  input: Effect.Effect<CheckedSettings, LedgerError | Starts.StartsError> = checkedSettings(env),
) {
  return Layer.unwrap(
    input.pipe(
      Effect.map(({ input }) =>
        SettingsRecorded.layer(input).pipe(Layer.provide(SettingsStartsRemote.layer(projectStub(env, input.name)))),
      ),
    ),
  );
}

export {
  /**
   * A runtime for one layer whose build can be tried again after it fails.
   *
   * @category constructors
   */
  SettingsRuntime,
};

/**
 * Converts a `Starts` answer into the reply sent over RPC: `ok` with the receipt, or the failure's
 * reason by its tag alone. The effect no longer fails with `StartsError`.
 *
 * @category error handling
 */
export const settingsReply = <R>(work: Effect.Effect<SettingsStart.Receipt, Starts.StartsError, R>) =>
  work.pipe(
    Effect.map((value) => SettingsStart.Reply.cases.ok.make({ value })),
    Effect.catchReasons("StartsError", {
      Decode: () => Effect.succeed(SettingsStart.Reply.cases.Decode.make({})),
      Missing: () => Effect.succeed(SettingsStart.Reply.cases.Missing.make({})),
      Refused: () => Effect.succeed(SettingsStart.Reply.cases.Refused.make({})),
      Storage: () => Effect.succeed(SettingsStart.Reply.cases.Storage.make({})),
      Unreachable: () => Effect.succeed(SettingsStart.Reply.cases.Unreachable.make({})),
    }),
  );

/**
 * Replaces a `StartsError` with its wire summary, `Start.Failure`: the reason's tag and no cause.
 * Other failures pass through unchanged.
 *
 * **When to use**
 *
 * Use when a failure leaves the Worker or an object. A cause may hold the start's input, and this
 * keeps it inside.
 *
 * @category error handling
 */
export const settingsFailure = <A, E, R>(work: Effect.Effect<A, E | Starts.StartsError, R>) =>
  work.pipe(
    Effect.catchIf(
      (error): error is Starts.StartsError => error instanceof Starts.StartsError,
      (error) =>
        Effect.fail(error).pipe(
          Effect.catchReasons("StartsError", {
            Decode: () =>
              Effect.fail(
                SettingsStart.Failure.make({ reason: SettingsStart.Failure.fields.reason.cases.Decode.make({}) }),
              ),
            Missing: () =>
              Effect.fail(
                SettingsStart.Failure.make({ reason: SettingsStart.Failure.fields.reason.cases.Missing.make({}) }),
              ),
            Refused: () =>
              Effect.fail(
                SettingsStart.Failure.make({ reason: SettingsStart.Failure.fields.reason.cases.Refused.make({}) }),
              ),
            Storage: () =>
              Effect.fail(
                SettingsStart.Failure.make({ reason: SettingsStart.Failure.fields.reason.cases.Storage.make({}) }),
              ),
            Unreachable: () =>
              Effect.fail(
                SettingsStart.Failure.make({ reason: SettingsStart.Failure.fields.reason.cases.Unreachable.make({}) }),
              ),
          }),
        ),
    ),
  );

/**
 * Wraps an object's context for its RPC methods, so a failed build crosses RPC as a fixed summary.
 *
 * **Details**
 *
 * `runPromise` gets the context, provides it to the work and runs it. When the context fails to
 * build, a `StartsError` becomes `Start.Failure`, and a `LedgerError` keeps only its `reason`.
 *
 * @category constructors
 */
export const settingsWire = <R, E>(context: Effect.Effect<Context.Context<R>, E>) => {
  const contextEffect = settingsFailure(context).pipe(
    Effect.mapError((error) => (error instanceof LedgerError ? new LedgerError({ reason: error.reason }) : error)),
  );
  return {
    contextEffect,
    runPromise: <A, E2>(work: Effect.Effect<A, E2, R>) =>
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC sends only fixed settings failure summaries
      Effect.runPromise(contextEffect.pipe(Effect.flatMap((services) => Effect.provideContext(work, services)))),
  };
};

/**
 * What the Project hands its door: the SQL handle, the founder, the write turn and the process
 * calls the door needs.
 *
 * @category models
 */
export interface ProjectDoorOptions {
  readonly sql: Sql;
  readonly founder: Parameters<typeof ClientManagerLedger.layer>[0];
  readonly turn: Semaphore.Semaphore;
  readonly write: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly policy: (process: string) => Effect.Effect<{ inputs: Array<string>; events: Array<string> }, LedgerError>;
  readonly isLive: (process: string) => Effect.Effect<boolean, LedgerError>;
  readonly audit: (process: string, message: unknown) => Effect.Effect<Schema.Json, Audit.AuditError>;
  readonly nextProcess: () => Effect.Effect<string>;
  readonly notify: (client: string, news: News) => Effect.Effect<void, LedgerError>;
  readonly deliver: (process: string, input: Incoming) => Effect.Effect<Sent, LedgerError>;
  /**
   * Whether the program behind `process` has room for this input, asked before it is saved (0147).
   * `before` counts the entries the door writes ahead of the message, so the trial measures the
   * message at the place it will land.
   */
  readonly admit: (process: string, input: Incoming, before: number) => Effect.Effect<boolean, LedgerError>;
  readonly open: (process: string, client: string) => Effect.Effect<Schema.Json, LedgerError>;
  /** Watches `pid` for one window session, `to`, in the Project's turn. */
  readonly monitor: (
    ref: string,
    pid: string,
    to: typeof Recipient.cases.client.Type,
    from: From,
  ) => Effect.Effect<void, ProcessError | LedgerError>;
  readonly wait: (stream: string, after: number, reader: string) => Effect.Effect<unknown, LedgerError>;
}

type Boot = { readonly name: string; readonly id: string; readonly program: string };
type Boots = readonly [Boot, ...ReadonlyArray<Boot>];

/**
 * What a Project object is built with: its built-in programs, the processes it boots, the door it
 * serves, and optionally its start's input, mail grants, configuration and start grants.
 *
 * @category models
 */
export interface ProjectOptions {
  readonly input?: Effect.Effect<Effect.Success<ReturnType<typeof settings>>, LedgerError>;
  readonly mail?: { readonly grants: Grants };
  readonly config?: BrainOptions;
  readonly programs: Readonly<Record<string, ProgramSource>>;
  /** What the instance boots with: a list, or a list made for the founder, so a program each person
   *  has one of, as tezgah, boots under the founder's own name. */
  readonly bootstrap: Boots | ((person: string) => Boots);
  /** Which program may start which (P42), a host right. None when absent. */
  readonly starts?: ReadonlyArray<typeof StartGrant.Type>;
  readonly door: (
    options: ProjectDoorOptions,
  ) => Effect.Effect<
    GatewayCalls,
    unknown,
    | Ledger
    | LedgerTransaction
    | Id.Generator
    | ClientManager
    | SpanSink
    | RecordManager
    | Archive
    | Tasks
    | MailWakeups
    | RecordedStart
  >;
}

/**
 * Returns the stub of the Project object of the given name.
 *
 * @category constructors
 */
export const projectStub = (env: Env, name: string) => env.PROJECT.getByName(name);

/**
 * Returns the stub of the Process object for a registered name in a project. One object holds
 * every process ID of that name, the first and each successor.
 *
 * @category constructors
 */
export const processStub = (env: Pick<Env, "PROCESS">, project: string, name: string) =>
  env.PROCESS.getByName(JSON.stringify([project, name]));

/**
 * Returns the RPC stub of the Record object for a name in a project; a `SinkError` crosses it typed.
 *
 * @category constructors
 */
export const recordStub = (env: Env, project: string, name: string) =>
  makeRpcStub<RecordShape>(env.RECORD.getByName(JSON.stringify([project, name])), { errors: [SinkError] });

// Bindings have already entered Effect before the caller adds its RPC span.
/**
 * Runs a binding call that already entered Effect, under its own `runtime.rpc` span.
 *
 * @category combinators
 */
export const rpc = Effect.fn("runtime.rpc")(function* <A, E>(work: Effect.Effect<A, E>) {
  return yield* work;
});

// Only checked refusals become RPC data. Storage and transport failures still fail the call.
const checkedReply = Effect.fnUntraced(function* <A, B>(work: Effect.Effect<A, unknown>, ok: (value: A) => B) {
  return yield* work.pipe(
    Effect.map(ok),
    Effect.catchIf(
      (error): error is SigningRefused => error instanceof SigningRefused,
      (error) => Effect.succeed(SigningReply.cases.SigningRefused.make({ reason: error.reason })),
    ),
    Effect.catchIf(
      (error): error is NotGranted => error instanceof NotGranted,
      () => Effect.succeed(SigningReply.cases.NotGranted.make({})),
    ),
  );
});

/**
 * Converts a signing call into its RPC reply: `ok` with the `Session`, or a `SigningRefused` or
 * `NotGranted` refusal as data. Any other failure still fails the call.
 *
 * @category error handling
 */
export const signingReply = Effect.fn("project.signingReply")(function* (work: Effect.Effect<Session, unknown>) {
  return yield* checkedReply(work, (value) => SigningReply.cases.ok.make({ value }));
});

/**
 * Converts a commit into its RPC reply: `ok` with the `Appended` entry, or a `SigningRefused` or
 * `NotGranted` refusal as data. Any other failure still fails the call.
 *
 * @category error handling
 */
export const commitReply = Effect.fn("project.commitReply")(function* (work: Effect.Effect<Appended, unknown>) {
  return yield* checkedReply(work, (value) => CommitReply.cases.ok.make({ value }));
});

/**
 * Converts a `ProcessManager` call into its RPC reply: `ok` with the value, or a `ProcessError`
 * refusal as data. Any other failure still fails the call.
 *
 * @category error handling
 */
export const processReply = <A, E>(work: Effect.Effect<A, E | ProcessError>): Effect.Effect<ProcessReply<A>, E> =>
  work.pipe(
    Effect.map((value): ProcessReply<A> => ({ ...ProcessReplies.cases.ok.make({ value }), value })),
    Effect.catch((error): Effect.Effect<ProcessReply<A>, E> =>
      error instanceof ProcessError
        ? Effect.succeed(ProcessReplies.cases.ProcessError.make({ reason: error.reason }))
        : Effect.fail(error),
    ),
  );

// Project initialization and calls cross RPC as rendered errors. Keep storage details inside the library.
const projectStorage = Effect.fnUntraced(function* <A, E, R>(
  work: Effect.Effect<A, E, R>,
): Effect.fn.Return<A, E | LedgerError, R> {
  const tracer = yield* Tracer.Tracer;
  const safe = Tracer.make({
    context: tracer.context,
    span(options) {
      const span = tracer.span(options);
      const attribute = span.attribute.bind(span);
      span.attribute = (key, value) => {
        attribute(key, key === "error.type" ? "LedgerError" : value);
      };
      const end = span.end.bind(span);
      span.end = (time, exit) =>
        end(time, Exit.isSuccess(exit) ? exit : Exit.fail(new LedgerError({ reason: "storage" })));
      return span;
    },
  });
  return yield* work.pipe(
    Effect.withTracer(safe),
    Effect.mapError((error) => (Schema.is(LedgerError)(error) ? new LedgerError({ reason: error.reason }) : error)),
    Effect.catchDefect(() => Effect.fail(new LedgerError({ reason: "storage" }))),
  );
});

/** Checked refusals are replies; storage and descriptor failures remain retryable rejections. */
const childReply = (work: Effect.Effect<Started, unknown>): Effect.Effect<typeof ChildReplies.Type, LedgerError> =>
  work.pipe(
    Effect.map((value) => ChildReplies.cases.ok.make({ value })),
    Effect.catch((error): Effect.Effect<typeof ChildReplies.Type, LedgerError> =>
      error instanceof ChildrenError && error.reason !== "storage"
        ? Effect.succeed(ChildReplies.cases.ChildrenError.make({ reason: error.reason }))
        : Effect.fail(new LedgerError({ reason: "storage" })),
    ),
  );

/** A stop's checked refusals are replies, as a start's are; storage remains a retryable rejection. */
const stopReply = (work: Effect.Effect<void, unknown>): Effect.Effect<typeof StopReplies.Type, LedgerError> =>
  work.pipe(
    Effect.as(StopReplies.cases.ok.make({})),
    Effect.catch((error): Effect.Effect<typeof StopReplies.Type, LedgerError> =>
      error instanceof ChildrenError && error.reason !== "storage"
        ? Effect.succeed(StopReplies.cases.ChildrenError.make({ reason: error.reason }))
        : Effect.fail(new LedgerError({ reason: "storage" })),
    ),
  );

/** A watch's checked refusals are replies, as a start's are; storage remains a retryable rejection. */
const monitorReply = (
  work: Effect.Effect<typeof Watched.Type, unknown>,
): Effect.Effect<typeof MonitorReplies.Type, LedgerError> =>
  work.pipe(
    Effect.map((value) => MonitorReplies.cases.ok.make({ value })),
    Effect.catch((error): Effect.Effect<typeof MonitorReplies.Type, LedgerError> =>
      error instanceof MonitorsError && error.reason !== "storage"
        ? Effect.succeed(MonitorReplies.cases.MonitorsError.make({ reason: error.reason }))
        : Effect.fail(new LedgerError({ reason: "storage" })),
    ),
  );

const processValue = Effect.fnUntraced(function* <A>(reply: ProcessReply<A>) {
  if (reply._tag === "ok") {
    return reply.value;
  }

  const refused = yield* Schema.decodeUnknownEffect(ProcessReplies.cases.ProcessError)(reply).pipe(
    Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
  );
  return yield* new ProcessError({ reason: refused.reason });
});

/** A trusted restart: its request ID makes a repeat one replacement. */
const RestartRequest = Schema.Struct({ id: Schema.NonEmptyString, build: Schema.NonEmptyString });

const checkedValue = Effect.fnUntraced(function* <A>(
  reply:
    | (Omit<typeof SigningReply.cases.ok.Type, "value"> & { readonly value: A })
    | typeof SigningReply.cases.SigningRefused.Type
    | typeof SigningReply.cases.NotGranted.Type,
) {
  if (reply._tag === "SigningRefused") {
    return yield* new SigningRefused({ reason: reply.reason });
  }

  if (reply._tag === "NotGranted") {
    return yield* new NotGranted({});
  }

  return reply.value;
});

/**
 * Saves a process's descriptor in its object, then runs the process's first turn before the start
 * answers.
 *
 * **Details**
 *
 * A child's first letter waits in its inbox, so `drain` also sets the object's alarm, which steps
 * that letter with no client call. A saved wake time is kept; with none, the alarm is set for now
 * and saved.
 *
 * @category constructors
 */
export const configureProcess = Effect.fn("process.configure")(function* <E>(
  ctx: DurableObjectState,
  descriptor: Descriptor,
  runtime: { readonly contextEffect: Effect.Effect<Context.Context<ProcessService>, E> },
  drain = false,
) {
  const storage = StorageClient.make(ctx.storage);
  yield* rpc(storage.put("descriptor", descriptor));
  const services = yield* runtime.contextEffect;
  yield* ProcessService.use((p) => p.init()).pipe(Effect.provideContext(services));

  // After init, which sets the alarm from the program's own wake and may clear it.
  if (drain) {
    const saved = yield* rpc(storage.get<number>("wake"));
    const at = saved ?? (yield* Clock.currentTimeMillis);

    if (saved === undefined) {
      yield* rpc(storage.put("wake", at));
    }

    yield* rpc(storage.setAlarm(at));
  }
});

/**
 * Returns the wake time a Process object saved, or `undefined` when none is saved.
 *
 * @category getters
 */
export const savedAlarm = Effect.fn("process.savedAlarm")(function* (ctx: DurableObjectState) {
  return yield* rpc(StorageClient.make(ctx.storage).get<number>("wake"));
});

/**
 * Returns a Process object's saved descriptor, for `pid` when given, with the build of the process's
 * own checkpoint when it has one.
 *
 * **Details**
 *
 * A descriptor or checkpoint that does not decode fails with a `LedgerError` of reason `bad_row`, and
 * a failed read with reason `storage`.
 *
 * @category getters
 */
export const processDescriptor = Effect.fn("process.descriptor")(function* (ctx: DurableObjectState, pid?: string) {
  const raw = yield* rpc(StorageClient.make(ctx.storage).get("descriptor"));
  const descriptor = yield* Schema.decodeUnknownEffect(SavedDescriptor)(raw).pipe(
    Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
  );
  const sql = cloudflareSql(ctx.storage);
  const saved = yield* Effect.try({
    try: () =>
      sql.exec("SELECT name FROM sqlite_master WHERE name='process_state'").length === 0
        ? undefined
        : sql.exec("SELECT checkpoint FROM process_state WHERE process=?", pid ?? descriptor.id)[0],
    catch: (cause) => new LedgerError({ reason: "storage", cause }),
  });

  if (saved === undefined) {
    return { ...descriptor, id: pid ?? descriptor.id };
  }

  const checkpoint = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Checkpoint))(saved.checkpoint).pipe(
    Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
  );
  return { ...descriptor, id: pid ?? descriptor.id, build: checkpoint.saved.build };
});

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (n) => Str.padStart(2, "0")(n.toString(16))).join("");

// R2 refuses a body whose SHA-256 differs from the one sent. The local bucket does not check,
// so the adapter checks first and both places fail the same way.
/**
 * Puts a body in the bucket after checking its SHA-256 against `sha256`, as R2 itself does; a
 * mismatch fails with a `LedgerError` of reason `bad_row`, before anything is written.
 *
 * @category combinators
 */
export const checkedPut = Effect.fnUntraced(function* (
  bucket: R2Bucket,
  key: string,
  body: Uint8Array,
  sha256: string,
) {
  const copy = new Uint8Array(body);
  const fail = (cause: unknown) => new LedgerError({ reason: "crypto", cause });
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes through a Promise
  const work = Effect.tryPromise({ try: () => crypto.subtle.digest("SHA-256", copy), catch: fail });
  const digest = yield* work;

  if (hex(digest) !== Str.toLowerCase(sha256)) {
    return yield* new LedgerError({ reason: "bad_row" });
  }

  yield* BucketClient.make(bucket).put(key, copy, sha256);
});

/**
 * Returns a bucket object's SHA-256 as hex, or `null` when the object or its checksum is absent.
 *
 * @category getters
 */
export const bucketHead = Effect.fn(function* (bucket: R2Bucket, key: string) {
  const row = yield* BucketClient.make(bucket).head(key);
  return row?.checksums.sha256 === undefined ? null : { sha256: hex(row.checksums.sha256) };
});

/**
 * Returns the bucket's `put` and `head` as the Promise calls the archive takes.
 *
 * @category constructors
 */
export const bucketCalls = (bucket: R2Bucket): BucketCalls => ({
  put: (key, body, sha256) =>
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: P37's R2 interface returns a Promise
    Effect.runPromise(checkedPut(bucket, key, body, sha256)),
  head: (key) =>
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: P37's R2 interface returns a Promise
    Effect.runPromise(bucketHead(bucket, key)),
});

const recordLayer = (env: Env, project: string) => RecordManager.remote((name) => recordStub(env, project, name));

const archiveLayer = (env: Env) => Archive.bucket(bucketCalls(env.MEASUREMENTS));
const flushed = SpanSink.use((sink) => sink.flush);

/**
 * Runs one call, then flushes the span sink before it answers.
 *
 * **Details**
 *
 * The flush is skipped when the call failed with a `RateCountFailure`, when `counted` is true of its
 * value, or when it answered a `reserved`, `rate_limited` or `quota` refusal. A failed flush fails a call that
 * succeeded; a call that failed keeps its own failure.
 *
 * @category combinators
 */
export const complete = Effect.fn(function* <A, E, R>(
  work: Effect.Effect<A, E, R>,
  counted: (value: A) => boolean = () => false,
) {
  return yield* work.pipe(
    Effect.exit,
    Effect.flatMap((exit) => {
      if (Option.exists(Exit.findErrorOption(exit), Schema.is(RateCountFailure))) {
        return exit;
      }

      // Counted refusals have nothing to send. Retrying an old archive here would add a row per refusal.
      if (
        Exit.isSuccess(exit) &&
        (counted(exit.value) ||
          (Schema.is(Answer.cases.refused)(exit.value) &&
            ["reserved", "rate_limited", "quota"].includes(exit.value.reason)))
      ) {
        return exit;
      }

      return flushed.pipe(
        Effect.flatMap(() => exit),
        Effect.catch((error) => (Exit.isFailure(exit) ? exit : Effect.fail(error))),
      );
    }),
  );
});

/**
 * Layer that provides an object's recording: the remote Record calls, the archive and the span sink
 * on its own SQL, with every span tagged with the start's settings hash and build.
 *
 * @category layers
 */
export const recordingLayer = (sql: Sql, env: Env, project: string, object: string) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const start = yield* RecordedStart;
      const services = yield* Layer.build(
        Layer.mergeAll(recordLayer(env, project), archiveLayer(env), SpanSink.layer(sql, { object })),
      );
      const tracer = yield* Tracer.Tracer.pipe(Effect.provideContext(services));
      return Context.add(
        services,
        Tracer.Tracer,
        Tracer.make({
          context: tracer.context,
          span: (options) => {
            const span = tracer.span(options);
            span.attribute("fab.settings", start.snapshot.hash);
            span.attribute("fab.build", start.input.build);
            return span;
          },
        }),
      );
    }),
  );

const fingerprint = Effect.fnUntraced(function* (value: string) {
  const ssh = Str.startsWith("ssh-")(value);
  const blob = ssh ? Base64.decode(Str.split(Str.trim(value), /\s+/)[1] ?? "") : Base64Url.decode(value);

  if (Result.isFailure(blob)) {
    return yield* new LedgerError({ reason: "bad_row", cause: blob.failure });
  }

  const bytes = blob.success.slice(-32);
  const fail = (cause: unknown) => new LedgerError({ reason: "crypto", cause });
  // SSH Ed25519 blobs end with the 32 public bytes. P10 uses this same key fingerprint.
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes through a Promise
  const work = Effect.tryPromise({ try: () => crypto.subtle.digest("SHA-256", bytes), catch: fail });
  const hash = yield* work;
  return `SHA256:${Str.replace(/=+$/, "")(Base64.encode(new Uint8Array(hash)))}`;
});

const projectLedger = (
  ctx: DurableObjectState,
  env: Env,
  name: string,
  input: Effect.Effect<CheckedSettings, LedgerError | Starts.StartsError>,
) => {
  const sql = cloudflareSql(ctx.storage);
  const turn = Semaphore.makeUnsafe(1);
  const notifications = Context.Reference<Array<Effect.Effect<void, LedgerError>> | null>(
    "@kampus/libfabrika/cloudflare/runtime.WriteNotifications",
    { defaultValue: () => null },
  );
  const write = Effect.fnUntraced(function* <A, E, R>(work: Effect.Effect<A, E, R>) {
    const pending: Array<Effect.Effect<void, LedgerError>> = [];
    return yield* work.pipe(
      Effect.provideService(notifications, pending),
      turn.withPermit,
      Effect.onExit(() =>
        Effect.forEach(pending, (send) => send.pipe(Effect.ignoreCause), {
          discard: true,
          concurrency: 1,
        }),
      ),
    );
  });
  const ring = Effect.fn("project.ring")(function* (to: string, stream: string, rev: number) {
    yield* rpc(GatewayClient.make(env.CONNECTION.getByName(to)).ring(stream, rev));
  });
  const bell = Layer.succeed(Doorbell, {
    ring: Effect.fnUntraced(function* (to, stream, rev) {
      const send = ring(to, stream, rev);
      const pending = yield* notifications;

      if (pending === null) {
        return yield* send;
      }

      const context = yield* Effect.context<never>();
      pending.push(send.pipe(Effect.provideContext(context)));
    }),
  });
  const ledgerLayer = Layer.mergeAll(
    LedgerSql.layer(sql, { reader: `project:${name}` }),
    LedgerTransactionSql.layer(sql),
    RefereeSql.layer(sql),
    LedgerStreamsSql.layer(sql),
  ).pipe(Layer.provideMerge(ProjectQuotas.project(sql, `brain:${name}`, input)), Layer.provide(bell));
  const starts = SettingsStartsLedger.fromLedger.pipe(Layer.provide(ledgerLayer));
  return { sql, turn, write, ledgerLayer, starts };
};

const projectLogic = Effect.fn("project.init")(function* (
  ctx: DurableObjectState,
  env: Env,
  options: ProjectOptions,
  local: ReturnType<typeof projectLedger>,
) {
  const checked = yield* RecordedStart;
  const config = { ...checked.input, ...checked.input.founding, port: checked.values.port };
  const { programs } = options;
  const bootstrap = Predicate.isFunction(options.bootstrap) ? options.bootstrap(config.person) : options.bootstrap;
  const name = ctx.id.name ?? config.name;
  const { sql, turn, write, ledgerLayer } = local;
  // Installs stay ordered while a Process finishes a turn that may write back to the Project.
  const installs = yield* Semaphore.make(1);
  const by = `brain:${name}`;
  const ids = yield* ProcessIdGenerator;
  const founder = {
    name,
    person: config.person,
    keys: [config.founder],
    window: config.window,
    by: yield* fingerprint(config.founder),
    build: config.build,
  };
  const base = Layer.mergeAll(ledgerLayer, recordingLayer(sql, env, name, `project:${name}`));
  const processManager = ProcessManager.layer(
    {
      by,
      owner: Owner.cases.brain.make({}),
      recipient: Recipient.cases.client.make({ client: "brain", session: yield* ids.next }),
    },
    ids.next,
  );
  const managers = Layer.mergeAll(
    TasksLedger.layer,
    ClientManagerLedger.layer(founder),
    // 0526: the relation rows the brain trusts are its own.
    RelationsLedger.layer({ by }),
    processManager,
  ).pipe(Layer.provideMerge(base));
  // The door wakes a task's requester after a finish with the same wake mail uses.
  const services = Context.add(
    Context.add(
      yield* Layer.build(managers).pipe(Effect.provideService(RecordedStart, checked)),
      RecordedStart,
      checked,
    ),
    MailWakeups,
    yield* MailWakeups.pipe(Effect.provide(wakeups(env, name))),
  );
  // A program's hands Cmd targets the person's hands key, and its request records this start's settings.
  const hands = yield* HandsTasks.pipe(
    Effect.provide(
      HandsTasksLive.layer({ target: checked.values.handsTarget, settings: checked.snapshot.hash }).pipe(
        Layer.provide(Layer.succeedContext(services)),
      ),
    ),
  );
  // `mail.unread`, read at the brain's edge with the start's other settings (0086).
  const cap = checked.values.mailUnread;
  const mail = yield* ProgramMail.pipe(
    Effect.provide(
      ProgramMailLedger.layer({ grants: options.mail?.grants ?? checked.input.mail?.grants ?? {}, cap }).pipe(
        Layer.provide(Layer.succeedContext(services)),
      ),
    ),
  );
  const ledger = Context.get(services, Ledger),
    referee = Context.get(services, Referee),
    members = Context.get(services, ClientManager),
    processes = Context.get(services, ProcessManager);
  // Each window session's own ProcessManager, so its watches deliver to that session (P18). Its
  // owner is the session's own pid, which registered no name, so an owner-gated call through it is
  // `not_parent`. Built at the session's first monitor and kept until its leave, so its folded
  // table lives as long as the session, never folded again from rev 0 for each call.
  const windows = new Map<string, { readonly session: string; readonly manager: typeof ProcessManager.Service }>();
  const windowManager = Effect.fnUntraced(function* (to: typeof Recipient.cases.client.Type) {
    const key = Formatter.formatJson([to.client, to.session]);
    const kept = windows.get(key);

    if (kept !== undefined) {
      return kept.manager;
    }

    const caller = { by, owner: Owner.cases.process.make({ process: to.session }), recipient: to };
    const manager = yield* ProcessManager.pipe(
      Effect.provide(ProcessManager.layer(caller, ids.next)),
      Effect.provideContext(services),
    );
    windows.set(key, { session: to.session, manager });
    return manager;
  });
  const windowsLeave = (session: string) => {
    for (const [key, kept] of windows) {
      if (kept.session === session) {
        windows.delete(key);
      }
    }
  };
  const codes = yield* CodeStore.pipe(Effect.provide(CodeStoreSql.layer(sql)));

  for (const source of Rec.values(programs)) {
    const built = yield* Schema.decodeUnknownEffect(BuiltProgram)(source);
    yield* codes.put(built);
  }

  // A build a home ran but never kept, mapped to this build's code that took its place at an open.
  const moved = new Map<string, string>();
  const code = (hash: string) => codes.get(moved.get(hash) ?? hash).pipe(Effect.map(Option.getOrNull));
  const loader = workerLoader(env.LOADER, programs, code);
  const from = Effect.fn(function* (parent: string | null = null) {
    return yield* fromHere({ by, for: config.person, seen: 0, parent, build: config.build }).pipe(Effect.orDie);
  });
  let selected: typeof Selected.Type = codeMachine.init(null, {})[0];
  const folded = yield* Stream.runCollect(ledger.read("gateway/code", 0));
  const decodeCode = Schema.decodeUnknownOption(CodeEvent);
  const select = (fact: (typeof CodeEvent.cases)["code.loaded"]["Type"], id: string) => {
    selected = applyCell(codeMachine, selected, { type: "loaded", id, program: fact.program, hash: fact.hash })[0];

    // An open fact is the move of a home saved before the code store: its old build, and the code
    // that took that build's place (0529).
    if (fact.from === "open" && fact.was !== null) {
      moved.set(fact.was, fact.hash);
    }
  };

  for (const entry of folded) {
    const fact = decodeCode(valueFor(entry));

    if (Option.isSome(fact) && fact.value._tag === "code.loaded") {
      select(fact.value, entry.id);
    }
  }

  // A home with no code fact at all was saved before the code store, so the builds its processes
  // recorded have no code here. Decided once, at this open: each such process moves to this build's
  // code of its program, recorded as one `code.loaded` from `open` with `was` set (0529), before
  // anything loads, so every record it writes from now on names that code (0293). In any other home every
  // load stays strict, and a lost build is a `ProgramDown` with reason `no_program`.
  if (folded.length === 0) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS dev_descriptors (process TEXT PRIMARY KEY, value TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0)",
    );

    for (const process of yield* processes.info) {
      const [row] = sql.exec("SELECT value FROM dev_descriptors WHERE process=?", process.process);
      const recorded =
        row === undefined
          ? undefined
          : (yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SavedDescriptor))(row.value).pipe(
              Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
            )).build;
      const target = Rec.has(programs, process.program) ? programs[process.program] : undefined;

      for (const was of new Set([process.build, ...(recorded === undefined ? [] : [recorded])])) {
        if (target === undefined || moved.has(was) || Option.isSome(yield* codes.get(was))) {
          continue;
        }

        const id = `code.open:${process.program}:${target.hash}:${was}`;
        const fact = CodeEvent.cases["code.loaded"].make({
          program: process.program,
          hash: target.hash,
          was,
          from: "open",
        });
        const placed = yield* ledger.append("gateway/code", id, lineFor(yield* from(), fact));

        if (placed._tag === "refused") {
          return yield* new LedgerError({ reason: "refused" });
        }

        select(fact, id);
      }
    }
  }

  // Validate the whole list before starting any entry.
  const loaded = yield* Effect.forEach(
    bootstrap,
    Effect.fnUntraced(function* (entry) {
      const program = yield* loader.load(entry.program, `project:${name}`, undefined, selected[entry.program]?.hash);
      return { entry, program };
    }),
    { concurrency: 1 },
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS dev_descriptors (process TEXT PRIMARY KEY, value TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0)",
  );

  if (!sql.exec("PRAGMA table_info(dev_descriptors)").some((column) => column.name === "pending")) {
    sql.exec("ALTER TABLE dev_descriptors ADD COLUMN pending INTEGER NOT NULL DEFAULT 0");
  }

  /** A start not yet delivered to its object: its saved descriptor, or undefined once delivered. */
  const decodePending = Effect.fnUntraced(function* (pid: string) {
    // Pending 2 is a child's: its configure also wakes it to drain its first letter.
    const [saved] = sql.exec("SELECT value, pending FROM dev_descriptors WHERE process=? AND pending>0", pid);

    if (saved === undefined) {
      return undefined;
    }

    const descriptor = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SavedDescriptor))(saved.value).pipe(
      Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
    );
    return { descriptor, drain: saved.pending === 2 };
  });
  // The object's init may call back into this Project, so the build never waits on a delivery.
  const deliver = Effect.fnUntraced(function* (
    pid: string,
    { descriptor, drain }: { readonly descriptor: typeof SavedDescriptor.Type; readonly drain: boolean },
  ) {
    yield* rpc(ProcessClient.make(processStub(env, name, descriptor.name)).configure(descriptor, drain));
    sql.exec("UPDATE dev_descriptors SET pending=0 WHERE process=?", pid);
  });
  const configure = Effect.fnUntraced(function* (pid: string) {
    const saved = yield* decodePending(pid);

    if (saved !== undefined) {
      yield* deliver(pid, saved);
    }
  });
  /** A process ID's life from history, first or successor; an unknown ID is refused. */
  const resolved = (pid: string) =>
    processes
      .resolve(pid)
      .pipe(Effect.catchTag("ProcessError", (cause) => Effect.fail(new LedgerError({ reason: "refused", cause }))));
  /** The registered name whose object stores this process ID. */
  const processObject = (pid: string) => Effect.map(resolved(pid), (life) => life.name);
  type InputPolicy = { inputs: Array<string>; events: Array<string> };
  const policies = new Map<string, InputPolicy>();
  const remember = (owner: string, declaration: Declaration): InputPolicy => {
    const policy = {
      inputs: Rec.toEntries(declaration.inputs)
        .filter(([, p]) => p.personOnly)
        .map(([name]) => name),
      events: Rec.toEntries(declaration.writes)
        .filter(([, p]) => p.personOnly)
        .map(([name]) => name),
    };
    policies.set(owner, policy);
    return policy;
  };

  // The delivered processes this build found, each with the build its object runs.
  const bootProcesses: Array<Descriptor> = [];

  for (const process of yield* processes.info) {
    if (sql.exec("SELECT process FROM dev_descriptors WHERE process=?", process.process).length === 0) {
      const life = yield* Context.get(services, LedgerTransaction).transact((turn) =>
        processes.table(turn).life(process.process),
      );
      const requester =
        Option.isSome(life) && life.value.request._tag === "first" ? life.value.request.requester : undefined;
      // A child's start may have committed before its descriptor. Its object has never been
      // configured, so rebuild from the saved life and its requester's recorded owner.
      const descriptor = yield* requester?._tag === "process"
        ? Effect.gen(function* () {
            const [saved] = sql.exec("SELECT value FROM dev_descriptors WHERE process=?", requester.process);
            const { owner } = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SavedDescriptor))(
              saved?.value,
            ).pipe(Effect.mapError(() => new LedgerError({ reason: "bad_row" })));
            return {
              id: process.process,
              name: process.name,
              program: process.program,
              build: process.build,
              owner,
            };
          })
        : rpc(ProcessClient.make(processStub(env, name, process.name)).descriptor(process.process));
      // Its pending row is delivered after the build, with the other starts.
      sql.exec(
        "INSERT INTO dev_descriptors (process,value,pending) VALUES (?,?,?)",
        process.process,
        Formatter.formatJson({ ...descriptor, id: process.process, build: process.build }),
        requester?._tag === "process" ? 2 : 0,
      );
    }

    // A start not yet delivered has no descriptor in its object: its saved row is what it will get.
    // It also cannot take a swap yet, so its delivery below brings it to the selected code.
    const undelivered = yield* decodePending(process.process);
    const recorded =
      undelivered?.descriptor ??
      (yield* rpc(ProcessClient.make(processStub(env, name, process.name)).descriptor(process.process)));
    // A process moved at an open runs the code that took its build's place.
    const descriptor = { ...recorded, build: moved.get(recorded.build) ?? recorded.build };

    if (undelivered === undefined) {
      bootProcesses.push(descriptor);
    }

    const tail = yield* bindTail(ctx, { project: name, name: process.name, process: process.process }).pipe(
      Effect.mapError((cause) => new ProgramDown({ reason: "load", error: "ProgramDown", cause })),
    );
    const program = yield* loader.load(process.program, process.process, tail, descriptor.build);
    remember(process.name, program.declaration);

    sql.exec(
      "INSERT INTO dev_descriptors (process,value) VALUES (?,?) ON CONFLICT(process) DO UPDATE SET value=excluded.value",
      process.process,
      Formatter.formatJson(descriptor),
    );
  }

  // Routing follows history: an earlier ID of a name takes its name's policy.
  const policy = Effect.fnUntraced(function* (pid: string) {
    const life = yield* resolved(pid);
    const known = policies.get(life.name);

    if (known !== undefined) {
      return known;
    }

    const descriptor = yield* rpc(ProcessClient.make(processStub(env, name, life.name)).descriptor(life.state.process));
    const tail = yield* bindTail(ctx, { project: name, name: life.name, process: life.state.process }).pipe(
      Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
    );
    const program = yield* loader
      .load(life.state.code.program, life.state.process, tail, descriptor.build)
      .pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
    return remember(life.name, program.declaration);
  });
  const clients = Publish.make(sql, (connection, client, news) =>
    rpc(GatewayClient.make(env.CONNECTION.getByName(connection)).notify(client, news)),
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS dev_clients (client TEXT PRIMARY KEY, connection TEXT NOT NULL, session TEXT NOT NULL)",
  );
  const door = yield* options
    .door({
      sql,
      founder,
      turn,
      write,
      policy,
      isLive: processes.isLive,
      audit: Effect.fn("project.audit")(function* (pid: string, message: unknown) {
        // Like processLogic, load the build this target runs; its start record may name an older build.
        const program = yield* Effect.gen(function* () {
          const life = yield* resolved(pid);
          const tail = yield* bindTail(ctx, { project: name, name: life.name, process: life.state.process });
          // A swap moves the saved descriptor's build, so a message is checked by the code that will step it.
          const [saved] = sql.exec("SELECT value FROM dev_descriptors WHERE process=?", life.state.process);
          const running =
            saved === undefined
              ? undefined
              : (yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SavedDescriptor))(saved.value)).build;
          return yield* loader.load(life.state.code.program, life.state.process, tail, running);
        }).pipe(
          Effect.mapError(
            (cause) => new Audit.AuditError({ reason: new Audit.Transport({ cause: Redacted.make(cause) }) }),
          ),
        );
        return yield* program.execution.audit(message);
      }),
      nextProcess: () => ids.next,
      notify: clients.notify,
      admit: (pid, incoming, before) =>
        ProjectQuotas.admitsInput(Context.get(services, Quotas), processes, pid, incoming, config.build, before),
      deliver: (pid, incoming) =>
        processObject(pid).pipe(
          Effect.flatMap((owner) => rpc(ProcessClient.make(processStub(env, name, owner)).msg(incoming))),
        ),
      open: (pid, client) =>
        processObject(pid).pipe(
          Effect.flatMap((owner) => rpc(ProcessClient.make(processStub(env, name, owner)).open(client))),
          Effect.flatMap((value) =>
            Schema.decodeUnknownEffect(Schema.Json)(value).pipe(
              Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
            ),
          ),
        ),
      // The turn holds the call, and its rings go after it, so a noproc DOWN wakes a parked wait.
      monitor: (ref, pid, to, from) =>
        write(windowManager(to).pipe(Effect.flatMap((manager) => manager.monitor(ref, pid, from)))),
      wait: referee.wait,
    })
    .pipe(Effect.provideContext(services));
  // P42 and 0170: a child start decides in the turns of the manager that writes it, checked against
  // the member the door says sent its cause. Only `child` below uses it, after the door exists.
  const children = yield* Children.pipe(
    Effect.provide(
      ChildrenLedger.layer({
        grants: options.starts ?? checked.input.starts ?? [],
        fabrika: Model.ref("fabrika", name),
      }).pipe(
        Layer.provide(
          Layer.succeed(
            Senders,
            SessionSenders.make((parent, process) => door.sender(process, parent)),
          ),
        ),
        Layer.provide(Layer.succeedContext(services)),
      ),
    ),
  );
  // A program's watch decides in the same manager's turns, checked against the same member (0170,
  // 0531), and writes as the watcher through the trusted argument only this side holds.
  const monitors = yield* Monitors.pipe(
    Effect.provide(
      MonitorsLedger.layer({ fabrika: Model.ref("fabrika", name) }).pipe(
        Layer.provide(
          Layer.succeed(
            Senders,
            SessionSenders.make((parent, process) => door.sender(process, parent)),
          ),
        ),
        Layer.provide(Layer.succeedContext(services)),
      ),
    ),
  );
  const gateways = yield* Connections.pipe(
    Effect.provide(
      Connections.layer(sql, {
        probe: (gateway, session) => rpc(GatewayClient.make(env.CONNECTION.getByName(gateway)).probe(session)),
        admitted: (key) =>
          members.members.pipe(
            Effect.flatMap((m) =>
              Effect.forEach(
                [...m.keys.keys()],
                (raw) =>
                  Effect.gen(function* () {
                    if ("reason" in admitted(m, raw)) {
                      return false;
                    }

                    return raw === key || (yield* fingerprint(raw)) === key;
                  }),
                { concurrency: 1 },
              ),
            ),
            Effect.map((values) => values.some(Boolean)),
          ),
      }),
    ),
    Effect.provideContext(services),
  );
  sql.exec("CREATE TABLE IF NOT EXISTS dev_starts (id TEXT PRIMARY KEY, request TEXT NOT NULL, hash TEXT NOT NULL)");
  // The founding person owns this fabrika (0290). Every boot writes the same row under one id, so
  // the referee keeps it once, and a ledger founded before the row existed gets it at its next boot.
  yield* write(
    Context.get(services, Relations).write(
      [
        {
          id: "owner",
          row: Relation.Row.cases.related.make({
            subject: `person:${config.person}`,
            relation: "owner",
            object: Model.ref("fabrika", name),
          }),
        },
      ],
      yield* from(),
    ),
  ).pipe(Effect.mapError((cause) => new LedgerError({ reason: "refused", message: "the owner row", cause })));
  /** Places the process and records its descriptor; a first start's row stays pending until delivered. */
  const place = Effect.fnUntraced(function* (raw: Start, origin: From) {
    const request = yield* Schema.decodeUnknownEffect(Start)(raw).pipe(
      Effect.mapError((cause) => new ProcessError({ reason: "bad_text", cause })),
    );

    if (!Rec.has(programs, request.code.program)) {
      return yield* new LedgerError({ reason: "refused" });
    }

    return yield* write(
      Effect.gen(function* () {
        let chosen = request;
        const row =
          request._tag === "first"
            ? sql.exec("SELECT request, hash FROM dev_starts WHERE id=?", request.id)[0]
            : undefined;

        if (request._tag === "first") {
          if (row !== undefined) {
            const prior = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Start))(row.request).pipe(
              Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
            );

            if (!Equal.equals(prior, request)) {
              return yield* new ProcessError({ reason: "id_reused" });
            }
          }

          chosen = Start.cases.first.make({
            ...request,
            code: {
              ...request.code,
              hash: row === undefined ? (selected[request.code.program]?.hash ?? request.code.hash) : String(row.hash),
            },
          });
        }

        const program = yield* loader.load(
          chosen.code.program,
          `project:${name}/${chosen.name}`,
          undefined,
          chosen.code.hash,
        );

        // Keep the choice before the start can commit and lose its answer.
        if (request._tag === "first" && row === undefined) {
          sql.exec(
            "INSERT OR IGNORE INTO dev_starts (id,request,hash) VALUES (?,?,?)",
            request.id,
            Formatter.formatJson(request),
            chosen.code.hash,
          );
        }

        const result = yield* processes.start(chosen, origin).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              if (request._tag === "first" && row === undefined && error instanceof ProcessError) {
                sql.exec("DELETE FROM dev_starts WHERE id=?", request.id);
              }
            }),
          ),
        );

        // A retry must not put its original policy back over a process that has since swapped.
        if (sql.exec("SELECT process FROM dev_descriptors WHERE process=?", result.process).length === 0) {
          remember(request.name, program.declaration);
        }

        const descriptor = {
          id: result.process,
          name: request.name,
          program: request.code.program,
          build: chosen.code.hash,
          owner: Writer.cases.person.make({ key: founder.by, for: config.person }),
        };
        // Only a first start configures its name's object. A successor shares that object, which
        // may be the caller awaiting this start, so it is recorded here and never called back.
        sql.exec(
          "INSERT OR IGNORE INTO dev_descriptors (process,value,pending) VALUES (?,?,?)",
          result.process,
          Formatter.formatJson(descriptor),
          request._tag === "first" ? 1 : 0,
        );
        return result;
      }),
    );
  });
  const start = Effect.fnUntraced(function* (request: Start, origin: From) {
    const result = yield* place(request, origin);

    if (request._tag === "first") {
      yield* configure(result.process);
    }

    return result;
  });
  const running = Effect.fnUntraced(function* (pid: string, program: string, hash: string) {
    const [row] = sql.exec("SELECT value FROM dev_descriptors WHERE process=?", pid);

    if (row === undefined || !(yield* processes.isLive(pid))) {
      return;
    }

    const descriptor = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SavedDescriptor))(row.value).pipe(
      Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
    );

    if (descriptor.program !== program) {
      return yield* new LedgerError({ reason: "refused" });
    }

    const current = yield* loader.load(program, "check", undefined, hash);
    remember(descriptor.name, current.declaration);
    sql.exec(
      "UPDATE dev_descriptors SET value=? WHERE process=?",
      Formatter.formatJson({ ...descriptor, build: hash }),
      pid,
    );
  });
  // A swap publishes its running build before releasing the Process permit. Its durable fact
  // also repairs a lost reply; re-reading the newest fact cannot undo a later swap on a retry.
  const append = Effect.fnUntraced(function* (stream: string, id: string, input: unknown) {
    const answer = yield* referee.append(stream, id, input);
    const line = Schema.decodeUnknownOption(Line)(input);

    if (answer._tag === "refused" || Option.isNone(line) || line.value._tag !== "code.swapped") {
      return answer;
    }

    const latest = yield* ledger.read(stream, answer.rev - 1).pipe(
      Stream.filter((entry) => entry._tag === "code.swapped"),
      Stream.runLast,
    );

    if (Option.isSome(latest)) {
      const fact = yield* Schema.decodeUnknownEffect(RuntimeRecord.cases["code.swapped"])(valueFor(latest.value)).pipe(
        Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
      );
      yield* running(stream, fact.program, fact.hash);
    }

    return answer;
  });
  /** A child start (P42): one write turn starts it and saves its descriptor, then its name's object is
   *  configured. A retry of a saved start configures only what is still pending. */
  const child = Effect.fnUntraced(function* (input: Child, origin: From) {
    const answer = yield* write(
      Effect.gen(function* () {
        const answer = yield* children.start(input, origin);

        if (answer._tag === "started") {
          // The child acts for the person its requester acts for, as the boot's child does.
          const [requester] = sql.exec("SELECT value FROM dev_descriptors WHERE process=?", input.requester.process);
          const { owner } = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ owner: Writer })))(
            requester?.value,
          ).pipe(Effect.mapError(() => new LedgerError({ reason: "bad_row" })));
          const descriptor = {
            id: answer.process,
            name: answer.name,
            program: input.code.program,
            build: input.code.hash,
            owner,
          };
          sql.exec(
            "INSERT OR IGNORE INTO dev_descriptors (process,value,pending) VALUES (?,?,2)",
            answer.process,
            Formatter.formatJson(descriptor),
          );
        }

        return answer;
      }),
    );

    if (answer._tag === "started") {
      yield* configure(answer.process);
    }

    return answer;
  });
  /** Wakes each process that watches `pid`, after the turn that ended it: the exit wrote a `DOWN`
   *  into each watcher's inbox, and a name's object reads its inbox only once woken, as for mail. A
   *  watch stays live after its `DOWN`, so a repeated exit wakes again, and a wake that failed fails
   *  the exit, which may be asked again. A watcher that ended holds no watch, and a window needs no
   *  wake: the append itself rings its parked wait. */
  const wakeWatchers = Effect.fnUntraced(function* (pid: string) {
    const names = yield* Context.get(services, LedgerTransaction).transact((turn) => {
      const table = processes.table(turn);
      return table
        .inbound(pid)
        .flatMap(({ to }) => (to._tag === "process" ? Option.toArray(table.life(to.process)) : []))
        .map((life) => life.name);
    });
    const wakeups = Context.get(services, MailWakeups);
    yield* Effect.forEach(new Set(names), (name) => wakeups.wake(name), { concurrency: 1, discard: true }).pipe(
      Effect.mapError((cause) => new LedgerError({ reason: "unreachable", cause })),
    );
  });
  // Project RPC input is untrusted: the reason is decoded before the turn or the retirement.
  const exit = Effect.fnUntraced(function* (pid: string, input: ExitReason, origin: From) {
    const reason = yield* Effect.fromResult(decodeExitReason(input)).pipe(
      Effect.mapError((cause) => new ProcessError({ reason: "bad_text", cause })),
    );
    yield* Effect.gen(function* () {
      yield* processes.exit(pid, reason, origin);
      yield* door.retire(pid);
    }).pipe(write);
    yield* wakeWatchers(pid);
  });
  /** A child stop, OTP's terminate_child: one write turn ends the requester's own child with
   *  `shutdown`, and its session can no longer sign, as an exit's cannot. */
  const stopChild = Effect.fnUntraced(function* (input: ChildStop, origin: From) {
    const child = yield* Effect.gen(function* () {
      const child = (yield* processes.info).find((row) => row.name === input.name);
      yield* children.stop(input, origin);

      if (child !== undefined) {
        yield* door.retire(child.process);
      }

      return child;
    }).pipe(write);

    if (child !== undefined) {
      yield* wakeWatchers(child.process);
    }
  });
  const failed = Effect.fn("code.failed")(function* (raw: unknown, id?: string) {
    const fields = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        program: Install.fields.program,
        hash: CodeEvent.cases["code.failed"].fields.hash,
        reason: CodeEvent.cases["code.failed"].fields.reason,
        path: Schema.optionalKey(Schema.String),
        line: Schema.optionalKey(Schema.Int),
      }),
    )(raw).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
    const fact = CodeEvent.cases["code.failed"].make(fields);
    // Only repo-relative paths cross the control boundary into permanent facts.
    const { path, line, ...body } = fact;
    const safe =
      path !== undefined &&
      !Str.startsWith("/")(path) &&
      !Str.includes("..")(path) &&
      !Str.includes("\\")(path) &&
      !/^[A-Za-z]:/.test(path);
    yield* ledger.append(
      "gateway/code",
      id ?? `code.failed:${yield* ids.next}`,
      lineFor(yield* from(), { ...body, ...(safe ? { path, ...(line === undefined ? {} : { line }) } : {}) }),
    );
  });
  const push = Effect.fn("code.swap")(function* (load: string, program: string, hash: string, only?: string) {
    const answers: Array<{ name: string; outcome: Swapped }> = [];

    for (const process of yield* processes.info) {
      if (process.program !== program || (only !== undefined && process.name !== only)) {
        continue;
      }

      const outcome = yield* rpc(
        ProcessClient.make(processStub(env, name, process.name)).swap({ load, program, hash }),
      ).pipe(
        Effect.retry({ times: 2, while: (error) => error instanceof LedgerError && error.reason === "unreachable" }),
      );

      if (outcome._tag === "swapped" || outcome._tag === "same") {
        yield* write(
          Effect.gen(function* () {
            if (selected[program]?.hash === hash) {
              yield* running(process.process, program, hash);
            }
          }),
        );
      }

      answers.push({ name: process.name, outcome });
    }

    return answers;
  });
  /** A candidate that passed its checks: the Code machine's `checked`, with its Cmds run here. */
  const accept = Effect.fn("code.checked")(function* (input: typeof Install.Type) {
    const [, cmds] = applyCell<
      typeof selected,
      Parameters<typeof codeMachine.update.checked>[1],
      ReturnType<typeof codeMachine.update.checked>[1][number]
    >(codeMachine, selected, { type: "checked", ...input });
    const swaps: Array<{ load: string; program: string; hash: string }> = [];

    for (const cmd of cmds) {
      if (cmd.type === "append") {
        const placed = yield* ledger.append("gateway/code", cmd.id, lineFor(yield* from(), cmd.event));

        if (placed._tag === "refused") {
          return yield* new LedgerError({ reason: "refused" });
        }

        const entry = yield* ledger.read("gateway/code", 0).pipe(
          Stream.filter((entry) => entry.id === cmd.id),
          Stream.runHead,
        );

        if (Option.isNone(entry)) {
          return yield* new LedgerError({ reason: "bad_row" });
        }

        const fact = yield* Schema.decodeUnknownEffect(CodeEvent.cases["code.loaded"])(valueFor(entry.value)).pipe(
          Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
        );
        const [next, commands] = applyCell<
          typeof selected,
          Parameters<typeof codeMachine.update.loaded>[1],
          ReturnType<typeof codeMachine.update.loaded>[1][number]
        >(codeMachine, selected, {
          type: "loaded",
          id: cmd.id,
          program: fact.program,
          hash: fact.hash,
        });
        selected = next;

        for (const swap of commands) {
          if (swap.type === "swap") {
            swaps.push(swap);
          }
        }
      }
    }

    return swaps;
  });
  const inspect = Effect.fn("code.inspect")(function* (input: typeof Install.Type) {
    const built = yield* Schema.decodeUnknownEffect(BuiltProgram)(input).pipe(
      Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
    );
    const prior = yield* ledger.read("gateway/code", 0).pipe(
      Stream.filter((entry) => entry.id === input.id),
      Stream.runHead,
    );

    if (Option.isSome(prior) || selected[input.program]?.hash === input.hash) {
      return Installed.cases.same.make({});
    }

    const refuse = (reason: (typeof CodeEvent.cases)["code.failed"]["Type"]["reason"]) =>
      failed(
        CodeEvent.cases["code.failed"].make({ program: input.program, hash: input.hash, reason }),
        `code.failed:${input.id}`,
      ).pipe(Effect.as(Installed.cases.failed.make({ reason })));

    if (new TextEncoder().encode(input.source).byteLength > 2 * 1024 * 1024) {
      return yield* refuse("too_large");
    }

    yield* codes.put(built);
    const candidate = yield* Effect.result(loader.load(input.program, "check", undefined, input.hash));

    if (Result.isFailure(candidate)) {
      return yield* refuse("load");
    }

    if (candidate.success.declaration.name !== input.program) {
      return yield* refuse("name");
    }

    return null;
  });
  const install = Effect.fn("code.install")(
    function* (raw: unknown) {
      const input = yield* Schema.decodeUnknownEffect(Install)(raw).pipe(
        Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
      );
      yield* Effect.annotateCurrentSpan({
        program: input.program,
        bytes: new TextEncoder().encode(input.source).byteLength,
      });
      const prepared = yield* write(
        Effect.gen(function* () {
          const answer = yield* inspect(input);
          return answer ?? (yield* accept(input));
        }),
      );

      if (!Array.isArray(prepared)) {
        return prepared;
      }

      const processes: Array<{ name: string; outcome: Swapped }> = [];

      for (const swap of prepared) {
        processes.push(...(yield* push(swap.load, swap.program, swap.hash)));
      }

      return Installed.cases.loaded.make({ processes });
    },
    installs.withPermit,
    Effect.tap((answer) => Effect.annotateCurrentSpan("outcome", answer._tag)),
  );

  for (const [program, built] of Rec.toEntries(programs)) {
    if (selected[program] === undefined) {
      yield* accept({ id: `code.boot:${program}:${built.hash}`, program, ...built, from: "boot" });
    }
  }

  const Bootstrap = Schema.Struct({ process: Schema.String });
  const boots = yield* Effect.forEach(
    loaded,
    Effect.fnUntraced(function* ({ entry, program }) {
      const original = yield* ledger.read(`processes/${entry.name}`, 0).pipe(
        Stream.filter((fact) => fact.id === entry.id),
        Stream.runHead,
        Effect.map(Option.getOrUndefined),
      );
      return original !== undefined
        ? {
            process: (yield* Schema.decodeUnknownEffect(Bootstrap)(original.body).pipe(
              Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
            )).process,
            rev: original.rev,
          }
        : yield* place(
            Start.cases.first.make({
              id: entry.id,
              name: entry.name,
              code: { program: entry.program, hash: program.hash },
            }),
            yield* from(),
          );
    }),
    { concurrency: 1 },
  );
  const boot = boots[0];

  if (boot === undefined) {
    return yield* new LedgerError({ reason: "bad_row" });
  }

  /** Brings one process to the selected code when it runs another. A failure is logged with its
   *  process, never dropped: that process keeps its old code until the next install or load. */
  const catchUp = Effect.fnUntraced(function* (process: Pick<Descriptor, "id" | "name" | "program" | "build">) {
    const chosen = selected[process.program];

    if (chosen !== undefined && process.build !== chosen.hash) {
      yield* push(chosen.load, process.program, chosen.hash, process.name).pipe(
        Effect.catch((error) => Effect.logWarning(`swap of ${process.id} not done: ${error._tag}`)),
      );
    }
  });
  // A malformed pending row still fails the build; only the deliveries run after it, as handle_continue.
  const pending = yield* Effect.forEach(
    sql.exec("SELECT process FROM dev_descriptors WHERE pending>0"),
    (row) => Effect.map(decodePending(String(row.process)), (saved) => [String(row.process), saved] as const),
    { concurrency: 1 },
  );
  yield* Effect.forkScoped(
    Effect.forEach(
      pending,
      ([pid, saved]) =>
        saved === undefined
          ? Effect.void
          : deliver(pid, saved).pipe(
              // A swap waits for the delivery: an object with no descriptor cannot take one. The
              // start keeps the code it chose, and a save since then reaches it here, as a swap.
              Effect.andThen(installs.withPermit(catchUp(saved.descriptor))),
              // The row stays pending, so the next load sends it again; the failure is still seen.
              Effect.catch((error) => Effect.logWarning(`start of ${pid} not delivered: ${error._tag}`)),
              Effect.onInterrupt(() => Effect.logWarning(`start of ${pid} not delivered: interrupted`)),
            ),
      { concurrency: 1, discard: true },
    ),
  );
  // The call's spans land in one commit before the call answers (0122); `complete` then flushes them.
  const batched = <A, E, R>(effect: Effect.Effect<A, E, R>) => SpanSink.use((sink) => sink.batch(effect));
  const wrapped = <A, E>(effect: Effect.Effect<A, E>) =>
    complete(batched(effect)).pipe(projectStorage, Effect.provideContext(services));
  const own = Effect.fn("project.own")(function* (pid: string, id: string, stream: string, event: unknown) {
    if (!(yield* processes.isLive(pid))) {
      return yield* new LedgerError({ reason: "refused" });
    }

    if (Str.startsWith("gateway/")(stream) || Str.startsWith("processes")(stream)) {
      return yield* new LedgerError({ reason: "refused" });
    }

    const body = yield* Schema.decodeUnknownEffect(Event)(event).pipe(
      Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
    );
    const [saved] = sql.exec("SELECT value FROM dev_descriptors WHERE process=?", pid);

    if (saved === undefined) {
      return yield* new LedgerError({ reason: "bad_row" });
    }

    const descriptor = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.Struct({ owner: Writer, build: Schema.String })),
    )(saved.value).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
    const origin = yield* fromHere({
      by: descriptor.owner.key,
      for: descriptor.owner.for,
      seen: 0,
      parent: null,
      build: descriptor.build,
    });
    return yield* ledger.append(stream, id, lineFor(origin, body));
  });
  const brain = Effect.fn("project.brain")(function* (event: typeof BrainEvent.Type) {
    return yield* ledger.append("gateway/brain", event.id, lineFor(yield* from(), event));
  });

  // Boot pushes share install order without holding the Project turn during Process callbacks.
  yield* Effect.forkScoped(
    installs.withPermit(
      Effect.gen(function* () {
        const pushes: Array<Fiber.Fiber<void>> = [];

        for (const process of bootProcesses) {
          pushes.push(yield* Effect.forkChild(catchUp(process), { startImmediately: true }));
        }

        yield* Fiber.joinAll(pushes);
      }),
    ),
    { startImmediately: true },
  );

  yield* flushed.pipe(Effect.provideContext(services));
  return {
    code,
    codeInstall: (raw: unknown) => wrapped(install(raw)),
    codeFailed: (raw: unknown) => wrapped(write(failed(raw))),
    mail: (delivery: Delivery, trace?: { traceId: string; spanId: string }) => {
      const work: Effect.Effect<MailReply, ProgramMailError> = write(mail.deliver(delivery)).pipe(
        Effect.map((receipt): MailReply => MailReplies.cases.ok.make({ receipt })),
        Effect.catchTag("ProgramMailError", (error): Effect.Effect<MailReply, ProgramMailError> => {
          const reason = error.reason;

          if (reason._tag === "storage") {
            return Effect.fail(error);
          }

          return Effect.succeed(
            reason._tag === "full"
              ? MailReplies.cases.full.make({ unread: reason.unread, cap })
              : MailReplies.cases.refused.make({ reason: reason._tag }),
          );
        }),
      );
      return wrapped(trace === undefined ? work : work.pipe(Effect.withParentSpan(Tracer.externalSpan(trace))));
    },
    hands: (ask: typeof Ask.Type, origin: From, trace?: { traceId: string; spanId: string }) => {
      // Under the shared write turn, as every task call is: a read and its request or collect are one step.
      // The request, its pointer and the collect are the asking program's own writes, charged to it.
      const work = write(ProjectQuotas.own(ask.process, hands.ask(ask, origin)));
      return wrapped(trace === undefined ? work : work.pipe(Effect.withParentSpan(Tracer.externalSpan(trace))));
    },
    target: door.target,
    register: (client: string, gateway: string, session: string) =>
      Effect.sync(() => {
        sql.exec(
          "INSERT INTO dev_clients VALUES (?,?,?) ON CONFLICT(client) DO UPDATE SET connection=excluded.connection,session=excluded.session",
          client,
          gateway,
          session,
        );
      }),
    // Project RPC input is untrusted: a Process object on another build may send another shape.
    publish: (client: string, update: Published) =>
      Schema.decodeUnknownEffect(Published)(update).pipe(
        Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
        Effect.flatMap((checked) => clients.publish(client, checked)),
      ),
    connect: () => wrapped(door.connect()),
    challenge: (client: ConnectionId) => wrapped(door.challenge(client)),
    initialize: (
      client: ConnectionId,
      input: Schema.Json | undefined,
      trusted: { url: string; tab: string; name: string; session?: string },
    ) => wrapped(door.initialize(client, input, trusted)),
    route: (client: ConnectionId, method: string, params: Schema.Json | undefined, reader?: string) =>
      wrapped(
        door.route(client, method, params, reader).pipe(
          // Invalid target messages answer as checked refusals so the connection stays open.
          Effect.catch((error) =>
            Schema.is(Audit.AuditError)(error) && error.reason._tag === "Input"
              ? Effect.succeed(Answer.cases.ok.make({ result: Sent.cases.refused.make({ reason: "bad_msg" }) }))
              : Effect.fail(error),
          ),
        ),
      ),
    knock: (client: ConnectionId, input: { label: string }) => wrapped(door.knock(client, input)),
    grant: (input: unknown) => wrapped(door.grant(input)),
    disconnect: (client: ConnectionId) => wrapped(door.disconnect(client)),
    join: Effect.fnUntraced(function* (row: Parameters<typeof gateways.join>[0]) {
      sql.exec(
        "INSERT INTO dev_clients VALUES (?,?,?) ON CONFLICT(client) DO UPDATE SET connection=excluded.connection,session=excluded.session",
        row.client,
        row.gateway,
        row.session,
      );
      yield* wrapped(gateways.join(row));
    }),
    // Traced: a socket's close brings no caller's span, and `from` reads its trace from the current
    // one, so an untraced leave died there before it ended the session's watches.
    leave: Effect.fn("project.leave")(function* (client: string, session: string) {
      sql.exec("DELETE FROM dev_clients WHERE client=? AND session=?", client, session);
      yield* wrapped(gateways.leave(client, session));
      // A closed socket's session is a watcher that ended: its watches end with it, as in OTP.
      yield* wrapped(write(processes.leave(session, yield* from())));
      windowsLeave(session);
    }),
    online: (key: string) => wrapped(gateways.online(key)),
    info: wrapped(processes.info),
    start: (request: Start, origin: From) => wrapped(start(request, origin)),
    exit: (pid: string, reason: ExitReason, origin: From) => wrapped(exit(pid, reason, origin)),
    read: (stream: string, after: number, reader: string) => wrapped(referee.read(stream, after, reader)),
    wait: referee.wait,
    append: (stream: string, id: string, input: unknown) =>
      wrapped(write(ProjectQuotas.runtimeAppend(stream, processes.resolve(stream), append(stream, id, input)))),
    sign: (pid: string, id: string, parent: string, kind: string) => wrapped(door.sign(pid, id, parent, kind)),
    commit: (pid: string, input: Omit<Parameters<typeof door.append>[0], "process">) =>
      wrapped(ProjectQuotas.ownWrite(pid, door.append({ ...input, process: pid }))),
    inbox: (pid: string, input: Incoming) =>
      wrapped(
        Effect.gen(function* () {
          if (!(yield* processes.isLive(pid))) {
            return yield* new LedgerError({ reason: "refused" });
          }

          yield* door.checkDelivery(pid, input);
          const row = (yield* processes.info).find((r) => r.process === pid);

          if (row === undefined) {
            return yield* new LedgerError({ reason: "refused" });
          }

          return yield* ledger.append(
            `${row.name}/inbox`,
            input.id,
            yield* ProjectQuotas.inboxLine(input, config.build),
          );
        }).pipe(write),
      ),
    own: (pid: string, id: string, stream: string, event: unknown, trace?: { traceId: string; spanId: string }) => {
      const work = ProjectQuotas.ownWrite(pid, own(pid, id, stream, event));
      return wrapped(write(trace === undefined ? work : work.pipe(Effect.withParentSpan(Tracer.externalSpan(trace)))));
    },
    brain: (event: typeof BrainEvent.Type) => wrapped(brain(event)),
    // ProcessManager over trusted Project RPC: refusals are reply data, mutations take the turn.
    processObject: (pid: string) => wrapped(processObject(pid)),
    processStart: (request: Start, origin: From) => wrapped(processReply(start(request, origin))),
    processExit: (pid: string, reason: ExitReason, origin: From) => wrapped(processReply(exit(pid, reason, origin))),
    processStatus: (owner: string) => wrapped(processReply(processes.status(owner))),
    processResolve: (pid: string) => wrapped(processReply(processes.resolve(pid))),
    processDead: (pid: string, dead: Parameters<typeof processes.dead>[1], origin: From) =>
      wrapped(processReply(write(processes.dead(pid, dead, origin)))),
    processIsLive: (pid: string) => wrapped(processes.isLive(pid)),
    // The brain binds the reader's name from its live process, never from the call.
    processAck: (pid: string, pos: number, origin: From) =>
      wrapped(processReply(write(processes.ack(pid, pos, origin)))),
    processMonitor: (ref: string, pid: string, origin: From) =>
      wrapped(processReply(write(processes.monitor(ref, pid, origin)))),
    processDemonitor: (ref: string, origin: From) => wrapped(processReply(write(processes.demonitor(ref, origin)))),
    processDown: (pid: string, policy: Parameters<typeof processes.down>[1], origin: From) =>
      wrapped(processReply(write(processes.down(pid, policy, origin)))),
    processReceive: (pid: string, after: number) =>
      wrapped(processReply(Stream.runCollect(processes.receive(pid, after)))),
    processChild: (input: Child, origin: From) => wrapped(childReply(child(input, origin))),
    processStop: (input: ChildStop, origin: From) => wrapped(stopReply(stopChild(input, origin))),
    // A program's watch, as the Process object's runner asks it: the turn holds the call, and its
    // rings go after it, so a noproc DOWN wakes a parked wait.
    programMonitor: (watch: Watch, origin: From) => wrapped(monitorReply(write(monitors.monitor(watch, origin)))),
    programDemonitor: (unwatch: Unwatch, origin: From) =>
      wrapped(
        write(monitors.demonitor(unwatch, origin)).pipe(Effect.mapError(() => new LedgerError({ reason: "storage" }))),
      ),
    boot,
  };
}, projectStorage);

/** What a call fails with once its spans are flushed and its storage errors are rendered. */
type ProjectFailure = LedgerError | SinkError;

/**
 * Service for the Project object's calls: the ledger, the door, code install, processes, mail and its
 * boot.
 *
 * @category services
 */
export class ProjectService extends Context.Service<
  ProjectService,
  {
    // Code install (P15): the store's built programs, a saved program's install and a failed build.
    readonly code: (hash: string) => Effect.Effect<BuiltProgram | null, CodeStoreError>;
    readonly codeInstall: (raw: unknown) => Effect.Effect<Installed, CodeStoreError | ProgramDown | ProjectFailure>;
    readonly codeFailed: (raw: unknown) => Effect.Effect<void, ProjectFailure>;
    readonly mail: (
      delivery: Delivery,
      trace?: { traceId: string; spanId: string },
    ) => Effect.Effect<MailReply, ProgramMailError | ProjectFailure>;
    /** One hands Cmd's ask, in the Project's write turn. A failure answers nothing: the Cmd stays dispatched. */
    readonly hands: (
      ask: typeof Ask.Type,
      origin: From,
      trace?: { traceId: string; spanId: string },
    ) => Effect.Effect<typeof HandsReply.Type, HandsTasksError | ProjectFailure>;
    readonly target: GatewayCalls["target"];
    readonly register: (client: string, gateway: string, session: string) => Effect.Effect<void>;
    readonly publish: (client: string, update: Published) => Effect.Effect<typeof Publication.Type, LedgerError>;
    // The door's calls. A door fails with `unknown`, which takes in every other failure.
    readonly connect: () => Effect.Effect<ConnectionId, ProjectFailure>;
    readonly challenge: (client: ConnectionId) => Effect.Effect<string, unknown>;
    readonly initialize: GatewayCalls["initialize"];
    readonly route: GatewayCalls["route"];
    readonly knock: (client: ConnectionId, input: { label: string }) => Effect.Effect<typeof Answer.Type, unknown>;
    readonly grant: GatewayCalls["grant"];
    readonly disconnect: (client: ConnectionId) => Effect.Effect<void, unknown>;
    // Presence.
    readonly join: (row: {
      readonly key: string;
      readonly client: string;
      readonly gateway: string;
      readonly session: string;
      readonly at: number;
    }) => Effect.Effect<void, ProjectFailure>;
    readonly leave: (client: string, session: string) => Effect.Effect<void, ProjectFailure>;
    readonly online: (key: string) => Effect.Effect<
      ReadonlyArray<{
        readonly key: string;
        readonly client: string;
        readonly gateway: string;
        readonly session: string;
        readonly at: number;
        readonly state: "online" | "away" | "unknown";
      }>,
      ProjectFailure
    >;
    readonly info: Effect.Effect<ReadonlyArray<ProcessInfo>, ProjectFailure>;
    readonly start: (
      request: Start,
      origin: From,
    ) => Effect.Effect<StartAnswer, ProcessError | ProgramDown | ProjectFailure>;
    readonly exit: (pid: string, reason: ExitReason, origin: From) => Effect.Effect<void, unknown>;
    // The ledger, through the referee.
    readonly read: (
      stream: string,
      after: number,
      reader: string,
    ) => Effect.Effect<ReadonlyArray<Entry>, ProjectFailure>;
    readonly wait: (stream: string, after: number, reader: string) => Effect.Effect<Waited, LedgerError>;
    // A `code.swapped` line loads the build it names, so a program that does not load fails it.
    readonly append: (
      stream: string,
      id: string,
      input: unknown,
    ) => Effect.Effect<Appended, ProgramDown | ProjectFailure>;
    // A process's own writes.
    readonly sign: (pid: string, id: string, parent: string, kind: string) => Effect.Effect<Session, unknown>;
    readonly commit: (
      pid: string,
      input: {
        readonly id: string;
        readonly parent: string;
        readonly kind: string;
        readonly stream: string;
        readonly event: unknown;
      },
    ) => Effect.Effect<Appended, unknown>;
    readonly inbox: (pid: string, input: Incoming) => Effect.Effect<Appended, unknown>;
    readonly own: (
      pid: string,
      id: string,
      stream: string,
      event: unknown,
      trace?: { traceId: string; spanId: string },
    ) => Effect.Effect<Appended, Cause.NoSuchElementError | ProjectFailure>;
    readonly brain: (event: typeof BrainEvent.Type) => Effect.Effect<Appended, ProjectFailure>;
    // ProcessManager over trusted Project RPC: a refusal is reply data.
    readonly processObject: (pid: string) => Effect.Effect<string, ProjectFailure>;
    readonly processStart: (
      request: Start,
      origin: From,
    ) => Effect.Effect<ProcessReply<StartAnswer>, ProgramDown | ProjectFailure>;
    readonly processExit: (pid: string, reason: ExitReason, origin: From) => Effect.Effect<ProcessReply<void>, unknown>;
    readonly processStatus: (owner: string) => Effect.Effect<
      ProcessReply<{
        readonly name: string;
        readonly state: typeof State.Type;
        readonly at: number;
        readonly restarts: ReadonlyArray<number>;
      }>,
      ProjectFailure
    >;
    readonly processResolve: (
      pid: string,
    ) => Effect.Effect<ProcessReply<{ readonly name: string; readonly state: typeof State.Type }>, ProjectFailure>;
    readonly processDead: (
      pid: string,
      dead: typeof DeadInput.Type,
      origin: From,
    ) => Effect.Effect<ProcessReply<void>, ProjectFailure>;
    readonly processIsLive: (pid: string) => Effect.Effect<boolean, ProjectFailure>;
    /** Records how far `pid` has read its name's inbox; the name is bound from the live process. */
    readonly processAck: (pid: string, pos: number, origin: From) => Effect.Effect<ProcessReply<void>, ProjectFailure>;
    readonly processMonitor: (
      ref: string,
      pid: string,
      origin: From,
    ) => Effect.Effect<ProcessReply<void>, ProjectFailure>;
    readonly processDemonitor: (ref: string, origin: From) => Effect.Effect<ProcessReply<void>, ProjectFailure>;
    readonly processDown: (
      pid: string,
      policy: { readonly reason: string; readonly crashes: number; readonly until: number },
      origin: From,
    ) => Effect.Effect<ProcessReply<void>, ProjectFailure>;
    readonly processReceive: (pid: string, after: number) => Effect.Effect<ProcessReply<Array<Letter>>, ProjectFailure>;
    readonly processChild: (input: Child, origin: From) => Effect.Effect<typeof ChildReplies.Type, ProjectFailure>;
    readonly processStop: (input: ChildStop, origin: From) => Effect.Effect<typeof StopReplies.Type, ProjectFailure>;
    /** A program's watch by name, in the Project's write turn; a refusal is reply data. */
    readonly programMonitor: (watch: Watch, origin: From) => Effect.Effect<typeof MonitorReplies.Type, ProjectFailure>;
    /** Ends a program's own watch under its ref, in the Project's write turn. */
    readonly programDemonitor: (unwatch: Unwatch, origin: From) => Effect.Effect<void, ProjectFailure>;
    /** The bootstrap process and the rev of its start. */
    readonly boot: StartAnswer;
  }
>()("@kampus/libfabrika/cloudflare/runtime.ProjectService") {}

/**
 * Layer that provides `ProjectService` for one Project object, after its start's input is decoded and
 * recorded in its own ledger.
 *
 * @category layers
 */
export const projectLayer = (
  ctx: DurableObjectState,
  env: Env,
  options: ProjectOptions,
  local = projectLedger(
    ctx,
    env,
    ctx.id.name ?? options.config?.name ?? "project",
    options.input ?? checkedSettings(env),
  ),
) => {
  const input: Effect.Effect<CheckedSettings, LedgerError | Starts.StartsError> = options.input ?? checkedSettings(env);
  return Layer.unwrap(
    input.pipe(
      Effect.map(({ input }) => {
        const starts = Layer.effect(
          Starts.Starts,
          Starts.Starts.pipe(
            Effect.map((starts) => ({
              record: (value: SettingsStart.Input) => local.write(starts.record(value)),
              read: starts.read,
            })),
          ),
        ).pipe(Layer.provide(local.starts));
        const recorded = SettingsRecorded.layer(input).pipe(Layer.provide(starts));
        return Layer.effect(ProjectService, projectLogic(ctx, env, options, local)).pipe(
          Layer.provide(Layer.merge(ProcessIdGenerator.layer, Id.Generator.layer)),
          Layer.provide(recorded),
        );
      }),
    ),
  );
};

/**
 * Creates the Project object's runtime: the full `ProjectService`, plus `settingsStart` and
 * `settingsRead`, which run on a smaller runtime of its ledger and starts alone.
 *
 * @category constructors
 */
export const projectRuntime = (ctx: DurableObjectState, env: Env, options: ProjectOptions) => {
  const local = projectLedger(
    ctx,
    env,
    ctx.id.name ?? options.config?.name ?? "project",
    options.input ?? checkedSettings(env),
  );
  const minimal = SettingsRuntime.runtime(local.starts.pipe(Layer.provideMerge(local.ledgerLayer)));
  const ready = Layer.unwrap(
    minimal.contextEffect.pipe(
      Effect.map((services) =>
        projectLayer(ctx, env, options, {
          ...local,
          ledgerLayer: Layer.mergeAll(
            Layer.succeed(Ledger, Context.get(services, Ledger)),
            Layer.succeed(LedgerTransaction, Context.get(services, LedgerTransaction)),
            Layer.succeed(Referee, Context.get(services, Referee)),
            Layer.succeed(LedgerStreams, Context.get(services, LedgerStreams)),
            // The same accounts the ledger admits with, so a manager's trusted call charges them.
            Layer.succeed(Quotas, Context.get(services, Quotas)),
            Layer.succeed(WritePolicy, Context.get(services, WritePolicy)),
          ),
          starts: Layer.succeed(Starts.Starts, Context.get(services, Starts.Starts)),
        }),
      ),
    ),
  );
  const runtime = SettingsRuntime.runtime(ready);
  const dispose = Effect.all([runtime.disposeEffect, minimal.disposeEffect], { discard: true, concurrency: 1 });
  return {
    ...runtime,
    disposeEffect: dispose,
    settingsStart: (input: SettingsStart.Input) =>
      minimal.provide(settingsReply(Starts.Starts.use((starts) => local.write(starts.record(input))))),
    settingsRead: (start: string) => minimal.provide(settingsReply(Starts.Starts.use((starts) => starts.read(start)))),
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the object owner closes both runtime scopes
    dispose: () => Effect.runPromise(dispose),
  };
};

/**
 * Layer that provides durable task storage on the Project's own database, for trusted startup code.
 * A task's doorbell rings the Connection object it names.
 *
 * @category layers
 */
export const projectTasksLayer = (ctx: DurableObjectState, env: Env) =>
  TasksLedger.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        LedgerTransactionSql.layer(cloudflareSql(ctx.storage)),
        LedgerStreamsSql.layer(cloudflareSql(ctx.storage)),
      ),
    ),
    Layer.provide(
      Layer.succeed(Doorbell, {
        ring: (to, stream, rev) => rpc(GatewayClient.make(env.CONNECTION.getByName(to)).ring(stream, rev)),
      }),
    ),
    Layer.provide(Id.Generator.layer),
  );

// The trace a delivered letter carries from the door, as P11's Incoming names it.
const Delivered = Schema.Struct({
  span: Schema.Struct({ traceId: Schema.String, spanId: Schema.String }),
});

const processLogic = Effect.fnUntraced(function* (
  ctx: DurableObjectState,
  env: Env,
  programs: Readonly<Record<string, ProgramSource>>,
) {
  const checked = yield* RecordedStart;
  // The object is its registered name's; its first process's descriptor names its storage.
  const [project] = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String])),
  )(ctx.id.name).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
  const stub = projectStub(env, project),
    p = ProjectClient.make(stub),
    storage = StorageClient.make(ctx.storage),
    sql = cloudflareSql(ctx.storage),
    loader = workerLoader(env.LOADER, programs, (hash) => rpc(p.code(hash)));
  const saved = yield* processDescriptor(ctx);
  // The name's own accounts and fault slot, kept beside its data in this object's SQLite (0147).
  const accounting = yield* ProjectQuotas.process(sql, saved.name, checked.values);
  const ledger = LedgerRemote.layer(stub, { reader: saved.id });
  const base = Layer.mergeAll(ledger, recordingLayer(sql, env, project, saved.id));
  // ProcessStore takes `sync` as a call, so each runtime and its tests can hand it their own.
  const all = Layer.mergeAll(
    ProcessStore.layer(sql, {
      process: saved.id,
      storage: { put: storage.put, sync: () => storage.sync, get: storage.get },
      accounting,
    }),
    Mailbox.layer,
  ).pipe(Layer.provideMerge(base));
  const services = yield* Layer.build(all).pipe(Effect.provideService(RecordedStart, checked));
  const store = Context.get(services, ProcessStore),
    sink = Context.get(services, SpanSink);
  // The name's live process, as the manager's status last answered it. Writes, loading and span
  // attribution follow it, so a successor signs and appends as itself.
  let active = saved.id;
  // Every manager call is idempotent by its own IDs, so an answer the transport lost is asked again,
  // a bounded number of times. A refusal is an answer and is never asked again.
  const asked = <A, E>(work: Effect.Effect<A, E>) =>
    work.pipe(
      Effect.retry({
        times: 2,
        while: (error) => error instanceof LedgerError && error.reason === "unreachable",
      }),
    );
  const manager: ProcessCalls = {
    start: (request, from) => asked(rpc(p.processStart(request, from))).pipe(Effect.flatMap(processValue)),
    exit: (process, reason, from) =>
      asked(rpc(p.processExit(process, reason, from))).pipe(Effect.flatMap(processValue)),
    info: Effect.suspend(() => asked(rpc(p.info()))),
    status: (name) =>
      asked(rpc(p.processStatus(name))).pipe(
        Effect.flatMap(processValue),
        Effect.tap((status) =>
          Effect.sync(() => {
            if (name === saved.name && status.state._tag === "live") {
              active = status.state.process;
            }
          }),
        ),
      ),
    resolve: (process) => asked(rpc(p.processResolve(process))).pipe(Effect.flatMap(processValue)),
    dead: (process, dead, from) => asked(rpc(p.processDead(process, dead, from))).pipe(Effect.flatMap(processValue)),
    isLive: (process) => asked(rpc(p.processIsLive(process))),
    ack: (process, pos, from) => asked(rpc(p.processAck(process, pos, from))).pipe(Effect.flatMap(processValue)),
    monitor: (ref, process, from) =>
      asked(rpc(p.processMonitor(ref, process, from))).pipe(Effect.flatMap(processValue)),
    demonitor: (ref, from) => asked(rpc(p.processDemonitor(ref, from))).pipe(Effect.flatMap(processValue)),
    receive: (process, after) => asked(rpc(p.processReceive(process, after))).pipe(Effect.flatMap(processValue)),
    down: (process, policy, from) =>
      asked(rpc(p.processDown(process, policy, from))).pipe(Effect.flatMap(processValue)),
  };
  // A child start is decided in the project, in its ledger's turns; this side asks, as for a start.
  const children = Children.of({
    start: (input, from) =>
      asked(rpc(p.processChild(input, from))).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ChildReplies)),
        Effect.mapError((cause) => new ChildrenError({ reason: "storage", cause })),
        Effect.flatMap((reply) =>
          reply._tag === "ok" ? Effect.succeed(reply.value) : Effect.fail(new ChildrenError({ reason: reply.reason })),
        ),
      ),
    // A stop is decided in the project too, so the stopped child's object learns it from the table.
    stop: (input, from) =>
      asked(rpc(p.processStop(input, from))).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(StopReplies)),
        Effect.mapError((cause) => new ChildrenError({ reason: "storage", cause })),
        Effect.flatMap((reply) =>
          reply._tag === "ok" ? Effect.void : Effect.fail(new ChildrenError({ reason: reply.reason })),
        ),
      ),
  });
  // A watch is decided in the project too, whose manager writes it as this object's process.
  const monitors = Monitors.of({
    monitor: (watch, from) =>
      asked(rpc(p.programMonitor(watch, from))).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(MonitorReplies)),
        Effect.mapError((cause) => new MonitorsError({ reason: "storage", cause })),
        Effect.flatMap((reply) =>
          reply._tag === "ok" ? Effect.succeed(reply.value) : Effect.fail(new MonitorsError({ reason: reply.reason })),
        ),
      ),
    demonitor: (unwatch, from) =>
      asked(rpc(p.programDemonitor(unwatch, from))).pipe(
        Effect.mapError((cause) => new MonitorsError({ reason: "storage", cause })),
      ),
  });
  const dependencies = Layer.mergeAll(
    mailLayer(env, project),
    handsLayer(env, project),
    Layer.succeed(CheckedWriter, {
      sign: (id, parent, kind) =>
        Effect.suspend(() => rpc(p.sign(active, id, parent, kind))).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(SigningReply)),
          Effect.mapError((cause) => new LedgerError({ reason: "unreachable", cause })),
          Effect.flatMap(checkedValue),
        ),
      append: (input) => Effect.suspend(() => rpc(p.inbox(active, input))),
      commit: (id, session, stream, event) =>
        Effect.suspend(() =>
          rpc(p.commit(active, { id, parent: session.parent, kind: event._tag, stream, event })),
        ).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(CommitReply)),
          Effect.mapError((cause) => new LedgerError({ reason: "unreachable", cause })),
          Effect.flatMap(checkedValue),
        ),
      own: Effect.fn("process.own")(function* (id: string, stream: string, event: unknown) {
        const span = yield* Effect.currentSpan.pipe(Effect.orDie);
        return yield* rpc(p.own(active, id, stream, event, { traceId: span.traceId, spanId: span.spanId }));
      }),
    }),
    WatcherManagerRemote.layer((client, update) => rpc(p.publish(client, { ...update, pid: active }))),
    Layer.succeed(Alarm, {
      // Keep the program's wake; the platform requires a positive alarm time.
      set: (at) =>
        (at === null
          ? rpc(storage.delete("wake")).pipe(Effect.andThen(rpc(storage.deleteAlarm)))
          : rpc(storage.put("wake", at)).pipe(Effect.andThen(rpc(storage.setAlarm(Math.max(1, at)))))
        ).pipe(Effect.orDie),
    }),
    // Recording captures its sink's services itself (main's P11); the runner no longer provides them.
    Layer.succeed(Recording, { flush: sink.flush.pipe(Effect.provideContext(services)) }),
    // The project's brain writes as `brain:<project>`, the one writer its process table trusts.
    remoteProcessManager(manager, `brain:${project}`),
    Layer.succeed(Children, children),
    Layer.succeed(Monitors, monitors),
  );
  // P34 on the Worker: receipts and pending recovery live in this object's own SQLite, beside
  // ProcessStore, under the registered name every successor shares.
  const runnerLayer = ProgramRunner.withLoader(
    saved,
    {
      load: (name, hash) =>
        Effect.gen(function* () {
          const process = active;
          const tail = yield* bindTail(ctx, { project, name: saved.name, process }).pipe(
            Effect.mapError((cause) => new ProgramDown({ reason: "load", error: "ProgramDown", cause })),
          );
          return yield* loader.load(name, process, tail, hash);
        }),
    },
    {
      policy: defaultPolicy,
      recovery: { sql, name: saved.name, capacity: 1024 ** 3, accounting },
      // `mail.chunk`, read at the brain's edge with the start's other settings (0086).
      chunk: checked.values.mailChunk,
    },
  ).pipe(Layer.provide(dependencies), Layer.provide(Layer.succeedContext(services)));
  // A name stopped under its reserve does no work until a person restarts it.
  const runner = QuotaRunner.guard(yield* ProgramRunner.pipe(Effect.provide(runnerLayer)), accounting);
  yield* sink.flush.pipe(Effect.provideContext(services));
  const attributed = <A, E, R>(work: Effect.Effect<A, E, R>) =>
    Effect.suspend(() =>
      // One batch for the whole call, inside the runner's own flush, which commits it first (0122).
      sink.batch(work).pipe(Effect.annotateSpans({ "fab.process": active }), Effect.provideContext(services)),
    );
  return {
    usage: Effect.fnUntraced(
      function* (rows: unknown) {
        const usage = yield* Schema.decodeUnknownEffect(Schema.Array(IsolateUsage.Usage))(rows);
        yield* sink.batch(IsolateUsage.record(usage));
      },
      Effect.withSpan("process.usage"),
      (work) => complete(work),
      Effect.provideContext(services),
    ),
    msg: (input: unknown) => {
      const work = attributed(runner.msg(input));
      // The door's input span is in another object, so its trace crosses the call as data.
      const sent = Schema.decodeUnknownOption(Delivered)(input);
      return Option.isSome(sent) ? work.pipe(Effect.withParentSpan(Tracer.externalSpan(sent.value.span))) : work;
    },
    swap: (request: Parameters<typeof runner.swap>[0]) => attributed(runner.swap(request)),
    mailed: (trace?: { traceId: string; spanId: string }) => {
      const work = attributed(complete(runner.mailed));
      return trace === undefined ? work : work.pipe(Effect.withParentSpan(Tracer.externalSpan(trace)));
    },
    open: (client: string) => attributed(runner.open(client)),
    due: (at: number) => attributed(runner.due(at)),
    init: () => attributed(runner.init()),
    restart: (request: unknown) =>
      Schema.decodeUnknownEffect(RestartRequest)(request).pipe(
        Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
        // The control door is the person's gate: only the instance's own token reaches this call,
        // and it carries no checked requester. So a restart here is the person's, and it may clear
        // the name's saved reserve fault.
        Effect.flatMap((checked) => attributed(QuotaRunner.personRestart(runner, accounting, checked))),
      ),
    // A platform alarm delivers the saved due time, so a repeated alarm is the same letter.
    alarm: () =>
      rpc(storage.get<number>("wake")).pipe(
        Effect.flatMap((at) => (at === undefined ? Effect.void : attributed(runner.due(at)))),
      ),
    activity: store.activity,
    // The marker the store keeps in this object's own storage, where the wake rule reads it.
    recover: () => store.readActivity.pipe(Effect.flatMap((value) => Effect.fromResult(recoverActivity(value)))),
  };
});

/** What a runner call fails with: the union `ProgramRunner`'s calls name. */
type RunnerFailure =
  | LedgerError
  | RecoveryStoreError
  | SessionManagerError
  | ProgramDown
  | RunnerError
  | SinkError
  | ProcessError
  | NotGranted
  | RepliesError
  | QuotasError
  | WatchersError;

/**
 * Service for a Process object's calls: its runner's turns, its code swap, its alarm and its saved
 * activity.
 *
 * @category services
 */
export class ProcessService extends Context.Service<
  ProcessService,
  {
    readonly usage: (rows: unknown) => Effect.Effect<void, Schema.SchemaError | SinkError>;
    readonly msg: (input: unknown) => Effect.Effect<Sent, RunnerFailure>;
    readonly mailed: (trace?: { traceId: string; spanId: string }) => Effect.Effect<void, RunnerFailure>;
    readonly open: (client: string) => Effect.Effect<Opened, RunnerFailure>;
    readonly due: (at: number) => Effect.Effect<void, RunnerFailure>;
    readonly swap: (request: {
      readonly load: string;
      readonly program: string;
      readonly hash: string;
    }) => Effect.Effect<Swapped, RunnerFailure>;
    readonly init: () => Effect.Effect<void, RunnerFailure>;
    readonly restart: (request: unknown) => Effect.Effect<void, RunnerFailure>;
    readonly alarm: () => Effect.Effect<void, RunnerFailure>;
    readonly activity: (value: typeof Activity.Type) => Effect.Effect<void, LedgerError | QuotasError>;
    /** The saved activity marker after a wake: `idle`, or `interrupted` with the step that was cut short. */
    readonly recover: () => Effect.Effect<typeof Recovered.Type, LedgerError>;
  }
>()("@kampus/libfabrika/cloudflare/runtime.ProcessService") {}

/**
 * Layer that provides one Process object's `ProcessService`, its start recorded with the Project.
 *
 * **Details**
 *
 * `input` is the instance's checked settings, read as the app reads them. Without it the layer
 * reads the `INSTANCE` binding itself, and a bad setting fails with `StartsError`.
 *
 * @category layers
 */
export const processLayer = (
  ctx: DurableObjectState,
  env: Env,
  programs: Readonly<Record<string, ProgramSource>>,
  input?: ProjectOptions["input"],
) =>
  Layer.effect(ProcessService, processLogic(ctx, env, programs)).pipe(
    Layer.provide(input === undefined ? recordedLayer(env) : recordedLayer(env, input)),
  );

/**
 * Creates a Process object's runtime: `ProcessService` over its built-in programs, with the start
 * recorded with the Project.
 *
 * @category constructors
 */
export const processRuntime = (ctx: DurableObjectState, env: Env, programs: Readonly<Record<string, ProgramSource>>) =>
  SettingsRuntime.runtime(processLayer(ctx, env, programs));
