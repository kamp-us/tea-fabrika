// C10: the fake `GitHubTest.layer`, answered by `GitHubTest.answer` and `GitHubTest.refuse`, run through `call` and through the
// service's own `send`. It runs in memory: the fake is the whole of the GitHub side. The type laws are in TestGitHub.types.test.ts.
import { assert, describe, expect, it } from "@effect/vitest";
import { Cause, Data, Duration, Effect, Exit, Option, Predicate, Redacted, Schema } from "effect";
import type { GetRepo } from "./GitHub.test-support.ts";
import {
  between,
  CancelRun,
  Dispatch,
  failure,
  ListCheckRuns,
  reasonHeld,
  SEED,
  slice1,
  textAnswers,
  tokenForms,
  untyped,
  Zen,
} from "./GitHub.test-support.ts";
import * as GitHub from "./GitHub.ts";
import { GET_REPO } from "./Octokit.test-support.ts";
import { CreatedIssue, EchoIssue, fakeCalls, goodTexts } from "./TestGitHub.test-support.ts";
import * as GitHubTest from "./TestGitHub.ts";

/** The value a reply's text holds. */
const parsed = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

// The ways a request can be sent, as the constructors of the type that names them.
const Auth = Data.taggedEnum<GitHub.Auth>();

/** What the fake's `send` answers for a request: the reply itself, as the service gives it. */
const send = (request: GitHub.Request) => GitHub.GitHub.use((service) => service.send(request));

/** A request, made by hand: the route, and what a call would have put in it. */
const makeRequest = (
  op: { readonly route: GitHub.RouteName; readonly method: GitHub.Method; readonly path: string },
  parts: {
    readonly params: Readonly<Record<string, string>>;
    readonly query?: GitHub.Request["query"];
    readonly body?: GitHub.Request["body"];
  },
): GitHub.Request => ({
  route: op.route,
  method: op.method,
  path: op.path,
  params: parts.params,
  query: parts.query ?? {},
  auth: Auth.Login(),
  ...(parts.body === undefined ? {} : { body: parts.body }),
});

/** The service's poll interval, in milliseconds, under a layer made with `options`. */
const pollMillis = (options?: { readonly poll?: Duration.Input }) =>
  GitHub.GitHub.use((service) => Effect.succeed(Duration.toMillis(service.poll))).pipe(
    Effect.provide(GitHubTest.layer([], options)),
  );

