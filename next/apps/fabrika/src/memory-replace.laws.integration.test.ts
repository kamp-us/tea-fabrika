// The memory restart plan (docs/plan/quests/memory-restart-PLAN.md), next/, L10 and L11. Real workerd
// through Alchemy, the app's own build and door, and the brain's own facts on `gateway/brain`. Only
// the memory reading is a stand-in (`rssStandIn`, in rss.fixture.ts): no test can grow workerd to 500 MB on
// purpose, so `ps -o rss= -p <pid>` answers the limit plus one for the first workerd once the test
// says so, and every other command, workerd's build and every other `ps` included, runs for real. The
// only process the laws look at is the workerd pid their own instance's `started` fact names, and
// they look with `ps`, never with a signal. These are host-only laws (0045, 0178): they run in the
// step's container, never on the owner's Mac.
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Predicate, Stream } from "effect";
import { SecureRandom } from "effect/crypto";
import { ChildProcess } from "effect/process";
import { describe, expect } from "vitest";
import { type PersonKey, personKey } from "./person-key.test-support.ts";
import { heldPort } from "./port.test-support.ts";
import * as RecordWireTest from "./record-wire.test-support.ts";
import { rssStandIn } from "./rss.fixture.ts";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

const SENT = "2026-11-15T04:00:00.000Z";

const PROJECT = "memory-replace";

// The brain's declared defaults, which this instance starts with: 0292's 500 MB mark and the 5 s
// grace. L9 holds both defaults.
const LIMIT = 500_000_000;

const GRACE = 5000;

// What `ps` prints for the limit plus one byte, in KiB, rounded up so the brain reads at least that.
const OVER = Math.ceil((LIMIT + 1) / 1024);

// The bound on a replacement's first listener, as the brain's own first start waits for it.
const START = 30_000;

// How often the poller asks for `info`, and how often a fact or a process is looked at.
const POLL = 50;

// The founder's key, as an SSH public key line and a signer for the door's hello.
type Key = PersonKey;

type Instance = any;

const pause = (ms = POLL) => new Promise<void>((done) => setTimeout(done, ms));

/** A real WebSocket at the door, its hello answered: the founder's tab, held open by the caller. */
const wire = async (instance: Instance, key: Key, tab: string) => {
  const socket = new WebSocket(
    `${instance.url.replace("http", "ws")}/client/${encodeURIComponent(key.fingerprint)}/${tab}`,
  );

  const frames: Array<any> = [];
  let closed: number | undefined;
  socket.addEventListener("message", (event) => {
    if (event.data !== "pong") {
      frames.push(JSON.parse(String(event.data)));
    }
  });
  socket.addEventListener("close", (event) => {
    closed = event.code;
  });
  socket.addEventListener("error", () => {
    closed ??= 1006;
  });

  const next = async (match: (frame: any) => boolean) => {
    const end = Date.now() + START;

    while (Date.now() < end) {
      const index = frames.findIndex(match);

      if (index >= 0) {
        return frames.splice(index, 1)[0];
      }

      if (closed !== undefined) {
        throw new Error(`closed ${closed}`);
      }

      await pause(20);
    }

    throw new Error(`no frame in ${START} ms`);
  };

  const nonce = (await next((frame) => frame.method === "challenge")).params.nonce;
  socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        versions: [1],
        has: ["seal"],
        ping: "30s",
        key: key.raw,
        tab,
        nonce,
        platform: "headless",
        os: "linux",
        sentAt: SENT,
        signed: await Effect.runPromise(key.proof(`fabrika-hello\n${instance.url}\n${tab}\n${nonce}`)),
      },
    }),
  );
  const hello = await next((frame) => frame.id === 1);
  expect(hello.error, "the founder's hello is answered").toBeUndefined();

  return { open: () => closed === undefined, close: () => socket.close() };
};

/** The real `ps`, never the stand-in: whether a pid is still a live process. */
const alive = (pid: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      const ps = yield* ChildProcess.make("ps", ["-o", "pid=", "-p", String(pid)]);

      const [text] = yield* Effect.all([Stream.mkString(Stream.decodeText(ps.stdout)), ps.exitCode], {
        concurrency: 2,
      });

      return text.trim() === String(pid);
    }),
  ).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

type Fact = { readonly _tag: string; readonly body: Record<string, unknown> };

/** The brain's facts on `gateway/brain`, or null while the call cannot be answered. */
const brain = async (instance: Instance): Promise<ReadonlyArray<Fact> | null> => {
  try {
    return ((await instance.project(PROJECT).read("gateway/brain", 0, "audit")) as Array<any>).map((row) => ({
      _tag: row._tag,
      body: row.body,
    }));
  } catch {
    return null;
  }
};

