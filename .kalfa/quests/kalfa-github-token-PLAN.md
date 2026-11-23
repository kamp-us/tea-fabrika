Approved by the lead agent, builds issues 1753, 1945; body adb496859ade
Plancheck-Version: 3

# Plan: @kalfa/github, call real GitHub with a plain token (ticket 1945)

This is the kalfa packages (`kalfa/`), new work: not today's frozen version and not `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/1945, a build ticket of the protocol
https://github.com/kamp-us/tea-fabrika/issues/1753. It builds on what ticket 1944 landed in `kalfa/github/` (pull
requests https://github.com/kamp-us/tea-fabrika/pull/2020, https://github.com/kamp-us/tea-fabrika/pull/2028 and
https://github.com/kamp-us/tea-fabrika/pull/2036; plan `.kalfa/quests/kalfa-github-operation-PLAN.md`): `route`, `call`,
the `GitHub` service and the `TestGitHub` fake.

It lands as two pull requests (`## Size`). Slice 1 teaches `call` the rest of what a route can say (a text answer, no
token, a media type, one call's own token) and names every failure (a 5xx, no answer at all). Slice 2 adds the live
Layer and its settings, so a call reaches the real GitHub. Slice 1 says `Part of #1945`; slice 2 says `Closes #1945`.

```ts
// The whole idea, a sketch. Nothing here was type-checked.
import * as GitHub from "@kalfa/github";
import * as GitHubLive from "@kalfa/github/live";
import * as GitHubSettings from "@kalfa/github/Settings";
import { SettingGroup } from "@kalfa/config";
import { FetchHttpClient } from "effect/http";
import { Effect, Layer, Redacted, Schema } from "effect";

// A caller's routes. A text route must say so, and a route can send no token at all.
const GetRepo = GitHub.route("GET /repos/{owner}/{repo}", {
  success: Schema.Struct({ id: Schema.Finite, full_name: Schema.String, private: Schema.Boolean }),
});
const Zen = GitHub.route("GET /zen", { body: "text", auth: "none", success: Schema.String });

// The app joins GitHub's settings into its own group: github.api-url, github.poll-interval and github.redirects.
const group = SettingGroup.make("demo", ...GitHubSettings.all /*, the app's own settings */);

// The live Layer: a plain token someone handed in, the app's values, and Effect's fetch client. Nothing is checked here.
const live = Layer.unwrap(
  Effect.map(group, (settings) =>
    GitHubLive.layer({ login: new GitHub.Login.Token({ token: Redacted.make(handedIn) }), settings }),
  ),
).pipe(Layer.provide(FetchHttpClient.layer));
// Layer<GitHub.GitHub, never, the group's needs>

const program = Effect.gen(function* () {
  const repo = yield* GitHub.call(GetRepo, { params: { owner: "octocat", repo: "Hello-World" } });
  // { id: 1296269, full_name: "octocat/Hello-World", private: false }
  const zen = yield* GitHub.call(Zen, {}); // "Approachable is better than simple."
  // One call with another person's token. No other call sees it.
  yield* GitHub.call(GetRepo, { params: { owner: "o", repo: "r" } }, { token: Redacted.make(theirs) });
});
// A 4xx fails with ClientError, a 5xx with ServerError, no answer with Unavailable; a write's failure says mayHaveApplied.
```

## Doubts, at the top

The lead settled all five at signing ("Lead's calls at signing (2026-11-23)", above `## Calls taken`): items 1 to 3 are
kept, item 4 now skips on GitHub's limit, and item 5 is now proven by law H9. They stay here as first written, so the
record shows what was doubted.

1. **A query array is sent as the key repeated, `exclude=a&exclude=b` (65%).** That is OpenAPI's default for a query
   parameter (`style: form`, `explode: true`) and what Effect's `UrlParams` writes. Octokit's `@octokit/endpoint` writes
   `encodeURIComponent(value)`, which joins an array with commas (from memory, not fetched). Only five query parameters in
   Octokit 29.0.1's types are arrays (`exclude` on migrations, `owner` and `token_id` on token requests, two sort lists),
   and no first caller uses one. What would settle it: one real call with two values on a migrations or token-request
   route, or the `style` and `explode` of those parameters in GitHub's description file.
2. **The `User-Agent` is a fixed `kalfa-github`, not a setting (70%).** GitHub refuses a request with no `User-Agent`
   (403, real run below) and asks for "your GitHub username, or the name of your application". A setting
   `github.user-agent` would let each app name itself. The ticket names only the address setting, so the plan keeps a
   constant and lists the setting under Findings. One line either way.
3. **A token a header cannot carry fails as `Undecodable` input, before anything is sent (75%).** It is checked against
   RFC 6750's `token68` grammar at each call, never at build (ruling 12, the ticket's "not checked when the Layer is
   built"). The check is needed, not a nicety: Node's `fetch` puts the bad header's value, the token, in its own error
   message (`Headers.append: "Bearer abc\ndef" is an invalid header value.`, read on Node 22.22.3 here). The other way is
   a reason of its own now (the sketch's `LoginFailed`, which ticket 1953 brings). What would settle it: the lead's word.
4. **The anonymous real read in CI may meet GitHub's limit of 60 an hour per address (70% it stays green).** GitHub's
   hosted runners share addresses. The token half of the law skips where no token is set, and main's full run sets
   none (Findings). What would settle it: a week of main's full runs, or giving that step a token.
5. **A redirect keeps the token on GitHub's own host only (75%).** `fetch` follows a 302 (the log routes answer one, to
   a storage host), and the Fetch standard drops `Authorization` on a hop to another origin. No law here proves it: a
   stand-in cannot, and the real read does not redirect. What would settle it: a real call to a log route in the first
   CI caller's plan.

## What changes, in one paragraph

Slice 1, in the root module: `route` takes `body: "text"` (required on a route GitHub answers only in text, such as
`GET /zen`), `auth: "none"` and `accept`. `call` takes a third argument, `{ token }`, a `Redacted` that one call sends
in place of the login; the type refuses it on an `auth: "none"` route. The `Request` the service gets now says who it is
sent as (`auth`) and which media type it asks for (`accept`), and its query holds only what a URL can carry. `call` reads
a text answer as text, turns a 5xx into `ServerError` with `mayHaveApplied`, and reads GitHub's `errors` when it is a
text. The fake answers a text route in plain text, as GitHub does. Slice 2: `@kalfa/github/Settings` declares
`github.api-url`, `github.poll-interval` and `github.redirects` through `@kalfa/config`; `GitHub.Login.Token` holds a plain token;
`@kalfa/github/live` gives `GitHubLive.layer({ login, settings })`, a `Layer<GitHub, never, HttpClient>` that sends each
request over Effect's `HttpClient`, sends `X-GitHub-Api-Version: 2022-11-28`, and turns a request that got no answer
into `Unavailable`.

## Searched first

- **Decision 0092** (`.kalfa/decisions/0092-kalfa-github-checks-its-routes-against-octokits-types-and-sends-their-date.md`),
  read whole: the client sends `2022-11-28`, and "Let a setting pick the date" was rejected. So the ticket's
  `github.api-version` setting (default `2026-03-10`) is gone, not built: the header is `GitHub.apiVersion`. The
  ticket's text is behind the decision (Findings).
- **The protocol, https://github.com/kamp-us/tea-fabrika/issues/1753**, read whole with its comments: the sketch of
  `Login`, the errors, ruling 7's settings (`api-url`, `poll-interval` 30 s and others), ruling 12 (a plain token is
  not checked at start), ruling 13 (`mayHaveApplied`), and the entry point table (`/Settings` imports `@kalfa/config`,
  `/live` imports Secrets' core and `@kalfa/config`).
- **https://github.com/kamp-us/tea-fabrika/issues/1870**, read whole: "Plain `Unreachable` belongs to the Ledger alone",
  so the reason is `Unavailable`, as the ticket says, and the 1944 law P3 keeps `Unreachable` out.
- **The ticket's comments:** `github.api-url` is held as text, checked as an address when the settings file is read, and
  made into a URL where it is used (the owner's answer on
  https://github.com/kamp-us/tea-fabrika/issues/1839#issuecomment-7087310445); and the note from 1944 slice 3 that the
  fake must answer text routes in plain text, with a law that the fake and `call` agree.
- **`kalfa/config/README.md`, "A setting's value is plain data"**: declare an address as text with a check, decode it
  where it is read. `kalfa/config/src/Declaration.ts` and `kalfa/config/src/SettingGroup.ts`: a group's values are keyed
  by the last word of each name (`github.api-url` is `apiUrl`), and a branded string is plain data.
- **`.kalfa/patterns/effect-errors-keep-their-cause.md`:** a wrapped failure keeps its cause, `Schema.Defect()`.
- **`.kalfa/patterns/effect-reach-for-what-ships.md`:** an HTTP call is Effect's `HttpClient` and `FetchHttpClient`.
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns` and `.kalfa/runbooks` for "user agent",
  "token68", "bearer", "redirect", "mayHaveApplied" and "may have applied": no hit beyond 1753's ruling 13.
- **No `@kalfa/secrets` package exists** (`kalfa/secrets/` holds only its glossary). A plain token needs none: it is
  Effect's `Redacted`. So `/live` imports `@kalfa/config` (through `Settings.ts`) and no Secrets yet; ticket 1953 adds
  Secrets' core with the App login.

## What was read in the installed versions

Effect 4.1.3 (lockfile, with the repo's patch), vitest 5.0.5, fast-check 4.10.2, `@octokit/openapi-types` 29.0.1.

- `effect/http` is a stable export path in 4.1.3 (`HttpClient.ts`, `HttpClientRequest.ts`, `FetchHttpClient.ts`), each
  marked `@stability unstable`. `unstableApiUsage` is off for `kalfa/` (`tsconfig.base.json`, line 24).
- `HttpClient.make` (`http/HttpClient.ts:820`) wraps each request in a client span named by its method, with
  `url.full`, `url.path` and `url.query` (`addUrlAttributes`), and writes `traceparent` and `b3` into the request
  (`TracerPropagationEnabled`, on by default). `HttpClient.TracerDisabledWhen` (`:3013`) turns both off. The 1944 README
  promises no path and no query in a span, so the live Layer turns the client span off.
- `Headers.CurrentRedactedNames` redacts `authorization` by default, but only when headers are printed. The plain value
  stays in `request.headers`. `HttpClientError` (`http/HttpClientError.ts`) holds the whole `request`, so an error that
  keeps it as its cause holds the token one property away.
- `FetchHttpClient.Fetch` (`http/FetchHttpClient.ts:35`) is a `Context.Reference` for the `fetch` function, so a law can
  run the real fetch client on a stand-in `fetch`. `HttpClientRequest.prependUrl` joins with one slash
  (`joinSegments`, `:852`). `UrlParams.fromInput` repeats an array's key and drops `undefined`.
- `@octokit/openapi-types` 29.0.1: `GET /zen` answers `text/plain`, `GET /octocat` answers
  `application/octocat-stream`, `POST /markdown` answers `text/html`.

## What GitHub really sent (a real run, 2026-11-23, anonymous, from this laptop)

These are the vectors the stand-in replies copy (label `vector:` in the laws).

| Request | Status | `content-type` | What came back |
|---|---|---|---|
| `GET /zen` | 200 | `text/plain;charset=utf-8` | `Approachable is better than simple.` with no line break; `x-github-api-version-selected: 2022-11-28` |
| `GET /repos/octocat/Hello-World` | 200 | `application/json; charset=utf-8` | `"id": 1296269`, `"full_name": "octocat/Hello-World"`, `"private": false`, pretty-printed |
| `GET /repos/octocat/no-such-repo-xyz-1945` | 404 | `application/json; charset=utf-8` | `{"message":"Not Found","documentation_url":"https://docs.github.com/rest/repos/repos#get-a-repository","status":"404"}` |
| the repo read with `X-GitHub-Api-Version: 2026-13-99` | 400 | `application/json; charset=utf-8` | `"message": "Bad Request"`, and `"errors"` as **one text** naming the two supported dates |
| the repo read with no `User-Agent` | 403 | `text/html; charset=utf-8` | "Request forbidden by administrative rules. Please make sure your request has a User-Agent header" |
| the repo read with a made-up `Bearer` token | 401 | `application/json; charset=utf-8` | `{"message":"Bad credentials",...}`; the token is not echoed |

The 400 shows a bug in what 1944 landed: `ClientError.errors` is read as a list only, so `wire.errorBody` refuses the
whole body and the `ClientError` loses its `message` too. The ticket asks that a 4xx hold GitHub's errors, so slice 1
fixes it.

## How others do it

- **Elm's `Http`** (package docs, from memory): a request names what it expects back, `expectJson` or `expectString`,
  next to its method, headers and URL; its `Error` is `BadUrl | Timeout | NetworkError | BadStatus Int | BadBody String`.
  This plan follows both: `body: "text"` is the route's expectation, and the reasons split the same way (`Unavailable` is
  `NetworkError`, `ClientError` and `ServerError` are `BadStatus`, `Undecodable` is `BadBody`).
- **Erlang/OTP's `httpc`** (docs, from memory): a status is an answer, `{ok, {{Version, Status, Reason}, Headers, Body}}`,
  and only a failed exchange is `{error, Reason}`. Here too, the live service answers every status, and `call` reads it.
- **Effect's own HttpClient example** (`node_modules/effect/ai-docs/src/50_http-client/10_basics.ts`, read): a service
  Layer takes `HttpClient.HttpClient`, maps every request with `prependUrl` and a header, and leaves `FetchHttpClient.layer`
  to the app. The live Layer is that shape.
- **Octokit's `@octokit/request`** (from memory, not fetched): base URL `https://api.github.com`, its own `user-agent`,
  `Accept: application/vnd.github.v3+json`, a swappable `fetch`, and a `RequestError` whose copy of the request headers has
  `authorization` replaced by `[REDACTED]`. Octokit takes the same care with the token in an error.
- **GitHub's REST docs** (from memory; the 403, 400 and 401 above confirm the parts that matter): a `User-Agent` is
  required, `X-GitHub-Api-Version` picks the date, `Authorization: Bearer <token>` carries any token kind, and
  `application/vnd.github+json` is the default media type.
- **"May have applied"** is the industry's ambiguous-write problem: a write whose answer never came may still have run.
  Stripe's API docs answer it with idempotency keys (from memory). Ruling 13 asks only that the error say so.

## The shape

### Slice 1: the root module (`GitHub.ts`, `internal/Check.ts`, `internal/wire.ts`) and the fake

```ts
// A sketch. Nothing here was type-checked.

// route gains two literal type parameters, so the types know a text route and a route that sends no token.
class Declared<R, Success, Query, Payload, B extends "json" | "text", A extends "login" | "none">
  extends Data.TaggedClass("Route")<{
    readonly route: R; readonly method: Method; readonly path: string;
    readonly success?: Success; readonly query?: Query; readonly payload?: Payload;
    readonly bodiless?: ReadonlyArray<number>;
    readonly body: B;          // "json" unless declared
    readonly auth: A;          // "login" unless declared: the Layer's own login
    readonly accept?: string;  // the media type asked for, when declared
  }> { readonly [TypeId] = TypeId }

export type Route<R, S, Q, P, B extends "json" | "text" = "json", A extends "login" | "none" = "login"> =
  Declared<R, S, Q, P, B, A>;

export const route: <const R extends RouteName, S = never, Q = {}, P = never,
  const B extends "json" | "text" = "json", const A extends "login" | "none" = "login">(
  route: R, ...options: Check.Options<R, S, Q, P, B, A>) => Route<R, S, Schema.Struct<Q>, P, B, A>;

// Check.ts gains three parts of the declaration:
//   body    required as "text" on a route whose every 2xx with a body is not JSON (GET /zen, GET /octocat,
//           POST /markdown, POST /markdown/raw); optional, "json" or "text", on every other route.
//   success on a text route: any Schema whose Encoded is string, and no description walk (the answer is not the
//           description's JSON once a media type such as application/vnd.github.raw+json changes it).
//   auth    optional, "none" only (ticket 1953 adds "app"). accept: optional, a string.

GitHub.route("GET /zen");                                            // does not compile: GitHub answers it in text
GitHub.route("GET /zen", { body: "text", success: Schema.Number });  // does not compile: a text answer is read from text
GitHub.route("GET /repos/{owner}/{repo}/readme", {
  body: "text", accept: "application/vnd.github.raw+json", success: Schema.String,
});                                                                  // compiles: the raw file's text

// Who a request is sent as, decided by call.
export type Auth =
  | { readonly _tag: "Login" }                                       // the Layer's login
  | { readonly _tag: "None" }                                        // a route declared auth: "none"
  | { readonly _tag: "Token"; readonly token: Redacted.Redacted<string> };  // this call's own token

// What a URL's query can carry. call refuses anything else as Undecodable input, so the fake and the live
// client read the same values.
export type QueryValue = string | number | boolean | ReadonlyArray<string | number | boolean>;

export interface Request {
  readonly route: RouteName; readonly method: Method; readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, QueryValue>>;    // was Record<string, Schema.Json>
  readonly body?: Schema.Json;
  readonly auth: Auth;                                     // new
  readonly accept?: string;                                // new: there exactly when the route declared one
}

// call's third argument. On an auth: "none" route the token does not compile.
export type CallOptions<Op extends AnyRoute> =
  Op extends Route<RouteName, any, any, any, any, infer A>
    ? A extends "none" ? { readonly token?: never } : { readonly token?: Redacted.Redacted<string> }
    : never;

export const call: <Op extends AnyRoute>(op: Op, input: Input<Op>, options?: CallOptions<Op>) =>
  Effect.Effect<Success<Op>, GitHubError | RateLimited, GitHub | Services<Op>>;

// The new reasons. GitHubError keeps no message and no cause of its own (1944's span law C9).
export class ServerError extends Schema.TaggedError<ServerError, { readonly brand: unique symbol }>()("ServerError", {
  status: Schema.Int,              // 500 to 599
  mayHaveApplied: Schema.Boolean,  // true for a write, false for a GET
}) {}

export class Unavailable extends Schema.TaggedError<Unavailable, { readonly brand: unique symbol }>()("Unavailable", {
  mayHaveApplied: Schema.Boolean,  // true for a write that left; false for a GET, and for a request that never left
  cause: Schema.Defect(),          // the failure under the HTTP client's error, never that error itself
}) {}

export class GitHubError /* ... */ ({
  operation: Schema.String,
  reason: Schema.Union([ClientError, ServerError, Unavailable, Undecodable]),
}) {}

// ClientError.errors as GitHub sends it: a list of objects or texts, or one text (the 400 above).
errors: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.Json)])),
```

`wire.ts` gains two pure helpers: `mayHaveApplied(method, left)` (true exactly for a write that left), used by `call`
for a 5xx and by the live Layer for a failed exchange; and `queryValues`, which reads an encoded query as
`Record<string, QueryValue>` or says which key cannot be carried. `wire.errorBody` reads `message`,
`documentation_url` and `errors` each on its own, so one odd field never hides the others.

In `call`, in order: fill the path, encode the query and check its values, encode the payload, build the `Request` with
`auth` (`None` for an `auth: "none"` route, `Token` when `options.token` is given, else `Login`) and `accept`, send, then
read the reply. A 2xx on a `body: "text"` route is decoded by the success Schema from the raw body text, with no JSON
step. A 4xx is `ClientError` as before. A 5xx is `ServerError` with `mayHaveApplied: wire.mayHaveApplied(method, true)`.
A 1xx or 3xx stays `Undecodable` answer.

The fake (`TestGitHub.ts`): `answer` on a `body: "text"` route takes an `f` that answers a string (`undefined` on a
bodiless status) and writes it as the body as is, with `content-type: text/plain; charset=utf-8`. `refuse` takes
`errors` as a text too.

### Slice 2: `Login.ts`, `Settings.ts`, `GitHubLive.ts`

```ts
// A sketch. Nothing here was type-checked.

// Login.ts, exported from the root as GitHub.Login.
/** A plain token someone handed in, such as a person's own login. It is never checked when the Layer is built. */
export class Token extends Data.TaggedClass("Token")<{ readonly token: Redacted.Redacted<string> }> {}
/** What the live Layer logs in as. The App (1953), an installation (1956) and a user (1958) join it. */
export type Login = Token;

// Settings.ts, the entry point @kalfa/github/Settings. It imports @kalfa/config and effect, nothing else.
import { Setting, type SettingGroup } from "@kalfa/config";

const Address = "an https address with no user, password, query or fragment, as https://api.github.com";
export const ApiUrl = Schema.String.check(Schema.makeFilter(isApiUrl /* URL parses, https:, no user, password, search, hash */ || Address))
  .pipe(Schema.brand("@kalfa/github/ApiUrl"));
export const PollInterval = Schema.String.check(Schema.makeFilter(isLength /* Schema.DurationFromString decodes it */))
  .pipe(Schema.brand("@kalfa/github/PollInterval"));

export const apiUrl = Setting.make("github.api-url", ApiUrl).pipe(
  Setting.withDefault(ApiUrl.makeUnsafe("https://api.github.com")),
  Setting.withDescription("Where GitHub's REST API answers: https://api.github.com, or https://<host>/api/v3 for GitHub Enterprise Server."),
);
export const pollInterval = Setting.make("github.poll-interval", PollInterval).pipe(
  Setting.withDefault(PollInterval.makeUnsafe("30 seconds")),
  Setting.withDescription("How long a watch waits before it asks GitHub again."),
);
export const Redirects = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 })).pipe(Schema.brand("@kalfa/github/Redirects"));
export const redirects = Setting.make("github.redirects", Redirects).pipe(
  Setting.withDefault(Redirects.makeUnsafe(20)),
  Setting.withDescription("How many redirects one call follows before it gives up: 20, as fetch does, or fewer."),
);
export const all = [apiUrl, pollInterval, redirects] as const;
/** What the live Layer reads: the app's own values, or any record with these fields. */
export type Values = Pick<SettingGroup.Values<typeof all>, "apiUrl" | "pollInterval" | "redirects">;
// { readonly apiUrl: ApiUrl; readonly pollInterval: PollInterval; readonly redirects: Redirects }: a plain value does
// not compile, so only a value that passed the check reaches the Layer.

// GitHubLive.ts, the entry point @kalfa/github/live.
export const layer = (options: { readonly login: Login.Login; readonly settings: Settings.Values }):
  Layer.Layer<GitHub.GitHub, never, HttpClient.HttpClient> =>
  Layer.effect(GitHub.GitHub, Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl(options.settings.apiUrl)),
    );
    // send(request), in order:
    //  1. the token: Login gives options.login.token, Token gives its own, None gives none. A token that is not
    //     RFC 6750 token68 (letters, digits, - . _ ~ + /, then = padding; not empty) fails with Undecodable input whose
    //     message names no part of it. Nothing is sent.
    //  2. the request: the method and the filled path, urlParams from the query (an array repeats its key), headers
    //     accept (declared, else application/vnd.github+json), x-github-api-version (GitHub.apiVersion), user-agent
    //     (kalfa-github), authorization (Bearer <token>, from HttpClientRequest.bearerToken) when there is a token, and
    //     the body as JSON text with content-type application/json; charset=utf-8.
    //  3. the exchange, with HttpClient.TracerDisabledWhen set to always: no client span, no traceparent, no b3. The
    //     client is piped through HttpClient.followRedirects(settings.redirects), and the exchange runs with
    //     FetchHttpClient.RequestInit set to { redirect: "manual" }, so fetch never follows a redirect itself: Effect
    //     follows it, and drops authorization, proxy-authorization and cookie when the next URL's origin differs
    //     (read in http/HttpClient.ts, followRedirects). A 3xx past the limit comes back as the reply, which call reads
    //     as Undecodable answer.
    //  4. the reply: status, headers by lowercase name, body as text.
    //  5. a failed exchange, or a body that could not be read: Unavailable, mayHaveApplied from wire.mayHaveApplied
    //     (left is true for a transport failure and a body failure, false when the request could not be built), and the
    //     cause is the HTTP error reason's own cause, never the HttpClientError, which holds the request's headers.
    return { send, poll: Schema.decodeSync(Schema.DurationFromString)(options.settings.pollInterval) };
  }));
```

No setting, no retry, no rate-limit wait and no remembered answer is built here: those are tickets 1946 to 1951. A 403
or 429 rate-limit answer stays a `ClientError` until ticket 1949.

## One value traced: a repo read with a call's own token, then four things go wrong

1. The caller runs `GitHub.call(GetRepo, { params: { owner: "octocat", repo: "Hello-World" } }, { token })`, where
   `token` is `Redacted.make("ghp_x...")`. Its type allows `token`: `GetRepo` has no `auth: "none"`.
2. `call` fills the path, `/repos/octocat/Hello-World`, has no query and no payload, and hands the service
   `{ route: "GET /repos/{owner}/{repo}", method: "GET", path, params, query: {}, auth: { _tag: "Token", token } }`.
3. The live `send` takes the token from `auth`, checks it is `token68` (it is), and builds `GET
   https://api.github.com/repos/octocat/Hello-World` with `accept: application/vnd.github+json`,
   `x-github-api-version: 2022-11-28`, `user-agent: kalfa-github` and `authorization: Bearer ghp_x...`. The login's own
   token is not read. No span starts but `github.call`.
4. GitHub answers 200 with the repo's JSON. `send` gives `{ status: 200, headers: { "content-type": "application/json;
   charset=utf-8", ... }, body: "{\n  \"id\": 1296269, ..." }`. `call` decodes `{ id: 1296269, full_name:
   "octocat/Hello-World", private: false }`.
5. The same call to `no-such-repo-xyz-1945` gets the 404 above: `GitHubError { operation: "GET /repos/{owner}/{repo}",
   reason: ClientError { status: 404, message: "Not Found", documentationUrl: "https://docs.github.com/rest/repos/repos#get-a-repository" } }`.
6. A `POST /repos/{owner}/{repo}/issues` that gets a 502: `ServerError { status: 502, mayHaveApplied: true }`. A GET
   that gets a 502: `mayHaveApplied: false`.
7. `fetch` rejects on that POST (the connection dropped): `Unavailable { mayHaveApplied: true, cause: TypeError("fetch
   failed") }`. On the GET: `mayHaveApplied: false`. Nothing is a defect.
8. A token `"ghp_x\n"` (a pasted line break): `Undecodable { side: "input", message: "the token holds a character a
   header cannot carry" }`, nothing sent, and the token's text is in no error, log or span.

## Generators

Every generator is an Effect `Arbitrary`, as 1944's are. Each law applies to each drawn value one made from it for
every class, so every class is reached in every run (1944's pattern, `kalfa/github/src/GitHub.test-support.ts`). Slice 1's
live in `GitHub.test-support.ts` and `TestGitHub.test-support.ts`; slice 2's in `GitHubLive.test-support.ts`. Each class
that targets a guard passes every earlier check, since an input an earlier check refuses never reaches it; that is said
at each such class.

Slice 1:

- **`texts`** (a text route's answer): (a) empty, only spaces, a trailing `\n`, `\r\n` inside; (b) text that is also
  JSON: `{}`, `[]`, `null`, `123`, `"x"`, `true`; (c) `"`, `\`, U+0000 to U+001F, letters past ASCII, an emoji; (d) 64 KB
  of text.
- **`statuses`**: (e) 500 to 599, each with every method (`GET`, `PUT`, `POST`, `PATCH`, `DELETE`); (f) 100 to 199 and
  300 to 399.
- **`senders`**: (g) a call with `options.token`, one without, and an `auth: "none"` route with a token forced past the
  types by a cast; (h) a route with `accept` declared and one without.
- **`queryValues`**: (i) a query value that is `null`, an object, or a list holding an object or `null`. It reaches the
  value check because the route is declared through a cast with a `Schema.Unknown` query field, which encodes it as is,
  and `wire.Tree` takes JSON.
- **`errorBodies`, widened**: (j) `errors` as one text, beside `message` and `documentation_url` (vector: the 400 above).

Slice 2:

- **`apiUrls`**: (k) `https://api.github.com` and a generated host, each with and without a trailing `/`; (l) a path
  prefix (`/api/v3`, with and without a trailing `/`) and a port; (m) refused: `http:`, `ftp:`, no scheme, text that is no
  URL, empty, a user or a password, a query, a fragment. Each refused kind passes the checks before its own: the user,
  query and fragment cases are `https:` addresses that parse.
- **`queries`** (the live wire): (n) texts with `&`, `=`, `+`, `#`, `%`, `?`, a space and letters past ASCII; (o) lists,
  empty, one item and many, numbers and booleans, and an empty query.
- **`tokens`**: (p) GitHub's token shapes, `ghp_` and `github_pat_` and `ghs_` and `gho_` with generated bodies, a JWT of
  three base64url parts, and random `token68` text; (q) a token a header cannot carry: with CR, LF, NUL, a space, a tab,
  letters past Latin-1, `=` in the middle, and the empty text.
- **`crowd`**: (r) 2 to 20 calls at once, each with its own `options.token` from (p) or none, run with unbounded
  concurrency, their replies held back in a generated order.
- **`breaks`**: (s) `fetch` rejects before an answer, with a generated message, for each method; (t) the body stream
  fails after the status came, for each method.
- **`replies`**: (u) header names in mixed case and a header sent twice; (v) a body that is not valid UTF-8; (w) a
  GitHub-shaped reply for each kind of route: the repo read's JSON, `/zen`'s text and the 404 (vector: the real run
  above).
- **`hops`** (redirects the stand-in `fetch` answers, each with a `location`): (x) a 301, 302, 303, 307 or 308 to
  another host, such as the storage host GitHub sends log downloads to; (y) a hop to GitHub's own origin, by a relative
  `location` and by a full one; (z) a hop to the same host on another scheme or port, which is another origin, and a
  chain of hops longer than `github.redirects`. Every hop passes the earlier checks: the token is `token68`, and each
  request was built and sent.

## Laws

Run caps: every property law runs 100 to 300 runs on 1944's seed, all in memory. 1944's C laws run at those counts in a
few seconds each, so each law here should stay well under 20 s on the laptop at full depth. The tests step reports any
law over 10 s and lowers its run count, never its classes.

### Laws, slice 1

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| T14, the route's new options: `route("GET /zen")` and `route("GET /octocat")` do not compile without `body: "text"`; with it they compile; `success: Schema.Number` on `/zen` does not compile, `Schema.String` and a Schema from text to a Struct do; `body: "text"` on the repo read with `accept: "application/vnd.github.raw+json"` compiles and takes `Schema.String`; `auth: "none"` compiles, `auth: "nobody"` does not; `accept: 1` does not | type | type | make `body` optional on every route: the `/zen` line with no body compiles, red; type a text route's success as any Schema: the `Schema.Number` line compiles, red; type `auth` as `string`: the `"nobody"` line compiles, red | kalfa/github/src/GitHub.types.test.ts |
| T15, call's options: `call(GetRepo, input, { token: Redacted.make("t") })` compiles; `{ token: "t" }` does not; any `token` on an `auth: "none"` route does not; `call(Zen, {})` is `Effect<string, ...>`; `call(op, input)` with no options keeps 1944's T7 type | type | type | type `token` as `string \| Redacted.Redacted<string>`: the plain-text line compiles, red; read `CallOptions` without the route's `A`: the `auth: "none"` line compiles, red | kalfa/github/src/GitHub.types.test.ts |
| T16, the fake on a text route: `GitHubTest.answer(Zen, () => "text")` compiles; `() => ({ a: 1 })` does not; on a JSON route, 1944's T9 still holds | type | type | type a text route's `Answered` as `Schema.Json`: the object line compiles, red | kalfa/github/src/TestGitHub.types.test.ts |
| C12, a text answer: for `texts`, `call` on a `body: "text"` route gives the success Schema's decoding of the raw body, equal by `assert.deepStrictEqual` to `Schema.decodeUnknownSync(success)(body)`; with no `success` it gives `void`; a text that is also JSON is never parsed. 300 runs | test | Effect Arbitrary: texts | decode with `Schema.fromJsonString` on text routes: (b)'s `123` becomes a number, red; trim the body: (a) red; read the body through a hand unescape: (c)'s `\` changes, red; cut the body at 4,096 characters, a fixed limit: (d) red | kalfa/github/src/GitHub.test.ts |
| C13, who a request is sent as: for `senders`, the stand-in's `Request.auth` is `Token` with the given token when `options.token` is given, `None` on an `auth: "none"` route (the cast token too), else `Login`; `Request.accept` is there exactly when the route declared it, equal to it. 200 runs | test | Effect Arbitrary: senders | drop `options.token`: (g)'s token case is `Login`, red; let a token win on an `auth: "none"` route: (g)'s cast case is `Token`, red; fill `accept` with the default in `call`: (h)'s undeclared case has one, red | kalfa/github/src/GitHub.test.ts |
| C14, a 5xx: for `statuses` (e), `call` fails with `GitHubError` whose reason is `ServerError` with the reply's status, and `mayHaveApplied` is `false` for `GET` and `true` for every other method; never a defect. 200 runs | test | Effect Arbitrary: statuses | set `mayHaveApplied: true` always: (e)'s GET red; set it from `method === "POST"`: (e)'s PUT red; leave a 5xx as `Undecodable`: (e) red | kalfa/github/src/GitHub.test.ts |
| C7, other statuses, widened: for `statuses` (f), `call` fails with `Undecodable` answer naming the status, with no cause; a 2xx on a declared route succeeds; a 5xx is no longer here (C14). 200 runs | test | Effect Arbitrary: statuses | read 300 to 399 as `ServerError`: (f) red | kalfa/github/src/GitHub.test.ts |
| C15, a query value a URL cannot carry: for `queryValues`, `call` fails with `Undecodable` input naming the key and holding no value, and the stand-in saw no request; texts, numbers, booleans and lists of them are sent as before (1944's C2). 100 runs | test | Effect Arbitrary: queryValues | delete the value check: (i) reaches the stand-in, red; write the value into the message: (i)'s marker shows in it, red | kalfa/github/src/GitHub.test.ts |
| C6, GitHub's 4xx, widened: 1944's law, and for (j) the `ClientError` holds `message`, `documentationUrl` and `errors` as the text GitHub sent; a body whose `errors` is a number keeps its `message`. 300 runs | test | Effect Arbitrary: errorBodies | read `errors` as a list only: (j) loses its `message`, red; read the body as one Struct, not field by field: the number case loses `message`, red | kalfa/github/src/GitHub.test.ts |
| F1, the fake on a text route: for `texts`, `GitHubTest.answer(Zen, () => text)` replies with `text` as the body, as is, and `call` through `GitHubTest.layer` gives `text` back; a JSON route still gets `JSON.stringify`. 200 runs | test | Effect Arbitrary: texts | write a text route's value with `JSON.stringify`: (b) and (c) come back quoted, red | kalfa/github/src/TestGitHub.test.ts |
| P3, the reasons, widened: `GitHubError`'s reason union is exactly `ClientError`, `ServerError`, `Unavailable` and `Undecodable`; no file under `kalfa/github/src/` but its tests names `Unreachable` | test | scenario: the module's Schema and the package's source at head | leave `Unavailable` out of the union: red; add a reason class named `Unreachable`: red | kalfa/github/src/Package.test.ts |

### Laws, slice 2

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| T17, the live Layer's type: `GitHubLive.layer({ login, settings })` is exactly `Layer<GitHub.GitHub, never, HttpClient.HttpClient>`; `settings.apiUrl` as a plain `string` does not compile, the setting's value does; `new GitHub.Login.Token({ token: "t" })` does not compile, with `Redacted.make("t")` it does; `GitHubSettings.Values` is `{ readonly apiUrl: ApiUrl; readonly pollInterval: PollInterval; readonly redirects: Redirects }` | type | type | type `apiUrl` as `string`: the plain-text line compiles, red; give the Layer `GitHubError` as its error: the `never` line fails, red; type `Token.token` as `string`: its plain-text line compiles, red | kalfa/github/src/GitHubLive.types.test.ts |
| S1, the settings: `apiUrl` is named `github.api-url`, defaults to `https://api.github.com` and has a description; for `apiUrls`, its Schema takes (k) and (l) and refuses each of (m), with a message that holds no part of the text; `pollInterval` is `github.poll-interval`, defaults to `30 seconds`, takes generated lengths of time and refuses `ten`; `redirects` is `github.redirects`, defaults to 20, takes 0 to 20 and refuses -1, 21 and 1.5. 300 runs | test | Effect Arbitrary: apiUrls | check only that the text parses as a URL: (m)'s `http:` passes, red; forget the user check: (m)'s user case passes, red; put the text into the message: (m)'s marker shows, red | kalfa/github/src/Settings.test.ts |
| S2, the start: a group `SettingGroup.make("demo", ...GitHubSettings.all)` on an in-memory file service starts with the defaults; a repo file with `[github]` and `api-url = "http://x.example"` stops the start with that file and line; `DEMO_GITHUB_API_URL` wins over the file | test | scenario: in-memory repo files and environments, through `@kalfa/config`'s `SettingGroup.layer` | declare `apiUrl` with plain `Schema.String`: the `http:` file starts, red | kalfa/github/src/Settings.test.ts |
| H1, what a request carries: over `FetchHttpClient.layer` with a stand-in `fetch` that builds a real `Request` from what it is handed, for `apiUrls` (k) and (l) and `queries`, the URL is the address with one trailing `/` dropped, then the filled path, then `?` and the query exactly when it has a key, each value as `URLSearchParams` writes it and a list as its key repeated; the method is the Request's; the headers are `accept` (declared, else `application/vnd.github+json`), `x-github-api-version` equal to `GitHub.apiVersion` and to `2022-11-28`, `user-agent: kalfa-github`, and `content-type: application/json; charset=utf-8` exactly when a body is sent, whose text is `JSON.stringify` of the Request's body; there is no `traceparent` and no `b3`. 300 runs | test | Effect Arbitrary: queries | join with `new URL(path, apiUrl)`: (l)'s `/api/v3` is lost, red; join by plain concatenation: (k)'s trailing slash makes `//repos`, red; join a list with commas: (o) red; write the query by hand without encoding: (n)'s `&` splits a value, red; send `2026-03-10`: red; leave the client's trace propagation on: `traceparent` is there, red | kalfa/github/src/GitHubLive.test.ts |
| H2, the token goes to one header: for `tokens` (p), `authorization` is `Bearer <token>` for a `Login` and a `Token` request, and absent for `None`; for (q), `call` fails with `Undecodable` input whose message names no part of the token, and the stand-in `fetch` was never called. 300 runs | test | Effect Arbitrary: tokens | delete the `token68` check: (q) reaches the real `Headers`, which fails with the token in its message, red; send `token <value>` in place of `Bearer`: (p) red; send the login's token on a `None` request: red | kalfa/github/src/GitHubLive.test.ts |
| H3, one call's token stays with it: for `crowd`, each request the stand-in saw carries exactly its own call's `options.token`, or the login's when it had none, whatever order the replies come in | test | Effect Arbitrary: crowd | keep the last `options.token` in a variable the Layer shares: (r) red; 200 runs | kalfa/github/src/GitHubLive.test.ts |
| H4, [secrets] the token never shows: for `tokens` (p) and (q), as the login and as `options.token`, and for each outcome (a 2xx, a 4xx, a 5xx, (s), (t), an answer that cannot be read, a refused token, a redirect to another host), no output holds the token's text, its `encodeURIComponent` form, its JSON-escaped form or its base64: every URL the stand-in `fetch` saw; every header of every request to an origin other than the address's; every span's name, attributes and events (recording tracer); every log line at every level (recording logger); `Cause.pretty` of the exit with the cause's stack; `JSON.stringify`, `String` and `Inspectable.format` of the failure; and every text reachable from the failure's own properties, cause chains included. 300 runs | test | Effect Arbitrary: tokens | send the token as `?access_token=`: the URL shows it, red; annotate the span with the `authorization` header: the span shows it, red; keep the whole `HttpClientError` as `Unavailable`'s cause: the walk reaches `request.headers`, red; delete the `token68` check: (q)'s fetch error message shows it, red; log the request at debug level: the log shows it, red; put the token into the refusal's message: red | kalfa/github/src/GitHubLive.test.ts |
| H5, an exchange that failed: for `breaks`, `call` fails with `GitHubError` whose reason is `Unavailable`, never a defect; `mayHaveApplied` is `true` for a write and `false` for a GET in (s) and in (t); the cause is the error the stand-in `fetch` raised, not an `HttpClientError`. 200 runs | test | Effect Arbitrary: breaks | `Effect.orDie` the exchange: (s) dies, red; set `mayHaveApplied: true` always: (s)'s GET red; keep the `HttpClientError` as the cause: the cause's `_tag` check red; read only the status and skip the body's failure: (t) succeeds, red | kalfa/github/src/GitHubLive.test.ts |
| H6, the reply as GitHub sent it: for `replies` (u) and (v), the `Reply`'s status is the stand-in's, its header names are lowercase with their values as `fetch`'s `Headers` gives them, and its body is what `Response.text()` reads, U+FFFD included. 200 runs | test | Effect Arbitrary: replies | keep header names as sent: (u) red; read the body as Latin-1 bytes: (v) red | kalfa/github/src/GitHubLive.test.ts |
| H7, one span: under a recording tracer, each live call ends exactly one span, `github.call`, with 1944's three attributes; no span is named by a method, and no attribute is `url.full`, `url.path` or `url.query`. 100 runs | test | Effect Arbitrary: queries | drop `TracerDisabledWhen`: a second span named `GET` with `url.full` appears, red | kalfa/github/src/GitHubLive.test.ts |
| H8, nothing at build: for `tokens` (p) and (q), building the Layer never fails and the stand-in `fetch` sees no request until the first `call` | test | Effect Arbitrary: tokens | send `GET /user` when the Layer is built: (p) shows a request at build, red; check the token at build: (q) fails the Layer, red; 100 runs | kalfa/github/src/GitHubLive.test.ts |
| H9, a redirect keeps the token on GitHub's origin: for `hops`, every request the stand-in `fetch` is handed carries `redirect: "manual"`, so a real `fetch` never follows by itself; after a hop to another origin, (x) and (z)'s scheme and port cases, the next request has no `authorization`, `proxy-authorization` or `cookie` header; after a hop to the address's own origin, (y), it keeps `authorization: Bearer <token>`; a 303, and a 301 or 302 after a POST, goes on as a GET with no body; a chain longer than `github.redirects` stops, and `call` fails with `Undecodable` answer naming the 3xx; for (x) the token is in no URL and no header the other host got. 300 runs | test | Effect Arbitrary: hops | leave `FetchHttpClient.RequestInit` out: the stand-in is handed `redirect: "follow"`, red; follow by hand and keep every header: (x) sends the token to the other host, red; drop `authorization` on every hop: (y)'s same-origin hop loses it, red; compare the host, not the origin: (z)'s other port keeps it, red; ignore `github.redirects`: (z)'s long chain is followed to its end, red | kalfa/github/src/GitHubLive.test.ts |
| F2, the fake and the live client agree: for `replies` (w), with markers in the answers, `call` through `GitHubTest.layer` and `call` through `GitHubLive.layer` over a stand-in `fetch` that answers as GitHub did give equal exits, for the repo read, `/zen` and the 404. 200 runs | test | Effect Arbitrary: replies | let the fake write `/zen` with `JSON.stringify`: (w)'s `/zen` differs, red; let the live client read a text route through JSON: (w)'s `/zen` fails, red | kalfa/github/src/GitHubLive.test.ts |
| P1, the manifest, widened: `kalfa/github/package.json` has exactly `@kalfa/config` (`workspace:*`) in `dependencies`, `effect` as its one peer, and exports exactly `.`, `./Settings`, `./live`, `./test` and `./package.json`, each with its `dist` pair; no other `@kalfa/` or `@kampus/` package in any field | test | scenario: the package's own manifest at head | leave `./live` out of `publishConfig.exports`: red; add `@kampus/vitest` to the dev dependencies: red | kalfa/github/src/Package.test.ts |
| L5, the imports: `import { Setting } from "@kalfa/config"` passes in `Settings.ts`; it is refused in `GitHub.ts`, `GitHubLive.ts`, `TestGitHub.ts` and `Login.ts`; in `Settings.ts`, `./GitHub.ts`, `effect/http`, `@kalfa/config/App`, `@kalfa/secrets` and `@kampus/vitest` are refused; 1944's L2 and L3 still hold in every source file, `Settings.ts` and `GitHubLive.ts` included | lint | lint | each import in turn, in each file named: lint red each time, then undone; drop `Settings.ts`'s own override: its config import is red | .oxlintrc.json |
| L6, the rank: the `kalfa-github` row sits at layer 2 and imports `kalfa-config`; `pnpm lint:layers` and `pnpm lint:boundaries` pass; `oxlint-plugins/layers.test.ts` pins `"kalfa-github": 2` | lint | lint | leave the row's `imports` empty: `lint:layers` refuses the new edge, red; pin it at 1: the pinned test is red | layer-rules.json, boundary-rules.json, oxlint-plugins/layers.test.ts |
| I1, the real GitHub matches the stand-in: over the real `FetchHttpClient.layer` and the default address, an anonymous read (`auth: "none"`) of `octocat/Hello-World` decodes `id`, `full_name` and `private: false`; an anonymous `/zen` gives a text that is not empty; a read of a missing repo fails with `ClientError` 404 whose `message` is `Not Found` and which has a `documentationUrl`; the reply's `x-github-api-version-selected` is `2022-11-28`. It reads anonymously, once per run, with no token. It first asks `GET /rate_limit`, which GitHub does not count, and skips with the plain reason "GitHub's anonymous limit of 60 an hour is used up for this address; this law did not run" when fewer than 3 core requests are left; a 403 or 429 on a later read whose `message` starts `API rate limit exceeded` skips with the same reason. Any other failure fails | test | vector: octocat/Hello-World, /zen and a missing repo on api.github.com, as read on 2026-11-23 | drop the `user-agent` header: GitHub answers 403 HTML, red; skip on every 403, not only the rate-limit one: the no-`user-agent` 403 skips, red; send `X-GitHub-Api-Version: 2026-13-99`: GitHub answers 400, red | kalfa/github/src/GitHubLive.integration.test.ts |

**Lint, type or test?** T14 to T17 are what the compiler must accept or refuse: type, held by `pnpm typecheck`. L5 and
L6 are shapes of imports and ranks: lint. C, F, H, S, P and I laws are about what a call sends, gives and shows, which no
lint rule or type sees: tests.

**How the token is held out of every message.** 1944's C9 holds that no span and no failure render shows a value of the
input or the answer; `GitHubError` has no `message` and no `cause`. H4 adds the token: it generates tokens, runs every
outcome, and reads every named output, the encoded URL included, with a plant for each leak path. H2 holds the one
place the token goes, and the `token68` check keeps a bad token away from `fetch`'s own messages, which would echo it.

**Where they run.** Every law but I1 runs in memory on every pull request: the stand-in is the real
`FetchHttpClient.layer` with the `FetchHttpClient.Fetch` reference set to a function that builds a real `Request` and
answers a real `Response`. None needs launchd, the real Electron app, a real OS process, a socket or a signal, so none is
host-only and none waits on the owner's Mac. I1 is the one `.integration.` law: it needs the real GitHub, since no
stand-in can say what GitHub really sends (the header it needs, the date it picks, the shape of its 404). The laptop
refuses it by name, so it never runs there. It runs anonymously in the lead's proof run before merge and in main's full
run, with no token in either. When GitHub's anonymous limit is used up for the runner's address, it skips with that
plain reason and never fails. No pull request run and no merge queue run carries it. The pull request says what came
back. The redirect is not left to I1: H9 proves it on the stand-in on every pull request.

## What fact is lost if it is not recorded now

None. The package stores nothing and keeps no log. GitHub's `x-github-request-id`, which GitHub support asks for, is in
the `Reply` headers a caller already gets; an error could carry it later without loss, since errors are not stored.

## Files, slice 1

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/github/src/internal/Check.ts | build | 45 | the `body`, `auth` and `accept` parts of a declaration; a text route's success; `Needs` for a text-only route; `Faked` for a text route; `CallOptions`' parts |
| kalfa/github/src/GitHub.ts | build | 130 | `Route`'s two new type parameters and the fields they type; `Auth`, `QueryValue`, `Request`'s `auth` and `accept`; `CallOptions`; `ServerError`, `Unavailable`; the reason union; `ClientError.errors` as a text too; `call`'s third argument, text reading, 5xx and the query value check, with doc blocks |
| kalfa/github/src/internal/wire.ts | build | 20 | `mayHaveApplied`, `queryValues`, `errorBody` read field by field |
| kalfa/github/src/TestGitHub.ts | build | 20 | a text route answered as is, with its content type; `refuse`'s `errors` as a text |
| kalfa/github/README.md | build | docs | text routes, `auth: "none"`, `accept`, `options.token`, the new reasons and `mayHaveApplied`; the run-time-only list's "not JSON" routes now say `body: "text"` |
| kalfa/github/src/Octokit.test-support.ts | tests | tests | the text routes the laws call (`/zen`, `/octocat`) |
| kalfa/github/src/GitHub.test-support.ts | tests | tests | `texts`, `statuses`, `senders`, `queryValues`, `errorBodies` widened |
| kalfa/github/src/GitHub.test.ts | tests | tests | C12 to C15; C6 and C7 widened |
| kalfa/github/src/GitHub.types.test.ts | tests | tests | T14, T15 |
| kalfa/github/src/TestGitHub.test-support.ts | tests | tests | the text answers F1 draws |
| kalfa/github/src/TestGitHub.test.ts | tests | tests | F1 |
| kalfa/github/src/TestGitHub.types.test.ts | tests | tests | T16 |
| kalfa/github/src/Package.test.ts | tests | tests | P3 widened |

## Files, slice 2

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/github/src/Login.ts | build | 30 | new: `Token`, `Login`, with doc blocks |
| kalfa/github/src/Settings.ts | build | 65 | new: `ApiUrl`, `PollInterval`, `Redirects`, `apiUrl`, `pollInterval`, `redirects`, `all`, `Values` |
| kalfa/github/src/GitHubLive.ts | build | 148 | new: `layer`, the token check, the request, the exchange with no client span and with redirects followed by Effect, not by `fetch`, the reply, the failure mapping |
| kalfa/github/src/GitHub.ts | build | 3 | `export * as Login from "./Login.ts"` |
| kalfa/github/README.md | build | docs | the live Layer, the settings, the token and where it goes, what never shows it, the real read's result; "There is no live Layer yet" goes |
| kalfa/github/package.json | tests | tests | `dependencies: { "@kalfa/config": "workspace:*" }`; the `./Settings` and `./live` exports and their `dist` pairs |
| pnpm-lock.yaml | tests | tests | the `kalfa/github` importer's new link, written by one `pnpm install --offline` |
| kalfa/github/src/GitHubLive.test-support.ts | tests | tests | the stand-in `fetch`, the recording tracer and logger, and slice 2's generators |
| kalfa/github/src/GitHubLive.test.ts | tests | tests | H1 to H9, F2 |
| kalfa/github/src/GitHubLive.types.test.ts | tests | tests | T17 |
| kalfa/github/src/Settings.test.ts | tests | tests | S1, S2 |
| kalfa/github/src/GitHubLive.integration.test.ts | tests | tests | I1 |
| kalfa/github/src/Package.test.ts | tests | tests | P1 widened |
| .oxlintrc.json | tests | tests | L5: `Settings.ts` out of the package override's files and given its own override, which allows `@kalfa/config` and refuses the rest |
| layer-rules.json | tests | tests | L6: `kalfa-github` at layer 2, importing `kalfa-config` |
| boundary-rules.json | tests | tests | L6: `kalfa-github` imports `kalfa-config` |
| oxlint-plugins/layers.test.ts | tests | tests | L6: `"kalfa-github": 2`, with its reason comment |
| package.json | tests | tests | no change: the root manifest already lists `@kalfa/github`; named here because P1 names the package's own `./package.json` export |
| tsconfig.base.json | tests | tests | no change: read for `unstableApiUsage`, which is off for `kalfa/` |

## Existing tools

- `kalfa/github/src/GitHubLive.ts`: searched Effect 4.1.3's `effect/http` (`HttpClient`, `HttpClientRequest.prependUrl`,
  `bearerToken`, `setHeaders`, `UrlParams` through the request's `urlParams`, `HttpClient.TracerDisabledWhen`,
  `HttpClient.followRedirects`, `FetchHttpClient.RequestInit`, `FetchHttpClient.layer`; all used), Effect's ai-docs HttpClient example (its shape, used), and Octokit's
  `@octokit/request` (not used: a second client with its own errors, and the lint keeps every Octokit value import out).
  Searched `effect/http` and `effect/http-api` for a header-value or `token68` check: none, so the check is about five
  lines with a regular expression.
- `kalfa/github/src/Settings.ts`: searched `@kalfa/config`'s root `Setting.make`, `withDefault` and `withDescription`
  (used), its README's address and length-of-time examples (followed), `Schema.URLFromString` and
  `Schema.DurationFromString` (used inside the checks), and `kalfa/quality/src/stryker/Settings.ts` (Effect `Config`
  read from the environment, the older way that README says moves to `@kalfa/config`; not followed).
- `kalfa/github/src/Login.ts`: searched Effect's `Redacted` (used) and `Data.TaggedClass` (used, as `Route` is), and
  `HttpApiSecurity.bearer` (a server's check of an incoming token, not a client's login; not used).
- New functions in files that exist: `wire.mayHaveApplied` and `wire.queryValues` (searched Effect's `HttpMethod` for a
  "is safe" helper: `HttpMethod.hasBody` says whether a body may be sent, not whether the call writes; none fits, so each
  is a few lines); `wire.errorBody` changes in place.

## Lead's calls at signing (2026-11-23)

The lead read the five doubts at the top and ruled on each. The plan above is written to these.

1. **A query list repeats its key:** kept, as the plan has it.
2. **The `User-Agent` is the fixed `kalfa-github`:** kept. It is a name, not a limit, so it is not a setting.
3. **A token a header cannot carry fails as `Undecodable` input:** kept.
4. **No workflow token for main's full run.** What a test step may hold is a security setting, and the owner's. I1 reads
   anonymously, once per run, and skips with a plain reason when GitHub's limit of 60 an hour is used up. It never fails
   on that limit. Its token case is gone.
5. **The token after a redirect is proven, not hoped.** It is the one way this ticket could leak a token. `fetch`
   follows a redirect itself by default, so a stand-in `fetch` would never see the hop. The build turns that off:
   `FetchHttpClient.RequestInit` is `{ redirect: "manual" }` on every exchange, and `HttpClient.followRedirects` follows
   by hand. It drops `authorization`, `proxy-authorization` and `cookie` when the origin changes (read in Effect
   4.1.3's `http/HttpClient.ts`, `followRedirects`). In manual mode Node's `fetch` hands back the real 3xx with its
   `location` (read in undici 8.12.4's `lib/web/fetch/index.js`, the `request.redirect === 'manual'` branch). Law H9
   proves it on the stand-in, with plants for each way it could break. The hop limit is the new setting
   `github.redirects`, default 20 (fetch's own limit), since a limit is a setting.

## Calls taken

Each under 80% is also at the top, under Doubts.

- **Redirects are followed by Effect, not by `fetch`, 85%.** The lead's call 5. The doubt left is a browser: in manual
  mode a browser answers an opaque redirect with status 0 and no `location`, so a redirect there fails as `Undecodable`
  answer instead of being followed (Effect's own docs on `followRedirects` say so). No first caller runs in a browser.
- **`github.redirects` is a setting, default 20, 85%.** A limit is a setting; 20 matches what `fetch` does by itself, so
  turning `fetch`'s following off changes no count.

- **Two slices, `call` first, 85%.** The brief asks for slices under about 300 lines; one would be about 440. Slice 1
  lands whole on its own: callers' tests can use text routes and the new reasons on the fake before the live Layer
  exists.
- **No `github.api-version` setting, 95%.** Decision 0092 rejected a setting for the date and replaced ruling 7's
  default. The header is `GitHub.apiVersion`, which law V1 holds to the types.
- **`github.poll-interval` is declared now, 80%.** The service needs a `poll` value now, ruling 7 named the setting and
  its 30 s default, and a limit is a setting. Ticket 1948 reads it. Leaving it to 1948 would mean a 30 s constant here.
- **The live Layer takes the values, not the group, 85%.** A group's key is its app's name and its settings, which this
  package cannot know; the app yields its group and passes the values. `@kalfa/config`'s README says to decode where a
  value is read.
- **The two settings' values are branded, 80%.** Only a text that passed the check reaches `GitHubLive.layer`, so the
  Layer can make its URL and its duration with no failure of its own.
- **`github.api-url` must be `https:`, with no user, password, query or fragment, 80%.** The token goes to that address,
  so `http:` would send it in the clear, and a user part would be a second secret in a plain setting. A lab GitHub
  Enterprise Server on `http:` is refused; nothing in the plan needs one.
- **`body: "text"` is required on a route GitHub answers only in text, 80%.** Today `/zen` decodes through JSON and
  fails at run time on the real GitHub, which is the bug the ticket's comment names. Making the option required there
  turns that run-time failure into a compile error.
- **A token on an `auth: "none"` route does not compile, 85%.** The ticket says such a route sends no token; a token that
  is silently dropped would hide a caller's mistake.
- **`Request.auth` is a tagged union, `Login`, `None` or `Token`, 80%.** One field says who the request goes as, and a
  `None` with a token cannot be written.
- **The query values are checked in `call`, and `Request.query` is typed by what a URL carries, 80%.** The fake and the
  live client then read the same values, and an object in a query cannot reach the wire as `[object Object]`.
- **`ClientError.errors` takes one text too, and `errorBody` reads field by field, 90%.** The 400 above.
- **`ServerError` has no `tries` field yet, 80%.** Every call is tried once until ticket 1951 adds retries; a field that
  is always 1 says nothing.
- **`mayHaveApplied` is true for every write that left, 80%.** `fetch` cannot tell a refused connection from one cut
  after the request was sent, so a write that got no answer may have run. A request that could not be built never left.
- **`Unavailable`'s cause is the failure under the HTTP client's error, 85%.** The `HttpClientError` holds the request,
  and so the `authorization` header (read in `http/HttpClientError.ts`). The pattern's rule, keep the cause, still holds:
  the cause kept is the one that says what broke.
- **The client span is off, 80%.** Effect's client span carries `url.full`, the filled path and the query, which 1944's
  README keeps out of spans, and it writes `traceparent` and `b3` into requests sent to GitHub. `github.call` already
  times the call.
- **The token is checked against `token68` at each call, never at build.** Doubts, item 3; kept by the lead.
- **The `User-Agent` is the fixed `kalfa-github`.** Doubts, item 2; kept by the lead.
- **A query list repeats its key.** Doubts, item 1; kept by the lead. Whether GitHub reads it so is still untested.
- **`@kalfa/config` is a plain dependency, not a peer, 80%.** `next/packages/libfabrika` takes it the same way, and a
  setting is a plain object read by its fields, so two copies would still join one group.
- **`Login.Token` is a `Data.TaggedClass` holding a `Redacted`, and `Login` is a union of one, 85%.** The ticket names
  `Login.Token`; 1953, 1956 and 1958 add the other members, and the live Layer's type widens with them.
- **I1 reads anonymously and skips on GitHub's limit, 85%.** The lead's call 4. It asks `GET /rate_limit` first, which
  GitHub does not count, so a used-up limit is seen before any read, and a mid-run limit answer is told apart from
  every other 403 by GitHub's own message.
- **No glossary, 90%.** The glossary map says GitHub is not a context, and decision 0050 keeps GitHub's words here. Every
  new name is a code name or GitHub's own word (New names).
- **Is any of this a setting?** The address, the poll interval and the redirect limit are. The date is not (decision 0092). The default
  media type and the version header are GitHub's protocol, the same for every caller. The `User-Agent` could be (Doubts,
  item 2). The `token68` grammar is RFC 6750's. No size, count or length is fixed in code (plant (d) holds that for text).

## Validation

- Slice 1, tests step: the new and widened laws by path, one file at a time, red on the missing parts. The build makes
  them green, then `pnpm format` and `pnpm lint`. The lead's end type check holds T14 to T16.
- Slice 2, tests step: one `pnpm install --offline` for the new workspace link (no new outside package), then
  `Settings.test.ts`, `GitHubLive.test.ts` and `Package.test.ts` by path, and `oxlint-plugins/layers.test.ts`; L5 and L6's
  plants by hand with `pnpm lint`, each undone. The build makes them green, then `pnpm format` and `pnpm lint`. The
  laptop refuses `GitHubLive.integration.test.ts`; nobody runs it there.
- The lead runs `pnpm typecheck` once per slice, and starts the proof run that carries I1 before slice 2 merges. The pull
  request quotes what came back.

## Size

1. Slice 1, a call says everything a route can: 215 lines (`GitHub.ts` 130, `Check.ts` 45, `wire.ts` 20, `TestGitHub.ts`
   20), plus T14 to T16, C12 to C15, C6 and C7 widened, F1, P3 widened and the README.
2. Slice 2, the live Layer and its settings: 246 lines (`GitHubLive.ts` 148, `Settings.ts` 65, `Login.ts` 30,
   `GitHub.ts` 3), plus T17, S1, S2, H1 to H9, F2, I1, P1 widened, L5, L6, the manifest, the lockfile and the README.

461 product lines in all. About 6 agent hours across the two slices, 65% sure. The doubt is slice 1's type work: the
route type grows two parameters, and every type that infers over `Route` (`Input`, `Success`, `Services`, the fake's
`Answered`) must still read its old routes the same, with readable errors. Budget, from 1944's measured basis: slice 1 is
type-level work at about $12 a step, tests, build, review and one likely send-back, 4 steps, $48; slice 2 is plain
Effect code with many laws at about $9 a step, the same 4 steps, $36.

Estimate: 8 steps, $84

## New names

- `body`, `auth`, `accept`, `mayHaveApplied`, `ServerError`, `Unavailable`, `Login`, `Token`, `GitHubLive.layer`,
  `github.api-url`, `github.poll-interval`: the protocol ticket's and this ticket's. `github.redirects`: the lead's call 5.
- `Auth` with `Login`, `None` and `Token`; `QueryValue`; `CallOptions`; `ApiUrl`; `PollInterval`; `Redirects`; `Values`; `all`;
  `queryValues`: code names inside the package, not domain words.
- `token68`: RFC 6750's word. `kalfa-github`: the `User-Agent` text.

No new domain word, so no glossary entry.

## Records

- No `GLOSSARY.md` (above), no pattern doc and no decision. The choices here are cheap to change before callers exist.
- The README records the live Layer, the settings, where the token goes and what never shows it, and the real read's
  result.
- The ticket's acceptance criterion on `github.api-version` is behind decision 0092. The lead can edit the ticket text
  (Findings, item 1).

## What this cannot tell us

- Whether GitHub reads a repeated query key as a list (Doubts, item 1). No first caller sends one.
- How a redirect behaves in a browser: manual mode there gives an opaque answer with no `location`, so it fails as
  `Undecodable` answer. And whether a Worker's `fetch` honors `redirect: "manual"` as Node's does: H9 shows our code
  asks for it, not that every platform obeys.
- How often I1 skips on shared runner addresses. A skip says so in plain words, but a week of skips would mean it
  checks nothing (Doubts, item 4).
- How a caller's tests will want to fake a 5xx or a dropped connection: the fake answers only 2xx and 4xx (Findings).
- What happens to a call whose connection hangs: there is no timeout yet, so it waits until the caller's own limit.
- Whether a search query written with `+` for spaces, as GitHub's docs show, reaches GitHub as spaces: `URLSearchParams`
  sends a `+` as `%2B`. A caller should write spaces. Not tried.
- Whether Node 26 words its bad-header error the same way as Node 22.22.3, where it was read. H4's plant (q) shows it on
  whatever Node CI runs.
- Nothing was type-checked while planning.

## Open questions

None.

Every choice above is decided by a note or taken as a call. The calls under 80% are listed at the top for the lead.

## Findings

1. **The ticket's text names a setting decision 0092 rejected.** Proof: the second acceptance criterion says
   `github.api-version (default 2026-03-10)`, and decision 0092's third considered option rejects a setting for the date.
   The lead can strike that criterion on https://github.com/kamp-us/tea-fabrika/issues/1945.
2. **Node's `fetch` writes a bad header's value into its error message.** Proof: `new Request(url, { headers: {
   authorization: "Bearer abc\ndef" } })` throws `Headers.append: "Bearer abc\ndef" is an invalid header value.` (Node
   22.22.3, read while planning). Any kalfa package that puts a secret in a header (Secrets, CI) needs the same check
   before `fetch` sees it.
3. **Main's full run gives its test step no token.** Proof: the scheduled workflow's test step sets no `GITHUB_TOKEN`;
   only its gate and time-table steps do. The lead ruled this a security setting and the owner's (call 4), so the plan
   changes nothing there, and I1 reads anonymously.
4. **The fake cannot answer a 5xx or a dropped connection.** Proof: `GitHubTest.refuse` takes a `Status4xx` only, and
   `answer` takes a 2xx. A caller's test of `mayHaveApplied` cannot use the fake. A small follow-up ticket could add
   `GitHubTest.fail(op, reason)`.
5. **A `github.user-agent` setting would let each app name itself to GitHub,** as GitHub asks. One line in `Settings.ts`
   and one in `GitHubLive.ts` (Doubts, item 2).
6. **No request timeout exists yet.** Proof: neither 1944's `call` nor this plan's live Layer sets one. Ticket 1951
   (retries) is the place for a `github.timeout` setting.
