// P8, next/. Real P11/P12 regressions: p22's refusals and the first p25 laws. The replay and
// delivery laws are in runner-contract-replay.test.ts; both share runner-contract.test-support.ts.
// Source: next/packages/libfabrika/src/app/runner.test.ts at 9b48d622b5d4.
import { expect, it } from "@effect/vitest";
import { ProgramDown, stepper, type Incoming, type ProgramRunner, type Refusal } from "@kampus/libfabrika";
import { Writer } from "@kampus/libfabrika/access/SessionManager";
import { Arbitrary, Array as Arr, Cause, Effect, Exit, Predicate, Result, Schema } from "effect";
import {
  Body,
  build,
  empty,
  id,
  incoming,
  makeProgram,
  number,
  opts,
  RefusalCases,
  text,
  unchanged,
  world,
  writer,
} from "./runner-contract.test-support.ts";

/** The key of each Msg, Cmd and answer these laws write or expect, made by a schema (0569, 0562).
 *  A law hands over only the fields it reads, so a case holds the key alone. */
const Tag = Schema.TaggedUnion({
  guard: {},
  peek: {},
  save: {},
});

/** The key of an answer named from its Cmd, such as `${cmd._tag}_ok`. */
const keyed = (name: string) => Schema.TaggedStruct(name, {}).make({});

const refusal = (actual: unknown, want: Refusal) => expect(actual).toEqual({ _tag: "refused", ...want });

const replayRefuse = (spy: { calls: number }): never => {
  spy.calls++;
  throw new Error("refuse must not run on accepted history");
};

const failedAs = (exit: Exit.Exit<unknown, unknown>, reason: string) => {
  expect(Exit.isFailure(exit)).toBe(true);

  if (Exit.isFailure(exit)) {
    expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "ProgramDown", reason });
  }
};

it.effect.prop(
  "p22: program refusal keeps reason/now/most without append, view, patch or Cmd",
  { c: RefusalCases },
  ({ c }) =>
    Effect.gen(function* () {
      const { body, ...want } = c;
      const w = yield* world(makeProgram(() => want));
      const runner = yield* w.runner();
      const before = yield* runner.open("watcher-1");
      yield* runner.open("watcher-2");
      w.updates.length = 0;
      refusal(yield* runner.msg(incoming(1, body, 0, true)), want);
      unchanged(before, yield* runner.open("watcher-1"));
      expect(yield* w.rows()).toEqual([]);
      expect(Arr.filter(w.updates, (u) => u.type === "patch")).toEqual([]);
      expect(w.calls).toEqual([]);
    }),
  opts,
);

it.prop(
  "p22: malformed fresh shapes are bad_msg; plants cannot replace program refusal",
  { c: RefusalCases },
  ({ c }) => {
    const { body, ...want } = c;
    const pure = Result.getOrThrow(stepper(makeProgram(() => want)));
    refusal(pure.step(empty, { ...Tag.cases.save.make({}), body: 17 }), { reason: "bad_msg" });
    refusal(pure.step(empty, { ...Tag.cases.save.make({}), body, base: 0, work: false }), want);
    expect(() => refusal({ _tag: "refused", reason: `${want.reason}!` }, want)).toThrow();
  },
  opts,
);

// Every runner bad_msg path (app/runner.ts accept and receive): no type or an undeclared one, a read port, a
// person-only port from an agent, an input that carries its own parent, and a declared port whose schema fails.
const BAD = ["untyped", "unknown", "read", "person_only", "parent", "admit_wrong", "admit_missing"] as const;

type Bad = (typeof BAD)[number];

const Wrong = Schema.Union([
  number(-4096, 4096),
  Schema.Boolean,
  Schema.Null,
  text(128),
  Schema.Array(text(128)).check(Schema.isMaxLength(8)),
]);

const BadMsgCases = Arbitrary.schema(
  Schema.Struct({
    tag: Schema.Union([
      Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(96)),
      Schema.Literals(["__proto__", "constructor", "toString", "hasOwnProperty", "probe_ok"]),
    ]),
    body: Body,
    base: number(0, 64),
    parent: Wrong,
    wrong: Wrong,
    field: Schema.Literals(["body", "base", "work"]),
    plant: Schema.Literals(["append", "publish", "cmd"]),
    on: Schema.Literals(BAD),
  }),
);

type BadMsgCase = typeof BadMsgCases extends Arbitrary.Arbitrary<infer C> ? C : never;

// A value of the wrong type for the field, whatever Wrong drew.
const wrongFor = (field: BadMsgCase["field"], wrong: BadMsgCase["wrong"]) =>
  field === "body"
    ? Predicate.isString(wrong)
      ? wrong.length
      : wrong
    : field === "base"
      ? Predicate.isNumber(wrong)
        ? String(wrong)
        : wrong
      : Predicate.isBoolean(wrong)
        ? Number(wrong)
        : wrong;

