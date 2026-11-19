// P18 slice 1, next/ (ticket 290): law L9's one suite and its two backends. The suite drives a real
// local instance through one round trip; each backend only turns its actions and observations into
// the suite's words. The browser backend is a Chromium tab, built in `client-protocol.test.ts` where
// Playwright's Promises may be met; the headless one is the library's own `Headless.start` in this
// process, on Node's global WebSocket, with a key the test makes.
//
// P18 slice 2 (ticket 979): law E1's steps. `served` starts the app's own build in this process, as
// `dev.ts` does, so the test holds the instance's control endpoint, as the chaos-revoke suite does.
// `followRestart` ends the tile's process as crashed and starts its successor through it.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { checklistWindow } from "@kampus/checklist/window";
import { Id } from "@kampus/libfabrika";
import * as Headless from "@kampus/libfabrika/client/Headless";
import { windowMachineFor } from "@kampus/libfabrika/client/WindowMachine";
import { Ledger, type LedgerCalls } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerRemote from "@kampus/libfabrika/ledger/LedgerRemote";
import type { Entry } from "@kampus/libfabrika/ledger/Log";
import { ExitReason } from "@kampus/libfabrika/processes/ExitReason";
import { Start } from "@kampus/libfabrika/processes/Process";
import { ClientKey, type Identity } from "@kampus/libfabrika/transport/ClientKey";
import { type ClientRow, ClientRows } from "@kampus/libfabrika/transport/ClientRows";
import {
  String as Str,
  pipe,
  Array as Arr,
  DateTime,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
  Scope,
  Stream,
} from "effect";
import { SecureRandom } from "effect/crypto";

import { build } from "../src/build.ts";
import { localInstance } from "../src/local-instance.ts";
import { heldPort } from "../src/port.test-support.ts";
import * as RecordWireTest from "../src/record-wire.test-support.ts";
import { type Dev, grant, type Home, PERSON, reader, type Waiting } from "./p14.test-support.ts";

/** The key of each Msg, Cmd and answer these laws write or expect, made by a schema (0569, 0562).
 *  A law hands over only the fields it reads, so a case holds the key alone. */
const Tag = Schema.TaggedUnion({
  add: {},
  press: {},
});

/** The registered name of the checklist's process: the headless tile shows it, and its streams are
 *  read by it. */
const PROCESS = "checklist:1";

/** format: the browser tile's accessible name, `tileName`'s words (Desk S2b, 0503): the program
 *  first, then `t<n>`. The tab draws workspace 1 of the founder's tezgah, whose t1 shows PROCESS. */
export const NAME = "checklist, t1";

const TILES = [{ id: "tile_1", name: PROCESS }];

/** One row of the checklist as the backend shows it. */
type Row = { readonly name: string; readonly checked: boolean };

/** What the suite asks of a client, whatever draws it. */
export type Backend = {
  readonly name: "browser" | "headless";
  /** Waits until the client shows its waiting code, and reads it. */
  readonly waiting: Effect.Effect<Waiting>;
  /** Waits until the client is online with its checklist tile open. */
  readonly online: Effect.Effect<void>;
  /** Whether the client is online now. */
  readonly live: Effect.Effect<boolean>;
  /** Submits one `add` through the tile, as a person or a program would. */
  readonly add: (name: string) => Effect.Effect<void>;
  /** The checklist's rows the client shows now. */
  readonly shown: Effect.Effect<ReadonlyArray<Row>>;
  /** How many sockets the client has dialed so far. */
  readonly dials: () => number;
  /** What the client shows of its own state, for a wait that runs out. A tab has none to read. */
  readonly last?: Effect.Effect<Last>;
  /** The words of the tile's state slot: `Online`, `Ended (crashed)` and so on. */
  readonly state: Effect.Effect<string>;
  /** The words of the tile's body and whether they are in the tile's text token. A client that
   *  draws nothing answers null. */
  readonly body: Effect.Effect<{ readonly words: string; readonly ink: boolean } | null>;
  /** The tab id the client dials with, the last part of its socket's path. */
  readonly tab: Effect.Effect<string>;
  /** The pid the tile shows, where the client can say: a tab draws none, so it answers null. */
  readonly pid: Effect.Effect<string | null>;
  /** Closes the client, as a person closes the tab. */
  readonly close: Effect.Effect<void>;
};

