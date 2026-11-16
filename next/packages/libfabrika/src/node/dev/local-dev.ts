/**
 * The local brain driver's helpers on Node: the local runtime's life state and the one way to
 * change it, the memory check that replaces a brain that grew too big, the bounded stop that ends
 * it, the signal it sends, and the durable outbox for its lifecycle events.
 */
import { applyCell } from "@demlik/tea";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Arr from "effect/Array";
import * as Formatter from "effect/Formatter";
import { String as Str } from "effect";
import { BrainEvent } from "../../runtime/BrainEvent.ts";
import { devLife, type DevState } from "./DevLife.ts";

type Life = typeof devLife.model.Type;

type LifeMsg = typeof devLife.msg.Type;

type Replacing = typeof DevState.cases.replacing.Type;

type Signal = Replacing["signal"];

/**
 * Creates the local runtime's life: its state, which a waiter can follow, and the two ways to
 * change it.
 *
 * **Details**
 *
 * `state` starts as the machine's `init` with `last`, the newest start an earlier run saved. `send`
 * folds one Msg and answers the state before and after it. `step` folds one Msg and, only when the
 * fold moved the state as `moved` says, runs `then` on the two states before any other Msg is
 * folded; it answers whether `then` ran. A signal sent inside `then` therefore goes to a pid the
 * state still vouches for: no exit, stop or start is folded between the check and the signal.
 *
 * **Gotchas**
 *
 * Every fold waits for a `then` in flight, so `then` does only what must not be overtaken: the
 * fact a signal follows, and the signal.
 *
 * @category constructors
 */
export const lifeCell = Effect.fnUntraced(function* (last: string | null) {
  const state = yield* SubscriptionRef.make(devLife.init(null, { last })[0]);
  const turn = yield* Semaphore.make(1);

  const fold = (msg: LifeMsg) =>
    SubscriptionRef.modify(state, (prev) => {
      const [next] = applyCell(devLife, prev, msg);

      return [[prev, next] as const, next];
    });

  return {
    state,
    send: (msg: LifeMsg) => turn.withPermit(fold(msg)),
    step: <S extends Life, E, R>(
      msg: LifeMsg,
      moved: (prev: Life, next: Life) => next is S,
      then: (prev: Life, next: S) => Effect.Effect<void, E, R>,
    ) =>
      turn.withPermit(
        Effect.gen(function* () {
          const [prev, next] = yield* fold(msg);

          if (!moved(prev, next)) {
            return false;
          }

          yield* then(prev, next);

          return true;
        }),
      ),
  };
});

type LifeCell = Effect.Success<ReturnType<typeof lifeCell>>;

class BrainError extends Schema.TaggedError<BrainError, { readonly brand: unique symbol }>()("BrainError", {
  reason: Schema.Literals(["storage", "bad_row", "id_reused"]),
  /** The failure this error translates, kept in memory for diagnosis. */
  cause: Schema.optional(Schema.Defect()),
}) {}

// Events have no transforms. Validate without rebuilding them, keeping retry bytes in their saved order.
const PendingEvent = Schema.declare<typeof BrainEvent.Type>((raw): raw is typeof BrainEvent.Type =>
  Result.isSuccess(Schema.decodeUnknownResult(BrainEvent, { onExcessProperty: "error" })(raw)),
);

/**
 * Samples one process's memory and asks for a replacement when it holds `limit` bytes or more.
 * Below that it does nothing.
 *
 * **Details**
 *
 * `sample` answers the bytes a pid holds. `replace` gets the reason, the pid and the bytes, and is
 * the one that ends the process. `limit` is the `desktop.brain-memory` setting, in bytes.
 *
 * @category combinators
 */
export const checkMemory = Effect.fn("brain.checkMemory")(function* <E, R>(options: {
  readonly pid: number;
  readonly limit: number;
  readonly sample: (pid: number) => Effect.Effect<number, E, R>;
  readonly replace: (reason: { reason: "memory"; pid: number; bytes: number }) => Effect.Effect<void, E, R>;
}) {
  const bytes = yield* options.sample(options.pid);

  if (bytes >= options.limit) {
    yield* options.replace({ reason: "memory", pid: options.pid, bytes });
  }
});

// What `process.kill` throws for a pid that no longer exists.
const isMissing = Schema.is(Schema.Struct({ code: Schema.Literal("ESRCH") }));