// C10. Plant: ignore the status option (V); fail with `ClientError` 404 for a route no answer covers (W); let the last matching
// answer win (X); write a text for a value of `undefined` (V); fix `poll` at 30 seconds (Y); hand `f` the decoded value, not the encoded one the Request carried (Z); write
// the text by joining strings, not with `JSON.stringify` (Z); answer a refusal with status 200; take the answer by a record
// lookup on the route text.
describe("C10, the fake", () => {
  it.effect.prop(
    "answer replies with status 200 or the one given and f's value as JSON text, f sees what the Request carried, refuse goes through call's 4xx reading, the first matching answer wins, a request no answer covers dies naming the route, poll is the option or 30 seconds, and a caller's real decoding runs on the text",
    { fake: fakeCalls, at: between(0, 8) },
    ({ fake, at }) =>
      Effect.gen(function* () {
        const { owner, repo } = fake;
        const texts = goodTexts(fake.base, fake.length);

        // (V) A route whose only 2xx is not 200 answers with the status given, and its text is JSON.
        const cancel = GitHubTest.layer([GitHubTest.answer(CancelRun, () => ({}), { status: 202 })]);

        const cancelled = yield* send(
          makeRequest(CancelRun, { params: { owner, repo, run_id: String(fake.runId) } }),
        ).pipe(Effect.provide(cancel));

        expect(cancelled.status, "V: the status given").toBe(202);
        assert.deepStrictEqual(parsed(cancelled.body), {});

        const viaCall = yield* GitHub.call(CancelRun, { params: { owner, repo, run_id: fake.runId } }).pipe(
          Effect.provide(cancel),
        );

        assert.deepStrictEqual(viaCall, {});

        // (V) A route with a 201: the status is the one given, f sees the payload the Request carried, and the caller's
        // Schema reads the text.
        const created = GitHubTest.layer([
          GitHubTest.answer(CreatedIssue, (asked) => ({ number: fake.issueNumber, title: asked.payload.title }), {
            status: 201,
          }),
        ]);

        for (const title of texts) {
          const reply = yield* send(makeRequest(CreatedIssue, { params: { owner, repo }, body: { title } })).pipe(
            Effect.provide(created),
          );

          expect(reply.status, `V: 201, ${title}`).toBe(201);
          assert.deepStrictEqual(parsed(reply.body), { number: fake.issueNumber, title });

          const read = yield* GitHub.call(CreatedIssue, { params: { owner, repo }, payload: { title } }).pipe(
            Effect.provide(created),
          );

          assert.deepStrictEqual(read, { number: fake.issueNumber, title });
        }

        // No status option, a route with a 200: the status is 200.
        const listed = GitHubTest.layer([GitHubTest.answer(ListCheckRuns, () => ({ check_runs: [] }))]);

        const empty = yield* send(
          makeRequest(ListCheckRuns, { params: { owner, repo, ref: "main" }, query: { per_page: fake.perPage } }),
        ).pipe(Effect.provide(listed));

        expect(empty.status, "200 without an option").toBe(200);

        // (Z) f reads the params and the query it is handed, with texts that hold `"`, `\`, braces and names an object holds;
        // the caller's real decoding runs on the text, dropping the fields it does not read.
        for (const ref of texts) {
          const asked: Array<{
            readonly params: Readonly<Record<string, string>>;
            readonly query: Readonly<Record<string, unknown>>;
            readonly payload: unknown;
          }> = [];

          const echo = GitHubTest.layer([
            GitHubTest.answer(ListCheckRuns, (heard) => {
              asked.push({ params: heard.params, query: heard.query, payload: heard.payload });

              return {
                total_count: 1,
                check_runs: [
                  {
                    id: fake.perPage,
                    name: heard.params["ref"] ?? "",
                    status: "queued",
                    conclusion: null,
                    head_sha: String(heard.query["check_name"]),
                  },
                ],
              };
            }),
          ]);

          const read = yield* GitHub.call(ListCheckRuns, {
            params: { owner, repo, ref },
            query: { per_page: fake.perPage, check_name: ref },
          }).pipe(Effect.provide(echo));

          assert.deepStrictEqual(read, {
            check_runs: [{ id: fake.perPage, name: ref, status: "queued", conclusion: null }],
          });
          assert.deepStrictEqual(
            asked.map((each) => each.params),
            [{ owner, repo, ref }],
          );
          assert.deepStrictEqual(
            asked.map((each) => each.query),
            [{ per_page: fake.perPage, check_name: ref }],
          );
          expect(asked[0]?.payload, "no payload was carried").toBeUndefined();
        }

        // (Z) f is handed the payload as the Request carried it, which is its encoded form: a number is a text.
        const echoed = yield* GitHub.call(EchoIssue, {
          params: { owner, repo },
          payload: { title: fake.millis },
        }).pipe(
          Effect.provide(
            GitHubTest.layer([
              GitHubTest.answer(EchoIssue, (heard) => ({ title: heard.payload.title }), { status: 201 }),
            ]),
          ),
        );

        assert.deepStrictEqual(echoed, { title: String(fake.millis) });

        // refuse: GitHub's own 4xx body, read by `call` as it reads GitHub's.
        const statuses = [400, 401, 403, 404, 409, 410, 422, 451, 499] as const;
        const status = statuses[at] ?? 404;

        const said = {
          status,
          ...(fake.refusal.message ? { message: fake.said } : {}),
          ...(fake.refusal.url
            ? { documentation_url: `https://docs.github.com/${encodeURIComponent(fake.said)}` }
            : {}),
          ...(fake.refusal.errors ? { errors: [{ code: "invalid", value: fake.said }] } : {}),
        };

        const refusing = GitHubTest.layer([GitHubTest.refuse(ListCheckRuns, said)]);
        const asking = makeRequest(ListCheckRuns, { params: { owner, repo, ref: "main" } });
        const refusedReply = yield* send(asking).pipe(Effect.provide(refusing));
        const { status: _, ...body } = said;

        expect(refusedReply.status, "the status given").toBe(status);
        assert.deepStrictEqual(parsed(refusedReply.body), body);

        const refused = yield* GitHub.call(ListCheckRuns, {
          params: { owner, repo, ref: "main" },
          query: { per_page: 1 },
        }).pipe(Effect.provide(refusing), Effect.exit);

        const held = reasonHeld(refused);

        expect(held?.operation).toBe(ListCheckRuns.route);
        expect(held?.reason._tag).toBe("ClientError");

        if (held?.reason._tag === "ClientError") {
          expect(held.reason.status).toBe(status);
          expect(Object.hasOwn(held.reason, "message")).toBe(fake.refusal.message);
          expect(Object.hasOwn(held.reason, "documentationUrl")).toBe(fake.refusal.url);
          expect(Object.hasOwn(held.reason, "errors")).toBe(fake.refusal.errors);
        }

        // (X) Two answers for the same route: the first one answers, whatever the second is, and a refusal first refuses.
        const first = GitHubTest.layer([
          GitHubTest.answer(CancelRun, () => ({}), { status: 202 }),
          GitHubTest.answer(ListCheckRuns, () => ({ check_runs: [{ id: 1 }] })),
          GitHubTest.answer(ListCheckRuns, () => ({ check_runs: [{ id: 2 }] })),
          GitHubTest.refuse(ListCheckRuns, { status: 404 }),
        ]);

        const firstReply = yield* send(asking).pipe(Effect.provide(first));

        assert.deepStrictEqual(parsed(firstReply.body), { check_runs: [{ id: 1 }] });

        const refusalFirst = yield* send(asking).pipe(
          Effect.provide(
            GitHubTest.layer([
              GitHubTest.refuse(ListCheckRuns, { status: 404 }),
              GitHubTest.answer(ListCheckRuns, () => ({ check_runs: [] })),
            ]),
          ),
        );

        expect(refusalFirst.status, "X: the refusal that came first").toBe(404);

        // (W) A request no answer covers dies, and the defect names the route; it is no failure of `call`'s own kind.
        for (const answers of [[], [GitHubTest.answer(CancelRun, () => ({}), { status: 202 })]]) {
          const missed = yield* GitHub.call(ListCheckRuns, {
            params: { owner, repo, ref: "main" },
            query: { per_page: 1 },
          }).pipe(Effect.provide(GitHubTest.layer(answers)), Effect.exit);

          expect(Exit.isFailure(missed) && Cause.hasDies(missed.cause), "W: a defect").toBe(true);
          expect(failure(missed), "W: no typed failure").toBeUndefined();
          expect(Exit.isFailure(missed) ? Cause.pretty(missed.cause) : "").toContain(ListCheckRuns.route);
        }

        // (V) A status with no body: an `f` that gives `undefined` makes an empty body, exactly, and the caller reads it as none.
        const dispatching = GitHubTest.layer([GitHubTest.answer(Dispatch, () => undefined, { status: 204 })]);

        const dispatched = yield* send(
          makeRequest(Dispatch, { params: { owner, repo, workflow_id: fake.base }, body: { ref: fake.base } }),
        ).pipe(Effect.provide(dispatching));

        expect(dispatched.status, "V: 204").toBe(204);
        expect(dispatched.body, "V: an empty body, and nothing else").toBe("");

        const dispatchedRead = yield* GitHub.call(Dispatch, {
          params: { owner, repo, workflow_id: fake.base },
          payload: { ref: fake.base },
        }).pipe(Effect.provide(dispatching));

        assert.deepStrictEqual(dispatchedRead, Option.none());

        // (Y) The poll interval is the option, in any form `Duration.Input` takes, and 30 seconds with none.
        expect(yield* pollMillis(), "Y: the default").toBe(30_000);
        expect(yield* pollMillis({}), "Y: an empty option").toBe(30_000);
        expect(yield* pollMillis({ poll: Duration.millis(fake.pollMillis) })).toBe(fake.pollMillis);
        expect(yield* pollMillis({ poll: fake.pollMillis })).toBe(fake.pollMillis);
        expect(yield* pollMillis({ poll: `${fake.pollMillis} millis` })).toBe(fake.pollMillis);
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

// F1, the fake on a text route. Plant: write a text route's value with `JSON.stringify`, so (b) and (c) come back quoted; write a
// JSON route's value as is; leave the text's content type as JSON's.
describe("F1, the fake on a text route", () => {
  it.effect.prop(
    "answer on a text route replies with the text as the body, as is, as plain text, and call through the layer gives it back; a JSON route still gets JSON.stringify; refuse takes errors as a text",
    { drawn: slice1, at: between(0, 8) },
    ({ drawn, at }) =>
      Effect.gen(function* () {
        for (const answer of textAnswers(drawn.base, drawn.length)) {
          const body = answer.value;
          const layer = GitHubTest.layer([GitHubTest.answer(Zen, () => body)]);
          const reply = yield* send(makeRequest(Zen, { params: {} })).pipe(Effect.provide(layer));

          expect(reply.body, `${answer.name}: the text as is`).toBe(body);
          expect(reply.status, answer.name).toBe(200);
          expect(reply.headers["content-type"], `${answer.name}: plain text`).toBe("text/plain; charset=utf-8");

          const read = yield* GitHub.call(Zen, {}).pipe(Effect.provide(layer));

          assert.deepStrictEqual(read, body, answer.name);
        }

        // A JSON route's value is still written as JSON text.
        const json = yield* send(makeRequest(ListCheckRuns, { params: { owner: "o", repo: "r", ref: "main" } })).pipe(
          Effect.provide(GitHubTest.layer([GitHubTest.answer(ListCheckRuns, () => ({ check_runs: [] }))])),
        );

        expect(json.body).toBe('{"check_runs":[]}');
        expect(json.headers["content-type"]).toBe("application/json; charset=utf-8");

        // `errors` as the one text GitHub sends, with the other fields of a refusal, through `call`'s own reading.
        const statuses = [400, 401, 403, 404, 409, 410, 422, 451, 499] as const;
        const status = statuses[at] ?? 404;

        const refusing = GitHubTest.layer([
          GitHubTest.refuse(ListCheckRuns, { status, message: drawn.base, errors: drawn.marker }),
        ]);

        const refused = yield* GitHub.call(ListCheckRuns, {
          params: { owner: "o", repo: "r", ref: "main" },
          query: { per_page: 1 },
        }).pipe(Effect.provide(refusing), Effect.exit);

        const held = reasonHeld(refused);

        expect(held?.reason._tag).toBe("ClientError");

        if (held?.reason._tag === "ClientError") {
          expect(held.reason.status).toBe(status);
          expect(held.reason.message).toBe(drawn.base);
          expect(held.reason.errors).toBe(drawn.marker);
        }
      }),
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// F2, a route whose value says more than its type. The types keep a route's `body` and `auth` as its value holds them, but a cast
// can write a route that disagrees, so `call` reads the value and fails loudly on a token it would drop. Each route here is typed
// as `GetRepo` and holds something else, through `untyped`, which is the lie a cast tells. Plant: send the request, and die after
// it; drop the token and send the request (what the code did before); fail with a `GitHubError` in place of dying; write the
// token into the defect's message; die with no route in the message; read a text route's answer through `Schema.fromJsonString`;
// read the answer by the route's type (as JSON) when the value says text; send `Auth.Token` on a route that holds none.
const REPO = { owner: "o", repo: "r" } as const;

const REPO_ANSWER = { id: 1296269, full_name: "o/r", private: false };

const REPO_SHAPE = Schema.Struct({ id: Schema.Int, full_name: Schema.String, private: Schema.Boolean });

/** Typed as `GetRepo`, which sends the login; its value sends nobody. */
const LyingNone: typeof GetRepo = untyped(GitHub.route(GET_REPO, { auth: "none", success: REPO_SHAPE }));

/** Typed as `GetRepo`, which reads JSON into a Struct; its value reads a text. */
const LyingText: typeof GetRepo = untyped(GitHub.route(GET_REPO, { body: "text", success: Schema.String }));

describe("F2, a route that lies about its type", () => {
  it.effect.prop(
    "call with a token on a route whose value sends none dies with a plain defect that names the route and never the token, and sends nothing; the same route with no token sends nobody; a text route's answer is read as text, whatever its type says",
    { drawn: slice1 },
    ({ drawn }) =>
      Effect.gen(function* () {
        const secret = `ghp_zq${drawn.length.toString(36)}x${drawn.token}`;
        const token = Redacted.make(secret);
        const forms = tokenForms(secret);

        const seen: Array<GitHub.Request> = [];

        /** An answer that also keeps what it was asked. */
        const keeping = (inner: GitHubTest.Answer): GitHubTest.Answer => ({
          route: inner.route,
          reply: (request) => {
            seen.push(request);

            return inner.reply(request);
          },
        });

        const layer = GitHubTest.layer([keeping(GitHubTest.answer(LyingNone, () => REPO_ANSWER))]);

        const exit = yield* GitHub.call(LyingNone, { params: REPO }, { token }).pipe(
          Effect.provide(layer),
          Effect.exit,
        );

        if (!Exit.isFailure(exit)) {
          return assert.fail("a token on a route that sends none was taken");
        }

        expect(Cause.hasDies(exit.cause), "a defect").toBe(true);
        expect(Cause.hasFails(exit.cause), "no failure in the Effect's error channel").toBe(false);

        const defect = Cause.squash(exit.cause);
        expect(Predicate.isString(defect) || defect instanceof Error, "a plain defect").toBe(true);

        const shown = [
          Cause.pretty(exit.cause),
          String(defect),
          ...Cause.prettyErrors(exit.cause, { includeCauseInStack: true }).flatMap((error) => [
            error.name,
            error.message,
            error.stack ?? "",
          ]),
        ];

        expect(shown.join("\n"), "the route").toContain(GET_REPO);

        for (const each of shown) {
          for (const form of forms) {
            expect(each, `the defect shows ${form}`).not.toContain(form);
          }
        }

        expect(seen, "nothing was sent").toHaveLength(0);

        // Without a token the same route is sent, as nobody.
        const read = yield* GitHub.call(LyingNone, { params: REPO }).pipe(Effect.provide(layer));
        assert.deepStrictEqual(read, REPO_ANSWER);
        expect(seen.map((request) => request.auth._tag)).toStrictEqual(["None"]);

        // A text route whose type says JSON is read as text, and a text that is also JSON stays a text.
        for (const answer of textAnswers(drawn.base, drawn.length)) {
          const text = GitHubTest.layer([GitHubTest.answer(LyingText, () => untyped(answer.value))]);
          const got: unknown = yield* GitHub.call(LyingText, { params: REPO }).pipe(Effect.provide(text));

          assert.deepStrictEqual(got, answer.value, answer.name);
        }
      }),
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});
