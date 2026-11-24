// R0, slice 1's first law of ticket 2067: a probe of real workerd, through Alchemy's local dev, with the raw Worker of
// `platform-worker.test-support.ts`. It measures three platform facts the design leans on and the stand-in must copy, before any
// other law is written:
//
//   1. an object with only hibernatable sockets sleeps after 12 idle seconds: the next message finds a new wake token, and the
//      socket's attachment is the one written before;
//   2. after the server closes a socket, `send` on it throws a `TypeError`; and whether the platform then gives a close event
//      (`webSocketClose`) once the client's Close frame comes back, and whether the attachment is still readable in it, are two
//      facts it only observes;
//   3. after the client closes a socket, exactly one close event comes, with the client's code and reason.
//
// It is an integration law: it starts workerd and binds a port on 127.0.0.1, so the laptop refuses it by its name and it runs
// in the lead's proof run and on main's full run. No stand-in could replace it, since its point is what the platform does.
// The two facts of (2) are printed as `R0 FACT` lines; the stand-in's two constants are written from them. A later round of
// this slice makes this law fail when either differs from those constants.
//
// The three draws of `platformCloses` hold fifteen closes, each on an object of its own, all idle together, so the 12 seconds
// are waited once: three runs one after another could not fit the 60 seconds a test has. The objects are told apart by name.
//
// Plant: keep the probe object busy with an open outbound call (a `fetch` that never answers, held in the object's constructor),
// and it never sleeps: the message after 12 seconds finds the same wake token, and (1) is red. This plant is not run here: the
// CI proof run checks it.
import { NodeServices } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import {
  Arbitrary,
  Console,
  Context,
  Deferred,
  Effect,
  FileSystem,
  Formatter,
  Layer,
  Option,
  Path,
  Predicate,
  Queue,
  Schedule,
  Schema,
} from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import type { Socket } from "effect/socket";
import { SEED } from "../Transport.test-support.ts";
import { Attachment, Command, Report, ReportText } from "./platform-wire.test-support.ts";
import { CLOSE_CLASSES, closesFrom, connect, freePort, platformCloses } from "./Platform.test-support.ts";
import type { Client, Close } from "./Platform.test-support.ts";

/** How long the objects are left alone: the platform says 10 seconds with no event, and this is 2 more. */
const IDLE = "12 seconds";

/**
 * How long a close event that never came is waited for. An event that does not come cannot be seen except by waiting, so this
 * is the one wait the probe cannot make an event of; a close event that comes takes well under a second.
 */
const SETTLE = "3 seconds";

/** How long any one report is waited for. */
const REPORT = "10 seconds";

/** A module that would not load. It is a fault of the set-up, so the layer dies with it. */
class LoadFailed extends Schema.TaggedError<LoadFailed, { readonly brand: unique symbol }>()("LoadFailed", {
  cause: Schema.Defect(),
}) {}

/** A module loaded now, after the environment is set. */
const load = <A>(module: () => Promise<A>) =>
  Effect.orDie(Effect.tryPromise({ try: module, catch: (cause) => new LoadFailed({ cause }) }));

class Deployed extends Context.Service<Deployed, { readonly port: number }>()(
  "@kalfa/transport/cloudflare/Platform.integration.test.Deployed",
) {}

