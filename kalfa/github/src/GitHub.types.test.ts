// T1 to T4, T6 and T10: what `GitHub.route` accepts and refuses, over real routes of GitHub's REST description as
// `@octokit/openapi-types` 29.0.1 types it. They are checked by the compiler (`tsc`, and the root `typecheck`), not by a
// test run: each `@ts-expect-error` below is a typo the ticket names, and it must stay a compile error. The vectors are in
// Octokit.test-support.ts. Each helper holds one law's lines, and its `it` only names the helper.
import { expectTypeOf, it } from "@effect/vitest";
import type { Context, Duration } from "effect";
import { Data, DateTime, type Effect, type Option, Redacted, Schema, SchemaGetter } from "effect";
import type { ListCheckRuns, Shouter, ShoutedAnswer, ShoutedIssue, ShoutedQuery } from "./GitHub.test-support.ts";
import { Dispatch, DispatchUnread, ShoutedRuns } from "./GitHub.test-support.ts";
import * as GitHub from "./GitHub.ts";
import type * as Check from "./internal/Check.ts";
import type { VECTORS } from "./Octokit.test-support.ts";
import {
  CANCEL,
  CHECK_RUNS,
  CONTRIBUTORS,
  CREATE_ISSUE,
  DELETE_COMMENT,
  DELETE_ORG,
  DISPATCH,
  GET_BRANCH,
  GET_PULL,
  GET_REPO,
  INSTALLATION_TOKEN,
  LANGUAGES,
  MERGE_RESULT,
  README,
  SEARCH_ISSUES,
  STAR,
  UPDATE_ISSUE,
  ZEN,
} from "./Octokit.test-support.ts";

// A caller's Schemas, written the way a caller writes them: only the fields it reads.
const CheckRun = Schema.Struct({
  id: Schema.Finite,
  name: Schema.String,
  status: Schema.Literals(["queued", "in_progress", "completed"]),
  conclusion: Schema.NullOr(Schema.Literals(["success", "failure", "cancelled"])),
});

const IssuePayload = Schema.Struct({
  title: Schema.String,
  body: Schema.optionalKey(Schema.String),
  labels: Schema.Array(Schema.String),
});

const DispatchPayload = Schema.Struct({ ref: Schema.String, inputs: Schema.Struct({ any: Schema.String }) });

// T1. Plant: widen `RouteName` to `${Method} ${string}`, and every `@ts-expect-error` below is unused.
const routeText = () => {
  // Each vector compiles, with the options its shape asks for.
  const compiled = [
    GitHub.route(CANCEL),
    GitHub.route(CHECK_RUNS),
    GitHub.route(CREATE_ISSUE, { payload: IssuePayload }),
    GitHub.route(INSTALLATION_TOKEN),
    GitHub.route(DISPATCH, { payload: DispatchPayload, bodiless: [204] }),
    GitHub.route(GET_BRANCH),
    GitHub.route(GET_PULL),
    GitHub.route(ZEN, { body: "text" }),
    GitHub.route(LANGUAGES),
    GitHub.route(DELETE_ORG),
    GitHub.route(STAR),
    GitHub.route(UPDATE_ISSUE),
    GitHub.route(DELETE_COMMENT),
  ];

  expectTypeOf(compiled).toBeArray();
  expectTypeOf<GitHub.RouteName>().toEqualTypeOf<Check.RouteName>();
  expectTypeOf<GitHub.Method>().toEqualTypeOf<"GET" | "PUT" | "POST" | "PATCH" | "DELETE">();

  // The same refusals said of the type itself, so they hold whatever else a call's options say: every real route is a
  // `RouteName`, and each typo is not.
  expectTypeOf<(typeof VECTORS)[number]["route"]>().toExtend<GitHub.RouteName>();
  expectTypeOf<"GET /repos/{owner}/{repo}/commits/{ref}/check-rnus">().not.toExtend<GitHub.RouteName>();
  expectTypeOf<"GET /repos/{owner}/{repo}/actions/runs/{run_id}/cancel">().not.toExtend<GitHub.RouteName>();
  expectTypeOf<"get /zen">().not.toExtend<GitHub.RouteName>();
  expectTypeOf<"GET /repos/{owner}/{repo}/commits/{ref}/check-runs/">().not.toExtend<GitHub.RouteName>();
  expectTypeOf<"POST /repos/{owner}/{repo}/actions/runs/{id}/cancel">().not.toExtend<GitHub.RouteName>();
  expectTypeOf<"GET /zen ">().not.toExtend<GitHub.RouteName>();
  expectTypeOf<"">().not.toExtend<GitHub.RouteName>();

  // @ts-expect-error a misspelled path segment
  GitHub.route("GET /repos/{owner}/{repo}/commits/{ref}/check-rnus");
  // @ts-expect-error the cancel path has no GET
  GitHub.route("GET /repos/{owner}/{repo}/actions/runs/{run_id}/cancel");
  // @ts-expect-error a lowercase method
  GitHub.route("get /zen");
  // @ts-expect-error a trailing slash
  GitHub.route("GET /repos/{owner}/{repo}/commits/{ref}/check-runs/");
  // @ts-expect-error a brace name changed: {id} for {run_id}
  GitHub.route("POST /repos/{owner}/{repo}/actions/runs/{id}/cancel");
  // @ts-expect-error a trailing space
  GitHub.route("GET /zen ");
  // @ts-expect-error no route text at all
  GitHub.route("");
};

