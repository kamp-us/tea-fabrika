// P39 slice 4a, next/: the hands machine's laws H1, H3 and H4, on its real `init` and `update`.
//
// What these laws hold `client/HandsMachine.ts` to, from the approved plan (the build may add more):
// - It exports `handsMachine`, one tea machine (0046) made with `Machine.make`, whose `init(null, {})`
//   boots a fresh client. Its model holds `link` (`transport/Link.ts`), `handshake`
//   (`transport/Handshake.ts`) and `work`, the plan's work state, tagged `offline`, `listing`,
//   `watching`, `taking`, `recalling`, `saving`, `starting`, `executing`, `reporting` or `holding`;
//   a work state about a job names it `id`, with its `execution`, and `reporting` and `holding`
//   keep the `result`; a state with a call out keeps its JSON-RPC id as `call`.
// - It takes the socket Msgs of the dial Sub the window shares (`socket_opened {dial, at}`,
//   `frame {dial, text, at}`, `socket_closed {dial, code, at}`), its own timers' Msgs, and tea's
//   `<cmd>_ok` and `<cmd>_err` for its Cmds. Its `subs` hold a `socket` Sub whose deps carry the
//   `dial` to open, and its timers as tea's built-in `timer`.
// - Its Cmds are the seven the start interprets: `write {dial, id, method, params}` (one JSON-RPC
//   call; the start adds `sentAt` where the call takes one), `hello` and `knock` (the Handshake's),
//   `ping`, `journal_read {job}` (ok: the job's entry or null), `journal_write {job, entry}` (ok:
//   null, err: `JournalError`) and `execute {command}` (ok: the command's Result).
//
// The walk starts at the real init and reaches every state through what is possible in the state it
// folded: a socket the machine asks for opens, the door answers the calls really out, tea answers
// the Cmds really waiting, a timer the machine holds fires, and a restart re-inits the machine over
// the journal and the brain the walk keeps. The oracle is the walk's own: the scripted brain
// (`HandsDoor.test-support.ts`), the journal entries the walk saved, and its own count of each
// `execute` and each result sent. It never calls the product's update to decide what is right.
//
// The plan names tea's `arbGuidedSequence` as H1's and H4's generator. A restart is no Msg, and a
// door's answer must read the brain the walk keeps, so these laws walk a fast-check tape instead,
// as the window's frame laws do (0093): each cell is read against the state it reached.
//
// Plants (after build): H1, call `execute` before the `executing` write lands. H3, count a finish
// refused `unavailable` as done and save `acknowledged`. H4, execute the job in any `assigned`
// answer, whoever it names.
import { applyCell, type Cmd } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import * as fc from "fast-check";
import { fcTypeId } from "../jobs/JobsTest.ts";
import {
  admitted,
  answerText,
  brain,
  type Brain,
  type FinishMode,
  fakeResult,
  TakeReply,
} from "./HandsDoor.test-support.ts";
import { handsMachine } from "./HandsMachine.ts";

const SEED = 119120;
/** The client's own hands key, as the door admits it, and another key the brain also holds work for. */
const KEY = "SHA256:hands-own-key-0000000000000000000000000000";
const OTHER = "SHA256:hands-other-key-00000000000000000000000000";

/** The Cmds the plan names for the machine; any other is a broken contract. */
const KNOWN = new Set(["write", "hello", "knock", "ping", "journal_read", "journal_write", "execute"]);

type Model = typeof handsMachine.model.Type;
/** A Msg as the walk builds it: the machine reads it by its `type`. */
type Sent = { readonly type: string } & Readonly<Record<string, unknown>>;
type Out = Cmd & Readonly<Record<string, unknown>>;

const step = (s: Model, m: Sent) => applyCell<Model, Sent, Out>(handsMachine, s, m);
const boot = (): readonly [Model, ReadonlyArray<Out>] => handsMachine.init(null, {});

const record = (v: unknown): ReadonlyMap<string, unknown> =>
  typeof v === "object" && v !== null ? new Map(Object.entries(v)) : new Map();

