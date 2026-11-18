// Ticket 766, today's tooling (0113, 0410 as amended on 2026-11-15, following next/'s rules by 0033):
// the typecheck lock, a label file holding its holder's pid, after Mercurial 7.2.4's
// `mercurial/lock.py`. `judge` is pure; LocksFile.layer runs here on a FileSystem kept in memory and
// on ProcessesTest, so no law takes a real lock, starts a process or sends a signal. A "kill" here
// is the table saying a pid is gone while that holder's scope is never closed, as SIGKILL runs no
// finalizer (0061).
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import {
  ByteSize,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  PlatformError,
  Schema,
  Scope,
} from "effect";
import { TestClock, TestConsole } from "effect/testing";
import { type Held, type LockError, Locks } from "./typecheck/Locks.ts";
import * as LocksFile from "./typecheck/LocksFile.ts";
import { judge, Liveness, Seen } from "./typecheck/Look.ts";
import * as ProcessesTest from "./typecheck/ProcessesTest.ts";

// ---------------------------------------------------------------- judge

// The label's and the child file's mtime, in ms.
const AT = 1_800_000_000_000;
// ps reads a start time to the second, so the plan gives 2 s of slack; generated starts stay at
// least 1 s away from that edge on either side, so no law here pins `<` against `<=`.
const SLACK = 2_000;

/** How a pid stands when a waiter looks: gone, started before its file, after it, or with no start ps can read. */
const Standing = Schema.TaggedUnion({
  gone: {},
  before: { startedAt: Schema.Number },
  after: { startedAt: Schema.Number },
  unknown: {},
});

type Standing = typeof Standing.Type;

const Offset = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100_000 }));

const StandingInput = Schema.TaggedUnion({
  gone: {},
  before: { offset: Offset },
  after: { offset: Offset },
  unknown: {},
});

const standing = (input: typeof StandingInput.Type): Standing =>
  StandingInput.match(input, {
    gone: () => Standing.cases.gone.make({}),
    before: ({ offset }) => Standing.cases.before.make({ startedAt: AT + SLACK - 1_000 - offset }),
    after: ({ offset }) => Standing.cases.after.make({ startedAt: AT + SLACK + 1_000 + offset }),
    unknown: () => Standing.cases.unknown.make({}),
  });

/** A label as a waiter can find it: absent, empty, unreadable, or one of the original pids. */
const Label = Schema.TaggedUnion({
  absent: {},
  empty: { text: Schema.Literals(["", "\n"]) },
  junk: { text: Schema.Literals(["abc\n", "12 34\n", "-5\n", "0x1f\n", "0\n", "4101x\n"]) },
  pid: { pid: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 199 })) },
});

const Child = Schema.UndefinedOr(Schema.Int.check(Schema.isBetween({ minimum: 300, maximum: 399 })));

const toLiveness = (s: Standing): Liveness =>
  Standing.match(s, {
    gone: () => Liveness.cases.gone.make({}),
    unknown: () => Liveness.cases.running.make({}),
    before: ({ startedAt }) => Liveness.cases.running.make({ startedAt }),
    after: ({ startedAt }) => Liveness.cases.running.make({ startedAt }),
  });

const holds = Standing.isAnyOf(["before", "unknown"]);