/**
 * What a client last showed when a wait ran out: its link's state, its hello exchange's state and
 * the tag of each row it wrote, in order. A refused hello then reads as a refusal, not a timeout.
 */
const Last = Schema.Struct({ link: Schema.String, handshake: Schema.String, rows: Schema.Array(Schema.String) });

type Last = typeof Last.Type;

/** The suite's own failure: a wait that ran out, named by what it waited for, and what it last saw. */
export class SuiteError extends Schema.TaggedError<SuiteError, { readonly brand: unique symbol }>()("SuiteError", {
  waited: Schema.String,
  last: Schema.optionalKey(Last),
}) {}

/** Polls `check` every 250 ms for at most 60 s, then fails with what `last` reads. */
const until = (label: string, check: Effect.Effect<boolean>, last?: Effect.Effect<Last>) =>
  Effect.gen(function* () {
    for (let n = 0; n < 240; n++) {
      if (yield* check) {
        return;
      }

      yield* Effect.sleep("250 millis");
    }

    return yield* SuiteError.make({ waited: label, ...(last === undefined ? {} : { last: yield* last }) });
  });

/** The one round trip: dial, wait, grant, sign the hello, ping in text, open, submit, read back. */
export const roundTrip = (h: Home, dev: Dev, backend: Backend) =>
  Effect.gen(function* () {
    const w = yield* backend.waiting;
    const first = backend.dials();
    const granted = yield* grant(h, w);

    if (!granted.ok) {
      return yield* SuiteError.make({ waited: `${backend.name}: the person's grant` });
    }

    // The door admits only a hello signed with the waiting key, so online means the hello was signed.
    yield* backend.online;
    // Text `ping` keeps the link: a socket-level ping frame gets no `pong` text and the link stalls.
    yield* Effect.sleep("12 seconds");
    const kept = (yield* backend.live) && backend.dials() === first;
    // One `add` goes through the real `process.send`, and its checked view comes back.
    yield* backend.add("milk");
    yield* until(
      `${backend.name}: milk in the view`,
      Effect.map(backend.shown, (rows) => Arr.some(rows, (r) => r.name === "milk" && !r.checked)),
      backend.last,
    );
    const r = yield* reader(h, dev);
    const inbox = yield* r.read(`${PROCESS}/inbox`);
    const sent = Arr.filter(inbox, (e) => named(e.body) === "milk");

    return { first, kept, sent: sent.length };
  });

