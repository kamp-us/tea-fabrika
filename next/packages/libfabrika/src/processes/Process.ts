/**
 * The process table and its rules: names, lifecycle events, watches, and who may write what.
 *
 * Nothing about a process is kept outside the ledger. `ProcessTable` folds the brain's own lines
 * into the current picture, and a call on it only decides: the caller writes what the answer
 * allows, in the same ledger turn.
 */
import { applyCell } from "@demlik/tea";
import { Equal, Option, Result, Schema } from "effect";
import * as Rec from "effect/Record";
import { LedgerError } from "../ledger/Ledger.ts";
import type { LedgerTurn } from "../ledger/LedgerTransaction.ts";
import { type Entry, valueFor } from "../ledger/Log.ts";
import { ProcessId } from "../ProcessId.ts";
import { Rev } from "../Rev.ts";
import { ExitReason, sameReason } from "./ExitReason.ts";
import {
  Code,
  Count,
  type Life,
  type Model,
  Owner,
  ProcessEvent,
  processTableFor,
  Recipient,
  signalId,
  Start,
  State,
  Text,
  watchKey,
} from "./internal/processTable.ts";
import type { From } from "./Mailbox.ts";

export {
  /**
   * Schema for who registered a name: the `brain`, or a `process`. A caller may act only on the
   * names its owner registered.
   *
   * @category schemas
   */
  Owner,
  /**
   * Schema for every lifecycle event the brain writes: `registered`, `started`, `exited`,
   * `restarted`, `down`, `monitored` and `demonitored`.
   *
   * @category schemas
   */
  ProcessEvent,
  /**
   * Schema for who a watch delivers to: a `process`, or a `client` session.
   *
   * @category schemas
   */
  Recipient,
  /**
   * Returns the one id a `DOWN` letter is written under, for a recipient, a watch reference and
   * the watch's round.
   *
   * @category getters
   */
  signalId,
  /**
   * Schema for one start request: `first` for a name's first process, or `again` to restart the
   * name after the process its `after` field gives.
   *
   * @category schemas
   */
  Start,
  /**
   * Schema for the state of one life: `live`, `ended` with its exit reason, or `down` with its
   * crash count and the time it is down until.
   *
   * @category schemas
   */
  State,
};

const PROCESSES = "processes";

const CLIENTS = "client:";

/** Names that lead streams this layer or the gateway already owns. */
const RESERVED = `(?!(?:${PROCESSES}|gateway)$)`;

/**
 * A process name is a stream name: no `/`, so `<name>` and `<name>/inbox` never meet another's,
 * no `client:` lead, so it never meets a client's inbox, and never `processes` or `gateway`.
 *
 * @category schemas
 */
export const ProcessName = Text.check(Schema.isPattern(new RegExp(`^${RESERVED}(?!${CLIENTS})[a-z0-9][a-z0-9._:-]*$`)));

/** A client id has no `:`, the mark of a process name such as `counter:1`. */
const ClientId = Text.check(Schema.isPattern(new RegExp(`^(?!${PROCESSES}$)[a-z0-9][a-z0-9._-]*$`)));

/**
 * Who is calling the process table: the `owner`, which may act only on names it registered, and
 * the `recipient` its watches deliver to. Trusted wiring sets both; neither is decoded from a
 * public request.
 *
 * @category models
 */
export type Caller = { readonly owner: typeof Owner.Type; readonly recipient: typeof Recipient.Type };

/** Where a registered name's own lifecycle events live: `processes/<name>`. */
const eventStream = (name: string): string => `${PROCESSES}/${name}`;

/**
 * Checks whether a write is one only the brain may make, which the gateway and the mailbox refuse.
 *
 * **Details**
 *
 * Only the brain's `ProcessManager` writes the `processes` stream, any stream under `processes/`,
 * any `<process>/dead` stream or `dead` entry, any `ProcessEvent` case, or any signal, runner or
 * notice id. The answer is true when the write is any of these.
 *
 * @category guards
 */
export const brainOnly = (write: { readonly stream: string; readonly id: string; readonly tag: string }): boolean =>
  write.stream === PROCESSES ||
  write.stream.startsWith(`${PROCESSES}/`) ||
  write.stream.endsWith("/dead") ||
  write.tag === "dead" ||
  Rec.has<string, unknown>(ProcessEvent.cases, write.tag) ||
  inSignalSpace(write.id) ||
  inNoticeSpace(write.id) ||
  inRunnerSpace(write.id);

