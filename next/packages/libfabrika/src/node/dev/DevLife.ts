/**
 * The local runtime's life as one tea machine. The driver in `dev.ts` sends it what the runtime
 * reports and reads the state back; nothing here does input or output.
 */
import { Machine } from "@demlik/tea/effect";
import * as Schema from "effect/Schema";

// Zero is how the local runtime says it has no control socket, so a known port is never zero.
const Port = Schema.Int.check(Schema.makeFilter((port: number) => port !== 0));

const Listener = Schema.TaggedUnion({
  absent: {},
  known: { port: Port },
});

type Listener = typeof Listener.Type;

// An exit leaves a replacement waiting for its listener; the token names the driver's handle.
const Replacement = Schema.TaggedUnion({
  none: {},
  pending: { id: Schema.String },
});

type Replacement = typeof Replacement.Type;

const Session = Schema.Struct({
  start: Schema.String,
  after: Schema.NullOr(Schema.String),
  build: Schema.String,
});

// The last signal a replace sent the old process: SIGTERM first, SIGKILL once its grace ran out.
const Signal = Schema.Literals(["SIGTERM", "SIGKILL"]);

/**
 * Schema for an OS process id: a whole number above zero.
 *
 * **Details**
 *
 * Zero and a negative number are not one process: `kill` sends to a whole process group for them.
 * The state holds only this, and a start that reports anything else is refused, so no signal can
 * reach a group.
 *
 * @category schemas
 */
export const Pid = Schema.Int.check(Schema.isGreaterThan(0));

const isPid = Schema.is(Pid);

/**
 * Schema for where the local runtime stands: `starting` and `listening` before its first start,
 * `spawned` and `online` while a process runs, `replacing` while a process that grew too big is
 * ended, `exited` and `waiting` between an exit and its replacement, `braked` when restarting gave
 * up, and `stopping` then `stopped` on the way out.
 *
 * **Details**
 *
 * A state holds a pid only while a process runs or is being ended, and it keeps the control
 * socket's port across an exit. `replacement` is `pending` from a replace or an exit until a
 * listener is heard again; in `replacing` it can only be pending. `replacing` also holds the bytes
 * the memory sampler saw, when it saw them, and the last signal sent.
 *
 * @category schemas
 */
export const DevState = Schema.TaggedUnion({
  starting: { last: Schema.NullOr(Schema.String) },
  listening: { last: Schema.NullOr(Schema.String), port: Port },
  spawned: { session: Session, pid: Pid, replacement: Replacement },
  online: { session: Session, pid: Pid, port: Port, replacement: Replacement },
  replacing: {
    session: Session,
    pid: Pid,
    listener: Listener,
    replacement: Replacement.cases.pending,
    bytes: Schema.Int,
    at: Schema.Finite,
    signal: Signal,
  },
  exited: { session: Session, listener: Listener, replacement: Replacement },
  waiting: {
    session: Session,
    listener: Listener,
    replacement: Replacement,
    until: Schema.Finite,
    reason: Schema.String,
  },
  braked: { start: Schema.NullOr(Schema.String), listener: Listener, reason: Schema.String },
  stopping: { start: Schema.NullOr(Schema.String), listener: Listener, replacement: Replacement },
  stopped: { listener: Listener },
});

type DevState = typeof DevState.Type;

/**
 * Schema for what the dev loop tells its life machine, each made with `DevMsg.cases.<name>.make`.
 *
 * @stability unstable
 * @category schemas
 */
export const DevMsg = Schema.TaggedUnion({
  listened: { port: Schema.Int },
  started: {
    start: Schema.String,
    pid: Pid,
    build: Schema.String,
    at: Schema.Finite,
  },
  exited: { replacement: Schema.String },
  waiting: {
    until: Schema.Finite,
    reason: Schema.String,
  },
  braked: { reason: Schema.String },
  stop: {},
  stopped: {},
  replacing: {
    // The pid the memory sampler read, so a sample of an older process replaces nothing.
    pid: Pid,
    replacement: Schema.String,
    bytes: Schema.Int,
    at: Schema.Finite,
  },
  killed: { pid: Pid },
});

