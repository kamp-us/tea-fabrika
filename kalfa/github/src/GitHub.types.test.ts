// T1 to T4, T6 and T10: what `GitHub.route` accepts and refuses, over real routes of GitHub's REST description as
// `@octokit/openapi-types` 29.0.1 types it. They are checked by the compiler (`tsc`, and the root `typecheck`), not by a
// test run: each `@ts-expect-error` below is a typo the ticket names, and it must stay a compile error. The vectors are in
// Octokit.test-support.ts. Each helper holds one law's lines, and its `it` only names the helper.
import { expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
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
  INSTALLATION_TOKEN,
  LANGUAGES,
  MERGE_RESULT,
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
    GitHub.route(ZEN),
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
  const zen = GitHub.route(ZEN, { success: Schema.String });
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
  const zen = GitHub.route(ZEN);
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