const badInput = (c: BadMsgCase, kind: Bad): BadMsgCase["wrong"] | object => {
  // work is true, so a bad input that got through would also run a Cmd.
  const save = { ...Tag.cases.save.make({}), body: c.body, base: c.base, work: true };

  if (kind === "untyped") {
    return c.wrong;
  }

  if (kind === "unknown") {
    return { ...save, ...keyed(["save", "guard", "peek"].includes(c.tag) ? `${c.tag}.undeclared` : c.tag) };
  }

  if (kind === "read") {
    return Tag.cases.peek.make({});
  }

  if (kind === "person_only") {
    return { ...Tag.cases.guard.make({}), body: c.body };
  }

  if (kind === "parent") {
    return { ...save, parent: c.parent };
  }

  if (kind === "admit_wrong") {
    return { ...save, [c.field]: wrongFor(c.field, c.wrong) };
  }

  const { [c.field]: _gone, ...missing } = save;

  return missing;
};

const fresh = (n: number, input: unknown, by: Incoming["envelope"]["by"] = writer): Incoming => ({
  ...incoming(n, ""),
  envelope: { ...incoming(n, "").envelope, by, input },
});

type World = Effect.Success<ReturnType<typeof world>>;

type Runner = typeof ProgramRunner.Service;

const patches = (w: World) => Arr.filter(w.updates, (u) => u.type === "patch");

// p22: a bad fresh shape returns bad_msg, writes no accepted input, changes no view, publishes no patch, runs no Cmd.
const freshBadMsg = Effect.fnUntraced(function* (
  w: World,
  runner: Runner,
  send: (i: Incoming) => Effect.Effect<unknown, unknown>,
  i: Incoming,
) {
  const before = (yield* runner.open("watcher-1")).view;
  refusal(yield* send(i), { reason: "bad_msg" });
  expect(yield* w.rows()).toEqual([]);
  expect(patches(w)).toEqual([]);
  expect(w.calls).toEqual([]);
  expect(w.receipts()).toEqual([]);
  unchanged(before, (yield* runner.open("watcher-1")).view);
});

it.effect.prop(
  "p22: every malformed or disallowed fresh input through runner.msg is bad_msg and changes nothing",
  { c: BadMsgCases },
  ({ c }) =>
    Effect.gen(function* () {
      const w = yield* world(makeProgram(() => null));
      const runner = yield* w.runner();
      yield* runner.open("watcher-1");
      w.updates.length = 0;

      for (const [n, kind] of BAD.entries()) {
        yield* freshBadMsg(w, runner, (i) => runner.msg(i), fresh(n + 1, badInput(c, kind)));
      }

      // Clean control: the person-only port is real; a person's own guard input is accepted, appended and run.
      const person = Writer.cases.person.make({ key: "SHA256:exam-person", for: writer.for });
      expect(yield* runner.msg(fresh(BAD.length + 1, badInput(c, "person_only"), person))).toMatchObject({
        _tag: "accepted",
      });
      expect((yield* w.rows())[0]).toMatchObject({ id: id("letter", BAD.length + 1) });
      expect(w.calls).toEqual(["append", "cmd"]);
    }),
  opts,
);

it.effect.prop(
  "checker plants: a runner that appends, publishes or runs a Cmd on a bad fresh input fails the p22 law",
  { c: BadMsgCases },
  ({ c }) =>
    Effect.gen(function* () {
      const w = yield* world(makeProgram(() => null));
      const runner = yield* w.runner();
      yield* runner.open("watcher-1");
      w.updates.length = 0;

      const planted = (i: Incoming) =>
        c.plant === "append"
          ? w.append(i).pipe(Effect.andThen(runner.msg(i)))
          : Effect.sync(() => {
              if (c.plant === "publish") {
                w.updates.push({ type: "patch", base: 0, rev: 1, patch: [] });
              } else {
                w.calls.push("cmd");
              }
            }).pipe(Effect.andThen(runner.msg(i)));

      const exit = yield* Effect.exit(freshBadMsg(w, runner, planted, fresh(1, badInput(c, c.on))));
      expect(Exit.isFailure(exit)).toBe(true);

      if (Exit.isFailure(exit)) {
        // The refusal still reads bad_msg; the law fails on the planted row, patch or Cmd.
        expect(Cause.pretty(exit.cause)).toContain("to deeply equal []");
      }
    }),
  opts,
);

