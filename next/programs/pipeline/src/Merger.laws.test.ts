import { applyCell } from "@demlik/tea";
import { arbGuidedSequence, foldEvents, stubCtxThrowingProxy } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { Checks, Status } from "@kampus/libfabrika/ci/Ci";
import * as CiTest from "@kampus/libfabrika/ci/CiTest";
import { Change, Commit, Merged, Tree, Updated } from "@kampus/libfabrika/codehost/CodeHost";
import { Queued } from "@kampus/libfabrika/runtime/Send";
import { Saved } from "@kampus/libfabrika/runtime/State";
import { Arbitrary, ConfigProvider, Effect, Match, Schema } from "effect";
import * as fc from "fast-check";
import * as ChangeKind from "./Change.ts";
import * as Mail from "./Mail.ts";
import { merger } from "./Merger.ts";
import * as Settings from "./Settings.ts";

type Program = ReturnType<typeof merger>;

type Model = Program["machine"]["model"]["Type"];

type Msg = Program["msg"]["Type"];

type Command = ReturnType<Program["machine"]["init"]>[1][number];

const ctx = stubCtxThrowingProxy<never>();

// The merger's Model and Step unions are not exported, so these laws match them with Effect's Match
// (0567, form 2). Each state matcher answers its case or null, so a null check narrows as before.
const working = Match.type<Model>().pipe(
  Match.tag("idle", () => null),
  Match.orElse((s) => s),
);

type Working = NonNullable<ReturnType<typeof working>>;

const idle = (s: Model) => working(s) === null;

const reading = Match.type<Model>().pipe(
  Match.tag("reading", (s) => s),
  Match.orElse(() => null),
);

const updating = Match.type<Model>().pipe(
  Match.tag("updating", (s) => s),
  Match.orElse(() => null),
);

const checking = Match.type<Model>().pipe(
  Match.tag("checking", (s) => s),
  Match.orElse(() => null),
);

/** Whether a working state's step is asking, rather than waiting to ask again. */
const asking = (s: Working) => Match.valueTags(s.step, { asking: () => true, waiting: () => false });

/** A waiting step's reason, or false while it asks. */
const waitReason = (s: Working) =>
  Match.valueTags(s.step, { asking: (): string | false => false, waiting: (step) => step.reason });

const LAST = 8.64e15;

const clamp = (time: number) => Math.min(time, LAST);

const faults = ["unavailable", "rate_limited", "refused", "handler_failed", "bad_cmd"] as const;

const positive = fc.oneof(
  { weight: 8, arbitrary: fc.integer({ min: 1, max: 6 }) },
  { weight: 2, arbitrary: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }) },
);

const world = fc.record({
  complete: fc.boolean(),
  at: fc.integer({ min: 0, max: LAST }),
  ending: fc.constantFrom("merged", "checks", "merge"),
  size: fc.constantFrom(40, 64),
  ref: CiTest.word,
  name: CiTest.word,
  source: CiTest.word,
  wait: positive,
  poll: positive,
  backoff: positive,
  rounds: positive,
  empty: fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()),
  paths: fc.option(
    fc.array(fc.constantFrom("rows/x.json", "docs/a.md", "src/a.ts", ".dot", "docs/a b.md", "docs/[x].md"), {
      maxLength: 6,
    }),
    { nil: null },
  ),
});

type World = typeof world extends fc.Arbitrary<infer A> ? A : never;

const settingsFor = (w: World) =>
  Effect.runSync(
    Settings.all.parse(
      ConfigProvider.fromUnknown(
        {
          queue: {
            kinds: { rows: ["rows/**"], docs: ["docs/**"] },
            checks: Object.fromEntries(
              ["rows", "docs", "code"].map((kind, i) => [kind, w.empty[i] ? [] : [{ name: w.name, source: w.source }]]),
            ),
          },
          merger: { wait: w.wait, poll: w.poll, backoff: w.backoff, rounds: w.rounds },
        },
        { preserveEmptyStrings: true },
      ),
    ),
  );

const id = (w: World, char: string) => Schema.decodeSync(Commit)(char.repeat(w.size));

const tree = (w: World, char: string) => Schema.decodeSync(Tree)(char.repeat(w.size));

const land = (w: World) => Mail.Land.make({ type: "land", ref: w.ref, change: 1, head: id(w, "a"), reply: "queue" });

const equal = (a: unknown, b: unknown) => expect(a).toEqual(b);