describe("T766 judge reads one look at the typecheck lock, today's tooling", () => {
  const seen = new Set<string>();
  let coverageRegistered = false;
  // N2. Plants: read an empty label as held; drop the start-time check.
  it.prop(
    "property: held exactly when the label's or the child's pid runs and started before its file; else stale, or free with no label",
    { label: Label, child: Child, labelPid: StandingInput, childPid: StandingInput },
    ({ label, child: childValue, labelPid: labelInput, childPid: childInput }, ctx) => {
      if (!coverageRegistered) {
        coverageRegistered = true;
        ctx.onTestFinished(() =>
          expect([...seen].toSorted()).toEqual(
            [
              "free",
              "held by child",
              "held by label",
              "stale empty",
              "stale gone",
              "stale reused",
              "stale unreadable",
            ].toSorted(),
          ),
        );
      }

      const child = childValue === undefined ? undefined : { pid: childValue, text: `${childValue}\n` };
      const labelPid = standing(labelInput),
        childPid = standing(childInput);
      const liveness = (pid: number) =>
        Label.guards.pid(label) && pid === label.pid
          ? toLiveness(labelPid)
          : child !== undefined && pid === child.pid
            ? toLiveness(childPid)
            : Liveness.cases.gone.make({});
      const got = judge({
        label: Label.guards.absent(label)
          ? Option.none()
          : Option.some({ text: Label.guards.pid(label) ? `${label.pid}\n` : label.text, at: AT }),
        child: child === undefined ? Option.none() : Option.some({ text: child.text, at: AT }),
        liveness,
      });
      // Held by the child where its pid holds, else stale for `reason`.
      const byChild = (reason: "empty" | "unreadable" | "gone" | "reused"): Seen =>
        child !== undefined && holds(childPid)
          ? Seen.cases.held.make({ pid: child.pid, by: "child" })
          : Seen.cases.stale.make({ reason });
      const want = Label.match(label, {
        absent: () => Seen.cases.free.make({}),
        empty: () => byChild("empty"),
        junk: () => byChild("unreadable"),
        pid: ({ pid }) =>
          holds(labelPid)
            ? Seen.cases.held.make({ pid, by: "label" })
            : byChild(Standing.guards.gone(labelPid) ? "gone" : "reused"),
      });
      seen.add(
        Seen.match(want, { free: () => "free", held: (h) => `held by ${h.by}`, stale: (s) => `stale ${s.reason}` }),
      );
      expect(got).toEqual(want);
    },
    { arbitrary: { runs: runsFor({ fast: 200, full: 1_000 }) } },
  );
});

// ---------------------------------------------------------------- a disk in memory

type File = { readonly text: string; readonly at: number };

/** The files the lock writes, by path, and the disk's own clock, which stamps each write's mtime. */
type Disk = { readonly files: Map<string, File>; now: number };

const disk = (): Disk => ({ files: new Map(), now: AT });

/** Runs around each operation, before it (`ok` undefined) and after it, so a law can order two takers. */
type Hook = (op: string, path: string, ok: boolean | undefined) => Effect.Effect<void>;

const fail = (tag: "NotFound" | "AlreadyExists", method: string, path: string) =>
  Effect.fail(PlatformError.systemError({ _tag: tag, module: "FileSystem", method, pathOrDescriptor: path }));

const info = (f: File): FileSystem.File.Info => ({
  type: "File",
  mtime: Option.some(new Date(f.at)),
  atime: Option.some(new Date(f.at)),
  birthtime: Option.some(new Date(f.at)),
  dev: 0n,
  ino: Option.none(),
  mode: 0o644,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: ByteSize.fromInputUnsafe(new TextEncoder().encode(f.text).length),
  blksize: Option.none(),
  blocks: Option.none(),
});

/**
 * Effect's FileSystem over `d`, each step atomic as on a local disk: `link` fails with
 * AlreadyExists when its target is there, as POSIX link(2) does with EEXIST, and a write with flag
 * `wx` does the same. Any method not here fails as FileSystem.makeNoop's do.
 */
const memory = (d: Disk, hook: Hook = () => Effect.void): Layer.Layer<FileSystem.FileSystem> => {
  const around = <A, E>(op: string, path: string, body: () => Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      yield* hook(op, path, undefined);
      const exit = yield* Effect.exit(Effect.suspend(body));
      yield* hook(op, path, Exit.isSuccess(exit));
      return yield* exit;
    });
  const read = (method: string, path: string) =>
    around(method, path, () => {
      const f = d.files.get(path);
      return f === undefined ? fail("NotFound", method, path) : Effect.succeed(f.text);
    });
  const write = (method: string, path: string, text: string, flag: string | undefined) =>
    around(method, path, () => {
      if (flag === "wx" && d.files.has(path)) {
        return fail("AlreadyExists", method, path);
      }

      d.files.set(path, { text, at: d.now });
      return Effect.void;
    });
  const stat = (method: string, path: string) =>
    around(method, path, () => {
      const f = d.files.get(path);
      return f === undefined ? fail("NotFound", method, path) : Effect.succeed(info(f));
    });
  return FileSystem.layerNoop({
    exists: (path) => around("exists", path, () => Effect.succeed(d.files.has(path))),
    readFileString: (path) => read("readFileString", path),
    readFile: (path) => Effect.map(read("readFile", path), (text) => new TextEncoder().encode(text)),
    writeFileString: (path, text, options) => write("writeFileString", path, text, options?.flag),
    writeFile: (path, data, options) => write("writeFile", path, new TextDecoder().decode(data), options?.flag),
    stat: (path) => stat("stat", path),
    lstat: (path) => stat("lstat", path),
    link: (from, to) =>
      around("link", to, () => {
        const f = d.files.get(from);

        if (f === undefined) {
          return fail("NotFound", "link", from);
        }

        if (d.files.has(to)) {
          return fail("AlreadyExists", "link", to);
        }

        d.files.set(to, f);
        return Effect.void;
      }),
    rename: (from, to) =>
      around("rename", to, () => {
        const f = d.files.get(from);

        if (f === undefined) {
          return fail("NotFound", "rename", from);
        }

        d.files.delete(from);
        d.files.set(to, f);
        return Effect.void;
      }),
    remove: (path, options) =>
      around("remove", path, () => {
        if (!d.files.has(path)) {
          return options?.force === true ? Effect.void : fail("NotFound", "remove", path);
        }

        d.files.delete(path);
        return Effect.void;
      }),
  });
};