it.effect.prop(
  "p22/p25: saved mail with a bad shape is refused on replay, kept in the inbox, and replay goes on past it",
  { c: BadMsgCases },
  ({ c }) =>
    Effect.gen(function* () {
      const spy = { calls: 0 };

      const w = yield* world(
        makeProgram(() => {
          spy.calls++;

          return null;
        }),
      );

      const runner = yield* w.runner();
      const before = (yield* runner.open("watcher-1")).view;
      w.updates.length = 0;

      // Mail, not accepted: each letter reaches the runner's replay receive path.
      for (const [n, kind] of BAD.entries()) {
        const i = fresh(n + 1, badInput(c, kind));
        expect((yield* w.append(i))._tag).toBe("placed");
      }

      const kept = yield* w.rows();
      expect(kept).toHaveLength(BAD.length);
      unchanged(before, (yield* runner.open("watcher-2")).view);
      unchanged(kept, yield* w.rows());
      // Watchers only see the read position move past the mail: a patch with no change to the view.
      expect(Arr.flatMap(patches(w), (u) => (u.type === "patch" ? u.patch : []))).toEqual([]);
      expect(w.calls).toEqual([]);
      expect(w.dead()).toEqual([]);
      expect(spy.calls).toBe(0);
      // A good letter after them still folds: the bad ones neither stop nor move the inbox.
      yield* w.append(incoming(BAD.length + 1, c.body));
      expect((yield* runner.open("watcher-3")).view).toEqual({ body: c.body, version: 1 });
      expect(yield* w.rows()).toHaveLength(BAD.length + 1);
      expect(w.dead()).toEqual([]);
    }),
  opts,
);

it.effect.prop(
  "p25: an accepted saved letter whose shape no longer decodes crashes, is kept, and is never re-refused",
  { c: BadMsgCases },
  ({ c }) =>
    Effect.gen(function* () {
      for (const kind of ["admit_wrong", "admit_missing"] as const) {
        const spy = { calls: 0 };
        const w = yield* world(makeProgram(() => replayRefuse(spy)));

        const m = fresh(1, badInput(c, kind)),
          placed = yield* w.append(m);

        if (placed._tag !== "placed") {
          return yield* Effect.die("seed append refused");
        }

        yield* w.store.save({ saved: { v: 1, build, model: empty, after: 0 }, turn: null, cmds: [] }, [
          { id: m.id, rev: placed.rev, pos: placed.pos },
        ]);

        const before = yield* w.rows(),
          runner = yield* w.runner();

        failedAs(yield* Effect.exit(runner.open("watcher")), "saved_letter");
        unchanged(before, yield* w.rows());
        expect(w.updates).toEqual([]);
        expect(w.calls).toEqual([]);
        expect(w.dead()).toEqual([]);
        expect(spy.calls).toBe(0);
      }
    }),
  opts,
);

it.effect.prop(
  "p22: a successful fresh step cannot install or run before append succeeds",
  { body: Arbitrary.schema(text(4096)) },
  ({ body }) =>
    Effect.gen(function* () {
      const w = yield* world(makeProgram(() => null));

      const runner = yield* w.runner(),
        before = yield* runner.open("watcher");

      w.updates.length = 0;
      w.block();
      refusal(yield* runner.msg(incoming(1, body, 0, true)), { reason: "seen_ahead" });
      unchanged(before, yield* runner.open("watcher"));
      expect(yield* w.rows()).toEqual([]);
      expect(Arr.filter(w.updates, (u) => u.type === "patch")).toEqual([]);
      expect(w.calls).toEqual(["append"]);
    }),
  opts,
);

it.effect.prop(
  "p25: a fresh throw is ProgramDown, never a refusal or accepted letter",
  { body: Arbitrary.schema(text(4096)) },
  ({ body }) =>
    Effect.gen(function* () {
      const w = yield* world(makeProgram(() => null, true));
      const runner = yield* w.runner();
      yield* runner.open("watcher");
      w.updates.length = 0;
      failedAs(yield* Effect.exit(runner.msg(incoming(1, body))), "step");
      expect(yield* w.rows()).toEqual([]);
      expect(w.calls).toEqual([]);
      expect(w.updates).toEqual([]);
    }),
  opts,
);

it.prop(
  "p25: a ProgramDown names its saved error class, else the thrown class",
  { name: Arbitrary.schema(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(96))) },
  ({ name }) => {
    expect(ProgramDown.make({ reason: "step", error: name, cause: new RangeError("x") }).errorClass).toBe(name);
    expect(ProgramDown.make({ reason: "step", cause: new RangeError("x") }).errorClass).toBe("RangeError");
    expect(ProgramDown.make({ reason: "step", cause: null }).errorClass).toBe("null");
    expect(ProgramDown.make({ reason: "step" }).errorClass).toBe("ProgramDown");
  },
  opts,
);

it.prop(
  "checker controls: append-first, patch, Cmd, changed refusal and swallowed throw plants fail",
  { c: RefusalCases },
  ({ c }) => {
    const { body, ...want } = c;
    refusal({ _tag: "refused", ...want }, want);
    unchanged({ log: [], model: empty, patches: [], cmds: [] }, { log: [], model: empty, patches: [], cmds: [] });

    for (const part of ["log", "patches", "cmds"] as const) {
      expect(() => unchanged({ [part]: [] }, { [part]: ["planted"] })).toThrow();
    }

    expect(() => refusal({ _tag: "refused", reason: "bad_msg", now: 4097 }, want)).toThrow();
    expect(() => failedAs(Exit.succeed({ _tag: "refused", reason: "step" }), "step")).toThrow();
    expect(() => unchanged({ body, version: 1 }, empty)).toThrow();
  },
  opts,
);
