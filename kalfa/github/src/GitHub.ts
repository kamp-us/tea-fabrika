/**
 * The client for GitHub's REST API: declare an operation by its route text, and let the compiler hold it to GitHub's
 * own description.
 *
 * **Details**
 *
 * A route is written as GitHub writes it, such as `"GET /repos/{owner}/{repo}/commits/{ref}/check-runs"`. The checks read
 * `@octokit/openapi-types`, so a typo in a route, a parameter, a query key, a payload key or an answer field does not
 * compile. The package never logs and imports no Node module.
 */
import { Data, Schema } from "effect";
import type * as Check from "./internal/Check.ts";

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
class Declared<R extends RouteName, Success, Query, Payload> extends Data.TaggedClass("Route")<{
  readonly route: R;
  readonly method: Method;
  readonly path: string;
  readonly success?: Success;
  readonly query?: Query;
  readonly payload?: Payload;
  readonly bodiless?: ReadonlyArray<number>;
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
 * was declared.
 *
 * @category models
 */
export type Route<R extends RouteName, Success, Query, Payload> = Declared<R, Success, Query, Payload>;

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
>(
  route: R,
  ...options: Check.Options<R, Success, Query, Payload>
): Route<R, Success, Schema.Struct<Query>, Payload> => {
  const [given] = options;
  const success: Success | undefined = given?.success;
  const query: Query | undefined = given?.query;
  const payload: Payload | undefined = given?.payload;
  const bodiless: ReadonlyArray<number> | undefined = given?.bodiless;

  return new Declared({
    route,
    ...split(route),
    ...(success === undefined ? {} : { success }),
    ...(query === undefined ? {} : { query: Schema.Struct(query) }),
    ...(payload === undefined ? {} : { payload }),
    ...(bodiless === undefined ? {} : { bodiless }),
  });
};
