// P39 slice 4a, next/: the hands machine's laws H1, H3 and H4, on its real `init` and `update`.
//
// What these laws hold `client/HandsMachine.ts` to, from the approved plan (the build may add more):
// - It exports `handsMachine`, one tea machine (0046) made with `Machine.make`, whose `init(null, {})`
//   boots a fresh client. Its model holds `link` (`transport/Link.ts`), `handshake`
//   (`transport/Handshake.ts`) and `work`, the plan's work state, tagged `offline`, `listing`,
//   `watching`, `taking`, `recalling`, `saving`, `starting`, `executing` or `reporting`; a work
//   state about a task names it `id`, with its `execution`, and `reporting` keeps the `result`; a
//   state with a call out keeps its JSON-RPC id as `call`. A finish refused for a reason on H3's
//   closed list is saved as a `held` journal entry with the brain's `reason`, and the client goes
//   back to listing; a finish refused for any other reason is sent again.
// - It takes the socket Msgs of the dial Sub the window shares (`socket_opened {dial, at}`,
//   `frame {dial, text, at}`, `socket_closed {dial, code, at}`), its own timers' Msgs, and tea's
//   `<cmd>_ok` and `<cmd>_err` for its Cmds. Its `subs` hold a `socket` Sub whose deps carry the
//   `dial` to open, and its timers as tea's built-in `timer`.
// - Its Cmds are the seven the start interprets: `write {dial, id, method, params}` (one JSON-RPC
//   call; the start adds `sentAt` where the call takes one), `hello` and `knock` (the Handshake's),
//   `ping`, `journal_read {task}` (ok: the task's entry or null), `journal_write {task, entry}` (ok:
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
// refused `unavailable` as done and save `acknowledged`; or hold a finish refused `rate_limited`. H4, execute the task in any `assigned`
// answer, whoever it names.
import { applyCell, type Machine } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import * as fc from "fast-check";
import { fcTypeId } from "../tasks/TasksTest.ts";
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

/**
 * H3's closed list: the finish refusals that say what the brain holds, or the client's own params,
 * which the same finish can never change. Only these hold a result. `lacks_capability` waits for a
 * new link, and every other reason, an answer that does not decode and a reason nobody answers yet
 * included, sends the same result again.
 */
const HELD: ReadonlySet<string> = new Set([
  "not_allowed",
  "not_target",
  "conflict",
  "wrong_execution",
  "wrong_state",
  "wrong_process",
  "not_found",
  "bad_input",
  "reserved",
  "unknown_method",
]);

type Model = typeof handsMachine.model.Type;
/** A Msg as the walk builds it: one of the machine's own. */
type Sent = typeof handsMachine extends Machine<Model, infer M, infer _C, infer _U, infer _X> ? M : never;
/** The machine's own Cmds, as its `init` and update cells give them. */
type Out = typeof handsMachine extends Machine<Model, infer _M, infer C, infer _U, infer _X> ? C : never;
/** A journal entry, as the machine writes it. */
type Entry = Extract<Out, { readonly type: "journal_write" }>["entry"];

const step = (s: Model, m: Sent) => applyCell<Model, Sent, Out>(handsMachine, s, m);
const boot = (): readonly [Model, ReadonlyArray<Out>] => handsMachine.init(null, {});

const record = (v: unknown): ReadonlyMap<string, unknown> =>
  typeof v === "object" && v !== null ? new Map(Object.entries(v)) : new Map();