/** The library's headless client in this process: the same machine and start as the tab. */
export const headlessBackend = (dev: Dev, key: Identity) =>
  Effect.gen(function* () {
    const rows: Array<ClientRow> = [];

    const window = windowMachineFor({
      decode: () => Schema.decodeUnknownSync(checklistWindow.data),
      tile: () => undefined,
    });

    // The run's own scope, so E1 can close the client as a person closes a tab; the suite's scope
    // closes it too, for every other law.
    const own = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(own, Exit.void));

    const booting = yield* Headless.start({ tiles: TILES, window, origin: dev.url, build: "p18-headless" }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ClientKey, {
            current: () => Effect.succeed(key),
            claimPersist: Effect.succeed(false),
            persist: Effect.succeed(true),
          }),
          Layer.succeed(ClientRows, { put: (row: ClientRow) => Effect.sync(() => void rows.push(row)) }),
          Id.Generator.layer,
        ),
      ),
      Scope.provide(own),
    );

    const run = yield* booting.ready;
    let dials = 0;
    let last: number | null = null;

    const count = () => {
      const link = run.getState().link;
      const dial = "dial" in link && link._tag !== "retrying" ? link.dial : null;

      if (dial !== null && dial !== last) {
        last = dial;
        dials++;
      }

      return dials;
    };

    const state = Effect.sync(() => {
      count();

      return run.getState();
    });

    const showing = Effect.map(state, (s) => ({
      link: s.link._tag,
      handshake: s.handshake._tag,
      rows: Arr.map(rows, (r) => r.record._tag),
    }));

    const backend: Backend = {
      name: "headless",
      waiting: until(
        "headless: the waiting code",
        Effect.map(state, (s) => s.link._tag === "waiting_grant"),
        showing,
      ).pipe(
        Effect.andThen(state),
        Effect.map((s) => {
          const link = s.link;
          const code = link._tag === "waiting_grant" ? link.code : "";

          return { line: "", url: dev.url, fingerprint: key.fingerprint, code };
        }),
        Effect.orDie,
      ),
      online: until(
        "headless: online with its tile open",
        Effect.map(state, (s) => s.link._tag === "online" && s.tiles[0]?.reach._tag === "open"),
        showing,
      ).pipe(Effect.orDie),
      live: Effect.map(state, (s) => s.link._tag === "online"),
      add: (name) =>
        run
          .dispatch({
            ...Tag.cases.press.make({}),
            tile: "tile_1",
            m: { ...Tag.cases.add.make({}), name },
            via: "button",
          })
          .pipe(Effect.orDie),
      shown: Effect.map(state, (s) => {
        const pid = s.tiles[0]?.last;
        const view = pid !== null && pid !== undefined && pid !== "" ? s.client.views[pid]?.view : undefined;
        const data = Option.getOrUndefined(Schema.decodeOption(checklistWindow.data)(view));

        return Arr.map(data?.items ?? [], (i) => ({ name: i.name, checked: i.state === "checked" }));
      }),
      dials: count,
      last: showing,
      // The window's own words for its tile, as the tab's state slot draws them.
      state: Effect.map(state, (s) => {
        const reach = s.tiles[0]?.reach;
        const tag: string = reach?._tag ?? "missing";

        return s.link._tag !== "online"
          ? "Connecting"
          : reach?._tag === "ended"
            ? `Ended (${reach.reason._tag})`
            : tag === "open"
              ? "Online"
              : tag === "missing"
                ? "Missing"
                : "Opening";
      }),
      body: Effect.succeed(null),
      tab: until(
        "headless: a row naming its tab",
        Effect.sync(() => rows.length > 0),
      ).pipe(
        Effect.map(() => rows[0]?.tab ?? ""),
        Effect.orDie,
      ),
      pid: Effect.map(state, (s) => {
        const reach = s.tiles[0]?.reach;

        return reach !== undefined && "pid" in reach ? reach.pid : null;
      }),
      close: Scope.close(own, Exit.void),
    };

    return backend;
  });

// --- P18 slice 2, law E1 ------------------------------------------------------------------------

const PROJECT = "p18-follow";

/** The test's own trace id for the control calls, as the chaos-revoke suite gives one. */
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

/** One entry of a stream as the suite reads it: its tag, its place in the whole log and its body. */
type Fact = Entry;

/** What the suite reads of a fact's body, or of a start's answer. Every field is optional and as loose
 *  as the read it replaces: a body that holds none of them, or is not an object at all, reads as an
 *  empty one, and a field of another shape still reads as itself. */
const Body = Schema.Struct({
  process: Schema.optionalKey(Schema.Unknown),
  ref: Schema.optionalKey(Schema.Unknown),
  reason: Schema.optionalKey(Schema.Unknown),
  m: Schema.optionalKey(Schema.Unknown),
  to: Schema.optionalKey(Schema.Unknown),
});

/** What the suite reads of a letter's `m`. */
const Letter = Schema.Struct({ name: Schema.optionalKey(Schema.Unknown) });