const text = (v: unknown) => (typeof v === "string" ? v : "");
const tagIn = (v: unknown) => text(record(v).get("_tag"));
const parse = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** The job a work state is about, and its execution, or null for a state about no job. */
const about = (s: Model) => ({
  id: "id" in s.work ? text(s.work.id) : null,
  execution: "execution" in s.work ? text(s.work.execution) : null,
  call: "call" in s.work ? text(s.work.call) : null,
});

/** A built-in timer's deps: fire `msg` once, `ms` after it starts. */
const isTimer = (d: unknown): d is { readonly ms: number; readonly msg: Sent } => {
  const r = record(d);
  return typeof r.get("ms") === "number" && typeof record(r.get("msg")).get("type") === "string";
};

/** The deps of each of the machine's Subs of `type` that is on in `s`. */
const subs = (s: Model, type: string): ReadonlyArray<unknown> =>
  (handsMachine.subs ?? []).flatMap((sub) => {
    const deps: unknown = sub.type === type ? sub.deps(s) : null;
    return deps === null || deps === undefined ? [] : [deps];
  });

/** One JSON-RPC call on the wire: what the machine wrote, on which dial, under which id. */
type Call = { readonly dial: number; readonly id: string; readonly method: string; readonly params: unknown };

/** How the door may answer the live take, besides the brain's own answer (H4). */
type Forge = "other" | "idle" | "refused" | "not_allowed";

type World = {
  s: Model;
  /** Cmds handed out in this process and not answered yet. */
  waiting: Array<Out>;
  /** Calls written in this process, not answered: the door may answer, lose or park each. */
  wire: Array<Call>;
  /** Calls whose answer can only come late: answered already, or of a dial that closed. */
  stale: Array<Call>;
  /** Waits the brain parked, until a request for the key moves its stream past `after`. */
  parked: Array<Call & { readonly after: number }>;
  opened: Set<number>;
  challenged: Set<number>;
  /** The journal: each job's last saved entry, kept across restarts as a file would keep it. */
  readonly journal: Map<string, unknown>;
  readonly door: Brain;
  /** The oracle's own counts, across every restart. */
  readonly executes: Map<string, number>;
  readonly results: Map<string, Set<string>>;
  /** Jobs whose finish the machine heard answered ok, in any process. */
  readonly acked: Set<string>;
  /** Jobs this process holds after a refusal for good. */
  held: Set<string>;
  at: number;
  n: number;
};

const Cell = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  variant: fc.nat(),
});
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;

const Tape = fc.record({
  processes: fc.uniqueArray(fcTypeId("process"), { minLength: 3, maxLength: 6 }),
  cells: fc.array(Cell, { minLength: 120, maxLength: 320, size: "max" }),
});
type Tape = typeof Tape extends fc.Arbitrary<infer A> ? A : never;

/** What a law lets the walk do. */
type Moves = {
  readonly forge: boolean;
  readonly finish: ReadonlyArray<FinishMode | "lost">;
  readonly restart: boolean;
};

/** One possible move: its label for coverage, how often to offer it, and the Msg it sends (or a world change). */
type Option = { readonly label: string; readonly weight: number; readonly run: () => Sent | null };

const rpc = (body: object) => JSON.stringify({ jsonrpc: "2.0", ...body });

