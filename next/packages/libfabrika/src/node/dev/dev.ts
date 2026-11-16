/**
 * The local brain's driver on Node: it starts the local runtime through a deploy the caller
 * gives, follows its starts, exits and restarts, and hands back stand-ins for its bindings that
 * call it over a private control socket.
 */
import { RuntimeLifecycle, type RuntimeEvent } from "@alchemy.run/cloudflare-runtime/core/Runtime";
import { SystemError } from "@alchemy.run/cloudflare-runtime/core/RuntimeError";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Exit from "effect/Exit";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/process/ChildProcess";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import * as Formatter from "effect/Formatter";
import { String as Str, pipe } from "effect";
import { ProcessIdGenerator } from "../../processes/ProcessIdGenerator.ts";
import { BrainEvent } from "../../runtime/BrainEvent.ts";
import { Installed, type Install } from "../../runtime/Code.ts";
import type { CodeEvent } from "../../runtime/Code.ts";
import { SpanSink } from "../../telemetry/Sink.ts";
import { ControlPlugin } from "./ControlPlugin.ts";
import { devRecording } from "./dev-recording.ts";
import { type devLife, type DevState, latest, pending, Pid, reachable, recovering, target } from "./DevLife.ts";
import { brainOutbox, checkMemory, lifeCell, signal, terminate } from "./local-dev.ts";

/**
 * Error for a call on the local runtime that failed: its `reason` names how, such as `offline`,
 * `unreachable`, `bad_row`, `start_timeout` or `install`.
 *
 * @category errors
 */
export class ControlError extends Schema.TaggedError<ControlError, { readonly brand: unique symbol }>()(
  "ControlError",
  {
    reason: Schema.String,
    /** The failure this error translates, kept in memory for diagnosis. */
    cause: Schema.optional(Schema.Defect()),
  },
) {}

type Target = "project" | "process" | "record" | "loader" | "bucket";

type Binding = Readonly<Record<string, (...args: ReadonlyArray<unknown>) => Promise<unknown>>>;

type Life = typeof devLife.model.Type;

const isPid = Schema.is(Pid);

type Cause = {
  readonly reason: (typeof BrainEvent.cases.started.Type)["reason"];
  readonly bytes: number | undefined;
};

// The token a move consumed, so its replacement is settled once.
const consumed = (prev: Life, next: Life) => {
  const id = pending(prev);

  return id !== null && pending(next) !== id ? id : null;
};

// How long the first start waits for its control listener, and a call for a replacement's, past the grace.
const START_BOUND = 30_000;

const Response = Schema.Struct({
  value: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Struct({ reason: Schema.String })),
});

const sample = (pid: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make("ps", ["-o", "rss=", "-p", String(pid)]);

      const [text, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.stdout)), child.exitCode], {
        concurrency: 2,
      });

      if (code !== 0) {
        return yield* ControlError.make({ reason: "sample" });
      }

      return Number(Str.trim(text)) * 1024;
    }),
  ).pipe(Effect.mapError((cause) => ControlError.make({ reason: "sample", cause })));

const bucketChecksum = Effect.fn(function* <E>(work: Effect.Effect<unknown, E>) {
  const raw = yield* work;

  if (raw === null) {
    return null;
  }

  const { sha256 } = yield* Schema.decodeUnknownEffect(Schema.Struct({ sha256: Schema.String }))(raw);
  const pairs: ReadonlyArray<string> = Option.getOrElse(pipe(sha256, Str.match(/../g)), (): Array<string> => []);
  return {
    checksums: {
      sha256: Uint8Array.from(Arr.map(pairs, (byte) => Number.parseInt(byte, 16))).buffer,
    },
  };
});

