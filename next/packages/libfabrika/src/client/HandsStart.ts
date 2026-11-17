/**
 * The start of a hands client: it boots the hands machine on tea's Effect engine and does its input
 * and output. Each Cmd becomes a write on its dial's socket, a journal call or the one command, and
 * each socket event becomes a Msg. It decides nothing: the machine's Model says which dial is
 * current and what runs next. Nothing here names a platform, so a browser tab could run it.
 */
import { run } from "@demlik/tea/effect";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Socket from "effect/socket/Socket";
import * as Stream from "effect/Stream";
import type * as Types from "effect/Types";
import * as Id from "../Id.ts";
import { ClientKey } from "../transport/ClientKey.ts";
import { ErrorClass } from "../transport/ClientRows.ts";
import { helloText } from "../transport/Hello.ts";
import { writeSshsig } from "../transport/Sshsig.ts";
import type { Hello } from "../transport/Wire.ts";
import { Commands } from "./Commands.ts";
import { handsMachine } from "./HandsMachine.ts";
import { type DialMsg, dialer, type Handle, send } from "./internal/dial.ts";
import { Journal, type JournalError } from "./Journal.ts";

/**
 * What a hands start is given: the brain's origin, the build that runs, the label its knock
 * shows the person who grants its key, and the host's `os`, which the hello sends; a start that
 * gives none sends `unknown`.
 *
 * @category models
 */
export type StartOptions = {
  readonly origin: string;
  readonly build: string;
  readonly label: string;
  readonly os?: (typeof Hello.Type)["os"];
};

const Failure = Schema.TaggedUnion({
  unreachable: {},
  closed: {},
  key: { error: ErrorClass },
});

const F = Failure.cases;

/** The socket's Msgs the hands machine reads: a failure to open shows as its close. */
const forHands = (m: DialMsg): m is Exclude<DialMsg, Types.ExtractTag<DialMsg, "socket_failure">> =>
  m._tag !== "socket_failure";

/** A call that says what the client has `seen` also says when it was sent, on the client's own clock. */
const stamped = (params: unknown, sentAt: string): unknown =>
  Predicate.isObject(params) && "seen" in params ? { ...params, sentAt } : params;

/**
 * Boots a hands client and runs every Cmd to hand-off; the door's answers arrive as Msgs.
 *
 * **Details**
 *
 * It needs `ClientKey`, `Journal`, `Commands`, `Id.Generator`, `Socket.WebSocketConstructor` and a
 * `Scope`: closing the scope stops the run, its sockets, its timers and every Sub, which is how a
 * crash looks from outside. It reads the key once, before the first dial. Its hello sends
 * `Commands.has` as `has`, `platform: "headless"`, `os` and `build`; its knock asks as `hands`. Only the
 * `journal_read`, `journal_write` and `execute` Cmds reach the journal and the command. A write, a
 * ping or a hello for a dial with no open socket fails at once.
 *
 * @category constructors
 */
export const start = Effect.fn("HandsStart.start")(function* (options: StartOptions) {
  const key = yield* ClientKey.use((keys) => keys.current(null));
  const journal = yield* Journal;
  const commands = yield* Commands;
  const sockets = yield* Socket.WebSocketConstructor;
  const tab = yield* Id.Generator.use((ids) => ids.next(Id.Tab)).pipe(Effect.orDie);
  const sentAt = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const handles = new Map<number, Handle>();
  const dial = dialer({ sockets, origin: options.origin, tab, handles });

  const frame = <E>(n: number, body: object, failure: E) =>
    send(handles, n, JSON.stringify({ jsonrpc: "2.0", ...body })).pipe(Effect.mapError(() => failure));

  // tea takes a Cmd's failure as a plain record named by its `_tag`: the journal's error, field for field.
  const plain = (error: JournalError) => ({ ...error });

  return yield* run(handsMachine, {
    interpret: {
      write: Effect.fn("Hands.write")(function* (cmd) {
        const params = stamped(cmd.params, yield* sentAt);
        yield* frame(cmd.dial, { id: cmd.id, method: cmd.method, params }, F.unreachable.make({}));

        return null;
      }),
      ping: Effect.fn("Hands.ping")(function* (cmd) {
        yield* send(handles, cmd.dial, "ping").pipe(Effect.mapError(() => F.closed.make({})));

        return null;
      }),
      hello: Effect.fn("Hands.hello")(function* (cmd) {
        const signed = yield* writeSshsig({
          text: helloText({ url: options.origin, tab, nonce: cmd.nonce }),
          space: "fabrika-client",
          line: key.line,
          sign: key.sign,
        }).pipe(Effect.mapError((error) => F.key.make({ error: error.error })));

        const params = {
          versions: [1],
          has: commands.has,
          ping: "5s",
          key: key.raw,
          tab,
          nonce: cmd.nonce,
          platform: "headless",
          os: options.os ?? "unknown",
          build: options.build,
          sentAt: yield* sentAt,
          signed,
        };

        yield* frame(cmd.dial, { id: cmd.id, method: "initialize", params }, F.closed.make({}));

        return null;
      }),
      knock: Effect.fn("Hands.knock")(function* (cmd) {
        const params = { label: options.label, as: "hands" };
        yield* frame(cmd.dial, { id: cmd.id, method: "gateway.knock", params }, F.closed.make({}));

        return null;
      }),
      journal_read: Effect.fn("Journal.read")(function* (cmd) {
        return yield* journal.read(cmd.task).pipe(Effect.mapError(plain));
      }),
      journal_write: Effect.fn("Journal.write")(function* (cmd) {
        yield* journal.write(cmd.task, cmd.entry).pipe(Effect.mapError(plain));

        return null;
      }),
      execute: Effect.fn("Commands.execute")(function* (cmd) {
        return yield* commands.execute(cmd.command);
      }),
    },
    subscribe: {
      socket: (sub) => dial(sub.deps.dial, Effect.succeed(key), sub.deps.tries).pipe(Stream.filter(forHands)),
    },
  });
});
