/**
 * The start of a window client: it boots the window parent on tea's Effect engine and does its
 * input and output. Each Cmd becomes a write on its dial's socket or a call to a service, and each
 * socket event becomes a Msg. It decides nothing: the parent's Model says which dial is current.
 * The same start runs in a browser tab and in a program with no DOM.
 */
import { run } from "@demlik/tea/effect";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Socket from "effect/socket/Socket";
import type * as Stream from "effect/Stream";
import * as Id from "../Id.ts";
import { TileId } from "../tezgah/Workspace.ts";
import { ClientKey, type Identity } from "../transport/ClientKey.ts";
import { ClientRow, ClientRows, ErrorClass } from "../transport/ClientRows.ts";
import { helloText } from "../transport/Hello.ts";
import { writeSshsig } from "../transport/Sshsig.ts";
import { Hello } from "../transport/Wire.ts";
import { dialer, type Handle, send as sendOn } from "./internal/dial.ts";
import type { WindowMsg, windowMachineFor, write } from "./WindowMachine.ts";

/**
 * Schema for the facts a client states about itself: the hello's `platform`, `os` and `has`, and
 * the `label` its knock shows the person who grants it.
 *
 * @category models
 */
export const ClientInfo = Schema.Struct({
  platform: Hello.fields.platform,
  os: Hello.fields.os,
  has: Hello.fields.has,
  label: Schema.String,
});

/**
 * What a start is given: the tiles to show or a tezgah workspace, the window parent, the brain's origin, the build that
 * runs and the client's own facts. Plain data and the machine, so any client can pass it.
 *
 * @category models
 */
export type StartOptions = {
  readonly tiles: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** The window shows this workspace of its person's tezgah, in place of `tiles`. */
  readonly tezgah?: { readonly workspace: number };
  readonly window: ReturnType<typeof windowMachineFor>;
  readonly origin: string;
  readonly build: string;
  readonly client: typeof ClientInfo.Type;
};

const Failure = Schema.TaggedUnion({
  unreachable: {},
  unknown: {},
  entropy: {},
  failed: {},
  unsupported: {},
  closed: {},
  key: { error: ErrorClass },
});

const F = Failure.cases;
type Write = ReturnType<typeof write>;

/** One call as the JSON-RPC method and params the door takes. */
const wire = (call: Write["call"], label: string) => {
  switch (call._tag) {
    case "read":
      return { method: "ledger.read", params: { stream: call.stream, after: call.after } };
    case "wait":
      return { method: "ledger.wait", params: { stream: call.stream, after: call.after } };
    case "monitor":
      return { method: "process.monitor", params: { ref: call.ref, pid: call.pid } };
    case "open":
      return { method: "view.open", params: { pid: call.pid } };
    case "knock":
      return { method: "gateway.knock", params: { label } };
    case "send":
      return {
        method: "process.send",
        params: {
          pid: call.pid,
          letter: call.letter,
          m: call.m,
          sentAt: call.sentAt,
          seen: call.seen,
          ...(call.traceId ? { traceId: call.traceId } : {}),
        },
      };
  }
};

/**
 * Boots a window parent and runs every Cmd to hand-off; the door's answers arrive as Msgs.
 *
 * **Details**
 *
 * It needs `ClientKey`, `ClientRows`, `Id.Generator`, `Socket.WebSocketConstructor` and a `Scope`:
 * closing the scope stops the run, its sockets, its timers and every Sub. Each dial the Link asks
 * for is one constructor call, one reader and one writer in the dial's own scope. The start never
 * dials again by itself: reconnects are the Link machine's. A write, a ping or a hello for a dial
 * with no open socket fails at once.
 *
 * @category constructors
 */
