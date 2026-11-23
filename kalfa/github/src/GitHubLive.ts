/**
 * The live `GitHub` service: it sends each request to GitHub over Effect's `HttpClient`.
 *
 * **Details**
 *
 * Nothing is checked when the Layer is built. The token is checked when a request is sent, and a request that is turned back
 * (a token a header cannot carry) sends nothing. No client span is made, so no span holds a path or a query, and no trace header
 * goes to GitHub. `fetch` follows no redirect itself: the client follows each by hand, and drops the token, `proxy-authorization`
 * and `cookie` for good once a hop leaves the address's origin, so a token never reaches another host. The token is in no URL, no
 * span, no log line and no error.
 */
import { Effect, Layer, Predicate, Schema } from "effect";
import { FetchHttpClient, type HttpClientError, HttpClient, HttpClientRequest, UrlParams } from "effect/http";
import * as GitHub from "./GitHub.ts";
import * as wire from "./internal/wire.ts";
import type * as Login from "./Login.ts";
import type * as Settings from "./Settings.ts";

// A header cannot carry every text, and Node's `fetch` puts the bad value, the token, in its own error message: so the token is
// checked against RFC 6750's `token68` (letters, digits and - . _ ~ + /, then = padding; not empty) before `fetch` sees it.
const FitsHeader = Schema.is(Schema.Redacted(Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._~+/-]+=*$/u))));

const USER_AGENT = "kalfa-github";

const JSON_UTF8 = "application/json; charset=utf-8";

// The same for every exchange: no client span (it holds the path and the query, and writes trace headers GitHub should not
// get), and `fetch` hands back each redirect, since the client follows it by hand.
const exchange = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
  );

/**
 * The live `GitHub` service, for a login and the app's settings.
 *
 * **When to use**
 *
 * Use to let `call` reach the real GitHub, with the HTTP client the app provides, such as `FetchHttpClient.layer`.
 *
 * **Details**
 *
 * A request that got no answer fails as `Unavailable`, whose cause is what `fetch` raised and never the HTTP client's error,
 * which holds the request's headers. A 3xx past `github.redirects` comes back as the reply.
 *
 * @category layers
 */
export const layer = (options: {
  readonly login: Login.Login;
  readonly settings: Settings.Values;
}): Layer.Layer<GitHub.GitHub, never, HttpClient.HttpClient> =>
  Layer.effect(
    GitHub.GitHub,
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.prependUrl(options.settings.apiUrl)),
        HttpClient.followRedirects(options.settings.redirects),
      );

      const send = Effect.fnUntraced(function* (request: GitHub.Request) {
        const undecodable = (message: string) =>
          new GitHub.GitHubError({
            operation: request.route,
            reason: new GitHub.Undecodable({ side: "input", message }),
          });

        const token = GitHub.Auth.$match(request.auth, {
          Login: () => options.login.token,
          Token: (given) => given.token,
          None: () => undefined,
        });

        if (token !== undefined && !FitsHeader(token)) {
          return yield* undecodable("the token is not RFC 6750 token68 text, so no header can carry it");
        }

        const built = HttpClientRequest.make(request.method)(request.path, {
          urlParams: UrlParams.fromInput(request.query),
          headers: {
            accept: request.accept ?? "application/vnd.github+json",
            "x-github-api-version": GitHub.apiVersion,
            "user-agent": USER_AGENT,
          },
        }).pipe(
          token === undefined ? (self) => self : HttpClientRequest.bearerToken(token),
          request.body === undefined
            ? (self) => self
            : HttpClientRequest.bodyText(JSON.stringify(request.body), JSON_UTF8),
        );

        // What the exchange failed with: the error under the client's own, which holds the request and so its headers.
        const unavailable = (error: HttpClientError.HttpClientError) =>
          new GitHub.GitHubError({
            operation: request.route,
            reason: new GitHub.Unavailable({
              // A request that could not be built never left; any other failure may have been carried out.
              mayHaveApplied: wire.mayHaveApplied(
                request.method,
                !Predicate.isTagged(error.reason, "EncodeError") &&
                  !Predicate.isTagged(error.reason, "InvalidUrlError"),
              ),
              cause: error.reason.cause ?? error.reason._tag,
            }),
          });

        const response = yield* exchange(client.execute(built)).pipe(Effect.mapError(unavailable));
        const body = yield* response.text.pipe(Effect.mapError(unavailable));

        return { status: response.status, headers: response.headers, body } satisfies GitHub.Reply;
      });

      return { send, poll: Schema.decodeSync(Schema.DurationFromString)(options.settings.pollInterval) };
    }),
  );