/** What the suite reads of a watch's `to`. */
const Watcher = Schema.Struct({ client: Schema.optionalKey(Schema.Unknown) });

const NO_BODY: typeof Body.Type = {};

const read = (body: unknown): typeof Body.Type =>
  Option.getOrElse(Schema.decodeUnknownOption(Body)(body), () => NO_BODY);

/** The name of the letter an entry's body carries, if it carries one. */
const named = (body: unknown): unknown => Option.getOrUndefined(Schema.decodeUnknownOption(Letter)(read(body).m))?.name;

/** The client a watch's body is for, if it names one. */
const watcher = (body: unknown): unknown =>
  Option.getOrUndefined(Schema.decodeUnknownOption(Watcher)(read(body).to))?.client;

/**
 * The app's own build, started in this process on a held port as `dev.ts` starts it, for the person
 * of `h` as its founder. Its answer is the `Dev` the backends dial, the control endpoint of its one
 * project, a reader of any stream through that endpoint, and the `From` a control call carries.
 */
export const served = (h: Home) =>
  Effect.gen(function* () {
    const built = yield* build({ out: join(h.dir, "build") });
    // Held in this scope before the instance, so it is given back after the instance closes.
    const { port } = yield* Effect.acquireRelease(heldPort(), (held) => held.release);

    // oxlint-disable-next-line fabrika/no-promises -- edge: Alchemy's module is loaded at the test's boundary, as chaos-revoke loads it
    const { localState } = yield* Effect.tryPromise({
      // oxlint-disable-next-line fabrika/no-promises -- edge: Alchemy loads only after localInstance's telemetry switch
      try: () => import("alchemy/State/LocalState"),
      catch: () => SuiteError.make({ waited: "Alchemy's local state" }),
    });

    const instance = yield* localInstance(
      built,
      yield* RecordWireTest.startupFixture({
        home: h.dir,
        name: PROJECT,
        person: PERSON,
        founder: h.publicKey,
        window: null,
        port,
      }),
    ).pipe(Effect.provide(localState().pipe(Layer.provideMerge(SecureRandom.layerWebCrypto))));

    const control = instance.project(PROJECT);
    // The private binding already speaks the project's public ledger-call protocol.
    const { append, read, wait } = control;

    if (append === undefined || read === undefined || wait === undefined) {
      return yield* Effect.die(new Error("the project binding has no ledger calls"));
    }

    const calls: LedgerCalls = { append, read, wait };
    const ledger = LedgerRemote.layer(calls, { reader: "p18-e1" });

    const facts = (stream: string) =>
      Ledger.use((l) => Stream.runCollect(l.read(stream, 0))).pipe(
        Effect.map((entries): ReadonlyArray<Fact> => entries),
        Effect.provide(ledger),
        Effect.orDie,
      );

    const blob = Buffer.from(Str.split(h.publicKey, " ")[1] ?? "", "base64");

    const from = () => ({
      by: `SHA256:${pipe(createHash("sha256").update(blob).digest("base64"), Str.replace(/=+$/, ""))}`,
      for: PERSON,
      sentAt: DateTime.formatIso(DateTime.nowUnsafe()),
      seen: 0,
      parent: null,
      traceId: TRACE,
      build: built.build,
    });

    const dev: Dev = { url: instance.url, port, output: () => "", stop: Effect.void };
    const source = built.programs["fabrika/checklist"];

    if (source === undefined) {
      return yield* Effect.die(new Error("the app's build holds no checklist"));
    }

    return { dev, control, facts, from, hash: source.hash };
  }).pipe(Effect.provide(NodeServices.layer));

type Served = Effect.Success<ReturnType<typeof served>>;

/** One typed control call, as the chaos-revoke suite's `invoke` makes it, awaited; `method` names it in the failure. */
const invoke = Effect.fnUntraced(function* <A>(method: string, call: () => Promise<A>) {
  // oxlint-disable-next-line fabrika/no-promises -- edge: the local instance's Durable Object RPC answers a Promise
  return yield* Effect.tryPromise({
    try: call,
    catch: () => SuiteError.make({ waited: `the control endpoint's ${method}` }),
  });
});

