import type { Settled } from "@demlik/tea";
import { Machine } from "@demlik/tea/effect";
import { CodeHost, Program, Send, StartChild, Started, type Refusal } from "@kampus/libfabrika";
import { Array as Arr, Record as Rec, Schema } from "effect";
import { Abandon, Drop, Enqueue, Land, Reply, Resume } from "./Mail.ts";
import type { Values } from "./Settings.ts";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Entry = Schema.Struct({
  change: CodeHost.ChangeId,
  head: CodeHost.Commit,
  reply: Schema.NullOr(Schema.requiredKey(Enqueue.fields.reply)),
});

const Current = Schema.Struct({ ...Entry.fields, name: Schema.NonEmptyString });

const Stop = Schema.TaggedUnion({
  tree_drift: { change: CodeHost.ChangeId, commit: CodeHost.Commit, tree: CodeHost.Tree, checked: CodeHost.Tree },
  start_refused: { change: CodeHost.ChangeId, name: Schema.NonEmptyString, refusal: Schema.String },
});

const counts = { attempt: Count, late: Count };

const line = { ...counts, line: Schema.Array(Entry) };

const Model = Schema.TaggedUnion({
  idle: counts,
  starting: { ...line, current: Current },
  landing: { ...line, current: Current, since: Schema.Finite },
  stopped: { ...line, reason: Stop },
});

type Model = typeof Model.Type;

type Entry = typeof Entry.Type;

type Command = ReturnType<typeof StartChild.startChild | typeof Send.send>;

type Cell = readonly [Model, ReadonlyArray<Command>];

const answers = <const N extends string, F extends Schema.Struct.Fields, O extends Schema.Top, const T extends string>(
  name: N,
  input: Schema.Struct<F>,
  ok: O,
  tags: ReadonlyArray<T>,
) => {
  const cmd = input.mapFields((fields) => ({
    ...fields,
    // oxlint-disable-next-line fabrika/no-hand-tag -- a Cmd's input restated as tea's value, keyed `_tag` by tea; slice 5 (demlik 952) deletes this helper
    _tag: Schema.Literal(name),
  }));

  return Schema.Union([
    Schema.TaggedStruct(`${name}_ok`, { cmd, value: ok, at: Schema.Finite }),
    Schema.TaggedStruct(`${name}_err`, {
      cmd,
      error: Schema.Union([
        ...Arr.map(tags, (tag) => Schema.TaggedStruct(tag, {})),
        // tea adds malformed_result to every settled error: a reply whose value fails its own schema.
        Schema.TaggedStruct("malformed_result", {
          issues: Schema.Array(Schema.Struct({ path: Schema.String, message: Schema.String })),
        }),
      ]),
      at: Schema.Finite,
    }),
  ]);
};

/**
 * The runner's own answer to a refused start, beside tea's: `cmd` echoes only the Cmd's `_tag`, and
 * `reason` says why. One start is out while `starting`, so a refusal with no name answers that start.
 */
const StartRefused = Schema.TaggedStruct("start_child_err", {
  cmd: Schema.TaggedStruct("start_child", {}),
  reason: Schema.Literals([...StartChild.StartRefusal.literals, "bad_cmd"]),
  at: Schema.Finite,
});

const Msg = Schema.Union([
  Enqueue,
  Drop,
  Resume,
  Reply,
  answers("start_child", StartChild.StartChildInput, Started, StartChild.startChild.errTags),
  StartRefused,
  answers("send", Send.SendInput, Send.Queued, Send.send.errTags),
]);

/** What the machine decodes: the inputs alone, since tea mints each answer from the Cmd list. */
const Input = Schema.Union([Enqueue, Drop, Resume, Reply]);

type Message = typeof Input.Type | Settled<typeof StartChild.startChild | typeof Send.send> | typeof StartRefused.Type;

/** The whole Msg the program declares, as tea types it: the inputs and each Cmd's settled answers. */
const Whole: Schema.Codec<Message, typeof Msg.Encoded> = Msg;

const forward = (entry: Entry, reply: typeof Reply.Type): ReadonlyArray<Command> =>
  entry.reply === null ? [] : [Send.send({ to: entry.reply.to, m: { ...reply, ref: entry.reply.ref } })];