/**
 * Starts the local instance's brain and answers its address with stand-ins for its bindings:
 * `project`, `process`, `record`, `loader` and `bucket`, each a call over the private control
 * socket.
 *
 * **Details**
 *
 * `deploy` gets a context that holds the runtime's lifecycle hook and the control plugin, and a
 * scope of its own for the runtime. The driver waits for the control socket to listen, for at most
 * 30 seconds, and for the first start. It saves every start, replace, kill, exit, restart wait,
 * brake and stop as a `BrainEvent` in a durable outbox under `home` and sends them to the project,
 * so an event outlives a crash on either side. Once a second it samples the runtime's memory, and
 * at `memory` bytes or more it replaces the process once: it records `replacing`, sends SIGTERM,
 * and if the process has not ended after `grace` milliseconds it records `killed` and sends
 * SIGKILL. Each signal goes out in the same step that moves the life state, only while that state
 * still says the sampled pid is being replaced, so none follows a folded exit, the stop or a newer
 * start. Alchemy then starts a new process on the same ports, and its exit and start are
 * recorded with the reason `memory`. A start whose pid is not a whole number above zero is
 * refused, and a first start that brings one fails as `bad_pid`. Closing the caller's scope stops
 * the runtime and records `stopped`.
 *
 * **Gotchas**
 *
 * The control socket listens on 127.0.0.1 only and takes a random bearer token made for this
 * start. A call goes only to a listener with no replacement pending. A binding's call made while a
 * replacement is pending, after a replace or a crash, waits for its listener for at most `grace`
 * plus 30 seconds, and fails as `offline` if a brake or the stop comes first or the wait runs out.
 * The brain's own flushes never wait: they fail as `offline` at once and retry on their schedule.
 * A call made while no port is known fails as `offline`.
 *
 * @category constructors
 */
