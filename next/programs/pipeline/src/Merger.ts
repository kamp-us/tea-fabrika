import type { Settled } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import { Ci, CodeHost, Program, type Refusal, Send, StartChild } from "@kampus/libfabrika";
import { Array as Arr, Match, Schema } from "effect";
import * as Change from "./Change.ts";
import { Abandon, Land, Reply } from "./Mail.ts";
import type { Values } from "./Settings.ts";

const Faults = ["unavailable", "rate_limited", "refused", "handler_failed", "bad_cmd"] as const;

const Attempt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const Inputs = {
  change: Schema.Struct({ attempt: Attempt, change: CodeHost.ChangeId }),
  update: Schema.Struct({ attempt: Attempt, change: CodeHost.ChangeId, head: CodeHost.Commit }),
  checks: Schema.Struct({ attempt: Attempt, head: CodeHost.Commit, start: Schema.Boolean }),
  merge: Schema.Struct({ attempt: Attempt, change: CodeHost.ChangeId, head: CodeHost.Commit }),
};

const change = Cmd.make("change", {
  input: Schema.toType(Inputs.change),
  ok: Schema.toType(CodeHost.Change),
  err: Faults,
});

const update = Cmd.make("update", {
  input: Schema.toType(Inputs.update),
  ok: Schema.toType(CodeHost.Updated),
  err: Faults,
});

const checks = Cmd.make("checks", { input: Schema.toType(Inputs.checks), ok: Schema.toType(Ci.Checks), err: Faults });

const merge = Cmd.make("merge", {
  input: Schema.toType(Inputs.merge),
  ok: Schema.toType(CodeHost.Merged),
  err: Faults,
});

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Step = Schema.TaggedUnion({
  asking: { tries: Count, at: Schema.Finite },
  waiting: {
    tries: Count,
    at: Schema.Finite,
    reason: Schema.Literals([...Faults, "ci_silent", "ci_lost", "no_answer", "pending"]),
  },
});

const First = Schema.TaggedStruct("asking", { tries: Schema.Literal(0), at: Schema.Null });

const Job = Schema.Struct({
  ref: Land.fields.ref,
  change: CodeHost.ChangeId,
  head: CodeHost.Commit,
  reply: Land.fields.reply,
});

const counts = { attempt: Count, late: Count };

const working = { ...counts, job: Job, step: Step };

const prepared = { ...working, kind: Change.Kind, checks: Schema.NonEmptyArray(Change.Check) };

const Previous = Schema.TaggedUnion({
  idle: counts,
  reading: { ...working, step: Schema.Union([Step, First]) },
  updating: prepared,
  checking: { ...prepared, head: CodeHost.Commit, tree: CodeHost.Tree, until: Schema.Finite },
  merging: { ...working, head: CodeHost.Commit, tree: CodeHost.Tree },
});

const Model = Schema.TaggedUnion({
  idle: counts,
  reading: { ...working, step: Schema.Union([Step, First]) },
  updating: { ...prepared, head: CodeHost.Commit, round: Count, checked: Schema.NullOr(CodeHost.Tree) },
  checking: { ...prepared, head: CodeHost.Commit, tree: CodeHost.Tree, until: Schema.Finite, round: Count },
  merging: { ...working, head: CodeHost.Commit, tree: CodeHost.Tree },
});

const rounds = {
  name: "rounds",
  from: 1,
  run: (raw: unknown) => {
    const s = Schema.decodeUnknownSync(Previous)(raw);

    return Previous.matchOrElse(
      s,
      {
        updating: (s) => ({ ...s, head: s.job.head, round: 0, checked: null }),
        checking: (s) => ({ ...s, round: 0 }),
      },
      (s) => s,
    );
  },
};

type Model = typeof Model.Type;

type Working = Exclude<Model, typeof Model.cases.idle.Type>;

const idle = Model.isAnyOf(["idle"]);

const reading = Model.isAnyOf(["reading"]);

const updating = Model.isAnyOf(["updating"]);