/** One queue, registered under the same name its host supplies here. */
export const queue = ({ name, settings }: { readonly name: string; readonly settings: Values }) => {
  const unset = Arr.every(Rec.values(settings.checks), (checks) => checks.length === 0);

  const next = (s: Pick<Model, "attempt" | "late">, line: ReadonlyArray<Entry>): Cell => {
    const [entry, ...rest] = line;

    if (entry === undefined) {
      return [Model.cases.idle.make({ attempt: s.attempt, late: s.late }), []];
    }

    const attempt = s.attempt + 1;
    const current = { ...entry, name: `merger:${entry.change}.${attempt}` };

    return [
      Model.cases.starting.make({ attempt, late: s.late, current, line: rest }),
      [
        StartChild.startChild({
          program: "pipeline/merger",
          name: current.name,
          input: Land.make({ ref: String(attempt), change: entry.change, head: entry.head, reply: name }),
        }),
      ],
    ];
  };

  const refuse = (s: Model, m: Message): Refusal | null => {
    const line = s._tag === "idle" ? [] : s.line;
    const current = s._tag === "starting" || s._tag === "landing" ? s.current : null;

    if (m._tag === "enqueue") {
      if (unset) {
        return { reason: "unset" };
      }

      if (current?.change === m.change || Arr.some(line, (entry) => entry.change === m.change)) {
        return { reason: "queued" };
      }

      if (line.length >= settings.most) {
        return { reason: "full", now: line.length, most: settings.most };
      }
    }

    if (m._tag === "drop") {
      if (current?.change !== m.change && !Arr.some(line, (entry) => entry.change === m.change)) {
        return { reason: "missing" };
      }

      if (s._tag === "starting" && current?.change === m.change) {
        return { reason: "starting" };
      }
    }

    return m._tag === "resume" && s._tag !== "stopped" ? { reason: "running" } : null;
  };

  const reduce = (s: Model, m: Message): Cell => {
    if (m._tag === "send_ok" || m._tag === "send_err") {
      return [s, []];
    }

    if (refuse(s, m) !== null) {
      return [s, []];
    }

    if (m._tag === "enqueue") {
      const entry = Entry.make({ change: m.change, head: m.head, reply: m.reply ?? null });

      return s._tag === "idle" ? next(s, [entry]) : [{ ...s, line: [...s.line, entry] }, []];
    }

    if (m._tag === "start_child_ok" || m._tag === "start_child_err") {
      if (s._tag !== "starting" || ("name" in m.cmd && m.cmd.name !== s.current.name)) {
        return [{ ...s, late: s.late + 1 }, []];
      }

      if (m._tag === "start_child_ok" && m.value._tag === "started") {
        return [
          Model.cases.landing.make({ attempt: s.attempt, late: s.late, line: s.line, current: s.current, since: m.at }),
          [],
        ];
      }

      return [
        Model.cases.stopped.make({
          attempt: s.attempt,
          late: s.late,
          line: [Entry.make(s.current), ...s.line],
          reason: Stop.cases.start_refused.make({
            change: s.current.change,
            name: s.current.name,
            refusal: m._tag === "start_child_err" ? ("reason" in m ? m.reason : m.error._tag) : m.value._tag,
          }),
        }),
        [],
      ];
    }

    if (Schema.is(Reply)(m)) {
      if (s._tag !== "landing" || m.ref !== String(s.attempt)) {
        return [{ ...s, late: s.late + 1 }, []];
      }

      const sent = forward(s.current, m);

      if (m._tag === "merged" && m.tree !== m.checked) {
        return [
          Model.cases.stopped.make({
            attempt: s.attempt,
            late: s.late,
            line: s.line,
            reason: Stop.cases.tree_drift.make({
              change: m.change,
              commit: m.commit,
              tree: m.tree,
              checked: m.checked,
            }),
          }),
          sent,
        ];
      }

      const [model, commands] = next(s, s.line);

      return [model, [...sent, ...commands]];
    }

    if (m._tag === "drop" && s._tag !== "idle") {
      if (s._tag === "landing" && s.current.change === m.change) {
        return [s, [Send.send({ to: s.current.name, m: Abandon.make({ ref: String(s.attempt) }) })]];
      }

      const sent = Arr.flatMap(
        Arr.filter(s.line, (entry) => entry.change === m.change),
        (entry: Entry) => forward(entry, Reply.cases.abandoned.make({ ref: "dropped", change: entry.change })),
      );

      return [{ ...s, line: Arr.filter(s.line, (entry) => entry.change !== m.change) }, sent];
    }

    return m._tag === "resume" && s._tag === "stopped" ? next(s, s.line) : [s, []];
  };

  const machine = Machine.make({
    model: Model,
    msg: Input,
    cmds: [StartChild.startChild, Send.send],
    init: (loaded) => [loaded ?? Model.cases.idle.make({ attempt: 0, late: 0 }), []],
    update: {
      enqueue: reduce,
      drop: reduce,
      resume: reduce,
      merged: reduce,
      red: reduce,
      conflict: reduce,
      moved: reduce,
      closed: reduce,
      unset: reduce,
      abandoned: reduce,
      behind: reduce,
      start_child_ok: reduce,
      start_child_err: reduce,
      send_ok: reduce,
      send_err: reduce,
    },
  });

  return Program.make({
    name: "pipeline/queue",
    // The program keeps the whole Msg, tea's answers included: the runner folds them, and the laws decode them.
    machine: { ...machine, msg: Whole },
    state: { v: 1, upgrades: [] },
    view: (s) => ({
      state: s._tag,
      current:
        s._tag === "starting" || s._tag === "landing"
          ? { change: s.current.change, head: s.current.head, name: s.current.name }
          : null,
      since: s._tag === "landing" ? s.since : null,
      line: s._tag === "idle" ? [] : Arr.map(s.line, ({ change, head }) => ({ change, head })),
      attempt: s.attempt,
      late: s.late,
      reason: s._tag === "stopped" ? s.reason : null,
      unset: unset ? "queue.checks" : null,
    }),
    refuse,
    inputs: {
      enqueue: "Add a change at its pinned head to the line",
      drop: "Abandon a waiting change or ask its merger to abandon it",
      resume: { description: "Continue landing after a stop", personOnly: true },
      merged: "Receive the current merger's reply: merged",
      red: "Receive the current merger's reply: checks red",
      conflict: "Receive the current merger's reply: a conflict",
      moved: "Receive the current merger's reply: the head moved",
      closed: "Receive the current merger's reply: the change closed",
      unset: "Receive the current merger's reply: no checks set",
      abandoned: "Receive the current merger's reply: abandoned",
      behind: "Receive the current merger's reply: still behind main",
    },
    outputs: {},
    writes: {},
    wake: () => null,
  });
};