// T2. Plant: type `params` as `Record<PathNames<R>, string | number>`, and the `run_id: true` line compiles; read the
// names from the description and not the route text, and the brace line of T1 compiles.
const pathParameters = () => {
  type CancelParams = Check.Params<typeof CANCEL>;

  expectTypeOf<CancelParams>().toEqualTypeOf<{
    readonly owner: string;
    readonly repo: string;
    readonly run_id: number;
  }>();
  expectTypeOf<Check.PathNames<typeof CANCEL>>().toEqualTypeOf<"owner" | "repo" | "run_id">();
  expectTypeOf<Check.PathNames<typeof ZEN>>().toEqualTypeOf<never>();
  expectTypeOf<keyof Check.Params<typeof ZEN>>().toEqualTypeOf<never>();

  const good: CancelParams = { owner: "o", repo: "r", run_id: 1 };
  // @ts-expect-error a missing run_id
  const missing: CancelParams = { owner: "o", repo: "r" };
  // @ts-expect-error a misspelled runId
  const misspelled: CancelParams = { owner: "o", repo: "r", runId: 1 };
  // @ts-expect-error an extra key
  const extra: CancelParams = { owner: "o", repo: "r", run_id: 1, page: 2 };
  // @ts-expect-error run_id is a number
  const boolean: CancelParams = { owner: "o", repo: "r", run_id: true };

  expectTypeOf([good, missing, misspelled, extra, boolean]).toBeArray();
};

// T3. Plant: check only that the key exists, and the `Schema.String` line compiles.
const queryKeys = () => {
  const ok = GitHub.route(CHECK_RUNS, {
    query: { per_page: Schema.Int, status: Schema.Literals(["queued"]) },
  });

  // @ts-expect-error a misspelled query key
  GitHub.route(CHECK_RUNS, { query: { per_pag: Schema.Int } });
  // @ts-expect-error per_page is a number
  GitHub.route(CHECK_RUNS, { query: { per_page: Schema.String } });
  // @ts-expect-error a status GitHub never takes
  GitHub.route(CHECK_RUNS, { query: { status: Schema.Literals(["queud"]) } });
  // @ts-expect-error the cancel route has no query at all
  GitHub.route(CANCEL, { query: { per_page: Schema.Int } });

  // A required query parameter must be declared, and declared required.
  const search = GitHub.route(SEARCH_ISSUES, { query: { q: Schema.String } });
  // @ts-expect-error `q` is required and not declared
  GitHub.route(SEARCH_ISSUES);
  // @ts-expect-error `q` is required, and an options object that leaves it out is not enough
  GitHub.route(SEARCH_ISSUES, {});
  // @ts-expect-error `q` is required, and a value of `undefined` is dropped before it is sent, so it never reaches GitHub
  GitHub.route(SEARCH_ISSUES, { query: { q: Schema.UndefinedOr(Schema.String) } });
  // @ts-expect-error `q` is declared optional
  GitHub.route(SEARCH_ISSUES, { query: { q: Schema.optionalKey(Schema.String) } });

  expectTypeOf([ok, search]).toBeArray();
};