/**
 * Checks whether an id is in the runner id space: `process_<id>/due/...` for an alarm letter, or
 * `process_<id>/<n>/<n>/answer` for an answer. These belong to the brain, and `Mailbox` lifts the
 * rule only for a runner's own. Cmd write ids remain available to the signer.
 *
 * @category guards
 */
export const inRunnerSpace = (id: string): boolean =>
  /^process_[^/]+\/(?:due\/|[0-9]+\/[0-9]+\/answer(?:$|\/))/.test(id);

/**
 * Schema for what a monitor answers for a target that is not live when the watch is made, whether
 * it ended or never started. A monitor result, never an exit reason.
 *
 * @category schemas
 */
export const NoProc = Schema.TaggedStruct("noproc", {});

/**
 * Schema for the letter a monitor gets when the process it watches ends, as OTP's `DOWN`.
 *
 * **Details**
 *
 * It carries the watch's `ref`, the process, the recipient it is for, and the reason: the
 * process's exit reason, unchanged, or `noproc` when the process was not live when the watch was
 * made. A watch a program made by name also carries that `name`, as OTP's `{RegName, Node}`.
 *
 * **Gotchas**
 *
 * The shape alone is not a signal. A letter tagged `DOWN` counts as one only under its signal id,
 * written by the brain, for a watch that exists. Anything else is plain mail.
 *
 * @category schemas
 */
export const Down = Schema.TaggedStruct("DOWN", {
  ref: Text,
  process: ProcessId,
  name: Schema.optionalKey(ProcessName),
  reason: Schema.Union([ExitReason, NoProc]),
  to: Recipient,
});

const deadFields = {
  tries: Count,
  limit: Count,
  m: Text,
  build: Text,
  errors: Schema.Array(Text).check(Schema.isMaxLength(32)),
};

const oneErrorPerTry = Schema.makeFilter(
  (value: Schema.Struct.Type<typeof deadFields>) => value.errors.length === value.tries || "one error class per try",
);

/**
 * Schema for what a runner reports about a letter that reached its delivery limit: the `tries`,
 * the `limit`, the letter's id `m`, the `build`, and one error class per try, at most 32.
 * `ProcessManager.dead` adds the process, its program and its name to make a `Dead`.
 *
 * @category schemas
 */
export const DeadInput = Schema.Struct(deadFields).check(oneErrorPerTry);

/**
 * Schema for the `dead` entry the brain writes on `<process>/dead` when a letter reaches its
 * delivery limit: the fields of `DeadInput`, plus the process, its program and its name, which the
 * brain reads from its own table and never takes from the reporter.
 *
 * @category schemas
 */
export const Dead = Schema.TaggedStruct("dead", {
  ...deadFields,
  process: ProcessId,
  program: Code.fields.program,
  name: ProcessName,
}).check(oneErrorPerTry);

/**
 * Schema for the activity marker a process keeps in its own storage: `idle`, or `stepping` with
 * the letter it is on and its build.
 *
 * **Details**
 *
 * The runner saves `stepping` before a step and `idle` after it. A process that wakes and finds
 * `stepping` knows a step was cut short, and `recoverActivity` reads that as `interrupted`.
 *
 * @category schemas
 */
export const Activity = Schema.TaggedUnion({
  idle: { process: ProcessId },
  stepping: { process: ProcessId, letter: Text, build: Text },
});

/**
 * Schema for what `recoverActivity` answers after a wake: `idle`, or `interrupted` with the
 * process, letter and build of the step that was cut short.
 *
 * @category schemas
 */
export const Recovered = Schema.TaggedUnion({
  idle: { process: Schema.optionalKey(ProcessId) },
  interrupted: {
    process: ProcessId,
    letter: Text,
    build: Text,
    reason: Schema.Literal("interrupted"),
  },
});

/**
 * Reads a saved activity marker back after a wake.
 *
 * **Details**
 *
 * A marker that was never written is `idle`. A `stepping` marker becomes `interrupted`, with its
 * process, letter and build: the step it names did not finish. Anything else fails with a
 * `LedgerError` whose reason is `bad_row`.
 *
 * @category decoding
 */
export const recoverActivity = (raw: unknown): Result.Result<typeof Recovered.Type, LedgerError> => {
  if (raw === undefined) {
    return Result.succeed(Recovered.cases.idle.make({}));
  }

  const saved = Schema.decodeUnknownResult(Activity)(raw);

  if (Result.isFailure(saved)) {
    return Result.fail(new LedgerError({ reason: "bad_row", cause: saved.failure }));
  }

  const value = saved.success;

  return Result.succeed(
    value._tag === "idle"
      ? value
      : Recovered.cases.interrupted.make({
          process: value.process,
          letter: value.letter,
          build: value.build,
          reason: "interrupted",
        }),
  );
};

