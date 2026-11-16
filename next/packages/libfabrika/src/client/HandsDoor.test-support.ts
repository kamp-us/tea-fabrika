// P39 slice 4a, next/: the brain as the hands client's laws see it, as a script. It keeps tasks the
// way slice 1's task machine does (requested, assigned, started, finished) and answers the five
// tasks calls a hands key may make, `tasks.list`, `tasks.wait`, `tasks.take`, `tasks.started` and
// `tasks.finish`, with the shapes `gateway/Tasks.ts` answers them. It is the laws' oracle of what the
// brain holds, never the product's: it imports no gateway, and from the tasks module only its
// schemas. A law may make it refuse a finish on purpose, to walk the client's recovery.
//
// `door` is the door in front of it, one in-memory socket per dial: it challenges each socket,
// answers the hello and the knock as its gate says, and keeps every socket, so a law can read every
// frame the client wrote as it was sent (`MemorySocket.sent`), not only what the door kept of it.
import { Layer, Option, Schema } from "effect";
import { Socket } from "effect/socket";
import type { Request } from "../tasks/Task.ts";
import { Command, Task, Result, State } from "../tasks/Task.ts";
import { MemorySocket } from "./WindowStart.test-support.ts";

/**
 * A finish refused before the brain saved anything, as the door or the Worker may answer it: over
 * the key's budget (`gateway/Gateway.ts`'s `refuseRate`), a Worker call that died
 * (`cloudflare/connection.ts`), a failed transaction (`TasksError` `storage`), a key whose grant the
 * door could not read again, a need the link did not offer, a call out of order, the client's own
 * params, and a reason no part of the door answers today.
 */
const REFUSED_FIRST = [
  "rate_limited",
  "unreachable",
  "storage",
  "not_granted",
  "lacks_capability",
  "not_allowed",
  "conflict",
  "wrong_state",
  "bad_input",
  "reason_nobody_answers_yet",
] as const;

/**
 * How the brain answers one finish the walk lets through: as the gateway would, refused on
 * purpose, or saved with an answer that does not decode (`garbled`).
 */
export type FinishMode = "ok" | "unavailable" | "garbled" | (typeof REFUSED_FIRST)[number];

const refusedFirst = (mode: FinishMode): mode is (typeof REFUSED_FIRST)[number] =>
  REFUSED_FIRST.some((reason) => reason === mode);

/** One call's outcome at the door: a result, a refusal, or a wait that parks on `target:<key>`. */
export const Outcome = Schema.TaggedUnion({
  result: { result: Schema.Unknown },
  error: { reason: Schema.String },
  parked: { after: Schema.Int },
});
export type Outcome = typeof Outcome.Type;

/** A take's answer, as `gateway/Tasks.ts` writes it inside an ok. */
export const TakeReply = Schema.TaggedUnion({
  idle: {},
  assigned: { task: Task },
  refused: { reason: Schema.String },
});

type Phase = "requested" | "assigned" | "started" | "finished";

type Saved = {
  readonly request: Request;
  phase: Phase;
  execution?: string;
  executor?: string;
  result?: Result;
};

const SENT = "2026-11-15T10:00:00.000Z";
const isResult = Schema.is(Result);

/** The task as the brain's read answers it, in the tasks module's own schema. */
const task = (s: Saved): Task => {
  const assignment =
    s.execution === undefined || s.executor === undefined
      ? undefined
      : {
          execution: s.execution,
          executor: { key: s.executor, connection: "connection_hands", has: ["git"], build: "hands-build" },
        };
  if (s.phase === "requested" || assignment === undefined) {
    return { state: State.cases.requested.make({ request: s.request }), events: [] };
  }

  const state =
    s.phase === "finished" && s.result !== undefined
      ? State.cases.finished.make({ request: s.request, assignment, result: s.result })
      : s.phase === "started"
        ? State.cases.started.make({ request: s.request, assignment })
        : State.cases.assigned.make({ request: s.request, assignment });
  return { state, events: [] };
};

