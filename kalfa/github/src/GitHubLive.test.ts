// The live Layer of ticket 1945's second slice, `GitHubLive.layer`, over the real `FetchHttpClient.layer` with a stand-in for
// `fetch` (GitHubLive.test-support.ts): H1 to H9, and F3. Everything runs in memory: the stand-in makes a real `Request` and
// answers a real `Response`, so no socket opens and no law needs the network. The real GitHub is I1's, in
// GitHubLive.integration.test.ts. The settings are in Settings.test.ts and the types in GitHubLive.types.test.ts.
import { assert, describe, expect, it } from "@effect/vitest";
import {
  Arbitrary,
  Cause,
  Effect,
  Exit,
  Inspectable,
  Layer,
  Logger,
  Option,
  Predicate,
  Redacted,
  References,
  Schema,
  Tracer,
} from "effect";
import { FetchHttpClient } from "effect/http";
import {
  between,
  CreateIssue,
  failure,
  GetRepo,
  ListCheckRuns,
  reachable,
  reasonHeld,
  SEED,
  spanText,
  tokenForms,
  word,
  Zen,
} from "./GitHub.test-support.ts";
import * as GitHub from "./GitHub.ts";
import {
  addresses,
  badTokens,
  bodyClasses,
  goodAddresses,
  goodTokens,
  host,
  pick,
  queryClasses,
  queryString,
  queryText,
  liveSettings,
  makeRequest,
  reply,
  send,
  showsAny,
} from "./GitHubLive.test-support.ts";
import * as GitHubLive from "./GitHubLive.ts";
import * as GitHubTest from "./TestGitHub.ts";

// ---- the stand-in for `fetch`

/** What the stand-in `fetch` was handed for one request, read back from the real `Request` it made. */
interface Seen {
  readonly url: string;
  readonly method: string;
  /** Each header by its lowercase name, as a real `Request` holds them. */
  readonly headers: Readonly<Record<string, string>>;
  /** How the request said a redirect is followed: `fetch` follows by itself unless it is `manual`. */
  readonly redirect: string;
  readonly body: string | undefined;
}

/** What the stand-in answers for a request: a `Response`, or a throw or a rejection, which `fetch` does for a failed exchange. */
type Script = (seen: Seen, index: number) => Response | Promise<Response>;

/** A `fetch` that makes a real `Request`, records it, and answers as `script` says, with every request it saw. */
const standIn = (script: Script) => {
  const seen: Array<Seen> = [];

  const fetch: typeof globalThis.fetch = async (input, init) => {
    // As the real `fetch` does first: a header value it cannot carry throws here, and the message holds the value.
    const request = new Request(input, init);
    const body = request.body === null ? undefined : await request.text();

    const entry: Seen = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      redirect: request.redirect,
      body,
    };

    seen.push(entry);

    return script(entry, seen.length - 1);
  };

  return { fetch, seen };
};

// ---- running a program over the live Layer

/** What one run did: how it ended, what the stand-in `fetch` saw, every span it made and every log line it wrote. */
interface Run<A, E> {
  readonly exit: Exit.Exit<A, E>;
  readonly seen: ReadonlyArray<Seen>;
  readonly spans: ReadonlyArray<Tracer.Span>;
  readonly logs: ReadonlyArray<string>;
}

/** What a run over the live Layer takes: the login's token, the address, and how many redirects one call follows. */
interface Options {
  readonly login: string;
  readonly apiUrl?: string;
  readonly redirects?: number;
}

/** The live Layer over the real `FetchHttpClient.layer`, for a login's token and the settings. */
const liveLayer = (options: Options) =>
  GitHubLive.layer({
    login: new GitHub.Login.Token({ token: Redacted.make(options.login) }),
    settings: liveSettings(options),
  }).pipe(Layer.provide(FetchHttpClient.layer));

/** Runs `program` over the live Layer on the stand-in `fetch`, under a recording tracer and a recording logger at every level. */
const through = <A, E>(
  program: Effect.Effect<A, E, GitHub.GitHub>,
  options: Options,
  script: Script,
): Effect.Effect<Run<A, E>> =>
  Effect.gen(function* () {
    const stand = standIn(script);
    const spans: Array<Tracer.Span> = [];
    const logs: Array<string> = [];

    const delegate = yield* Tracer.Tracer;

    const tracer = Tracer.make({
      span(spanOptions) {
        const span = delegate.span(spanOptions);
        spans.push(span);

        return span;
      },
    });

    const logger = Logger.map(Logger.formatStructured, (entry) => {
      logs.push(JSON.stringify(entry));
    });

    const exit = yield* program.pipe(
      Effect.provide(liveLayer(options)),
      Effect.provideService(FetchHttpClient.Fetch, stand.fetch),
      Effect.withTracer(tracer),
      Effect.provide(Logger.layer([logger])),
      Effect.provideService(References.MinimumLogLevel, "All"),
      Effect.exit,
    );

    return { exit, seen: stand.seen, spans, logs };
  });

const API_VERSION = "2022-11-28";

const REPO_JSON = { id: 1296269, full_name: "o/r", private: false };

