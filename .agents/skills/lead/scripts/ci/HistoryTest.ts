// HistoryTest.layer: History and Issues in memory. History answers from the facts it is built with,
// filtered as GitHub filters them; Issues starts from a list of open issues and keeps each write,
// in order, for a law to read. It asks GitHub nothing.
import { Context, Effect, Layer, Ref, Schema } from "effect";
import { History, Issues } from "./History.ts";
import type { Issue, Job, Pull, Run } from "./Speed.ts";

/** One write the measure made to its issue. */
export const Write = Schema.TaggedUnion({
  create: { title: Schema.String, body: Schema.String, label: Schema.String },
  comment: { number: Schema.Number, body: Schema.String },
  close: { number: Schema.Number },
});

export type Write = typeof Write.Type;

export type Facts = {
  readonly runs: ReadonlyArray<Run>;
  readonly jobs: ReadonlyArray<Job>;
  readonly pulls: ReadonlyArray<Pull>;
  /** Open issues, each with the label it carries. */
  readonly issues: ReadonlyArray<Issue & { readonly label: string }>;
};

/** The number an issue the measure opens gets. */
export const NEW_ISSUE = 900;

/** Each build starts from `facts`; `writes` holds every write, and `asked` the run ids `jobs` was asked for. */
export const layer = (facts: Facts, writes: Ref.Ref<ReadonlyArray<Write>>, asked: Ref.Ref<ReadonlyArray<number>>) =>
  Layer.succeedContext(
    Context.make(
      History,
      History.of({
        runs: (from, to) => Effect.succeed(facts.runs.filter((run) => run.created >= from && run.created < to)),
        jobs: (id) =>
          Effect.as(
            Ref.update(asked, (ids) => [...ids, id]),
            facts.jobs.filter((job) => job.run === id),
          ),
        merged: (since) => Effect.succeed(facts.pulls.filter((pull) => pull.merged >= since)),
      }),
    ).pipe(
      Context.add(
        Issues,
        Issues.of({
          open: (label) =>
            Effect.succeed(
              facts.issues.filter((i) => i.label === label).map(({ number, title }) => ({ number, title })),
            ),
          create: (title, body, label) =>
            Effect.as(
              Ref.update(writes, (w) => [...w, Write.cases.create.make({ title, body, label })]),
              NEW_ISSUE,
            ),
          comment: (number, body) => Ref.update(writes, (w) => [...w, Write.cases.comment.make({ number, body })]),
          close: (number) => Ref.update(writes, (w) => [...w, Write.cases.close.make({ number })]),
        }),
      ),
    ),
  );
