// The compile-time checks of `route`, read from `@octokit/openapi-types`, GitHub's REST description made into types.
// Types only: nothing here is a value, and the package is imported with `import type`, so none of it ships. Octokit
// writes each route under `paths` as an operation with `parameters`, `requestBody` and `responses`; a check below reads
// one of those and is `unknown` when the caller's declaration holds, or a `Refused` text when it does not, so an argument
// typed `Schema & FitsX<...>` stops compiling at the caller's own field.
import type { paths } from "@octokit/openapi-types";
import type { Option, Schema } from "effect";

type Method = "get" | "put" | "post" | "patch" | "delete";

/** Every route text GitHub's description has, such as `"POST /repos/{owner}/{repo}/issues"`. */
export type RouteName = {
  [P in keyof paths & string]: { [V in Method & keyof paths[P]]: `${Uppercase<V>} ${P}` }[Method & keyof paths[P]];
}[keyof paths & string];

type Operation<R extends RouteName> = R extends `${infer V} ${infer P}`
  ? P extends keyof paths
    ? Lowercase<V> extends keyof paths[P]
      ? paths[P][Lowercase<V>]
      : never
    : never
  : never;

/** The names inside a route text's braces: `"owner" | "repo" | "run_id"`. */
export type PathNames<T> = T extends `${string}{${infer N}}${infer Rest}` ? N | PathNames<Rest> : never;

type PathTypes<O> = O extends { readonly parameters: { readonly path: infer P } } ? P : unknown;

/** The path parameters of a route: the names come from its text, and each value's type from the description. */
export type Params<R extends RouteName> = {
  readonly [K in PathNames<R>]: K extends keyof PathTypes<Operation<R>> ? PathTypes<Operation<R>>[K] : never;
};

export type QueryParams<R extends RouteName> =
  Operation<R> extends { readonly parameters: infer P }
    ? "query" extends keyof P
      ? NonNullable<P["query"]>
      : never
    : never;

type HasRequired<T> = [T] extends [never] ? false : Partial<T> extends T ? false : true;

export type Body<R extends RouteName> = "requestBody" extends keyof Operation<R>
  ? NonNullable<Operation<R>["requestBody"]> extends { readonly content: { readonly "application/json": infer B } }
    ? B
    : never
  : never;

export type BodyRequired<R extends RouteName> = "requestBody" extends keyof Operation<R>
  ? HasRequired<Pick<Operation<R>, "requestBody">>
  : false;

type Responses<R extends RouteName> = Operation<R> extends { readonly responses: infer S } ? S : never;

/** The 2xx statuses a route answers with. */
export type SuccessStatus<R extends RouteName> = {
  [S in keyof Responses<R> & number]: `${S}` extends `2${string}` ? S : never;
}[keyof Responses<R> & number];

type Content<R extends RouteName, S extends SuccessStatus<R>> = Responses<R>[S] extends {
  readonly content: infer C;
}
  ? C
  : never;

/** The 2xx statuses that carry no body. */
export type Bodiless<R extends RouteName> = {
  [S in SuccessStatus<R>]: [Content<R, S>] extends [never] ? S : never;
}[SuccessStatus<R>];

type JsonStatus<R extends RouteName> = {
  [S in SuccessStatus<R>]: [Content<R, S>] extends [never]
    ? never
    : Content<R, S> extends { readonly "application/json": unknown }
      ? S
      : never;
}[SuccessStatus<R>];

type OtherStatus<R extends RouteName> = Exclude<SuccessStatus<R>, Bodiless<R> | JsonStatus<R>>;

/** The union of the JSON bodies of every 2xx status. A status with no body, or a body that is not JSON, adds no member. */
type Answer<R extends RouteName> = {
  [S in JsonStatus<R>]: Content<R, S> extends { readonly "application/json": infer J } ? J : never;
}[JsonStatus<R>];

// An object with an index signature of values GitHub may send is open: any key fits it. One whose values are `never`
// is the description's way to write an object with nothing in it.
type IsOpen<D> = unknown extends D
  ? true
  : string extends keyof D
    ? [D[string]] extends [never]
      ? false
      : true
    : false;

type AnyOpen<D> = true extends (D extends unknown ? IsOpen<D> : never) ? true : false;

type IsRunTimeOnly<R extends RouteName> = [SuccessStatus<R>] extends [never]
  ? true
  : [OtherStatus<R>] extends [never]
    ? AnyOpen<Answer<R>>
    : true;

/** The routes whose answer is checked at run time only: no 2xx status, a 2xx that is not JSON, or an open JSON object. */
export type RunTimeOnly = { [R in RouteName]: IsRunTimeOnly<R> extends true ? R : never }[RouteName];

type Fields = Schema.Struct.Fields;

