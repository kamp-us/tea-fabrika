/**
 * The client for GitHub's REST API: declare an operation by its route text, and let the compiler hold it to GitHub's
 * own description.
 *
 * **Details**
 *
 * A route is written as GitHub writes it, such as `"GET /repos/{owner}/{repo}/commits/{ref}/check-runs"`. The checks read
 * `@octokit/openapi-types`, so a typo in a route, a parameter, a query key, a payload key or an answer field does not
 * compile. `call` sends a declared operation through the `GitHub` service and reads GitHub's answer. The package never
 * logs and imports no Node module.
 */
import type { Duration, Redacted } from "effect";
import { Context, Data, Effect, Option, Result, Schema } from "effect";
import type * as Check from "./internal/Check.ts";
import * as wire from "./internal/wire.ts";

/**
 * A route text GitHub's description has, in its own spelling: the method, a space, then the path with its `{name}` parts.
 *
 * @category models
 */
export type RouteName = Check.RouteName;

/**
 * An HTTP method of GitHub's REST description.
 *
 * @category models
 */
export const Method = Schema.Literals(["GET", "PUT", "POST", "PATCH", "DELETE"]);

export type Method = typeof Method.Type;

/**
 * The REST API version the checks' types describe. It does not compile when the types move to another date.
 *
 * @category constants
 */
export const apiVersion: Check.ApiVersion = "2022-11-28";

// Only `route` builds a Route: the key is a symbol this module does not export, so an object with a route text, a method
// and a path is not one. `Symbol.for`, so a second copy of the package reads the same key.
const TypeId: unique symbol = Symbol.for("@kalfa/github/Route");

// Not exported: the class is the shape, and `Route` below is the only name a caller gets.
class Declared<
  R extends RouteName,
  Success,
  Query,
  Payload,
  Body extends "json" | "text",
  Auth extends "login" | "none",
> extends Data.TaggedClass("Route")<{
  readonly route: R;
  readonly method: Method;
  readonly path: string;
  readonly success?: Success;
  readonly query?: Query;
  readonly payload?: Payload;
  readonly bodiless?: ReadonlyArray<number>;
  readonly body: Body;
  readonly auth: Auth;
  readonly accept?: string;
}> {
  readonly [TypeId]: typeof TypeId = TypeId;
}

/**
 * A declared REST operation: a route of GitHub's description and the parts the caller declares for it, made by `route`.
 *
 * **Details**
 *
 * It holds the route text, split into its method and its path template (each `{name}` still in it), and the Schemas the
 * caller gave: `success` for the answer, `query` as a Struct of the declared fields, `payload` for the body, and
 * `bodiless` for the 2xx statuses that carry no body. Each Schema was checked against the description when the route
 * was declared. `body` says how the answer is read (`"json"` unless declared, or `"text"`), `auth` who the request is sent
 * as (`"login"` unless declared `"none"`), and `accept` is the media type asked for, there only when declared.
 *
 * @category models
 */
export type Route<
  R extends RouteName,
  Success,
  Query,
  Payload,
  Body extends "json" | "text" = "json",
  Auth extends "login" | "none" = "login",
> = Declared<R, Success, Query, Payload, Body, Auth>;

const split = (text: string): { readonly method: Method; readonly path: string } => {
  const space = text.indexOf(" ");

  return { method: Schema.decodeUnknownSync(Method)(text.slice(0, space)), path: text.slice(space + 1) };
};