const runAt = (w: World, choice: number) => ({
  name: w.name,
  source: w.source,
  id: "run",
  startedAt: null,
  completedAt: null,
  url: null,
  status:
    choice % 9 < 2
      ? choice % 2 === 0
        ? Status.cases.queued.make({})
        : Status.cases.running.make({})
      : Status.cases.done.make({
          conclusion: ["success", "failure", "timed_out", "skipped", "neutral", "cancelled", "startup_failure"][
            choice % 7
          ]! as (typeof Status.cases.done.Type)["conclusion"],
        }),
});

const valueFor = (w: World, cmd: Command, pick: number): unknown => {
  if (cmd.type === "change") {
    if (pick % 8 === 0) {
      return Change.cases.missing.make({ change: cmd.change });
    }

    return Change.cases.found.make({
      change: cmd.change,
      head: pick % 7 === 0 ? id(w, "b") : id(w, "a"),
      state: pick % 6 < 3 ? "open" : (["draft", "closed", "merged"] as const)[pick % 3]!,
      paths: w.paths,
    });
  }

  if (cmd.type === "update") {
    if (pick % 7 === 0) {
      return Updated.cases.moved.make({ head: id(w, "c") });
    }

    if (pick % 7 === 1) {
      return Updated.cases.conflict.make({ main: id(w, "d"), paths: pick % 2 === 0 ? [] : ["src/a.ts"] });
    }

    if (pick % 7 === 2) {
      return Updated.cases.closed.make({ state: (["draft", "closed", "merged"] as const)[pick % 3]! });
    }

    return pick % 2 === 0
      ? Updated.cases.current.make({ head: cmd.head, tree: tree(w, "e"), main: id(w, "d") })
      : Updated.cases.updated.make({ head: id(w, "b"), tree: tree(w, "e"), main: id(w, "d") });
  }

  if (cmd.type === "checks") {
    return Schema.decodeSync(Checks)(pick % 11 === 0 ? [] : [runAt(w, pick)]);
  }

  if (cmd.type === "merge") {
    if (pick % 7 === 0) {
      return Merged.cases.moved.make({ head: id(w, "c") });
    }

    if (pick % 7 === 1) {
      return Merged.cases.conflict.make({ main: id(w, "d"), paths: pick % 2 === 0 ? [] : ["src/a.ts"] });
    }

    if (pick % 7 === 2) {
      return Merged.cases.closed.make({ state: pick % 2 === 0 ? "closed" : "draft" });
    }

    return Merged.cases.merged.make({ commit: id(w, "f"), tree: tree(w, pick % 2 === 0 ? "e" : "9") });
  }

  return Queued.make({ id: "queued" });
};

const answer = (p: Program, w: World, cmd: Command, drawn: number, at: number): Msg => {
  const pick = w.complete
    ? cmd.type === "change"
      ? 2
      : cmd.type === "update"
        ? 4
        : cmd.type === "checks" && w.ending !== "checks"
          ? 7
          : cmd.type === "merge" && w.ending === "merged"
            ? 3
            : drawn
    : drawn;

  return Schema.decodeSync(p.msg)(
    cmd.type !== "send" && pick % 5 === 0
      ? {
          type: `${cmd.type}_err`,
          cmd,
          error: Schema.TaggedStruct(faults[Math.floor(pick / 5) % faults.length]!, {}).make({}),
          reason: faults[Math.floor(pick / 5) % faults.length],
          at,
        }
      : cmd.type === "send" && pick % 2 === 0
        ? { type: "send_err", cmd, error: Schema.TaggedStruct("forbidden", {}).make({}), reason: "forbidden", at }
        : { type: `${cmd.type}_ok`, cmd, value: valueFor(w, cmd, pick), at },
  );
};

