// What the laws of the platform's rules share (slice 1 of ticket 2067, laws M1 to M5): the generators, the raw gateway they run
// against, the world they run in, and the suite itself. One suite runs on two worlds, the stand-in (`@kalfa/transport/cloudflare/memory`)
// on every pull request and real workerd (`PlatformLaws.integration.test.ts`) in the proof run, so the stand-in is held to what the
// platform does. Every generator is an Effect Arbitrary, built on `../Transport.test-support.ts`, which this file imports and never
// edits. Each law makes, from each draw, one input for every class it names, so every class is reached in every run.
import { expect } from "@effect/vitest";
import type { Vitest } from "@effect/vitest";
import { Arbitrary, Deferred, Effect, Predicate, Queue, Schema } from "effect";
import type { Scope, Duration } from "effect";
import type { Socket } from "effect/socket";
import { between, SEED, wellFormedText, word } from "../Transport.test-support.ts";
import * as MemoryGateway from "./MemoryGateway.ts";
import { GateCommand, GateCommandText, GateReport, GateReportText } from "./platform-gate-wire.test-support.ts";
import { rawGateway } from "./platform-gateway.test-support.ts";
import { Attachment } from "./platform-wire.test-support.ts";
import { clientOn, CLOSE_CLASSES, closesFrom, platformCloses, SERVER_CLOSE_EVENT } from "./Platform.test-support.ts";
import type { Client } from "./Platform.test-support.ts";

/** A JSON value: what an attachment or a body holds in these laws. */
type Json = typeof Schema.Json.Type;

type Report = typeof GateReport.Type;

type Reply = typeof GateReport.cases.Reply.Type;

// ---- a world: where the laws run

/** One client of the raw gateway, and the reports the gateway makes: what the world gives a law to talk to. */
export interface Session {
  readonly client: Client;
  readonly reports: Queue.Queue<Report>;
}

/** Where a suite runs: the stand-in, or real workerd. It says what the world can do, so a law asks no more than it can have. */
export interface World {
  readonly kind: "stand-in" | "workerd";
  /** The most times a law may let the object sleep in one run: a real sleep waits for the platform's idle timer. */
  readonly maxSleeps: number;
  /** How long a law waits for a reply that must come. */
  readonly patience: Duration.Input;
  /** One client connecting, as the app's route would call `gateway.upgrade(options)`. */
  readonly open: (options?: { readonly traceFrames?: boolean }) => Effect.Effect<Session, never, Scope.Scope>;
  /** A socket accepted outside the gateway, with no attachment of its own. */
  readonly stranger: Effect.Effect<Session, never, Scope.Scope>;
  /** The object sleeps: its memory and Layers are dropped and built again on the next event. */
  readonly sleep: Effect.Effect<void>;
  /** Waits long enough for an event that would come to have come, so that none having come can be told. */
  readonly settle: Effect.Effect<void>;
  /** The platform reports the socket broken (an error event). Only the stand-in can say it. */
  readonly drop?: (session: Session) => Effect.Effect<void>;
}

/** The stand-in as a world: a fresh one for each run, its reports kept in one queue the test reads. */
export const memoryWorld: Effect.Effect<World, never, Scope.Scope> = Effect.gen(function* () {
  const reports = yield* Queue.unbounded<Report>();

  const gateway = yield* MemoryGateway.make(
    rawGateway((made): Effect.Effect<void> => Effect.asVoid(Queue.offer(reports, made))),
  );

  const sockets = new WeakMap<Client, Socket.Socket>();
  let count = 0;

  const session = (socket: Socket.Socket) =>
    Effect.map(Effect.orDie(clientOn(socket, `stand-in socket ${(count += 1)}`)), (client) => {
      sockets.set(client, socket);

      return { client, reports } satisfies Session;
    });

  return {
    kind: "stand-in",
    maxSleeps: 3,
    patience: "2 seconds",
    open: (options) => Effect.flatMap(gateway.connect(options), session),
    stranger: Effect.flatMap(gateway.stranger, session),
    sleep: gateway.sleep,
    // The stand-in runs its events as fibers in this process: letting them all run is enough.
    settle: Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, { concurrency: 1, discard: true }),
    drop: ({ client }) => {
      const socket = sockets.get(client);

      return socket === undefined ? Effect.void : gateway.drop(socket);
    },
  };
});

// ---- what a law says to a session