/**
 * Declares a REST operation by its route text, and holds what the caller declares for it to GitHub's description.
 *
 * **When to use**
 *
 * Use to declare each operation once, as a value, in GitHub's own route text.
 *
 * **Details**
 *
 * The route text must be one the description has, and the compiler refuses a typo in it. Each query key, payload key and
 * answer field the caller declares must be one the description has, with values it takes. A part checked at run time
 * only is named in the README. The call throws when a route text carries a method GitHub has not got, which only a
 * caller that skipped the types can write.
 *
 * **Example** (Declaring the check runs of a commit)
 *
 * ```ts
 * import * as GitHub from "@kalfa/github"
 * import { Schema } from "effect"
 *
 * export const ListCheckRuns = GitHub.route("GET /repos/{owner}/{repo}/commits/{ref}/check-runs", {
 *   query: { per_page: Schema.Int },
 *   success: Schema.Struct({ check_runs: Schema.Array(Schema.Struct({ id: Schema.Finite, name: Schema.String })) })
 * })
 * ```
 *
 * @category constructors
 */
export const route = <
  const R extends RouteName,
  Success extends Schema.Constraint = never,
  Query extends Schema.Struct.Fields = Record<never, never>,
  Payload extends Schema.Constraint = never,
  // The index signature keeps the constraint from being a weak type, so options that name neither `body` nor `auth` still
  // infer their own object and not the bare constraint.
  const Settings extends Check.Settings & Record<string, unknown> = Record<never, never>,
>(
  route: R,
  ...options: Check.Options<R, Success, Query, Payload, Settings>
): Route<R, Success, Schema.Struct<Query>, Payload, Check.BodyKind<Settings>, Check.AuthKind<Settings>> => {
  const [given] = options;
  const success: Success | undefined = given?.success;
  const query: Query | undefined = given?.query;
  const payload: Payload | undefined = given?.payload;
  const bodiless: ReadonlyArray<number> | undefined = given?.bodiless;
  const accept: string | undefined = given?.accept;

  return new Declared({
    route,
    ...split(route),
    ...(success === undefined ? {} : { success }),
    ...(query === undefined ? {} : { query: Schema.Struct(query) }),
    ...(payload === undefined ? {} : { payload }),
    ...(bodiless === undefined ? {} : { bodiless }),
    // SAFETY: `BodyKind` and `AuthKind` are the union of every value the options may say and the default, "json" or "login",
    // when they may say none; `given.body` and `given.auth` are one of those, and so is the default.
    body: (given?.body ?? "json") as Check.BodyKind<Settings>,
    // SAFETY: as for `body` above.
    auth: (given?.auth ?? "login") as Check.AuthKind<Settings>,
    ...(accept === undefined ? {} : { accept }),
  });
};

/**
 * Who a request is sent as, decided by `call`: the service's own login, nobody, or the token one call brought.
 *
 * @category models
 */
export type Auth = Data.TaggedEnum<{
  /** The service's login. */
  Login: Record<never, never>;
  /** Nobody: a route declared `auth: "none"` sends no token. */
  None: Record<never, never>;
  /** The token one call was given. */
  Token: { readonly token: Redacted.Redacted<string> };
}>;

/**
 * The constructors of `Auth`.
 *
 * @category constructors
 */
export const Auth = Data.taggedEnum<Auth>();

/**
 * What a URL's query can carry: a text, a number, a boolean, or a list of them. `call` refuses anything else.
 *
 * @category models
 */
export type QueryValue = wire.QueryValue;

/**
 * What `call` hands the `GitHub` service: the route as declared, with the path filled and the query and body encoded.
 *
 * **Details**
 *
 * No key of the query or the body has `undefined` as its value, at any depth, and no query holds a key the caller left out.
 * `auth` says who the request is sent as, and `accept` is the media type the route asked for, there exactly when it did.
 *
 * @category models
 */
export interface Request {
  /** The route text, as declared. */
  readonly route: RouteName;
  readonly method: Method;
  /** The route's path, each `{name}` filled and encoded. */
  readonly path: string;
  /** The values that filled the path, as sent. */
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, QueryValue>>;
  readonly body?: Schema.Json;
  readonly auth: Auth;
  readonly accept?: string;
}

/**
 * What the `GitHub` service answers: the status, the headers with lowercase names, and the body as GitHub sent its text.
 *
 * @category models
 */
