/** GitHub's draft endpoint, using the existing botpush installation in memory. */
import { NodeRuntime } from "@effect/platform-node";
import { Console, Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import type { Text } from "./PullRequests.ts";

class DraftRefused extends Schema.TaggedError<DraftRefused, { readonly brand: unique symbol }>()("DraftRefused", {
  reason: Schema.String,
  status: Schema.optional(Schema.Int),
}) {}

const App = Schema.Struct({ slug: Schema.NonEmptyString });

const Branch = Schema.Struct({ commit: Schema.Struct({ sha: Schema.String }) });

const Draft = Schema.Struct({
  number: Schema.Int,
  state: Schema.String,
  draft: Schema.Boolean,
  title: Schema.String,
  body: Schema.NullOr(Schema.String),
  user: Schema.Struct({ login: Schema.String, type: Schema.String }),
  base: Schema.Struct({ ref: Schema.String }),
  head: Schema.Struct({ ref: Schema.String, sha: Schema.String, repo: Schema.Struct({ full_name: Schema.String }) }),
});

type Ask = {
  readonly repo: string;
  readonly branch: string;
  readonly head: string;
  readonly text: Text;
  readonly token: string;
  readonly jwt: string;
  readonly write: boolean;
};

/** Runs only draft creation; credentials stay in this process, never a child or a file. */
export const run = (ask: Ask): void => {
  const program = Effect.gen(function* () {
    if (!ask.write) {
      return yield* new DraftRefused({ reason: "installation lacks pull request write permission" });
    }

    const client = yield* HttpClient.HttpClient;

    const read = Effect.fn("BotDraft.read")(function* (path: string, auth: string, body?: unknown) {
      const request = (
        body === undefined
          ? HttpClientRequest.get(path)
          : HttpClientRequest.post(path).pipe(HttpClientRequest.bodyJsonUnsafe(body))
      ).pipe(
        HttpClientRequest.prependUrl("https://api.github.com"),
        HttpClientRequest.setHeaders({
          Authorization: `Bearer ${auth}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        }),
      );

      const response = yield* client
        .execute(request)
        .pipe(Effect.mapError(() => new DraftRefused({ reason: "GitHub request failed" })));

      if (response.status < 200 || response.status >= 300) {
        return yield* new DraftRefused({
          reason: `GitHub refused draft request: ${response.status}`,
          status: response.status,
        });
      }

      return yield* response.json.pipe(
        Effect.mapError(() => new DraftRefused({ reason: "GitHub returned unreadable JSON" })),
      );
    });

    const app = yield* read("/app", ask.jwt).pipe(Effect.flatMap(Schema.decodeUnknownEffect(App)));

    const remote = yield* read(`/repos/${ask.repo}/branches/${encodeURIComponent(ask.branch)}`, ask.token).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Branch)),
    );

    const head = remote.commit.sha;

    if (!/^[a-f0-9]{40}$/.test(head) || head !== ask.head) {
      return yield* new DraftRefused({ reason: "remote branch differs from the expected head" });
    }

    const path = `/repos/${ask.repo}/pulls`;
    const listed = `${path}?state=open&head=${encodeURIComponent(`${ask.repo.split("/")[0]}:${ask.branch}`)}&base=main`;

    const existing = Effect.fn("BotDraft.existing")(function* () {
      const rows = yield* read(listed, ask.token).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Draft))));

      return rows.find((pr) => pr.head.ref === ask.branch && pr.base.ref === "main");
    });

    let pr = yield* existing();

    if (pr === undefined) {
      pr = yield* read(path, ask.token, {
        title: ask.text.title,
        body: ask.text.body,
        head: ask.branch,
        base: "main",
        draft: true,
      }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Draft)),
        Effect.catchTag("DraftRefused", (error) =>
          error.status !== 422
            ? Effect.fail(error)
            : Effect.flatMap(existing(), (found) => (found === undefined ? Effect.fail(error) : Effect.succeed(found))),
        ),
      );
    }

    if (
      pr.state !== "open" ||
      !pr.draft ||
      pr.title !== ask.text.title ||
      (pr.body ?? "") !== ask.text.body ||
      pr.base.ref !== "main" ||
      pr.head.ref !== ask.branch ||
      pr.head.sha !== head ||
      pr.head.repo.full_name.toLowerCase() !== ask.repo.toLowerCase() ||
      pr.user.type !== "Bot" ||
      pr.user.login !== `${app.slug}[bot]`
    ) {
      return yield* new DraftRefused({
        reason: "pull request actor, text, draft, base or head differs; lead read required",
      });
    }

    yield* Console.log(`https://github.com/${ask.repo}/pull/${pr.number}`);
  });

  NodeRuntime.runMain(
    program.pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.catchTag("DraftRefused", (error) =>
        Effect.andThen(
          Console.error(`bot draft refused: ${error.reason}`),
          Effect.sync(() => {
            process.exitCode = 1;
          }),
        ),
      ),
      Effect.catch(() =>
        Effect.andThen(
          Console.error("bot draft refused: unreadable GitHub response"),
          Effect.sync(() => {
            process.exitCode = 1;
          }),
        ),
      ),
    ),
    { disableErrorReporting: true },
  );
};