const walk = (tape: Tape, moves: Moves, done: Set<string>) => {
  const [s0, cmds0] = boot();
  const w: World = {
    s: s0,
    waiting: [...cmds0],
    wire: [],
    stale: [],
    parked: [],
    opened: new Set(),
    challenged: new Set(),
    journal: new Map(),
    door: brain(),
    executes: new Map(),
    results: new Map(),
    acked: new Set(),
    held: new Set(),
    at: 1_000,
    n: 0,
  };
  const frame = (dial: number, body: string): Sent => ({ type: "frame", dial, text: body, at: w.at });
  const socketDial = (): number | null => {
    const [deps] = subs(w.s, "socket");
    const dial = record(deps).get("dial");
    return typeof dial === "number" ? dial : null;
  };

  /** The checks every step answers to, whichever law walks: H1, H3 and H4 hold at once. */
  const check = (next: Model, cmds: ReadonlyArray<Out>) => {
    for (const c of cmds) {
      expect(KNOWN.has(c.type), `a Cmd the plan names, not ${c.type}`).toBe(true);

      if (c.type === "execute") {
        const { id, execution } = about(next);
        const job = w.door.read(id ?? "");
        const saved = record(w.journal.get(id ?? ""));
        expect(next.work._tag, "H1: execute only in executing").toBe("executing");
        expect(job?.phase, "H1: only after the brain has the job started").toBe("started");
        expect(job?.execution, "H1: for the execution the brain started").toBe(execution);
        expect(job?.executor, "H4: only work assigned to the client's own key").toBe(KEY);
        expect(saved.get("_tag"), "H1: only after `executing` was saved").toBe("executing");
        expect(saved.get("execution"), "H1: `executing` was saved for this execution").toBe(execution);
        expect(record(c).get("command"), "H1: the command the brain holds").toEqual(job?.request.command);
        const count = (w.executes.get(id ?? "") ?? 0) + 1;
        w.executes.set(id ?? "", count);
        expect(count, `H1: execute at most once for ${id}, across every restart`).toBe(1);
        done.add("execute");
      }

      if (c.type === "write" && record(c).get("method") === "jobs.finish") {
        const params = record(record(c).get("params"));
        const job = text(params.get("job"));
        expect(w.held.has(job), "H3: a held result sends nothing more").toBe(false);
        const sent = w.results.get(job) ?? new Set<string>();
        sent.add(JSON.stringify(params.get("result")));
        w.results.set(job, sent);
        expect(sent.size, `H3: one result for ${job}, never a second, different one`).toBe(1);
        done.add("finish_sent");
      }

      if (c.type === "journal_write" && tagIn(record(c).get("entry")) === "acknowledged") {
        expect(w.acked.has(text(record(c).get("job"))), "H3: acknowledged only after the brain said ok").toBe(true);
      }
    }
  };

  const apply = (m: Sent) => {
    const prev = w.s;
    const [next, cmds] = step(prev, m);
    check(next, cmds);
    w.s = next;
    w.waiting.push(...cmds);
    w.at += 7;
    return { prev, next, cmds };
  };

  /** tea's answer to one waiting Cmd, and what the world keeps of it. */
  const settle = (c: Out, cell: Cell): Sent => {
    const r = record(c);

    if (c.type === "write") {
      const call: Call = {
        dial: typeof r.get("dial") === "number" ? Number(r.get("dial")) : -1,
        id: text(r.get("id")),
        method: text(r.get("method")),
        params: r.get("params"),
      };
      (call.dial === socketDial() ? w.wire : w.stale).push(call);
      return { type: "write_ok", cmd: c, value: null, at: w.at };
    }

    if (c.type === "hello") {
      const dial = typeof r.get("dial") === "number" ? Number(r.get("dial")) : -1;
      w.wire.push({ dial, id: text(r.get("id")), method: "initialize", params: null });
      return { type: "hello_ok", cmd: c, value: null, at: w.at };
    }

    if (c.type === "ping") {
      const dial = typeof r.get("dial") === "number" ? Number(r.get("dial")) : -1;
      w.wire.push({ dial, id: "", method: "ping", params: null });
      return { type: "ping_ok", cmd: c, value: null, at: w.at };
    }

    if (c.type === "journal_read") {
      const entry = w.journal.get(text(r.get("job"))) ?? null;
      done.add(`recall:${entry === null ? "nothing" : tagIn(entry)}`);
      return { type: "journal_read_ok", cmd: c, value: entry, at: w.at };
    }

    if (c.type === "journal_write") {
      if (cell.variant % 7 === 0) {
        done.add("journal_failed");
        return { type: "journal_write_err", cmd: c, error: { _tag: "JournalError", reason: "storage" }, at: w.at };
      }

      w.journal.set(text(r.get("job")), r.get("entry"));
      return { type: "journal_write_ok", cmd: c, value: null, at: w.at };
    }

    if (c.type === "execute") {
      return { type: "execute_ok", cmd: c, value: fakeResult(w.executes.size), at: w.at };
    }

    return { type: `${c.type}_ok`, cmd: c, value: null, at: w.at };
  };

  /** The door's answer to one call on the wire, as the brain gives it, or forged for H4. */
  const answer = (call: Call, cell: Cell, forge: Forge | null): Sent | null => {
    w.wire = w.wire.filter((x) => x !== call);
    w.stale.push(call);

    if (call.method === "initialize") {
      return frame(call.dial, rpc({ id: call.id, result: admitted(KEY) }));
    }

    if (call.method === "ping") {
      return frame(call.dial, "pong");
    }

    if (forge !== null) {
      const theirs = w.door.all().find((j) => j.request.target === OTHER);
      const forged =
        forge === "other" && theirs !== undefined
          ? rpc({ id: call.id, result: w.door.assignedTo(theirs.request.id, OTHER) })
          : forge === "idle"
            ? rpc({ id: call.id, result: TakeReply.cases.idle.make({}) })
            : forge === "refused"
              ? rpc({ id: call.id, result: TakeReply.cases.refused.make({ reason: "ambiguous" }) })
              : rpc({ id: call.id, error: { code: -32000, message: "no", data: { reason: "not_allowed" } } });
      return frame(call.dial, forged);
    }

    const mode = moves.finish[cell.variant % moves.finish.length] ?? "ok";
    const outcome = w.door.call(KEY, call.method, call.params, mode === "lost" ? "ok" : mode);

    if (outcome._tag === "parked") {
      w.stale = w.stale.filter((x) => x !== call);
      w.parked.push({ ...call, after: outcome.after });
      return null;
    }

    if (call.method === "jobs.finish" && mode === "lost") {
      done.add("finish:lost");
      return null;
    }

    const body = answerText(call.id, outcome);
    return body === null ? null : frame(call.dial, body);
  };

  const options = (cell: Cell): ReadonlyArray<Option> => {
    const out: Array<Option> = [];
    const dial = socketDial();

    if (dial !== null && !w.opened.has(dial)) {
      out.push({
        label: "open",
        weight: 6,
        run: () => {
          w.opened.add(dial);
          return { type: "socket_opened", dial, at: w.at };
        },
      });
    }

    if (dial !== null && w.opened.has(dial) && !w.challenged.has(dial)) {
      out.push({
        label: "challenge",
        weight: 6,
        run: () => {
          w.challenged.add(dial);
          return frame(dial, rpc({ method: "challenge", params: { nonce: `nonce_${dial}_${w.n}` } }));
        },
      });
    }

    if (w.waiting.length > 0) {
      const c = w.waiting[cell.pick % w.waiting.length];
      out.push({
        label: `settle:${c?.type ?? ""}`,
        weight: 8,
        run: () => {
          w.waiting = w.waiting.filter((x) => x !== c);
          return c === undefined ? null : settle(c, cell);
        },
      });
    }

    const ready = w.wire.filter((c) => c.dial === dial);

    if (ready.length > 0) {
      const call = ready[cell.pick % ready.length];
      out.push({
        label: `door:${call?.method ?? ""}`,
        weight: 8,
        run: () => (call === undefined ? null : answer(call, cell, null)),
      });
      out.push({
        label: "lose",
        weight: 1,
        run: () => {
          // The door took the call, and its answer never came back.
          if (call !== undefined && call.method.startsWith("jobs.")) {
            w.door.call(KEY, call.method, call.params);
          }

          w.wire = w.wire.filter((x) => x !== call);
          return null;
        },
      });
    }

    const take = w.wire.find((c) => c.method === "jobs.take" && c.dial === dial);

    if (moves.forge && take !== undefined) {
      // Another key's assignment is offered only once the brain holds a job for that key.
      const theirs = w.door.all().some((j) => j.request.target === OTHER);
      const forges = theirs ? (["other", "idle", "refused", "not_allowed"] as const) : (["idle", "refused"] as const);
      const forge = forges[cell.variant % forges.length] ?? "idle";
      out.push({ label: `forge:${forge}`, weight: 4, run: () => answer(take, cell, forge) });
    }

    const rung = w.parked.filter((c) => w.door.rev(KEY) > c.after && c.dial === dial);

    if (rung.length > 0) {
      const call = rung[0];
      out.push({
        label: "ring",
        weight: 8,
        run: () => {
          w.parked = w.parked.filter((x) => x !== call);
          return call === undefined ? null : frame(call.dial, rpc({ id: call.id, result: { rev: w.door.rev(KEY) } }));
        },
      });
    }

    if (w.stale.length > 0 && dial !== null) {
      const old = w.stale[cell.pick % w.stale.length];
      out.push({
        label: "stale",
        weight: moves.forge ? 3 : 1,
        run: () => {
          const mine = w.door.all().find((j) => j.request.target === KEY);
          const result = mine === undefined ? TakeReply.cases.idle.make({}) : w.door.assignedTo(mine.request.id, KEY);
          return old === undefined ? null : frame(dial, rpc({ id: old.id, result }));
        },
      });
    }

    const open = w.door.all().filter((j) => j.phase !== "finished");
    out.push({
      label: open.length === 0 ? "request" : "request_more",
      weight: open.length === 0 ? 4 : 1,
      run: () => {
        const process = tape.processes[w.n % tape.processes.length] ?? "process_01m6v5270hetdrt4r8h9vvjwjs";
        const target = moves.forge && cell.variant % 3 === 0 ? OTHER : KEY;
        w.door.request(target, process, ++w.n);
        done.add(target === KEY ? "request" : "request:other");
        return null;
      },
    });

    for (const deps of subs(w.s, "timer")) {
      if (isTimer(deps)) {
        out.push({ label: "timer", weight: 2, run: () => deps.msg });
      }
    }

    if (dial !== null && w.opened.has(dial)) {
      out.push({
        label: "close",
        weight: 1,
        run: () => {
          w.stale.push(...w.wire);
          w.wire = [];
          w.parked = [];
          // A held result is held for the link it was refused on: after a new hello the recovery
          // table reads the journal again (the plan leaves this case open; see the run row).
          w.held = new Set();
          return { type: "socket_closed", dial, code: 1006, at: w.at };
        },
      });
    }

    if (moves.restart) {
      out.push({
        label: `restart@${w.s.work._tag}`,
        weight: ["executing", "saving", "starting", "reporting"].includes(w.s.work._tag) ? 3 : 1,
        run: () => {
          // A cut after a journal write: the entry landed, and the process died before it heard.
          if (cell.variant % 2 === 0) {
            for (const c of w.waiting.filter((x) => x.type === "journal_write")) {
              w.journal.set(text(record(c).get("job")), record(c).get("entry"));
            }
          }

          const [s, cmds] = boot();
          w.s = s;
          w.waiting = [...cmds];
          w.wire = [];
          w.stale = [];
          w.parked = [];
          w.opened = new Set();
          w.challenged = new Set();
          w.held = new Set();
          return null;
        },
      });
    }

    return out;
  };

  for (const cell of tape.cells) {
    const all = options(cell);
    const total = all.reduce((n, o) => n + o.weight, 0);
    let at = cell.move % total;
    const chosen = all.find((o) => (at -= o.weight) < 0) ?? all[0];

    if (chosen === undefined) {
      continue;
    }

    done.add(chosen.label);
    const live = { ...about(w.s), tag: w.s.work._tag, dial: socketDial() };
    const take = w.wire.find((c) => c.method === "jobs.take");
    const m = chosen.run();

    if (m === null) {
      continue;
    }

    // H3: a finish answer on the live call, read before the machine takes it: an ok lets it save
    // `acknowledged` in the same step.
    const reply = m.type === "frame" ? record(Option.getOrNull(parse(text(m.text)))) : new Map<string, unknown>();
    const reason = text(record(record(reply.get("error")).get("data")).get("reason"));
    const onLive = chosen.label === "door:jobs.finish" && live.tag === "reporting" && reply.get("id") === live.call;

    if (onLive && reason === "") {
      w.acked.add(live.id ?? "");
    }

    const { prev, next, cmds } = apply(m);

    if (onLive) {
      const job = live.id ?? "";

      if (reason === "unavailable") {
        expect(next.work._tag, "H3: a finish refused unavailable is sent again").toBe("reporting");
        expect(about(next).id, "H3: for the same job").toBe(job);
        expect("result" in next.work ? next.work.result : null, "H3: with the same result").toEqual(
          "result" in prev.work ? prev.work.result : undefined,
        );
        done.add("finish:unavailable");
      } else if (reason !== "") {
        expect(next.work._tag, `H3: a finish refused ${reason} is held`).toBe("holding");
        w.held.add(job);
        done.add("finish:held");
      } else {
        expect(about(next).id === job && next.work._tag === "reporting", "H3: an ok ends the report").toBe(false);
        done.add("finish:ok");
      }
    }

    // H4: a forged answer to the live take, or any answer to a stale id, starts nothing to execute.
    if (chosen.label.startsWith("forge:") || chosen.label === "stale") {
      const forged = take !== undefined && take.id === live.call && chosen.label.startsWith("forge:");
      const busy = ["recalling", "saving", "starting", "executing", "reporting"];
      expect(cmds.some((c) => c.type === "execute" || c.type === "journal_write")).toBe(false);
      expect(
        forged || chosen.label === "stale" ? busy.includes(next.work._tag) && !busy.includes(prev.work._tag) : false,
        `H4: ${chosen.label} in ${prev.work._tag} starts no job`,
      ).toBe(false);

      if (chosen.label === "stale") {
        expect(next.work, "H4: an answer to a stale call id changes nothing").toEqual(prev.work);
      }

      done.add(forged ? `${chosen.label}@live` : chosen.label);
    }
  }
};