// T4. Plant: check top-level keys only, and the `permissions` line compiles; treat an index signature as closed, and the
// `inputs` line fails; drop `Types.DeepMutable`, and the `labels` line fails on readonly against mutable.
const payloadKeys = () => {
  const ok = GitHub.route(CREATE_ISSUE, { payload: IssuePayload });
  // @ts-expect-error a misspelled key (and `title` missing)
  GitHub.route(CREATE_ISSUE, { payload: Schema.Struct({ titel: Schema.String }) });
  // @ts-expect-error `title` is required
  GitHub.route(CREATE_ISSUE, { payload: Schema.Struct({ body: Schema.String }) });

  // An optional field is accepted in either spelling: `Schema.optional` also encodes `undefined`.
  const optionalBody = GitHub.route(CREATE_ISSUE, {
    payload: Schema.Struct({ title: Schema.String, body: Schema.optional(Schema.String) }),
  });

  const optionalPermissions = GitHub.route(INSTALLATION_TOKEN, {
    payload: Schema.Struct({ permissions: Schema.optional(Schema.Struct({ issues: Schema.Literals(["read"]) })) }),
  });

  expectTypeOf([optionalBody, optionalPermissions]).toBeArray();

  const beside = Schema.Struct({ title: Schema.String, titel: Schema.String });
  // @ts-expect-error a key GitHub's body lacks, beside every key it requires
  GitHub.route(CREATE_ISSUE, { payload: beside });
  // @ts-expect-error labels is a list of texts
  GitHub.route(CREATE_ISSUE, { payload: Schema.Struct({ title: Schema.String, labels: Schema.Finite }) });
  // @ts-expect-error the cancel route has no body
  GitHub.route(CANCEL, { payload: IssuePayload });
  // @ts-expect-error a route whose body is required cannot be declared without one
  GitHub.route(CREATE_ISSUE);
  // @ts-expect-error `title` is required, and a value of `undefined` is dropped before it is sent
  GitHub.route(CREATE_ISSUE, { payload: Schema.Struct({ title: Schema.UndefinedOr(Schema.String) }) });
  // @ts-expect-error nor with an options object that leaves the payload out
  GitHub.route(CREATE_ISSUE, {});

  // Closed at every depth: the token's `permissions` is a nested object with named keys.
  const token = GitHub.route(INSTALLATION_TOKEN, {
    payload: Schema.Struct({ permissions: Schema.Struct({ issues: Schema.Literals(["read"]) }) }),
  });

  const unknown = Schema.Struct({
    permissions: Schema.Struct({ issues: Schema.Literals(["read"]), nope: Schema.String }),
  });

  // @ts-expect-error an unknown key inside `permissions`
  GitHub.route(INSTALLATION_TOKEN, { payload: unknown });

  // Where the description leaves an object open, any key fits below it.
  const inputs = GitHub.route(DISPATCH, {
    payload: Schema.Struct({ ref: Schema.String, inputs: Schema.Struct({ a: Schema.String, b: Schema.Boolean }) }),
    bodiless: [204],
  });

  expectTypeOf([ok, token, inputs]).toBeArray();
};

// T6. Plant: stop the walk after one level, and the `nmae` line compiles; skip the leaf rule, and the misspelled literal
// compiles; treat an index signature as closed, and the languages line fails; read only the first member of a `OneOf`,
// and the `sha` line fails.
const answerFields = () => {
  const ok = GitHub.route(CHECK_RUNS, { success: Schema.Struct({ check_runs: Schema.Array(CheckRun) }) });
  const success = Schema.Struct({ check_rnus: Schema.Array(CheckRun) });
  // @ts-expect-error a misspelled field
  GitHub.route(CHECK_RUNS, { success });
  const nested = Schema.Struct({ check_runs: Schema.Array(Schema.Struct({ nmae: Schema.String })) });
  // @ts-expect-error a misspelled field two levels down
  GitHub.route(CHECK_RUNS, { success: nested });

  const literal = Schema.Struct({
    check_runs: Schema.Array(Schema.Struct({ status: Schema.Literals(["complted"]) })),
  });

  // @ts-expect-error a status GitHub never sends
  GitHub.route(CHECK_RUNS, { success: literal });
  const text = Schema.Struct({ check_runs: Schema.Array(Schema.Struct({ id: Schema.String })) });
  // @ts-expect-error an id is a number, not a text
  GitHub.route(CHECK_RUNS, { success: text });

  // GitHub's `int64` is `number | bigint`; a number fits it. A null on a field GitHub never sends null still compiles.
  const loose = Schema.Struct({
    check_runs: Schema.Array(Schema.Struct({ id: Schema.Finite, name: Schema.NullOr(Schema.String) })),
  });

  const compiles = GitHub.route(CHECK_RUNS, { success: loose });

  // A route whose 2xx answers all have no body takes no `success`.
  // @ts-expect-error the delete answers 204
  GitHub.route(DELETE_COMMENT, { success: Schema.Struct({}) });

  // A bare object schema is a closed empty object: only `Schema.Struct({})` fits it.
  const empty = GitHub.route(DELETE_ORG, { success: Schema.Struct({}) });
  // @ts-expect-error a field on a 202 that GitHub answers with an empty object
  GitHub.route(DELETE_ORG, { success: Schema.Struct({ accepted: Schema.Boolean }) });
  // @ts-expect-error nor a field of any value (`unknown` is read by no leaf rule)
  GitHub.route(DELETE_ORG, { success: Schema.Struct({ accepted: Schema.Unknown }) });

  // A part of the description that is open is checked at run time only: anything fits.
  const zen = GitHub.route(ZEN, { body: "text", success: Schema.String });
  const languages = GitHub.route(LANGUAGES, { success: Schema.Struct({ anything: Schema.Finite }) });

  // A field found in one member of a `OneOf` answer compiles; one found in no member does not.
  const result = GitHub.route(MERGE_RESULT, {
    success: Schema.Struct({
      status: Schema.Literals(["merged"]),
      details: Schema.Struct({ message: Schema.String, sha: Schema.String }),
    }),
  });

  const other = Schema.Struct({ details: Schema.Struct({ expected_head_sha: Schema.String }) });
  const kept = GitHub.route(MERGE_RESULT, { success: other });
  const nowhere = Schema.Struct({ details: Schema.Struct({ shaa: Schema.String }) });
  // @ts-expect-error a field no member of the `OneOf` has
  GitHub.route(MERGE_RESULT, { success: nowhere });

  expectTypeOf([ok, compiles, empty, zen, languages, result, kept]).toBeArray();
};