type Ctx = { readonly last: string | null };

const none = Replacement.cases.none.make({});

const heard = (port: number | null): Listener => {
  if (port === null || port === 0) {
    return Listener.cases.absent.make({});
  }

  return Listener.cases.known.make({ port });
};

/**
 * Returns the control socket's port, or null when none is known. The port is kept after an exit.
 *
 * @category getters
 */
export const address = (s: DevState): number | null => {
  if (s._tag === "listening" || s._tag === "online") {
    return s.port;
  }

  if (s._tag === "starting" || s._tag === "spawned") {
    return null;
  }

  return s.listener._tag === "known" ? s.listener.port : null;
};

/**
 * Returns the pid of the live process the memory sampler may read, or null when none runs.
 *
 * @category getters
 */
export const target = (s: DevState): number | null => {
  if (s._tag === "spawned" || s._tag === "online") {
    return s.pid;
  }

  return null;
};

const replacement = (s: DevState): Replacement => {
  if (s._tag === "starting" || s._tag === "listening") {
    return none;
  }

  if (s._tag === "braked" || s._tag === "stopped") {
    return none;
  }

  return s.replacement;
};

/**
 * Returns the id of the replacement still waiting for its listener, or null when none waits.
 *
 * @category getters
 */
export const pending = (s: DevState): string | null => {
  const r = replacement(s);

  return r._tag === "pending" ? r.id : null;
};

/**
 * Returns the port a control call may dial: the listener of a live process with no replacement
 * pending, or null everywhere else.
 *
 * **Details**
 *
 * It equals `address` in `listening` and in `online` with no replacement pending. A process being
 * replaced, or a replacement that started before its listener, keeps its old port in `address`, and
 * that port is never dialed.
 *
 * @category getters
 */
export const reachable = (s: DevState): number | null =>
  pending(s) === null && (s._tag === "listening" || s._tag === "online") ? s.port : null;

/**
 * Returns true while a replacement is pending and may still come up: from a replace or an exit
 * until its listener, a brake or a stop.
 *
 * @category getters
 */
export const recovering = (s: DevState): boolean => pending(s) !== null && s._tag !== "stopping";

/**
 * Returns the latest start of this runtime, the one its exit, restart, brake and stop events name.
 * Null before the first start and after the stop.
 *
 * @category getters
 */
export const latest = (s: DevState): string | null => {
  if (s._tag === "starting" || s._tag === "listening" || s._tag === "stopped") {
    return null;
  }

  if (s._tag === "braked" || s._tag === "stopping") {
    return s.start;
  }

  return s.session.start;
};

const active = (s: DevState) => {
  const tag = s._tag;

  return tag !== "braked" && tag !== "stopping" && tag !== "stopped";
};

/**
 * The local runtime's life as a tea machine with no Cmds: the driver does the work and sends what
 * happened.
 *
 * **Details**
 *
 * It starts in `starting` with the last start an earlier run saved, so this run's first start can
 * name the one it follows. A start is ignored once the machine is `braked`, `stopping` or
 * `stopped`, and a start whose pid is not a whole number above zero is refused. A replacement counts
 * as up when its listener is heard, not when its process starts. `replacing` comes only from a
 * running process whose pid is the one its Msg names, and `killed` only moves a replace of that pid
 * from SIGTERM to SIGKILL; the replaced process leaves `replacing` by its exit, like any other.
 *
 * @category machines
 */