export const startDev = Effect.fn("brain.instance")(function* <E, R>(
  options: {
    readonly name: string;
    readonly port: number;
    readonly build: string;
    readonly home: string;
    /** The memory limit in bytes, the `desktop.brain-memory` setting. */
    readonly memory: number;
    /** The milliseconds between a replace's SIGTERM and its SIGKILL, the `desktop.brain-grace` setting. */
    readonly grace: number;
  },
  deploy: (local: Context.Context<never>, scope: Scope.Scope) => Effect.Effect<unknown, E, R>,
) {
  const config = options,
    scope = yield* Effect.scope,
    ids = yield* ProcessIdGenerator,
    client = yield* HttpClient.HttpClient,
    // The services a binding's Promise call runs on, so it keeps the brain's clock, logger and tracer.
    context = yield* Effect.context<never>();
  const outbox = yield* brainOutbox(options.home),
    runtimeScope = yield* Scope.make(),
    events = yield* Queue.unbounded<{ readonly event: RuntimeEvent; readonly cause: Cause }>(),
    // Alchemy's local Worker provider forks the workerd start, so deploy returns before workerd
    // listens. The control socket's first start opens this latch.
    listening = yield* Deferred.make<void>(),
    // The first start, or `bad_pid` when it reported no process's pid.
    started = yield* Deferred.make<void, ControlError>();

  const token = Redacted.make(
    Base64Url.encode(yield* SecureRandom.SecureRandom.use((random) => random.randomBytes(32))),
  );

  // The life state, which a call can follow to the state a replacement brings. Each move folds one
  // Msg atomically and hands back the state before and after it.
  const cell = yield* lifeCell(yield* outbox.last);
  const life = cell.state;
  const send = cell.send;
  // The handles behind the machine's replacement tokens.
  const replacements = new Map<string, Deferred.Deferred<void, ControlError>>();
  // What the callback saw last, kept for the next event's row.
  let cause: Cause = { reason: "open", bytes: undefined };

  // The first state with no replacement that may still come up, or null once the wait runs out.
  const settled = Effect.fnUntraced(function* () {
    // The runtime's callback only queues what it reports, and the event fiber it wakes folds it.
    // Yielding once lets that fiber fold an exit already in the queue first. It covers no more: an
    // exit Alchemy has not reported yet, or one the event fiber has taken but not folded, is not
    // seen, so a call in that crash window may still dial the ended process and answer
    // `unreachable`.
    yield* Effect.yieldNow;
    const now = yield* SubscriptionRef.get(life);

    if (!recovering(now)) {
      return now;
    }

    const next = yield* SubscriptionRef.changes(life).pipe(
      Stream.filter((s) => !recovering(s)),
      Stream.runHead,
      Effect.timeoutOption(options.grace + START_BOUND),
    );

    return Option.getOrNull(Option.flatten(next));
  });

  // One control request to one port, or `offline` when there is none to dial.
  const dial = Effect.fnUntraced(function* (
    port: number | null,
    target: Target,
    project: string,
    name: string,
    method: string,
    args: ReadonlyArray<unknown>,
  ) {
    if (port === null) {
      return yield* ControlError.make({ reason: "offline" });
    }

    const url = `http://127.0.0.1:${port}`;
    const fail = (cause: unknown) => ControlError.make({ reason: "unreachable", cause });
    const body = yield* Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))({
      target,
      project,
      name,
      method,
      args,
    }).pipe(Effect.mapError(fail));

    const response = yield* HttpClientRequest.post(url).pipe(
      // oxlint-disable-next-line fabrika/no-redacted-value -- the private HTTP header sends the control bearer
      HttpClientRequest.setHeader("authorization", `Bearer ${Redacted.value(token)}`),
      HttpClientRequest.bodyText(body, "application/json"),
      client.execute,
      // No span and no trace header for a control call: the span sink flushes through this call.
      Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
      Effect.mapError(fail),
    );

    const raw = yield* response.json.pipe(Effect.mapError((cause) => ControlError.make({ reason: "bad_row", cause })));

    const answer = yield* Schema.decodeUnknownEffect(Response)(raw).pipe(
      Effect.mapError((cause) => ControlError.make({ reason: "bad_row", cause })),
    );

    if (answer.error !== undefined) {
      return yield* ControlError.make(answer.error);
    }

    return answer.value;
  });

  // A binding's call, from outside the brain: it waits for a pending replacement's listener.
  const call = Effect.fnUntraced(function* (
    target: Target,
    project: string,
    name: string,
    method: string,
    args: ReadonlyArray<unknown>,
  ) {
    const s = yield* settled();

    return yield* dial(s === null ? null : reachable(s), target, project, name, method, args);
  });

  // The brain's own call, from a flush that holds its lock: it never waits, so the lock is never
  // held across a replace. While a replacement is pending it fails as `offline` at once, and the
  // flush's own schedule sends the rows again.
  const callNow = Effect.fnUntraced(function* (
    target: Target,
    project: string,
    name: string,
    method: string,
    args: ReadonlyArray<unknown>,
  ) {
    return yield* dial(reachable(yield* SubscriptionRef.get(life)), target, project, name, method, args);
  });

  const flush = outbox.flush((event) => callNow("project", config.name, "", "brain", [event]));

  const recording = yield* devRecording(options.home, `brain:${config.name}`, (target, name, method, args) =>
    callNow(target, config.name, name, method, args),
  );

  const sink = Context.get(recording, SpanSink);
  const flushRecords = sink.flush.pipe(Effect.provideContext(recording));

  const recorded = <A, E, R>(work: Effect.Effect<A, E, R>) =>
    work.pipe(
      Effect.exit,
      Effect.flatMap((exit) =>
        flushRecords.pipe(
          // The durable queue retries a down receiver. A full local disk still fails loudly.
          Effect.catchIf(
            (error) => error.reason !== "storage",
            () => Effect.void,
          ),
          Effect.flatMap(() => exit),
        ),
      ),
      Effect.provideContext(recording),
    );

  const local = Context.empty().pipe(
    Context.add(RuntimeLifecycle, (event) => {
      const observed = { event, cause };

      // A new child starts with a clean cause before any queued file write can yield.
      if (event.type === "start") {
        cause = { reason: "crash", bytes: undefined };
      }

      Queue.offerUnsafe(events, observed);
    }),
    Context.add(ControlPlugin, {
      sockets: [
        {
          name: "fabrika-control",
          address: "127.0.0.1:0",
          http: {},
          service: {
            name: "user-worker",
            entrypoint: "Control",
            // oxlint-disable-next-line fabrika/no-redacted-value -- Alchemy sends these entrypoint props to workerd
            props: { json: Formatter.formatJson({ token: Redacted.value(token) }) },
          },
        },
      ],
      start: Effect.fnUntraced(function* (ports) {
        const port = yield* Schema.decodeUnknownEffect(Schema.Int)(ports["fabrika-control"]).pipe(
          Effect.mapError((cause) =>
            SystemError.make({
              subtag: "control_port",
              message: "The local runtime returned an invalid control port",
              cause,
            }),
          ),
        );

        const [prev, next] = yield* send({ type: "listened", port });
        yield* Deferred.succeed(listening, undefined);
        const id = consumed(prev, next);
        const ready = id === null ? undefined : replacements.get(id);

        if (id !== null && ready !== undefined) {
          replacements.delete(id);
          yield* Deferred.succeed(ready, undefined);
        }
      }),
    }),
  );

  const stopRuntime = Effect.fn("brain.stop")(function* () {
    const [, stopping] = yield* send({ type: "stop" });
    yield* Scope.close(runtimeScope, Exit.void);
    const start = latest(stopping);

    if (start !== null) {
      const at = yield* Clock.currentTimeMillis;
      const id = `${start}/stopped`;
      yield* outbox.add(BrainEvent.cases.stopped.make({ id, start, at, reason: "stop" }));
      yield* flush.pipe(Effect.ignore);
    }

    yield* send({ type: "stopped" });
    // The stop discards any replacement still waiting; its restart ends with the scope.
    replacements.clear();
  });

  yield* Effect.addFinalizer(() => recorded(stopRuntime()).pipe(Effect.orDie));

  const restartRuntime = Effect.fn("brain.restart")(function* (ready: Deferred.Deferred<void, ControlError>) {
    yield* Deferred.await(ready);
  });

  const recordEvents = Effect.forever(
    Effect.gen(function* () {
      const {
        event,
        cause: { reason, bytes: rss },
      } = yield* Queue.take(events);

      const now = yield* SubscriptionRef.get(life);

      if (now._tag === "stopping" || now._tag === "stopped") {
        return;
      }

      const start = latest(now) ?? "";

      if (event.type === "exit") {
        const at = yield* Clock.currentTimeMillis;
        // The handle exists before its token, so the listener always finds it.
        const ready = yield* Deferred.make<void, ControlError>();
        replacements.set(start, ready);
        // The exit is folded before its row is written, so no call dials the ended process while
        // the write is under way.
        const [prev] = yield* send({ type: "exited", replacement: start });
        const old = pending(prev);

        // A second exit before any listener replaces the token, as main replaced the wait.
        if (old !== null && old !== start) {
          replacements.delete(old);
        }

        yield* outbox.add(
          BrainEvent.cases.exited.make({
            id: `${start}/exited`,
            start,
            at,
            reason,
            exitCode: event.exit.exitCode,
            signal: event.exit.signal === null ? null : String(event.exit.signal),
            ...(rss === undefined ? {} : { bytes: rss }),
          }),
        );
        yield* Effect.forkIn(recorded(restartRuntime(ready)).pipe(Effect.ignore), scope);
      }

      if (event.type === "start") {
        const { pid } = event;

        // A pid that names no one process is refused before it reaches the state: a signal to zero
        // or below reaches a whole process group. A first start that brings one fails the start.
        if (!isPid(pid)) {
          yield* Effect.logError("The local runtime reported a start with no process id", { pid });
          yield* Deferred.fail(started, ControlError.make({ reason: "bad_pid" }));

          return;
        }

        const next = yield* ids.next;
        const at = yield* Clock.currentTimeMillis;
        const [, up] = yield* send({ type: "started", start: next, pid, build: config.build, at });

        // Braked and stopping refuse a start.
        if (up._tag !== "spawned" && up._tag !== "online") {
          return;
        }

        const startedEvent = BrainEvent.cases.started.make({
          id: `${next}/started`,
          start: next,
          after: up.session.after,
          build: up.session.build,
          reason,
          pid: up.pid,
          at,
          ...(rss === undefined ? {} : { bytes: rss }),
        });

        yield* outbox.add(startedEvent);
        yield* Deferred.succeed(started, undefined);
      } else if (event.type === "restart") {
        const until = (yield* Clock.currentTimeMillis) + event.delay;
        yield* send({ type: "waiting", until, reason });
        const at = yield* Clock.currentTimeMillis;
        yield* outbox.add(
          BrainEvent.cases.restarting.make({
            id: `${start}/restarting`,
            start,
            at,
            reason,
            exitCode: event.exit.exitCode,
            signal: event.exit.signal === null ? null : String(event.exit.signal),
            backoff: event.delay,
            ...(rss === undefined ? {} : { bytes: rss }),
          }),
        );
      } else if (event.type === "stop") {
        const [prev, next] = yield* send({ type: "braked", reason: event.reason });
        const id = consumed(prev, next);
        const ready = id === null ? undefined : replacements.get(id);

        if (id !== null && ready !== undefined) {
          replacements.delete(id);
          yield* Deferred.fail(ready, ControlError.make({ reason: event.reason }));
        }

        const at = yield* Clock.currentTimeMillis;
        yield* outbox.add(
          BrainEvent.cases.braked.make({
            id: `${start}/braked`,
            start,
            at,
            reason: event.reason,
            exitCode: event.exit.exitCode,
            signal: event.exit.signal === null ? null : String(event.exit.signal),
          }),
        );
      }
    }),
  );

  yield* Effect.forkScoped(recordEvents);

  const startRuntime = Effect.fn("brain.start")(function* () {
    yield* deploy(local, runtimeScope);
    yield* Deferred.await(listening).pipe(
      Effect.timeoutOrElse({
        duration: START_BOUND,
        orElse: () => Effect.fail(ControlError.make({ reason: "start_timeout" })),
      }),
    );
    yield* Deferred.await(started);
    yield* call("project", config.name, "", "info", []);
    yield* flush;
  });

  yield* recorded(startRuntime());

  // A replace's facts, each written in the step that moved the state and before its signal, so the
  // outbox reads in the order things happened. A full disk must not keep a runtime alive that is
  // past its limit, so a failed write is logged.
  const record = Effect.fnUntraced(function* (prev: Life, next: typeof DevState.cases.replacing.Type) {
    const start = next.session.start;

    if (next.signal === "SIGKILL") {
      const at = yield* Clock.currentTimeMillis;
      yield* outbox
        .add(BrainEvent.cases.killed.make({ id: `${start}/killed`, start, at, pid: next.pid }))
        .pipe(Effect.ignore({ log: "Error", message: "The brain could not record a kill" }));

      return;
    }

    const old = pending(prev);

    // A replace of a process whose own replacement never listened takes that wait's place.
    if (old !== null && old !== next.replacement.id) {
      replacements.delete(old);
    }

    cause = { reason: "memory", bytes: next.bytes };
    yield* outbox
      .add(
        BrainEvent.cases.replacing.make({
          id: `${start}/replacing`,
          start,
          at: next.at,
          reason: "memory",
          pid: next.pid,
          bytes: next.bytes,
          limit: options.memory,
          grace: options.grace,
        }),
      )
      .pipe(Effect.ignore({ log: "Error", message: "The brain could not record a replace" }));
  });

  // One replace per start: the fold moves only the running process the sample read to
  // `replacing`, and `target` is null from then on, so the sampler cannot ask again until a new
  // process starts. The bounded stop runs in the brain's scope.
  const replace = Effect.fnUntraced(function* (value: { readonly pid: number; readonly bytes: number }) {
    const at = yield* Clock.currentTimeMillis;
    const replacement = latest(yield* SubscriptionRef.get(life)) ?? "";
    const sample = { pid: value.pid, bytes: value.bytes, at, replacement };
    yield* Effect.forkIn(terminate({ life: cell, sample, grace: options.grace, signal, record }), scope);
  });

  yield* Effect.forkScoped(
    Effect.forever(
      Effect.gen(function* () {
        yield* Effect.sleep("1 second");

        const pid = target(yield* SubscriptionRef.get(life));

        if (pid === null) {
          return;
        }

        yield* checkMemory({ pid, limit: options.memory, sample, replace }).pipe(Effect.ignore);
        yield* flush.pipe(Effect.ignore);
        yield* flushRecords.pipe(
          Effect.catchIf(
            (error) => error.reason !== "storage",
            () => Effect.void,
          ),
          Effect.orDie,
        );
      }),
    ),
  );
  const proxy = <Members extends Readonly<Record<string | symbol, unknown>>>(
    invoke: (method: string, args: ReadonlyArray<unknown>) => Effect.Effect<unknown, ControlError>,
    members: Members,
  ) =>
    new Proxy(Object.assign<Binding, Members>({}, members), {
      get: (_value, method) => {
        if (method === "then") {
          return undefined;
        }

        if (Rec.has<string | symbol, unknown>(members, method)) {
          return members[method as keyof Members];
        }

        const work = (args: ReadonlyArray<unknown>) => invoke(String(method), args);

        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the local binding proxy matches Durable Object's Promise API
        return (...args: ReadonlyArray<unknown>) => Effect.runPromiseWith(context)(work(args));
      },
    });

  const binding = (target: Target, project: string, name = "") =>
    proxy((method, args) => call(target, project, name, method, args), {});
  // A Worker Loader's start: the program's init, answering its binding.
  const loaded = (name: string, pid: string) =>
    call("loader", pid, name, "init", [null]).pipe(Effect.as(binding("loader", pid, name)));
  return {
    recording,
    install: (code: Install): Effect.Effect<Installed, ControlError> =>
      recorded(
        call("project", config.name, "", "codeInstall", [code]).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Installed)),
        ),
      ).pipe(Effect.mapError((cause) => ControlError.make({ reason: "install", cause }))),
    failed: (fact: (typeof CodeEvent.cases)["code.failed"]["Type"]): Effect.Effect<void, ControlError> =>
      recorded(call("project", config.name, "", "codeFailed", [fact]).pipe(Effect.asVoid)).pipe(
        Effect.mapError((cause) => ControlError.make({ reason: "install", cause })),
      ),
    url: `http://127.0.0.1:${config.port}`,
    project: (project: string) =>
      proxy((method, args) => call("project", project, "", method === "connect" ? "clientConnect" : method, args), {
        gateways: binding("project", project),
        forProcess: (pid: string) =>
          proxy(
            (method, args) => call("project", project, "", method === "append" ? "commit" : method, [pid, ...args]),
            {},
          ),
      }),
    process: (pid: string) =>
      proxy((method, args) => call("process", config.name, pid, method === "alarm" ? "savedAlarm" : method, args), {}),
    record: (project: string, name: string) => binding("record", project, name),
    loader: {
      load: (name: string, pid: string) =>
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the local Worker Loader proxy matches the platform's Promise API
        Effect.runPromiseWith(context)(loaded(name, pid)),
    },
    bucket: {
      put: (key: string, body: Uint8Array, options: { sha256: string }) =>
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the local R2 proxy matches the platform's Promise API
        Effect.runPromiseWith(context)(call("bucket", config.name, "", "put", [key, [...body], options.sha256])),
      head: (key: string) =>
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the local R2 proxy matches the platform's Promise API
        Effect.runPromiseWith(context)(bucketChecksum(call("bucket", config.name, "", "head", [key]))),
    },
  };
});