/**
 * Checks whether one more restart fits in the restart window, as OTP's restart intensity.
 *
 * **Details**
 *
 * It counts the restart times in `times` that fall within `period` before `now`, adds the restart
 * being asked for, and answers true while the total is at most `intensity`. The order of `times`
 * does not matter.
 *
 * @category guards
 */
export const canRestart = (times: ReadonlyArray<number>, now: number, period: number, intensity: number): boolean =>
  times.filter((at) => at >= now - period).length + 1 <= intensity;

/**
 * Error for a call the process table refuses. A refusal writes nothing.
 *
 * **Details**
 *
 * - `not_parent`: the caller is not the owner that registered the name.
 * - `name_taken`: a first start asks for a name that is registered, or a restart names another
 *   program than the name's.
 * - `alive`: the process is still live, so it cannot be restarted or marked down.
 * - `stale`: a restart names a process that is no longer its name's current one, or a child's
 *   requester has ended.
 * - `id_reused`: the start id was first used with another request.
 * - `id_collision`: the fresh process id is already in the table.
 * - `ended`: the process is unknown, or no longer live.
 * - `bad_ref`: the monitor reference already watches another process.
 * - `bad_name`, `bad_text`: a name, a reference or another text did not pass its schema.
 * - `forbidden`: a start's guard said no in the turn that would write it, such as a permission
 *   whose relation was removed after the start was checked.
 *
 * @category errors
 */
export class ProcessError extends Schema.TaggedError<ProcessError>()("ProcessError", {
  reason: Schema.Literals([
    "not_parent",
    "name_taken",
    "alive",
    "stale",
    "id_reused",
    "id_collision",
    "ended",
    "bad_ref",
    "bad_name",
    "bad_text",
    "forbidden",
  ]),
  /** The failure this error translates, kept in memory for diagnosis. */
  cause: Schema.optional(Schema.Defect()),
}) {}

/** A watch as queries return it, with `canceled` read from its state; it is never stored. */
type Watch = Omit<typeof ProcessEvent.cases.monitored.Type, "member"> & {
  readonly canceled: boolean;
  readonly round: number;
};

type Held = Model["watches"] extends ReadonlyMap<string, infer W> ? W : never;

const shown = ({ _tag, round, ...watch }: Held): Watch => ({
  ...ProcessEvent.cases.monitored.make(watch),
  canceled: _tag === "canceled",
  round,
});

/**
 * What a start answers: the new process's id, and the log rev of its `started` line.
 *
 * @category models
 */
export type StartAnswer = { readonly process: string; readonly rev: number };

/**
 * One live process as `ProcessTable.info` lists it: its id, its registered name, its program, the
 * hash of its build, and how many times its name has been restarted.
 *
 * @category models
 */
export type ProcessInfo = {
  readonly process: string;
  readonly name: string;
  readonly program: string;
  readonly build: string;
  readonly restarts: number;
};

const decodeDown = Schema.decodeUnknownOption(Down);

const denied = (reason: ProcessError["reason"]) => Result.fail(new ProcessError({ reason }));

const isText = Schema.is(Text);

/**
 * Returns a client's own inbox stream, `client:<id>/inbox`, where its `DOWN` letters land. It is
 * never a process's inbox, since a process name cannot lead with `client:`.
 *
 * @category getters
 */
export const clientInbox = (client: string): string => `${CLIENTS}${client}/inbox`;

/**
 * Returns the stream where the brain keeps how far a name's reader has read its inbox,
 * `processes/<name>/acked`. Its prefix makes it brain-only, so no program write and no mail
 * forges an ack.
 *
 * @category getters
 */
export const acked = (name: string): string => `${eventStream(name)}/acked`;

/**
 * Schema for one ack: the reader's live process, and the inbox pos its saved checkpoint reached.
 * An inbox's unread letters are its newest pos minus the newest ack's.
 *
 * @category schemas
 */
export const Acked = Schema.TaggedStruct("acked", { process: ProcessId, pos: Rev });

const decodeAcked = Schema.decodeUnknownOption(Acked);