const encodeCommand = Schema.encodeEffect(GateCommandText);

/** The next frame the server sent, as text; a defect when none comes in time. */
const nextFrame = (world: World, client: Client) =>
  Effect.orDie(Effect.timeout(Queue.take(client.inbox), world.patience));

/** The next report the gateway made; a defect when none comes in time. */
const nextReport = (world: World, session: Session) =>
  Effect.orDie(Effect.timeout(Queue.take(session.reports), world.patience));

/** Sends one command and takes the reply to it. */
const ask = (world: World, session: Session, command: typeof GateCommand.Type) =>
  Effect.gen(function* () {
    yield* Effect.orDie(session.client.send(yield* Effect.orDie(encodeCommand(command))));

    return yield* nextReply(world, session.client);
  });

/** The next frame, read as a reply of the gateway. */
const nextReply = (world: World, client: Client) =>
  Effect.flatMap(nextFrame(world, client), (text) =>
    Effect.flatMap(Effect.orDie(Schema.decodeUnknownEffect(GateReportText)(text)), (report) =>
      GateReport.guards.Reply(report)
        ? Effect.succeed(report)
        : Effect.die(new Error(`a reply was expected and ${report._tag} came`)),
    ),
  );

/** Every report waiting now, taken; none waiting is an empty list, not a wait. */
const drained = (session: Session) => Queue.clear(session.reports);

// ---- the generators

/** What one drawn run holds for (q): the made-up parts every class is built from. */
interface AttachmentSeed {
  readonly text: string;
  readonly n: number;
  readonly words: ReadonlyArray<string>;
  readonly big: number;
  readonly sleeps: ReadonlyArray<boolean>;
}

/**
 * The generator `attachments`, class (q): values to store, each under 4 KiB of JSON (text with quotes and letters past ASCII, a number, a
 * list, a nested object), a value over 32 KiB of JSON, a value holding a function, and an object changed after it was written. The flags
 * say after which store the object sleeps.
 */
const attachments: Arbitrary.Arbitrary<AttachmentSeed> = Arbitrary.all({
  text: wellFormedText,
  n: between(-1_000_000, 1_000_000),
  words: Arbitrary.array(word, { maxLength: 20 }),
  big: between(33_000, 40_000),
  sleeps: Arbitrary.array(Arbitrary.schema(Schema.Boolean), { minLength: 4, maxLength: 4 }),
});

/** What one drawn run holds for (j): how many frames, and before which ones the object sleeps. */
interface SleepSeed {
  readonly text: string;
  readonly frames: number;
  readonly sleepsAt: ReadonlyArray<number>;
}

/** The generator `sleeps`, class (j): runs of 2 to 8 frames with a sleep at 0 to 3 drawn places, the first frame's included. */
const sleeps: Arbitrary.Arbitrary<SleepSeed> = Arbitrary.all({
  text: wellFormedText,
  frames: between(2, 8),
  sleepsAt: Arbitrary.array(between(0, 7), { maxLength: 3 }),
});

/** The generator `overlap`, class (n): 2 to 10 frames sent at once while the first is held. */
const overlap: Arbitrary.Arbitrary<{ readonly frames: number }> = Arbitrary.all({ frames: between(2, 10) });

/** The options of `upgrade` a typed caller writes, and a drawn number of frames the server sends and of frames a stranger sends. */
interface UpgradeSeed {
  readonly choice: number;
  readonly burst: number;
  readonly stranger: number;
  readonly sleepBetween: boolean;
}

/** The generator for M5: which options `connect` is given, how many frames the server sends, and how many a stranger sends. */
const upgrades: Arbitrary.Arbitrary<UpgradeSeed> = Arbitrary.all({
  choice: between(0, 3),
  burst: between(1, 20),
  stranger: between(1, 5),
  sleepBetween: Arbitrary.schema(Schema.Boolean),
});

/** The options a typed caller may write for `upgrade`, in the order the generator picks them. */
const UPGRADE_OPTIONS: ReadonlyArray<{ readonly traceFrames?: boolean } | undefined> = [
  undefined,
  {},
  { traceFrames: true },
  { traceFrames: false },
];

// ---- the suite

/** How a suite runs: how many runs a law gets, how many draws each run holds, and whether the draws run side by side. */
interface SuiteOptions {
  readonly runs: number;
  readonly draws: number;
  readonly concurrency: 1 | "unbounded";
}