const law = (name: string, moves: Moves, required: ReadonlyArray<string>, runs: number) =>
  it(name, () => {
    const done = new Set<string>();
    fc.assert(
      fc.property(Tape, (tape) => walk(tape, moves, done)),
      { seed: SEED, numRuns: runs, includeErrorInReport: true },
    );
    // An empty walk cannot pass: every transition the law is about ran at least once.
    expect([...done]).toEqual(expect.arrayContaining([...required]));
  });

describe("P39 slice 4a: the hands machine", () => {
  law(
    "H1: the client calls execute only in executing, only after jobs.started answered ok and executing was saved, and at most once per job across every restart",
    { forge: false, finish: ["ok"], restart: true },
    ["execute", "restart@executing", "recall:executing", "recall:nothing", "finish_sent", "close", "timer"],
    100,
  );
  law(
    "H3: a finish refused unavailable is sent again with the same result until ok; any other refusal holds the result and sends nothing more; a second, different result is never sent for one job",
    { forge: false, finish: ["ok", "lost", "unavailable", "not_allowed", "conflict"], restart: false },
    ["finish_sent", "finish:ok", "finish:unavailable", "finish:held", "finish:lost"],
    60,
  );
  law(
    "H4: the client runs only work assigned to its own key: an idle, a refusal, another key's assignment or an answer to a stale call id changes nothing it would execute",
    { forge: true, finish: ["ok"], restart: false },
    ["execute", "request:other", "forge:other@live", "forge:idle@live", "forge:refused@live", "stale"],
    100,
  );
});