/**
 * Returns the newest pos the brain acked for `name`, or 0 before any ack.
 *
 * **Details**
 *
 * It reads only the acked stream's newest entry, by an index, so it costs the same however many
 * acks the stream holds. Only a line `by` wrote counts.
 *
 * @category getters
 */
export const ackedPos = (turn: Pick<LedgerTurn, "read" | "head">, name: string, by: string): Rev => {
  const stream = acked(name);
  const newest = [...turn.read(stream, Math.max(0, turn.head(stream) - 1))].at(-1);

  return newest === undefined || newest.by !== by
    ? 0
    : Option.match(decodeAcked(valueFor(newest)), { onNone: () => 0, onSome: (ack) => ack.pos });
};

const decodeIdParts = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.Unknown)));

const led = (word: string) => {
  const lead = JSON.stringify([word]).slice(0, -1);

  return (id: string): boolean => id.startsWith(lead) || Option.exists(decodeIdParts(id), (parts) => parts[0] === word);
};

/**
 * Checks whether an id is in the signal id space, a JSON array led by `"DOWN"`. Only the brain
 * writes one.
 *
 * @category guards
 */
export const inSignalSpace = led("DOWN");

/**
 * Checks whether an id is in the notice id space, a JSON array led by `"notice"`: the ids for what
 * the brain tells a program. Only the brain writes one.
 *
 * @category guards
 */
export const inNoticeSpace = led("notice");

/**
 * Makes the letter id of a notice: the JSON array `["notice", key]`, which is in the notice id
 * space, so only the brain may write under it.
 *
 * @category constructors
 */
export const noticeId = (key: string): string => JSON.stringify(["notice", key]);

/** The names the brain's own `registered` lines in `control` register, each once, in log order. */
const registered = (control: ReadonlyArray<Entry>, by: string): ReadonlyArray<string> => [
  ...new Set(
    control
      .filter((entry) => entry._tag === "registered" && entry.by === by)
      .map((entry) => Schema.decodeUnknownSync(ProcessEvent.cases.registered)(valueFor(entry)).name),
  ),
];

/**
 * Class that folds the ledger's process events into the current table of names, lives and
 * watches, and answers what a call on it would be allowed to do.
 *
 * **Details**
 *
 * The table is disposable: nothing about a process is kept outside the ledger, and an event
 * counts only when `by` is the brain's own writer. A call decides and writes nothing, so a refusal
 * is a `ProcessError` and an allowed call returns what the caller then writes in its own ledger
 * turn. `ProcessTable.read` builds one from a ledger read.
 *
 * @category models
 */
export class ProcessTable {
  static readonly stream = PROCESSES;
  static readonly events = eventStream;
  readonly #by: string;
  readonly #machine: ReturnType<typeof processTableFor>;
  readonly #model: Model;