/** The brain's whole state: its tasks by id, each key's `target:` stream rev, and the log head. */
export const brain = () => {
  const tasks = new Map<string, Saved>();
  const lines = new Map<string, number>();
  let head = 0;
  let executions = 0;

  const rev = (key: string) => lines.get(key) ?? 0;
  const open = (s: Saved) => s.phase !== "finished";
  const receipt = (): Outcome =>
    Outcome.cases.result.make({ result: { rev: head, arrivedAt: 1_763_200_000_000 + head } });
  const refused = (reason: string): Outcome => Outcome.cases.error.make({ reason });

  /** A program asked the hands key `target` to run the one command: one line on its `target:` stream. */
  const request = (target: string, process: string, n: number): string => {
    const id = `${process}/${n}/0`;
    tasks.set(id, {
      request: {
        id,
        process,
        name: `counter:${n}`,
        program: "fabrika/counter",
        command: Command.cases.git_version.make({}),
        needs: ["git"],
        target,
        build: "brain-build",
        settings: null,
        parent: null,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      },
      phase: "requested",
    });
    head++;
    lines.set(target, head);
    return id;
  };

  /** Answers one call by `key`, and changes what the call changes. `finish` says how a finish is answered. */
  const call = (key: string, method: string, params: unknown, finish: FinishMode = "ok"): Outcome => {
    const p = typeof params === "object" && params !== null ? new Map(Object.entries(params)) : new Map();
    const text = (name: string) => {
      const value = p.get(name);
      return typeof value === "string" ? value : "";
    };

    if (method === "tasks.list") {
      const mine = [...tasks.values()].filter((s) => s.request.target === key && open(s));
      return Outcome.cases.result.make({
        result: { tasks: mine.map((s) => ({ id: s.request.id, process: s.request.process })), rev: rev(key) },
      });
    }

    if (method === "tasks.wait") {
      const after = p.get("after");
      const n = typeof after === "number" ? after : 0;
      return rev(key) > n
        ? Outcome.cases.result.make({ result: { rev: rev(key) } })
        : Outcome.cases.parked.make({ after: n });
    }

    if (method === "tasks.take") {
      const candidates = [...tasks.values()].filter(
        (s) => s.request.process === text("process") && s.request.target === key && open(s),
      );
      const [one] = candidates;

      if (one === undefined) {
        return Outcome.cases.result.make({ result: TakeReply.cases.idle.make({}) });
      }

      if (candidates.length > 1) {
        return Outcome.cases.result.make({ result: TakeReply.cases.refused.make({ reason: "ambiguous" }) });
      }

      if (one.phase === "requested") {
        one.phase = "assigned";
        one.execution = `execution_${++executions}`;
        one.executor = key;
        head++;
      }

      return Outcome.cases.result.make({ result: TakeReply.cases.assigned.make({ task: task(one) }) });
    }

    const s = tasks.get(text("task"));

    if (s === undefined || s.executor !== key || s.execution !== text("execution")) {
      return refused(s === undefined ? "not_found" : "not_allowed");
    }

    if (method === "tasks.started") {
      if (s.phase === "assigned") {
        s.phase = "started";
        head++;
      }

      return receipt();
    }

    if (method !== "tasks.finish") {
      return refused("unknown_method");
    }

    if (refusedFirst(finish)) {
      return refused(finish);
    }

    const result = p.get("result");
    // A failed wake answers `unavailable` after the finish was saved (slice 3's W1), and a garbled
    // answer comes after it was saved too.
    const answer = (): Outcome =>
      finish === "unavailable"
        ? refused("unavailable")
        : finish === "garbled"
          ? Outcome.cases.result.make({ result: { saved: "maybe" } })
          : receipt();

    if (s.phase === "finished") {
      // A repeat with the same result answers the first receipt, or as the mode says.
      return JSON.stringify(s.result) !== JSON.stringify(result) ? refused("conflict") : answer();
    }

    if (s.phase !== "started" || !isResult(result)) {
      return refused(s.phase !== "started" ? "wrong_state" : "bad_input");
    }

    s.phase = "finished";
    s.result = result;
    head++;
    return answer();
  };

  return {
    request,
    call,
    rev,
    /** The task as the brain holds it now, or undefined for an id it never saved. */
    read: (id: string) => tasks.get(id),
    /** Every task, for a law that reads what the brain ended with. */
    all: () => [...tasks.values()],
    /** An `assigned` answer for `id` naming the executor `key`, as a take for another key would get it. */
    assignedTo: (id: string, key: string): unknown => {
      const s = tasks.get(id);
      return s === undefined
        ? null
        : TakeReply.cases.assigned.make({
            task: task({ ...s, phase: "assigned", execution: s.execution ?? `execution_other_${id}`, executor: key }),
          });
    },
    sentAt: SENT,
  };
};

/** The brain's type, for a law's world. */
export type Brain = ReturnType<typeof brain>;

/** The JSON-RPC text that answers call `id` with `outcome`. A parked wait has no text until it is rung. */
export const answerText = (id: string | number, outcome: Outcome): string | null =>
  outcome._tag === "parked"
    ? null
    : JSON.stringify(
        outcome._tag === "result"
          ? { jsonrpc: "2.0", id, result: outcome.result }
          : { jsonrpc: "2.0", id, error: { code: -32000, message: outcome.reason, data: { reason: outcome.reason } } },
      );

/** The door's admission of the hands key `key`, as it answers `initialize`. */
export const admitted = (key: string) => ({
  version: 1,
  ping: 5_000,
  identity: { key, person: "person_01m6v5270hf3c8x2q7w9z4k5mn", as: "hands" },
});

/** The result the fake `Commands` gives for the `n`th command it runs. */
export const fakeResult = (n: number): Result =>
  Result.cases.exited.make({ code: n % 3 === 0 ? 1 : 0, version: `git version 2.${40 + (n % 9)}.0` });

