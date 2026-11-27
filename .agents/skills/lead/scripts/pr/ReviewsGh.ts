// ReviewsGh.layer: the Reviews service on `gh`, under the lead's own login. A write posts one pull request comment (the wide facts) and
// then one commit status with the context `review` that points at it; a read lists the statuses of one head, every page, and keeps the
// ones with that context. Every call names the repo, so the checkout it runs in does not pick it. No token is read or printed: `gh`
// carries the login.
import { Effect, Layer, Option, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { type Given, lastLine, run } from "./command.ts";
import { comment, CONTEXT, core, type Record, status } from "./Review.ts";
import { Reviews, ReviewsError, type Seen } from "./Reviews.ts";

/** One status as GitHub gives it, the keys we read. `creator` and `description` can be null. */
const Row = Schema.Struct({
  id: Schema.Int,
  state: Schema.String,
  context: Schema.String,
  description: Schema.NullOr(Schema.String),
  target_url: Schema.NullOr(Schema.String),
  creator: Schema.NullOr(Schema.Struct({ login: Schema.String })),
});

/** `gh api --paginate --slurp` prints one array holding each page's array. */
const Pages = Schema.fromJsonString(Schema.Array(Schema.Array(Row)));

/** What GitHub answers a new comment with: the one key we read. */
const Posted = Schema.fromJsonString(Schema.Struct({ html_url: Schema.String.check(Schema.isNonEmpty()) }));

const FULL = /^[0-9a-f]{40}$/;

/** Every status of an answer, whatever its context, as `Seen` with its context. The reader keeps the ones of context `review`. */
export const decode = (
  out: string,
): Effect.Effect<ReadonlyArray<{ readonly context: string; readonly seen: Seen }>, ReviewsError> =>
  Schema.decodeEffect(Pages)(out).pipe(
    Effect.mapError(() => ReviewsError.make({ reason: "gh api commits/statuses answered a shape we do not read" })),
    Effect.map((pages) =>
      pages.flat().map((row) => ({
        context: row.context,
        seen: {
          id: row.id,
          creator: row.creator?.login ?? "",
          state: row.state,
          core: core(row.state, row.description ?? ""),
          url: row.target_url,
        } satisfies Seen,
      })),
    ),
  );

/** `repo` is `owner/name`; `cwd` is any folder gh may start in. */
export const make = (
  repo: string,
  cwd: string,
): Effect.Effect<Reviews["Service"], never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    /** One gh call; any exit but 0 fails it with gh's own last line. */
    const gh = Effect.fn("ReviewsGh.gh")(
      function* (args: ReadonlyArray<string>, given?: Given) {
        const ran = yield* run("gh", args, cwd, given);

        if (ran.code !== 0) {
          return yield* ReviewsError.make({
            reason: `gh ${args.slice(0, 3).join(" ")} exited ${ran.code}: ${lastLine(ran)}`,
          });
        }

        return ran.out;
      },
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.catchTag("PlatformError", (e) =>
        Effect.fail(ReviewsError.make({ reason: `gh could not start: ${e.message}` })),
      ),
    );

    const read = Effect.fn("ReviewsGh.read")(function* (head: string) {
      if (!FULL.test(head)) {
        return yield* ReviewsError.make({ reason: `${head} is not a full 40-character commit id` });
      }

      const out = yield* gh(["api", "--paginate", "--slurp", `repos/${repo}/commits/${head}/statuses?per_page=100`]);

      // GitHub lists the newest first; the contract is oldest first.
      return (yield* decode(out))
        .filter((row) => row.context === CONTEXT)
        .map((row) => row.seen)
        .toSorted((a, b) => a.id - b.id);
    });

    const write = Effect.fn("ReviewsGh.write")(function* (pr: number, record: Record, url: Option.Option<string>) {
      const target = yield* Option.match(url, {
        onSome: Effect.succeed,
        onNone: () =>
          gh(["api", "-X", "POST", `repos/${repo}/issues/${pr}/comments`, "-f", `body=${comment(record)}`]).pipe(
            Effect.flatMap((out) =>
              Schema.decodeEffect(Posted)(out).pipe(
                Effect.mapError(() =>
                  ReviewsError.make({ reason: "the review comment was posted but GitHub named no url for it" }),
                ),
              ),
            ),
            Effect.map((posted) => posted.html_url),
          ),
      });

      const { state, description } = status(record);

      yield* gh([
        "api",
        "-X",
        "POST",
        `repos/${repo}/statuses/${record.head}`,
        "-f",
        `state=${state}`,
        "-f",
        `context=${CONTEXT}`,
        "-f",
        `description=${description}`,
        "-f",
        `target_url=${target}`,
      ]).pipe(
        Effect.mapError((e) =>
          ReviewsError.make({
            reason: `the review status on ${record.head.slice(0, 12)} was not posted (the lead's gh login may lack the right to create a commit status): ${e.reason}`,
          }),
        ),
      );
    });

    return Reviews.of({ read, write });
  });

/** The service as a layer. */
export const layer = (
  repo: string,
  cwd: string,
): Layer.Layer<Reviews, never, ChildProcessSpawner.ChildProcessSpawner> => Layer.effect(Reviews, make(repo, cwd));