export const start = Effect.fn("WindowStart.start")(function* (options: StartOptions) {
  const keys = yield* ClientKey;
  const rows = yield* ClientRows;
  const sockets = yield* Socket.WebSocketConstructor;
  const ids = yield* Id.Generator;
  const tab = yield* ids.next(Id.Tab).pipe(Effect.orDie);
  const sentAt = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const handles = new Map<number, Handle>();
  const identities = new Map<string | null, Deferred.Deferred<Identity>>();
  const identityFor = (rejected: string | null) => {
    const found = identities.get(rejected);

    if (found) {
      return found;
    }

    const waiting = Deferred.makeUnsafe<Identity>();
    identities.set(rejected, waiting);
    return waiting;
  };

  const send = (dial: number, text: string) => sendOn(handles, dial, text);
  const dial = dialer({ sockets, origin: options.origin, tab, handles });
  const socket = (n: number, rejected: string | null, tries: number): Stream.Stream<WindowMsg> =>
    dial(n, Deferred.await(identityFor(rejected)), tries);

  return yield* run(options.window, {
    ctx: { tiles: options.tiles, tab, ...(options.tezgah === undefined ? {} : { tezgah: options.tezgah }) },
    interpret: {
      key: Effect.fn("ClientKey.current")(function* (cmd) {
        const key = yield* keys.current(cmd.rejected).pipe(Effect.mapError((error) => ({ ...error })));
        yield* Deferred.succeed(identityFor(cmd.rejected), key);
        return { found: key.found, fingerprint: key.fingerprint };
      }),
      now: Effect.fn("Client.now")(function* () {
        const letter = yield* ids.next(Id.Letter).pipe(Effect.mapError(() => F.entropy.make({})));
        return { letter, sentAt: yield* sentAt };
      }),
      mint: Effect.fn("Client.mint")(function* () {
        const tile = yield* ids.next(TileId).pipe(Effect.mapError(() => F.entropy.make({})));
        return { tile };
      }),
      write: Effect.fn("Client.write")(function* (cmd: Write) {
        const message = wire(cmd.call, options.client.label);
        const written = handles.get(cmd.dial)?.written;
        written?.set(cmd.id, yield* Clock.currentTimeMillis);
        yield* send(cmd.dial, JSON.stringify({ jsonrpc: "2.0", id: cmd.id, ...message })).pipe(
          Effect.mapError(() => {
            written?.delete(cmd.id);
            return F.unreachable.make({});
          }),
        );
        return null;
      }),
      ping: Effect.fn("Client.ping")(function* (cmd) {
        yield* send(cmd.dial, "ping").pipe(Effect.mapError(() => F.closed.make({})));
        return null;
      }),
      hello: Effect.fn("Client.hello")(function* (cmd) {
        const handle = handles.get(cmd.dial);

        if (handle === undefined) {
          return yield* Effect.fail(F.closed.make({}));
        }

        const signed = yield* writeSshsig({
          text: helloText({ url: options.origin, tab, nonce: cmd.nonce }),
          space: "fabrika-client",
          line: handle.key.line,
          sign: handle.key.sign,
        }).pipe(Effect.mapError((error) => F.key.make({ error: error.error })));
        const params = {
          versions: [1],
          has: options.client.has,
          ping: "5s",
          key: handle.key.raw,
          tab,
          nonce: cmd.nonce,
          platform: options.client.platform,
          os: options.client.os,
          sentAt: yield* sentAt,
          signed,
        };
        yield* send(cmd.dial, JSON.stringify({ jsonrpc: "2.0", id: cmd.id, method: "initialize", params })).pipe(
          Effect.mapError(() => F.closed.make({})),
        );
        return null;
      }),
      enroll: Effect.fn("Client.enroll")(function* (cmd) {
        const knock = { jsonrpc: "2.0", id: cmd.id, method: "gateway.knock", params: { label: options.client.label } };
        yield* send(cmd.dial, JSON.stringify(knock)).pipe(Effect.mapError(() => F.closed.make({})));
        return null;
      }),
      persist: Effect.fn("Client.persist")(function* () {
        const claimed = yield* keys.claimPersist.pipe(Effect.mapError((error) => ({ ...error })));

        if (!claimed) {
          return false;
        }

        return yield* keys.persist.pipe(
          Effect.mapError((error) => (error === "unsupported" ? F.unsupported.make({}) : F.failed.make({}))),
        );
      }),
      record: Effect.fn("ClientRows.record")(function* (cmd) {
        const id = yield* ids.next(Id.Entry).pipe(Effect.mapError(() => F.failed.make({})));
        yield* rows
          .put(ClientRow.make({ id, tab, build: options.build, sentAt: yield* sentAt, record: cmd.record }))
          .pipe(Effect.mapError((error) => ({ ...error })));
        return null;
      }),
    },
    subscribe: { socket: (sub) => socket(sub.deps.dial, sub.deps.rejected, sub.deps.tries) },
  });
});
