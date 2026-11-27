// ReviewsTest.layer: the Reviews service in memory, on one world of statuses by head that its writes change as GitHub's would
// (a write gives the status the next id, so the newest is the one posted last). It asks GitHub nothing. `calls` keeps every write, in
// order: a comment, then a status.
import { Effect, Layer, Option, Schema } from "effect";
import { comment, core, type Record as Verdict, status } from "./Review.ts";
import { Reviews, ReviewsError, type Seen } from "./Reviews.ts";

/** One status as GitHub holds it, before it is read. */
export type Stored = {
  readonly id: number;
  readonly creator: string;
  readonly state: string;
  readonly description: string;
  readonly url: string | null;
};

/** One write the layer took, as the caller made it. */
export const Call = Schema.TaggedUnion({
  comment: { pr: Schema.Finite, body: Schema.String },
  status: { head: Schema.String, state: Schema.String, description: Schema.String, url: Schema.String },
});

export type Call = typeof Call.Type;

/** The calls that fail with a reason, by name. A failed comment posts no status, as the real layer does. */
export type Failing = Partial<Record<"read" | "comment" | "status", string>>;

export type World = {
  /** The statuses of context `review` on each head, by the full sha. */
  readonly statuses: Map<string, Array<Stored>>;
  readonly calls: Array<Call>;
  /** Every head a read was asked for, in order. */
  readonly reads: Array<string>;
  /** A write that GitHub took and the next read does not show: the read back must catch it. */
  lossy: boolean;
  /** The id the next status takes. */
  next: number;
};

export const world = (): World => ({ statuses: new Map(), calls: [], reads: [], lossy: false, next: 1000 });

/** Puts a status on a head as it already was, before the tool ran. */
export const seed = (w: World, head: string, stored: Stored): void => {
  w.statuses.set(head, [...(w.statuses.get(head) ?? []), stored]);
};

const seen = (s: Stored): Seen => ({
  id: s.id,
  creator: s.creator,
  state: s.state,
  core: core(s.state, s.description),
  url: s.url,
});

export const layer = (w: World, failing: Failing = {}): Layer.Layer<Reviews> => {
  const fails = (name: keyof Failing) => {
    const reason = failing[name];

    return reason === undefined ? Effect.void : Effect.fail(ReviewsError.make({ reason }));
  };

  return Layer.succeed(
    Reviews,
    Reviews.of({
      read: (head) =>
        Effect.flatMap(
          Effect.andThen(
            Effect.sync(() => {
              w.reads.push(head);
            }),
            fails("read"),
          ),
          () =>
            /^[0-9a-f]{40}$/.test(head)
              ? Effect.succeed((w.statuses.get(head) ?? []).map(seen))
              : Effect.fail(ReviewsError.make({ reason: `${head} is not a full commit id` })),
        ),
      write: (pr, record: Verdict, url) =>
        Effect.gen(function* () {
          const target = Option.isSome(url)
            ? url.value
            : yield* Effect.flatMap(fails("comment"), () =>
                Effect.sync(() => {
                  w.calls.push(Call.cases.comment.make({ pr, body: comment(record) }));

                  return `https://github.test/pull/${pr}#issuecomment-${w.calls.length}`;
                }),
              );

          yield* fails("status");
          const { state, description } = status(record);
          w.calls.push(Call.cases.status.make({ head: record.head, state, description, url: target }));

          if (!w.lossy) {
            seed(w, record.head, { id: w.next++, creator: "lead", state, description, url: target });
          }
        }),
    }),
  );
};
