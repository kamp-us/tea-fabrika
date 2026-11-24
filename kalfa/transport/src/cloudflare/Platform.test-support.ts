// What the platform laws share (slice 1 of ticket 2067): the generator of the closes a socket can see, and the client that
// talks to the probe Worker (`platform-worker.test-support.ts`) over a real WebSocket. Every generator is an Effect Arbitrary,
// built on the pieces `../Transport.test-support.ts` exports, which this file imports and never edits. Each law makes, from
// each draw, one input for every class it names, so every class is reached in every run.
import { request } from "node:http";
import { createServer } from "node:net";
import { NodeSocket } from "@effect/platform-node";
import { Arbitrary, Console, Deferred, Effect, Formatter, Option, Predicate, Queue } from "effect";
import type { Scope } from "effect";
import { Socket } from "effect/socket";
import { between, word } from "../Transport.test-support.ts";

// ---- (r) the closes a socket can see

/** What one drawn run holds for a close: the made-up parts every class is built from. */
interface CloseSeed {
  readonly high: number;
  readonly low: number;
  readonly word: string;
  readonly value: string;
}

/**
 * The generator `platformCloses`, the class (r) of the plan: a seed from which a server close (1000, and 3000 to 4999 with a
 * reason) and a client close (1000, 1001, and 3000 to 4999) are made, each with a reason of up to 123 bytes of UTF-8.
 */
export const platformCloses: Arbitrary.Arbitrary<CloseSeed> = Arbitrary.all({
  high: between(3000, 4999),
  low: between(3000, 4999),
  word,
  value: word,
});

/** One close a law makes: who starts it, with what code and reason, and the value the socket's attachment holds first. */
export interface Close {
  readonly id: (typeof CLOSE_CLASSES)[number];
  readonly by: "server" | "client";
  readonly code: number;
  readonly reason: string;
  readonly attached: string;
}

/** The classes of (r) a law must reach, in order. */
export const CLOSE_CLASSES = [
  "server 1000",
  "server 3000 to 4999",
  "client 1000",
  "client 1001",
  "client 3000 to 4999",
] as const;

/**
 * One close for each class of (r), for each seed. The reasons are empty, ASCII, and letters past ASCII, each far under the 123
 * bytes RFC 6455 allows.
 */
export const closesFrom = (seeds: ReadonlyArray<CloseSeed>): ReadonlyArray<Close> =>
  seeds.flatMap((seed, index) => {
    const reasons = ["", seed.word, `çok güzel ${seed.word} ü`];
    const reason = reasons[index % reasons.length] ?? "";

    const made = (id: Close["id"], by: Close["by"], code: number): Close => ({
      id,
      by,
      code,
      reason,
      attached: `${seed.value}-${index}`,
    });

    return [
      made("server 1000", "server", 1000),
      made("server 3000 to 4999", "server", seed.high),
      made("client 1000", "client", 1000),
      made("client 1001", "client", 1001),
      made("client 3000 to 4999", "client", seed.low),
    ];
  });

// ---- a client of the probe Worker

/** The client's end of one real WebSocket. */
export interface Client {
  readonly send: (text: string) => Effect.Effect<void, Socket.SocketError>;
  readonly close: (code: number, reason: string) => Effect.Effect<void, Socket.SocketError>;
  /** The text frames the server sent, in order. */
  readonly inbox: Queue.Queue<string>;
  /** Set once, with the error the socket ended with: Effect's reader ends every socket with one, a clean close included. */
  readonly ended: Deferred.Deferred<Socket.SocketError>;
}

/**
 * What a server answers to a WebSocket upgrade request for `url`, in words: the status, the headers and the start of the body when
 * it is no upgrade, or that it upgraded. A WebSocket client says only that the handshake failed, and this says why.
 */
export const dial = (url: string): Effect.Effect<string> =>
  Effect.callback<string>((resume) => {
    const asked = request(url.replace(/^ws/, "http"), {
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    });

    asked.on("upgrade", (response, socket) => {
      socket.destroy();
      resume(
        Effect.succeed(
          `upgraded with status ${response.statusCode} and headers ${Formatter.formatJson(response.headers)}`,
        ),
      );
    });
    asked.on("response", (response) => {
      let body = "";

      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
      });
      response.on("end", () => {
        resume(
          Effect.succeed(
            `no upgrade: status ${response.statusCode}, headers ${Formatter.formatJson(response.headers)}, body ${Formatter.formatJson(body.slice(0, 600))}`,
          ),
        );
      });
    });
    asked.on("error", (error) => resume(Effect.succeed(`the request failed: ${error.message}`)));
    asked.end();

    return Effect.sync(() => asked.destroy());
  }).pipe(Effect.timeoutOption("5 seconds"), Effect.map(Option.getOrElse(() => "no answer in 5 seconds")));

/** Connects to `url` and reads it in the background until the scope ends. A failed open is told, with what the server answers. */
export const connect = (url: string): Effect.Effect<Client, Socket.SocketError, Scope.Scope> =>
  Effect.gen(function* () {
    const socket = yield* Effect.provide(Socket.Socket, NodeSocket.layerWebSocket(url));
    const writer = yield* socket.writer;

    const { pull } = yield* socket.reader.pipe(
      Effect.tapError((error) =>
        Effect.flatMap(dial(url), (answered) =>
          Console.log(
            `R0 OPEN FAILED dialing ${url}: ${Formatter.format(error.reason)}; a plain upgrade request gets ${answered}`,
          ),
        ),
      ),
    );

    const inbox = yield* Queue.unbounded<string>();
    const ended = yield* Deferred.make<Socket.SocketError>();
    const decoder = new TextDecoder();

    yield* Effect.forkScoped(
      Effect.forever(
        Effect.flatMap(pull, (chunks) =>
          Queue.offerAll(
            inbox,
            chunks.map((chunk) => (Predicate.isString(chunk) ? chunk : decoder.decode(chunk))),
          ),
        ),
      ).pipe(Effect.catch((error) => Deferred.succeed(ended, error))),
    );

    return {
      send: (text) => writer.write(text),
      close: (code, reason) => writer.write(new Socket.CloseEvent(code, reason)),
      inbox,
      ended,
    };
  });

/** A TCP port on 127.0.0.1 that was free a moment ago. The probe's Worker binds it right after, in this process's own run. */
export const freePort: Effect.Effect<number> = Effect.callback<number>((resume) => {
  const server = createServer();

  server.listen({ port: 0, host: "127.0.0.1", exclusive: true }, () => {
    const address = server.address();
    const port = Predicate.hasProperty(address, "port") ? Number(address.port) : 0;

    server.close(() => resume(Effect.succeed(port)));
  });
});