export interface Reply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * A 4xx answer, as GitHub said it.
 *
 * **Details**
 *
 * Each optional field is there exactly when GitHub's body had it. `errors` stays as GitHub said it: a list of objects or texts,
 * or one text.
 *
 * @category errors
 */
export class ClientError extends Schema.TaggedError<ClientError, { readonly brand: unique symbol }>()("ClientError", {
  status: Schema.Int,
  message: Schema.optionalKey(Schema.String),
  documentationUrl: Schema.optionalKey(Schema.String),
  errors: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.Json)])),
}) {}

/**
 * The input could not be encoded, or the answer could not be read.
 *
 * **Details**
 *
 * `message` says where and what was wrong (the path and what was expected), and holds no value of the input or the answer. `cause` is the failure that said so, and
 * is absent when nothing failed to decode, such as a status this client does not read.
 *
 * @category errors
 */
export class Undecodable extends Schema.TaggedError<Undecodable, { readonly brand: unique symbol }>()("Undecodable", {
  side: Schema.Literals(["input", "answer"]),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/**
 * GitHub answered 5xx.
 *
 * **Details**
 *
 * `mayHaveApplied` is `true` for a write, which GitHub may have carried out before it failed, and `false` for a read.
 *
 * @category errors
 */
export class ServerError extends Schema.TaggedError<ServerError, { readonly brand: unique symbol }>()("ServerError", {
  status: Schema.Int,
  mayHaveApplied: Schema.Boolean,
}) {}

/**
 * The request got no answer: the connection failed, or the body could not be read.
 *
 * **Details**
 *
 * `mayHaveApplied` is `true` for a write that left, and `false` for a read, and for a request that never left. `cause` is the
 * failure under the HTTP client's error, never that error itself, which holds the request.
 *
 * @category errors
 */
export class Unavailable extends Schema.TaggedError<Unavailable, { readonly brand: unique symbol }>()("Unavailable", {
  mayHaveApplied: Schema.Boolean,
  cause: Schema.Defect(),
}) {}

/**
 * Why a call failed, named by the route text.
 *
 * **Details**
 *
 * It has no `message` and no `cause` field of its own: a failed span renders only those, so nothing under `reason` (GitHub's
 * text, the caller's input, the answer's values) reaches a span. A caller reads `reason`.
 *
 * @category errors
 */
export class GitHubError extends Schema.TaggedError<GitHubError, { readonly brand: unique symbol }>()("GitHubError", {
  operation: Schema.String,
  reason: Schema.Union([ClientError, ServerError, Unavailable, Undecodable]),
}) {}

/**
 * GitHub asked the client to wait. A `GitHub` service fails with it when it holds a rate limit.
 *
 * @category errors
 */
export class RateLimited extends Schema.TaggedError<RateLimited, { readonly brand: unique symbol }>()("RateLimited", {
  operation: Schema.String,
  until: Schema.DateTimeUtc,
  limit: Schema.Literals(["primary", "secondary"]),
  resource: Schema.optionalKey(Schema.String),
}) {}

/**
 * The service `call` sends a request through.
 *
 * **Details**
 *
 * `send` answers a request with GitHub's reply, or fails with what the service holds: `GitHubError` or `RateLimited`. `poll`
 * is how often a watch asks again.
 *
 * @category services
 */
export class GitHub extends Context.Service<
  GitHub,
  {
    readonly send: (request: Request) => Effect.Effect<Reply, GitHubError | RateLimited>;
    readonly poll: Duration.Duration;
  }
>()("@kalfa/github/GitHub") {}

/**
 * Any declared operation: the bound `call` takes, and what a test's fake is declared over.
 *
 * @category models
 */
export type AnyRoute = Route<
  RouteName,
  Schema.Constraint,
  Schema.Constraint,
  Schema.Constraint,
  "json" | "text",
  "login" | "none"
>;

/**
 * What a caller hands `call` for a declared operation: its path names, its query and its payload, each there exactly when the
 * route declared it.
 *
 * @category models
 */
export type Input<Op extends AnyRoute> =
  Op extends Route<
    infer R,
    Schema.Constraint,
    infer Q extends Schema.Constraint,
    infer P extends Schema.Constraint,
    "json" | "text",
    "login" | "none"
  >
    ? Check.Input<R, Q, P>
    : never;

/**
 * What `call` gives for a declared operation: `void` when no success was declared, the success Schema's decoded type, or an
 * `Option` of it for a route that also has a 2xx with no body.
 *
 * @category models
 */
export type Success<Op extends AnyRoute> =
  Op extends Route<
    infer R,
    infer S extends Schema.Constraint,
    Schema.Constraint,
    Schema.Constraint,
    "json" | "text",
    "login" | "none"
  >
    ? Check.Returned<R, S>
    : never;

/**
 * The services a declared operation's Schemas need.
 *
 * @category models
 */
export type Services<Op extends AnyRoute> =
  Op extends Route<
    RouteName,
    infer S extends Schema.Constraint,
    infer Q extends Schema.Constraint,
    infer P extends Schema.Constraint,
    "json" | "text",
    "login" | "none"
  >
    ? Check.Needed<Q, P, S>
    : never;

/**
 * What a call may bring beside its input: the token it is sent with, in place of the service's login. A route declared
 * `auth: "none"` sends no token, so it takes none.
 *
 * @category models
 */
export type CallOptions<Op extends AnyRoute> =
  Op extends Route<RouteName, Schema.Constraint, Schema.Constraint, Schema.Constraint, "json" | "text", infer A>
    ? "none" extends A
      ? { readonly token?: never }
      : { readonly token?: Redacted.Redacted<string> }
    : never;

// What `call` reads of its input when it knows nothing of the route's types: the three parts, each as it was given.
interface CallInput {
  readonly params?: Readonly<Record<string, wire.PathValue>>;
  readonly query?: unknown;
  readonly payload?: unknown;
}

// A key the Schema lacks is refused when encoding, and dropped when decoding: the caller reads only some fields of GitHub's.
const ENCODING = { onExcessProperty: "error" } as const;

const run = Effect.fn("github.call")(function* (
  op: AnyRoute,
  given: CallInput,
  options?: { readonly token?: Redacted.Redacted<string> },
) {
  yield* Effect.annotateCurrentSpan({ "http.request.method": op.method, "kalfa.github.operation": op.route });

  const refuse = (side: "input" | "answer", message: string, cause?: unknown) =>
    new GitHubError({
      operation: op.route,
      reason: new Undecodable({ side, message, ...(cause === undefined ? {} : { cause }) }),
    });

  const refused = (side: "input" | "answer") => (error: Schema.SchemaError) => refuse(side, error.message, error);

  // The one place every call passes through, the live layer's and the fake's alike: a token a none route would drop is a
  // mistake in the code that called, so it dies with the route and never the token, before anything is sent.
  if (op.auth === "none" && options?.token !== undefined) {
    return yield* Effect.die(`${op.route} is declared auth: "none", so it sends no token`);
  }

  const filled = yield* Effect.fromResult(wire.fill(op.path, given.params ?? {})).pipe(
    Effect.mapError((message) => refuse("input", message)),
  );

  // Each encoding is an Effect, since a caller's Schema may be async or need a service. What it gives is read as a `Tree`,
  // which refuses what JSON cannot hold, and then made into what is sent.
  const encoded = <S extends Schema.Constraint, A, B>(
    schema: S,
    value: S["Type"],
    shape: Schema.Codec<A>,
    send: (tree: A) => Result.Result<B, string>,
  ) =>
    Schema.encodeUnknownEffect(
      schema,
      ENCODING,
    )(value).pipe(
      Effect.flatMap((each) => Schema.decodeUnknownEffect(shape)(each)),
      Effect.mapError(refused("input")),
      Effect.flatMap((tree) =>
        Effect.fromResult(send(tree)).pipe(Effect.mapError((message) => refuse("input", message))),
      ),
    );

  const query =
    op.query === undefined
      ? {}
      : yield* encoded(op.query, given.query ?? {}, wire.TreeRecord, (tree) =>
          Result.flatMap(wire.pruneObject(tree), wire.queryValues),
        );

  const body =
    op.payload === undefined || given.payload === undefined
      ? undefined
      : yield* encoded(op.payload, given.payload, wire.Tree, wire.prune);

  const github = yield* GitHub;

  const reply = yield* github.send({
    route: op.route,
    method: op.method,
    path: filled.path,
    params: filled.values,
    query,
    ...(body === undefined ? {} : { body }),
    auth:
      op.auth === "none"
        ? Auth.None()
        : options?.token === undefined
          ? Auth.Login()
          : Auth.Token({ token: options.token }),
    ...(op.accept === undefined ? {} : { accept: op.accept }),
  });

  yield* Effect.annotateCurrentSpan({ "http.response.status_code": reply.status });

  if (reply.status >= 200 && reply.status < 300) {
    if (op.success === undefined) {
      return;
    }

    if (op.bodiless?.includes(reply.status) === true) {
      return Option.none();
    }

    // A text answer is read as the text it is, with no JSON step: a text that is also JSON stays a text.
    const decoded = yield* Schema.decodeUnknownEffect(
      op.body === "text" ? op.success : Schema.fromJsonString(op.success),
    )(reply.body).pipe(Effect.mapError(refused("answer")));

    return op.bodiless === undefined ? decoded : Option.some(decoded);
  }

  if (reply.status >= 400 && reply.status < 500) {
    const said = wire.errorBody(reply.body);

    return yield* new GitHubError({
      operation: op.route,
      reason: new ClientError({
        status: reply.status,
        ...(said.message === undefined ? {} : { message: said.message }),
        ...(said.documentation_url === undefined ? {} : { documentationUrl: said.documentation_url }),
        ...(said.errors === undefined ? {} : { errors: said.errors }),
      }),
    });
  }

  if (reply.status >= 500 && reply.status < 600) {
    return yield* new GitHubError({
      operation: op.route,
      reason: new ServerError({ status: reply.status, mayHaveApplied: wire.mayHaveApplied(op.method, true) }),
    });
  }

  return yield* refuse("answer", `GitHub answered ${reply.status}, which this client does not read`);
});

/**
 * Calls a declared operation: fills its path, encodes its query and payload, sends the request through the `GitHub` service
 * and reads the answer through the success Schema.
 *
 * **When to use**
 *
 * Use to call an operation declared with `route`, from any program that has a `GitHub` Layer.
 *
 * **Details**
 *
 * A path value is encoded with `encodeURIComponent`. A key the caller left out (`undefined`) is not sent, and an explicit
 * `null` is. The call fails with `GitHubError` when the input cannot be encoded (nothing is sent then), when GitHub answers
 * with a 4xx, or when the answer cannot be read, and with `RateLimited` when the service says so. It runs in the span
 * `github.call`, with `http.request.method`, `http.response.status_code` and `kalfa.github.operation`: no path, no query and
 * no value is put in it.
 *
 * @category calls
 */
// SAFETY: `run` reads a route and its input as the loose types they have under every route; `Input`, `Success` and
// `Services` name what each route's declared parts make of them, and `route` checked those parts when it was made.
export const call = run as <Op extends AnyRoute>(
  op: Op,
  input: Input<Op>,
  options?: CallOptions<Op>,
) => Effect.Effect<Success<Op>, GitHubError | RateLimited, GitHub | Services<Op>>;

/**
 * What the live Layer logs in as: `Login.Token` holds a plain token.
 *
 * @category models
 */
export * as Login from "./Login.ts";