const LOCK = "/tmp/tc-law/typecheck.lock";

/** Process `pid`'s view of the lock: LocksFile.layer over the shared disk and process table. */
const locksFor = (d: Disk, table: ProcessesTest.Table, pid: number, hook?: Hook) =>
  Layer.provide(LocksFile.layer, Layer.mergeAll(memory(d, hook), ProcessesTest.layer(table, pid), Path.layer));

/**
 * Lets every taker run its steps and every waiter poll a few times: the layer looks again every
 * 250 ms, and a disk that yields between steps needs the scheduler's turns too.
 */
const settle = Effect.gen(function* () {
  for (let step = 0; step < 8; step += 1) {
    for (let turn = 0; turn < 100; turn += 1) {
      yield* Effect.yieldNow;
    }

    yield* TestClock.adjust("250 millis");
  }
});

/**
 * Holder `pid` asks for the lock in a scope of its own, which only the law closes. `onHeld` runs
 * once it holds, as a wrapper's first command does.
 */
const take = (
  d: Disk,
  table: ProcessesTest.Table,
  pid: number,
  got: Map<number, Held>,
  hook?: Hook,
  onHeld: (held: Held) => Effect.Effect<void, LockError> = () => Effect.void,
) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const fiber = yield* Effect.forkChild(
      Effect.gen(function* () {
        const held = yield* (yield* Locks).hold(LOCK).pipe(Scope.provide(scope));
        got.set(pid, held);
        yield* onHeld(held);
      }).pipe(Effect.provide(locksFor(d, table, pid, hook))),
    );
    return { scope, fiber };
  });

// ---------------------------------------------------------------- the walk

// Three holders, by pid; each holder's running command gets its own pid. An old 1419 script (pid
// OLD) can write its pid over the label, as the plan's "Old branches beside the new lock" says.
const HOLDERS = [501, 502, 503] as const;
const commandPid = (pid: number) => pid + 100;
const OLD = 700;

type State = "idle" | "waiting" | "holding" | "dead";

type World = {
  readonly disk: Disk;
  readonly table: ProcessesTest.Table;
  readonly state: Map<number, State>;
  readonly child: Map<number, "none" | "running" | "ended">;
  readonly got: Map<number, Held>;
  readonly scopes: Map<number, Scope.Closeable>;
  readonly fibers: Map<number, Fiber.Fiber<void, unknown>>;
  old: "none" | "running" | "ended";
  /**
   * The holder whose label the old script wrote over. It runs on beside the next one, the cost the
   * plan's table accepts, so the one-holder law leaves it out.
   */
  readonly displaced: Set<number>;
  /** What each command saw that breaks a law, in words; a run passes with none. */
  readonly broken: Array<string>;
  /** The kinds of moves that ran, for the coverage check. */
  readonly ran: Set<string>;
};

/** A move of the walk. `run` queues its Effect on the world; the law runs it, then settles. */
type Move = {
  readonly check: (world: World) => boolean;
  readonly run: (world: World, queued: { act: Effect.Effect<void> | undefined }) => void;
  readonly toString: () => string;
};

const move = (name: string, check: (w: World) => boolean, act: (w: World) => Effect.Effect<void>): Move => ({
  check,
  run: (w, r) => {
    w.ran.add(name.split(" ")[0]!);
    r.act = act(w);
  },
  toString: () => name,
});