// tea draws answers only to Cmds that were emitted. The second fold moves each clock forward and
// chooses due/stale timers from the actual state, so shrinking keeps a legal walk.
const guided = (p: Program, w: World) => {
  const draw = fc.record({ pick: fc.nat(), at: fc.integer({ min: 0, max: LAST }) });

  const cell = {
    draw,
    make: (cmd: Command, cell: { pick: number; at: number }) => answer(p, w, cmd, cell.pick, cell.at),
  };

  const cells = { change: cell, update: cell, checks: cell, merge: cell, send: cell };

  return arbGuidedSequence(
    p.machine,
    ctx,
    {
      outside: {
        land: fc.constant(land(w)),
        timer: fc.record({ type: fc.constant("timer" as const), at: fc.integer({ min: 0, max: LAST }) }),
        ...(w.complete ? {} : { abandon: fc.constant(Mail.Abandon.make({ type: "abandon", ref: w.ref })) }),
      },
      answers: cells,
    },
    { maxLength: 120, size: "max" },
  ).chain((raw) =>
    fc.array(draw, { minLength: 12, maxLength: 80, size: "max" }).map((tail) => {
      let model = p.machine.init(null, ctx)[0];
      const out: Array<Command> = [];
      let clock = 0;
      let started = false;
      const msgs: Array<Msg> = [];

      for (const event of raw) {
        let msg: Msg = Schema.decodeSync(p.msg)(event);

        if (event.type === "timer") {
          const due = p.wake(model);

          const at =
            due === null
              ? clamp(clock + (event.at % 10_000))
              : event.at % 3 === 0
                ? Math.max(clock, due - 1)
                : Math.max(clock, due);

          msg = Schema.decodeSync(p.msg)({ type: "timer", at });
          clock = at;
        } else if ("cmd" in event && event.cmd.type !== "send") {
          const command = out.find((c) => c.type === event.cmd.type && "attempt" in c && c.attempt === model.attempt);

          const busy = working(model);

          if (command === undefined || busy === null || !asking(busy)) {
            continue;
          }

          const due = checking(model);
          clock = clamp(Math.max(clock, event.at % 7 === 0 && due !== null ? due.until : clock + (event.at % 10_000)));
          msg = Schema.decodeSync(p.msg)({ ...event, cmd: command, at: clock });
        } else if ("cmd" in event && event.cmd.type === "send") {
          clock = Math.max(clock, event.at);
          msg = Schema.decodeSync(p.msg)({ ...event, at: clock });
        } else if (event.type === "land" || event.type === "abandon") {
          if (p.refuse(model, event) !== null) {
            continue;
          }

          if (event.type === "land" && started) {
            break;
          }

          if (event.type === "land") {
            started = true;
          }
        }

        msgs.push(msg);
        const [next, commands] = applyCell<Model, Msg, Command>(p.machine, model, msg);
        model = next;
        out.push(...commands);
      }

      // Continue from the state the fold reached. Tea's blind picks can leave an old request
      // unanswered after a retry; this tail answers only the current attempt and fires saved waits.
      for (const cell of tail) {
        let msg: Msg;
        const busy = working(model);

        if (busy === null) {
          if (started) {
            break;
          }

          msg = land(w);
          started = true;
        } else if (!asking(busy) || (busy.step.at !== null && cell.pick % 7 === 0)) {
          clock = Math.max(clock, busy.step.at!);
          msg = Schema.decodeSync(p.msg)({ type: "timer", at: clock });
        } else {
          const cmd = out.findLast((c) => service(c) && "attempt" in c && c.attempt === model.attempt);

          if (cmd === undefined) {
            break;
          }

          const due = checking(model);
          clock = clamp(Math.max(clock, due !== null && cell.at % 3 === 0 ? due.until : clock + (cell.at % 10_000)));
          msg = answer(p, w, cmd, cell.pick, clock);
        }

        msgs.push(msg);
        const [next, commands] = applyCell<Model, Msg, Command>(p.machine, model, msg);
        model = next;
        out.push(...commands);
      }

      return msgs;
    }),
  );
};

const service = (cmd: Command) => cmd.type !== "send" && cmd.type !== "exit";

const stateCmd = Match.type<Model>().pipe(
  Match.tag("reading", () => "change"),
  Match.tag("updating", () => "update"),
  Match.tag("checking", () => "checks"),
  Match.orElse(() => "merge"),
);