const checking = Model.isAnyOf(["checking"]);

const merging = Model.isAnyOf(["merging"]);

const rounded = Model.isAnyOf(["updating", "checking"]);

/** A step still asking: its answer is due. A first read's step is `asking` too. */
const askingStep = Match.type<Working["step"]>().pipe(
  Match.tag("asking", () => true),
  Match.orElse(() => false),
);

/** A step that waits only on checks still pending, so the next ask does not start them again. */
const pendingStep = Match.type<Working["step"]>().pipe(
  Match.tag("waiting", ({ reason }) => reason === "pending"),
  Match.orElse(() => false),
);

type Command = ReturnType<
  typeof change | typeof update | typeof checks | typeof merge | typeof Send.send | typeof StartChild.exit
>;

type Cell = readonly [Model, ReadonlyArray<Command>];

// The runner accepts settled letters itself; declaring them here also lets pure clients decode them.
const answers = <const N extends string, F extends Schema.Struct.Fields, O extends Schema.Top, const T extends string>(
  name: N,
  input: Schema.Struct<F>,
  ok: O,
  tags: ReadonlyArray<T>,
) => {
  const cmd = input.mapFields((fields) => ({ ...fields, type: Schema.Literal(name) }));

  return Schema.Union([
    Schema.Struct({ type: Schema.Literal(`${name}_ok`), cmd, value: ok, at: Schema.Finite }),
    Schema.Struct({
      type: Schema.Literal(`${name}_err`),
      cmd,
      error: Schema.Union(tags.map((tag) => Schema.TaggedStruct(tag, {}))),
      at: Schema.Finite,
    }),
  ]);
};

const Msg = Schema.Union([
  Land,
  Abandon,
  Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Finite }),
  answers(change.cmdType, Inputs.change, CodeHost.Change, Faults),
  answers(update.cmdType, Inputs.update, CodeHost.Updated, Faults),
  answers(checks.cmdType, Inputs.checks, Ci.Checks, Faults),
  answers(merge.cmdType, Inputs.merge, CodeHost.Merged, Faults),
  answers(Send.send.cmdType, Send.SendInput, Send.Queued, Send.send.errTags),
]);

const clamp = (at: number) => Math.min(at, 8.64e15);

const commandFor = (s: Working): string =>
  Match.valueTags(s, {
    reading: () => "change",
    updating: () => "update",
    checking: () => "checks",
    merging: () => "merge",
  });

const progress = (s: Working) => ({ attempt: s.attempt, late: s.late, job: s.job });

const identity = (s: Working) => ({ ref: s.job.ref, change: s.job.change });

const finish = (s: Working, reply: typeof Reply.Type): Cell => [
  Model.cases.idle.make({ attempt: s.attempt, late: s.late }),
  [Send.send({ to: s.job.reply, m: reply }), StartChild.exit({})],
];