const takeMove = (pid: number) =>
  move(
    `take ${pid}`,
    (w) => w.state.get(pid) === "idle",
    (w) =>
      Effect.gen(function* () {
        const { scope, fiber } = yield* take(w.disk, w.table, pid, w.got, () => Effect.yieldNow);
        w.scopes.set(pid, scope);
        w.fibers.set(pid, fiber);
        w.state.set(pid, "waiting");
      }),
  );

const releaseMove = (pid: number) =>
  move(
    `release ${pid}`,
    (w) => w.state.get(pid) === "holding",
    (w) =>
      Effect.gen(function* () {
        const before = w.disk.files.get(LOCK)?.text;
        yield* Scope.close(w.scopes.get(pid)!, Exit.void);
        w.got.delete(pid);
        w.state.set(pid, "idle");
        w.displaced.delete(pid);
        const after = w.disk.files.get(LOCK)?.text;

        if (before === `${pid}\n` && after !== undefined) {
          w.broken.push(`release ${pid} left its own label`);
        }

        if (before !== undefined && before !== `${pid}\n` && after !== before) {
          w.broken.push(`release ${pid} removed a label naming another pid (${before.trim()})`);
        }
      }),
  );

/**
 * Interrupts waiter `pid`, as Ctrl-C or SIGTERM does to a typecheck that waits, and lets the clock
 * run: a waiter that cannot be interrupted would hold its shell for good.
 */
const stop = (w: World, pid: number, after: string) =>
  Effect.gen(function* () {
    const stopping = yield* Effect.forkChild(Fiber.interrupt(w.fibers.get(pid)!));
    yield* settle;

    if (stopping.pollUnsafe() === undefined) {
      w.broken.push(`after ${after}: interrupted waiter ${pid} never ended`);
    }

    if (w.got.has(pid)) {
      w.state.set(pid, "holding");
    } else {
      w.state.set(pid, "idle");
    }
  });

const cancelMove = (pid: number) =>
  move(
    `cancel ${pid}, a waiter`,
    (w) => w.state.get(pid) === "waiting",
    (w) => stop(w, pid, `cancel ${pid}`),
  );

const killMove = (pid: number, withChild: boolean) =>
  move(
    `kill ${pid}${withChild ? " with its command running" : ""}`,
    (w) => w.state.get(pid) === "holding" && w.child.get(pid) === "none",
    (w) =>
      Effect.gen(function* () {
        if (withChild) {
          w.table.running.set(commandPid(pid), w.disk.now - 1_000);
          yield* Effect.orDie(w.got.get(pid)!.running(Option.some(commandPid(pid))));
          w.child.set(pid, "running");
        }

        // SIGKILL: the pid is gone and its scope is never closed.
        w.table.running.delete(pid);
        w.state.set(pid, "dead");
      }),
  );

const childEndsMove = (pid: number) =>
  move(
    `end ${commandPid(pid)}, the command of dead ${pid}`,
    (w) => w.child.get(pid) === "running",
    (w) =>
      Effect.sync(() => {
        w.table.running.delete(commandPid(pid));
        w.child.set(pid, "ended");
      }),
  );

/**
 * A holder, displaced or not, starts a command and sees it end, as the program does at each command.
 * A displaced holder's label is gone, so its calls must leave the next holder's `.child` alone.
 */
const commandMove = (pid: number) =>
  move(
    `command of ${pid} starts and ends`,
    (w) => w.state.get(pid) === "holding",
    (w) =>
      Effect.gen(function* () {
        w.table.running.set(commandPid(pid), w.disk.now - 1_000);
        yield* Effect.orDie(w.got.get(pid)!.running(Option.some(commandPid(pid))));
        w.table.running.delete(commandPid(pid));
        yield* Effect.orDie(w.got.get(pid)!.running(Option.none()));
      }),
  );

const reuseMove = (pid: number) =>
  move(
    `reuse ${pid}, by a process started after its label`,
    (w) => w.state.get(pid) === "dead" && !w.table.running.has(pid),
    (w) =>
      Effect.sync(() => {
        w.table.running.set(pid, w.disk.now);
      }),
  );

const oldWritesMove = (pid: number) =>
  move(
    `old writes ${OLD} over ${pid}'s label`,
    (w) => w.old === "none" && w.state.get(pid) === "holding",
    (w) =>
      Effect.sync(() => {
        w.table.running.set(OLD, w.disk.now - 1_000);
        w.disk.files.set(LOCK, { text: `${OLD}\n`, at: w.disk.now });
        w.old = "running";
        w.displaced.add(pid);
      }),
  );