// T10. Plant: make `bodiless` optional everywhere, and the dispatch line without it compiles; export the brand symbol's
// type as a plain string key, and the literal line compiles.
const bodilessAndBrand = () => {
  const ok = GitHub.route(DISPATCH, { payload: DispatchPayload, bodiless: [204] });
  // @ts-expect-error the dispatch has a 204 and a 200, so it must say which has no body
  GitHub.route(DISPATCH, { payload: DispatchPayload });
  // @ts-expect-error 200 is the status that has a body
  GitHub.route(DISPATCH, { payload: DispatchPayload, bodiless: [200] });
  // The contributors route answers a 200 with a body or a 204 with none and takes no body of its own: only the 2xx
  // statuses ask for `bodiless`.
  const contributors = GitHub.route(CONTRIBUTORS, { bodiless: [204] });
  // @ts-expect-error a 200 beside a 204 must say which has no body, though nothing else on the route is required
  GitHub.route(CONTRIBUTORS);
  // @ts-expect-error check runs answers only a 200, so it has nothing to name
  GitHub.route(CHECK_RUNS, { bodiless: [204] });

  // The dispatch's 200 body may be declared beside its 204.
  const both = GitHub.route(DISPATCH, {
    payload: DispatchPayload,
    success: Schema.Struct({ workflow_run_id: Schema.Finite }),
    bodiless: [204],
  });

  // Only `route` makes a `Route`: an object with the same visible keys is not one.
  const zen = GitHub.route(ZEN, { body: "text" });
  const made: typeof zen = zen;
  // @ts-expect-error the literal has no brand
  // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- the law writes the look-alike a hand would write
  const literal: typeof zen = { _tag: "Route", route: ZEN, method: "GET", path: "/zen" };

  expectTypeOf([ok, both, contributors, made, literal]).toBeArray();
  expectTypeOf(zen.route).toEqualTypeOf<typeof ZEN>();
  expectTypeOf(zen.method).toEqualTypeOf<GitHub.Method>();
};

it("T1 type: route takes only a route text GitHub's description has, in its own spelling", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(routeText).toBeFunction();
});

it("T2 type: the path parameters are the brace names of the text, each typed by the description", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(pathParameters).toBeFunction();
});

it("T3 type: a query key is one of the route's, with a value type GitHub takes", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(queryKeys).toBeFunction();
});

it("T4 type: a payload is closed at every depth and fits the description's body", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(payloadKeys).toBeFunction();
});

it("T6 type: a success Schema names only fields and values the description's answer has", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(answerFields).toBeFunction();
});

it("T10 type: a route with a body-less 2xx beside a body 2xx names it, and only route makes a Route", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(bodilessAndBrand).toBeFunction();
});

// ---- T5, T7 and T8: `GitHub.call`

type Needs<E> = E extends Effect.Effect<unknown, unknown, infer R> ? R : never;

type Failed<E> = E extends Effect.Effect<unknown, infer F, unknown> ? F : never;

type Done<E> = E extends Effect.Effect<infer A, unknown, unknown> ? A : never;

type Failures = GitHub.GitHubError | GitHub.RateLimited;

const RepoParams = { owner: "o", repo: "r" } as const;

const cancel = GitHub.route(CANCEL);

const zen = GitHub.route(ZEN, { body: "text" });

const issue = GitHub.route(CREATE_ISSUE, {
  payload: Schema.Struct({ title: Schema.String, body: Schema.optionalKey(Schema.String) }),
});