/** The probe Worker, built and run by Alchemy's local dev on a port of its own; released with the scope. */
const deployed = Layer.effect(
  Deployed,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "r0-" });
    const port = yield* freePort;

    // Alchemy and the Worker's module read these three variables themselves, so this file is the one place that writes them.
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const saved = [process.env.ALCHEMY_HOME, process.env.PLATFORM_PORT, process.env.DO_NOT_TRACK] as const;

        process.env.ALCHEMY_HOME = path.join(home, "alchemy");
        process.env.PLATFORM_PORT = String(port);
        process.env.DO_NOT_TRACK = "1";

        return saved;
      }),
      (saved) =>
        Effect.sync(() => {
          for (const [key, value] of [
            ["ALCHEMY_HOME", saved[0]],
            ["PLATFORM_PORT", saved[1]],
            ["DO_NOT_TRACK", saved[2]],
          ] as const) {
            if (value === undefined) {
              delete process.env[key];
            } else {
              process.env[key] = value;
            }
          }
        }),
    );

    const Cloudflare = yield* load(() => import("@alchemy.run/cloudflare"));
    const Alchemy = yield* load(() => import("alchemy"));
    const { deploy } = yield* load(() => import("alchemy/Deploy"));
    const { localState } = yield* load(() => import("alchemy/State/LocalState"));
    const { AlchemyContext } = yield* load(() => import("alchemy/AlchemyContext"));
    const { ArtifactStore, createArtifactStore } = yield* load(() => import("alchemy/Artifacts"));
    const Interaction = yield* load(() => import("alchemy/Interaction"));
    const { AuthProvidersLive } = yield* load(() => import("alchemy/Auth/Registry"));
    const fixture = yield* load(() => import("./platform-worker.test-support.ts"));

    const stack = Alchemy.Stack(
      "platform",
      { providers: Cloudflare.providers(), state: Alchemy.localState() },
      fixture.Host.pipe(Effect.asVoid, Effect.provide(fixture.default)),
    );

    yield* deploy({ stack, stage: "local", dev: true, scope: yield* Effect.scope }).pipe(
      Effect.asVoid,
      Effect.provide(localState()),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(AlchemyContext, { dotAlchemy: path.join(home, ".alchemy"), dev: true, adopt: false }),
          Layer.succeed(ArtifactStore, createArtifactStore()),
          Interaction.layerNonInteractive(),
          AuthProvidersLive,
        ),
      ),
    );

    // `deploy` returns once Alchemy reports the dev server started, on the port the Worker's module read from the environment: it
    // is loaded by the import above, after the environment was set here, and never before (a module that read it earlier would
    // read nothing, and Alchemy would pick a port of its own). This one request only confirms it answers: this path names no
    // role, so the object refuses it and the Worker answers 500.
    yield* HttpClient.get(`http://127.0.0.1:${port}/ready`).pipe(
      Effect.retry({ times: 100, schedule: Schedule.spaced("100 millis") }),
    );

    return { port };
  }).pipe(Effect.provide([NodeServices.layer, FetchHttpClient.layer])),
);

const encodeCommand = Schema.encodeEffect(Schema.fromJsonString(Command));

type Answered = typeof Report.cases.Answered.Type;

type ClosedByServer = typeof Report.cases.ClosedByServer.Type;

/** The next report on a client's inbox, decoded; a defect when none comes in time. */
const nextReport = (client: Client) =>
  Queue.take(client.inbox).pipe(
    Effect.timeout(REPORT),
    Effect.flatMap(Schema.decodeUnknownEffect(ReportText)),
    Effect.orDie,
  );

/** The next report if one comes within `SETTLE`, and none otherwise. */
const maybeReport = (client: Client) =>
  Queue.take(client.inbox).pipe(
    Effect.timeoutOption(SETTLE),
    Effect.flatMap((text) =>
      Option.match(text, {
        onNone: () => Effect.succeedNone,
        onSome: (found) => Effect.asSome(Schema.decodeUnknownEffect(ReportText)(found)),
      }),
    ),
    Effect.orDie,
  );

/** The answer to a write or a read on the main socket. */
const nextAnswer = (client: Client, step: string) =>
  Effect.flatMap(nextReport(client), (report) =>
    Report.guards.Answered(report)
      ? Effect.succeed(report)
      : Effect.die(new Error(`${step} was answered with ${report._tag}`)),
  );

/** The report of a server close on the log socket. */
const nextClosedByServer = (client: Client, step: string) =>
  Effect.flatMap(nextReport(client), (report) =>
    Report.guards.ClosedByServer(report)
      ? Effect.succeed(report)
      : Effect.die(new Error(`${step} was followed by ${report._tag}`)),
  );