const oldEndsMove = move(
  `old ${OLD} ends`,
  (w) => w.old === "running",
  (w) =>
    Effect.sync(() => {
      w.table.running.delete(OLD);
      w.old = "ended";
    }),
);

const Holder = Schema.Literals(HOLDERS);

const MoveInput = Schema.TaggedUnion({
  take: { pid: Holder },
  release: { pid: Holder },
  cancel: { pid: Holder },
  kill: { pid: Holder, withChild: Schema.Boolean },
  end: { pid: Holder },
  command: { pid: Holder },
  reuse: { pid: Holder },
  oldWrites: { pid: Holder },
  oldEnds: {},
});

const Moves = Schema.Array(MoveInput).check(Schema.isMaxLength(80));

const moveFrom = (input: typeof MoveInput.Type): Move =>
  MoveInput.match(input, {
    take: ({ pid }) => takeMove(pid),
    release: ({ pid }) => releaseMove(pid),
    cancel: ({ pid }) => cancelMove(pid),
    kill: ({ pid, withChild }) => killMove(pid, withChild),
    end: ({ pid }) => childEndsMove(pid),
    command: ({ pid }) => commandMove(pid),
    reuse: ({ pid }) => reuseMove(pid),
    oldWrites: ({ pid }) => oldWritesMove(pid),
    oldEnds: () => oldEndsMove,
  });

/** After a settle: who holds now, and what that breaks. */
const look = (w: World, after: string) => {
  for (const pid of HOLDERS) {
    if (w.state.get(pid) === "waiting" && w.got.has(pid)) {
      w.state.set(pid, "holding");
    }
  }

  // A live holder of the new lock: one that holds, or a dead one whose command still runs.
  const live = HOLDERS.filter(
    (pid) =>
      !w.displaced.has(pid) &&
      (w.state.get(pid) === "holding" || (w.state.get(pid) === "dead" && w.child.get(pid) === "running")),
  );
  const waiting = HOLDERS.filter((pid) => w.state.get(pid) === "waiting");
  const oldHolds = w.old === "running" && w.disk.files.get(LOCK)?.text === `${OLD}\n`;

  if (live.length > 1) {
    w.broken.push(`after ${after}: two live holders, ${live.join(" and ")}`);
  }

  // What a waiter must wait behind: a holder whose label stands, or a dead one whose command runs.
  const blocking = HOLDERS.filter(
    (pid) =>
      (w.state.get(pid) === "holding" && !w.displaced.has(pid)) ||
      (w.state.get(pid) === "dead" && w.child.get(pid) === "running"),
  );

  if (waiting.length > 0 && blocking.length === 0 && !oldHolds) {
    w.broken.push(`after ${after}: ${waiting.join(" and ")} still wait on a lock nobody alive holds`);
  }
};

const walk = (cmds: Iterable<Move>) => {
  const w: World = {
    disk: disk(),
    table: ProcessesTest.table([]),
    state: new Map(HOLDERS.map((pid) => [pid, "idle"])),
    child: new Map(HOLDERS.map((pid) => [pid, "none"])),
    got: new Map(),
    scopes: new Map(),
    fibers: new Map(),
    old: "none",
    displaced: new Set(),
    broken: [],
    ran: new Set(),
  };

  for (const pid of HOLDERS) {
    w.table.running.set(pid, AT - 60_000);
  }

  return Effect.gen(function* () {
    const queued: { act: Effect.Effect<void> | undefined } = { act: undefined };

    for (const c of cmds) {
      if (!c.check(w)) {
        continue;
      }

      c.run(w, queued);
      w.disk.now += 5_000;
      yield* queued.act ?? Effect.void;
      yield* settle;
      look(w, c.toString());
    }

    for (const pid of HOLDERS) {
      if (w.state.get(pid) === "waiting") {
        yield* stop(w, pid, "the walk's end");
      }
    }

    return w;
  }).pipe(Effect.provide(Layer.mergeAll(TestClock.layer(), TestConsole.layer)));
};

