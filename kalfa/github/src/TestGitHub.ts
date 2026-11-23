/**
 * The fake GitHub for a caller's tests: a Layer of the `GitHub` service that answers in GitHub's own JSON, so the caller's real
 * decoding runs.
 *
 * **Details**
 *
 * A test module holds a Layer here, since the caller's tests provide it where the live Layer would go. `answer` and `refuse`
 * make the answers, and `layer` finds the first one whose route text is the request's. A request no answer covers dies,
 * naming the route: a test that forgot to declare it has a bug, and a 404 would let it pass as a "not found" case.
 */
import type { Schema } from "effect";
import { Duration, Effect, Layer } from "effect";
import * as GitHub from "./GitHub.ts";
import type * as Check from "./internal/Check.ts";

/** The reply's content type: GitHub's JSON. */
const HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

/** A text route's content type: GitHub answers `/zen` in plain text. */
const TEXT_HEADERS = { "content-type": "text/plain; charset=utf-8" } as const;

/** How often a watch asks again, when a test says nothing: the protocol's default poll interval. */
const POLL = "30 seconds";

type OperationRoute<Op extends GitHub.AnyRoute> =
  Op extends GitHub.Route<
    infer R,
    Schema.Constraint,
    Schema.Constraint,
    Schema.Constraint,
    "json" | "text",
    "login" | "none"
  >
    ? R
    : never;

type OperationBody<Op extends GitHub.AnyRoute> =
  Op extends GitHub.Route<
    GitHub.RouteName,
    Schema.Constraint,
    Schema.Constraint,
    Schema.Constraint,
    infer B,
    "login" | "none"
  >
    ? B
    : never;

/**
 * What a fake's `f` is handed of the request: the values that filled the path, the query, and the body, each as the Request
 * carried it, which is its encoded form (a number a Schema reads from text is the text).
 *
 * @category models
 */
export interface Asked<Op extends GitHub.AnyRoute> {
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, GitHub.QueryValue>>;
  /** The encoded payload, or `undefined` when the request carried no body. */
  readonly payload: Op extends GitHub.Route<
    infer R,
    Schema.Constraint,
    Schema.Constraint,
    infer P extends Schema.Constraint,
    "json" | "text",
    "login" | "none"
  >
    ? Check.AskedBody<P, R>
    : never;
}

/**
 * What a fake's `f` may answer with the 2xx status `Status`: `undefined` exactly when that status has no body, and otherwise
 * part of the description's answer, with every key optional at every depth and no key the description lacks (any JSON for a
 * route whose answer is checked at run time only).
 *
 * @category models
 */
export type Answered<Op extends GitHub.AnyRoute, Status extends number = 200> = Check.Faked<
  OperationRoute<Op>,
  Status,
  OperationBody<Op>
>;

/**
 * The status option of `answer`: required when 200 is not one of the route's 2xx statuses, and exactly those statuses.
 *
 * @category models
 */
export type StatusOption<Op extends GitHub.AnyRoute> = Check.StatusOption<OperationRoute<Op>>;

type GivenStatus<Option> = Option extends readonly [{ readonly status: infer S extends number }] ? S : 200;

type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

type ToNumber<S> = S extends `${infer N extends number}` ? N : never;

/**
 * A status of GitHub's 4xx answers, 400 to 499.
 *
 * @category models
 */
export type Status4xx = ToNumber<`4${Digit}${Digit}`>;

/**
 * One fake answer: the route text it covers, and how it replies to a request for it.
 *
 * @category models
 */
export interface Answer {
  readonly route: GitHub.RouteName;
  readonly reply: (request: GitHub.Request) => GitHub.Reply;
}

/**
 * A fake answer for a route: `f`'s value written as JSON text, with status 200 or the status given.
 *
 * **When to use**
 *
 * Use to answer a request for a declared operation, in the list `layer` takes.
 *
 * **Details**
 *
 * `f` is handed what the request carried, and may answer with fields the caller's Schema does not read, as GitHub does: the
 * caller's decoding drops them. A field the description's answer lacks does not compile. A value of `undefined` makes an empty
 * body, for a route that answers a status with none.
 *
 * @category constructors
 */
export const answer = <
  Op extends GitHub.AnyRoute,
  const Option extends StatusOption<Op>,
  const A extends Answered<Op, GivenStatus<Option>>,
>(
  op: Op,
  f: (asked: Asked<Op>) => A & Check.ExactFake<OperationRoute<Op>, A>,
  ...options: Option
): Answer => ({
  route: op.route,
  reply: (request) => {
    const [given] = options;

    // SAFETY: `call` made the request's body by encoding the payload through this route's own Schema, so it is that Schema's
    // encoded type, and `undefined` when no payload was given.
    const asked = { params: request.params, query: request.query, payload: request.body } as Asked<Op>;
    const value = f(asked);

    const text = op.body === "text";

    return {
      status: given?.status ?? 200,
      headers: text ? TEXT_HEADERS : HEADERS,
      // A text route's value is the body as it is; any other is written as JSON.
      body: value === undefined ? "" : text ? String(value) : JSON.stringify(value),
    };
  },
});

/**
 * A fake 4xx answer for a route, as GitHub's error body says it.
 *
 * **Details**
 *
 * The reply goes through `call`'s real reading, so a test sees the `ClientError` a caller would. Each field given is in the
 * body, and each left out is not.
 *
 * @category constructors
 */
export const refuse = (
  op: GitHub.AnyRoute,
  said: {
    readonly status: Status4xx;
    readonly message?: string;
    readonly documentation_url?: string;
    readonly errors?: string | ReadonlyArray<Schema.Json>;
  },
): Answer => {
  const { status, ...body } = said;

  return { route: op.route, reply: () => ({ status, headers: HEADERS, body: JSON.stringify(body) }) };
};

/**
 * A `GitHub` Layer that answers each request with the first answer whose route text is the request's.
 *
 * **When to use**
 *
 * Use as a caller's test Layer, in place of the live one.
 *
 * **Details**
 *
 * The answer is found in the list, in order, never by a record lookup. A request no answer covers dies, naming the route.
 * `poll` is how often a watch asks again: 30 seconds by default.
 *
 * @category layers
 */
export const layer = (
  answers: ReadonlyArray<Answer>,
  options?: { readonly poll?: Duration.Input },
): Layer.Layer<GitHub.GitHub> =>
  Layer.succeed(GitHub.GitHub, {
    send: (request) => {
      const found = answers.find((each) => each.route === request.route);

      return found === undefined
        ? Effect.die(`no fake answer covers ${request.route}: declare one with GitHubTest.answer or GitHubTest.refuse`)
        : Effect.succeed(found.reply(request));
    },
    poll: Duration.fromInputUnsafe(options?.poll ?? POLL),
  });
