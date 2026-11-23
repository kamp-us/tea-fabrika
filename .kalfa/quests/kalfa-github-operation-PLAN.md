Approved by the lead agent, builds issues 1749, 1944, 0089; body caedfd00f612
Plancheck-Version: 3

# Plan: @kalfa/github, declare a REST operation and call it (ticket 1944)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The
ticket is https://github.com/kamp-us/tea-fabrika/issues/1944. It lands as three pull requests, one
per slice (`## Slices`), each under about 300 product lines and each whole on its own: the first two
say `Part of #1944`, the last says `Closes #1944`, never a `fabrika close ticket` line. Together they
make the new package `kalfa/github/`, which has no folder today, with its root entry point
`@kalfa/github` and its `/test` entry point. It carries the protocol's riskiest guess: that GitHub's published REST description gives
types good enough to refuse a typo in a route, a parameter, a query key, a payload key or an answer field.

This revision follows the owner's answer of 2026-11-22 to the held plan's one open question: no
generated type map is committed. The checks read the npm package `@octokit/openapi-types` 29.0.1,
GitHub's REST description made into types by Octokit, pinned exact in the catalog as a dev dependency.
The map script, the committed map, its pin file and the CI download law are gone.

Words: this package has no glossary, and this pull request adds no `GLOSSARY.md`. The glossary map says
"GitHub is not a context" (`.kalfa/glossary/GLOSSARY-MAP.md`, the GitHub paragraph), decision 0050 says
the client speaks GitHub's own words, and the protocol ticket
https://github.com/kamp-us/tea-fabrika/issues/1753 settles the call names (`route`, `call`, `pages`,
`watch`) and the error names. Every other name below is a code name or GitHub's own word.

```ts
// The whole idea, a sketch. Nothing here was type-checked.
import * as GitHub from "@kalfa/github";
import * as GitHubTest from "@kalfa/github/test";

// In a caller (later, @kalfa/ci/github): declared once, as a value, in GitHub's own route text.
const CheckRun = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  status: Schema.Literals(["queued", "in_progress", "completed"]),
  conclusion: Schema.NullOr(Schema.String),
});
const ListCheckRuns = GitHub.route("GET /repos/{owner}/{repo}/commits/{ref}/check-runs", {
  query: { per_page: Schema.Int },
  success: Schema.Struct({ check_runs: Schema.Array(CheckRun) }), // only the fields this caller reads
});
// GitHub.route("GET /repos/{owner}/{repo}/commits/{ref}/check-rnus")     does not compile: no such route
// success: Schema.Struct({ check_rnus: ... })                             does not compile: no such field

const runs = yield* GitHub.call(ListCheckRuns, { params: { owner: "o", repo: "r", ref: "main" }, query: { per_page: 100 } });
// Effect<{ check_runs: ReadonlyArray<...> }, GitHubError | RateLimited, GitHub.GitHub>, in the span github.call

// The date the types describe, held to them by the compiler; 1945's live Layer sends it.
GitHub.apiVersion; // "2022-11-28"

// In the caller's test: the fake answers in GitHub's own JSON, so the caller's real decoding runs.
const layer = GitHubTest.layer([
  GitHubTest.answer(ListCheckRuns, () => ({ total_count: 1, check_runs: [{ id: 7, name: "lint", status: "completed", conclusion: null, head_sha: "abc" }] })),
]);
```

## Doubts, at the top

The owner is away, so the plan takes its lean on each of these and goes on.