describe("T766 LocksFile keeps one holder through takes, releases, kills and reused pids, today's tooling", () => {
  const ran = new Set<string>();
  let coverageRegistered = false;
  // N3. Plants: release another pid's label; break without rereading; make a waiter uninterruptible;
  // let a command's start or end write or remove `.child` whatever the label names.
  // Effect's Schema array shrinks by removing blocks and shrinking fields. The existing check(world)
  // still decides whether each generated move runs, including after a sequence has been shrunk.
  it.effect.prop(
    "property: never two live holders, a gone holder's lock is taken at once, and a release removes only its own label",
    { moves: Moves },
    ({ moves }, ctx) => {
      if (!coverageRegistered) {
        coverageRegistered = true;
        ctx.onTestFinished(() =>
          expect([...ran].toSorted()).toEqual(
            ["cancel", "command", "end", "kill", "old", "release", "reuse", "take"].toSorted(),
          ),
        );
      }

      return Effect.map(walk(moves.map(moveFrom)), (world) => {
        for (const name of world.ran) {
          ran.add(name);
        }

        expect(world.broken, world.broken.join("\n")).toEqual([]);
      });
    },
    { arbitrary: { runs: runsFor({ fast: 100, full: 300 }), size: 80 } },
  );

  // T766: the seven-move counterexample found by N3 at full depth. The old-overlap allowance
  // excludes displaced 501, but both 502's child and 503 are new, undisplaced holders.
  it.effect("pinned: T766 a displaced holder leaves the next holder's running-child guard intact", () =>
    Effect.map(
      walk([
        takeMove(501),
        takeMove(502),
        oldWritesMove(501),
        oldEndsMove,
        takeMove(503),
        killMove(502, true),
        releaseMove(501),
      ]),
      (world) => {
        expect(world.broken, world.broken.join("\n")).toEqual([]);
        expect(world.got.has(503), "503 waits while 502's command still runs").toBe(false);
      },
    ),
  );

  // T766: the review's walk for the command calls. 501 is displaced by the old script, 502 takes the
  // lock and dies with command 602 running, and 501 then starts and ends a command: that must leave
  // 502's `.child` in place, so 503 waits behind 602.
  it.effect(
    "pinned: T766 a displaced holder's command start and end leave the next holder's running-child guard intact",
    () =>
      Effect.map(
        walk([
          takeMove(501),
          takeMove(502),
          oldWritesMove(501),
          oldEndsMove,
          killMove(502, true),
          commandMove(501),
          takeMove(503),
        ]),
        (world) => {
          expect(world.broken, world.broken.join("\n")).toEqual([]);
          expect(world.got.has(503), "503 waits while 502's command still runs").toBe(false);
        },
      ),
  );

  // T766: the breaker's two removes (`.child` and the label), ordered by a gate. Breaker 602 is held
  // right after its first remove under `.break`; taker 603 then runs, and if the label is already
  // gone it takes the lock and starts command 703. When the gate opens and 603's wrapper is killed,
  // 602 must not take the lock while 703 runs: 603's `.child` has to outlive the breaker's second
  // remove. A scenario, not a property: N3's walk has no gate between two steps of one breaker.
  // Plant: remove the label first and `.child` second, as the first build did: both hold.
  it("scenario: a take between the breaker's two removes keeps the taker's running-child guard", () =>
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
    Effect.runPromise(
      Effect.gen(function* () {
        const d = disk();
        const table = ProcessesTest.table([]);
        const [breaker, taker, gone, command] = [602, 603, 8, 703];
        table.running.set(breaker, AT - 60_000);
        table.running.set(taker, AT - 60_000);
        d.files.set(LOCK, { text: `${gone}\n`, at: AT - 30_000 });
        const gate = yield* Deferred.make<void>();
        // The breaker: its first removal of the label or of `.child` is followed by a wait.
        const forBreaker = (): Hook => {
          let waited = false;
          return (op, path, ok) =>
            Effect.gen(function* () {
              if (ok === true && op === "remove" && (path === LOCK || path === `${LOCK}.child`) && !waited) {
                waited = true;
                yield* Deferred.await(gate);
              }
            });
        };
        const got = new Map<number, Held>();
        yield* take(d, table, breaker, got, forBreaker());
        yield* settle;
        // Where the label is already gone the taker holds and runs its command; where the breaker
        // removed `.child` first, the label still stands and the taker waits.
        const started = (held: Held) =>
          Effect.suspend(() => {
            table.running.set(command, d.now - 1_000);
            return held.running(Option.some(command));
          });
        yield* take(d, table, taker, got, undefined, started);
        yield* settle;
        yield* Deferred.succeed(gate, undefined);
        yield* settle;

        if (got.has(taker)) {
          // SIGKILL: the wrapper is gone and its scope is never closed; its command runs on.
          table.running.delete(taker);
          yield* settle;
        }

        expect(
          [got.has(breaker), table.running.has(command)],
          "the breaker holds while the taker's command 703 still runs",
        ).not.toEqual([true, true]);
      }).pipe(Effect.provide(Layer.mergeAll(TestClock.layer(), TestConsole.layer))),
    ));

  // N4. Mercurial's race (`mercurial/lock.py`, `_testlock`: "must do this with another lock held, or
  // can race and break valid lock"), in the two orders that break a lock held by a live process.
  // `late`: A and B both read the gone holder's label; A then breaks it and links its own, and only
  // then does B act on what it read. `stale`: B has read the label, and looked at it again, before
  // A removes it, and B acts only once A has linked its own. With `.break`, B looks again under it,
  // finds A holding, and waits. Plants: break without `.break` (the `stale` order gives two
  // holders); break without looking again under `.break` (the `late` order gives two holders).
  it("scenario: two takers that both read a gone holder's label leave one holder, in either race order", () =>
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
    Effect.runPromise(
      Effect.forEach(
        ["late", "stale"] as const,
        (order) =>
          Effect.gen(function* () {
            const d = disk();
            const table = ProcessesTest.table([]);
            const [a, b, gone] = [601, 602, 9];
            table.running.set(a, AT - 60_000);
            table.running.set(b, AT - 60_000);
            d.files.set(LOCK, { text: `${gone}\n`, at: AT - 30_000 });
            const bReady = yield* Deferred.make<void>();
            const aLinked = yield* Deferred.make<void>();
            const readsLabel = (op: string, path: string) =>
              path === LOCK && (op === "readFileString" || op === "readFile");
            // A: in `late`, its first step after reading the label waits until B has read it; in
            // `stale`, its first removal of the label waits until B has read it twice, or found
            // `.break` taken. A says when it has linked its own label.
            const forA = (): Hook => {
              let read = false,
                waited = false;
              return (op, path, ok) =>
                Effect.gen(function* () {
                  const gate =
                    order === "late" ? ok === undefined && read : ok === undefined && op === "remove" && path === LOCK;

                  if (gate && !waited) {
                    waited = true;
                    yield* Deferred.await(bReady);
                  }

                  if (ok === true && readsLabel(op, path)) {
                    read = true;
                  }

                  if (ok === true && op === "link" && path === LOCK) {
                    yield* Deferred.succeed(aLinked, undefined);
                  }
                });
            };
            // B: once it has read the label (twice in `stale`), its next step waits until A has
            // linked its own; a refused `.break` also lets A go on, since B then sleeps.
            const forB = (): Hook => {
              let reads = 0,
                waited = false;
              return (op, path, ok) =>
                Effect.gen(function* () {
                  const enough = order === "late" ? 1 : 2;

                  if (ok === undefined && reads >= enough && !waited) {
                    waited = true;
                    yield* Deferred.await(aLinked);
                  }

                  if (ok === true && readsLabel(op, path)) {
                    reads += 1;

                    if (reads === enough) {
                      yield* Deferred.succeed(bReady, undefined);
                    }
                  }

                  if (ok === false && op === "link" && path === `${LOCK}.break`) {
                    yield* Deferred.succeed(bReady, undefined);
                  }
                });
            };
            const got = new Map<number, Held>();
            const takenA = yield* take(d, table, a, got, forA());
            const takenB = yield* take(d, table, b, got, forB());
            yield* settle;
            expect([got.has(a), got.has(b)], `${order}: A holds and B waits`).toEqual([true, false]);
            expect(d.files.get(LOCK)?.text, `${order}: the label names A`).toBe(`${a}\n`);
            yield* Scope.close(takenA.scope, Exit.void);
            yield* settle;
            expect(got.has(b), `${order}: B takes the lock once A lets go`).toBe(true);
            expect(d.files.get(LOCK)?.text, `${order}: the label names B`).toBe(`${b}\n`);
            yield* Scope.close(takenB.scope, Exit.void);
            expect(d.files.has(LOCK), `${order}: the last holder removed its label`).toBe(false);
          }).pipe(Effect.provide(Layer.mergeAll(TestClock.layer(), TestConsole.layer))),
        { concurrency: 1, discard: true },
      ),
    ));

  // N7. The review's order (plan amendment of 2026-11-16, fix round): breaker D was killed by
  // SIGKILL while it held `.break`, the old holder is gone, and two live takers B and C run. C reads
  // the dead `.break`; B reads it too, removes it and links its own; C then acts on what it read.
  // Each looks under its own `.break`, and C acts on the stale label only once B has linked its own.
  // With a dead `.break` broken under `.break.break`, C finds B's live `.break` and removes nothing,
  // so one `hold` returns and the other waits. A scenario, not a property: the law is this one order,
  // pinned by gates, which N3's walk cannot reach since it kills only holders. Plant (the build's,
  // run once): on the fixed code, put back `fs.remove(breaker)` for a stale `.break`: both hold.
  it("scenario: a .break left by a dead breaker, a gone holder and two live takers leave one holder", () =>
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
    Effect.runPromise(
      Effect.gen(function* () {
        const d = disk();
        const table = ProcessesTest.table([]);
        const [b, c, gone, dead] = [602, 603, 8, 9];
        const BREAK = `${LOCK}.break`;
        table.running.set(b, AT - 60_000);
        table.running.set(c, AT - 60_000);
        d.files.set(LOCK, { text: `${gone}\n`, at: AT - 30_000 });
        d.files.set(BREAK, { text: `${dead}\n`, at: AT - 20_000 });
        const cRead = yield* Deferred.make<void>();
        const bBreak = yield* Deferred.make<void>();
        const cLooked = yield* Deferred.make<void>();
        const bLabel = yield* Deferred.make<void>();
        // B: its first step waits until C has read the dead `.break`. Once it has linked its own
        // `.break`, its next step waits until C has looked at the label under a `.break` of its own,
        // or been refused `.break`. It says when it links a label.
        const forB = (): Hook => {
          let phase: "start" | "free" | "broke" | "on" = "start";
          return (op, path, ok) =>
            Effect.gen(function* () {
              if (ok === undefined && phase === "start") {
                phase = "free";
                yield* Deferred.await(cRead);
              }

              if (ok === undefined && phase === "broke") {
                phase = "on";
                yield* Deferred.await(cLooked);
              }

              if (ok === true && op === "link" && path === BREAK && phase === "free") {
                phase = "broke";
                yield* Deferred.succeed(bBreak, undefined);
              }

              if (ok === true && op === "link" && path === LOCK) {
                yield* Deferred.succeed(bLabel, undefined);
              }
            });
        };
        // C: once it has read the dead `.break`, its next step waits until B has linked its own.
        // When it is next refused `.break`, or takes it and reads the label under it, B may go on;
        // once it has read the label after trying `.break`, its next step waits until B has linked a
        // label.
        const forC = (): Hook => {
          let phase: "start" | "read" | "after" | "tried" | "looked" | "on" = "start";
          return (op, path, ok) =>
            Effect.gen(function* () {
              if (ok === undefined && phase === "read") {
                phase = "after";
                yield* Deferred.await(bBreak);
              }

              if (ok === undefined && phase === "looked") {
                phase = "on";
                yield* Deferred.await(bLabel);
              }

              if (ok === true && phase === "start" && op === "readFileString" && path === BREAK) {
                phase = "read";
                yield* Deferred.succeed(cRead, undefined);
              }

              if (ok !== undefined && phase === "after" && op === "link" && path === BREAK) {
                phase = "tried";

                if (!ok) {
                  yield* Deferred.succeed(cLooked, undefined);
                }
              }

              if (ok === true && phase === "tried" && op === "readFileString" && path === LOCK) {
                phase = "looked";
                yield* Deferred.succeed(cLooked, undefined);
              }
            });
        };
        const got = new Map<number, Held>();
        const takenB = yield* take(d, table, b, got, forB());
        const takenC = yield* take(d, table, c, got, forC());
        yield* settle;
        expect([...got.keys()], "one hold returns while the other waits").toHaveLength(1);
        const [first, second] = got.has(b) ? [b, c] : [c, b];
        expect(d.files.get(LOCK)?.text, "the label names the holder").toBe(`${first}\n`);
        yield* Scope.close((first === b ? takenB : takenC).scope, Exit.void);
        yield* settle;
        expect(got.has(second), "the other takes the lock once the first lets go").toBe(true);
        expect(d.files.get(LOCK)?.text, "the label names the second holder").toBe(`${second}\n`);
        yield* Scope.close((second === b ? takenB : takenC).scope, Exit.void);
        expect(d.files.has(LOCK), "the last holder removed its label").toBe(false);
      }).pipe(Effect.provide(Layer.mergeAll(TestClock.layer(), TestConsole.layer))),
    ));
});