/** One JSON-RPC call the client wrote. */
const Call = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.Union([Schema.Number, Schema.String]),
    method: Schema.String,
    params: Schema.optionalKey(Schema.Unknown),
  }),
);

const decodeCall = Schema.decodeUnknownOption(Call);

/** How the door cuts the next tasks call: drop the socket before it reads the call, or after it acted. */
type CallCut = "before" | "after" | null;

/** How the door answers a hello: it admits the key, says `not_granted` (the client then knocks), or refuses it for `reason`. */
export const HelloAnswer = Schema.TaggedUnion({
  admit: {},
  not_granted: {},
  refuse: { reason: Schema.String },
});

/** How the door answers a hello and a knock: a knock gets the waiting code, or a refusal for `reason`. */
export type Gate = {
  readonly hello: () => typeof HelloAnswer.Type;
  readonly knock: () => { readonly code: string; readonly until: number } | { readonly reason: string };
};

/** The door every 4a law meets: it admits every hello. */
const admitsAll: Gate = { hello: () => HelloAnswer.cases.admit.make({}), knock: () => ({ reason: "not_allowed" }) };

/** What the door holds: the socket open now, the cut armed, the waits it parked, and what it heard. */
type DoorState = {
  open: MemorySocket | null;
  cut: CallCut;
  parked: Array<{ readonly id: string | number; readonly after: number; readonly on: MemorySocket }>;
  readonly hellos: Array<unknown>;
  readonly calls: Array<{ readonly method: string; readonly params: unknown }>;
  /** Every socket the client dialed, in order: its `url` and every text it `sent`. */
  readonly sockets: Array<MemorySocket>;
  dials: number;
};

const failed = (id: string | number, reason: string) =>
  JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: reason, data: { reason } } });

/** The door as a script over the brain `b`, for the hands key `key`: one socket per dial, the challenge waiting in it. */
export const door = (b: Brain, key: string, gate: Gate = admitsAll) => {
  const state: DoorState = { open: null, cut: null, parked: [], hellos: [], calls: [], sockets: [], dials: 0 };
  const answer = (text: string, on: MemorySocket) => {
    if (text === "ping") {
      on.receive("pong");
      return;
    }

    const decoded = decodeCall(text);

    if (Option.isNone(decoded)) {
      return;
    }

    const call = decoded.value;

    if (call.method === "initialize") {
      state.hellos.push(call.params);
      const said = gate.hello();
      on.receive(
        said._tag === "refuse"
          ? failed(call.id, said.reason)
          : said._tag === "not_granted"
            ? failed(call.id, "not_granted")
            : JSON.stringify({ jsonrpc: "2.0", id: call.id, result: admitted(key) }),
      );
      return;
    }

    if (call.method === "gateway.knock") {
      const said = gate.knock();
      on.receive(
        "reason" in said ? failed(call.id, said.reason) : JSON.stringify({ jsonrpc: "2.0", id: call.id, result: said }),
      );
      return;
    }

    if (!call.method.startsWith("tasks.")) {
      return;
    }

    const cut = state.cut;

    if (cut === "before") {
      state.cut = null;
      on.drop(1006);
      return;
    }

    state.calls.push({ method: call.method, params: call.params });
    const outcome = b.call(key, call.method, call.params);

    if (cut === "after") {
      state.cut = null;
      on.drop(1006);
      return;
    }

    if (outcome._tag === "parked") {
      state.parked.push({ id: call.id, after: outcome.after, on });
      return;
    }

    const body = answerText(call.id, outcome);

    if (body !== null) {
      on.receive(body);
    }
  };
  const socket = Layer.succeed(Socket.WebSocketConstructor, (url: string) => {
    state.dials++;
    const made: MemorySocket = new MemorySocket(url, { send: (text, from) => answer(text, from) });
    state.open = made;
    state.sockets.push(made);
    made.open();
    made.receive(JSON.stringify({ jsonrpc: "2.0", method: "challenge", params: { nonce: `nonce_${state.dials}` } }));
    return made;
  });
  return {
    state,
    socket,
    /** A program asks the client's key: the brain saves it, and each parked wait past its rev is rung. */
    request: (process: string, n: number) => {
      const id = b.request(key, process, n);
      const ringing = state.parked.filter((p) => b.rev(key) > p.after);
      state.parked = state.parked.filter((p) => !ringing.includes(p));

      for (const p of ringing) {
        p.on.receive(JSON.stringify({ jsonrpc: "2.0", id: p.id, result: { rev: b.rev(key) } }));
      }

      return id;
    },
    drop: () => state.open?.drop(1006),
    /** A person grants the key: the door sends `client.granted` with a fresh nonce on the open socket. */
    grant: () =>
      state.open?.receive(
        JSON.stringify({ jsonrpc: "2.0", method: "client.granted", params: { nonce: `grant_${state.dials}` } }),
      ),
    /** A person removes the key: the door closes the open socket with 4003. */
    remove: () => state.open?.drop(4003),
  };
};