/** The pid of the name's newest life fact, started or restarted. */
const newest = (facts: ReadonlyArray<Fact>) =>
  Arr.map(
    Arr.filter(facts, (f) => f._tag === "started" || f._tag === "restarted"),
    (f) => String(read(f.body).process),
  ).at(-1);

/**
 * E1's walk: grant the client and wait for its open tile, end the tile's process as crashed through
 * the control endpoint, wait for the tile to say so, start the successor through the same endpoint,
 * wait for the tile to be online on it, submit one `add`, then close the client. Its answer is what
 * the ledger holds for the law to judge.
 */
export const followRestart = (h: Home, s: Served, backend: Backend) =>
  Effect.gen(function* () {
    const w = yield* backend.waiting;
    const granted = yield* grant(h, w);

    if (!granted.ok) {
      return yield* SuiteError.make({ waited: `${backend.name}: the person's grant` });
    }

    yield* backend.online;
    const tab = yield* backend.tab;
    const first = newest(yield* s.facts(`processes/${PROCESS}`));

    if (first === undefined) {
      return yield* SuiteError.make({ waited: `${backend.name}: a live ${PROCESS}` });
    }

    yield* invoke("exit", () => s.control.exit(first, ExitReason.cases.crashed.make({ phase: "step" }), s.from()));
    yield* until(
      `${backend.name}: the tile says Ended (crashed)`,
      Effect.map(backend.state, (words) => words === "Ended (crashed)"),
      backend.last,
    );
    const ended = yield* backend.state;
    const endedBody = yield* backend.body;

    const started = yield* invoke("start", () =>
      s.control.start(
        Start.cases.again.make({
          id: "p18-e1-again",
          name: PROCESS,
          code: { program: "fabrika/checklist", hash: s.hash },
          after: first,
          reason: "p18-e1",
        }),
        s.from(),
      ),
    );

    const second = String(read(started).process);
    yield* until(
      `${backend.name}: the tile is online on the successor`,
      Effect.gen(function* () {
        const pid = yield* backend.pid;

        return (yield* backend.state) === "Online" && (pid === null || pid === second);
      }),
      backend.last,
    );
    const shownPid = yield* backend.pid;
    yield* backend.add("milk");
    yield* until(
      `${backend.name}: milk in the successor's view`,
      Effect.map(backend.shown, (rows) => Arr.some(rows, (r) => r.name === "milk" && !r.checked)),
      backend.last,
    );

    const restarted = Option.getOrUndefined(
      Arr.findFirst(
        yield* s.facts(`processes/${PROCESS}`),
        (f) => f._tag === "restarted" && read(f.body).process === second,
      ),
    );

    const sent = Arr.filter(yield* s.facts(`${PROCESS}/inbox`), (f) => named(f.body) === "milk");
    const watches = Arr.filter(yield* s.facts("processes"), (f) => f._tag === "monitored" && watcher(f.body) === tab);

    yield* backend.close;

    const ends = (stream: ReadonlyArray<Fact>) =>
      Arr.filter(stream, (f) => f._tag === "demonitored" && watcher(f.body) === tab);

    yield* until(
      `${backend.name}: its session's watch ended after the close`,
      Effect.map(s.facts("processes"), (all) => ends(all).length > 0),
    );

    return {
      tab,
      first,
      second,
      ended,
      endedBody,
      shownPid,
      restartedAt: restarted?.rev ?? null,
      sent: Arr.map(sent, (f) => f.rev),
      watched: Arr.map(watches, (f) => ({
        ref: String(read(f.body).ref),
        process: String(read(f.body).process),
      })),
      unwatched: Arr.map(ends(yield* s.facts("processes")), (f) => ({
        ref: String(read(f.body).ref),
        reason: String(read(f.body).reason),
      })),
    };
  });