const token = GitHub.route(INSTALLATION_TOKEN, {
  payload: Schema.Struct({ repositories: Schema.optionalKey(Schema.Array(Schema.String)) }),
});

const search = GitHub.route(SEARCH_ISSUES, { query: { q: Schema.String } });

const optionalQuery = GitHub.route(CHECK_RUNS, { query: { status: Schema.optionalKey(Schema.Literals(["queued"])) } });

// The decoded type is not the encoded one: a date a caller holds as a DateTime, GitHub reads as text.
const dated = GitHub.route(CREATE_ISSUE, { payload: Schema.Struct({ title: Schema.DateTimeUtcFromString }) });

// T5. Plant: make every input key optional, and the lines that leave out `params`, `payload` or a required query key compile;
// type `payload` as the Schema's encoded type, and the `dated` lines swap.
const inputs = () => {
  const ok = [
    GitHub.call(cancel, { params: { ...RepoParams, run_id: 1 } }),
    GitHub.call(issue, { params: RepoParams, payload: { title: "t" } }),
    // The token's body is optional in the description, so the input takes `payload` or leaves it out.
    GitHub.call(token, { params: { installation_id: 1 } }),
    GitHub.call(token, { params: { installation_id: 1 }, payload: { repositories: ["a"] } }),
    // A route with no path name has no `params`.
    GitHub.call(zen, {}),
    GitHub.call(search, { query: { q: "is:open" } }),
    GitHub.call(optionalQuery, { params: { ...RepoParams, ref: "main" } }),
    GitHub.call(dated, { params: RepoParams, payload: { title: DateTime.makeUnsafe(0) } }),
  ];

  // @ts-expect-error a payload literal with a key the Schema does not have
  const refused1 = GitHub.call(issue, { params: RepoParams, payload: { title: "t", titel: "x" } });
  // @ts-expect-error the issue route requires its payload
  const refused2 = GitHub.call(issue, { params: RepoParams });
  // @ts-expect-error a payload is the decoded type: a DateTime, not the text it is sent as
  const refused3 = GitHub.call(dated, { params: RepoParams, payload: { title: "2026-01-01T00:00:00.000Z" } });
  // @ts-expect-error a route with no path name has no `params` key
  const refused4 = GitHub.call(zen, { params: {} });
  // @ts-expect-error a route with path names requires `params`
  const refused5 = GitHub.call(cancel, {});
  // @ts-expect-error a path name left out
  const refused6 = GitHub.call(cancel, { params: RepoParams });
  // @ts-expect-error a route that declared no query takes none
  const refused7 = GitHub.call(cancel, { params: { ...RepoParams, run_id: 1 }, query: {} });
  // @ts-expect-error a query with a required key requires `query`
  const refused8 = GitHub.call(search, {});
  // @ts-expect-error a query key the route did not declare
  const refused9 = GitHub.call(search, { query: { q: "x", page: 1 } });
  // @ts-expect-error a route that declared no payload takes none
  const refused10 = GitHub.call(cancel, { params: { ...RepoParams, run_id: 1 }, payload: {} });

  // The input is exactly what the route declared: the path names, and nothing else for the cancel route.
  expectTypeOf<GitHub.Input<typeof cancel>>().toExtend<{ readonly params: Check.Params<typeof CANCEL> }>();
  expectTypeOf<{ readonly params: Check.Params<typeof CANCEL> }>().toExtend<GitHub.Input<typeof cancel>>();
  expectTypeOf<GitHub.Input<typeof issue>["payload"]>().toEqualTypeOf<{
    readonly title: string;
    readonly body?: string;
  }>();

  expectTypeOf([
    ok,
    refused1,
    refused2,
    refused3,
    refused4,
    refused5,
    refused6,
    refused7,
    refused8,
    refused9,
    refused10,
  ]).toBeArray();
};