// Each invariant reads a complete tea fold. A cut-off job is checked for its prefix, never for a
// reply it has not sent yet.
const inspect = (p: Program, w: World, msgs: ReadonlyArray<Msg>, law: string) => {
  expect.hasAssertions();
  const folded = foldEvents(p.machine, ctx, null, msgs);
  expect(folded.initCmds).toEqual([]);
  expect(p.wake(folded.states[0]!)).toBeNull();
  let reached = false;
  let replies = 0;
  let checkedHead: string | null = null;
  let checkedTree: string | null = null;
  let green = false;
  let lastLook: string | null = null;
  let asks = 0;

  for (const { prev, msg, next, cmds } of folded.steps) {
    const sent = cmds.filter((c) => c.type === "send");
    const asked = cmds.filter(service);
    const was = working(prev);
    const now = working(next);

    if (law === "L9") {
      const own = Mail.Abandon.make({ type: "abandon", ref: was === null ? w.ref : was.job.ref });
      expect(p.refuse(prev, own)?.reason ?? null).toBe(
        Match.value(prev).pipe(
          Match.tag("idle", () => "idle"),
          Match.tag("merging", () => "merging"),
          Match.orElse(() => null),
        ),
      );
    }

    if (was === null && msg.type === "land") {
      replies = 0;
      checkedHead = null;
      checkedTree = null;
      green = false;
      lastLook = null;
    }

    const looking = updating(prev);

    if (
      msg.type === "update_ok" &&
      looking !== null &&
      asking(looking) &&
      msg.cmd.attempt === looking.attempt &&
      Updated.isAnyOf(["current", "updated"])(msg.value)
    ) {
      lastLook =
        Updated.isAnyOf(["current"])(msg.value) && green && checkedHead === msg.value.head ? msg.value.head : null;

      if (Updated.isAnyOf(["updated"])(msg.value)) {
        green = false;
      }

      checkedHead = msg.value.head;
      checkedTree = msg.value.tree;
    }

    const judging = checking(prev);

    if (msg.type === "checks_ok" && judging !== null && asking(judging) && msg.cmd.attempt === judging.attempt) {
      green = ChangeKind.Verdict.isAnyOf(["green"])(ChangeKind.verdict(judging.checks, msg.value));
    }

    if (law === "L1") {
      for (const cmd of cmds) {
        if (cmd.type === "merge") {
          reached = true;
          expect(green).toBe(true);
          expect(cmd.head).toBe(checkedHead);
          expect(lastLook).toBe(cmd.head);
        }
      }
    }

    if (law === "L16") {
      reached ||= sent.length > 0;

      if (sent.length > 0) {
        expect(cmds.map((c) => c.type)).toEqual(["send", "exit"]);

        for (const cmd of sent) {
          if (cmd.type === "send") {
            expect(Schema.is(Mail.Reply)(cmd.m)).toBe(true);
            expect(cmd.m).toMatchObject({ type: "reply" });
          }
        }
      } else {
        expect(cmds.filter((c) => c.type === "exit")).toEqual([]);
      }
    }

    if (law === "L10") {
      for (const cmd of sent) {
        if (cmd.type === "send" && Schema.is(Mail.Reply)(cmd.m) && Mail.Reply.isAnyOf(["merged"])(cmd.m)) {
          reached = true;
          expect(cmd.m.checked).toBe(checkedTree);
        }
      }
    }

    if (law === "L2") {
      if (sent.length > 0) {
        reached = true;
      }

      replies += sent.length;
      expect(replies).toBeLessThanOrEqual(1);

      if (was !== null && now === null) {
        expect(replies).toBe(1);
        expect(sent[0]?.type === "send" && sent[0].m).toMatchObject({ ref: was.job.ref, change: was.job.change });
      } else if (now !== null) {
        expect(replies).toBe(0);
      }

      if ("value" in msg) {
        if (msg.type === "change_ok") {
          const value = msg.value;

          if (Change.isAnyOf(["missing"])(value)) {
            expect(next._tag).toBe("idle");
            expect(sent).toHaveLength(1);
            expect(sent[0]?.type === "send" && sent[0].m).toMatchObject({ _tag: "closed", state: "missing" });
          } else if (Change.isAnyOf(["found"])(value) && value.state !== "open") {
            expect(next._tag).toBe("idle");
            expect(sent).toHaveLength(1);
            expect(sent[0]?.type === "send" && sent[0].m).toMatchObject({ _tag: "closed", state: value.state });
          }
        }

        if (msg.type === "update_ok" || msg.type === "merge_ok") {
          // The answer is CodeHost's Updated or Merged: Match reads the cases the two share.
          const ended = Match.value(msg.value).pipe(
            Match.tag("conflict", (value) => ({ _tag: "conflict", main: value.main, paths: value.paths })),
            Match.tag("closed", (value) => ({ _tag: "closed", state: value.state })),
            Match.orElse(() => null),
          );

          if (ended !== null) {
            expect(next._tag).toBe("idle");
            expect(sent).toHaveLength(1);
            expect(sent[0]?.type === "send" && sent[0].m).toMatchObject(ended);
          }
        }
      }

      if (msg.type === "send_err" || msg.type === "send_ok") {
        equal(next, prev);
        expect(cmds).toEqual([]);
      }
    }

    if (law === "L4") {
      if (now !== null && !asking(now)) {
        reached = true;
      }

      expect(p.wake(next)).toBe(now === null ? null : now.step.at);

      if (msg.type === "timer" && (was === null || was.step.at === null || msg.at < was.step.at)) {
        equal(next, prev);
        expect(cmds).toEqual([]);
      }
    }

    if (
      law === "L8" &&
      "value" in msg &&
      (msg.type === "change_ok" || msg.type === "update_ok" || msg.type === "merge_ok")
    ) {
      // The answer is CodeHost's Change, Updated or Merged: Match reads `moved` across all three.
      const moved = Match.value(msg.value).pipe(
        Match.tag("moved", (value) => value.head),
        Match.tag("found", (value) =>
          msg.type === "change_ok" && value.state === "open" && was !== null && value.head !== was.job.head
            ? value.head
            : null,
        ),
        Match.orElse(() => null),
      );

      if (moved !== null) {
        expect(next._tag).toBe("idle");
        expect(sent).toHaveLength(1);
        expect(sent[0]?.type === "send" && sent[0].m).toMatchObject({ _tag: "moved", head: moved });
        reached = true;
        expect(asked).toEqual([]);
      }
    }

    const abandonable = Match.value(prev).pipe(
      Match.tag("idle", "merging", () => null),
      Match.orElse((s) => s),
    );

    if (law === "L9" && msg.type === "abandon" && abandonable !== null) {
      reached = true;
      expect(next._tag).toBe("idle");
      expect(p.wake(next)).toBeNull();
      expect(sent[0]?.type === "send" && sent[0].m).toMatchObject({ _tag: "abandoned", ref: abandonable.job.ref });
    }

    const read = reading(prev);

    if (
      law === "L13" &&
      msg.type === "change_ok" &&
      read !== null &&
      Change.isAnyOf(["found"])(msg.value) &&
      msg.value.state === "open" &&
      msg.value.head === read.job.head
    ) {
      const kind = ChangeKind.kind(settingsFor(w).kinds, msg.value.paths);

      if (settingsFor(w).checks[kind].length === 0) {
        reached = true;
        expect(asked).toEqual([]);
        expect(next._tag).toBe("idle");
        expect(sent[0]?.type === "send" && sent[0].m).toMatchObject({ _tag: "unset", kind });
      }
    }

    if (law === "L3" && was !== null) {
      const at = "at" in msg ? msg.at : null;

      const taken =
        "cmd" in msg &&
        msg.cmd.type === stateCmd(was) &&
        "attempt" in msg.cmd &&
        msg.cmd.attempt === was.attempt &&
        asking(was);

      const verdict =
        taken && msg.type === "checks_ok" && judging !== null
          ? ChangeKind.verdict(judging.checks, msg.value)._tag
          : null;

      const fault =
        (taken && msg.type.endsWith("_err")) ||
        verdict === "lost" ||
        (verdict === "pending" && judging !== null && at !== null && at >= judging.until);

      if (fault && at !== null) {
        reached = true;
        expect(sent).toEqual([]);
        expect(asked).toEqual([]);
        expect(next._tag).toBe(prev._tag);

        if (now !== null) {
          expect(now.step._tag).toBe("waiting");
          expect(now.step.tries).toBe(was.step.tries + 1);
          expect(now.step.at).toBe(clamp(at + Math.min(w.poll * 1000 * 2 ** was.step.tries, w.backoff * 1000)));

          if (taken && "error" in msg) {
            expect(waitReason(now)).toBe(msg.error._tag);
          }

          if (verdict === "lost") {
            expect(waitReason(now)).toBe("ci_lost");
          }

          if (verdict === "pending") {
            expect(waitReason(now)).toBe("ci_silent");
          }
        }
      }

      const polled = checking(next);

      if (verdict === "pending" && !fault && at !== null && polled !== null) {
        expect(polled.step.at).toBe(clamp(at + w.poll * 1000));
        expect(polled.step.tries).toBe(was.step.tries);
      }

      if (judging !== null && polled !== null) {
        expect(polled.until).toBe(
          (verdict === "lost" || (verdict === "pending" && fault)) && at !== null
            ? clamp(at + w.wait * 60_000)
            : judging.until,
        );
      }

      if (msg.type === "timer" && was.step.at !== null && msg.at >= was.step.at) {
        reached = true;
        expect(asked).toHaveLength(1);
        expect(asked[0]?.type).toBe(stateCmd(was));

        if (now !== null) {
          expect(now.step.tries).toBe(was.step.tries + (asking(was) ? 1 : 0));
        }

        if (asked[0]?.type === "checks") {
          expect(asked[0].start).toBe(!(waitReason(was) === "pending"));
        }
      }

      for (const cmd of asked) {
        if (at !== null && now !== null) {
          expect(now.step._tag).toBe("asking");
          expect(now.step.at).toBe(clamp(at + w.wait * 60_000));
        }

        expect(cmd.type).toBe(now === null ? "none" : stateCmd(now));
      }

      if (next._tag !== prev._tag && now !== null) {
        expect(now.step.tries).toBe(0);
      }
    }

    for (const cmd of asked) {
      asks++;

      if ("attempt" in cmd) {
        expect(cmd.attempt).toBe(asks);
      }
    }
  }

  return reached;
};