export const devLife = Machine.make({
  model: DevState,
  msg: DevMsg,
  cmds: [],
  types: { ctx: {} as Ctx },
  init: (_saved, ctx) => [DevState.cases.starting.make({ last: ctx.last }), []],
  update: {
    listened: (s, m) => {
      const listener = heard(m.port);

      if (s._tag === "starting" || s._tag === "listening") {
        return [
          listener._tag === "known"
            ? DevState.cases.listening.make({ last: s.last, port: listener.port })
            : DevState.cases.starting.make({ last: s.last }),
          [],
        ];
      }

      // The listener, not the start, completes a replacement.
      if (s._tag === "spawned" || s._tag === "online") {
        const { session, pid } = s;

        return [
          listener._tag === "known"
            ? DevState.cases.online.make({ session, pid, port: listener.port, replacement: none })
            : DevState.cases.spawned.make({ session, pid, replacement: none }),
          [],
        ];
      }

      if (s._tag === "exited" || s._tag === "waiting" || s._tag === "stopping") {
        return [{ ...s, listener, replacement: none }, []];
      }

      if (s._tag === "braked") {
        return [{ ...s, listener }, []];
      }

      // A process being replaced already listened, and its replacement has not started: only its
      // exit moves the replace on. A stopped runtime keeps nothing.
      return [s, []];
    },
    started: (s, m) => {
      if (!active(s) || !isPid(m.pid)) {
        return [s, []];
      }

      const after = s._tag === "starting" || s._tag === "listening" ? s.last : latest(s);
      const session = { start: m.start, after, build: m.build };
      const port = address(s);
      const kept = replacement(s);

      return [
        port === null
          ? DevState.cases.spawned.make({ session, pid: m.pid, replacement: kept })
          : DevState.cases.online.make({ session, pid: m.pid, port, replacement: kept }),
        [],
      ];
    },
    exited: (s, m) => {
      if (s._tag !== "spawned" && s._tag !== "online" && s._tag !== "replacing") {
        return [s, []];
      }

      return [
        DevState.cases.exited.make({
          session: s.session,
          listener: heard(address(s)),
          replacement: Replacement.cases.pending.make({ id: m.replacement }),
        }),
        [],
      ];
    },
    waiting: (s, m) => {
      if (s._tag !== "exited") {
        return [s, []];
      }

      const { session, listener } = s;

      return [
        DevState.cases.waiting.make({
          session,
          listener,
          replacement: s.replacement,
          until: m.until,
          reason: m.reason,
        }),
        [],
      ];
    },
    braked: (s, m) => {
      if (!active(s)) {
        return [s, []];
      }

      return [
        DevState.cases.braked.make({
          start: latest(s),
          listener: heard(address(s)),
          reason: m.reason,
        }),
        [],
      ];
    },
    stop: (s) => {
      if (s._tag === "stopping" || s._tag === "stopped") {
        return [s, []];
      }

      return [
        DevState.cases.stopping.make({
          start: latest(s),
          listener: heard(address(s)),
          replacement: replacement(s),
        }),
        [],
      ];
    },
    stopped: (s) => {
      if (s._tag !== "stopping") {
        return [s, []];
      }

      return [DevState.cases.stopped.make({ listener: s.listener }), []];
    },
    replacing: (s, m) => {
      // Only the running process the sample read is replaced, and only once per start: `target` is
      // null from here on.
      if ((s._tag !== "spawned" && s._tag !== "online") || s.pid !== m.pid) {
        return [s, []];
      }

      return [
        DevState.cases.replacing.make({
          session: s.session,
          pid: s.pid,
          listener: heard(address(s)),
          replacement: Replacement.cases.pending.make({ id: m.replacement }),
          bytes: m.bytes,
          at: m.at,
          signal: "SIGTERM",
        }),
        [],
      ];
    },
    killed: (s, m) => {
      // Only a SIGTERM of this very pid moves on to its SIGKILL.
      if (s._tag !== "replacing" || s.pid !== m.pid || s.signal !== "SIGTERM") {
        return [s, []];
      }

      return [{ ...s, signal: "SIGKILL" }, []];
    },
  },
});