// A signal the OS refused: `missing` when the pid has no process (ESRCH), `refused` for any other.
class SignalError extends Schema.TaggedError<SignalError, { readonly brand: unique symbol }>()("SignalError", {
  reason: Schema.Literals(["missing", "refused"]),
  /** The error `process.kill` threw, kept in memory for diagnosis. */
  cause: Schema.optional(Schema.Defect()),
}) {}

/**
 * Sends one signal to one OS process.
 *
 * **Details**
 *
 * A pid with no process (ESRCH) means the process has already gone, so that is success. Any other
 * refusal, such as EPERM, is a defect.
 *
 * **Gotchas**
 *
 * It checks nothing about the pid: send it only from a `lifeCell` step whose state holds that pid.
 *
 * @category combinators
 */
export const signal = (pid: number, name: Signal): Effect.Effect<void> =>
  Effect.try({
    try: () => {
      process.kill(pid, name);
    },
    catch: (cause) => SignalError.make({ reason: isMissing(cause) ? "missing" : "refused", cause }),
  }).pipe(
    Effect.catchIf(
      (error) => error.reason === "missing",
      () => Effect.void,
    ),
    Effect.orDie,
  );

// How a bounded stop ended: `refused` when the state no longer held the sampled process and no
// signal went out, `itself` when the process went before a SIGKILL, and `killed` after one.
const Ended = Schema.TaggedUnion({ refused: {}, itself: {}, killed: {} });

/**
 * Ends one process in bounded time, as an OTP supervisor ends a child: SIGTERM once, then SIGKILL
 * once if the process has not gone when its grace runs out.
 *
 * **Details**
 *
 * `sample` is what the memory sampler read: the pid, its bytes, when, and the replacement token.
 * Each signal goes out in one `life` step: the `replacing` fold for the SIGTERM, and the `killed`
 * fold for the SIGKILL. Only when that fold moved the state does `record` write the fact, given the
 * state before and after it, and then `signal` send the signal, before any other fold. The process
 * has gone once the state no longer says this pid is being replaced: its exit, the stop, or a new
 * start. The answer is `refused` when the first fold did not move, `killed` when the SIGKILL went
 * out, and `itself` otherwise.
 *
 * **Gotchas**
 *
 * No signal follows a folded exit. A process that Node has reaped but whose exit is not folded yet
 * can still get one: only a signal through Node's own child handle would close that gap.
 *
 * @category combinators
 */
export const terminate = Effect.fn("brain.terminate")(function* <E, R>(options: {
  readonly life: LifeCell;
  readonly sample: {
    readonly pid: number;
    readonly bytes: number;
    readonly at: number;
    readonly replacement: string;
  };
  readonly grace: Duration.Input;
  readonly signal: (pid: number, signal: Signal) => Effect.Effect<void, E, R>;
  readonly record: (prev: Life, next: Replacing) => Effect.Effect<void, E, R>;
}) {
  const { life, sample, record } = options;
  const { pid } = sample;

  const send = (prev: Life, next: Replacing) =>
    record(prev, next).pipe(Effect.andThen(options.signal(pid, next.signal)));

  const terming = yield* life.step(
    { type: "replacing", ...sample },
    (prev, next): next is Replacing => prev._tag !== "replacing" && next._tag === "replacing",
    send,
  );

  if (!terming) {
    return Ended.cases.refused.make({});
  }

  const gone = SubscriptionRef.changes(life.state).pipe(
    Stream.filter((s) => s._tag !== "replacing" || s.pid !== pid),
    Stream.runHead,
  );

  const ended = yield* gone.pipe(Effect.timeoutOption(options.grace));

  if (Option.isSome(ended)) {
    return Ended.cases.itself.make({});
  }

  const killing = yield* life.step(
    { type: "killed", pid },
    (prev, next): next is Replacing =>
      prev._tag === "replacing" && prev.signal === "SIGTERM" && next._tag === "replacing" && next.signal === "SIGKILL",
    send,
  );

  return killing ? Ended.cases.killed.make({}) : Ended.cases.itself.make({});
});

