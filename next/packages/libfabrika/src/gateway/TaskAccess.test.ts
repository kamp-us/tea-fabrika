// T714, next/. A6/A7's pure entry points. The gateway suite exercises these rules on saved histories.
// select(tasks, {process,key}) returns Result<Task|null,"ambiguous">; owns checks all named resource facts.
// Ambiguity, finished-work and wrong-key plant trials are recorded in the tests-step report.
// P39 slice 3 (ticket 1040), J1's select half: a collected task is never offered, as a finished one
// is not. Plant (after build): let select keep `collected` tasks.
import { expect, it } from "@effect/vitest";
import { Result, Schema, Match } from "effect";
import * as Id from "../Id.ts";
import { type Task, Request, Executor, Result as TaskResult, State } from "../tasks/Task.ts";

import * as TaskAccess from "./TaskAccess.ts";

const Item = Schema.Struct({
  request: Schema.Struct({ ...Request.fields, process: Id.Process }),
  executor: Executor,
  execution: Schema.NonEmptyString,
  result: TaskResult,
  phase: Schema.Literals(["requested", "assigned", "started", "finished"]),
  matching: Schema.Boolean,
});

/** A task in any phase, a collected one among them: what `select` must sort. */
const AnyItem = Schema.Struct({
  ...Item.fields,
  phase: Schema.Literals(["requested", "assigned", "started", "finished", "collected"]),
});

const taskFor = (a: typeof AnyItem.Type): Task => {
  const assignment = {
    execution: a.execution,
    executor: { ...a.executor, key: a.matching ? a.request.target : `${a.request.target}x` },
  };
  const state = Match.value(a.phase).pipe(
    Match.when("requested", () => State.cases.requested.make({ request: a.request })),
    Match.when("assigned", () => State.cases.assigned.make({ request: a.request, assignment })),
    Match.when("started", () => State.cases.started.make({ request: a.request, assignment })),
    Match.when("finished", () => State.cases.finished.make({ request: a.request, assignment, result: a.result })),
    Match.orElse(() =>
      State.cases.collected.make({
        request: a.request,
        assignment,
        result: a.result,
        collection: { process: a.request.process, letter: `${a.request.id}/answer` },
      }),
    ),
  );
  return { state, events: [] };
};

/** The phases a hands key may still work on: a finished or collected task has nothing left to run. */
const OPEN: ReadonlyArray<string> = ["requested", "assigned", "started"];

it.prop(
  "A6 and J1: candidate selection filters by saved process and target, never by command id, and never offers finished or collected work",
  {
    items: Schema.Array(AnyItem).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
    key: Schema.NonEmptyString,
    process: Schema.String,
  },
  ({ items, key, process }) => {
    const tasks = items.map((item) => taskFor({ ...item, matching: true }));
    const subjects = tasks.flatMap((j) =>
      j.state._tag === "absent" ? [] : [{ process: j.state.request.process, key: j.state.request.target }],
    );

    for (const subject of [{ key, process }, ...subjects]) {
      for (const values of [tasks, [...tasks, ...tasks]]) {
        const wanted = values.filter(
          (j) =>
            j.state._tag !== "absent" &&
            OPEN.includes(j.state._tag) &&
            j.state.request.target === subject.key &&
            j.state.request.process === subject.process,
        );
        expect(TaskAccess.select(values, subject)).toEqual(
          wanted.length > 1 ? Result.fail("ambiguous") : Result.succeed(wanted[0] ?? null),
        );
      }
    }
  },
  { arbitrary: { seed: 119120, runs: 100 } },
);

it.prop(
  "A7: ownership binds process, selected target, executor and execution",
  { item: Item },
  ({ item }) => {
    const task = taskFor(item);
    const state = task.state;

    if (state._tag === "absent") {
      return;
    }

    const identity = { process: state.request.process, key: state.request.target };
    expect(TaskAccess.owns(task, identity)).toBe(
      state._tag === "requested" || state.assignment.executor.key === identity.key,
    );
    expect(TaskAccess.owns(task, { ...identity, key: `${identity.key}x` })).toBe(false);
    expect(TaskAccess.owns(task, { ...identity, process: `${identity.process}x` })).toBe(false);

    if (state._tag !== "requested") {
      expect(TaskAccess.owns(task, { ...identity, execution: state.assignment.execution })).toBe(
        state.assignment.executor.key === identity.key,
      );
      expect(TaskAccess.owns(task, { ...identity, execution: `${state.assignment.execution}x` })).toBe(false);
    }
  },
  { arbitrary: { seed: 119120, runs: 100 } },
);