  /** Folds `entries`, oldest first, onto `base`'s table, or onto an empty one. */
  constructor(entries: Iterable<Entry>, by: string, base?: ProcessTable) {
    this.#by = by;
    this.#machine = base === undefined ? processTableFor(by) : base.#machine;
    let model = base === undefined ? this.#machine.init(null, undefined)[0] : base.#model;

    for (const entry of entries) {
      model = applyCell(this.#machine, model, { type: "recorded", entry })[0];
    }

    this.#model = model;
  }

  /** The table folded from rev 0: the `processes` stream and every registered name's stream. */
  static read(read: (stream: string, after: number) => Iterable<Entry>, by: string): ProcessTable {
    return new ProcessTable(ProcessTable.entries(read, by), by);
  }

  /** Every entry `read` folds from rev 0, oldest first. */
  static entries(read: (stream: string, after: number) => Iterable<Entry>, by: string): ReadonlyArray<Entry> {
    const control = [...read(ProcessTable.stream, 0)];

    return [...control, ...registered(control, by).flatMap((name) => [...read(eventStream(name), 0)])].sort(
      (a, b) => a.rev - b.rev,
    );
  }

  /**
   * The entries past the log rev `rev`, oldest first, when this table holds every entry up to it:
   * the `processes` stream, and the stream of each name this table knows or those entries register.
   *
   * **Details**
   *
   * A name's stream holds nothing of the brain's below its own `registered` line: only the brain
   * writes there, and it writes a name's first event in the turn that registers it, after that line.
   * So a name registered past `rev` has nothing to fold at or below `rev` either.
   */
  after(read: (stream: string, after: number) => Iterable<Entry>, rev: number): ReadonlyArray<Entry> {
    const control = [...read(ProcessTable.stream, rev)];
    const names = new Set([...this.#model.names.keys(), ...registered(control, this.#by)]);

    return [...control, ...[...names].flatMap((name) => [...read(eventStream(name), rev)])].sort(
      (a, b) => a.rev - b.rev,
    );
  }

  /** A new table with `entries` folded onto this one, oldest first; this table is unchanged. */
  fold(entries: Iterable<Entry>): ProcessTable {
    return new ProcessTable(entries, this.#by, this);
  }

  start(request: Start, caller: Caller, from: From): Result.Result<Option.Option<StartAnswer>, ProcessError> {
    if (!Schema.is(ProcessName)(request.name)) {
      return denied("bad_name");
    }

    if (!Schema.is(Start)(request)) {
      return denied("bad_text");
    }

    const saved = Option.getOrUndefined(this.saved(request.id));

    if (saved !== undefined) {
      if (!Equal.equals(saved.request, request) || saved.from.for !== from.for || saved.from.parent !== from.parent) {
        return denied("id_reused");
      }

      const parent = this.parent(saved.state.process, caller.owner);

      return Result.isFailure(parent)
        ? Result.fail(parent.failure)
        : Result.succeed(Option.some({ process: saved.state.process, rev: saved.rev }));
    }

    const name = this.#model.names.get(request.name);

    if (request._tag === "first") {
      // A child's requester must still be live in the turn that would write its start.
      if (request.requester?._tag === "process" && !this.isLive(request.requester.process)) {
        return denied("stale");
      }

      return name === undefined ? Result.succeed(Option.none()) : denied("name_taken");
    }

    if (name === undefined || !Equal.equals(name.owner, caller.owner)) {
      return denied("not_parent");
    }

    if (name.program !== request.code.program) {
      return denied("name_taken");
    }

    if (this.#model.current.get(request.name) !== request.after) {
      return denied("stale");
    }

    if (this.isLive(request.after)) {
      return denied("alive");
    }

    return Result.succeed(Option.none());
  }

  /** The life a start id saved, under whichever name it started. */
  saved(id: string): Option.Option<Life> {
    return Option.fromUndefinedOr([...this.#model.lives.values()].find((life) => life.request.id === id));
  }

  /** OTP's `whereis`: the name's program and its current life. Public, so it checks no owner. */
  whereis(name: string): Option.Option<{ readonly program: string; readonly state: typeof State.Type }> {
    const registered = this.#model.names.get(name);
    const life = this.#model.lives.get(this.#model.current.get(name) ?? "");

    return registered === undefined || life === undefined
      ? Option.none()
      : Option.some({ program: registered.program, state: life.state });
  }

  /** The registered name that asked for this name's first life, when a child start wrote one. */
  starter(name: string): Option.Option<string> {
    const first = [...this.#model.lives.values()].find((life) => life.name === name);
    const requester = first?.request._tag === "first" ? first.request.requester : undefined;

    return requester?._tag === "process"
      ? Option.map(this.life(requester.process), (life) => life.name)
      : Option.none();
  }

  collision(process: string): boolean {
    return this.#model.lives.has(process);
  }

  isLive(process: string): boolean {
    return this.#model.lives.get(process)?.state._tag === "live";
  }

  status(
    name: string,
    owner: typeof Owner.Type,
  ): Result.Result<
    {
      readonly name: string;
      readonly state: typeof State.Type;
      readonly restarts: ReadonlyArray<number>;
    },
    ProcessError
  > {
    const process = this.#model.current.get(name);

    if (process === undefined) {
      return denied("ended");
    }

    const life = this.parent(process, owner);
    const restarts = this.#model.restarts.get(name) ?? [];

    return Result.isFailure(life)
      ? Result.fail(life.failure)
      : Result.succeed({ name, state: life.success.state, restarts });
  }

  life(process: string): Option.Option<Life> {
    return Option.fromUndefinedOr(this.#model.lives.get(process));
  }

  parent(process: string, owner: typeof Owner.Type): Result.Result<Life, ProcessError> {
    const life = this.#model.lives.get(process);

    if (life === undefined) {
      return denied("ended");
    }

    const reserved = this.#model.names.get(life.name);

    return Equal.equals(reserved?.owner, owner) ? Result.succeed(life) : denied("not_parent");
  }

  /** The life a decoded exit ends; an ended process answers again only to the same reason. */
  exit(process: string, reason: ExitReason, owner: typeof Owner.Type): Result.Result<Life, ProcessError> {
    const parent = this.parent(process, owner);

    if (Result.isFailure(parent)) {
      return parent;
    }

    const { state, exited } = parent.success;

    return state._tag !== "live" && (exited === undefined || !sameReason(exited, reason)) ? denied("ended") : parent;
  }

  /** The life a supervisor gives up on; refused while that process still lives. */
  down(process: string, reason: string, owner: typeof Owner.Type): Result.Result<Life, ProcessError> {
    if (!isText(reason)) {
      return denied("bad_text");
    }

    const parent = this.parent(process, owner);

    if (Result.isFailure(parent)) {
      return parent;
    }

    return parent.success.state._tag === "live" ? denied("alive") : parent;
  }

  /** The round to write for a new or renewed watch; none when this watch is already live. */
  monitor(ref: string, process: string, to: typeof Recipient.Type): Result.Result<Option.Option<number>, ProcessError> {
    if (!isText(ref)) {
      return denied("bad_text");
    }

    if (to._tag === "client" && !Schema.is(ClientId)(to.client)) {
      return denied("bad_name");
    }

    const watch = this.#model.watches.get(watchKey(to, ref));

    if (watch !== undefined && watch.process !== process) {
      return denied("bad_ref");
    }

    if (watch !== undefined && watch._tag === "live") {
      return Result.succeed(Option.none());
    }

    if (to._tag === "process" && !this.isLive(to.process)) {
      return denied("ended");
    }

    return Result.succeed(Option.some((watch?.round ?? 0) + 1));
  }

  /** The caller's own live watch under `ref`, if any. Another recipient's ref is never touched. */
  demonitor(ref: string, to: typeof Recipient.Type): Option.Option<Watch> {
    return Option.filter(this.watch(ref, to), (watch) => !watch.canceled);
  }

  /** The watch saved under (`to`, `ref`), live or canceled, so a retried watch finds its own. */
  watch(ref: string, to: typeof Recipient.Type): Option.Option<Watch> {
    return Option.map(Option.fromUndefinedOr(this.#model.watches.get(watchKey(to, ref))), shown);
  }

  inbound(process: string): ReadonlyArray<Watch> {
    return [...this.#model.watches.values()]
      .filter((watch) => watch._tag === "live" && watch.process === process)
      .map(shown);
  }

  outbound(process: string): ReadonlyArray<Watch> {
    return [...this.#model.watches.values()]
      .filter(({ _tag, to }) => _tag === "live" && to._tag === "process" && to.process === process)
      .map(shown);
  }

  /**
   * The live watches a client session holds: those whose recipient is a client with `session` and
   * whose process still runs. A watch whose process exited already fired its DOWN, and in OTP a
   * monitor that fired is gone, so the session's leave has nothing left to end there.
   */
  held(session: string): ReadonlyArray<Watch> {
    return [...this.#model.watches.values()]
      .filter(
        ({ _tag, to, process }) =>
          _tag === "live" && to._tag === "client" && to.session === session && this.isLive(process),
      )
      .map(shown);
  }

  /**
   * How fresh delivery treats one letter. A DOWN is a signal only under its signal id, from the
   * brain, with a watch of that recipient, ref and target, live or canceled. A signal reaches only
   * its own recipient, and only while its watch is live. Anything else is plain mail.
   */
  deliver(entry: Entry, m: unknown, process: string): "mail" | "signal" | "drop" {
    if (typeof m !== "object" || m === null || !("_tag" in m) || m._tag !== "DOWN") {
      return "mail";
    }

    const down = decodeDown(m);

    if (Option.isNone(down)) {
      return "mail";
    }

    const { to, ref } = down.value;
    const watch = this.#model.watches.get(watchKey(to, ref));

    if (entry.by !== this.#by || watch === undefined || watch.process !== down.value.process) {
      return "mail";
    }

    const round = Array.from({ length: watch.round }, (_, n) => n + 1).find((n) => entry.id === signalId(to, ref, n));

    if (round === undefined) {
      return "mail";
    }

    // An earlier round's signal belongs to a watch already canceled.
    const current = round === watch.round && watch._tag === "live";

    return current && to._tag === "process" && to.process === process ? "signal" : "drop";
  }

  get info(): ReadonlyArray<ProcessInfo> {
    return [...this.#model.lives.values()]
      .filter((life) => life.state._tag === "live")
      .map((life) => ({
        process: life.state.process,
        name: life.name,
        program: life.state.code.program,
        build: life.state.code.hash,
        restarts: this.#model.restarts.get(life.name)?.length ?? 0,
      }));
  }
}