/**
 * The laws M1 to M5, registered on `tester`, each run on a world that `make` builds fresh for each draw. The stand-in runs many runs of
 * one draw; real workerd runs one run of several draws side by side, so the idle wait of a sleep is waited once.
 */
export const platformLaws = <R>(
  tester: Vitest.Tester<Scope.Scope | R>,
  make: Effect.Effect<World, never, Scope.Scope | R>,
  options: SuiteOptions,
): void => {
  const check = { arbitrary: { seed: SEED, runs: options.runs } };
  // M5 runs at most 200: its draws are small and 200 reach every class.
  const fewer = { arbitrary: { seed: SEED, runs: Math.min(options.runs, 200) } };

  const draws = <A>(arbitrary: Arbitrary.Arbitrary<A>) =>
    Arbitrary.array(arbitrary, { minLength: options.draws, maxLength: options.draws });

  /** Runs `body` on a world of its own for each draw. */
  const each = <A, R>(drawn: ReadonlyArray<A>, body: (world: World, seed: A) => Effect.Effect<void, never, R>) =>
    Effect.forEach(drawn, (seed) => Effect.flatMap(make, (world) => body(world, seed)), {
      concurrency: options.concurrency,
      discard: true,
    });

  // M1. Plant: store the attachment by reference (no `structuredClone`): the change after the write is seen, "mutated" is red; clear
  // the value when a write is refused: the read after the big value finds nothing, "big" is red.
  tester.prop(
    "M1 property: an attachment is stored by clone, read back equal after every sleep, and refused above 16384 bytes of JSON or holding a function, with the value before kept",
    { seeds: draws(attachments) },
    ({ seeds }) =>
      each(seeds, (world, seed) =>
        Effect.gen(function* () {
          const session = yield* world.open();
          const nested: Json = { label: seed.text, count: seed.n, items: [...seed.words] };

          const small: ReadonlyArray<readonly [string, Json]> = [
            ["text", seed.text],
            ["number", seed.n],
            ["list", [seed.n, ...seed.words]],
            ["nested", nested],
          ];

          let slept = 0;

          const sleepIf = (flag: boolean | undefined) =>
            flag === true && slept < world.maxSleeps
              ? Effect.andThen(
                  Effect.sync(() => {
                    slept += 1;
                  }),
                  world.sleep,
                )
              : Effect.void;

          for (const [index, [id, value]] of small.entries()) {
            const put = yield* ask(world, session, GateCommand.cases.put.make({ value }));

            expect(put.body, `${id}: the store is accepted`).toEqual({ stored: true });
            yield* sleepIf(seed.sleeps[index]);

            const got = yield* ask(world, session, GateCommand.cases.get.make({}));

            expect(got.body, `${id}: read back equal`).toEqual({ value });
          }

          // An object changed after it was written: the platform stored a clone, so the change is not seen.
          const mutated = yield* ask(world, session, GateCommand.cases.putMutated.make({ value: nested }));

          // What the object holds from now on is `{ value: nested }`: the stored object as written, without the change after it.
          const afterMutated: Json = { value: nested };

          expect(mutated.body, "mutated: the store is accepted and the change after it is not seen").toEqual({
            outcome: { stored: true },
            read: { value: afterMutated },
          });

          const big = yield* ask(world, session, GateCommand.cases.put.make({ value: "x".repeat(seed.big) }));

          expect(big.body, "big: a value over 16384 bytes of JSON is refused as a write").toEqual({
            refused: "write",
            alchemy: true,
          });
          expect(
            (yield* ask(world, session, GateCommand.cases.get.make({}))).body,
            "big: and the value before is kept",
          ).toEqual({ value: afterMutated });

          const fn = yield* ask(world, session, GateCommand.cases.putFunction.make({}));

          expect(fn.body, "function: a value holding a function is refused as a write").toEqual({
            refused: "write",
            alchemy: true,
          });
          yield* sleepIf(true);
          expect(
            (yield* ask(world, session, GateCommand.cases.get.make({}))).body,
            "function: and the value before is kept, after a sleep too",
          ).toEqual({ value: afterMutated });
        }),
      ),
    check,
  );

  // M2. Plant: keep the built Layer through `sleep`: the wake token stays after a sleep, the first check is red; give the same socket
  // object to each event: `fresh` is false from the second event, the second check is red.
  tester.prop(
    "M2 property: after each sleep memory and Layers are built again, every open socket stays open with its attachment, and a socket's identity is new for each event",
    { seeds: draws(sleeps) },
    ({ seeds }) =>
      each(seeds, (world, seed) =>
        Effect.gen(function* () {
          const session = yield* world.open();
          const at = new Set(seed.sleepsAt.filter((place) => place < seed.frames).slice(0, world.maxSleeps));
          const replies: Array<Reply> = [];
          const slept: Array<boolean> = [];

          for (let frame = 0; frame < seed.frames; frame++) {
            slept.push(at.has(frame));

            if (at.has(frame)) {
              yield* world.sleep;
            }

            replies.push(
              yield* ask(
                world,
                session,
                frame === 0 ? GateCommand.cases.put.make({ value: seed.text }) : GateCommand.cases.ping.make({}),
              ),
            );
          }

          for (const [frame, reply] of replies.entries()) {
            const before = replies[frame - 1];

            if (before !== undefined) {
              expect(
                reply.wake !== before.wake,
                `frame ${frame}: the wake token is new exactly when the object slept before it`,
              ).toBe(slept[frame]);
            }

            expect(reply.fresh, `frame ${frame}: the socket is new to the gateway for each event`).toBe(true);
          }

          expect(Deferred.isDoneUnsafe(session.client.ended), "the socket stays open through every sleep").toBe(false);
          expect((yield* ask(world, session, GateCommand.cases.get.make({}))).body, "and its attachment stays").toEqual(
            { value: seed.text },
          );
        }),
      ),
    check,
  );

  // M3. Plant: deliver the messages one slot call at a time (wait for a call to end before the next starts): the pings are not answered
  // while the first is held, and the wait for the first ping reply times out.
  tester.prop(
    "M3 property: a message the client writes is delivered while an earlier slot call still runs, in the order written, one slot call for each message",
    { seeds: draws(overlap) },
    ({ seeds }) =>
      each(seeds, (world, seed) =>
        Effect.gen(function* () {
          const session = yield* world.open();

          const send = (command: typeof GateCommand.Type) =>
            Effect.orDie(Effect.flatMap(encodeCommand(command), (text) => session.client.send(text)));

          // All at once: the first is held, and nothing answers it until it is released.
          yield* send(GateCommand.cases.hold.make({}));

          for (let frame = 1; frame < seed.frames; frame++) {
            yield* send(GateCommand.cases.ping.make({}));
          }

          const pings: Array<Reply> = [];

          for (let frame = 1; frame < seed.frames; frame++) {
            pings.push(yield* nextReply(world, session.client));
          }

          expect(
            pings.map(({ seq }) => seq),
            "each message is one slot call, started in the order written, while the first still runs",
          ).toEqual(Array.from({ length: seed.frames - 1 }, (_, index) => index + 2));
          expect(Math.max(...pings.map(({ active }) => active)), "slot calls overlap").toBeGreaterThanOrEqual(2);

          yield* send(GateCommand.cases.release.make({}));
          const rest = [yield* nextReply(world, session.client), yield* nextReply(world, session.client)];

          expect(
            [...rest.map(({ seq }) => seq)].sort((left, right) => left - right),
            "the release and the held call each answer once",
          ).toEqual([1, seed.frames + 1]);
        }),
      ),
    check,
  );

  // M4. Plant: let `send` after a server close succeed: the TypeError check is red; give two close events for one client close: the
  // "exactly one" check is red; give the server close's event the server's reason: the reason check is red.
  tester.prop(
    "M4 property: send after the server's close throws, the close event after it is as real workerd gave it, a client close gives exactly one event with its code and reason, and an error event gives webSocketError",
    { seeds: draws(platformCloses) },
    ({ seeds }) =>
      each(seeds, (world, seed) =>
        Effect.gen(function* () {
          const closes = closesFrom([seed]);

          expect([...new Set(closes.map(({ id }) => id))], "every class of (r) is reached").toEqual([...CLOSE_CLASSES]);

          for (const close of closes) {
            const session = yield* world.open();
            const attached = Attachment.cases.kept.make({ value: close.attached });

            yield* ask(world, session, GateCommand.cases.put.make({ value: close.attached }));
            yield* drained(session);

            if (close.by === "server") {
              yield* Effect.orDie(
                Effect.flatMap(
                  encodeCommand(GateCommand.cases.close.make({ code: close.code, reason: close.reason })),
                  (text) => session.client.send(text),
                ),
              );
              const first = yield* nextReport(world, session);

              expect(
                GateReport.guards.ClosedByServer(first) ? [first.sent, first.attachment] : [first._tag],
                `${close.id}: send after the server's close throws a TypeError, and the attachment is still there`,
              ).toEqual(["TypeError", attached]);

              const event = yield* nextReport(world, session);

              expect(
                GateReport.guards.CloseEvent(event)
                  ? [event.code, event.reason, event.wasClean, event.attachment]
                  : [event._tag],
                `${close.id}: a close event comes later, as real workerd gave it (code the client's Close frame carried, no reason, clean, attachment kept)`,
              ).toEqual([close.code, SERVER_CLOSE_EVENT.reason, SERVER_CLOSE_EVENT.wasClean, attached]);

              const ended = yield* Effect.orDie(Effect.timeout(Deferred.await(session.client.ended), world.patience));

              expect(
                Predicate.isTagged(ended.error.reason, "SocketCloseError") ? ended.error.reason.code : undefined,
                `${close.id}: the client saw the server's code`,
              ).toBe(close.code);
            } else {
              yield* Effect.orDie(session.client.close(close.code, close.reason));
              const event = yield* nextReport(world, session);

              expect(
                GateReport.guards.CloseEvent(event)
                  ? [event.code, event.reason, event.wasClean, event.attachment]
                  : [event._tag],
                `${close.id}: the event carries the client's code and reason`,
              ).toEqual([close.code, close.reason, true, attached]);
            }

            yield* world.settle;
            expect(
              (yield* drained(session)).map(({ _tag }) => _tag),
              `${close.id}: exactly one close event comes`,
            ).toEqual([]);
          }

          if (world.drop !== undefined) {
            const session = yield* world.open();

            yield* ask(world, session, GateCommand.cases.put.make({ value: "broken" }));
            yield* drained(session);
            yield* world.drop(session);
            const event = yield* nextReport(world, session);

            expect(event._tag, "an error event gives webSocketError, and no close event").toBe("ErrorEvent");
          }
        }),
      ),
    check,
  );

  // M5. Plant: give a stranger an empty object as its attachment: the stranger's `get` finds a value, not `missing`; make `upgrade` drop
  // its options: the options check is red; send the frames in another order: the burst check is red.
  tester.prop(
    "M5 property: a stranger has no attachment and its events reach the slots, and connect reaches upgrade with the options as given and delivers what the server sends in order",
    { seeds: draws(upgrades) },
    ({ seeds }) =>
      each(seeds, (world, seed) =>
        Effect.gen(function* () {
          const given = UPGRADE_OPTIONS[seed.choice % UPGRADE_OPTIONS.length];
          const session = yield* world.open(given);
          const upgraded = yield* nextReport(world, session);

          expect(
            GateReport.guards.Upgraded(upgraded) ? upgraded.options : upgraded._tag,
            "upgrade is called with the options as given",
          ).toEqual(given ?? null);

          yield* Effect.orDie(
            Effect.flatMap(encodeCommand(GateCommand.cases.burst.make({ n: seed.burst })), (text) =>
              session.client.send(text),
            ),
          );
          const frames: Array<string> = [];

          for (let index = 0; index < seed.burst; index++) {
            frames.push(yield* nextFrame(world, session.client));
          }

          expect(frames, "what the server sends arrives in order").toEqual(
            Array.from({ length: seed.burst }, (_, index) => `burst-${index}`),
          );

          // A stranger: a socket accepted outside the gateway.
          const stranger = yield* world.stranger;

          for (let index = 0; index < seed.stranger; index++) {
            if (index === 1 && seed.sleepBetween) {
              yield* world.sleep;
            }

            const reply = yield* ask(world, stranger, GateCommand.cases.get.make({}));

            expect(reply.body, "a stranger has no attachment").toEqual({ refused: "missing", alchemy: true });
          }

          yield* Effect.orDie(stranger.client.close(1000, ""));
          const event = yield* nextReport(world, stranger);

          expect(
            GateReport.guards.CloseEvent(event) ? [event.code, event.attachment] : [event._tag],
            "a stranger's close event reaches the slot, with no attachment",
          ).toEqual([1000, Attachment.cases.gone.make({})]);
          yield* world.settle;
        }),
      ),
    fewer,
  );
};