describe("the merger, next/", () => {
  for (const law of ["L1", "L2", "L3", "L4", "L8", "L9", "L10", "L13", "L16"]) {
    it(`${law}: generated worlds obey the merger's contract at every prefix`, () => {
      const walks = world.chain((w) => {
        const p = merger(settingsFor(w));

        return guided(p, w).map((msgs) => ({ w, p, msgs }));
      });

      let reached = 0;
      fc.assert(
        fc.property(walks, ({ w, p, msgs }) => {
          if (inspect(p, w, msgs, law)) {
            reached++;
          }
        }),
        { seed: 119120, numRuns: 200 },
      );
      expect(reached, `${law} reached its deciding event`).toBeGreaterThan(0);
    });
  }

  it("L14: refusal, old answers and send receipts preserve the job and its alarm", () => {
    fc.assert(
      fc.property(
        world,
        fc.commands(
          [
            fc.record({ pick: fc.nat(), move: fc.nat() }).map(
              (
                cell,
              ): fc.Command<
                {
                  model: Model;
                  history: Array<Command>;
                  current: ReadonlyArray<Command>;
                  clock: number;
                  asks: number;
                  replies: number;
                },
                { p: Program; w: World }
              > => ({
                check: () => true,
                run: (m, { p, w }) => {
                  const prev = m.model;
                  const was = working(prev);
                  const active = m.current.find((c) => service(c) && "attempt" in c && c.attempt === prev.attempt);

                  const late = m.history.filter(
                    (c) =>
                      service(c) &&
                      (was === null ||
                        !asking(was) ||
                        !("attempt" in c) ||
                        c.attempt !== prev.attempt ||
                        c.type !== stateCmd(prev)),
                  );

                  const moves: Array<() => Msg> = [
                    () => land(w),
                    () =>
                      Schema.decodeSync(p.msg)({
                        type: "abandon",
                        ref: cell.pick % 2 === 0 && was !== null ? was.job.ref : `${w.ref}other`,
                      }),
                  ];

                  if (active !== undefined && was !== null && asking(was)) {
                    moves.push(() => answer(p, w, active, cell.pick, m.clock));
                  }

                  if (was !== null && was.step.at !== null) {
                    moves.push(() => Schema.decodeSync(p.msg)({ type: "timer", at: Math.max(m.clock, was.step.at!) }));
                  }

                  if (late.length > 0) {
                    moves.push(() => answer(p, w, late[cell.pick % late.length]!, cell.pick, m.clock));
                  }

                  const send = m.history.find((c) => c.type === "send");

                  if (send !== undefined) {
                    moves.push(() => answer(p, w, send, cell.pick, m.clock));
                  }

                  const msg = moves[cell.move % moves.length]!();

                  const refused =
                    msg.type === "land"
                      ? was !== null
                        ? "busy"
                        : null
                      : msg.type === "abandon"
                        ? Match.value(prev).pipe(
                            Match.tag("idle", () => "idle"),
                            Match.tag("merging", () => "merging"),
                            Match.orElse((s) => (msg.ref !== s.job.ref ? "other_job" : null)),
                          )
                        : null;

                  if (msg.type === "land" || msg.type === "abandon") {
                    expect(p.refuse(prev, msg)?.reason ?? null).toBe(refused);

                    if (refused !== null) {
                      equal(m.model, prev);

                      return;
                    }
                  }

                  const [next, cmds] = applyCell<Model, Msg, Command>(p.machine, prev, msg);

                  if (msg.type === "land" && was === null) {
                    m.replies = 0;
                  }

                  m.replies += cmds.filter((c) => c.type === "send").length;
                  expect(m.replies).toBeLessThanOrEqual(1);

                  if (was !== null && idle(next)) {
                    expect(m.replies).toBe(1);
                  }

                  if (msg.type === "send_ok" || msg.type === "send_err") {
                    equal(next, prev);
                    expect(cmds).toEqual([]);
                  } else if (
                    "cmd" in msg &&
                    (was === null ||
                      !asking(was) ||
                      msg.cmd.type !== stateCmd(prev) ||
                      !("attempt" in msg.cmd) ||
                      msg.cmd.attempt !== prev.attempt)
                  ) {
                    equal(next, { ...prev, late: prev.late + 1 });
                    expect(cmds).toEqual([]);
                    expect(p.wake(next)).toBe(p.wake(prev));
                  }

                  for (const cmd of cmds.filter(service)) {
                    expect("attempt" in cmd && cmd.attempt).toBe(++m.asks);
                  }

                  expect(next.attempt).toBe(m.asks);
                  m.model = next;
                  m.history.push(...cmds);
                  m.current = cmds.length > 0 ? cmds : m.current;

                  if ("at" in msg) {
                    m.clock = msg.at;
                  }
                },
                toString: () => JSON.stringify(cell),
              }),
            ),
          ],
          { maxCommands: 100 },
        ),
        (w, commands) => {
          const p = merger(settingsFor(w));
          const [model, initial] = p.machine.init(null, ctx);
          expect(model).toMatchObject({ _tag: "idle", attempt: 0, late: 0 });
          fc.modelRun(
            () => ({
              model: { model, history: [...initial], current: initial, clock: 0, asks: 0, replies: 0 },
              real: { p, w },
            }),
            commands,
          );
        },
      ),
      { seed: 119120, numRuns: 200 },
    );
  });
});