// T7. Plant: leave `Services<Op>` out of the requirements, and the service lines fail; answer the plain type on a route with a
// body-less 2xx, and the `Option` line fails.
const callType = () => {
  const answered = Schema.Struct({ check_runs: Schema.Array(Schema.Struct({ id: Schema.Int })) });
  const withSuccess = GitHub.route(CHECK_RUNS, { success: answered });
  const params = { ...RepoParams, ref: "main" };

  expectTypeOf(GitHub.call(withSuccess, { params })).toEqualTypeOf<
    Effect.Effect<typeof answered.Type, Failures, GitHub.GitHub>
  >();
  // A route declared with no `success` answers `void`.
  expectTypeOf(GitHub.call(cancel, { params: { ...RepoParams, run_id: 1 } })).toEqualTypeOf<
    Effect.Effect<void, Failures, GitHub.GitHub>
  >();
  expectTypeOf(GitHub.call(zen, {})).toEqualTypeOf<Effect.Effect<void, Failures, GitHub.GitHub>>();
  expectTypeOf(
    GitHub.call(DispatchUnread, { params: { ...RepoParams, workflow_id: "w" }, payload: { ref: "main" } }),
  ).toEqualTypeOf<Effect.Effect<void, Failures, GitHub.GitHub>>();
  // A route with a 2xx that has no body, and a success declared: the answer is the success or none.
  const dispatched = GitHub.call(Dispatch, { params: { ...RepoParams, workflow_id: "w" }, payload: { ref: "main" } });

  expectTypeOf<Done<typeof dispatched>>().toEqualTypeOf<
    Option.Option<{ readonly workflow_run_id: number; readonly run_url: string }>
  >();
  expectTypeOf<Failed<typeof dispatched>>().toEqualTypeOf<Failures>();

  // A Schema whose work needs a service shows that service in what the call needs, and in `Services`.
  const shouted = GitHub.call(ShoutedRuns, { params, query: { per_page: 1, check_name: "n" } });

  expectTypeOf<Needs<typeof shouted>>().toEqualTypeOf<GitHub.GitHub | Shouter>();
  expectTypeOf<GitHub.Services<typeof ShoutedRuns>>().toEqualTypeOf<Shouter>();
  // The service sits in one part only: the query's encoding, the payload's encoding, or the success's decoding.
  expectTypeOf<GitHub.Services<typeof ShoutedQuery>>().toEqualTypeOf<Shouter>();
  expectTypeOf<GitHub.Services<typeof ShoutedIssue>>().toEqualTypeOf<Shouter>();
  expectTypeOf<GitHub.Services<typeof ShoutedAnswer>>().toEqualTypeOf<Shouter>();
  expectTypeOf<GitHub.Services<typeof cancel>>().toEqualTypeOf<never>();
  expectTypeOf<Failed<typeof shouted>>().toEqualTypeOf<Failures>();
  expectTypeOf<GitHub.Success<typeof cancel>>().toEqualTypeOf<void>();
  expectTypeOf<GitHub.Success<typeof ListCheckRuns>>().toEqualTypeOf<{
    readonly check_runs: ReadonlyArray<{
      readonly id: number;
      readonly name: string;
      readonly status: "queued" | "in_progress" | "completed";
      readonly conclusion: "success" | "failure" | "cancelled" | null;
    }>;
  }>();
};

// An object that has every key a route has but its brand, with the same tag.
class Lookalike extends Data.TaggedClass("Route")<{
  readonly route: typeof ZEN;
  readonly method: "GET";
  readonly path: "/zen";
}> {}

// T8. Plant: type `call`'s first parameter structurally, without the brand, and the literal line compiles.
const onlyRoute = () => {
  // @ts-expect-error an object with a route's visible keys is not a Route
  const refused11 = GitHub.call(new Lookalike({ route: ZEN, method: "GET", path: "/zen" }), {});
  // @ts-expect-error a route text is not a Route
  const refused12 = GitHub.call(ZEN, {});

  expectTypeOf([refused11, refused12]).toBeArray();

  // The service is exactly its two members.
  expectTypeOf<Context.Service.Shape<typeof GitHub.GitHub>>().toEqualTypeOf<{
    readonly send: (request: GitHub.Request) => Effect.Effect<GitHub.Reply, Failures>;
    readonly poll: Duration.Duration;
  }>();
  expectTypeOf<keyof Context.Service.Shape<typeof GitHub.GitHub>>().toEqualTypeOf<"send" | "poll">();
};

it("T5 type: the input of call is the route's parts, each present exactly when the route has it, and its payload is the decoded type", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(inputs).toBeFunction();
});

it("T7 type: call gives the success, or void, or an Option; fails with GitHubError or RateLimited; and needs GitHub and the Schemas' services", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(callType).toBeFunction();
});

it("T8 type: only a Route reaches call, and the GitHub service is exactly send and poll", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(onlyRoute).toBeFunction();
});

// ---- 1945, slice 1: the route's new options and call's own options

// A text read into a Struct: its Schema starts at a string and ends at an object.
const Counted = Schema.String.pipe(
  Schema.decodeTo(Schema.Struct({ length: Schema.Int }), {
    decode: SchemaGetter.transform((text: string) => ({ length: text.length })),
    encode: SchemaGetter.transform(() => ""),
  }),
);

