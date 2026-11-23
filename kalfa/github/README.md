# @kalfa/github

A client for GitHub's REST API that speaks GitHub's own words. A route is written the way GitHub writes it, as a value,
and the compiler refuses a typo in it: in the route text, in a path parameter, in a query key, in a payload key and in
an answer field.

This package has no area of GitHub in it (no pull requests, no check runs). It holds two things: declaring an operation with
`GitHub.route`, and calling it with `GitHub.call`. A caller declares the operations it needs, with only the fields it reads.
There is no live Layer yet: `call` sends through the `GitHub` service, and a program provides one.

## Declare an operation

```ts
import * as GitHub from "@kalfa/github";
import { Schema } from "effect";

const CheckRun = Schema.Struct({
  id: Schema.Finite,
  name: Schema.String,
  status: Schema.Literals(["queued", "in_progress", "completed"]),
  conclusion: Schema.NullOr(Schema.Literals(["success", "failure", "cancelled"])),
});

export const ListCheckRuns = GitHub.route("GET /repos/{owner}/{repo}/commits/{ref}/check-runs", {
  query: { per_page: Schema.Int },
  success: Schema.Struct({ check_runs: Schema.Array(CheckRun) }),
});
```

`route` takes the route text, then one options object. Each part of it is checked against GitHub's description:

- **The route text** must be one the description has, in its own spelling: the method in capitals, one space, the path
  with its `{name}` parts. `"GET /repos/{owner}/{repo}/commits/{ref}/check-rnus"` does not compile.
- **`query`** is a record of Schemas. Each key must be a query parameter of the route, each value must be one the
  description takes, and a required parameter must be declared, and declared required.
- **`payload`** is the Schema of the request body. It must fit the description's body, and it must name no key the body
  lacks, at any depth. A route whose body is required cannot be declared without one, and a route with no body cannot take
  one. Where the description leaves an object open, such as a workflow dispatch's `inputs`, any key fits below it.
- **`success`** is the Schema of the answer. Every field it names must be a field GitHub sends, at any depth, and every
  value it takes must be one GitHub sends (`null` aside). It does not check a field marked required where the description
  marks it optional, so that is read at run time. A route whose 2xx answers carry no body takes no `success`.
- **`bodiless`** is needed on a route that has a 2xx with no body beside a 2xx with one, such as a workflow dispatch, which
  answers 204 or 200. The list of statuses must be exactly the description's.

A path parameter's name comes from the route text, and its type from the description (the run id of a cancel is a
number). `GitHub.apiVersion` is the date of the REST API the types describe.

## Call an operation

```ts
import * as GitHub from "@kalfa/github";
import { Effect } from "effect";

// Effect<{ check_runs: ReadonlyArray<...> }, GitHubError | RateLimited, GitHub.GitHub>
const runs = GitHub.call(ListCheckRuns, {
  params: { owner: "o", repo: "r", ref: "feature/x" },
  query: { per_page: 100 },
});
```

The input is what the route declared, and nothing else: `params` when the route text has `{name}` parts, `query` when a query
was declared (required when it holds a required key), and `payload` when a payload was declared. A payload is the decoded
type of its Schema. The call gives the decoded success, `void` when no success was declared, or an `Option` of it for a route
that also has a 2xx with no body (a workflow dispatch answers 204 or 200).

- **The path.** Each `{name}` is filled with `encodeURIComponent`, so `feature/x` stays one segment. A name is read only as an
  own key. A missing name, an empty or blank text, `.`, `..`, a number that is not whole and a lone surrogate are refused.
- **What is left out is not sent.** A key whose value is `undefined` is left out of the query and the body, at any depth. An
  explicit `null`, `0`, `false`, `""`, `[]` and `{}` are sent. An `undefined` inside a list, a number JSON cannot hold, and a key
  the Schema lacks are refused.
- **Schemas stay Effects.** Encoding the input and decoding the answer run through Effects, so a Schema that is async or needs
  a service works, and its services show in the call's requirements.
- **The answer.** Fields the caller did not declare are dropped. The body is read as JSON text.

## Errors

A call fails with `GitHubError`, which names the route text in `operation` and holds a `reason`, or with `RateLimited`, which
the `GitHub` service gives.

- `ClientError`: GitHub answered 4xx. It holds the `status`, and a `message`, a `documentationUrl` and `errors` exactly when
  GitHub's body had them.