const text = (v: unknown) => (typeof v === "string" ? v : "");
const tagIn = (v: unknown) => text(record(v).get("_tag"));
const parse = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** The task a work state is about, and its execution, or null for a state about no task. */
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
type Forge = "other" | "idle" | "refused" | "not_allowed" | "lacks_capability";

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
  /** The journal: each task's last saved entry, kept across restarts as a file would keep it. */
  readonly journal: Map<string, Entry>;
  readonly door: Brain;
  /** The oracle's own counts, across every restart. */
  readonly executes: Map<string, number>;
  readonly results: Map<string, Set<string>>;
  /** Tasks whose finish the machine heard answered ok, in any process. */
  readonly acked: Set<string>;
  /** Tasks this process holds after a refusal for good: its journal keeps why, so never again. */
  held: Set<string>;
  /** The dial each task was held on: work after it on the same dial shows the hold blocks nothing. */
  heldOn: Map<string, number>;
  /** H3: tasks whose finish was refused for a reason that may pass, by that reason: its result is owed again. */
  readonly owed: Map<string, string>;
  /** H4: processes that asked this key twice, whose tasks no take can get. */
  readonly twins: Set<string>;
  /** H4: tasks whose take was refused for a reason that cannot change by itself, by the list rev
   *  then, on this link: none is taken again on it until a list answers another rev. */
  refused: Map<string, number>;
  /** The rev of the last list the machine heard answered on this link, or null before its first. */
  listRev: number | null;
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
  /** `held`: a restart only once the journal holds a `held` entry, so the walk still reaches its finishes. */
  readonly restart: boolean | "held";
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
    heldOn: new Map(),
    owed: new Map(),
    twins: new Set(),
    refused: new Map(),
    listRev: null,
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
        const task = w.door.read(id ?? "");
        const saved = record(w.journal.get(id ?? ""));
        expect(next.work._tag, "H1: execute only in executing").toBe("executing");
        expect(task?.phase, "H1: only after the brain has the task started").toBe("started");
        expect(task?.execution, "H1: for the execution the brain started").toBe(execution);
        expect(task?.executor, "H4: only work assigned to the client's own key").toBe(KEY);
        expect(saved.get("_tag"), "H1: only after `executing` was saved").toBe("executing");
        expect(saved.get("execution"), "H1: `executing` was saved for this execution").toBe(execution);
        expect(record(c).get("command"), "H1: the command the brain holds").toEqual(task?.request.command);
        const count = (w.executes.get(id ?? "") ?? 0) + 1;
        w.executes.set(id ?? "", count);
        expect(count, `H1: execute at most once for ${id}, across every restart`).toBe(1);
        done.add("execute");
      }

      if (c.type === "write" && record(c).get("method") === "tasks.take") {
        const process = text(record(record(c).get("params")).get("process"));
        const { id } = about(next);
        expect(w.twins.has(process), "H4: no take names a process with two open tasks: it cannot succeed").toBe(false);
        expect(w.held.has(id ?? ""), "H3: a held task is never taken again").toBe(false);

        // A hold refused one task for good: the client lists and takes other work on the same link.
        if ([...w.heldOn.values()].includes(socketDial() ?? -1)) {
          done.add("take_after_held");
        }

        expect(
          w.refused.has(id ?? "") && w.refused.get(id ?? "") === w.listRev,
          `H4: ${id}, refused for good on this link, is not taken again until the list's rev moves`,
        ).toBe(false);
      }

      if (c.type === "journal_write") {
        // The data shape: when the command started, on the client's own clock, outlives the entry
        // that first held it. A result keeps the start its `executing` entry saved, and every entry
        // after the result keeps the result's.
        const task = text(record(c).get("task"));
        const entry = record(record(c).get("entry"));
        const before = record(w.journal.get(task));
        const same = before.get("execution") === entry.get("execution");
        const tag = text(entry.get("_tag"));

        if (same && tag === "result" && before.get("_tag") === "executing") {
          expect(entry.get("startedAt"), "a result keeps when its command started").toBe(before.get("at"));
          done.add("result:startedAt");
        }

        if (same && (tag === "acknowledged" || tag === "held") && before.get("_tag") === "result") {
          expect(entry.get("startedAt"), `${tag} keeps when its command started`).toBe(before.get("startedAt"));
        }

        // H3: a result is held only for a reason on the closed list, never for one that may pass.
        if (tag === "held") {
          expect(
            HELD.has(text(entry.get("reason"))),
            `H3: held only for the closed list, not ${text(entry.get("reason"))}`,
          ).toBe(true);
          done.add("held:closed");
        }
      }

      if (c.type === "write" && record(c).get("method") === "tasks.finish") {
        const params = record(record(c).get("params"));
        const task = text(params.get("task"));
        expect(w.held.has(task), "H3: a held result sends nothing more").toBe(false);
        expect(tagIn(w.journal.get(task)), "H3: a result the journal holds is never sent, by any process").not.toBe(
          "held",
        );
        const sent = w.results.get(task) ?? new Set<string>();
        sent.add(JSON.stringify(params.get("result")));
        w.results.set(task, sent);
        expect(sent.size, `H3: one result for ${task}, never a second, different one`).toBe(1);
        done.add("finish_sent");

        // A finish refused for a reason that may pass goes again, with the one result above.
        const owed = w.owed.get(task);

        if (owed !== undefined) {
          w.owed.delete(task);
          done.add(owed === "lacks_capability" ? "finish:resent:lacks_capability" : "finish:resent");
        }
      }

      if (c.type === "journal_write" && tagIn(record(c).get("entry")) === "acknowledged") {
        expect(w.acked.has(text(record(c).get("task"))), "H3: acknowledged only after the brain said ok").toBe(true);
      }
    }
  };

  const apply = (m: Sent) => {
    const prev = w.s;
    const [next, cmds] = step(prev, m);
    check(next, cmds);

    // A refusal for good is kept for the link it came on: a link that left online, by a close or by
    // its own stall timer, starts a new link, which may try the task again. A held result is held
    // for good, on every link: its journal entry says why.
    if (prev.link._tag === "online" && (next.link._tag !== "online" || next.link.dial !== prev.link.dial)) {
      w.refused = new Map();
      w.listRev = null;
    }

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
      const task = text(r.get("task"));

      // H4: a saved value that reads as no entry cannot change by itself: the task is not taken
      // again on this link until the list's rev moves.
      if (moves.forge && cell.variant % 5 === 0 && w.s.work._tag === "recalling" && about(w.s).id === task) {
        w.refused.set(task, w.listRev ?? -1);
        done.add("recall:bad_entry");
        return { type: "journal_read_err", cmd: c, error: { _tag: "JournalError", reason: "bad_entry" }, at: w.at };
      }

      const entry = w.journal.get(task) ?? null;
      done.add(`recall:${entry === null ? "nothing" : tagIn(entry)}`);
      return { type: "journal_read_ok", cmd: c, value: entry, at: w.at };
    }

    if (c.type === "journal_write") {
      if (cell.variant % 7 === 0) {
        done.add("journal_failed");
        return { type: "journal_write_err", cmd: c, error: { _tag: "JournalError", reason: "storage" }, at: w.at };
      }

      w.journal.set(c.task, c.entry);
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
              : rpc({ id: call.id, error: { code: -32000, message: "no", data: { reason: forge } } });
      return frame(call.dial, forged);
    }

    const mode = moves.finish[cell.variant % moves.finish.length] ?? "ok";
    const outcome = w.door.call(KEY, call.method, call.params, mode === "lost" ? "ok" : mode);

    if (outcome._tag === "parked") {
      w.stale = w.stale.filter((x) => x !== call);
      w.parked.push({ ...call, after: outcome.after });
      return null;
    }

    if (call.method === "tasks.finish" && mode === "lost") {
      // The answer never came, so the call is still the machine's live one, never a stale id.
      w.stale = w.stale.filter((x) => x !== call);
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
          if (call !== undefined && call.method.startsWith("tasks.")) {
            w.door.call(KEY, call.method, call.params);
          }

          w.wire = w.wire.filter((x) => x !== call);
          return null;
        },
      });
    }

    const take = w.wire.find((c) => c.method === "tasks.take" && c.dial === dial);

    if (moves.forge && take !== undefined) {
      // Another key's assignment is offered only once the brain holds a task for that key.
      const theirs = w.door.all().some((j) => j.request.target === OTHER);
      const forges = theirs
        ? (["other", "idle", "refused", "not_allowed", "lacks_capability"] as const)
        : (["idle", "refused", "lacks_capability"] as const);
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

    // A new task is asked for a process only when that process has no open task (0093): two open
    // tasks of one process wedge `tasks.take` (finding 2026-11-15-jobs-take-ambiguous-wedges), and
    // only H4's `twin` move builds that state, on purpose.
    const open = w.door.all().filter((j) => j.phase !== "finished");
    const free = tape.processes.filter((p) => !open.some((j) => j.request.process === p));
    const process = free[cell.pick % Math.max(1, free.length)];
    // A held task stays open at the brain and is no work for the client: new work is asked as often
    // as when nothing is open, so the walk sees whether a hold blocks it.
    const live = open.filter((j) => !w.held.has(j.request.id));

    if (process !== undefined) {
      out.push({
        label: open.length === 0 ? "request" : live.length === 0 ? "request_after_held" : "request_more",
        weight: live.length === 0 ? 4 : 1,
        run: () => {
          const target = moves.forge && cell.variant % 3 === 0 ? OTHER : KEY;
          w.door.request(target, process, ++w.n);
          done.add(target === KEY ? "request" : "request:other");
          return null;
        },
      });
    }

    // H4: one process asks this key twice, so neither task can be taken.
    if (moves.forge && process !== undefined && free.length > 1 && w.twins.size === 0) {
      out.push({
        label: "twin",
        weight: 1,
        run: () => {
          w.door.request(KEY, process, ++w.n);
          w.door.request(KEY, process, ++w.n);
          w.twins.add(process);
          return null;
        },
      });
    }

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
          // A refusal for good is kept for its link; a held result stays held on the next one.
          w.refused = new Map();
          w.listRev = null;
          return { type: "socket_closed", dial, code: 1006, at: w.at };
        },
      });
    }

    const heldSaved = [...w.journal.values()].some((entry) => tagIn(entry) === "held");

    if (moves.restart === true || (moves.restart === "held" && heldSaved)) {
      out.push({
        label: moves.restart === "held" ? "restart@held" : `restart@${w.s.work._tag}`,
        weight:
          moves.restart === "held"
            ? 1
            : ["executing", "saving", "starting", "reporting"].includes(w.s.work._tag)
              ? 3
              : 1,
        run: () => {
          // A cut after a journal write: the entry landed, and the process died before it heard.
          if (cell.variant % 2 === 0) {
            for (const c of w.waiting) {
              if (c.type === "journal_write") {
                w.journal.set(c.task, c.entry);
              }
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
          // A new process knows only what its journal says: it may take a held task once more, to
          // read why, and never sends its result.
          w.held = new Set();
          w.heldOn = new Map();
          w.refused = new Map();
          w.listRev = null;
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
    const take = w.wire.find((c) => c.method === "tasks.take");
    const m = chosen.run();

    if (m === null) {
      continue;
    }

    // H3: a finish answer on the live call, read before the machine takes it: an ok lets it save
    // `acknowledged` in the same step.
    const reply = m.type === "frame" ? record(Option.getOrNull(parse(text(m.text)))) : new Map<string, unknown>();
    const reason = text(record(record(reply.get("error")).get("data")).get("reason"));
    const answered = record(reply.get("result"));
    const rev = typeof answered.get("rev") === "number" ? Number(answered.get("rev")) : null;
    const onLive = chosen.label === "door:tasks.finish" && live.tag === "reporting" && reply.get("id") === live.call;
    // An ok is a receipt: a result with no rev says nothing the client can trust.
    const receipt = reason === "" && rev !== null;

    if (onLive && receipt) {
      w.acked.add(live.id ?? "");
    }

    // The list the machine hears on its live call sets the rev a refusal for good is kept against,
    // before the machine acts on it.
    const listing = chosen.label === "door:tasks.list" && live.tag === "listing" && reply.get("id") === live.call;

    if (listing) {
      w.listRev = rev;
    }

    const { prev, next, cmds } = apply(m);

    if (onLive) {
      const task = live.id ?? "";
      const writes = cmds.filter((c) => c.type === "journal_write");

      if (reason === "lacks_capability") {
        // A need this link did not offer: nothing is held, and nothing goes again on this link.
        expect(writes, "H3: lacks_capability holds nothing").toEqual([]);
        expect(next.work._tag === "reporting" && about(next).id === task, "H3: and waits for a new link").toBe(false);
        w.owed.set(task, reason);
        done.add("finish:lacks_capability");
      } else if (!receipt && !HELD.has(reason)) {
        // A reason that may pass, an answer that does not decode, or one nobody answers yet.
        expect(next.work._tag, `H3: a finish refused ${reason || "garbled"} is sent again`).toBe("reporting");
        expect(about(next).id, "H3: for the same task").toBe(task);
        expect("result" in next.work ? next.work.result : null, "H3: with the same result").toEqual(
          "result" in prev.work ? prev.work.result : undefined,
        );
        expect(writes, `H3: a finish refused ${reason || "garbled"} writes no held entry`).toEqual([]);
        w.owed.set(task, reason);
        done.add(`finish:again:${reason || "garbled"}`);
      } else if (reason !== "") {
        // Why it was refused for good is saved before anything else: a `held` entry in the journal,
        // with the same execution and result, so no process sends it again.
        const entry = record(record(writes[0]).get("entry"));
        expect(next.work._tag, `H3: a finish refused ${reason} saves why first`).toBe("saving");
        expect(
          writes.map((c) => record(c).get("task")),
          "H3: one write, for this task",
        ).toEqual([task]);
        expect(entry.get("_tag"), "H3: the entry saved is held").toBe("held");
        expect(entry.get("reason"), "H3: it keeps the brain's reason").toBe(reason);
        expect(entry.get("execution"), "H3: for this execution").toBe(live.execution);
        expect(entry.get("result"), "H3: with the result it held").toEqual(
          "result" in prev.work ? prev.work.result : undefined,
        );
        w.held.add(task);
        w.heldOn.set(task, live.dial ?? -1);
        done.add("finish:held");
      } else {
        expect(about(next).id === task && next.work._tag === "reporting", "H3: an ok ends the report").toBe(false);
        done.add("finish:ok");
      }
    }

    // H4: a list whose open tasks are each one no take can get takes none and waits for new work,
    // with a `tasks.wait` after the list's rev, never a take that cannot succeed and never a poll:
    // a process with two open tasks, a task refused for good on this link at this rev, a held task.
    const listed = answered.get("tasks");
    const pointers = Array.isArray(listed)
      ? listed.map((p) => ({ id: text(record(p).get("id")), process: text(record(p).get("process")) }))
      : [];

    const blocked = (p: { readonly id: string; readonly process: string }) =>
      w.twins.has(p.process) || w.held.has(p.id) || (w.refused.has(p.id) && w.refused.get(p.id) === rev);

    if (listing && pointers.length > 0 && pointers.every(blocked)) {
      expect(next.work._tag, "H4: nothing a take can get: take none, wait for new work").toBe("watching");
      expect(
        cmds.filter((c) => c.type === "write").map((c) => record(c).get("method")),
        "H4: the one call is a wait",
      ).toEqual(["tasks.wait"]);
      done.add(pointers.some((p) => w.twins.has(p.process)) ? "twin:watching" : "blocked:watching");
    }

    // H4: a take refused for a reason that cannot change by itself, kept against the list's rev:
    // an idle (the list was behind), `ambiguous`, `not_allowed`, `lacks_capability`, or another
    // key's assignment.
    const forgedLive = chosen.label.startsWith("forge:") && take !== undefined && take.id === live.call;
    const takeReply = chosen.label === "door:tasks.take" && reply.get("id") === live.call;
    const forGood =
      ["idle", "refused"].includes(tagIn(answered)) ||
      ["ambiguous", "not_allowed", "lacks_capability", "bad_input"].includes(reason);

    if ((forgedLive || (takeReply && forGood)) && live.tag === "taking" && live.id !== null) {
      w.refused.set(live.id, w.listRev ?? -1);
    }

    // H4: a forged answer to the live take, or any answer to a stale id, starts nothing to execute.
    if (chosen.label.startsWith("forge:") || chosen.label === "stale") {
      const forged = take !== undefined && take.id === live.call && chosen.label.startsWith("forge:");
      const busy = ["recalling", "saving", "starting", "executing", "reporting"];
      expect(cmds.some((c) => c.type === "execute" || c.type === "journal_write")).toBe(false);
      expect(
        forged || chosen.label === "stale" ? busy.includes(next.work._tag) && !busy.includes(prev.work._tag) : false,
        `H4: ${chosen.label} in ${prev.work._tag} starts no task`,
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
    "H1: the client calls execute only in executing, only after tasks.started answered ok and executing was saved, and at most once per task across every restart; a result keeps when its command started",
    { forge: false, finish: ["ok"], restart: true },
    [
      "execute",
      "restart@executing",
      "recall:executing",
      "recall:nothing",
      "finish_sent",
      "close",
      "timer",
      "result:startedAt",
    ],
    100,
  );
  law(
    "H3: a finish refused for a reason that may pass (unavailable, rate_limited, unreachable, storage, not_granted, a reason nobody answers yet, an answer that does not decode) is sent again with the same result and never held; lacks_capability holds nothing and is sent again on a new link; only a refusal on the closed list saves a held entry with the brain's reason, and that task is never sent or taken again while other work goes on; a second, different result is never sent for one task",
    {
      forge: false,
      finish: [
        "ok",
        "lost",
        "unavailable",
        "garbled",
        "rate_limited",
        "unreachable",
        "storage",
        "not_granted",
        "reason_nobody_answers_yet",
        "lacks_capability",
        "not_allowed",
        "conflict",
        "wrong_state",
        "bad_input",
      ],
      restart: "held",
    },
    [
      "finish_sent",
      "finish:ok",
      "finish:again:unavailable",
      "finish:again:garbled",
      "finish:again:rate_limited",
      "finish:again:unreachable",
      "finish:again:storage",
      "finish:again:not_granted",
      "finish:again:reason_nobody_answers_yet",
      "finish:lacks_capability",
      "finish:resent",
      "finish:resent:lacks_capability",
      "finish:held",
      "held:closed",
      "finish:lost",
      "take_after_held",
      "restart@held",
      "recall:held",
    ],
    100,
  );
  law(
    "H4: the client runs only work assigned to its own key: an idle, a refusal, another key's assignment or an answer to a stale call id changes nothing it would execute; a task whose take was refused for a reason that cannot change by itself is not taken again on that link until the list's rev moves, and with nothing a take can get the client waits for new work",
    { forge: true, finish: ["ok"], restart: false },
    [
      "execute",
      "request:other",
      "forge:other@live",
      "forge:idle@live",
      "forge:refused@live",
      "forge:lacks_capability@live",
      "recall:bad_entry",
      "stale",
      "twin",
      "twin:watching",
      "blocked:watching",
    ],
    100,
  );
});
