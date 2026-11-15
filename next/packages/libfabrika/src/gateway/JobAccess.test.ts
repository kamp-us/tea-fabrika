// T714, next/. A6/A7's pure entry points. The gateway suite exercises these rules on saved histories.
// select(jobs, {process,key}) returns Result<Job|null,"ambiguous">; owns checks all named resource facts.
// Ambiguity, finished-work and wrong-key plant trials are recorded in the tests-step report.
// P39 slice 3 (ticket 1040), J1's select half: a collected job is never offered, as a finished one
// is not. Plant (after build): let select keep `collected` jobs.
import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import * as Id from "../Id.ts";
import { type Job, Request, Executor, Result as JobResult, State } from "../jobs/Job.ts";

import * as JobAccess from "./JobAccess.ts";

const Item = Schema.Struct({
  request: Schema.Struct({ ...Request.fields, process: Id.Process }),
  executor: Executor,
  execution: Schema.NonEmptyString,
  result: JobResult,
  phase: Schema.Literals(["requested", "assigned", "started", "finished"]),
  matching: Schema.Boolean,
});

/** A job in any phase, a collected one among them: what `select` must sort. */
const AnyItem = Schema.Struct({
  ...Item.fields,
  phase: Schema.Literals(["requested", "assigned", "started", "finished", "collected"]),
});

const jobFor = (a: typeof AnyItem.Type): Job => {
  const assignment = {
    execution: a.execution,
    executor: { ...a.executor, key: a.matching ? a.request.target : `${a.request.target}x` },
  };
  const state =
    a.phase === "requested"
      ? State.cases.requested.make({ request: a.request })
      : a.phase === "assigned"
        ? State.cases.assigned.make({ request: a.request, assignment })
        : a.phase === "started"
          ? State.cases.started.make({ request: a.request, assignment })
          : a.phase === "finished"
            ? State.cases.finished.make({ request: a.request, assignment, result: a.result })
            : State.cases.collected.make({
                request: a.request,
                assignment,
                result: a.result,
                collection: { process: a.request.process, letter: `${a.request.id}/answer` },
              });
  return { state, events: [] };
};

/** The phases a hands key may still work on: a finished or collected job has nothing left to run. */
const OPEN: ReadonlyArray<string> = ["requested", "assigned", "started"];

it.prop(
  "A6 and J1: candidate selection filters by saved process and target, never by command id, and never offers finished or collected work",
  {
    items: Schema.Array(AnyItem).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
    key: Schema.NonEmptyString,
    process: Schema.String,
  },
  ({ items, key, process }) => {
    const jobs = items.map((item) => jobFor({ ...item, matching: true }));
    const subjects = jobs.flatMap((j) =>
      j.state._tag === "absent" ? [] : [{ process: j.state.request.process, key: j.state.request.target }],
    );

    for (const subject of [{ key, process }, ...subjects]) {
      for (const values of [jobs, [...jobs, ...jobs]]) {
        const wanted = values.filter(
          (j) =>
            j.state._tag !== "absent" &&
            OPEN.includes(j.state._tag) &&
            j.state.request.target === subject.key &&
            j.state.request.process === subject.process,
        );
        expect(JobAccess.select(values, subject)).toEqual(
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
    const job = jobFor(item);
    const state = job.state;

    if (state._tag === "absent") {
      return;
    }

    const identity = { process: state.request.process, key: state.request.target };
    expect(JobAccess.owns(job, identity)).toBe(
      state._tag === "requested" || state.assignment.executor.key === identity.key,
    );
    expect(JobAccess.owns(job, { ...identity, key: `${identity.key}x` })).toBe(false);
    expect(JobAccess.owns(job, { ...identity, process: `${identity.process}x` })).toBe(false);

    if (state._tag !== "requested") {
      expect(JobAccess.owns(job, { ...identity, execution: state.assignment.execution })).toBe(
        state.assignment.executor.key === identity.key,
      );
      expect(JobAccess.owns(job, { ...identity, execution: `${state.assignment.execution}x` })).toBe(false);
    }
  },
  { arbitrary: { seed: 119120, runs: 100 } },
);