/** Why a check refused, written so the compiler's message reads as a sentence at the caller's field. */
type Refused<Why extends string> = { readonly "GitHub's description refuses this": Why };

// What the description's object members of D are, with the arrays and the open ones put to one side.
type ObjectMembers<D> = D extends ReadonlyArray<unknown> ? never : D extends object ? D : never;

type ArrayItem<D> = D extends ReadonlyArray<infer I> ? I : never;

// A key the description sends: not one the `XOR` helper adds as `?: never`, nor one of an empty object's non-keys.
type Keys<D> = D extends unknown
  ? { [K in keyof D]-?: [Exclude<D[K], undefined>] extends [never] ? never : K }[keyof D]
  : never;

type Child<D, K> = D extends unknown ? (K extends keyof D ? Exclude<D[K], undefined> : never) : never;

// Walks the Schema's encoded type E beside the description's type D, and gives every key and value D does not have, or
// `never` when none. The walk accepts anything where D is `unknown` or open, or where the caller reads E as `unknown`;
// `null` is left aside; with `Leaves` off it checks keys only, since a payload's values are checked by assignability.
type Walk<E, D, Leaves extends boolean> = unknown extends D
  ? never
  : unknown extends E
    ? never
    : E extends null | undefined
      ? never
      : E extends ReadonlyArray<infer I>
        ? [ArrayItem<D>] extends [never]
          ? E
          : Walk<I, ArrayItem<D>, Leaves>
        : E extends object
          ? [ObjectMembers<D>] extends [never]
            ? E
            : AnyOpen<ObjectMembers<D>> extends true
              ? never
              : {
                  [K in keyof E & string]-?: K extends Keys<ObjectMembers<D>>
                    ? Walk<Exclude<E[K], undefined>, Child<ObjectMembers<D>, K>, Leaves>
                    : K;
                }[keyof E & string]
          : Leaves extends true
            ? [E] extends [D]
              ? never
              : E
            : never;

// What the caller's Schema sends: its encoded type, mutable at every depth (a Schema's arrays are readonly, Octokit's are
// not), and with `undefined` taken out of each optional key only, since a key left out is dropped before it is sent. A
// required key that may be `undefined` stays so: GitHub would never get a value for it.
type IsOptional<T, K extends keyof T> = Partial<Pick<T, K>> extends Pick<T, K> ? true : false;

type Sent<T> =
  T extends ReadonlyArray<infer I>
    ? Array<Sent<I>>
    : T extends object
      ? {
          -readonly [K in keyof T as IsOptional<T, K> extends true ? never : K]: Sent<T[K]>;
        } & {
          -readonly [K in keyof T as IsOptional<T, K> extends true ? K : never]?: Sent<Exclude<T[K], undefined>>;
        }
      : T;

type Encoded<S extends Schema.Constraint> = Sent<S["Encoded"]>;

type FitsQuery<R extends RouteName, Q extends Fields> = [Exclude<keyof Q, keyof QueryParams<R>>] extends [never]
  ? [Encoded<Schema.Struct<Q>>] extends [QueryParams<R>]
    ? unknown
    : Refused<"a query value it never takes, or a required one left out or declared optional">
  : Refused<"a query key it does not have">;

type FitsPayload<R extends RouteName, P extends Schema.Constraint> = [Encoded<P>] extends [Body<R>]
  ? [Walk<Encoded<P>, Body<R>, false>] extends [never]
    ? unknown
    : Refused<"a payload key its body does not have">
  : Refused<"a payload that is missing a key its body requires, or has a value it never takes">;

type FitsAnswer<R extends RouteName, S extends Schema.Constraint> = [Walk<S["Encoded"], Answer<R>, true>] extends [
  never,
]
  ? unknown
  : Refused<"an answer field or value it never sends">;

type QueryPart<R extends RouteName, Q extends Fields> = [QueryParams<R>] extends [never]
  ? { readonly query?: never }
  : HasRequired<QueryParams<R>> extends true
    ? { readonly query: Q & FitsQuery<R, Q> }
    : { readonly query?: Q & FitsQuery<R, Q> };

type PayloadPart<R extends RouteName, P extends Schema.Constraint> = [Body<R>] extends [never]
  ? { readonly payload?: never }
  : BodyRequired<R> extends true
    ? { readonly payload: P & FitsPayload<R, P> }
    : { readonly payload?: P & FitsPayload<R, P> };

type SuccessPart<R extends RouteName, S extends Schema.Constraint> =
  IsRunTimeOnly<R> extends true
    ? { readonly success?: S }
    : [Answer<R>] extends [never]
      ? { readonly success?: never }
      : { readonly success?: S & FitsAnswer<R, S> };