// This walk answers only the current request. Every update may discover another main.
const roundWalk = (p: Program, w: World) => {
  const ok = (cmd: Command, value: unknown): Msg =>
    Schema.decodeSync(p.msg)({ type: `${cmd.type}_ok`, cmd, value, at: w.at });

  return arbGuidedSequence(
    p.machine,
    ctx,
    {
      outside: { land: fc.constant(land(w)) },
      answers: {
        change: {
          draw: fc.constant(null),
          make: (cmd: Extract<Command, { type: "change" }>) =>
            ok(
              cmd,
              Change.cases.found.make({
                change: cmd.change,
                head: cmd.type === "change" ? land(w).head : id(w, "a"),
                state: "open",
                paths: ["src/a.ts"],
              }),
            ),
        },
        update: {
          draw: fc.boolean(),
          make: (cmd: Extract<Command, { type: "update" }>, moved: boolean) =>
            ok(
              cmd,
              moved
                ? Updated.cases.updated.make({
                    head: Schema.decodeSync(Commit)((cmd.attempt + 16).toString(16).padStart(w.size, "0")),
                    tree: tree(w, "e"),
                    main: id(w, "d"),
                  })
                : Updated.cases.current.make({ head: cmd.head, tree: tree(w, "e"), main: id(w, "d") }),
            ),
        },
        checks: {
          draw: fc.constant(null),
          make: (cmd: Extract<Command, { type: "checks" }>) => ok(cmd, [runAt(w, 7)]),
        },
        merge: {
          draw: fc.constant(null),
          make: (cmd: Extract<Command, { type: "merge" }>) =>
            ok(cmd, Merged.cases.merged.make({ commit: id(w, "f"), tree: tree(w, "e") })),
        },
      },
    },
    { maxLength: 180, size: "max" },
  );
};

