// Today's lead tooling. Tea owns phase order; Actions owns the separate ten-job order.
import { Cmd, Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Request } from "./l11-cases.ts";

export const Reason = Schema.Literals([
  "row_mapping_missing",
  "source_drift",
  "source_missing",
  "anchor_missing",
  "anchor_duplicate",
  "source_encoding",
  "missing_report",
  "empty_report",
  "malformed_report",
  "missing_collection",
  "collection_mismatch",
  "wrong_assertion",
  "green_plant",
  "early_assertion",
  "timeout",
  "skipped",
  "pending",
  "todo",
  "canceled",
  "startup",
  "setup",
  "trace_missing",
  "trace_incomplete",
  "trace_mismatch",
  "encoding_missing",
  "inventory_mismatch",
  "restore_failed",
  "operation_failed",
  "baseline_failed",
  "restored_failed",
  "runner_unverified",
  "workflow_unverified",
  "lock_mismatch",
  "batch_incomplete",
  "batch_failed",
]);

export type Reason = typeof Reason.Type;

export const Phase = Schema.Literals([
  "inspect",
  "measurement",
  "diagnostic",
  "baseline",
  "broken",
  "restore",
  "restored",
]);

export type Phase = typeof Phase.Type;

export const Outcome = Schema.TaggedUnion({
  ready: {},
  passed: {},
  timing: { failed: Schema.Boolean, timeout: Schema.Boolean },
  equal: {},
  leaked: {},
  restored: {},
  incomplete: { reason: Reason },
});

export type Outcome = typeof Outcome.Type;

export const Observation = Schema.Struct({ phase: Phase, outcome: Outcome });

export type Observation = typeof Observation.Type;

const history = Schema.Array(Observation);

const fields = { request: Request, history };

export const Model = Schema.TaggedUnion({
  inspect: fields,
  measurement: fields,
  diagnostic: fields,
  baseline: fields,
  broken: fields,
  restore: { ...fields, next: Schema.Literals(["observed", "restored", "incomplete"]), reason: Schema.NullOr(Reason) },
  restored: fields,
  observed: fields,
  incomplete: { ...fields, reason: Reason },
});

export type Model = typeof Model.Type;

export const perform = Cmd.make("l11_phase", {
  input: Schema.Struct({ phase: Phase }),
  ok: Observation,
  err: ["operation_failed"],
});

type Next = readonly [Model, ReadonlyArray<ReturnType<typeof perform>>];

const stay = (model: Model): Next => [model, []];

const enter = (model: Model, phase: Phase): Next => [model, [perform({ phase })]];

const terminal = Model.isAnyOf(["observed", "incomplete"]);

const expected = (model: Model) =>
  Model.matchOrElse(model, { observed: () => null, incomplete: () => null }, (value) => value._tag);

const incomplete = (model: Model, reason: Reason): Next =>
  stay(Model.cases.incomplete.make({ request: model.request, history: model.history, reason }));

const restore = (model: Model, next: "observed" | "restored" | "incomplete", reason: Reason | null): Next =>
  enter(Model.cases.restore.make({ request: model.request, history: model.history, next, reason }), "restore");

const accept = (model: Model, seen: Observation): Next => {
  if (terminal(model) || expected(model) !== seen.phase) {
    return stay(model);
  }

  const facts = { request: model.request, history: [...model.history, seen] };
  const failed = Outcome.matchOrElse(seen.outcome, { incomplete: ({ reason }) => reason }, () => null);

  return Model.match(model, {
    inspect: () => {
      if (failed !== null) {
        return incomplete({ ...model, ...facts }, failed);
      }

      if (!Outcome.isAnyOf(["ready"])(seen.outcome)) {
        return incomplete({ ...model, ...facts }, "operation_failed");
      }

      switch (model.request.case) {
        case "l11-compare":
        case "l11-batch":
          return enter(Model.cases.measurement.make(facts), "measurement");
        case "l11-inputs":
          return enter(Model.cases.diagnostic.make(facts), "diagnostic");
        case "l11-row":
          return incomplete({ ...model, ...facts }, "row_mapping_missing");
        default:
          return enter(Model.cases.baseline.make(facts), "baseline");
      }
    },
    measurement: () =>
      restore(
        { ...model, ...facts },
        failed === null && Outcome.isAnyOf(["timing"])(seen.outcome) ? "observed" : "incomplete",
        failed ?? (Outcome.isAnyOf(["timing"])(seen.outcome) ? null : "wrong_assertion"),
      ),
    diagnostic: () =>
      restore(
        { ...model, ...facts },
        failed === null && Outcome.isAnyOf(["equal"])(seen.outcome) ? "observed" : "incomplete",
        failed ?? (Outcome.isAnyOf(["equal"])(seen.outcome) ? null : "trace_incomplete"),
      ),
    baseline: () =>
      failed === null && Outcome.isAnyOf(["passed"])(seen.outcome)
        ? enter(Model.cases.broken.make(facts), "broken")
        : restore({ ...model, ...facts }, "incomplete", failed ?? "baseline_failed"),
    broken: () =>
      restore(
        { ...model, ...facts },
        failed === null && Outcome.isAnyOf(["leaked"])(seen.outcome) ? "restored" : "incomplete",
        failed ?? (Outcome.isAnyOf(["leaked"])(seen.outcome) ? null : "green_plant"),
      ),
    restore: ({ next, reason }) => {
      if (failed !== null || !Outcome.isAnyOf(["restored"])(seen.outcome)) {
        return incomplete({ ...model, ...facts }, "restore_failed");
      }

      switch (next) {
        case "observed":
          return stay(Model.cases.observed.make(facts));
        case "restored":
          return enter(Model.cases.restored.make(facts), "restored");
        case "incomplete":
          return incomplete({ ...model, ...facts }, reason ?? "operation_failed");
      }
    },
    restored: () =>
      failed === null && Outcome.isAnyOf(["passed"])(seen.outcome)
        ? stay(Model.cases.observed.make(facts))
        : incomplete({ ...model, ...facts }, failed ?? "restored_failed"),
    observed: () => stay(model),
    incomplete: () => stay(model),
  });
};

export const machine = Machine.make({
  model: Model,
  msg: Schema.Never,
  cmds: [perform],
  types: { ctx: {} as { readonly request: Request } },
  init: (loaded, ctx): Next =>
    loaded !== null
      ? terminal(loaded)
        ? stay(loaded)
        : incomplete(loaded, "operation_failed")
      : ctx.request.case === "l11-row"
        ? stay(Model.cases.incomplete.make({ request: ctx.request, history: [], reason: "row_mapping_missing" }))
        : enter(Model.cases.inspect.make({ request: ctx.request, history: [] }), "inspect"),
  update: {
    l11_phase_ok: (model, msg): Next => (msg.cmd.phase === expected(model) ? accept(model, msg.value) : stay(model)),
    l11_phase_err: (model, msg): Next => {
      if (terminal(model) || msg.cmd.phase !== expected(model)) {
        return stay(model);
      }

      return Model.matchOrElse(
        model,
        {
          inspect: () => incomplete(model, "operation_failed"),
          restore: () => incomplete(model, "restore_failed"),
        },
        () => restore(model, "incomplete", "operation_failed"),
      );
    },
  },
});
