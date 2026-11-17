// Today's lead tooling. Completion records observations; the lead judges the intended assertion.
import { Cmd, Machine } from "@demlik/tea/effect";
import { Schema } from "effect";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Counts = Schema.Struct({
  total: Schema.Int.check(Schema.isGreaterThan(0)),
  passed: Count,
  failed: Count,
  pending: Count,
  todo: Count,
});

const Details = {
  title: Schema.String,
  file: Schema.String,
  ms: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  duration: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  counts: Counts,
  suites: Schema.Struct({ total: Count, passed: Count, failed: Count, pending: Count }),
};

export const Observation = Schema.TaggedUnion({
  passed: { ...Details, exit: Schema.Literal(0) },
  failed: {
    ...Details,
    exit: Schema.Int.check(Schema.isGreaterThan(0)),
    category: Schema.Literal("assertion"),
    diagnostic: Schema.String,
    assertion: Schema.NullOr(
      Schema.Struct({
        line: Schema.Int.check(Schema.isGreaterThan(0)),
        column: Schema.Int.check(Schema.isGreaterThan(0)),
      }),
    ),
  },
  incomplete: { reason: Schema.String },
});

export type Observation = typeof Observation.Type;

const Passed = Observation.cases.passed;

const Failed = Observation.cases.failed;

export const Phase = Schema.Literals(["baseline", "broken", "restored"]);

export type Phase = typeof Phase.Type;

export const phase = Cmd.make("phase", {
  input: Schema.Struct({ phase: Phase }),
  ok: Observation,
  err: ["PhaseFailed"],
});

export const Model = Schema.TaggedUnion({
  baseline: {},
  broken: { baseline: Passed },
  restored: { baseline: Passed, broken: Failed },
  recorded: { baseline: Passed, broken: Failed, restored: Passed },
  incomplete: { reason: Schema.String, observations: Schema.Array(Observation) },
});

export type Model = typeof Model.Type;

type Next = readonly [Model, readonly ReturnType<typeof phase>[]];

const stay = (model: Model): Next => [model, []];

const incomplete = (observations: readonly Observation[], reason: string): Next =>
  stay(Model.cases.incomplete.make({ reason, observations }));

export const machine = Machine.make({
  model: Model,
  msg: Schema.Never,
  cmds: [phase],
  init: (): Next => [Model.cases.baseline.make({}), [phase({ phase: "baseline" })]],
  update: {
    phase_ok: (model, msg): Next =>
      Model.match(model, {
        baseline: () =>
          msg.cmd.phase !== "baseline"
            ? stay(model)
            : Observation.match(msg.value, {
                passed: (baseline) => [Model.cases.broken.make({ baseline }), [phase({ phase: "broken" })]],
                failed: (value) => incomplete([value], "baseline_failed"),
                incomplete: (value) => incomplete([value], value.reason),
              }),
        broken: ({ baseline }) =>
          msg.cmd.phase !== "broken"
            ? stay(model)
            : Observation.match(msg.value, {
                failed: (broken) => [Model.cases.restored.make({ baseline, broken }), [phase({ phase: "restored" })]],
                passed: (value) => incomplete([baseline, value], "break_passed"),
                incomplete: (value) => incomplete([baseline, value], value.reason),
              }),
        restored: ({ baseline, broken }) =>
          msg.cmd.phase !== "restored"
            ? stay(model)
            : Observation.match(msg.value, {
                passed: (restored) => stay(Model.cases.recorded.make({ baseline, broken, restored })),
                failed: (value) => incomplete([baseline, broken, value], "restored_failed"),
                incomplete: (value) => incomplete([baseline, broken, value], value.reason),
              }),
        recorded: () => stay(model),
        incomplete: () => stay(model),
      }),
    phase_err: (model): Next =>
      incomplete(
        Model.match(model, {
          baseline: () => [],
          broken: ({ baseline }) => [baseline],
          restored: ({ baseline, broken }) => [baseline, broken],
          recorded: ({ baseline, broken, restored }) => [baseline, broken, restored],
          incomplete: ({ observations }) => observations,
        }),
        "phase_io",
      ),
  },
});