it("L15: updated heads spend the round budget; behind names the newest head and main", () => {
  let bounded = 0;
  fc.assert(
    fc.property(
      world.chain((drawn) => {
        const w = { ...drawn, empty: [false, false, false] as [boolean, boolean, boolean] };
        const p = merger(settingsFor(w));

        return roundWalk(p, w).map((msgs) => ({ p, w, msgs }));
      }),
      ({ p, w, msgs }) => {
        expect.hasAssertions();
        let rounds = 0;

        for (const { prev, msg, next, cmds } of foldEvents(p.machine, ctx, null, msgs).steps) {
          if (idle(prev) && msg.type === "land") {
            rounds = 0;
          }

          const looking = updating(prev);

          const updated =
            looking !== null &&
            msg.type === "update_ok" &&
            asking(looking) &&
            msg.cmd.attempt === looking.attempt &&
            Updated.isAnyOf(["updated"])(msg.value);

          if (updated && msg.type === "update_ok" && Updated.isAnyOf(["updated"])(msg.value)) {
            if (rounds === w.rounds) {
              bounded++;
              expect(next._tag).toBe("idle");
              expect(cmds.filter(service)).toEqual([]);
              expect(cmds.find((c) => c.type === "send")).toMatchObject({
                m: {
                  type: "reply",
                  _tag: "behind",
                  head: msg.value.head,
                  main: msg.value.main,
                  rounds: w.rounds,
                },
              });
            } else {
              rounds++;
              expect(next).toMatchObject({ _tag: "checking", round: rounds, head: msg.value.head });
              expect(cmds).toContainEqual(
                expect.objectContaining({ type: "checks", head: msg.value.head, start: true }),
              );
            }
          }

          Match.value(next).pipe(
            Match.tag("updating", "checking", (s) => expect(s.round).toBe(rounds)),
            Match.orElse(() => undefined),
          );

          if (
            looking !== null &&
            msg.type === "update_ok" &&
            Updated.isAnyOf(["current"])(msg.value) &&
            checking(next) !== null
          ) {
            expect(cmds).toContainEqual(
              expect.objectContaining({ type: "checks", head: msg.value.head, start: false }),
            );
          }
        }
      },
    ),
    { seed: 119120, numRuns: 200 },
  );
  expect(bounded, "walks reach the budget").toBeGreaterThan(0);
});