// A route with a body-less 2xx beside a 2xx with a body must say which statuses have none: the types know it, and a run
// does not, so the declaration carries it as a value that the compiler holds to the types.
type BodilessPart<R extends RouteName> = [Bodiless<R>] extends [never]
  ? { readonly bodiless?: never }
  : [Exclude<SuccessStatus<R>, Bodiless<R>>] extends [never]
    ? { readonly bodiless?: never }
    : { readonly bodiless: readonly [Bodiless<R>, ...Array<Bodiless<R>>] };

/** What a caller may pass to `route` after the route text, each part by the description's rules. */
type Declaration<
  R extends RouteName,
  S extends Schema.Constraint,
  Q extends Fields,
  P extends Schema.Constraint,
> = QueryPart<R, Q> & PayloadPart<R, P> & SuccessPart<R, S> & BodilessPart<R>;

type Needs<R extends RouteName> =
  HasRequired<QueryParams<R>> extends true
    ? true
    : BodyRequired<R> extends true
      ? true
      : [Bodiless<R>] extends [never]
        ? false
        : [Exclude<SuccessStatus<R>, Bodiless<R>>] extends [never]
          ? false
          : true;

/** The arguments of `route` after the route text: present exactly when the description requires a part. */
export type Options<R extends RouteName, S extends Schema.Constraint, Q extends Fields, P extends Schema.Constraint> =
  Needs<R> extends true ? [options: Declaration<R, S, Q, P>] : [options?: Declaration<R, S, Q, P>];

type Absent<K extends string> = { readonly [P in K]?: never };

type ParamsIn<R extends RouteName> = [PathNames<R>] extends [never] ? Absent<"params"> : { readonly params: Params<R> };

type QueryIn<Q extends Schema.Constraint> = [keyof Q["Type"]] extends [never]
  ? Absent<"query">
  : HasRequired<Q["Type"]> extends true
    ? { readonly query: Q["Type"] }
    : { readonly query?: Q["Type"] };

type PayloadIn<R extends RouteName, P extends Schema.Constraint> = [P] extends [never]
  ? Absent<"payload">
  : BodyRequired<R> extends true
    ? { readonly payload: P["Type"] }
    : { readonly payload?: P["Type"] };

/** What a caller hands `call`: each part is there exactly when the route declared it, and a payload is the decoded type. */
export type Input<R extends RouteName, Q extends Schema.Constraint, P extends Schema.Constraint> = ParamsIn<R> &
  QueryIn<Q> &
  PayloadIn<R, P>;

/** What `call` gives: `void` with no success declared, the decoded success, or an `Option` of it beside a body-less 2xx. */
export type Returned<R extends RouteName, S extends Schema.Constraint> = [S] extends [never]
  ? void
  : [Bodiless<R>] extends [never]
    ? S["Type"]
    : Option.Option<S["Type"]>;

/** The services a route's Schemas need: to encode its query and payload, and to decode its success. */
export type Needed<Q extends Schema.Constraint, P extends Schema.Constraint, S extends Schema.Constraint> =
  | Q["EncodingServices"]
  | P["EncodingServices"]
  | S["DecodingServices"];

// A route the shape does not have reads as neither 1 nor 0, so the whole version is `never`.
type Has<K, T> = [T] extends [never] ? "missing" : K extends keyof T ? 1 : 0;

type DispatchBody<P> = P extends {
  readonly "/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches": {
    readonly post: { readonly requestBody: { readonly content: { readonly "application/json": infer B } } };
  };
}
  ? B
  : never;

type DispatchResponses<P> = P extends {
  readonly "/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches": {
    readonly post: { readonly responses: infer S };
  };
}
  ? S
  : never;

type PullRequestAnswer<P> = P extends {
  readonly "/repos/{owner}/{repo}/pulls/{pull_number}": {
    readonly get: {
      readonly responses: { readonly 200: { readonly content: { readonly "application/json": infer A } } };
    };
  };
}
  ? A
  : never;

/**
 * The REST API version a `paths` type describes, read from three changes the version 2026-03-10 made: the dispatch's
 * `return_run_details` key and its 204, and the pull request's `merge_commit_sha`. A `paths` with all three is
 * 2022-11-28, one with none is 2026-03-10, and a mix is `never`, so a partial move is refused too.
 */
export type DescribedVersion<P> = Version<
  Has<"return_run_details", DispatchBody<P>>,
  Has<204, DispatchResponses<P>>,
  Has<"merge_commit_sha", PullRequestAnswer<P>>
>;

type Version<Details, Empty, Merge> = [Details, Empty, Merge] extends [1, 1, 1]
  ? "2022-11-28"
  : [Details, Empty, Merge] extends [0, 0, 0]
    ? "2026-03-10"
    : never;

/** The REST API version the pinned types describe. */
export type ApiVersion = DescribedVersion<paths>;