- **Octokit's types describe API version 2022-11-28, not 2026-03-10 (lean: send 2022-11-28, 80%).**
  The ticket and the protocol's ruling 7 name `2026-03-10`. The owner's answer says the date the client
  sends must match the date Octokit's pinned version was built from. The package records no date: its
  `package.json` holds only `"octokit": { "openapi-version": "23.0.1" }`, the release of
  `octokit/openapi` it was made from. That release reads GitHub's undated file,
  `descriptions/api.github.com/api.github.com.json`. At GitHub's commit `c9c95fe` (2026-11-17), the
  undated file is the `2022-11-28` file plus `x-github-breaking-changes` notes for `2026-03-10`: with
  the notes removed the two are equal (checked in a scratch folder). openapi-typescript 6 writes no
  `x-` keys, so the types are 2022-11-28's. GitHub sends 2022-11-28 to a request with no version header,
  and supports it until 2028-03-10 (GitHub's API versions page, read on 2026-11-22). So the plan follows
  the owner's rule: `GitHub.apiVersion` is `"2022-11-28"`, and law V1 holds it to the types. What 2022-11-28
  changes for the first callers: a workflow dispatch answers 204, or 200 with the run's id when
  `return_run_details` is `true` (https://github.com/kamp-us/tea-fabrika/issues/1801), and a pull
  request still has `merge_commit_sha`. The doubt is only whether the owner knew the date when he picked
  Octokit; it is the plan's one open question. If he says 2026-03-10, nothing in this plan's shape
  changes but the date, and the types must then come from somewhere else.
- **Octokit's types lag GitHub's file (85%).** 29.0.1 was published on 2026-08-29 from
  `octokit/openapi` v23.0.1, whose cached file has 1,221 operations. GitHub's 2022-11-28 file at
  2026-11-17 has 1,281. A route GitHub added after August does not compile until a bump. Octokit runs
  its update daily, but 29.0.1 is still its latest release three months on. The cost is a wait; the
  first callers' routes (runs, jobs, check runs, logs, pulls, pull files) are all in it.
- **The openapi-typescript 6-or-7 doubt is gone; what is left is v6's output shape (75%).** Octokit's
  29.0.1 was made by openapi-typescript 6.7.6 (`package-lock.json` of `octokit/openapi-types.ts` at the
  published commit `83df989`), and this repo runs no generator. The shapes `Check.ts` must read, all read
  in the installed text of 29.0.1's `types.d.ts`: a `paths` entry holds only its methods; an operation
  with no parameters has no `parameters` key; a status with no body is `{ content: never }`; arrays are
  mutable (`string[]`); an `int64` field is `number | bigint` (Octokit's own transform); an object with
  no properties is `Record<string, never>`; an open object has an index signature; a `oneOf` uses the
  file's own `OneOf`/`XOR` helpers, which add `?: never` keys. The doubt is whether the answer walk
  stays readable and fast across those helpers. What settles it: T4 and T6 in the build. A future bump
  made by version 7 would change these shapes; T1 to T6 and V1 go red on it, and the README says so.
- **The answer check refuses a key GitHub lacks and a value GitHub never sends, and does not check
  optional against required (75%).** Ruling 10 asks only that a misspelled field not compile. The plan
  also refuses a leaf whose values GitHub never sends (a misspelled literal, a text where GitHub sends
  a number), because that is the same typo one level down. It does not refuse a field the caller marks
  required where the description marks it optional, because GitHub's `required` lists are not known to
  be complete; such a field is checked at run time, as `Undecodable`. What would settle it: the first
  four callers' entry points. Tightening later is one type and its laws.
- **A path parameter's `/` is sent as `%2F` (65%).** The description marks some parameters
  `x-multi-segment` (a branch name, a contents path, a ref), and its README says "In general, URL
  encoding those parameters is a good idea". Every value is encoded with `encodeURIComponent`, so a
  label named `type/bug` stays one segment. The doubt is whether GitHub decodes `%2F` in a branch name
  or a contents path. What settles it: the real read of
  https://github.com/kamp-us/tea-fabrika/issues/1945, which should try one multi-segment route.

## What changes, in one paragraph

A new private workspace package, `@kalfa/github`. Its root module, `GitHub.ts`, holds `route`, `call`,
`apiVersion`, the `GitHub` service with its two members `send` and `poll`, the wire request and reply it
speaks in, and the errors `GitHubError` (with the reasons `ClientError` and `Undecodable`) and
`RateLimited`. Its `/test` module, `TestGitHub.ts`, holds `layer`, `answer` and `refuse`. The
compile-time checks live in `src/internal/Check.ts` and read `paths` from `@octokit/openapi-types`
29.0.1 with `import type` only, so nothing of it ships. The package imports no kalfa package, no Node
module and no Telemetry, and lint holds all three. Out of scope and left to the sibling tickets: the
live Layer, settings, the version header, `auth`, `body` and `accept`, `ServerError` and `Unavailable`
(https://github.com/kamp-us/tea-fabrika/issues/1945); `pages` (1946); remembered answers (1947); `watch`
(1948); rate-limit waits and anything that makes a `RateLimited` (1949); retries and write spacing
(1951); GraphQL (1952); App login and `LoginFailed` (1953); installation tokens (1954, 1956); the device
flow (1958); webhooks (1960). Acting as a user with a refreshed token is not built in this push, and
nothing here plans for it.

## Slices

Each slice is its own pull request. A later slice branches from main after the one under it lands,
as the lead skill now says; while the one under it is still open, the lead may instead stack it on
that branch and bring main in after the squash with the lead skill's `git merge --no-commit -X ours`
step. Each slice has its own Files, Generators and Laws below.

1. **Declare: `route`, the type checks over Octokit's `paths`, and the date.** Branch
   `fabrikalfa/kalfa-github-operation` (this worktree). The package, its manifest, lint override, rank
   rows, catalog line and lockfile; `Check.ts` with every compile-time check, the answer check (T6)
   included; `GitHub.ts` with `RouteName`, `Method`, `Route`, `route` and `apiVersion`. Laws T1 to T4,
   T6, T10, V1, R1, P1, P2, L1 to L4. **R1 lands here.** It lands whole: a caller can declare an
   operation and every typo the ticket names fails to compile, which settles the riskiest guess first.
   The answer check stays in this slice, not with `call` as the lead's sketch put it, because
   `route`'s `success` option is where it bites and the guess is the ticket's reason; moving it would
   also push slice 2 past 300 lines.
2. **Call: `call`, the wire request and reply, the service and the errors.** Branch
   `fabrikalfa/kalfa-github-call`, from main after slice 1 lands. `GitHub.ts` gains `Request`,
   `Reply`, the `GitHub` service (`send`, `poll`), the four error classes, `Input`, `Success`,
   `Services` and `call` with its span; `wire.ts`. Laws T5, T7, T8, P3, C1 to C9, C11. **C11 lands
   here.** Its laws run `call` on a recording stand-in for `send` in the tests' own support file, not on
   the public fake. It lands whole: a program with any `GitHub` Layer can call an operation.
3. **Test: the `/test` fake.** Branch `fabrikalfa/kalfa-github-fake`, from main after slice 2 lands.
   `TestGitHub.ts` with `layer`, `answer`, `refuse` and the `poll` option; the `./test` export. Laws
   T9, C10, and P1 widened to the new export. It lands whole: a caller tests its operations on GitHub's
   own JSON.

## Searched first

- The ticket, its parent https://github.com/kamp-us/tea-fabrika/issues/1753 with every comment (the
  answer of 2026-11-21 and its rulings 1 to 13, ruling 7's `api-version` default of `2026-03-10`
  among them; Secrets' input; the gaps comment; the laptop-key comment), and the sibling tickets 1945
  to 1949, 1951 to 1954, 1956, 1958 and 1960, so each keeps its own work.
  https://github.com/kamp-us/tea-fabrika/issues/1870 (plain `Unreachable` is the Ledger's alone) and
  https://github.com/kamp-us/tea-fabrika/issues/1801 (send the version header; what a dispatch answers
  under each date).
- Decisions 0047, 0048, 0049, 0050, 0051, 0058, 0063 and 0079 whole. Of 0080 to 0089, read since the
  held plan, none touches this ticket; 0089 (a setting's value is plain data) is 1945's when it declares
  the settings.
- `kalfa/AGENTS.md`, `kalfa/GLOSSARY.md`, `.kalfa/glossary/GLOSSARY-MAP.md`.
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks` for
  "github", "openapi|octokit|rest description", "route text|operation", "unreachable|unavailable",
  "span|telemetry", "hasOwn|own key", "async schema|decodeEffect|Sync", "limit.*setting|is a setting".
  Read every hit that is about kalfa. No record names Octokit; none settles own-key reads or async
  schemas beyond `effect-pure-domain-returns-result.md` (a pure step returns a value to check, never a
  `decodeUnknownSync` that throws).
- Patterns: `effect-services-and-layers.md`, `effect-errors-keep-their-cause.md`,
  `effect-reach-for-what-ships.md`, `effect-pure-domain-returns-result.md`,
  `a-law-watches-calls-with-a-recorder.md`, `doc-comments.md`, `settings.md`.
- The landed first tickets of kalfa packages, for layout and rule rows: `kalfa/diagnostics/`
  (its `TestDiagnostics.ts`, `Package.test.ts`, `Diagnostics.types.test.ts`), `kalfa/git/`,
  `kalfa/markdown/` and `kalfa/config/`. Since the held plan, diagnostics and git landed on main, so the
  rank rows now sit after `kalfa-git`.
- Today's lead tooling, as a map of the job only: `.agents/skills/lead/scripts/pr/PullRequestsGh.ts`
  and `.agents/skills/lead/scripts/ci/` (`RunsGh.ts`, `ChecksGh.ts`, `HistoryGh.ts`). They reach GitHub
  through `gh api` with hand-written Schemas of the fields they read, for `actions/runs`,
  `actions/runs/{id}/jobs`, `commits/{ref}/check-runs` (with its ETag), `actions/jobs/{id}/logs`,
  `pulls/{n}`, `pulls/{n}/files` and one GraphQL mutation. That is the list of routes the first callers
  will declare. Nothing in their shape is copied.
- Installed versions in `pnpm-lock.yaml`, after the merge of main: `effect` and `@effect/vitest` 4.1.3
  (with its patch), `vitest` 5.0.5, `oxlint` 1.90.0. No `@octokit/*` package and no
  `openapi-typescript` is in the lockfile.
- In the installed Effect 4.1.3: `node_modules/effect/AGENTS.md` whole; `Schema.TaggedError`,
  `Schema.Json`, `Schema.JsonObject`, `Schema.fromJsonString`, `Schema.optionalKey`, the parse option
  `onExcessProperty: "error"`, `SchemaIssue.makeFormatterStandardSchemaV1`; `Schema.encodeEffect` and
  `Schema.decodeUnknownEffect`, and the sync adapters' warning in `src/SchemaParser.ts` ("because this
  adapter runs synchronously, async decoding work can produce an `Exit.Failure` with a defect cause");
  `Types.DeepMutable` (`src/Types.ts:559`); `HttpApiEndpoint.make`, whose options are named `params`,
  `query`, `payload` and `success`; `UrlParams.fromInput`, for 1945; and how a failed span is written:
  `src/observability/OtlpTracer.ts` writes `exception.message` and `exception.stacktrace` from
  `Cause.prettyErrors(cause, { includeCauseInStack: true })`, and `causePrettyError`
  (`src/internal/effect.ts`) renders an error's `message`, its stack and its `cause` chain, and no
  other field.
- The lint a new `kalfa/` folder meets, in `.oxlintrc.json`: base `unicorn/prefer-node-protocol`,
  `eslint/no-eval` and `eslint/no-implied-eval`; the kalfa Effect block (its `files` list at line 741
  names `kalfa/config`, `kalfa/diagnostics`, `kalfa/git` and `kalfa/markdown`); the `kalfa/**/*`
  blocks; the `allowTypeImports: true` option `no-restricted-imports` already uses (line 2133).
  `fabrika/no-node-imports` checks nothing under `kalfa/` (`heldToNext`, `oxlint-plugins/match.ts`).
- `vitest.config.ts` (its `kalfa/*/src/**/*.test.{ts,tsx}` glob), `vitest.hostrun.ts`,
  `.github/ci/shard-rows.ts` (a new test file with no row takes the fallback), `layer-rules.json`,
  `boundary-rules.json`, `oxlint-plugins/layers.test.ts` (its pinned list, lines 710 to 715), and
  `kalfa/config/rslib.config.ts` (its entry globs leave out `*Test.ts`, which is why the test module is
  `TestGitHub.ts`).

## What was read from npm and GitHub while planning

Web reads that carried no detail of this project, into a scratch folder outside the repo. Nothing was
installed into the repo or run against it.

- **npm, `@octokit/openapi-types` 29.0.1:** published 2026-08-29, MIT, with an npm provenance
  attestation. Four files: `LICENSE`, `README.md`, `package.json` and `types.d.ts` (5,340,053 bytes;
  5,342,059 unpacked in all). Its `package.json` has `"main": ""`, `"types": "types.d.ts"`, no
  `exports`, no `scripts` (so nothing runs at install) and `"octokit": { "openapi-version": "23.0.1" }`.
  `gitHead` is `83df9890720ab7d64bbaf8e07e57751f1b23ed59`.
- **`octokit/openapi-types.ts` at `83df989`:** `scripts/download.js` takes the `.json` assets of the
  `octokit/openapi` release named by `OCTOKIT_OPENAPI_VERSION`; `scripts/generate-types.js` calls
  `openapiTS` with one transform (an `application/octet-stream` binary becomes
  `string | File | Uint8Array | Blob`, an `int64` becomes `number | bigint`) and writes `types.d.ts`;
  it writes the release number into `package.json` as `openapi-version`, and no date. Its
  `package-lock.json` installs openapi-typescript 6.7.6.
- **`octokit/openapi` at tag v23.0.1 (2026-08-29):** `scripts/download.mjs` reads
  `descriptions/<name>/<name>.json` from GitHub's `main`, or from the open pull request of GitHub's
  description bot, so the undated file; `scripts/build.mjs` adds an `x-octokit` key to each operation,
  deletes a request body with no schema, and changes `info`. Its cached `api.github.com.json` is
  OpenAPI 3.0.3 with 1,221 operations.
- **`github/rest-api-description` at `c9c95fe34ced05fe076001f5c55704742bc8e7f8` (2026-11-17):**
  `api.github.com.json`, `api.github.com.2022-11-28.json` and `api.github.com.2026-03-10.json`, 1,281
  operations each. The undated file with every `x-github-breaking-changes` key removed equals the
  2022-11-28 file; neither dated file has that key. The notes name `2026-03-10` on 21 operations and 48
  schemas: among them the dispatch (its 204 and `return_run_details` are removed), creating and editing
  an issue, `pull-request` (its `merge_commit_sha` is removed), `issue`, `repository` and
  `minimal-repository`.
- **GitHub's API versions page** (docs.github.com, read 2026-11-22): a request with no
  `X-GitHub-Api-Version` header gets `2022-11-28`; `2022-11-28` is supported until 2028-03-10;
  `2026-03-10` has no end date yet; an unsupported version answers `410 Gone`.
- **A small read of Octokit's cached file** (Python, standard library) for the routes whose answer can
  only be checked at run time: 8 with no success status (the five `GET .../logs` and archive routes,
  `tarball`, `zipball`), 4 that answer something other than JSON (`GET /zen`, `GET /octocat`,
  `POST /markdown`, `POST /markdown/raw`), and 4 whose JSON answer is an open object (`GET /emojis`,
  `GET /repos/{owner}/{repo}/languages`, `GET /orgs/{org}/copilot/content_exclusion`,
  `GET /repos/{owner}/{repo}/code-scanning/analyses/{analysis_id}`): 16 in all. Another 15 answer a 202
  whose schema is a bare object, which the types write as `Record<string, never>`
  (`DELETE /orgs/{org}`, the three `stats/*` routes' 202 and others).

## How others do it

- **Octokit** (read: its two scripts, its package and its types file): `@octokit/openapi-types` is
  openapi-typescript's output for GitHub's file, and `@octokit/types` builds an `Endpoints` map keyed by
  GitHub's own route text, `"POST /repos/{owner}/{repo}/issues"` (from memory, not fetched).
  `octokit.request(route, { ... })` type-checks the route, the parameters and the body, and fills the
  path. This is the shape the ticket asks for: route text as the key, types that ship nothing. Octokit
  sends no version header by default, so GitHub answers it as 2022-11-28, the date its types describe.
  Octokit checks a whole answer type, not the caller's few fields; ruling 10 checks the caller's Schema
  against it instead.
- **openapi-typescript** (from memory of its docs, not fetched): turns an OpenAPI file into `paths`,
  `operations` and `components` interfaces and nothing that runs; `openapi-fetch` reads them to type
  `client.GET("/path", { params: { path, query } })`.
- **Effect** (read in the installed 4.1.3): `HttpApiEndpoint.make(method)(name, path, { params, query,
  payload, success })` declares an endpoint as a value with Schemas, and `HttpApiClient` calls it. The
  ticket's `route(text, { success, query, payload })` follows those option names. Effect's own HTTP
  client is the live Layer's (1945), not this ticket's.
- **Elm** (from memory): `Http.request { method, url, body, expect = Http.expectJson toMsg decoder }`:
  a request is data, the decoder names only the fields the program reads, extra fields are ignored, and
  a failure is one `Http.Error` union (`BadStatus`, `BadBody`, `NetworkError`, `Timeout`). The plan's
  `GitHubError` with its `reason` union is that union, named in GitHub's words.
- **Erlang/OTP**: nothing in this ticket runs, waits or is supervised, so no OTP answer applies. The
  waits and retries are 1949's and 1951's.
- **OpenTelemetry's HTTP client names** (from memory of the semantic conventions, not fetched):
  `http.request.method` and `http.response.status_code`; `url.template` is the standard name for a
  path's template (see Findings).

## The shape

### The package

```text
kalfa/github/
  package.json          @kalfa/github, private; exports ".", "./test", "./package.json"
  README.md             what the client is, declaring and calling, testing, the types' source and date, the run-time-only routes, how a bump goes
  rslib.config.ts       as kalfa/config's
  tsconfig.json         as kalfa/config's, with the Effect checks
  tsconfig.build.json   as kalfa/config's
  src/
    GitHub.ts           the root entry point: route, call, apiVersion, the GitHub service, Request, Reply, the errors
    TestGitHub.ts       the /test entry point: layer, answer, refuse
    internal/
      Check.ts          the compile-time checks, read from @octokit/openapi-types: types only
      wire.ts           fill the path, drop what was left out, read a reply
```

```jsonc
// kalfa/github/package.json, a sketch, as it stands after slice 3; slice 1 has no "./test" pair yet.
{
  "name": "@kalfa/github", "version": "0.0.0", "private": true, "type": "module",
  "scripts": { "build": "rslib build", "typecheck": "tsc --noEmit" },
  "exports": { ".": "./src/GitHub.ts", "./test": "./src/TestGitHub.ts", "./package.json": "./package.json" },
  "publishConfig": { "exports": { ".": { "types": "./dist/GitHub.d.ts", "default": "./dist/GitHub.js" }, "./test": { "types": "./dist/TestGitHub.d.ts", "default": "./dist/TestGitHub.js" } } },
  "files": ["dist", "!dist/.rsbuild"],
  "peerDependencies": { "effect": "catalog:" },
  "devDependencies": { "@octokit/openapi-types, @effect/platform-node, @effect/vitest, @rslib/core, @types/node, effect, typescript, vitest": "catalog:" },
  "engines": { "node": ">=26" }
}
```

No `dependencies`. `@octokit/openapi-types` is a dev dependency, as the owner asked, and the catalog
holds it exact: `'@octokit/openapi-types': 29.0.1` (decision 0051), with a comment that says its types
describe API version 2022-11-28 and that law V1 holds `GitHub.apiVersion` to them. No `fast-check` and
no `@kampus/vitest`: the laws use `@effect/vitest` and Effect's own `Arbitrary`, so the rule rows say
`imports: []`.

### How a bump goes

Bumping is one catalog line and one `pnpm install`. Then `pnpm typecheck` says what moved: V1 if the
date moved (the compiler refuses `GitHub.apiVersion`'s value until it is changed, and then 1945's laws
see the new date), R1 if the run-time-only routes changed (the README's list is changed with it), and
T1 to T6 if a vector route or the generator's output shape changed. The README says this, and the
catalog comment points at it.

### Check.ts, the compile-time checks

```ts
// kalfa/github/src/internal/Check.ts, a sketch: types only. Nothing here was type-checked.
import type { paths } from "@octokit/openapi-types";
import type { Types } from "effect";

type Method = "get" | "put" | "post" | "patch" | "delete";

/** Every route text GitHub's description has, such as "POST /repos/{owner}/{repo}/issues". */
export type RouteName = {
  [P in keyof paths & string]: { [M in Method & keyof paths[P]]: `${Uppercase<M>} ${P}` }[Method & keyof paths[P]];
}[keyof paths & string];

type Operation<R extends RouteName> = R extends `${infer M} ${infer P extends keyof paths}` ? paths[P][Lowercase<M> & keyof paths[P]] : never;

/** The names inside the route text's braces: "owner" | "repo" | "run_id". */
export type PathNames<T> = T extends `${string}{${infer N}}${infer Rest}` ? N | PathNames<Rest> : never;

export type Params<R extends RouteName> = { readonly [K in PathNames<R>]: PathValue<Operation<R>, K> }; // string or number, as the description types it
export type Query<R extends RouteName> = Operation<R> extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never;
export type Body<R extends RouteName> = /* requestBody's application/json, and whether requestBody is required */;
export type Answer<R extends RouteName> = /* the union of the JSON bodies of every 2xx status; a `content: never` status adds no member */;
export type SuccessStatus<R extends RouteName> = /* the 2xx keys of responses */;
export type Bodiless<R extends RouteName> = /* the 2xx keys whose content is never */;

/** The routes whose answer is checked at run time only: no 2xx, no JSON 2xx, or an open object. */
export type RunTimeOnly = /* computed over RouteName */;

/** The REST API version a `paths` type describes, read from three changes 2026-03-10 made. */
export type DescribedVersion<P> = [
  "return_run_details" extends keyof DispatchBody<P> ? 1 : 0,
  204 extends keyof DispatchResponses<P> ? 1 : 0,
  "merge_commit_sha" extends keyof PullRequestAnswer<P> ? 1 : 0,
] extends infer F ? (F extends [1, 1, 1] ? "2022-11-28" : F extends [0, 0, 0] ? "2026-03-10" : never) : never;
export type ApiVersion = DescribedVersion<paths>;

// Each check is `unknown` when it holds, and a readable refusal when it does not, so an argument typed
// `Success & FitsAnswer<...>` stops compiling at the caller's field:
type Refused<Why extends string> = { readonly "GitHub's description refuses this": Why };
// The payload check compares Types.DeepMutable<the payload Schema's Encoded> with Body<R>, because a
// Schema's encoded arrays are readonly and Octokit's are not.
```

The rules, each a type, each with its laws below:

- **Route (T1).** `route`'s first argument is a `const` type parameter that must be a `RouteName`.
- **Path parameters (T2).** The names come from the route text; each value takes the description's type
  for that name. `params` is present exactly when the route has a name in braces.
- **Query (T3).** Each key of the caller's `query` fields is one of the route's query parameters, and
  each field's encoded type takes only values the description allows. A required query parameter must
  be declared, and declared required.
- **Payload (T4).** The payload Schema's encoded type, made mutable, must be assignable to the
  description's body (so every required key is there and every value fits), and it must name no key the
  body lacks, at any depth: a body is a closed type. A route whose body is required cannot be declared
  without `payload`; a route with no body cannot take one. Where the description leaves an object open
  (an index signature, such as a dispatch's `inputs`), any key fits below it.
- **Answer (T6), ruling 10.** Walking the success Schema's encoded type beside the description's answer:
  an object's every key must be a key of the description's object (of some member, when the
  description is a union; a `?: never` key the `XOR` helper adds does not count as a key); an array's
  items are walked the same way; at a leaf, every value the Schema takes, `null` left aside, must be one
  GitHub may send (`number` fits `number | bigint`). Optional against required is not checked (Doubts).
  The walk stops, accepting anything, where the description is `unknown` or an object with an index
  signature: that part is checked at run time only. `Record<string, never>` is a closed empty object:
  only `Schema.Struct({})` fits it. A route whose 2xx answers all have no body takes no `success`. A
  route in `RunTimeOnly` takes any `success`.
- **Input (T5).** `call`'s input is `{ params?, query?, payload? }`: each key present exactly when the
  route has that part, required exactly when the part has a required member. Its `payload` is the
  payload Schema's decoded type, so an object literal with an unknown key does not compile (TypeScript's
  own excess-key check). A value that passes TypeScript with an extra key is refused at run time:
  encoding uses `onExcessProperty: "error"`.

### GitHub.ts

```ts
// kalfa/github/src/GitHub.ts, a sketch. Doc blocks left out. Nothing here was type-checked.
import { Context, Duration, Effect, Option, Schema } from "effect";
import type * as Check from "./internal/Check.ts";

export type RouteName = Check.RouteName;
export type Method = "GET" | "PUT" | "POST" | "PATCH" | "DELETE";

/** The REST API version the checks' types describe. It does not compile when the types move (V1). */
export const apiVersion: Check.ApiVersion = "2022-11-28";

// What a Layer is handed and answers: the same shape for the fake and, in 1945, the live Layer.
export interface Request {
  readonly route: RouteName;                                  // the route text, as declared
  readonly method: Method;
  readonly path: string;                                      // the route's path, each {name} filled and encoded
  readonly params: Readonly<Record<string, string>>;          // the filled values, as sent
  readonly query: Readonly<Record<string, Schema.Json>>;      // encoded; no key whose value was left out
  readonly body?: Schema.Json;                                // encoded; no undefined at any depth
}
export interface Reply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;         // lowercase names
  readonly body: string;                                      // the body's text, as GitHub sent it
}

export class GitHub extends Context.Service<GitHub, {
  readonly send: (request: Request) => Effect.Effect<Reply, GitHubError | RateLimited>;
  readonly poll: Duration.Duration;                           // read by 1948's watch
}>()("@kalfa/github/GitHub") {}

// A 4xx answer, as GitHub said it. Each optional field is there exactly when GitHub's body had it.
export class ClientError extends Schema.TaggedError<ClientError, { readonly brand: unique symbol }>()("ClientError", {
  status: Schema.Int,
  message: Schema.optionalKey(Schema.String),
  documentationUrl: Schema.optionalKey(Schema.String),        // GitHub's documentation_url
  errors: Schema.optionalKey(Schema.Array(Schema.Json)),      // as GitHub said them: objects or texts
}) {}

// The input could not be encoded, or the answer could not be read.
export class Undecodable extends Schema.TaggedError<Undecodable, { readonly brand: unique symbol }>()("Undecodable", {
  side: Schema.Literals(["input", "answer"]),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),                    // the SchemaError or URIError; none for an unread status
}) {}

// No `message` and no `cause` field: a failed span renders only those (OtlpTracer, causePrettyError),
// so nothing under `reason` (GitHub's text, the caller's input, the answer's values) reaches a span.
export class GitHubError extends Schema.TaggedError<GitHubError, { readonly brand: unique symbol }>()("GitHubError", {
  operation: Schema.String,                                   // the route text
  reason: Schema.Union([ClientError, Undecodable]),           // 1945, 1952 and 1953 add theirs
}) {}

export class RateLimited extends Schema.TaggedError<RateLimited, { readonly brand: unique symbol }>()("RateLimited", {
  operation: Schema.String,
  until: Schema.DateTimeUtc,
  limit: Schema.Literals(["primary", "secondary"]),
  resource: Schema.optionalKey(Schema.String),
}) {}

// A declared operation. Only `route` makes one: the key is a symbol this module does not export.
declare const TypeId: unique symbol;
export interface Route<R extends RouteName, Success, Query, Payload> {
  readonly [TypeId]: TypeId;
  readonly _tag: "Route";
  readonly route: R;
  readonly method: Method;
  readonly path: string;                                      // the template, "/repos/{owner}/{repo}/..."
  readonly success?: Success;
  readonly query?: Query;                                     // a Schema.Struct of the declared fields
  readonly payload?: Payload;
}

export const route: <const R extends RouteName, Success, Query extends Schema.Struct.Fields, Payload>(
  route: R,
  ...options: Check.Options<R, Success, Query, Payload>       // [] or [options?] or [options], by the rules above
) => Route<R, Success, Schema.Struct<Query>, Payload>;

export type Input<Op> = /* T5 */;
// The success Schema's decoded type; void with no success; Option of it when the route also has a
// 2xx with no body (a dispatch's 204, a PUT's 204 beside its 201), None for that status.
export type Success<Op> = /* as above */;
export type Services<Op> = /* the encoding services of query and payload, the decoding services of success */;

export const call: <Op extends Route.Any>(op: Op, input: Input<Op>) =>
  Effect.Effect<Success<Op>, GitHubError | RateLimited, GitHub | Services<Op>>;
// Effect.fn("github.call"):
// 1. annotate http.request.method and kalfa.github.operation.
// 2. build the Request (wire.ts): fill the path; encode query and payload with Schema.encodeEffect and
//    onExcessProperty "error" (an Effect, since a caller's Schema may be async or need a service); drop
//    keys left out; check with Schema.JsonObject. A refusal is Undecodable input, and nothing is sent.
// 3. yield* GitHub, send. Annotate http.response.status_code.
// 4. 2xx with no body by the route's description: void or None, and the body is not read. Other 2xx:
//    no success declared, void; else Schema.decodeUnknownEffect(Schema.fromJsonString(success)). A
//    refusal is Undecodable answer, with the SchemaError as its cause.
//    4xx: ClientError from GitHub's body; a body that is not GitHub's error object gives only status.
//    Any other status: Undecodable answer, "GitHub answered <status>, which this client does not read",
//    no cause (1945 makes a 5xx its ServerError).
// 5. every failure is GitHubError { operation: route text, reason }.
```

Which 2xx statuses have no body is a fact of the types only, and types do not exist at run time. So
`route` takes it as a value where the types say a route has one: `Check.Options` makes a `bodiless`
option required, typed as exactly `Bodiless<R>`'s statuses, on a route that has both kinds (a sketch:
`GitHub.route("POST .../dispatches", { payload, success, bodiless: [204] })`). The compiler refuses a
missing or wrong list, so the run-time value cannot drift from the description.

`call` and `route` live in the service's module, as `Diagnostics.report` does: the class holds nothing
static, and the module holds the contract, its errors and its two calls. A caller writes
`import * as GitHub from "@kalfa/github"`, then `GitHub.call`, `GitHub.GitHub` and `GitHub.GitHubError`,
as Effect writes `FileSystem.FileSystem`. `RateLimited` is defined now because `call`'s and `send`'s
types name it; nothing in this ticket makes one (1949 does).

### wire.ts

```ts
// kalfa/github/src/internal/wire.ts, a sketch. Pure: each returns a Result, and call lifts it.
// fill(template, params): each {name} becomes encodeURIComponent(String(value)), the value read only
//   when Object.hasOwn(params, name); a missing name is refused. Refused, as Undecodable input: a
//   missing name, an empty text, "." or ".." (a URL parser folds them, so they would reach another
//   route, encoded or not), a number that is not a finite whole number, and a text
//   encodeURIComponent cannot encode (a lone surrogate throws URIError; caught, kept as the cause).
//   No length cap: GitHub's description sets none.
// prune(encoded): a copy with every object key whose value is undefined left out, at any depth; an
//   undefined inside an array is refused, never turned into null; explicit null, 0, false, "", [] and
//   {} are kept; own keys such as "__proto__" stay own keys (built with Object.fromEntries).
// read(reply, bodiless): the 2xx, 4xx and other branches of call's step 4; the Schema steps stay in
//   call as Effects.
```

### TestGitHub.ts

```ts
// kalfa/github/src/TestGitHub.ts, a sketch.
import * as GitHub from "./GitHub.ts";

// A fake answer: f's value as JSON text (JSON.stringify), with status 200, or the status given. The
// option is required when 200 is not one of the route's 2xx statuses, and typed as exactly those.
export const answer: <Op extends GitHub.Route.Any>(op: Op, f: (asked: Asked<Op>) => Answered<Op>, ...options: StatusOption<Op>) => Answer;
// GitHub's 4xx, through call's real reading: status 400 to 499, and GitHub's own error body.
export const refuse: <Op extends GitHub.Route.Any>(op: Op, said: { readonly status: Status4xx; readonly message?: string; readonly documentation_url?: string; readonly errors?: ReadonlyArray<Schema.Json> }) => Answer;
// The first answer whose route text is the request's answers it, found in the list, never by a record
// lookup. A request no answer covers dies, naming the route: a test that forgot to declare it is a bug
// in the test. `poll` is an option, 30 seconds by default, the protocol's poll-interval default.
export const layer: (answers: ReadonlyArray<Answer>, options?: { readonly poll?: Duration.Input }) => Layer.Layer<GitHub.GitHub>;

// Asked<Op>: { params, query, payload } as the Request carried them (encoded).
// Answered<Op>: the description's answer for the route, with every key optional at every depth and no
//   key the description lacks; `Schema.Json` for a run-time-only route.
```

A test may give f a value with fields the caller does not read, as GitHub does, and the caller's
decoding drops them. A field GitHub's description lacks does not compile (T9).

## One value traced: `ListCheckRuns`, called once, then three things go wrong

Step 1 is slice 1's, steps 2, 4 and 6 are slice 2's, and steps 3 and 5 need slice 3's fake.

1. `GitHub.route("GET /repos/{owner}/{repo}/commits/{ref}/check-runs", { query, success })` type-checks:
   the text is a `RouteName` in Octokit's `paths`; `per_page` is one of the route's query parameters
   (a number, and `Schema.Int` encodes a number); `check_runs`, `id`, `name`, `status` and `conclusion`
   are keys GitHub gives; `id`'s `number` fits Octokit's `number | bigint`; `status`'s three literals
   are among GitHub's six; `conclusion`'s `null` is allowed. The route has only a 200, so no `bodiless`
   option is asked for. The value is a `Route` with method `GET` and path
   `/repos/{owner}/{repo}/commits/{ref}/check-runs`.
2. `GitHub.call(ListCheckRuns, { params: { owner: "o", repo: "r", ref: "feature/x" }, query: { per_page: 100 } })`
   opens the span `github.call` with `http.request.method` = `GET` and `kalfa.github.operation` = the
   route text. `fill` reads `owner`, `repo` and `ref` as own keys. The Request's path is
   `/repos/o/r/commits/feature%2Fx/check-runs`, its params `{ owner: "o", repo: "r", ref: "feature/x" }`,
   its query `{ per_page: 100 }` (encoded through `Schema.encodeEffect`), and no body.
3. Under the fake, `answer`'s value is written as JSON text with status 200. `call` sets
   `http.response.status_code` = 200 and decodes the text with `Schema.decodeUnknownEffect`.
   `total_count` and `head_sha` are not declared, so they are dropped. The answer is
   `{ check_runs: [{ id: 7, name: "lint", status: "completed", conclusion: null }] }`.
4. GitHub sends a check run with status `"waiting"`, which the caller's three literals leave out.
   Decoding fails: `GitHubError { operation: "GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
   reason: Undecodable { side: "answer", message: <the issue's path and expectation>, cause: <the
   SchemaError> } }`. The span ends failed; what it renders is `GitHubError` with an empty message and
   its stack, never `"waiting"` or the SchemaError.
5. The fake is told `refuse(ListCheckRuns, { status: 404, message: "Not Found", documentation_url: "https://docs.github.com/rest" })`.
   `call` reads the 404 body: `reason: ClientError { status: 404, message: "Not Found", documentationUrl: "https://docs.github.com/rest" }`.
   `http.response.status_code` is 404.
6. A caller passes `ref: ".."`. `fill` refuses it before anything is sent: `reason: Undecodable { side:
   "input", message: "the path parameter ref cannot be . or .." }`. The span has no status code, and the
   fake saw no request.

## What lint holds

One new `.oxlintrc.json` override for `kalfa/github/src/**`, its tests and test support left out, after
the last kalfa override. An override replaces a rule's options, so it repeats the base
`no-restricted-imports` entries (Radix, Playwright's `_electron`) and adds, each pattern with its `/**`
form beside it:

- **No kalfa or repo package:** `@kalfa/**`, `@kampus/**`, `@tea-fabrika/**`, `../../**`. This ticket
  imports nothing from kalfa; 1953 opens `@kalfa/secrets`' core, for types.
- **No Node module, in both spellings, by name:** the patterns `node:*` and `node:*/**`, and every name
  in Node 26's `builtinModules` written bare, subpaths included (`fs`, `fs/promises`, `vm`, `net`,
  `util`, `util/types`, `stream/web`, `worker_threads` and the rest). The tests step writes that list
  from `require("node:module").builtinModules` at the time, and the rule's comment says so. Also
  `@effect/platform-*` with its `/**` form.
- **No Telemetry, and Octokit's types as types only:** `@opentelemetry/**` and `@effect/opentelemetry`
  with its `/**` form; `@octokit/openapi-types` with `allowTypeImports: true`, so a value import of it
  is refused (the package has no JavaScript to load); every other `@octokit/**` package, and
  `openapi-typescript`, refused.
- **No printing, no IO, no global object:** `eslint/no-console`, `eslint/no-new-func`, and
  `eslint/no-restricted-globals` for `console`, `process`, `Buffer`, `globalThis`, `global`, `self`,
  `window`, `Function`, `fetch`, `XMLHttpRequest` and `WebSocket`. The core does no IO; the live Layer
  (1945) reaches the network through Effect's `HttpClient` and will open what it needs in its own file.

The same folder joins the `files` of the kalfa Effect block at line 741 (`no-promises`,
`no-effect-run-outside-edge`, `effect-functions`, `written-service-type`, `no-hand-tag` and the rest);
the new override comes after it, so its `no-restricted-imports` wins. `Effect.log` prints by default and
no rule here sees it; the review holds it, and the README says the package never logs. No ignore entry
is needed: the types live in `node_modules`.

## Where the rank is written

- `kalfa/AGENTS.md`, the "No import cycles" bullet, gains one sentence: GitHub ranks above Secrets and
  Configuration and below Code hosting, CI, Conversation and Identity, which reach GitHub through it
  (decision 0050).
- `layer-rules.json`: a `kalfa-github` row, `layer: 0`, `paths: ["kalfa/github/src"]`, `imports: []`,
  after the `kalfa-git` row, and `kalfa/github/src` in `roots` after `kalfa/git/src`. Layer 0 says only
  that it imports nothing yet; 1945 raises it above `kalfa-config` when it makes that edge, since each
  edge needs its reason. `oxlint-plugins/layers.test.ts` lists the new row with its layer.
- `boundary-rules.json`: `"kalfa-github": { "imports": [], "pure": false }` and
  `"kalfa/github": "kalfa-github"`, after the `kalfa-git` entries.

## Generators, slice 1

Slice 1 has no generated input. Its laws are type laws over real routes in Octokit's `paths` (label
`vector:` in the laws): cancel a run, list check runs, create an issue, make an installation token,
dispatch a workflow, get a branch, get a pull request, `GET /zen`, get a repo's languages, delete an
organization (a bare 202), delete an issue comment (204); and file reads at head (label `scenario:`).

## Laws, slice 1

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| T1, the route text: `GitHub.route` compiles for each vector route; it does not compile for a misspelled path segment, a method the path does not have (`GET` on the cancel route), a lowercase method, a trailing `/`, a brace name changed (`{id}` for `{run_id}`), and `"GET /zen "` | type | type | widen `RouteName` to `` `${Method} ${string}` ``: every `@ts-expect-error` line is unused, red | kalfa/github/src/GitHub.types.test.ts |
| T2, path parameters: `Check.Params` for cancel is exactly `{ readonly owner: string; readonly repo: string; readonly run_id: number }`; a value with a missing `run_id`, a misspelled `runId`, an extra key, or `run_id: true` is not assignable to it; `GET /zen` has no path names | type | type | type params as `Record<PathNames<R>, string \| number>`: the `true` line compiles, red; read names from the description, not the text: the misspelled-brace route of T1 compiles, red | kalfa/github/src/GitHub.types.test.ts |
| T3, query keys: check-runs with `per_page: Schema.Int` and `status: Schema.Literals(["queued"])` compiles; `per_pag`, `per_page: Schema.String`, `status: Schema.Literals(["queud"])`, and any `query` on the cancel route each do not compile | type | type | check only that the key exists, not its type: the `Schema.String` line compiles, red | kalfa/github/src/GitHub.types.test.ts |
| T4, payload keys, closed at every depth: create an issue with `{ title, body: optionalKey, labels: Schema.Array(Schema.String) }` compiles; `titel`, a missing `title`, `labels: Schema.Number`, a payload on the cancel route, the issue route declared with no payload, and an unknown key inside the token's `permissions` each do not compile; a dispatch payload with any key under `inputs` compiles | type | type | check top-level keys only: the `permissions` line compiles, red; treat an index signature as closed: the `inputs` line fails, red; drop `Types.DeepMutable`: the `labels` line fails on readonly against mutable, red | kalfa/github/src/GitHub.types.test.ts |
| T6, answer fields, ruling 10: `ListCheckRuns`' success compiles; `check_rnus`, a nested `nmae`, `status: Schema.Literals(["complted"])`, `id: Schema.String`, a `success` on the 204 route, and a field on `DELETE /orgs/{org}`'s bare 202 each do not compile; `Schema.Struct({})` on that 202 compiles; `id: Schema.Number` against `number \| bigint` compiles; `Schema.NullOr` on a field GitHub never sends null compiles; a field found in one member of a `OneOf` answer compiles; any `success` on `GET /zen` and on the languages route compiles | type | type | stop the walk after one level: the nested `nmae` compiles, red; skip the leaf rule: the misspelled literal compiles, red; treat an index signature as closed: the languages line fails, red; count the `XOR` helper's `?: never` keys as keys: a field from another member's never-key compiles where it must not, red | kalfa/github/src/GitHub.types.test.ts |
| T10, the bodiless list: the dispatch declared with `bodiless: [204]` compiles, and without it, or with `[200]`, does not; check runs (only a 200) takes no `bodiless`; only `route` makes a `Route`: an object literal with `_tag`, `route`, `method` and `path` is not a `Route` | type | type | make `bodiless` optional everywhere: the dispatch line without it compiles, red; export the `TypeId` symbol type as a plain string key: the literal line compiles, red | kalfa/github/src/GitHub.types.test.ts |
| V1, the API version, the owner's rule: `GitHub.apiVersion` is `"2022-11-28"` and its type is `Check.ApiVersion`, which is `"2022-11-28"` for Octokit 29.0.1's `paths`; `DescribedVersion` gives `"2026-03-10"` for a small `paths` shape with the dispatch's 204 and `return_run_details` and the pull request's `merge_commit_sha` removed, and `never` for a shape with one of the three removed | type | vector: the three removals in `x-github-breaking-changes` of GitHub's undated file at commit c9c95fe, and Octokit 29.0.1's `paths` | write `ApiVersion = "2022-11-28"` instead of reading it: the `2026-03-10` shape line fails, red; type `apiVersion` as `string`: its `toEqualTypeOf` line fails, red | kalfa/github/src/Octokit.types.test.ts |
| R1, the run-time-only routes: `Check.RunTimeOnly` is exactly the 16 routes read from Octokit's cached file (8 with no success status, 4 not JSON, 4 open objects); if the built type gives another set, the build checks each difference against the description and the pull request says why; the README carries the same list | type | vector: Octokit 29.0.1's `paths`, and the routes read from `octokit/openapi` v23.0.1's cached `api.github.com.json` | count a `Record<string, never>` answer as open: the union gains `DELETE /orgs/{org}` and the other bare 202s, red; leave out routes with no 2xx: the `logs` routes are missing, red | kalfa/github/src/Octokit.types.test.ts |
| P1, the manifest: `kalfa/github/package.json` has no `dependencies`, has `effect` as its only peer and `@octokit/openapi-types` among its dev dependencies, as `catalog:`; names no `@kalfa/` or `@kampus/` package in any field; exports exactly `.` and `./package.json`, and gives `.` its `dist` pair; the catalog line for `@octokit/openapi-types` in `pnpm-workspace.yaml` is an exact version with no range mark, and it is the version the README names | test | scenario: the package's own manifest, the workspace file and the README at head | add `@kampus/vitest` to its dev dependencies: red; write `^29.0.1` in the catalog: red | kalfa/github/src/Package.test.ts |
| P2, nothing of this repo (decision 0047): no file git tracks under `kalfa/github/` holds `fabrika`, `kampus`, `kamp-us` or `.kalfa/` in any letter case | test | scenario: the package's tracked files at head | write `tea-fabrika` into the README: red | kalfa/github/src/Package.test.ts |
| L1, no kalfa or repo package: an import of `@kalfa/config`, `@kalfa/secrets/Secrets`, `@kampus/vitest`, `@tea-fabrika/x` or `../../config/src/App.ts` in a file under `kalfa/github/src/` but its tests is refused | lint | lint | each of the five, one at a time, in `GitHub.ts`: lint red each time, then undone | .oxlintrc.json |
| L2, no Node, no IO, no printing: `import "node:fs"`, `"node:fs/promises"`, `"fs"`, `"vm"`, `"net"`, `"util"`, `"util/types"`, `"stream/web"`, `@effect/platform-node`, `@effect/platform-node/NodeServices`, `console.log("x")`, `process.env.X`, `Buffer.from("a")`, `globalThis.process`, `new Function("x")`, `Function("x")`, `fetch("https://x")` and `new WebSocket("wss://x")` are each refused there | lint | lint | each of the eighteen, one at a time, in `GitHub.ts`: lint red each time, then undone | .oxlintrc.json |
| L3, no Telemetry, Octokit as types only: `@kalfa/telemetry`, `@opentelemetry/api`, `@effect/opentelemetry`, `@effect/opentelemetry/Tracer`, `import { paths } from "@octokit/openapi-types"` (a value import), `import type { Endpoints } from "@octokit/types"` and `openapi-typescript` are each refused there; `import type { paths } from "@octokit/openapi-types"` in `Check.ts` passes | lint | lint | each of the seven in `GitHub.ts`: lint red each time; set `allowTypeImports` to false: `Check.ts` red | .oxlintrc.json |
| L4, the rank: the package imports no other workspace package (`pnpm lint:boundaries`, `pnpm lint:layers`), its row sits at layer 0, and `oxlint-plugins/layers.test.ts` pins it | lint | lint | import `@kalfa/records/Finding` in `GitHub.ts`: both checks red; grant `"imports": ["kalfa-config"]` on the `kalfa-github` row: `lint:layers` refuses an upward grant, red | layer-rules.json, boundary-rules.json, oxlint-plugins/layers.test.ts |

## Generators, slice 2

A generator's reach is part of its law. Each class below is checked in every run, not left to chance:
each run takes its drawn value and also checks one made from it for each class. Every generator is an
Effect `Arbitrary` in `kalfa/github/src/GitHub.test-support.ts`, beside the recording stand-in for
`send` the laws run `call` on. Effect's own string arbitrary reaches only printable ASCII and 15 fixed
cases, so `text` is built, not derived. Each class that targets a guard passes every check before that
guard, since an input an earlier check refuses never reaches it: (l) is the first run-time check
`fill` makes; (e) is not empty; (k)'s refused numbers are own keys; (v), (w) and (x) pass the caller's
Schema (`Schema.Number` takes `NaN` and `Infinity`, read in Effect 4.1.3's `Schema.ts`) and reach the
prune, the JSON check and the excess-key check in turn. Each class has a plant in slice 2's laws: the
guard deleted or bent, which a generator without the class would let pass. The routes are slice 1's.

- **`text`** (every path value, query text, payload text and answer text): (a) empty, one space, only
  spaces; (b) leading and trailing space, tab, `\n`, `\r\n`; (c) `/` alone, at the start, inside and at
  the end (`feature/x`, `a/b/c`); (d) URL marks: `%`, `%2F`, `%2e%2e`, `?`, `#`, `&`, `=`, `+`, `;`, `@`,
  `:`, a space inside; (e) `.` and `..` alone, and inside (`a..b`, `.x`, `x.`); (f) letters past ASCII
  (`é`, `ş`, `İ`), past U+024F (`设`, U+FFFD), outside the Basic Multilingual Plane (an emoji), and the
  lone surrogates U+D800 and U+DC00; (g) U+0000 to U+001F, U+007F, U+2028; (h) JSON and template marks:
  `"`, `\`, `{`, `}`, `[`, `]`, and another name of the same route in braces (`{repo}`); (i)
  `__proto__`, `constructor`, `toString`; (j) 256 to 4,000 characters.
- **`pathParams`**: a value for each name in the route's braces, from `text`, and (k) for integer names
  0, 1, 2^53−1, and the refused numbers −1.5, `NaN`, `Infinity`, −0; (l) a params value that passes
  the type through a cast but holds a name only on its prototype (made with `Object.create`), or not
  at all.
- **`queryInput`** (for the check-runs route with `per_page`, `status`, `check_name` and `filter`
  declared, some `optionalKey`, some `Schema.optional`): (m) a key absent; (n) a key present with
  `undefined`; (o) the falsy values 0, `false` and `""`; (p) for an array query parameter (`exclude` on
  the migrations route), the empty array, one item, many.
- **`payloadInput`** (for create an issue, the installation token and the dispatch): (q) an optional key
  present with `undefined` at the top; (r) present with `undefined` at depth 2 to 4 (the token's
  `permissions`, the dispatch's `inputs`) and inside an array of objects; (s) explicit `null` at the top
  and nested, where the Schema takes `NullOr`; (t) 0, `false`, `""`, `[]`, `{}` at every depth; (u) free
  keys under `inputs` from `text`, (i) included; (v) `undefined` as an array item; (w) `NaN` and
  `Infinity` where the Schema is `Schema.Number`; (x) an extra key in a value typed through a variable.
- **`schemas`** (the caller's Schemas, for C4 and C11): (y) a query, payload or success Schema whose
  transformation is async (it sleeps under `TestClock`) or needs a service; (z) a success Schema whose
  decoded type is not its encoded one (`Schema.DateTimeUtcFromString` for the token's `expires_at`).
- **`answers`** (reply bodies for the check-runs, installation-token and dispatch routes): (A) extra
  fields at every level; (B) `null` where the Schema takes `NullOr`; (C) an empty list and 1 to 50
  items; (D) the same JSON printed compact, pretty, and with `\u` escapes; (E) ids up to 2^53−1; (F) the
  dispatch's 204 with an empty body, beside its 200.
- **`brokenAnswers`**: (G) a wrong type at a generated depth; (H) a required key missing; (I) a literal
  outside the Schema's; (J) a body that is not JSON: empty, HTML, cut at a generated byte; (K) JSON
  `null`, a number, or a list where an object is wanted.
- **`errorBodies`** (statuses 400 to 499): (L) `basic-error` with every field; (M) `validation-error`
  with `errors` as objects (with `value` echoing a generated input); (N) `errors` as texts; (O) `{}`;
  (P) a body that is not JSON (HTML, empty); (Q) extra fields; (R) `message` from `text`.
- **`otherStatuses`**: (S) 100 to 199, 300 to 399 and 500 to 599; (T) 200 to 299 on a route that
  declares them, each a success.
- **`markers`** (for the span law): (U) a marker text from `text` (d), (f) and (h), put in turn in a
  path value, a query value, a payload value, a read answer field, an unread answer field, a 4xx
  `message`, a 4xx `errors` value, and the value that fails to decode.

## Laws, slice 2

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| T5, the input: an object literal payload with an unknown key does not compile; the issue route's input requires `payload`; the token route's input takes it optionally; `GET /zen`'s input has no `params` key; `call`'s input type is exactly `{ params, query?, payload }` per route | type | type | make every input key optional: the missing-payload line compiles, red | kalfa/github/src/GitHub.types.test.ts |
| T7, call's type: `GitHub.call(op, input)` is `Effect<Success<Op>, GitHubError \| RateLimited, GitHub \| Services<Op>>`; a success Schema whose decoding needs a service shows that service in the requirements; a route declared with no `success` answers `void`; the dispatch with a `success` answers `Option` of it | type | type | leave `Services<Op>` out of the requirements: the service line's `expectTypeOf` fails, red; answer the plain type on a route with a bodiless 2xx: the dispatch's `Option` line fails, red | kalfa/github/src/GitHub.types.test.ts |
| T8, only `route` reaches `call`: an object literal shaped like a `Route` is not accepted by `call`; the `GitHub` service's shape is exactly `send` and `poll` | type | type | type `call`'s first parameter structurally, without the brand: the literal line compiles, red | kalfa/github/src/GitHub.types.test.ts |
| C1, the path: for `pathParams` on the vector routes, the Request's path is the template with each `{name}` replaced by `encodeURIComponent(String(value))`, its fixed parts unchanged, and each filled segment decodes back to its value; (a), (e) alone, (f)'s lone surrogates, (k)'s refused numbers and (l) fail with `GitHubError` whose reason is `Undecodable` input, as a failure and never a defect, and the stand-in saw no request. 300 runs | test | Effect Arbitrary: pathParams | delete the empty-text guard: (a) is sent, red; trim the value before filling: (b) does not decode back, red; use `encodeURI`: (c) and (d) red; delete the `.` and `..` guard: (e) red; call `encodeURIComponent` unwrapped: (f) dies, red; drop control marks before filling: (g) does not decode back, red; fill by replacing names one after another in the growing text: a value holding `{repo}` from (h) is filled again, red; cut a value at 255 characters, a fixed limit: (j) red; delete the whole-number guard: (k) red; read `params[name]`, deleting the own-key guard: (l) sends the prototype's value, red; refuse only after sending: the stand-in's record is not empty, red | kalfa/github/src/GitHub.test.ts |
| C2, the query: for `queryInput`, the Request's query has exactly the keys whose value was given and not `undefined`, each equal to the encoded value, falsy values kept, arrays kept as arrays in order. 300 runs | test | Effect Arbitrary: queryInput | send every declared key, an absent one as `null`: (m) red; turn `undefined` into `null` (`Schema.toCodecJson`): (n) red; delete the falsy values: (o) red; join an array with commas: (p) red | kalfa/github/src/GitHub.test.ts |
| C3, a left-out field is never sent: for `payloadInput`, the Request's body holds no `undefined` and no key whose value was left out, at any depth; it keeps every explicit `null` and every falsy value; free keys stay own keys; (v), (w) and (x) fail with `Undecodable` input; and in every case the body equals the encoded payload with its left-out keys removed, by `assert.deepStrictEqual`. 300 runs | test | Effect Arbitrary: payloadInput | use `Schema.toCodecJson`: (q) sends `null`, red; prune the top level only: (r) red; drop `null` too: (s) red; drop falsy values: (t) red; treat `inputs` as closed and drop its free keys: (u) red; build the copy with `out[key] = value`: `__proto__` from (i) is lost, red; prune through a `JSON.stringify` round trip, deleting the array-hole guard: (v) becomes `null`, red; delete the JSON guard (`Schema.JsonObject`, with a finite check beside it if it takes non-finite numbers): (w) is sent as `null`, red; encode with the default `onExcessProperty`, deleting the excess-key guard: (x) is sent without its key, red | kalfa/github/src/GitHub.test.ts |
| C4, the answer: for `answers` and the `schemas` class (z), `call` gives the success Schema's decoded type of the declared fields only, equal by `assert.deepStrictEqual` to decoding the declared fields alone; the dispatch's 204 gives `Option.none()` without reading the body, its 200 `Option.some`. 300 runs | test | Effect Arbitrary: answers | decode with `onExcessProperty: "error"`: (A) red; give the encoded value: (z) red; read the body with a hand JSON reader that drops `\u` escapes: (D) red; decode the empty body of the 204: (F) becomes `Undecodable`, red | kalfa/github/src/GitHub.test.ts |
| C5, an answer that cannot be read: for `brokenAnswers`, `call` fails with `GitHubError` whose `operation` is the route text and whose reason is `Undecodable` answer with a cause, never a defect. 200 runs | test | Effect Arbitrary: brokenAnswers | decode with `Effect.orDie`: (G) dies, red; report side `input`: (H) red; leave out the cause: (J) red | kalfa/github/src/GitHub.test.ts |
| C6, GitHub's 4xx: for each status 400 to 499 and `errorBodies`, `call` fails with `ClientError` whose `status` is the reply's, and whose `message`, `documentationUrl` and `errors` are present exactly when GitHub's body had `message`, `documentation_url` and `errors`, each equal to GitHub's. 300 runs | test | Effect Arbitrary: errorBodies | require `message`: (O) and (P) become `Undecodable`, red; read `errors` as objects only: (N) red; keep `errors` but drop the `value` key: (M) red | kalfa/github/src/GitHub.test.ts |
| C7, other statuses: for `otherStatuses`, (S) fails with `Undecodable` answer whose message names the status and which has no cause, and (T) succeeds. 200 runs | test | Effect Arbitrary: otherStatuses | read 5xx as `ClientError`: (S) red; treat only 200 as success: (T)'s 202 fails, red | kalfa/github/src/GitHub.test.ts |
| C8, input refused, nothing sent: a payload Schema that refuses its value (an integer field at 1.5, a filter) makes `call` fail with `Undecodable` input, and the stand-in records no request. 100 runs | test | Effect Arbitrary: refusedPayloads | encode after sending: the stand-in's record is not empty, red | kalfa/github/src/GitHub.test.ts |
| C9, the span, decision 0063: under a recording tracer (`Tracer.make` with `Effect.withTracer`), each `call` ends exactly one span named `github.call` with `http.request.method` equal to the method, `http.response.status_code` equal to the reply's status (absent when nothing was sent), and `kalfa.github.operation` equal to the route text; no attribute key is `url.full` or names a header; and for each (U) place, the marker appears in no attribute value and in nothing `Cause.prettyErrors(exit, { includeCauseInStack: true })` gives for the span's failure (name, message, stack). 200 runs | test | Effect Arbitrary: markers | name the span `GitHub.call`: red; add the filled path as `url.full`: the (U) path-value marker shows, red; give `GitHubError` a `message` from its reason: the 4xx marker shows, red; give `GitHubError` a `cause` of its reason: the undecodable value shows in the stack, red | kalfa/github/src/GitHub.test.ts |
| C11, a Schema that may be async stays an Effect: for the `schemas` class (y), `call` encodes the query and payload and decodes the answer through Effects, so an async or service-needing transformation succeeds and its services reach `call`'s requirements; nothing is turned into a defect. 100 runs | test | Effect Arbitrary: schemas | encode with `Schema.encodeExit` (sync): (y) becomes a defect, red; decode with `Schema.decodeUnknownExit`: (y) becomes a defect, red | kalfa/github/src/GitHub.test.ts |
| P3, the reasons: `GitHubError`'s reason union is exactly `ClientError` and `Undecodable`, and no file under `kalfa/github/src/` but its tests names `Unreachable` (https://github.com/kamp-us/tea-fabrika/issues/1870) | test | scenario: the module's schema and the package's source at head | add a reason class named `Unreachable`: red | kalfa/github/src/Package.test.ts |

## Generators, slice 3

Every generator is an Effect `Arbitrary` in `kalfa/github/src/TestGitHub.test-support.ts`; it reuses
slice 2's `text` and `answers`. Each class has a plant in slice 3's laws.

- **`fakeCalls`**: (V) a route whose only 2xx is not 200 (cancel's 202, create an issue's 201), with
  its status option; (W) a request no answer covers; (X) two answers for the same route, the first one
  different; (Y) `layer` with a `poll` option and without one; (Z) an f that reads the params, query and
  payload it is handed, with values from `text` (h) and (i).

## Laws, slice 3

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| T9, the fake's types: `GitHubTest.answer(op, f)` takes an `f` that answers part of the description's answer, and refuses a key the description lacks at any depth; `answer(cancel, f)` with no status does not compile, `{ status: 202 }` does, `{ status: 200 }` does not; `refuse` refuses status 500; `GitHubTest.layer` is `Layer<GitHub.GitHub>` | type | type | type `Answered<Op>` as `unknown`: the unknown-key line compiles, red; type the status as any 2xx: the cancel `200` line compiles, red | kalfa/github/src/TestGitHub.types.test.ts |
| C10, the fake: `answer` replies with status 200 or the status given, and f's value as JSON text, and f sees the params, query and payload the Request carried; `refuse` goes through `call`'s real 4xx reading; the first matching answer wins; a request no answer covers dies with a defect naming the route; the service's `poll` is the option given, 30 seconds by default; a caller's real decoding runs on the text. 100 runs | test | Effect Arbitrary: fakeCalls | ignore the status option: (V) answers 200, red; fail with `ClientError` 404 for an uncovered route: (W) red; let the last match win: (X) red; fix `poll` at 30 seconds: (Y) red; hand f the decoded value instead of the encoded one the Request carried: (Z) red; write the text by joining strings, not with `JSON.stringify`: (Z)'s `"` marks break it, red | kalfa/github/src/TestGitHub.test.ts |
| P1, widened: `kalfa/github/package.json` now exports exactly `.`, `./test` and `./package.json`, and gives `./test` its `dist` pair | test | scenario: the package's own manifest at head | leave `./test` out of `publishConfig.exports`: red | kalfa/github/src/Package.test.ts |

**Lint, type or test?** L1 to L4 are shapes of imports and names: lint. T1 to T10, V1 and R1 are what
the compiler must accept or refuse: type, run by `pnpm typecheck`. C1 to C11 are about what a call
sends and gives, and P1 to P3 about what files hold, which no lint rule or type sees: tests. P3 reads a
name in source text, which a lint rule could also hold; a test keeps it beside the union check it goes
with.

**Where they run.** Every law runs in memory on every pull request. None needs launchd, the real
Electron app, a real OS process or socket, or a real signal, so none is host-only and none waits on the
owner's Mac. With the committed map gone, there is no `*.integration.test.ts` file and no download in
CI. No law calls the real GitHub API: slice 2's stand-in and slice 3's fake stand in for it. No secret
flows through this ticket (no token, no key), so no law is a `[secrets]` law; C9 keeps body text and
filled paths out of spans, and 1945 and 1953 add the token laws.

**Today's review lessons, where each lands.** Every guard on data has a class that reaches it, past
every earlier check, and a plant that deletes it (C1 to C3, C11, slice 2's lowercase classes). Own keys
are read only from a record keyed by a name: `fill` reads each path value with `Object.hasOwn` (l), and
the fake finds its answer in a list, never by a record lookup. A check that may meet an async Schema
stays an Effect: encoding and decoding go through `Schema.encodeEffect` and `Schema.decodeUnknownEffect`
(C11). Every limit is a setting: the fake's `poll` is an option; the code sets no length cap or count
(plant (j)); the live limits are 1945's settings.

## What fact is lost if it is not recorded now

- **Which date the types describe.** The package records none. `GitHub.apiVersion`, held by V1, and the
  catalog comment record it; without them a bump could move the types to 2026-03-10 while the client
  goes on sending 2022-11-28.
- **Which routes are checked only at run time.** R1 pins the list, and the README carries it.

Nothing else: the package stores nothing and keeps no log. The Octokit version is in the catalog and
the lockfile.

## Files, slice 1

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/github/package.json | tests | tests | new: name, `private`, scripts (`build`, `typecheck`), the `.` export and its `publishConfig` pair, `files`, `effect` as peer, dev dependencies with `@octokit/openapi-types`. The tests step owns it with the lockfile, so its laws install and run red |
| kalfa/github/tsconfig.json | tests | tests | new: as `kalfa/config`'s, with the Effect checks |
| kalfa/github/tsconfig.build.json | tests | tests | new: as `kalfa/config`'s |
| kalfa/github/rslib.config.ts | build | 12 | new: as `kalfa/config`'s |
| kalfa/github/src/internal/Check.ts | build | 175 | new: `RouteName`, `PathNames`, `Params`, `Query`, `Body`, `Answer`, `SuccessStatus`, `Bodiless`, `RunTimeOnly`, `DescribedVersion`, `ApiVersion`, `Options`, the fit checks and `Refused`; types only, reading `@octokit/openapi-types` |
| kalfa/github/src/GitHub.ts | build | 55 | new: `RouteName`, `Method`, `apiVersion`, `Route` with its unexported brand, `route`, with doc blocks |
| kalfa/github/README.md | build | docs | new: what the client is and is not (no area of GitHub, no call yet); declaring; what each check refuses and what is checked only at run time, with R1's 16 routes; where the types come from, the date they describe and how V1 holds it; how a bump goes |
| kalfa/AGENTS.md | build | docs | the "No import cycles" bullet gains the rank sentence |
| kalfa/github/src/GitHub.types.test.ts | tests | tests | T1 to T4, T6, T10 |
| kalfa/github/src/Octokit.types.test.ts | tests | tests | V1, R1 |
| kalfa/github/src/Package.test.ts | tests | tests | P1, P2 |
| .oxlintrc.json | tests | tests | L1 to L3: the new override for `kalfa/github/src/**`; that folder added to the `files` of the kalfa Effect block |
| layer-rules.json | tests | tests | L4: the `kalfa-github` row after `kalfa-git`, and `kalfa/github/src` in `roots` |
| boundary-rules.json | tests | tests | L4: the `kalfa-github` library type and its `libraries` entry |
| oxlint-plugins/layers.test.ts | tests | tests | L4: the pinned list gains `"kalfa-github": 0` with its reason comment |
| pnpm-workspace.yaml | tests | tests | the catalog gains `'@octokit/openapi-types': 29.0.1`, with a comment: GitHub's REST types for API version 2022-11-28, held exact; V1 holds `GitHub.apiVersion` to them |
| package.json | tests | tests | `@kalfa/github` as a root dev dependency, so `pnpm lint:reach` finds it reached |
| pnpm-lock.yaml | tests | tests | the new `kalfa/github` importer, `@octokit/openapi-types` 29.0.1, and the root's new link |
| vitest.config.ts | tests | tests | no change: its kalfa source glob already finds the laws |
| oxlint-plugins/match.ts | tests | tests | no change: read for `heldToNext` |
| .github/ci/shard-rows.ts | tests | tests | no change: read to learn a new test file with no shard row takes the fallback |
| tsconfig.base.json | tests | tests | no change: read for `skipLibCheck` (it keeps Octokit's 5 MB file out of each check), `exactOptionalPropertyTypes` and `allowImportingTsExtensions` |
| unreachable-ledger.json | tests | tests | no change expected: package `exports` targets are public to `pnpm lint:dead`; if it still flags an export, the step comes back to the plan, never to this ledger |

## Files, slice 2

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/github/src/GitHub.ts | build | 165 | adds `Request`, `Reply`, the `GitHub` service, `ClientError`, `Undecodable`, `GitHubError`, `RateLimited`, `Input`, `Success`, `Services`, `call` and its span, with doc blocks |
| kalfa/github/src/internal/Check.ts | build | 25 | adds the type parts `Input`, `Success` and `Services` read |
| kalfa/github/src/internal/wire.ts | build | 100 | new: `fill`, `prune`, `read`, each pure and returning a `Result` |
| kalfa/github/README.md | build | docs | adds calling, the errors, the span and what never goes in it, and that the package never logs or prints |
| kalfa/github/src/GitHub.test-support.ts | tests | tests | the generators and their classes, as Effect `Arbitrary` values, the recording stand-in for `send`, and the recording tracer |
| kalfa/github/src/GitHub.test.ts | tests | tests | C1 to C9, C11 |
| kalfa/github/src/GitHub.types.test.ts | tests | tests | adds T5, T7, T8 |
| kalfa/github/src/Package.test.ts | tests | tests | adds P3 |

## Files, slice 3

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/github/src/TestGitHub.ts | build | 120 | new: `answer`, `refuse`, `layer` with its `poll` option, `Asked`, `Answered`, `StatusOption`, with the opening comment on why a test module holds a Layer |
| kalfa/github/README.md | build | docs | adds testing on the fake |
| kalfa/github/package.json | tests | tests | adds the `./test` export and its `publishConfig` pair |
| kalfa/github/src/TestGitHub.test-support.ts | tests | tests | the `fakeCalls` generator |
| kalfa/github/src/TestGitHub.test.ts | tests | tests | C10 |
| kalfa/github/src/TestGitHub.types.test.ts | tests | tests | T9 |
| kalfa/github/src/Package.test.ts | tests | tests | P1 widened |

## Existing tools

- `@octokit/openapi-types` 29.0.1 in place of a generated map: the owner's pick of 2026-11-22. Searched
  npm for the Octokit type packages (`@octokit/openapi-types`, `@octokit/openapi-types-ghec`,
  `@octokit/types`) and read the first's files, generator and source; it ships types only, runs nothing
  at install, and is the industry's own type set for GitHub's REST API.
- `kalfa/github/src/internal/Check.ts`: searched `@octokit/types`' `Endpoints` (from memory, not
  fetched: it merges path, query and body into one `parameters` object, so it cannot tell a query key
  from a payload key, and it is a second package; not used), Effect's `HttpApiEndpoint` (`:name` routes
  with Schemas; it checks no outside description), openapi-fetch's path helpers (from memory; they check
  whole requests, not a caller's Schema against an answer), and Effect 4.1.3's `Types.DeepMutable`
  (used, for readonly against mutable arrays). No library checks an Effect Schema's encoded type against
  a description type, so the fit checks are new. `DescribedVersion` is new: the package records no date.
- `kalfa/github/src/internal/wire.ts`: searched Effect 4.1.3 for path filling (`HttpApiEndpoint` fills
  `:name` only), `UrlParams.fromInput` (it leaves out `undefined` and repeats arrays, used by 1945's
  live Layer for the query string), `Schema.toCodecJson` (turns a left-out optional into `null`, the bug
  the protocol ticket found, so not used), `Schema.JsonObject` (used, for the JSON check),
  `encodeURIComponent` and `Object.hasOwn` (used). No prune that drops left-out keys at depth and
  refuses an array hole was found, so `prune` is about 15 lines.
- `kalfa/github/src/GitHub.ts`: searched `kalfa/diagnostics/src/Diagnostics.ts` (the service and its
  call in one module, used as is), `effect-services-and-layers.md`, Effect's `HttpClientError` (its
  reasons are transport words, not GitHub's 4xx body, so GitHub's own errors are new), and Effect's
  `Schema.encodeEffect` and `Schema.decodeUnknownEffect` (used).
- `kalfa/github/src/TestGitHub.ts`: searched `effect/testing` (`TestConsole`, a test Layer with a read),
  Effect's `HttpApiTest` (an in-memory client for an `HttpApi` server, which this is not), `Layer.mock`,
  the repo's `Recorder` (it needs `@kampus/vitest`, which this package may not import), and
  `kalfa/diagnostics/src/TestDiagnostics.ts` (its layout, used). A list of answers behind one `send` is
  the smallest fit.
- `kalfa/github/rslib.config.ts`: searched `kalfa/config/rslib.config.ts`, copied as is; no file copy is
  needed now.

## Calls taken

- **Three slices, with the answer check in slice 1, 85%.** The lead asked for slices under about 300
  lines. The answer check is the riskiest guess and lives on `route`'s `success` option, so it settles
  first; with it in slice 2, that slice would be about 365 lines. Slice 2's laws run on a stand-in in
  the tests' own support file, so `call` lands before the public fake.
- **Send 2022-11-28, the date Octokit's types describe, 80%.** Doubts, first item; the one open
  question.
- **`GitHub.apiVersion` is typed by `Check.ApiVersion`, read from three changes in the types, 85%.** The
  package records no date, so the types themselves are the only source; three changes the 2026-03-10
  notes list (the dispatch's 204 and `return_run_details`, the pull request's `merge_commit_sha`) tell the
  two dates apart, and a mix reads as `never`, so a partial move is refused too. It reads only these two
  dates; a third date reads as `never` until someone adds its changes, which is the point.
- **Path names come from the route text and their types from the description, 85%.** The ticket says
  the names come from the text; the description says which are numbers.
- **`.` and `..` and an empty text are refused as path values, 85%.** A URL parser folds `..`, encoded
  as `%2e%2e` too, so the request would reach another route of GitHub's.
- **A path value is read only as an own key, 90%.** Today's review lesson; a cast value with a prototype
  must not send what it inherited.
- **Every path value is encoded with `encodeURIComponent`, 65%.** Doubts, last item.
- **The answer check, 75%.** Doubts, fourth item.
- **`Record<string, never>` is a closed empty answer, 80%.** Octokit writes both GitHub's `empty-object`
  (cancel's 202) and a bare object schema (15 routes' 202) this way, and the types cannot tell them
  apart. GitHub sends `{}` for them as far as the description says; a caller who needs more reads it as
  a run-time-only answer once 1945's `body: "text"` exists.
- **A route with a bodiless 2xx and a body 2xx answers `Option`, with a `bodiless` option checked
  against the types, 75%.** The status set is known only to the types, so `route` must carry it as a
  value, and the compiler holds the value to the types. The doubt is whether callers find `Option`
  heavy for routes like a PUT's 201 or 204; the other way (decode the empty body and fail) turns a
  normal GitHub answer into an error.
- **`onExcessProperty: "error"` on encoding the query and the payload, 80%.** A typo the compiler
  cannot see (a value typed through a variable) fails loudly instead of being dropped quietly.
- **Encoding and decoding stay Effects, 90%.** A caller's Schema may be async or need a service, and
  Effect's sync adapters turn that into a defect. `wire.ts` stays pure for what needs no Schema.
- **A left-out field is pruned, and an array hole is refused, 85%.** The protocol ticket found an
  optional body sent as `null` came back un-narrowed; `null` is sent only when the caller says `null`.
- **`GitHubError` has no `message` and no `cause` field, 85%.** Effect's tracer renders only those
  (read in `OtlpTracer.ts` and `causePrettyError`), so GitHub's text, the input's echo in `errors`, and
  the answer's values stay under `reason`, which a caller can read and a span never shows.
- **`Undecodable` keeps its SchemaError as `cause`, 85%.** It sits under `reason`, so it reaches no span
  (above), and `effect-errors-keep-their-cause.md` asks for it. It is `Schema.optional`, since the
  unread-status case has none.
- **`ClientError`'s fields follow GitHub's error schema, 75%.** `basic-error` makes every field
  optional, so `message`, `documentationUrl` and `errors` are present exactly when GitHub sent them, and
  `errors` stays as GitHub said it (`Schema.Json` items), since GitHub sends objects or texts.
- **A status that is neither 2xx nor 4xx is `Undecodable` answer for now, 75%.** This ticket builds only
  `ClientError` and `Undecodable`; 1945 makes a 5xx its `ServerError`.
- **The fake dies on a request no answer covers, 80%.** A missing answer is a bug in the test; a 404
  would let it pass as a "not found" case.
- **The fake answers 200 unless told, and the status option is typed by the route, 85%.** The held plan
  had the fake read "the route's first 2xx status in the description", but types do not exist at run
  time; this way the compiler asks for 202 on a cancel and refuses a status GitHub never sends.
- **`answer`'s f is a plain function, 75%.** Most fakes answer one fixed value. 1948 needs an answer that
  changes during a watch; it can widen `answer` to take an Effect, with no change to callers' tests.
- **The test module is `TestGitHub.ts`, exported as `./test`, 80%.** `kalfa/config`'s build and lint
  globs treat `*Test.ts` as test code and leave it out of `dist`, and the diagnostics package names its
  test module `TestDiagnostics.ts`. Callers import it as `GitHubTest`, the ticket's name.
- **A route is branded with an unexported symbol, 85%.** Only `route` runs the checks, so a hand-made
  object must not reach `call`. The same way as `Diagnostic.Declared`.
- **The span is `github.call` with `http.request.method`, `http.response.status_code` and
  `kalfa.github.operation`, 90%.** The ticket names them, in decision 0063's form. No filled path and no
  query go in it.
- **`@octokit/openapi-types` is a dev dependency, 85%.** The owner asked for it, and in the workspace
  every reader resolves it from the package's own `node_modules`. The built `.d.ts` files name it, so a
  published `@kalfa/github` would need it in `dependencies` (Findings).
- **The rank row at layer 0 for now, 80%.** It imports nothing yet; 1945 raises it above `kalfa-config`
  with the edge.
- **No glossary, 90%.** The glossary map says GitHub is not a context, and decision 0050 keeps GitHub's
  words in this package. No new domain word is coined.
- **Is any of this a setting?** The fake's `poll` is: an option of `layer`, 30 seconds by default. The
  route text, the checks, the encoding and the error reading are not: they must be the same for every
  caller, or one caller sends what another reads differently. `apiVersion` is not a free setting now:
  the types fix it (Findings, on ruling 7's `github.api-version`). No count, size or length is fixed in
  code.

## Validation

- Slice 1, tests step: `pnpm install` once, with the network, to add `@octokit/openapi-types` 29.0.1 to
  the store and the new importer to the lockfile (it is in neither, so `--offline` cannot do it); if the
  lead refuses a network install, the step comes back to the plan. Then `Package.test.ts` and
  `oxlint-plugins/layers.test.ts` by path, one at a time as the step's skill says: P1 and P2 red on the
  missing files, the pinned list green with the new row. L1 to L4's plants run by hand with `pnpm lint`,
  each undone, each red. The Node list in the override is written from `builtinModules` at the time.
- Slice 1, build step: `Check.ts` first, because it carries the riskiest guess. T1 to T4, T6, T10, V1 and
  R1 are held by the one whole-repo type check the build skill runs at its end, not by a run of its own
  mid-way; if the answer walk cannot be made to hold T6 across Octokit's `OneOf` types, the build stops
  and comes back to the plan, since this ticket exists to find that out. Then `pnpm format`,
  `pnpm lint` (it runs `lint:layers`, `lint:boundaries`, `lint:reach` and `lint:dead`), and
  `pnpm --filter @kalfa/github build` once, checking that `dist` holds no Octokit text, then deleting
  `dist`.
- Slice 2: the tests step runs `GitHub.test.ts` and `Package.test.ts` by path, red on the missing
  module parts; the build makes them green, then `pnpm format` and `pnpm lint`; its end type check holds
  T5, T7 and T8.
- Slice 3: the same with `TestGitHub.test.ts` and `Package.test.ts`; its end type check holds T9.
- The lead runs `pnpm typecheck` on each slice and notes in slice 1's pull request how long the
  package's own check took with Octokit's types. Slice 1's lockfile change makes the changed-files run
  the whole suite, so that full run is CI's.

## Size

1. Slice 1, declare: 242 lines (`Check.ts` 175, `GitHub.ts` 55, `rslib.config.ts` 12), plus T1 to T4,
   T6, T10, V1, R1, P1, P2, L1 to L4, the README's first part, the `kalfa/AGENTS.md` sentence, the rule
   rows, the catalog line and the lockfile.
2. Slice 2, call: 290 lines (`GitHub.ts` 165 more, `wire.ts` 100, `Check.ts` 25 more), plus T5, T7, T8,
   C1 to C9, C11, P3, slice 2's generators and the README's calling part.
3. Slice 3, test: 120 lines (`TestGitHub.ts`), plus T9, C10, P1 widened and the README's testing part.

652 product lines in all, 45 lower than the one-slice count: once cut, `GitHub.ts` came to 220 lines,
not 250, and `wire.ts` to 100, not 115, since the read of the reply's Schema steps sits in `call`.
About 6 agent hours across the three slices, 65% sure. The doubt is slice 1's type-level checks: making
TypeScript refuse a nested misspelled field across a 5 MB description with `OneOf` helpers, with
readable errors, is the larger part, and its build may send it back once. Budget basis: the diagnostics
plan measured about $5 a step for a package of about 230 lines. Slice 1 is about that size but type-level
work, about $12 a step, with one likely send-back: 4 steps, $48. Slice 2 is plain Effect code with many
laws, about $9 a step: 3 steps, $27. Slice 3 is small, about $5 a step: 3 steps, $15.

Estimate: 10 steps, $90
## New names

- `route`, `call`, `GitHubError`, `ClientError`, `Undecodable`, `RateLimited`, the `GitHub` service and
  its members `send` and `poll`, `GitHubTest.layer`, `answer`, `refuse`: the protocol ticket's and this
  ticket's.
- `Request`, `Reply`: the wire request and reply the service speaks in (the protocol's sketch names them
  `Wire.Request` and `Wire.Reply`); code names.
- `apiVersion`, `ApiVersion`: GitHub's own term, the value of its `X-GitHub-Api-Version` header.
- `RouteName`, `Route`, `Input`, `Success`, `Services`, `Asked`, `Answered`, `StatusOption`, `Refused`,
  `SuccessStatus`, `Bodiless`, `bodiless`, `RunTimeOnly`, `DescribedVersion`, `fill`, `prune`, `read`:
  code names inside the package, not domain words.
- `side` with `input` and `answer`, `documentationUrl`, `errors`: the ticket's and GitHub's.
- `github.call`, `kalfa.github.operation`: the span and its attribute, in decision 0063's form.

No new domain word, so no glossary entry.

## Records

- No `GLOSSARY.md` (above). `kalfa/AGENTS.md`'s one rank sentence.
- The README and the pull request record where the types come from, the date they describe, the
  run-time-only routes and how a bump goes.
- A decision record is the lead's call: "GitHub's REST types come from `@octokit/openapi-types`, and
  the client sends the date they describe" is hard to reverse once callers depend on it, and it changes
  ruling 7's default. The lead can record it with the adr skill once the open question is answered; this
  plan writes no decision.
- No pattern doc yet: the first caller's `/github` entry point shows whether "declare an operation"
  needs one.

## What this cannot tell us

- Whether the answer walk can hold T6 across Octokit's `OneOf` and `XOR` types with readable errors,
  until the build writes it. Nothing was type-checked while planning.
- How long `pnpm typecheck` grows with Octokit's 5 MB file and our walk over it. Octokit's users carry
  the same file, but this repo's checker, with Effect's checks, was not measured on it.
- Whether Octokit keeps publishing, and when its types move to 2026-03-10. Nothing says they will.
- Whether GitHub decodes `%2F` in a multi-segment path value. 1945's real read should try one.
- Whether GitHub's description is right for the routes the first callers read. Ruling 10's check is only
  as good as the description; a wrong description shows as an `Undecodable` at run time.
- Whether the bare-object 202s really answer `{}`: the description does not say; the first caller of one
  will see.
- Whether the built `dist` installs and type-checks in another repo: no consumer check runs for this
  package, and its `.d.ts` files name a dev dependency.
- What a span really shows in an outside viewer: C9 mirrors what Effect's OTLP tracer writes, but no
  real exporter runs here.
- How 1945's live Layer turns the `Request` into a URL and the `query` into a query string;
  `UrlParams.fromInput` is the likely tool, not tried here.

## Open questions

1. Octokit types = API 2022-11-28 (closes 2028-03-10), not ruling 7's 2026-03-10. Send 2022-11-28? Lean
   yes, 80%: it follows your rule that the date matches Octokit's, and GitHub supports it for 15 more
   months; the cost is the older answers (dispatch 204 unless `return_run_details`, `merge_commit_sha`
   kept) and a move later. The plan builds it with 2022-11-28.

## Findings

1. **OpenTelemetry's `url.template` may fit beside `kalfa.github.operation`.** Decision 0063 says
   standard names first. The semantic conventions name `url.template` for a path's low-cardinality
   template (from memory, not fetched). The ticket names `kalfa.github.operation` for the route text,
   which also holds the method, so this plan sets only the ticket's three attributes. Adding
   `url.template` is one line and one law, the lead's call.
2. **Today's lead tooling reads a route this client can check only at run time.** `ChecksGh.ts` reads
   `GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs`, which Octokit's types answer with no success
   status (GitHub sends a 302). When CI's `/github` entry point declares it, its answer is text read at
   run time (1945's `body: "text"`), with no compile-time check. Nothing to do here.
3. **Ruling 7's `github.api-version` setting can no longer move alone.** Proof: V1 ties the date to the
   types. If 1945 lets a person set another date, the compile-time checks describe answers GitHub no
   longer sends. 1945 should default it to `GitHub.apiVersion` and refuse any other value, or drop the
   setting; that is 1945's plan to decide.
4. **`@octokit/openapi-types` records no API date.** Proof: its `package.json` holds only
   `octokit.openapi-version` (`23.0.1`), and `scripts/generate-types.js` in `octokit/openapi-types.ts`
   at `83df989` writes nothing else. An upstream request to record the date (say,
   `octokit.api-version: "2022-11-28"`) would let V1 read a field instead of three changes. Filing it is
   the lead's call.
5. **A published `@kalfa/github` needs Octokit's types as a real dependency.** Proof: the built
   `GitHub.d.ts` reaches `internal/Check.d.ts`, which names `@octokit/openapi-types`; a consumer outside
   this workspace would not have it. The package is private now; the publish ticket moves it to
   `dependencies`.

## The owner's answer at signing (2026-11-22)

Ask G2 is answered yes: the client sends `X-GitHub-Api-Version: 2022-11-28`, the date Octokit's pinned types describe,
and moves to a newer date when Octokit ships types for one (law V1 sees the move). The plan's one open question is
closed.