- `Undecodable`: the input could not be encoded (`side` is `input`, and nothing was sent), or the answer could not be read
  (`side` is `answer`: the SchemaError is its `cause`, and a status this client does not read has none). Its `message` says
  the path and what was expected, and holds no value; the `cause` does, so read it as private.

`GitHubError` has no `message` and no `cause` field, on purpose: a failed span renders only those, so nothing under `reason`
reaches a trace.

## The span

Each call runs in one span, `github.call`, with `http.request.method`, `kalfa.github.operation` (the route text) and, once a
reply came, `http.response.status_code`. No path, query, header or value is put in it. The package never logs and never
prints.

## Test a caller

`@kalfa/github/test` holds a fake GitHub, a Layer of the `GitHub` service, so a caller's tests run its real decoding on
GitHub's own JSON.

```ts
import * as GitHub from "@kalfa/github";
import * as GitHubTest from "@kalfa/github/test";

const layer = GitHubTest.layer([
  GitHubTest.answer(ListCheckRuns, () => ({
    total_count: 1,
    check_runs: [{ id: 7, name: "lint", status: "completed", conclusion: null, head_sha: "abc" }],
  })),
  GitHubTest.refuse(CancelRun, { status: 409, message: "Cannot cancel a workflow run that is completed." }),
]);
```

- **`answer(op, f)`** replies with `f`'s value written as JSON text, status 200. `f` is handed the params, the query and the
  payload the request carried, as encoded (a number a Schema reads from text is the text), and the payload is `undefined`
  when no body was sent. A route whose only 2xx is not 200 asks for the status: `answer(CancelRun, f, { status: 202 })`. The
  value is part of the description's answer: every key is optional, at any depth, and a key the description lacks does not
  compile. Fields the caller does not read are fine, as GitHub sends them.
- **`refuse(op, said)`** replies with a 4xx and GitHub's own error body, which `call` reads as it reads GitHub's.
- **`layer(answers, options)`** answers each request with the first answer for its route text. A request no answer covers dies,
  naming the route, since a test that forgot to declare it has a bug. `poll` is the service's poll interval, 30 seconds by
  default.

## What is checked at run time only

These routes have an answer the description cannot describe to the compiler, so `route` takes any `success` for them:
no 2xx status (a redirect to a download), an answer that is not JSON, or a JSON object with free keys.

No 2xx status:

- `GET /orgs/{org}/migrations/{migration_id}/archive`
- `GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}`
- `GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs`
- `GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/logs`
- `GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs`
- `GET /repos/{owner}/{repo}/tarball/{ref}`
- `GET /repos/{owner}/{repo}/zipball/{ref}`
- `GET /user/migrations/{migration_id}/archive`

An answer that is not JSON:

- `GET /octocat`
- `GET /zen`
- `POST /markdown`
- `POST /markdown/raw`

A JSON object with free keys:

- `GET /emojis`
- `GET /orgs/{org}/copilot/billing`
- `GET /orgs/{org}/copilot/content_exclusion`
- `GET /repos/{owner}/{repo}/languages`
- `POST /app-manifests/{code}/conversions`

That is 17 routes, read from the types of `@octokit/openapi-types` 29.0.1.

## Where the types come from, and their date

The types are `@octokit/openapi-types` 29.0.1: GitHub's REST description, made into types by Octokit. They are a dev
dependency pinned to one exact version, and nothing of them ships: this package imports them with `import type` only.

They describe REST API version **2022-11-28**. The package records no date, so `GitHub.apiVersion` is typed by what the
types say: the compiler reads three changes that version 2026-03-10 made (a workflow dispatch's `return_run_details` key
and its 204, and a pull request's `merge_commit_sha`), and the date does not compile when they disagree with
`"2022-11-28"`. A client that sends a version header sends this date.

The types lag GitHub's description by days to months. A route GitHub added after the pinned release does not compile
until the pin moves.

## How a bump goes

A bump is one catalog line in the workspace file and one `pnpm install`. Then a typecheck says what moved:

- The date law goes red when the types describe another date. Change `GitHub.apiVersion`, and read the new date's
  changes before a client sends it.
- The run-time-only law goes red when that list of 17 changed. Change the list above with it.
- The route laws go red when a vector route, or the shape of the generated types, changed.

## What this package never does

It never logs, never prints and imports no other package of its repository, no Node module and no telemetry.
