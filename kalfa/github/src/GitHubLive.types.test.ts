// T19, the live Layer's type: what `GitHubLive.layer` takes and gives, what the settings' values are, and what a login holds. It is
// checked by the compiler (`tsc`, and the root `typecheck`), not by a test run: each `@ts-expect-error` below is a mistake the plan
// names, and it must stay a compile error. The helper holds the law's lines, and its `it` only names it.
import { expectTypeOf, it } from "@effect/vitest";
import { type Layer, Redacted, Schema } from "effect";
import type { HttpClient } from "effect/http";
import * as GitHub from "./GitHub.ts";
import * as GitHubLive from "./GitHubLive.ts";
import * as GitHubSettings from "./Settings.ts";

// T19. Plant: type `apiUrl` as `string`, and the plain-text line compiles; give the Layer `GitHubError` as its error, and the `never` line
// fails; type `Token.token` as `string`, and its plain-text line compiles; leave the HTTP client out of the Layer's needs, and the
// needs line fails; type `redirects` as `number`, and the values line fails.
const liveTypes = () => {
  const apiUrl = Schema.decodeUnknownSync(GitHubSettings.ApiUrl)("https://api.github.com");
  const pollInterval = Schema.decodeUnknownSync(GitHubSettings.PollInterval)("30 seconds");
  const redirects = Schema.decodeUnknownSync(GitHubSettings.Redirects)(20);

  const settings = { apiUrl, pollInterval, redirects };
  const login = new GitHub.Login.Token({ token: Redacted.make("ghp_x") });

  const layer = GitHubLive.layer({ login, settings });

  expectTypeOf(layer).toEqualTypeOf<Layer.Layer<GitHub.GitHub, never, HttpClient.HttpClient>>();

  // A setting's value is a text that passed the check, so a plain text does not reach the Layer.
  // @ts-expect-error a plain text is no address the setting checked
  const plainAddress = GitHubLive.layer({ login, settings: { ...settings, apiUrl: "https://api.github.com" } });
  // @ts-expect-error nor is a plain text a length of time
  const plainLength = GitHubLive.layer({ login, settings: { ...settings, pollInterval: "30 seconds" } });
  // @ts-expect-error nor is a plain number a limit the setting checked
  const plainLimit = GitHubLive.layer({ login, settings: { ...settings, redirects: 20 } });

  // A token is held as a `Redacted`, so a plain text is no login.
  // @ts-expect-error a plain text is no Redacted
  const plainToken = new GitHub.Login.Token({ token: "ghp_x" });

  expectTypeOf([plainAddress, plainLength, plainLimit, plainToken]).toBeArray();
  expectTypeOf(login.token).toEqualTypeOf<Redacted.Redacted<string>>();
  expectTypeOf(login).toExtend<GitHub.Login.Login>();

  expectTypeOf<GitHubSettings.Values>().toEqualTypeOf<{
    readonly apiUrl: typeof GitHubSettings.ApiUrl.Type;
    readonly pollInterval: typeof GitHubSettings.PollInterval.Type;
    readonly redirects: typeof GitHubSettings.Redirects.Type;
  }>();
};

it("T19 type: GitHubLive.layer is a Layer of GitHub that needs an HTTP client and fails with nothing, it takes only values the settings checked, and a login holds a Redacted token", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(liveTypes).toBeFunction();
});
