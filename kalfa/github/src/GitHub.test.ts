// T1 as a value: what `GitHub.route` makes from a route text. The type laws are in GitHub.types.test.ts; this one runs, so a
// route that compiles but carries the wrong method or path is caught before `call` (ticket 1944's second slice) reads it.
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as GitHub from "./GitHub.ts";
import {
  CANCEL,
  CHECK_RUNS,
  CREATE_ISSUE,
  DELETE_COMMENT,
  DELETE_ORG,
  DISPATCH,
  GET_BRANCH,
  GET_PULL,
  INSTALLATION_TOKEN,
  LANGUAGES,
  VECTORS,
  ZEN,
} from "./Octokit.test-support.ts";

const IssuePayload = Schema.Struct({ title: Schema.String });

const DispatchPayload = Schema.Struct({ ref: Schema.String });

// Plant: split the route text on its last space instead of its first, or drop the slash from the path, and a vector
// route names a wrong method or path.
it("T1 vector: route holds the route text, the method and the path template of each real route, and its declared parts", () => {
  // vector: the routes the plan names, each of a different shape; no generated input says what GitHub's description holds.
  const made = [
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
    GitHub.route(DELETE_COMMENT),
  ];

  expect(made.map(({ route, method, path }) => ({ route, method, path }))).toEqual(VECTORS);
  expect(made.every(({ _tag }) => _tag === "Route")).toBe(true);

  // The Schemas a caller declares stay on the value: the query as a Struct of its fields, the others as given.
  const success = Schema.Struct({ check_runs: Schema.Array(Schema.Struct({ id: Schema.Finite })) });
  const declared = GitHub.route(CHECK_RUNS, { query: { per_page: Schema.Int }, success });

  expect(declared.success).toBe(success);
  expect(Object.keys(declared.query?.fields ?? {})).toEqual(["per_page"]);
  expect(GitHub.route(CREATE_ISSUE, { payload: IssuePayload }).payload).toBe(IssuePayload);
  expect(GitHub.route(CANCEL).payload).toBeUndefined();
  expect(GitHub.route(CANCEL).success).toBeUndefined();
});
