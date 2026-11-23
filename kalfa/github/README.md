# @kalfa/github

A client for GitHub's REST API that speaks GitHub's own words. A route is written the way GitHub writes it, as a value,
and the compiler refuses a typo in it: in the route text, in a path parameter, in a query key, in a payload key and in
an answer field.

This package has no area of GitHub in it (no pull requests, no check runs) and no call yet. Today it holds one thing:
declaring an operation with `GitHub.route`. A caller declares the operations it needs, with only the fields it reads.

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