/** One close, set up on an object of its own: a main socket and a log socket, and the value written to the main one. */
interface Opened {
  readonly close: Close;
  readonly main: Client;
  readonly log: Client;
  readonly wake: string;
}

let sequence = 0;

const open = (port: number, run: number) => (close: Close, index: number) =>
  Effect.gen(function* () {
    const base = `ws://127.0.0.1:${port}/r0-${run}-${index}`;
    // The log socket first, so no event can happen before it is there to carry it.
    const log = yield* connect(`${base}/log`);
    const main = yield* connect(`${base}/main`);

    yield* main.send(yield* encodeCommand(Command.cases.write.make({ value: close.attached })));
    const written = yield* nextAnswer(main, `${close.id}: the write`);

    return { close, main, log, wake: written.wake } satisfies Opened;
  }).pipe(Effect.orDie);

/** What one object showed: each is a fact the law reads after every object was seen. */
interface Seen {
  readonly close: Close;
  readonly firstWake: string;
  readonly after: Answered;
  readonly closedByServer: Option.Option<ClosedByServer>;
  readonly events: ReadonlyArray<typeof Report.Type>;
  readonly clientSaw: Option.Option<Socket.SocketError>;
}

/** The part of one object's run that comes after the idle wait: read, then close, then watch. */
const observe = (opened: Opened) =>
  Effect.gen(function* () {
    const { close, main, log } = opened;

    // (1) the first message after the idle wait.
    yield* main.send(yield* encodeCommand(Command.cases.read.make({})));
    const after = yield* nextAnswer(main, `${close.id}: the read`);

    // (2) and (3): who closes first.
    let closedByServer: Option.Option<ClosedByServer> = Option.none();

    if (close.by === "server") {
      yield* main.send(yield* encodeCommand(Command.cases.close.make({ code: close.code, reason: close.reason })));
      closedByServer = Option.some(yield* nextClosedByServer(log, `${close.id}: the close`));
    } else {
      yield* main.close(close.code, close.reason);
    }

    // Every report on the log socket from now on, until none comes within `SETTLE`: one close event for a client close, and
    // one or none after a server close.
    const events: Array<typeof Report.Type> = [];

    for (let next = yield* maybeReport(log); Option.isSome(next); next = yield* maybeReport(log)) {
      events.push(next.value);
    }

    return {
      close,
      firstWake: opened.wake,
      after,
      closedByServer,
      events,
      clientSaw: yield* Deferred.isDone(main.ended).pipe(
        Effect.flatMap((done) => (done ? Effect.asSome(Deferred.await(main.ended)) : Effect.succeedNone)),
      ),
    } satisfies Seen;
  });

/** What a report says about the attachment: the word for it. */
const attachmentIn = Report.match({
  Answered: ({ attachment }) => attachment._tag,
  ClosedByServer: ({ attachment }) => attachment._tag,
  CloseEvent: ({ attachment }) => attachment._tag,
  ErrorEvent: ({ attachment }) => attachment._tag,
});

/** One report, in words: a close event with what it holds, or the report's own name. */
const eventIn = Report.matchOrElse(
  {
    CloseEvent: ({ code, reason, wasClean, attachment }) =>
      `event ${code} ${Formatter.formatJson(reason)} clean ${wasClean} attachment ${attachment._tag}`,
  },
  (other) => other._tag,
);

/** The code and reason of a close event, or the report's own name when it is not one. */
const whoAndWhy = Report.matchOrElse({ CloseEvent: ({ code, reason }) => [String(code), reason] }, (other) => [
  other._tag,
]);

/** What the client's stream ended with. */
const clientEnd = (saw: Option.Option<Socket.SocketError>): string =>
  Option.match(saw, {
    onNone: () => "no end",
    onSome: ({ reason }) => (Predicate.isTagged(reason, "SocketCloseError") ? `close ${reason.code}` : reason._tag),
  });

/** What a server close shows after its own call: the close event and its attachment, or that no event came. */
const afterServerClose = ({ events }: Seen): string => {
  const [first] = events;

  return first === undefined ? "no close event" : eventIn(first);
};