export const merger = (settings: Values) => {
  const wait = settings.wait * 60_000;
  const poll = settings.poll * 1000;
  const backoff = settings.backoff * 1000;
  const asking = (at: number, tries = 0) => Step.cases.asking.make({ tries, at: clamp(at + wait) });

  const waiting = (s: Working, at: number, reason: (typeof Step.cases.waiting.Type)["reason"]): typeof Step.Type => {
    const tries = s.step.tries + 1;

    return Step.cases.waiting.make({ tries, reason, at: clamp(at + Math.min(poll * 2 ** (tries - 1), backoff)) });
  };

  const ask = (s: Working, at: number, tries: number, start: boolean): Cell => {
    const attempt = s.attempt + 1;
    const next = { ...s, attempt, step: asking(at, tries) };

    const cmd = Match.valueTags(s, {
      reading: (s): Command => change({ attempt, change: s.job.change }),
      updating: (s): Command => update({ attempt, change: s.job.change, head: s.head }),
      checking: (s): Command => checks({ attempt, head: s.head, start }),
      merging: (s): Command => merge({ attempt, change: s.job.change, head: s.head }),
    });

    return [next, [cmd]];
  };

  type Message =
    | typeof Msg.Type
    | Settled<typeof change | typeof update | typeof checks | typeof merge | typeof Send.send>;

  const reduce = (s: Model, m: Message): Cell => {
    if (m.type === "send_ok" || m.type === "send_err") {
      return [s, []];
    }

    if ("cmd" in m) {
      if (idle(s) || !askingStep(s.step) || m.cmd.type !== commandFor(s) || m.cmd.attempt !== s.attempt) {
        return [{ ...s, late: s.late + 1 }, []];
      }

      if ("error" in m) {
        const fault = Match.value(m.error).pipe(
          Match.tag("malformed_result", () => "bad_cmd" as const),
          Match.orElse(({ _tag }) => _tag),
        );

        return [{ ...s, step: waiting(s, m.at, fault) }, []];
      }
    }

    if (m.type === "land") {
      if (!idle(s)) {
        return [s, []];
      }

      const attempt = s.attempt + 1;

      return [
        Model.cases.reading.make({ late: s.late, job: Job.make(m), attempt, step: First.make({ tries: 0, at: null }) }),
        [change({ attempt, change: m.change })],
      ];
    }

    if (idle(s)) {
      return [s, []];
    }

    if (m.type === "timer") {
      if (s.step.at === null || m.at < s.step.at) {
        return [s, []];
      }

      return ask(s, m.at, s.step.tries + (askingStep(s.step) ? 1 : 0), !pendingStep(s.step));
    }

    if (m.type === "abandon") {
      return merging(s) || s.job.ref !== m.ref ? [s, []] : finish(s, Reply.cases.abandoned.make(identity(s)));
    }

    if (reading(s) && m.type === "change_ok") {
      const at = m.at;

      return CodeHost.Change.match(m.value, {
        missing: (): Cell => finish(s, Reply.cases.closed.make({ ...identity(s), state: "missing" })),
        found: (v): Cell => {
          if (v.state !== "open") {
            return finish(s, Reply.cases.closed.make({ ...identity(s), state: v.state }));
          }

          if (v.head !== s.job.head) {
            return finish(s, Reply.cases.moved.make({ ...identity(s), head: v.head }));
          }

          const kind = Change.kind(settings.kinds, v.paths);
          const wanted = Change.checksFor(settings.checks, kind);

          if (!Arr.isReadonlyArrayNonEmpty(wanted)) {
            return finish(s, Reply.cases.unset.make({ ...identity(s), kind }));
          }

          return ask(
            Model.cases.updating.make({
              ...progress(s),
              kind,
              checks: wanted,
              head: s.job.head,
              round: 0,
              checked: null,
              step: asking(at),
            }),
            at,
            0,
            false,
          );
        },
      });
    }

    if (updating(s) && m.type === "update_ok") {
      const at = m.at;

      // The pinned head now holds main: check it, one round more when this update moved it.
      const check = (
        v: { readonly head: typeof CodeHost.Commit.Type; readonly tree: typeof CodeHost.Tree.Type },
        moved: boolean,
      ): Cell =>
        ask(
          Model.cases.checking.make({
            ...progress(s),
            kind: s.kind,
            checks: s.checks,
            head: v.head,
            tree: v.tree,
            round: s.round + (moved ? 1 : 0),
            until: clamp(at + wait),
            step: asking(at),
          }),
          at,
          0,
          moved,
        );

      return CodeHost.Updated.match(m.value, {
        current: (v): Cell =>
          s.checked === null
            ? check(v, false)
            : ask(
                Model.cases.merging.make({ ...progress(s), head: s.head, tree: s.checked, step: asking(at) }),
                at,
                0,
                false,
              ),
        updated: (v): Cell =>
          s.round === settings.rounds
            ? finish(s, Reply.cases.behind.make({ ...identity(s), head: v.head, main: v.main, rounds: s.round }))
            : check(v, true),
        conflict: (v): Cell => finish(s, Reply.cases.conflict.make({ ...identity(s), main: v.main, paths: v.paths })),
        moved: (v): Cell => finish(s, Reply.cases.moved.make({ ...identity(s), head: v.head })),
        closed: (v): Cell => finish(s, Reply.cases.closed.make({ ...identity(s), state: v.state })),
      });
    }

    if (checking(s) && m.type === "checks_ok") {
      const at = m.at;

      const late = (reason: "ci_lost" | "ci_silent"): Cell => [
        { ...s, until: clamp(at + wait), step: waiting(s, at, reason) },
        [],
      ];

      return Change.Verdict.match(Change.verdict(s.checks, m.value), {
        red: (verdict): Cell => finish(s, Reply.cases.red.make({ ...identity(s), head: s.head, runs: verdict.runs })),
        green: (): Cell =>
          ask(
            Model.cases.updating.make({
              ...progress(s),
              kind: s.kind,
              checks: s.checks,
              head: s.head,
              round: s.round,
              checked: s.tree,
              step: asking(at),
            }),
            at,
            0,
            false,
          ),
        lost: (): Cell => late("ci_lost"),
        pending: (): Cell =>
          at >= s.until
            ? late("ci_silent")
            : [
                {
                  ...s,
                  step: Step.cases.waiting.make({ tries: s.step.tries, at: clamp(at + poll), reason: "pending" }),
                },
                [],
              ],
      });
    }

    if (merging(s) && m.type === "merge_ok") {
      return CodeHost.Merged.match(m.value, {
        merged: (v): Cell =>
          finish(
            s,
            Reply.cases.merged.make({ ...identity(s), head: s.head, commit: v.commit, tree: v.tree, checked: s.tree }),
          ),
        moved: (v): Cell => finish(s, Reply.cases.moved.make({ ...identity(s), head: v.head })),
        conflict: (v): Cell => finish(s, Reply.cases.conflict.make({ ...identity(s), main: v.main, paths: v.paths })),
        closed: (v): Cell => finish(s, Reply.cases.closed.make({ ...identity(s), state: v.state })),
      });
    }

    return [s, []];
  };

  const machine = Machine.make({
    model: Model,
    msg: Msg,
    cmds: [change, update, checks, merge, Send.send, StartChild.exit],
    init: (loaded) => [loaded ?? Model.cases.idle.make({ attempt: 0, late: 0 }), []],
    update: {
      land: reduce,
      abandon: reduce,
      timer: reduce,
      change_ok: reduce,
      change_err: reduce,
      update_ok: reduce,
      update_err: reduce,
      checks_ok: reduce,
      checks_err: reduce,
      merge_ok: reduce,
      merge_err: reduce,
      send_ok: reduce,
      send_err: reduce,
      exit_ok: (s) => [s, []],
      exit_err: (s) => [s, []],
    },
  });

  return Program.make({
    name: "pipeline/merger",
    machine,
    state: { v: 2, upgrades: [rounds] },
    view: (s) => ({
      state: s._tag,
      ref: idle(s) ? null : s.job.ref,
      change: idle(s) ? null : s.job.change,
      head: Model.matchOrElse(s, { idle: () => null, reading: (s) => s.job.head }, (s) => s.head),
      round: rounded(s) ? s.round : null,
      attempt: s.attempt,
      tries: idle(s) ? null : s.step.tries,
      late: s.late,
    }),
    refuse: (s, m): Refusal | null => {
      if (m.type === "land") {
        return idle(s) ? null : { reason: "busy" };
      }

      if (m.type !== "abandon") {
        return null;
      }

      return Model.matchOrElse(
        s,
        { idle: (): Refusal => ({ reason: "idle" }), merging: (): Refusal => ({ reason: "merging" }) },
        (s): Refusal | null => (m.ref !== s.job.ref ? { reason: "other_job" } : null),
      );
    },
    inputs: { land: "Land this change at its pinned head", abandon: "Abandon this job before merging" },
    outputs: {},
    writes: {},
    wake: (s) => (idle(s) ? null : s.step.at),
  });
};