// T14. Plant: make `body` optional on every route, and the `/zen` line with no body compiles; type a text route's success as any
// Schema, and the `Schema.Finite` line compiles; type `auth` as `string`, and the `"nobody"` line compiles; type `auth` as the
// route's own parameter `A`, and the `"login"` line compiles.
const routeOptions = () => {
  const ok = [
    GitHub.route(ZEN, { body: "text" }),
    GitHub.route(ZEN, { body: "text", success: Schema.String }),
    GitHub.route("GET /octocat", { body: "text", success: Schema.String }),
    GitHub.route(ZEN, { body: "text", success: Counted }),
    GitHub.route(README, { body: "text", accept: "application/vnd.github.raw+json", success: Schema.String }),
    GitHub.route(ZEN, { body: "text", auth: "none", success: Schema.String }),
    GitHub.route(GET_REPO, { auth: "none" }),
    GitHub.route(GET_REPO, { accept: "application/vnd.github+json" }),
    GitHub.route(GET_REPO, { body: "json" }),
  ];

  // @ts-expect-error GitHub answers /zen in text, so the route must say so
  const noBody = GitHub.route(ZEN);
  // @ts-expect-error nor does an options object that leaves `body` out say it
  const noBodyOption = GitHub.route(ZEN, { success: Schema.String });
  // @ts-expect-error octocat is text too
  const octocat = GitHub.route("GET /octocat");
  // @ts-expect-error a text answer is read from text, so a Schema that starts at a number does not fit
  const number = GitHub.route(ZEN, { body: "text", success: Schema.Finite });
  // @ts-expect-error `nobody` is no way to send a request
  const nobody = GitHub.route(GET_REPO, { auth: "nobody" });
  // @ts-expect-error `login` is what a route does when it says nothing, so it is no value to write
  const login = GitHub.route(GET_REPO, { auth: "login" });
  // @ts-expect-error `app` is no way this ticket sends a request
  const app = GitHub.route(GET_REPO, { auth: "app" });
  // @ts-expect-error a media type is a text
  const accept = GitHub.route(GET_REPO, { accept: 1 });

  expectTypeOf([ok, noBody, noBodyOption, octocat, number, nobody, login, app, accept]).toBeArray();
  // The route holds what it was declared with, and the defaults when it left the options out.
  expectTypeOf(GitHub.route(ZEN, { body: "text" }).body).toEqualTypeOf<"text">();
  expectTypeOf(GitHub.route(GET_REPO).body).toEqualTypeOf<"json">();
  expectTypeOf(GitHub.route(GET_REPO).auth).toEqualTypeOf<"login">();
  expectTypeOf(GitHub.route(GET_REPO, { auth: "none" }).auth).toEqualTypeOf<"none">();
};

// T15. Plant: type `token` as `string | Redacted.Redacted<string>`, and the plain-text line compiles; read `CallOptions` without
// the route's `auth`, and the `auth: "none"` line compiles.
const callOptions = () => {
  const repo = GitHub.route(GET_REPO, { success: Schema.Struct({ id: Schema.Int }) });
  const zenText = GitHub.route(ZEN, { body: "text", auth: "none", success: Schema.String });
  const params = { owner: "o", repo: "r" } as const;

  const ok = [
    GitHub.call(repo, { params }, { token: Redacted.make("t") }),
    GitHub.call(repo, { params }, {}),
    GitHub.call(repo, { params }),
    GitHub.call(zenText, {}),
    GitHub.call(zenText, {}, {}),
  ];

  // @ts-expect-error a token is a Redacted, never a plain text
  const plain = GitHub.call(repo, { params }, { token: "t" });
  // @ts-expect-error a route that sends no token takes none
  const none = GitHub.call(zenText, {}, { token: Redacted.make("t") });

  expectTypeOf([ok, plain, none]).toBeArray();
  expectTypeOf(GitHub.call(zenText, {})).toEqualTypeOf<Effect.Effect<string, Failures, GitHub.GitHub>>();
  expectTypeOf(GitHub.call(repo, { params }, { token: Redacted.make("t") })).toEqualTypeOf<
    Effect.Effect<{ readonly id: number }, Failures, GitHub.GitHub>
  >();
  expectTypeOf(GitHub.call(repo, { params })).toEqualTypeOf<
    Effect.Effect<{ readonly id: number }, Failures, GitHub.GitHub>
  >();
};

// T17. A route's type holds what its value holds, however the route was built. The value holds the options' `body` and `auth`,
// and `"json"` and `"login"` where they say none, so the type must say exactly that where the options fix it, and both
// values wherever the options leave them open. Judging a `{ token }`: a route that may be `"none"` drops a token, whatever
// else it may be, and a token silently dropped is T15's hole, so a route whose `auth` type includes `"none"` refuses it.
// Plant: read an optional `body` or `auth` key as the default, and the `viaTypeArgument`, `optional` and `fromParameter` lines
// fail; let a route whose `auth` may be `"none"` take a token, and the `maybeNone` lines compile; make the options never
// required, and the `bareText` line compiles.
type None = Record<never, never>;