/** Polls until `done` holds or `ms` pass, and answers what it last saw and when it held, if it did. */
const watch = async <A>(look: () => Promise<A>, done: (value: A) => boolean, ms: number) => {
  const began = Date.now();
  let last = await look();

  while (!done(last) && Date.now() - began < ms) {
    await pause();
    last = await look();
  }

  return { last, after: done(last) ? Date.now() - began : null };
};

// How one `info` call ended: answered, refused as offline by the brain, refused by the OS at the
// control port (the bug), or any other failure.
type Outcome = "answered" | "offline" | "refused" | "other";

// Every message and code down a failure's chain of causes.
const chain = (value: unknown): string =>
  `${String(value)} ${Predicate.hasProperty(value, "code") ? String(value.code) : ""} ${
    Predicate.hasProperty(value, "cause") && value.cause !== value ? chain(value.cause) : ""
  }`;

const outcome = async (instance: Instance): Promise<Outcome> => {
  try {
    await instance.project(PROJECT).info();

    return "answered";
  } catch (error) {
    if (Predicate.hasProperty(error, "reason") && error.reason === "offline") {
      return "offline";
    }

    // The control call keeps its cause; Node's fetch names a refused dial ECONNREFUSED.
    return chain(error).includes("ECONNREFUSED") ? "refused" : "other";
  }
};

/** One real local instance with no programs, its `ps -o rss=` answered by `kib`. */
const world = (kib: (pid: number) => number | null) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "mrw-" });

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const previous = process.env.FABRIKA_HOME;
        process.env.FABRIKA_HOME = home;
        process.env.DO_NOT_TRACK = "1";

        return previous;
      }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) {
            delete process.env.FABRIKA_HOME;
          } else {
            process.env.FABRIKA_HOME = previous;
          }
        }),
    );
    const { localState } = yield* Effect.promise(() => import("alchemy/State/LocalState"));
    const { build } = yield* Effect.promise(() => import("./build.ts"));
    const { localInstance } = yield* Effect.promise(() => import("./local-instance.ts"));
    const key = yield* personKey;
    // Held until the scope closes, after the instance that binds it (finalizers run in reverse).
    const at = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
    yield* fs.symlink(path.resolve(import.meta.dirname, "../node_modules"), path.join(home, "node_modules"));
    const built = yield* build({ out: path.join(home, "dist") });

    const platform = Layer.mergeAll(
      rssStandIn(kib).pipe(Layer.provide(NodeServices.layer)),
      localState(),
      SecureRandom.layerWebCrypto,
    ).pipe(Layer.provideMerge(NodeServices.layer));

    const context = yield* Layer.build(platform);

    const instance: Instance = yield* localInstance(
      built,
      yield* RecordWireTest.startupFixture({
        home,
        name: PROJECT,
        person: PERSON,
        founder: key.line,
        window: key.raw,
        port: at.port,
      }),
    ).pipe(Effect.provideContext(context));

    return { instance, key };
  }).pipe(Effect.provide(NodeServices.layer));

/** The facts of one start, in the order the brain wrote them. */
const sequence = (facts: ReadonlyArray<Fact>, start: unknown) =>
  facts.filter((fact) => fact.body.start === start && fact._tag !== "started").map((fact) => fact._tag);