/**
 * Creates the local brain's durable outbox: lifecycle events saved in `home` until the project has
 * taken them.
 *
 * **Details**
 *
 * `add` checks an event and saves it. Adding the same event again changes nothing, and the same id
 * with other content fails as `id_reused`. `flush` sends the saved events in order and drops each
 * only after `send` succeeded, so an event is delivered at least once. `last` answers the newest
 * start's id, kept in a file of its own so the next run can say which start it follows. One call
 * runs at a time.
 *
 * **Gotchas**
 *
 * Every write goes to a temporary file that is synced and renamed, and then the folder is synced,
 * so a crash leaves the old file or the new one, never half of one.
 *
 * @category constructors
 */
export const brainOutbox = Effect.fn("brain.outbox")(function* (home: string) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;

  const file = path.join(home, "brain.pending.jsonl");
  const lastFile = path.join(home, "brain.last.json");
  const turn = yield* Semaphore.make(1);

  const read = Effect.gen(function* () {
    if (!(yield* fs.exists(file))) {
      return [];
    }

    const text = yield* fs.readFileString(file);

    return yield* Effect.forEach(
      Arr.filter(Str.split(text, "\n"), Boolean),
      (row) => Schema.decodeEffect(Schema.fromJsonString(PendingEvent))(row),
      { concurrency: 1 },
    );
  }).pipe(Effect.mapError((cause) => BrainError.make({ reason: "bad_row", cause })));

  const durableWrite = Effect.fnUntraced(
    function* (target: string, text: string) {
      yield* fs.makeDirectory(home, { recursive: true });
      const pending = `${target}.tmp`;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fs.open(pending, { flag: "w", mode: 0o600 });
          yield* file.writeAll(new TextEncoder().encode(text));
          yield* file.sync;
        }),
      );
      yield* fs.rename(pending, target);
      // Node's FileSystem provider can open and sync a directory, so no raw fs adapter is needed.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const folder = yield* fs.open(home, { flag: "r" });
          yield* folder.sync;
        }),
      );
    },
    Effect.mapError((cause) => BrainError.make({ reason: "storage", cause })),
  );

  const write = (rows: ReadonlyArray<typeof BrainEvent.Type>) =>
    durableWrite(
      file,
      Arr.join(
        Arr.map(rows, (row) => JSON.stringify(row)),
        "\n",
      ) + (rows.length ? "\n" : ""),
    );
  const last = Effect.fnUntraced(function* () {
    const pending = Arr.last(Arr.filter(yield* read, (event) => event._tag === "started"));

    if (Option.isSome(pending)) {
      return pending.value.start;
    }

    return yield* Effect.gen(function* () {
      if (!(yield* fs.exists(lastFile))) {
        return null;
      }

      return yield* Schema.decodeEffect(Schema.fromJsonString(Schema.NonEmptyString))(
        yield* fs.readFileString(lastFile),
      );
    }).pipe(Effect.mapError((cause) => BrainError.make({ reason: "bad_row", cause })));
  });

  const saveLast = Effect.fnUntraced(function* () {
    const start = yield* last();

    if (start === null) {
      return;
    }

    yield* durableWrite(lastFile, Formatter.formatJson(start));
  });

  return {
    last: last().pipe(turn.withPermit),
    pending: read.pipe(turn.withPermit),
    add: Effect.fn("brain.pending")(function* (raw: unknown) {
      yield* Effect.gen(function* () {
        const event = yield* Schema.decodeUnknownEffect(PendingEvent)(raw).pipe(
          Effect.mapError((cause) => BrainError.make({ reason: "bad_row", cause })),
        );

        const rows = yield* read;
        const old = Arr.findFirst(rows, (row) => row.id === event.id);

        if (Option.isSome(old)) {
          if (Formatter.formatJson(old.value) !== Formatter.formatJson(event)) {
            return yield* BrainError.make({ reason: "id_reused" });
          }

          return;
        }

        yield* write([...rows, event]);

        if (event._tag === "started") {
          yield* saveLast();
        }
      }).pipe(turn.withPermit);
    }),
    flush: Effect.fn("brain.flush")(function* <E, R>(
      send: (event: typeof BrainEvent.Type) => Effect.Effect<unknown, E, R>,
    ) {
      yield* Effect.gen(function* () {
        const rows = [...(yield* read)];
        yield* saveLast();

        for (const row of [...rows]) {
          yield* send(row);
          rows.shift();
          yield* write(rows);
        }
      }).pipe(turn.withPermit);
    }),
  };
});