type Open = { readonly body?: "text"; readonly auth?: "none" };

type Params = { readonly owner: string; readonly repo: string };

const input = { params: { owner: "o", repo: "r" } } satisfies { readonly params: Params };

const everyWay = () => {
  // No options, and literal options.
  const bare = GitHub.route(GET_REPO);
  const text = GitHub.route(GET_REPO, { body: "text" });
  const none = GitHub.route(GET_REPO, { auth: "none" });
  const both = GitHub.route(GET_REPO, { body: "text", auth: "none" });
  const zen = GitHub.route(ZEN, { body: "text" });
  expectTypeOf(bare.body).toEqualTypeOf<"json">();
  expectTypeOf(bare.auth).toEqualTypeOf<"login">();
  expectTypeOf(text.body).toEqualTypeOf<"text">();
  expectTypeOf(text.auth).toEqualTypeOf<"login">();
  expectTypeOf(none.body).toEqualTypeOf<"json">();
  expectTypeOf(none.auth).toEqualTypeOf<"none">();
  expectTypeOf(both.body).toEqualTypeOf<"text">();
  expectTypeOf(both.auth).toEqualTypeOf<"none">();
  expectTypeOf(zen.auth).toEqualTypeOf<"login">();

  // A type argument for the settings: it may say only what the options say.
  const agreeing = GitHub.route<typeof GET_REPO, never, None, never, { body: "text" }>(GET_REPO, { body: "text" });
  expectTypeOf(agreeing.body).toEqualTypeOf<"text">();
  // @ts-expect-error the type says text, and no options say it
  const bareText = GitHub.route<typeof GET_REPO, never, None, never, { body: "text" }>(GET_REPO);
  // @ts-expect-error the type says none, and the options say nothing
  const emptyNone = GitHub.route<typeof GET_REPO, never, None, never, { auth: "none" }>(GET_REPO, {});
  // @ts-expect-error the type says none, and the options leave `auth` out
  const noAuth = GitHub.route<typeof ZEN, never, None, never, { body: "text"; auth: "none" }>(ZEN, { body: "text" });
  // A type argument whose keys are optional leaves both open.
  const viaTypeArgument = GitHub.route<typeof GET_REPO, never, None, never, Open>(GET_REPO, {});
  expectTypeOf(viaTypeArgument.body).toEqualTypeOf<"json" | "text">();
  expectTypeOf(viaTypeArgument.auth).toEqualTypeOf<"login" | "none">();

  // An options variable with optional keys, and a widened one: the value may be either.
  const typed: Open = { body: "text", auth: "none" };
  const optional = GitHub.route(GET_REPO, typed);
  expectTypeOf(optional.body).toEqualTypeOf<"json" | "text">();
  expectTypeOf(optional.auth).toEqualTypeOf<"login" | "none">();
  const fromParameter = (options: Open) => GitHub.route(GET_REPO, options);
  expectTypeOf(fromParameter({}).body).toEqualTypeOf<"json" | "text">();
  expectTypeOf(fromParameter({}).auth).toEqualTypeOf<"login" | "none">();
  const widened = (body: "json" | "text") => GitHub.route(GET_REPO, { body });
  expectTypeOf(widened("text").body).toEqualTypeOf<"json" | "text">();
  expectTypeOf(widened("text").auth).toEqualTypeOf<"login">();

  // A token: taken where the route sends the login, refused wherever it may send none.
  const token = { token: Redacted.make("t") };
  const taken = [GitHub.call(bare, input, token), GitHub.call(text, input, token), GitHub.call(zen, {}, token)];
  // @ts-expect-error a route declared none sends no token
  const noneToken = GitHub.call(none, input, token);
  // @ts-expect-error a route that may be none drops a token
  const maybeNone = GitHub.call(optional, input, token);
  // @ts-expect-error a route that may be none drops a token, however it was built
  const maybeNoneFromType = GitHub.call(viaTypeArgument, input, token);

  expectTypeOf([taken, bareText, emptyNone, noAuth, noneToken, maybeNone, maybeNoneFromType]).toBeArray();
};

it("T14 type: route takes body: text where GitHub answers text, a success read from text, auth: none and a media type, and refuses the rest", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(routeOptions).toBeFunction();
});

it("T15 type: call takes a token as a Redacted, refuses it on a route that sends none, and keeps the answer's type", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(callOptions).toBeFunction();
});

it("T17 type: a route's body and auth types hold what its value holds, however it was built, and a route that may send none takes no token", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(everyWay).toBeFunction();
});