describe("the memory restart on real workerd, next/", () => {
  // scenario: the bug's own shape, real workerd draining on SIGTERM while a WebSocket stays open, which no
  // generated Node law can make. Plant: run it on main's dev.ts: the poller sees ECONNREFUSED and the old
  // pid outlives the bound.
  it.live(
    "scenario: L10 with the founder's door WebSocket open, a memory replace kills the old workerd at the grace, a new one answers on the same ports, and no call is refused at the control port",
    () =>
      Effect.gen(function* () {
        const sizes = new Map<number, number>();
        const { instance, key } = yield* world((pid) => sizes.get(pid) ?? null);

        const socket = yield* Effect.acquireRelease(
          Effect.promise(() => wire(instance, key, "memory")),
          (held) => Effect.sync(() => held.close()),
        );

        const before = yield* Effect.promise(() =>
          watch(
            () => brain(instance),
            (facts) => facts?.some((fact) => fact._tag === "started") === true,
            START,
          ),
        );

        const first = before.last!.find((fact) => fact._tag === "started")!.body;
        const old = Number(first.pid);
        expect(yield* alive(old), "the first workerd runs").toBe(true);
        expect(socket.open(), "the door's WebSocket is open").toBe(true);

        // A poller calls `info` every 50 ms from before the replace until the replacement answers.
        const seen: Record<Outcome, number> = { answered: 0, offline: 0, refused: 0, other: 0 };
        let polling = true;

        const poller = (async () => {
          while (polling) {
            seen[await outcome(instance)]++;
            await pause();
          }
        })();

        const switched = Date.now();
        sizes.set(old, OVER);

        // The next 1-second sample sends the SIGTERM; the grace and two seconds bound the old pid's end.
        const gone = yield* Effect.promise(() =>
          watch(
            () => Effect.runPromise(alive(old)),
            (live) => !live,
            1000 + GRACE + 2000,
          ),
        );

        const replaced = yield* Effect.promise(() =>
          watch(
            async () => {
              const facts = await brain(instance);
              const next = facts?.find((fact) => fact._tag === "started" && fact.body.after === first.start);

              return next === undefined ? null : { facts: facts!, next: next.body };
            },
            (found) => found !== null,
            GRACE + START,
          ),
        );

        // The replacement answers through the same handle, so on the same control and public ports.
        const answered = yield* Effect.promise(() =>
          watch(
            () => outcome(instance),
            (got) => got === "answered",
            START,
          ),
        );

        polling = false;
        yield* Effect.promise(() => poller);
        const elapsed = Date.now() - switched;

        // The bug: a call dials the old control port while the old workerd drains.
        expect(seen.refused, `info calls refused at the control port in ${elapsed} ms`).toBe(0);
        expect(seen.other, "info calls that failed some other way").toBe(0);
        expect(gone.after, "the old workerd ended within a sample, the grace and two seconds").not.toBeNull();
        expect(replaced.after, "a replacement started").not.toBeNull();
        expect(answered.last, "the replacement answers info").toBe("answered");
        const next = Number(replaced.last!.next.pid);
        expect(next).not.toBe(old);
        expect(yield* alive(next), "the new workerd runs").toBe(true);
        // A WebSocket keeps workerd draining, so the grace runs out and the kill is recorded.
        expect(sequence(replaced.last!.facts, first.start)).toEqual(["replacing", "killed", "exited", "restarting"]);
        expect(replaced.last!.facts.find((fact) => fact._tag === "replacing")?.body).toMatchObject({
          pid: old,
          reason: "memory",
          bytes: OVER * 1024,
          limit: LIMIT,
          grace: GRACE,
        });
        expect(replaced.last!.facts.find((fact) => fact._tag === "exited")?.body).toMatchObject({
          reason: "memory",
          signal: "SIGKILL",
        });
        // The public port is the same: a new founder's tab says hello at the same address.
        const again = yield* Effect.promise(() => wire(instance, key, "after"));
        again.close();
      }),
    180_000,
  );

  // scenario: real workerd's own drain with nothing holding it, the case the grace must not slow down.
  // Plant: send SIGKILL at once in place of SIGTERM: the killed fact appears and the exit names SIGKILL.
  it.live(
    "scenario: L11 with no WebSocket open, the old workerd ends by itself on SIGTERM, with no killed fact",
    () =>
      Effect.gen(function* () {
        const sizes = new Map<number, number>();
        const { instance } = yield* world((pid) => sizes.get(pid) ?? null);

        const before = yield* Effect.promise(() =>
          watch(
            () => brain(instance),
            (facts) => facts?.some((fact) => fact._tag === "started") === true,
            START,
          ),
        );

        const first = before.last!.find((fact) => fact._tag === "started")!.body;
        const old = Number(first.pid);
        sizes.set(old, OVER);

        const gone = yield* Effect.promise(() =>
          watch(
            () => Effect.runPromise(alive(old)),
            (live) => !live,
            1000 + GRACE + 2000,
          ),
        );

        const replaced = yield* Effect.promise(() =>
          watch(
            async () => {
              const facts = await brain(instance);

              return facts?.some((fact) => fact._tag === "started" && fact.body.after === first.start) === true
                ? facts
                : null;
            },
            (found) => found !== null,
            GRACE + START,
          ),
        );

        expect(gone.after, "the old workerd ended").not.toBeNull();
        expect(gone.after!, "it ended before the grace ran out").toBeLessThan(1000 + GRACE);
        expect(replaced.after, "a replacement started").not.toBeNull();
        expect(sequence(replaced.last!, first.start)).toEqual(["replacing", "exited", "restarting"]);
        // workerd takes SIGTERM as its drain and then exits by itself, so its exit names no signal. The
        // plan expected `signal: SIGTERM`; the first run on workerd 1.20261026.1 showed none.
        expect(replaced.last!.find((fact) => fact._tag === "exited")?.body).toMatchObject({
          reason: "memory",
          signal: null,
        });
      }),
    180_000,
  );
});
