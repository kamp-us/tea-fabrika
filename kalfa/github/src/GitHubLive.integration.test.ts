// I1, the real GitHub matches the stand-in. It is an integration law: it reaches api.github.com over the network, so the laptop refuses
// it by its name and it runs only in a proof run and on main's full run, anonymously, with no token. It reads three things once, then
// checks them against what the stand-in's replies copy (the vectors are what GitHub sent on 2026-11-23). GitHub counts an anonymous
// address at 60 reads an hour, and a shared runner may have used them up, so the law asks `GET /rate_limit` first, which GitHub does
// not count, and skips with a plain reason when too few are left, or when a read answers the limit's own message. Any other failure
// fails.
import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option, Predicate, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import * as GitHub from "./GitHub.ts";
import { liveSettings, makeRequest, send } from "./GitHubLive.test-support.ts";
import * as GitHubLive from "./GitHubLive.ts";
import { GET_REPO, ZEN } from "./Octokit.test-support.ts";

const SKIP = "GitHub's anonymous limit of 60 an hour is used up for this address; this law did not run";

/** The reads this law makes count against the limit: the repository read, `/zen`, the missing repository, and the version read. */
const NEEDED = 4;

const Repo = Schema.Struct({ id: Schema.Int, full_name: Schema.String, private: Schema.Boolean });

const ReadRepo = GitHub.route(GET_REPO, { auth: "none", success: Repo });

const ReadZen = GitHub.route(ZEN, { body: "text", auth: "none", success: Schema.String });

const RateLimit = GitHub.route("GET /rate_limit", {
  auth: "none",
  success: Schema.Struct({ resources: Schema.Struct({ core: Schema.Struct({ remaining: Schema.Finite }) }) }),
});

// Nobody is logged in: each route here sends no token, so the login the Layer holds is never read.
const live = GitHubLive.layer({
  login: new GitHub.Login.Token({ token: Redacted.make("not-a-token") }),
  settings: liveSettings({}),
}).pipe(Layer.provide(FetchHttpClient.layer));

/** Whether a failure is GitHub saying the limit is used up. */
const limited = (error: GitHub.GitHubError | GitHub.RateLimited): boolean =>
  Predicate.isTagged(error, "GitHubError") &&
  Predicate.isTagged(error.reason, "ClientError") &&
  (error.reason.status === 403 || error.reason.status === 429) &&
  (error.reason.message ?? "").startsWith("API rate limit exceeded");

// I1. Plant: drop the `user-agent` header (GitHub answers 403 with HTML); skip on every 403 and not only the rate limit's (the no-user-agent
// 403 skips); send `X-GitHub-Api-Version: 2026-13-99` (GitHub answers 400).
it("I1 vector: an anonymous read of octocat/Hello-World, /zen and a missing repository over the real client gives what the stand-in's replies copy", async ({
  skip,
}) => {
  // vector: octocat/Hello-World, /zen and a missing repository on api.github.com, as read on 2026-11-23; the law has no generated input.
  const outcome = await Effect.runPromise(
    Effect.gen(function* () {
      const left = yield* GitHub.call(RateLimit, {});

      if (left.resources.core.remaining < NEEDED) {
        return undefined;
      }

      const repo = yield* GitHub.call(ReadRepo, { params: { owner: "octocat", repo: "Hello-World" } });
      const zen = yield* GitHub.call(ReadZen, {});

      const missing = yield* GitHub.call(ReadRepo, {
        params: { owner: "octocat", repo: "no-such-repo-xyz-1945" },
      }).pipe(Effect.exit);

      const version = yield* send(
        makeRequest({ method: "GET", path: "/repos/octocat/Hello-World", auth: GitHub.Auth.None() }),
      );

      return { repo, zen, missing, version };
    }).pipe(
      Effect.provide(live),
      Effect.catch((error) => (limited(error) ? Effect.void : Effect.fail(error))),
    ),
  );

  if (outcome === undefined) {
    return skip(SKIP);
  }

  expect(outcome.repo).toEqual({ id: 1296269, full_name: "octocat/Hello-World", private: false });
  expect(outcome.zen.length, "a text that is not empty").toBeGreaterThan(0);

  if (Exit.isFailure(outcome.missing)) {
    const failed = Option.getOrUndefined(Cause.findErrorOption(outcome.missing.cause));

    if (failed !== undefined && limited(failed)) {
      return skip(SKIP);
    }

    expect(Predicate.isTagged(failed, "GitHubError")).toBe(true);

    if (Predicate.isTagged(failed, "GitHubError") && Predicate.isTagged(failed.reason, "ClientError")) {
      expect(failed.reason.status).toBe(404);
      expect(failed.reason.message).toBe("Not Found");
      expect(failed.reason.documentationUrl, "a documentation address").toBeDefined();
    } else {
      expect.fail("the missing repository did not fail as a ClientError");
    }
  } else {
    expect.fail("the missing repository was read");
  }

  expect(outcome.version.headers["x-github-api-version-selected"]).toBe(GitHub.apiVersion);
});
