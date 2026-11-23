/**
 * The settings `@kalfa/github` reads: where GitHub's API answers, how often a watch asks again, and how many redirects one call
 * follows.
 *
 * **Details**
 *
 * An app joins `all` into its own group, which checks each value when the app starts, so a wrong value stops the start with its
 * file and line. `GitHubLive.layer` takes only a value that passed, so it makes its URL and its length of time with no failure of
 * its own.
 */
import { Setting, type SettingGroup } from "@kalfa/config";
import { Option, Schema } from "effect";

const ADDRESS = "an https address with no user, password, query or fragment, as https://api.github.com";

// Whether a text is an address the token may be sent to: https, and nothing a second secret or a second place could hide in.
const isAddress = (text: string): boolean =>
  !text.includes("?") &&
  !text.includes("#") &&
  Option.match(Schema.decodeUnknownOption(Schema.URLFromString)(text), {
    onNone: () => false,
    onSome: (url) => url.protocol === "https:" && url.username === "" && url.password === "",
  });

/**
 * Where GitHub's REST API answers: an https address with no user, password, query or fragment.
 *
 * **Details**
 *
 * The token goes to this address, so `http:` is refused, and a user or password part would be a second secret in a plain
 * setting. The refusal's message names the rule and holds no part of the text.
 *
 * @category models
 */
export const ApiUrl = Schema.String.check(Schema.makeFilter((text: string) => isAddress(text) || ADDRESS)).pipe(
  Schema.brand("@kalfa/github/ApiUrl"),
);

/**
 * A length of time, as `30 seconds`.
 *
 * @category models
 */
export const PollInterval = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      Option.isSome(Schema.decodeUnknownOption(Schema.DurationFromString)(text)) || "a length of time, as 30 seconds",
  ),
).pipe(Schema.brand("@kalfa/github/PollInterval"));

/**
 * How many redirects one call follows: from 0 to 20, the most `fetch` follows by itself.
 *
 * @category models
 */
export const Redirects = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 })).pipe(
  Schema.brand("@kalfa/github/Redirects"),
);

/**
 * `github.api-url`, GitHub's own address unless an Enterprise Server's is set.
 *
 * @category settings
 */
export const apiUrl = Setting.make("github.api-url", ApiUrl).pipe(
  Setting.withDefault(ApiUrl.make("https://api.github.com")),
  Setting.withDescription(
    "Where GitHub's REST API answers: https://api.github.com, or https://<host>/api/v3 for GitHub Enterprise Server.",
  ),
);

/**
 * `github.poll-interval`, how long a watch waits before it asks GitHub again.
 *
 * @category settings
 */
export const pollInterval = Setting.make("github.poll-interval", PollInterval).pipe(
  Setting.withDefault(PollInterval.make("30 seconds")),
  Setting.withDescription("How long a watch waits before it asks GitHub again."),
);

/**
 * `github.redirects`, how many redirects one call follows before it gives up.
 *
 * @category settings
 */
export const redirects = Setting.make("github.redirects", Redirects).pipe(
  Setting.withDefault(Redirects.make(20)),
  Setting.withDescription("How many redirects one call follows before it gives up: 20, as fetch does, or fewer."),
);

/**
 * Every setting of the package, to join into an app's own group.
 *
 * @category settings
 */
export const all = [apiUrl, pollInterval, redirects] as const;

/**
 * What the live Layer reads: the app's own values, or any record with these fields. A plain text or number does not compile, so
 * only a value that passed its setting's check reaches the Layer.
 *
 * @category models
 */
export type Values = Pick<SettingGroup.Values<typeof all>, "apiUrl" | "pollInterval" | "redirects">;