const ZEN_TEXT = "Approachable is better than simple.";

/** A path as `call` writes it: a filled `{owner}` and `{repo}`, each percent-encoded. */
const repoPath = (owner: string, repo: string): string =>
  `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

const originFrom = (url: string): string => new URL(url).origin;

const drawn1 = Arbitrary.all({
  address: addresses,
  one: queryText,
  two: word,
  count: between(1, 9000),
  owner: word,
  repo: word,
});

// H1, what a request carries. Plant: join with `new URL(path, apiUrl)` (l's prefix is lost); join by plain concatenation (k's trailing
// slash writes `//repos`); join a list with commas (o); write the query by hand with no encoding (n's `&` splits a value); send
// `2026-03-10`; leave the client's trace propagation on (a `traceparent` shows).
describe("H1, what a request carries", () => {
  it.effect.prop(
    "over the real fetch client, the URL is the address with one trailing slash dropped, the filled path, then the query as URLSearchParams writes it, a list as its key repeated; the headers are accept, the API date, a fixed user agent, the token, and a JSON content type exactly when a body goes, whose text is the Request's body as JSON; no trace header",
    { drawn: drawn1 },
    ({ drawn }) =>
      Effect.gen(function* () {
        const token = goodTokens(drawn.owner, drawn.count)[0]?.token ?? "";

        for (const address of goodAddresses(drawn.address.host, drawn.address.port)) {
          const base = address.value.endsWith("/") ? address.value.slice(0, -1) : address.value;
          const path = repoPath(drawn.owner, drawn.repo);

          for (const [index, each] of queryClasses(drawn.one, drawn.two, drawn.count).entries()) {
            const accept = index % 2 === 0 ? undefined : "application/vnd.github.raw+json";

            const request = makeRequest({
              method: "GET",
              path,
              query: each.query,
              auth: GitHub.Auth.Login(),
              ...(accept === undefined ? {} : { accept }),
            });

            // Under a caller's span, so a client that propagates a trace has one to propagate.
            const run = yield* through(
              send(request).pipe(Effect.withSpan("caller")),
              { login: token, apiUrl: address.value },
              () => reply("{}"),
            );

            const label = `${address.name}, ${each.name}`;
            const qs = queryString(each.query);
            const seen = run.seen[0];

            expect(Exit.isSuccess(run.exit), label).toBe(true);
            expect(run.seen, label).toHaveLength(1);
            expect(seen?.method, label).toBe("GET");
            expect(seen?.url, label).toBe(new URL(`${base}${path}${qs === "" ? "" : `?${qs}`}`).href);
            expect(seen?.body, `${label}: no body`).toBeUndefined();

            assert.deepStrictEqual(
              seen?.headers,
              {
                accept: accept ?? "application/vnd.github+json",
                "x-github-api-version": API_VERSION,
                "user-agent": "kalfa-github",
                authorization: `Bearer ${token}`,
              },
              label,
            );
          }

          for (const each of bodyClasses(drawn.one, drawn.count)) {
            const run = yield* through(
              send(
                makeRequest({
                  method: "POST",
                  path: `${repoPath(drawn.owner, drawn.repo)}/issues`,
                  body: each.body,
                  auth: GitHub.Auth.Login(),
                  route: "POST /repos/{owner}/{repo}/issues",
                }),
              ).pipe(Effect.withSpan("caller")),
              { login: token, apiUrl: address.value },
              () => reply("{}", 201),
            );

            const label = `${address.name}, ${each.name}`;
            const seen = run.seen[0];

            expect(Exit.isSuccess(run.exit), label).toBe(true);
            expect(seen?.method, label).toBe("POST");
            expect(seen?.body, label).toBe(JSON.stringify(each.body));

            assert.deepStrictEqual(
              seen?.headers,
              {
                accept: "application/vnd.github+json",
                "x-github-api-version": API_VERSION,
                "user-agent": "kalfa-github",
                authorization: `Bearer ${token}`,
                "content-type": "application/json; charset=utf-8",
              },
              label,
            );
          }
        }

        expect(GitHub.apiVersion).toBe(API_VERSION);
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

const drawn2 = Arbitrary.all({ marker: word, other: word, length: between(0, 100000) });

// H2, the token goes to one header. Plant: delete the `token68` check (q reaches the real `Headers`, which fails with the token in its
// message); send `token <value>` in place of `Bearer`; send the login's token on a `None` request.
describe("H2, the token goes to one header", () => {
  it.effect.prop(
    "authorization is Bearer and the token for a Login and a Token request and absent for None; a token a header cannot carry fails as Undecodable input whose message names no part of it, and fetch was never called",
    { drawn: drawn2 },
    ({ drawn }) =>
      Effect.gen(function* () {
        const bad = badTokens(drawn.marker);
        const good = goodTokens(drawn.marker, drawn.length);
        const login = goodTokens(drawn.other, drawn.length)[0]?.token ?? "";
        const path = repoPath("o", "r");

        for (const each of good) {
          const asLogin = yield* through(
            send(makeRequest({ method: "GET", path, auth: GitHub.Auth.Login() })),
            { login: each.token },
            () => reply("{}"),
          );

          expect(Exit.isSuccess(asLogin.exit), `${each.name}: as the login`).toBe(true);
          expect(asLogin.seen[0]?.headers.authorization, `${each.name}: as the login`).toBe(`Bearer ${each.token}`);

          const asToken = yield* through(
            send(makeRequest({ method: "GET", path, auth: GitHub.Auth.Token({ token: Redacted.make(each.token) }) })),
            { login },
            () => reply("{}"),
          );

          expect(asToken.seen[0]?.headers.authorization, `${each.name}: as the call's own`).toBe(
            `Bearer ${each.token}`,
          );

          const none = yield* through(
            send(makeRequest({ method: "GET", path, auth: GitHub.Auth.None() })),
            { login: each.token },
            () => reply("{}"),
          );

          expect(none.seen, `${each.name}: nobody`).toHaveLength(1);
          expect(Object.hasOwn(none.seen[0]?.headers ?? {}, "authorization"), `${each.name}: nobody`).toBe(false);
        }

        for (const each of bad) {
          const forms = tokenForms(each.token);

          for (const way of ["the login", "the call's own"] as const) {
            const run = yield* through(
              send(
                makeRequest({
                  method: "GET",
                  path,
                  auth:
                    way === "the login" ? GitHub.Auth.Login() : GitHub.Auth.Token({ token: Redacted.make(each.token) }),
                }),
              ),
              { login: way === "the login" ? each.token : login },
              () => reply("{}"),
            );

            const found = reasonHeld(run.exit);
            const label = `${each.name}, as ${way}`;

            expect(found?.reason._tag, label).toBe("Undecodable");

            if (found?.reason._tag === "Undecodable") {
              expect(found.reason.side, label).toBe("input");
              expect(showsAny([found.reason.message, found.operation], forms), `${label}: the message`).toEqual([]);
            }

            expect(run.seen, `${label}: fetch was never called`).toHaveLength(0);
          }

          // A request that sends nobody never reads the login's token, so a login nobody checked is no matter to it.
          const none = yield* through(
            send(makeRequest({ method: "GET", path, auth: GitHub.Auth.None() })),
            { login: each.token },
            () => reply("{}"),
          );

          expect(Exit.isSuccess(none.exit), `${each.name}: nobody`).toBe(true);
          expect(none.seen, `${each.name}: nobody`).toHaveLength(1);
        }
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

const drawn3 = Arbitrary.all({
  marker: word,
  count: between(2, 20),
  keys: Arbitrary.array(between(0, 100000), { minLength: 20, maxLength: 20 }),
  has: Arbitrary.array(pick([true, false]), { minLength: 20, maxLength: 20 }),
});

// H3, one call's token stays with it. Plant: keep the last `options.token` in a variable the Layer shares (a call that overlaps
// another sends the other's token).
describe("H3, one call's token stays with it", () => {
  it.effect.prop(
    "each request the stand-in saw carries exactly its own call's token, or the login's when it had none, whatever order the replies come in, and each call gets its own answer",
    { drawn: drawn3 },
    ({ drawn }) =>
      Effect.gen(function* () {
        const ids = Array.from({ length: drawn.count }, (_, id) => id);
        const login = goodTokens(`l${drawn.marker}`, 1)[0]?.token ?? "";

        const own = (id: number): string | undefined =>
          drawn.has[id] === true ? goodTokens(`${id}x${drawn.marker}`, id)[(id + 1) % 6]?.token : undefined;

        // The replies are held back until every call has sent, then let go one at a time in the drawn order.
        const gates = ids.map(() => {
          let resolve: () => void = () => undefined;

          const promise = new Promise<void>((done) => {
            resolve = done;
          });

          return { promise, resolve };
        });

        let arrived = 0;

        const release = async () => {
          const order = ids.toSorted((a, b) => (drawn.keys[a] ?? 0) - (drawn.keys[b] ?? 0) || a - b);

          for (const id of order) {
            gates[id]?.resolve();
            await new Promise<void>((done) => setTimeout(done, 0));
          }
        };

        const run = yield* through(
          Effect.forEach(
            ids,
            (id) =>
              GitHub.call(
                GetRepo,
                { params: { owner: `o${id}`, repo: "r" } },
                own(id) === undefined ? undefined : { token: Redacted.make(own(id) ?? "") },
              ),
            { concurrency: "unbounded" },
          ),
          { login },
          async (seen) => {
            const id = Number(/\/repos\/o(\d+)\/r$/u.exec(new URL(seen.url).pathname)?.[1]);

            arrived += 1;

            if (arrived === ids.length) {
              void release();
            }

            await gates[id]?.promise;

            return reply(JSON.stringify({ id, full_name: `o${id}/r`, private: false }));
          },
        );

        expect(run.seen).toHaveLength(ids.length);

        for (const seen of run.seen) {
          const id = Number(/\/repos\/o(\d+)\/r$/u.exec(new URL(seen.url).pathname)?.[1]);

          expect(seen.headers.authorization, `call ${id}`).toBe(`Bearer ${own(id) ?? login}`);
        }

        if (Exit.isSuccess(run.exit)) {
          assert.deepStrictEqual(
            run.exit.value.map((repo) => repo.id),
            ids,
          );
        } else {
          assert.fail("the calls failed");
        }
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

const drawn4 = Arbitrary.all({
  marker: word,
  other: host,
  host,
  length: between(0, 100000),
  secret: word,
});

/** A body that fails after its status came. */
const failingBody = (error: Error): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":'));
        controller.error(error);
      },
    }),
    { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
  );

/** Every text a run can show: what the stand-in saw as URLs and as other hosts' headers, spans, logs, and the failure rendered. */
const shownBy = <A, E>(
  run: {
    readonly exit: Exit.Exit<A, E>;
    readonly seen: ReadonlyArray<{ readonly url: string; readonly headers: Readonly<Record<string, string>> }>;
    readonly spans: ReadonlyArray<Tracer.Span>;
    readonly logs: ReadonlyArray<string>;
  },
  origin: string,
): ReadonlyArray<string> => {
  const shown: Array<string> = [
    ...run.seen.map(({ url }) => url),
    ...run.seen
      .filter(({ url }) => originFrom(url) !== origin)
      .flatMap(({ headers }) => Object.entries(headers).flatMap(([name, value]) => [name, value])),
    ...run.spans.map(spanText),
    ...run.logs,
  ];

  if (Exit.isFailure(run.exit)) {
    for (const error of Cause.prettyErrors(run.exit.cause, { includeCauseInStack: true })) {
      shown.push(error.name, error.message, error.stack ?? "");
    }

    shown.push(Cause.pretty(run.exit.cause), ...Cause.prettyErrors(run.exit.cause).map(String));

    const held = Option.getOrUndefined(Cause.findErrorOption(run.exit.cause));

    if (Predicate.isObject(held)) {
      shown.push(String(held), Inspectable.toStringUnknown(held), JSON.stringify(held), ...reachable(held));
    }
  }

  return shown;
};

// H4 [secrets], the token never shows. Plant: send the token as `?access_token=`; annotate the span with the `authorization` header; keep
// the whole `HttpClientError` as `Unavailable`'s cause (the walk reaches `request.headers`); delete the `token68` check (q's fetch
// error shows it); log the request at debug level; put the token into the refusal's message.
describe("H4, the token never shows", () => {
  it.effect.prop(
    "for each outcome, as the login and as the call's own token, no URL the stand-in saw, no header of another host, no span, no log line, no rendering of the failure and no text it holds shows the token, its percent-encoding, its JSON form or its base64",
    { drawn: drawn4 },
    ({ drawn }) =>
      Effect.gen(function* () {
        const address = `https://${drawn.host}`;
        const params = { owner: "o", repo: "r" } as const;
        const raised = new TypeError(`fetch failed ${drawn.marker}`);
        const broken = new TypeError(`terminated ${drawn.marker}`);

        const outcomes: ReadonlyArray<{
          readonly name: string;
          readonly script: (url: string, index: number) => Response | Promise<Response>;
        }> = [
          { name: "a 2xx", script: () => reply(JSON.stringify(REPO_JSON)) },
          { name: "a 4xx", script: () => reply(JSON.stringify({ message: "Not Found", errors: "gone" }), 404) },
          { name: "a 5xx", script: () => reply("{}", 502) },
          { name: "fetch rejects", script: () => Promise.reject(raised) },
          { name: "the body fails", script: () => failingBody(broken) },
          { name: "an answer that cannot be read", script: () => reply("not json") },
          {
            name: "a redirect to another host",
            script: (_, index) =>
              index === 0
                ? reply(null, 302, { location: `https://${drawn.other}/logs/${drawn.marker}` })
                : reply(JSON.stringify(REPO_JSON)),
          },
          {
            name: "a redirect and a failure there",
            script: (_, index) =>
              index === 0 ? reply(null, 307, { location: `https://${drawn.other}/logs` }) : Promise.reject(raised),
          },
        ];

        for (const each of [...goodTokens(drawn.secret, drawn.length), ...badTokens(drawn.secret)]) {
          const forms = tokenForms(each.token);

          for (const way of ["the login", "the call's own"] as const) {
            for (const outcome of outcomes) {
              const run = yield* through(
                GitHub.call(
                  GetRepo,
                  { params },
                  way === "the login" ? undefined : { token: Redacted.make(each.token) },
                ),
                { login: way === "the login" ? each.token : "ghp_loginnotthistoken", apiUrl: address },
                (seen, index) => outcome.script(seen.url, index),
              );

              const label = `${each.name}, as ${way}, ${outcome.name}`;

              expect(showsAny(shownBy(run, address), forms), label).toEqual([]);
            }
          }
        }
      }),
    { arbitrary: { seed: SEED, runs: 60 } },
  );
});

const drawn5 = Arbitrary.all({ marker: word, host });

const METHODS = ["GET", "PUT", "POST", "PATCH", "DELETE"] as const;

// H5, an exchange that failed. Plant: `Effect.orDie` the exchange (fetch's rejection is a defect); set `mayHaveApplied` true always (the GET
// fails); keep the `HttpClientError` as the cause; read only the status and skip the body's failure (the body that fails is a success).
describe("H5, an exchange that failed", () => {
  it.effect.prop(
    "when fetch rejects, or the body fails after the status came, the call fails with Unavailable, never a defect; mayHaveApplied is true for a write and false for a GET; the cause is the error fetch raised, never an HttpClientError",
    { drawn: drawn5 },
    ({ drawn }) =>
      Effect.gen(function* () {
        for (const method of METHODS) {
          const raised = new TypeError(`fetch failed ${drawn.marker}`);
          const broken = new TypeError(`terminated ${drawn.marker}`);

          const ways: ReadonlyArray<{
            readonly name: string;
            readonly raised: Error;
            readonly script: () => Response | Promise<Response>;
          }> = [
            { name: "fetch rejects", raised, script: () => Promise.reject(raised) },
            { name: "the body fails", raised: broken, script: () => failingBody(broken) },
          ];

          for (const way of ways) {
            const run = yield* through(
              send(makeRequest({ method, path: repoPath("o", "r"), auth: GitHub.Auth.Login() })),
              { login: "ghp_login", apiUrl: `https://${drawn.host}` },
              way.script,
            );

            const label = `${method}, ${way.name}`;
            const found = reasonHeld(run.exit);

            expect(Exit.isFailure(run.exit) && !Cause.hasDies(run.exit.cause), `${label}: never a defect`).toBe(true);
            expect(found?.reason._tag, label).toBe("Unavailable");

            if (found?.reason._tag === "Unavailable") {
              expect(found.reason.mayHaveApplied, label).toBe(method !== "GET");
              expect(Predicate.isTagged(found.reason.cause, "HttpClientError"), `${label}: no HttpClientError`).toBe(
                false,
              );
              const cause = found.reason.cause;

              expect(Predicate.isError(cause) ? cause.message : String(cause), `${label}: what fetch raised`).toContain(
                drawn.marker,
              );
            }
          }
        }
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

const drawn6 = Arbitrary.all({ marker: word, host, length: between(1, 300) });

// H6, the reply as GitHub sent it. Plant: keep the header names as sent (u); read the body as Latin-1 bytes (v).
describe("H6, the reply as GitHub sent it", () => {
  it.effect.prop(
    "the Reply's status is the stand-in's, its header names are lowercase with the values fetch's Headers gives, and its body is what Response.text reads, replacement marks included",
    { drawn: drawn6 },
    ({ drawn }) =>
      Effect.gen(function* () {
        const bytes: ReadonlyArray<{ readonly name: string; readonly body: Uint8Array<ArrayBuffer> }> = [
          { name: "v: ASCII", body: new TextEncoder().encode(drawn.marker) },
          {
            name: "v: not UTF-8",
            body: Uint8Array.from([0xff, 0xfe, 0x80, ...new TextEncoder().encode(drawn.marker), 0xc3]),
          },
          {
            name: "v: a byte order mark",
            body: Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(drawn.marker)]),
          },
          { name: "v: past ASCII", body: new TextEncoder().encode(`é设😀${drawn.marker}`) },
          { name: "v: long", body: new TextEncoder().encode(drawn.marker.repeat(drawn.length)) },
        ];

        // A header value is Latin-1 at most, so the drawn word goes in as its percent-encoding.
        const mark = encodeURIComponent(drawn.marker);

        const headers: ReadonlyArray<{ readonly name: string; readonly init: Array<[string, string]> }> = [
          {
            name: "u: mixed case",
            init: [
              ["Content-Type", "application/json; charset=utf-8"],
              ["X-GitHub-Request-Id", mark],
              ["ETag", `"${mark}"`],
            ],
          },
          {
            name: "u: sent twice",
            init: [
              ["X-Dup", "a"],
              ["x-dup", mark],
              ["Link", '<https://x.test/1>; rel="next"'],
            ],
          },
          { name: "u: none", init: [] },
        ];

        for (const status of [200, 404, 422, 500]) {
          for (const each of bytes) {
            for (const header of headers) {
              const make = () => new Response(each.body, { status, headers: header.init });
              const expected = make();
              // Response.text() is UTF-8 decode: the byte order mark goes, and a byte that is no UTF-8 reads as U+FFFD.
              const expectedBody = new TextDecoder().decode(each.body);

              const run = yield* through(
                send(makeRequest({ method: "GET", path: repoPath("o", "r"), auth: GitHub.Auth.None() })),
                { login: "ghp_login", apiUrl: `https://${drawn.host}` },
                () => make(),
              );

              const label = `${status}, ${each.name}, ${header.name}`;

              const got = Exit.isSuccess(run.exit) ? run.exit.value : undefined;

              expect(got?.status, label).toBe(status);
              assert.deepStrictEqual(got?.headers, Object.fromEntries(expected.headers), label);
              expect(got?.body, label).toBe(expectedBody);
            }
          }
        }
      }),
    { arbitrary: { seed: SEED, runs: 40 } },
  );
});

const drawn7 = Arbitrary.all({ marker: word, host, one: queryText, count: between(1, 100) });

// H7, one span. Plant: drop `TracerDisabledWhen` (a second span, named `GET`, holds `url.full`).
describe("H7, one span", () => {
  it.effect.prop(
    "under a recording tracer, a live call ends exactly one span, github.call, with the three attributes of 1944; no span is named by a method and no attribute is url.full, url.path or url.query",
    { drawn: drawn7 },
    ({ drawn }) =>
      Effect.gen(function* () {
        const params = { owner: drawn.marker, repo: "r", ref: "main" } as const;

        const answers = {
          repo: () => reply(JSON.stringify(REPO_JSON)),
          runs: () => reply(JSON.stringify({ check_runs: [] })),
          missing: () => reply(JSON.stringify({ message: "Not Found" }), 404),
          zen: () => reply(ZEN_TEXT, 200, { "content-type": "text/plain;charset=utf-8" }),
        };

        const calls: ReadonlyArray<{
          readonly name: string;
          readonly program: Effect.Effect<unknown, unknown, GitHub.GitHub>;
          readonly answer: () => Response;
        }> = [
          {
            name: "a read",
            program: GitHub.call(GetRepo, { params: { owner: drawn.marker, repo: "r" } }),
            answer: answers.repo,
          },
          {
            name: "a read with a query",
            program: GitHub.call(ListCheckRuns, { params, query: { per_page: drawn.count, check_name: drawn.one } }),
            answer: answers.runs,
          },
          {
            name: "a 404",
            program: GitHub.call(GetRepo, { params: { owner: drawn.marker, repo: "r" } }),
            answer: answers.missing,
          },
          { name: "a text route", program: GitHub.call(Zen, {}), answer: answers.zen },
        ];

        for (const each of calls) {
          const run = yield* through(each.program, { login: "ghp_login", apiUrl: `https://${drawn.host}` }, () =>
            each.answer(),
          );

          expect(
            run.spans.map(({ name }) => name),
            each.name,
          ).toEqual(["github.call"]);

          const only = run.spans[0];
          const keys = [...(only?.attributes.keys() ?? [])];

          expect(keys.toSorted(), each.name).toEqual(
            ["http.request.method", "http.response.status_code", "kalfa.github.operation"].toSorted(),
          );

          for (const key of ["url.full", "url.path", "url.query"]) {
            expect(keys, `${each.name}: ${key}`).not.toContain(key);
          }

          for (const method of METHODS) {
            expect(
              run.spans.map(({ name }) => name),
              each.name,
            ).not.toContain(method);
          }
        }
      }),
    { arbitrary: { seed: SEED, runs: 60 } },
  );
});

const drawn8 = Arbitrary.all({ marker: word, host, length: between(0, 100000) });

// H8, nothing at build. Plant: send `GET /user` when the Layer is built (p shows a request at build); check the token at build (q fails the
// Layer).
describe("H8, nothing at build", () => {
  it.effect.prop(
    "building the Layer never fails, whatever the login's token, and the stand-in fetch sees no request until the first call",
    { drawn: drawn8 },
    ({ drawn }) =>
      Effect.gen(function* () {
        for (const each of [...goodTokens(drawn.marker, drawn.length), ...badTokens(drawn.marker)]) {
          const built = yield* through(Effect.void, { login: each.token, apiUrl: `https://${drawn.host}` }, () =>
            reply("{}"),
          );

          expect(Exit.isSuccess(built.exit), `${each.name}: the Layer builds`).toBe(true);
          expect(built.seen, `${each.name}: no request at build`).toHaveLength(0);
        }

        const first = yield* through(
          GitHub.call(GetRepo, { params: { owner: "o", repo: "r" } }),
          { login: goodTokens(drawn.marker, 1)[0]?.token ?? "", apiUrl: `https://${drawn.host}` },
          () => reply(JSON.stringify(REPO_JSON)),
        );

        expect(first.seen, "the first call sends").toHaveLength(1);
      }),
    { arbitrary: { seed: SEED, runs: 60 } },
  );
});

/** How a hop names its target. */
const KINDS = [
  "other host",
  "own origin, relative",
  "own origin, full",
  "same host, other scheme",
  "same host, other port",
] as const;

const STATUSES = [301, 302, 303, 307, 308] as const;

const hop = Arbitrary.all({ status: pick(STATUSES), kind: pick(KINDS), segment: word });

const drawn9 = Arbitrary.all({
  address: addresses,
  chain: Arbitrary.array(hop, { minLength: 2, maxLength: 9 }),
  limit: between(0, 7),
  secret: word,
  post: pick([true, false]),
  length: between(0, 100000),
});

interface Hop {
  readonly status: (typeof STATUSES)[number];
  readonly kind: (typeof KINDS)[number];
  readonly segment: string;
}

/** What a chain of hops sends, by an independent reading of the Fetch standard's rules: where each request goes, with what. */
const trail = (
  start: string,
  method: string,
  hasBody: boolean,
  chain: ReadonlyArray<Hop>,
  names: { readonly other: string; readonly port: number },
) => {
  const urls = [start];
  const methods = [method];
  const bodies = [hasBody];
  const keeps = [true];
  const locations: Array<string> = [];

  for (const [index, each] of chain.entries()) {
    const current = new URL(urls[index] ?? start);
    const segment = encodeURIComponent(each.segment);

    const locationOfKind: Record<(typeof KINDS)[number], string> = {
      "other host": `https://${names.other}/log/${index}/${segment}`,
      "own origin, relative": `/rel/${index}/${segment}`,
      "own origin, full": `${new URL(start).origin}/full/${index}/${segment}`,
      "same host, other scheme": `http://${new URL(start).host}/scheme/${index}/${segment}`,
      "same host, other port": `https://${new URL(start).hostname}:${names.port}/port/${index}/${segment}`,
    };

    const location = locationOfKind[each.kind];

    locations.push(location);

    const next = new URL(location, current);

    const asGet =
      (each.status === 303 && !["GET", "HEAD"].includes(methods[index] ?? "")) ||
      ((each.status === 301 || each.status === 302) && methods[index] === "POST");

    urls.push(next.href);
    methods.push(asGet ? "GET" : (methods[index] ?? method));
    bodies.push(asGet ? false : (bodies[index] ?? false));
    keeps.push((keeps[index] ?? false) && next.origin === current.origin);
  }

  return { urls, methods, bodies, keeps, locations };
};

// H9, a redirect keeps the token on GitHub's origin. Plant: leave `FetchHttpClient.RequestInit` out (the stand-in is handed `redirect:
// "follow"`); follow by hand and keep every header (x sends the token to the other host); drop `authorization` on every hop (y's
// same-origin hop loses it); compare the host, not the origin (z's other port keeps it); ignore `github.redirects` (a long chain is
// followed to its end); re-add `authorization` when a later hop returns to the address's origin (a chain that left and came back).
describe("H9, a redirect keeps the token on GitHub's origin", () => {
  it.effect.prop(
    "every request carries redirect: manual; a request to another origin, host, scheme or port, carries no authorization, proxy-authorization or cookie, and one that has stayed on the address's origin keeps its token; a 303, and a 301 or 302 after a POST, goes on as a GET with no body, and a 307 or 308 keeps both; once a chain has left GitHub's origin no later request carries a token, even one back on that origin; a chain longer than github.redirects stops and fails as Undecodable answer naming the status; the token is in no URL and no header another host got",
    { drawn: drawn9 },
    ({ drawn }) =>
      Effect.gen(function* () {
        const token = goodTokens(drawn.secret, drawn.length)[0]?.token ?? "";
        const forms = tokenForms(token);
        const address = `https://${drawn.address.host}:${drawn.address.port}`;
        const start = `${address}${repoPath("o", "r")}`;
        const names = { other: drawn.address.other, port: drawn.address.otherPort };
        const payload = { title: drawn.secret };

        // Each hop on its own, for each status and kind, so every class is reached; then the drawn chain, longer than the limit or not.
        const chains: ReadonlyArray<{
          readonly name: string;
          readonly chain: ReadonlyArray<Hop>;
          readonly limit: number;
        }> = [
          ...STATUSES.flatMap((status) =>
            KINDS.map((kind) => ({
              name: `${status} to ${kind}`,
              chain: [{ status, kind, segment: drawn.secret }],
              limit: 20,
            })),
          ),
          // A chain that leaves GitHub's origin and comes back: the token does not come back with it.
          ...STATUSES.flatMap((status) =>
            (["other host", "same host, other scheme", "same host, other port"] as const).map((kind) => ({
              name: `${status} to ${kind}, then back to the own origin, then on`,
              chain: [
                { status, kind, segment: drawn.secret },
                { status, kind: "own origin, full" as const, segment: drawn.secret },
                { status: 302 as const, kind: "own origin, relative" as const, segment: drawn.secret },
              ],
              limit: 20,
            })),
          ),
          { name: "the drawn chain", chain: drawn.chain, limit: drawn.limit },
          { name: "a chain longer than the limit", chain: [...drawn.chain, ...drawn.chain], limit: drawn.chain.length },
          { name: "no hop allowed", chain: drawn.chain, limit: 0 },
        ];

        for (const method of drawn.post ? (["GET", "POST"] as const) : (["GET"] as const)) {
          for (const each of chains) {
            const route = method === "GET" ? "GET" : "POST";
            const startFor = method === "GET" ? start : `${start}/issues`;
            const model = trail(startFor, route, method === "POST", each.chain, names);
            const sent = Math.min(each.chain.length, each.limit) + 1;
            const label = `${method}, ${each.name}`;

            const program =
              method === "GET"
                ? GitHub.call(GetRepo, { params: { owner: "o", repo: "r" } })
                : GitHub.call(CreateIssue, { params: { owner: "o", repo: "r" }, payload });

            const run = yield* through(
              program,
              { login: token, apiUrl: address, redirects: each.limit },
              (_, index) => {
                const status = each.chain[index]?.status;
                const location = model.locations[index];

                return status !== undefined && location !== undefined
                  ? reply(null, status, { location })
                  : method === "GET"
                    ? reply(JSON.stringify(REPO_JSON))
                    : reply("{}", 201);
              },
            );

            expect(run.seen, `${label}: requests`).toHaveLength(sent);

            for (const [index, seen] of run.seen.entries()) {
              const at = `${label}, request ${index}`;

              expect(seen.redirect, `${at}: fetch does not follow by itself`).toBe("manual");
              expect(seen.url, `${at}: where`).toBe(model.urls[index]);
              expect(seen.method, `${at}: method`).toBe(model.methods[index]);
              expect(seen.body !== undefined, `${at}: body`).toBe(model.bodies[index]);

              if (model.bodies[index] === true) {
                expect(seen.body, `${at}: the body kept`).toBe(JSON.stringify(payload));
              }

              for (const name of ["proxy-authorization", "cookie"]) {
                expect(Object.hasOwn(seen.headers, name), `${at}: ${name}`).toBe(false);
              }

              if (originFrom(seen.url) !== address) {
                expect(Object.hasOwn(seen.headers, "authorization"), `${at}: another origin has no token`).toBe(false);
                expect(showsAny(Object.values(seen.headers), forms), `${at}: headers there`).toEqual([]);
              }

              if (model.keeps[index] === true) {
                expect(seen.headers.authorization, `${at}: the token stays on this origin`).toBe(`Bearer ${token}`);
              } else {
                // Once a chain has left GitHub's origin the token never comes back, even when a later hop returns to it.
                expect(Object.hasOwn(seen.headers, "authorization"), `${at}: gone for good after leaving`).toBe(false);
              }

              expect(showsAny([seen.url], forms), `${at}: the URL`).toEqual([]);
            }

            if (each.chain.length <= each.limit) {
              expect(Exit.isSuccess(run.exit), `${label}: the chain ends`).toBe(true);
            } else {
              const found = reasonHeld(run.exit);
              const last = each.chain[each.limit]?.status;

              expect(found?.reason._tag, label).toBe("Undecodable");

              if (found?.reason._tag === "Undecodable") {
                expect(found.reason.side, label).toBe("answer");
                expect(found.reason.message, `${label}: names the status`).toContain(String(last));
              }
            }
          }
        }
      }),
    { arbitrary: { seed: SEED, runs: 60 } },
  );
});

const drawn10 = Arbitrary.all({ owner: word, repo: word, documentation: word, message: word, host, marker: word });

// F3, the fake and the live client agree. Plant: let the fake write `/zen` with `JSON.stringify` (its text differs); let the live client read
// a text route through JSON (`/zen` fails).
describe("F3, the fake and the live client agree", () => {
  it.effect.prop(
    "for the repo read, /zen and the 404, call through the fake and call through the live Layer on a stand-in fetch that answers as GitHub did give equal outcomes",
    { drawn: drawn10 },
    ({ drawn }) =>
      Effect.gen(function* () {
        const full = `${drawn.owner}/${drawn.repo}`;
        const repo = { id: 1296269, full_name: full, private: false };
        const missing = { message: drawn.message, documentation_url: `https://docs.github.com/${drawn.documentation}` };
        const params = { owner: drawn.owner, repo: drawn.repo } as const;

        const cases: ReadonlyArray<{
          readonly name: string;
          readonly program: Effect.Effect<unknown, GitHub.GitHubError | GitHub.RateLimited, GitHub.GitHub>;
          readonly fake: GitHubTest.Answer;
          readonly answer: Response;
        }> = [
          {
            name: "the repo read",
            program: GitHub.call(GetRepo, { params }),
            fake: GitHubTest.answer(GetRepo, () => repo),
            answer: reply(JSON.stringify(repo, null, 2)),
          },
          {
            name: "/zen",
            program: GitHub.call(Zen, {}),
            fake: GitHubTest.answer(Zen, () => `${ZEN_TEXT} ${drawn.marker}`),
            answer: reply(`${ZEN_TEXT} ${drawn.marker}`, 200, { "content-type": "text/plain;charset=utf-8" }),
          },
          {
            name: "the 404",
            program: GitHub.call(GetRepo, { params }),
            fake: GitHubTest.refuse(GetRepo, { status: 404, ...missing }),
            answer: reply(JSON.stringify({ ...missing, status: "404" }), 404),
          },
        ];

        for (const each of cases) {
          const viaFake = yield* each.program.pipe(Effect.provide(GitHubTest.layer([each.fake])), Effect.exit);

          const viaLive = yield* through(each.program, { login: "ghp_login", apiUrl: `https://${drawn.host}` }, () =>
            each.answer.clone(),
          );

          const encoded = (error: GitHub.GitHubError | GitHub.RateLimited | undefined) =>
            Predicate.isTagged(error, "GitHubError") ? Schema.encodeSync(GitHub.GitHubError)(error) : error;

          const plain = (exit: Exit.Exit<unknown, GitHub.GitHubError | GitHub.RateLimited>) =>
            Exit.isSuccess(exit) ? { value: exit.value } : { failure: encoded(failure(exit)) };

          assert.deepStrictEqual(plain(viaLive.exit), plain(viaFake), each.name);
        }
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});