// pinned: these are the v1 fields PR 1030 saved. Do not derive them from the new model.
const OldCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const OldStep = Schema.TaggedUnion({
  asking: { tries: OldCount, at: Schema.Finite },
  waiting: {
    tries: OldCount,
    at: Schema.Finite,
    reason: Schema.Literals([
      "unavailable",
      "rate_limited",
      "refused",
      "handler_failed",
      "bad_cmd",
      "ci_silent",
      "ci_lost",
      "no_answer",
      "pending",
    ]),
  },
});

const OldJob = Schema.Struct({
  ref: Schema.NonEmptyString,
  change: Schema.Int.check(Schema.isGreaterThan(0)),
  head: Commit,
  reply: Schema.NonEmptyString,
});

const oldCounts = { attempt: OldCount, late: OldCount };

const oldWorking = { ...oldCounts, job: OldJob, step: OldStep };

const oldPrepared = { ...oldWorking, kind: ChangeKind.Kind, checks: Schema.NonEmptyArray(ChangeKind.Check) };

const OldModel = Schema.TaggedUnion({
  idle: oldCounts,
  reading: {
    ...oldWorking,
    step: Schema.Union([OldStep, Schema.TaggedStruct("asking", { tries: Schema.Literal(0), at: Schema.Null })]),
  },
  updating: oldPrepared,
  checking: { ...oldPrepared, head: Commit, tree: Tree, until: Schema.Finite },
  merging: { ...oldWorking, head: Commit, tree: Tree },
});

it.prop(
  "pinned: L17 every saved slice 1 state loads with its job and retry step intact",
  // Saved.model is JSON. Keep the pinned v1 schema, but draw only values its store could save.
  { old: Arbitrary.schema(OldModel).pipe(Arbitrary.filter(Schema.is(Schema.Json))) },
  ({ old }) => {
    const p = merger(Effect.runSync(Settings.all.parse(ConfigProvider.fromUnknown({}))));
    const result = Saved.upgrade({ v: 1, build: "slice-1", model: old, after: 0 }, p.state, "slice-2");
    const model = Schema.decodeSync(p.state.schema)(result.saved.model);
    expect(result.saved.v).toBe(2);
    expect(model).toMatchObject(old);

    Match.value(model).pipe(
      Match.tag("updating", (model) =>
        expect(model).toMatchObject({
          head: OldModel.matchOrElse(old, { updating: (o) => o.job.head }, () => null),
          round: 0,
          checked: null,
        }),
      ),
      Match.tag("checking", (model) => expect(model.round).toBe(0)),
      Match.orElse(() => undefined),
    );
  },
  { arbitrary: { seed: 119120, runs: 200 } },
);