/** The `R0 FACT` lines of one run: what the stand-in's two constants are written from. */
const facts = (seen: ReadonlyArray<Seen>): ReadonlyArray<string> => {
  const servers = seen.filter(({ close }) => close.by === "server");
  const clients = seen.filter(({ close }) => close.by === "client");
  const words = (found: ReadonlyArray<string>) => [...new Set(found)].join(" and ");
  const reports = servers.flatMap(({ closedByServer }) => Option.toArray(closedByServer));

  return [
    `R0 FACT sleep: ${seen.filter(({ after, firstWake }) => after.wake !== firstWake).length} of ${seen.length} objects had a new wake token after ${IDLE}`,
    `R0 FACT server close: send after it threw ${words(reports.map(({ sent }) => String(sent)))}`,
    `R0 FACT server close: the attachment in the same call was ${words(reports.map(attachmentIn))}`,
    `R0 FACT server close: then ${words(servers.map(afterServerClose))}`,
    `R0 FACT server close: the client saw ${words(servers.map(({ clientSaw }) => clientEnd(clientSaw)))}`,
    `R0 FACT client close: ${clients.map(({ close, events }) => `${close.code} gave ${events.map(eventIn).join(" then ") || "no event"}`).join("; ")}`,
  ];
};

layer(deployed, { excludeTestServices: true, timeout: "120 seconds" })("R0 the probe of real workerd", (it) => {
  it.effect.prop(
    "R0 property: after 12 idle seconds an object sleeps with its attachment kept; after a server close send throws a TypeError; after a client close one event comes with its code and reason",
    { seeds: Arbitrary.array(platformCloses, { minLength: 3, maxLength: 3 }) },
    ({ seeds }) =>
      Effect.gen(function* () {
        const { port } = yield* Deployed;
        const closes = closesFrom(seeds);
        const run = (sequence += 1);

        expect([...new Set(closes.map(({ id }) => id))], "every class of (r) is reached by every run").toEqual([
          ...CLOSE_CLASSES,
        ]);

        const opened = yield* Effect.forEach(closes, open(port, run), { concurrency: "unbounded" });

        // The one wait: every object is left alone together.
        yield* Effect.sleep(IDLE);

        const seen = yield* Effect.forEach(opened, observe, { concurrency: "unbounded" });

        // The facts are printed before any is asserted, so a red run still tells what the platform did.
        yield* Console.log(facts(seen).join("\n"));

        // (1) a new wake, and the attachment written before.
        for (const { close, firstWake, after } of seen) {
          expect(after.wake, `${close.id}: the message after ${IDLE} finds a new wake token`).not.toBe(firstWake);
          expect(after.attachment, `${close.id}: and the attachment is the one written before`).toEqual(
            Attachment.cases.kept.make({ value: close.attached }),
          );
        }

        // (2) `send` after a server close throws a TypeError, the client ends with the server's code, and what follows is one
        // answer for every code and reason.
        const servers = seen.filter(({ close }) => close.by === "server");

        for (const { close, closedByServer, clientSaw } of servers) {
          expect(
            Option.map(closedByServer, ({ sent }) => sent),
            `${close.id}: send after the server's close throws a TypeError`,
          ).toEqual(Option.some("TypeError"));
          expect(clientEnd(clientSaw), `${close.id}: the client's stream ended with the server's code`).toBe(
            `close ${close.code}`,
          );
        }

        expect(
          [...new Set(servers.map(afterServerClose))],
          "a server close shows the same close event, or none, for every code and reason",
        ).toHaveLength(1);

        // (3) one close event for a client close, with the client's code and reason.
        for (const { close, events } of seen.filter(({ close: one }) => one.by === "client")) {
          expect(
            events.map(whoAndWhy),
            `${close.id}: exactly one close event comes, with the client's code and reason`,
          ).toEqual([[String(close.code), close.reason]]);
        }
      }),
    { arbitrary: { seed: SEED, runs: 1 } },
  );
});
