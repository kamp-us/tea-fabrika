---
summary: Can one trace run from the code that asked for a build, through a GitHub Actions run, down to the one failing Vitest test? What OpenTelemetry's env-var carrier, GitHub Actions, Vitest, Effect and trace backends each give, with sources, one real Vitest run, and what is missing
---

# Tracing a red main: from the build request to the failing test

Question: when main goes red, can an agent follow one trace from the code that asked for a build, through a GitHub
Actions run, to the one failing test? This feeds the design of `@kalfa/telemetry` on Effect 4.

Read on 2026-11-21. Versions in this repo's lockfile (`pnpm-lock.yaml`): `effect@4.1.3`, `vitest@5.0.5` (patched),
`@effect/opentelemetry@4.1.3`, `@opentelemetry/api@1.9.1`, `@opentelemetry/sdk-trace-base@2.12.0`. Latest Vitest on npm
is 5.1.1. Specs were read from their `main` branch. A line marked "my reading" is mine, not a source's claim. Paths are
repo-relative; `node_modules/.pnpm/...` paths are shortened to the package.

## The short answer

Yes for the two ends, with glue in the middle that we write. About 80% sure.

1. The env-var carrier is a Stable OpenTelemetry spec, and Vitest 5.0.5 already reads `TRACEPARENT` at start. A test
   run therefore joins a trace with no code of ours, once an SDK is registered.
2. GitHub gives a workflow run no trace parent of its own and emits no OpenTelemetry for runs or jobs. We must hand
   the trace parent in (an input, a payload, a commit trailer) and turn it into `TRACEPARENT` in a step.
3. Effect 4.1.3 does not read `TRACEPARENT`. It reads W3C `traceparent` from HTTP headers only. About 5 lines of ours
   turn the env var into a parent span.
4. A failing test is findable, but the error is not on the test's own span. See section 3.
5. Reading back is not OTLP's job. The simplest reader an agent can use with no backend is a JSON-lines file.

## 1. OpenTelemetry: environment variables as carriers

- **Status: Stable on `main`, not yet in a release.** The spec page says `Status: Stable`
  ([env-carriers.md](https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/context/env-carriers.md)).
  The changelog lists "Mark Environment Variables as Context Propagation Carriers as Stable" under `Unreleased`, above
  v1.62.0 (2026-10-21), the latest release
  ([CHANGELOG.md](https://github.com/open-telemetry/opentelemetry-specification/blob/main/CHANGELOG.md)). It was Release
  Candidate in an earlier release, and Beta before (same file).
- **Names.** The carrier does not name `TRACEPARENT` itself. A propagator's key is normalized: letters uppercased, any
  other character becomes `_`, a leading digit gets a `_`. So the W3C key `traceparent` reads and writes
  `TRACEPARENT`. `Get` reads only the normalized name. A case-insensitive platform (Windows) may match a lowercase
  variable.
- **Values are opaque.** The carrier does not validate. The propagator parses and validates. The page gives no
  fallback for a bad value. For W3C, an invalid header means a new trace starts
  ([Trace Context 3.4](https://www.w3.org/TR/trace-context/#mutating-the-traceparent-field)).
- **Read once, at start.** "Child-process startup is the point where context is extracted." A parent should not
  change its own variables. To start a child: copy the environment, inject into the copy, pass the copy to spawn. The
  spec says propagation must not spawn processes itself.
- **`TRACESTATE`, `BAGGAGE`.** Not named by the page. Each propagator picks its own key. Vitest reads `TRACESTATE` and
  tolerates its absence (section 3).
- **Security.** Do not put secrets in these variables. Any code in the process, and other users with permission, can
  read them.
- **Does Effect 4 read it? No.** A search of `effect@4.1.3` `src/` and `@effect/opentelemetry@4.1.3` `src/` finds no
  `TRACEPARENT`. The OTLP env reading in `effect/src/observability/internal/otlpEnv.ts` covers only
  `OTEL_EXPORTER_OTLP_*` and `OTEL_{LOGS,METRICS,TRACES}_EXPORTER`. `@effect/opentelemetry/src/Resource.ts` reads
  `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES`. What Effect does have: `HttpTraceContext.w3c` (line 152 of
  `effect/src/http/HttpTraceContext.ts`) turns a headers record into `Option<Tracer.ExternalSpan>`.
  My reading of what the code would be: read `Config.string("TRACEPARENT")`, build `Headers.fromInput({ traceparent })`,
  call `HttpTraceContext.w3c`, then `Effect.withParentSpan` or `Layer.parentSpan` on the program. Not run.
  `tracestate` would need its own handling: `w3c` returns only trace id, span id and sampled
  (the sibling note `.kalfa/research/otel-trace-across-log.md` section 4 covers the same gap).

## 2. GitHub Actions

- **Can a run receive a trace parent? Yes, by three routes, each a string we parse ourselves.** GitHub has no field
  for it.
  - `workflow_dispatch` takes custom `inputs`, set by `gh workflow run x.yml -f traceparent=...`; the run reads them
    as `inputs.*`
    ([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)).
    The docs I read give no size limit for inputs. Not found.
  - `repository_dispatch` carries `client_payload`, read as `github.event.client_payload.*`. Limits: 10 top-level
    properties and 65,535 characters; `event_type` is capped at 100 characters (same page, `repository_dispatch`).
  - A push has no input. The trace parent would ride in the commit message or a committed file, read from the push
    event's `head_commit.message` or from the checkout. Not tested, and a merge or squash commit may drop a trailer.
    This is the case that matters for "main went red", because main usually builds on push or merge.
- **Does GitHub emit OpenTelemetry for runs and jobs? I found no sign that it does.** A code search of the
  `github/docs` repo for "opentelemetry" returns only Copilot pages
  (`content/copilot/concepts/enterprise/opentelemetry.md`), none under `content/actions`. About 85% sure: absence in
  one search is weak evidence, and the search API can miss files. A run's identity is exposed as plain data instead
  (run id, job, URL), which the CI/CD conventions below map to attributes.
- **OTel `cicd.*` conventions.** Status of the span page: Release Candidate
  ([cicd-spans.md](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/cicd/cicd-spans.md)). The
  attribute registry marks every `cicd.*` key Release Candidate
  ([cicd.md](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/registry/attributes/cicd.md)).
  - Pipeline run: span kind `SERVER`. Name `{action} {pipeline}` when a low-cardinality pipeline name exists, else
    `{action}`, where `{action}` is `cicd.pipeline.action.name` (`BUILD`, `RUN`, `SYNC`). Required: `cicd.pipeline.result`
    (`success`, `failure`, `error`, `timeout`, `cancellation`, `skip`). `error.type` is required on `failure` or
    `error`.
  - Task run: span kind `INTERNAL`. Required: `cicd.pipeline.task.name`, `cicd.pipeline.task.run.id`,
    `cicd.pipeline.task.run.result`, `cicd.pipeline.task.run.url.full`. The page's own URL example is a GitHub
    Actions job URL. No span name is given for a task run.
  - The registry also defines `cicd.pipeline.name`, `cicd.pipeline.run.id`, `cicd.pipeline.run.url.full`.
  - The page says nothing about propagating a parent into a pipeline run. My reading: the convention describes the
    CI system's own spans, which GitHub does not emit, so a step of ours would emit them.

## 3. Vitest

- **Yes, per-test spans, behind an experimental flag.** Docs page titled "Open Telemetry Support" with an
  Experimental tag
  ([guide/open-telemetry](https://github.com/vitest-dev/vitest/blob/main/docs/guide/open-telemetry.md)). Turn on with
  `test.experimental.openTelemetry = { enabled: true, sdkPath: "<module>" }`. The code reads exactly those keys
  (`vitest/dist/chunks/cli-api.*.js`, `new Traces({ enabled, sdkPath })`). `@opentelemetry/api` must be installed
  (peer, `vitest/package.json`). The SDK module must have a `default` export with `shutdown()`, so Vitest can flush;
  Vitest does not call `start` for it.
- **Parent from `TRACEPARENT`: yes.** `vitest/dist/traces.js` `getContextFromEnv` copies `env.TRACEPARENT` and
  `env.TRACESTATE` into a carrier and calls `propagation.extract`, citing the env-carriers spec in a comment. It is
  called in `vitest.start`, so the whole run is a child of the given parent. Same code is in 5.1.1
  (`npm pack vitest@5.1.1`, `dist/traces.js` lines 93-95). The docs page says the same.
- **Span names (from source, 5.0.5):** `vitest.start`, `vitest.test_run`, `vitest.worker`, then
  `vitest.test.runner.run.spec` (a file), `...run.suite`, `...run.test`, and `...test.beforeEach`,
  `...test.callback`, `...test.afterEach`. Attributes on `run.test`: `vitest.test.id`, `vitest.test.name`,
  `vitest.test.mode`, `vitest.test.timeout`, `code.file.path`, `code.line.number`, `code.column.number`
  (`vitest/dist/chunks/run.*.js`, `runSuiteChild`). The docs name only some spans and no attributes.
- **Not turned on by `TRACEPARENT` alone.** Without a registered SDK, `propagation.extract` does nothing. Vitest does
  not register a W3C propagator or a context manager. I found this by running it.
- **Experiment (one real run, 5.0.5, not committed).** A scratch project with two tests, one passing and one failing
  (`expect(1).toBe(2)`), an `sdkPath` module with `BasicTracerProvider`, a W3C propagator, and an
  `AsyncLocalStorage` context manager, writing one JSON line per span, run with
  `TRACEPARENT=00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`.
  - All 41 spans, workers included, carry trace id `4bf92f35...`. `vitest.start`'s parent is `00f067aa0ba902b7`.
    The chain is start, test_run, worker, run.spec, run.test.
  - Without the propagator and context manager, every span got its own trace id.
  - **A failing test: `run.test` has status UNSET and no events. The error lives one level down.** Its child
    `vitest.test.runner.test.callback` has status ERROR (code 2) and an `exception` event with
    `exception.type`, `exception.message`, `exception.stacktrace`. The passing test's callback has status UNSET.
    Source agrees: only a callback that throws gets `recordException` and `setStatus`
    (`vitest/dist/traces.js`, `#callActiveSpan`); `runTest` catches the error itself, so the `run.test` span ends
    clean. So an agent finds the failing test by looking for ERROR spans, then walking one parent up for
    `vitest.test.name` and `code.file.path`.
  - Not seen: `code.line.number` was absent in my run (no location option set). A `beforeEach` or `afterEach`
    failure was not tried. A retry was not tried.
- **Test spans in the Effect world.** `@effect/vitest` is in the repo's root `package.json`; I did not test how an
  Effect test's own spans join Vitest's. Not found.
- **Not enabled in this repo today.** No `openTelemetry` key in any Vitest config here.

## 4. Reading spans back

- **OTLP is the push (export) protocol.** The OTLP spec defines how a producer sends data
  ([otlp.md](https://opentelemetry.io/docs/specs/otlp/)). I found no read or query operation in it. A reader needs a
  backend's own API. (My reading of an absence; about 90%.)
- **Jaeger.** Query API v3: `GET /api/v3/traces/{trace_id}`, `GET /api/v3/traces` (search), `GET /api/v3/spans`,
  `GET /api/v3/services`. Returns OTLP `TracesData`, wrapped in a `{"result": ...}` envelope over HTTP
  ([`query_service.proto`](https://github.com/jaegertracing/jaeger-idl/blob/main/proto/api_v3/query_service.proto)).
  Latest release v2.23.0.
- **Grafana Tempo.** `GET /api/traces/<id>`, `GET /api/v2/traces/<id>` (optional `q` TraceQL filter),
  `GET /api/search?...` (TraceQL queries, e.g. `{ span.http.status_code = 500 }`), plus tag and TraceQL-metrics
  endpoints ([Tempo API](https://github.com/grafana/tempo/blob/main/docs/sources/tempo/api_docs/_index.md)).
- **Honeycomb.** The Query Data API: create a query, `POST /1/query_results/{dataset}`, poll until `complete`.
  Enterprise plan. 7-day window, 10 result creations per minute, results within 10 seconds
  ([query-data](https://docs.honeycomb.io/api/query-data/)). I found no get-trace-by-id endpoint in that page; not
  checked elsewhere.
- **No backend: OTLP JSON lines file.** The OTel file exporter spec says a JSON lines file is UTF-8, one JSON value
  per line, `\n` separated, preferred extension `jsonl`, one signal type per file, and "no guarantee that the data in
  the file is ordered". Status: Development
  ([file-exporter.md](https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/file-exporter.md)).
  The Collector's `fileexporter` writes it, and `otlpjsonfilereceiver` reads it back
  ([README](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/fileexporter/README.md)).
  My reading: an agent can `rg` or `jq` such a file by trace id with no server. We would write our own small
  exporter (the experiment's 10-line exporter did this).

## 5. Where this repo carries a trace id today

- `next/packages/libfabrika/src/ledger/Log.ts` (lines 29-88): `TraceId` schema (32 hex, nonzero) and `fromHere`, which
  fills a ledger line's `traceId` from the current span. No span id is kept.
- `next/packages/libfabrika/src/ledger/internal/ledgerStore.ts` (lines 27, 73, 131): `traceId` column and schema.
- `next/apps/fabrika/src/exam/commits.ts` (line 70): an `attested` link row, with `traceId`, for `field/runs.jsonl`.
- `next/packages/libfabrika/src/cloudflare/runtime.ts` (lines 2041-2657) and `gateway/Gateway.ts` (line 1733):
  `Tracer.externalSpan` + `Effect.withParentSpan` and span links, for RPC hops.
- No `TRACEPARENT` anywhere in `next/`, `.github/`, `scripts/`. No CI result record in `.github/` carries a trace id.
  No Vitest config enables OpenTelemetry.

## What I could not find, or did not test

- A GitHub statement that Actions emits no OpenTelemetry. I have only an absence in a docs search.
- Size limits on `workflow_dispatch` inputs (not on the pages I read).
- Whether a commit trailer survives a squash merge into main, and whether the push event exposes it as we need.
- How Vitest behaves on `beforeEach` failure, on a retry, in browser mode, and with 5.1.1 at runtime (source only).
- How `@effect/vitest` test spans nest under Vitest's. Whether `@kalfa/telemetry` can itself be the `sdkPath` module
  (my reading: yes, if it registers a W3C propagator and an async context manager; untested).
- Jaeger v3 API stability, and a Honeycomb get-trace endpoint.

## Sources

- https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/context/env-carriers.md
- https://github.com/open-telemetry/opentelemetry-specification/blob/main/CHANGELOG.md
- https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/file-exporter.md
- https://github.com/open-telemetry/semantic-conventions/blob/main/docs/cicd/cicd-spans.md
- https://github.com/open-telemetry/semantic-conventions/blob/main/docs/registry/attributes/cicd.md
- https://github.com/github/docs/blob/main/content/actions/reference/workflows-and-actions/events-that-trigger-workflows.md
- https://github.com/vitest-dev/vitest/blob/main/docs/guide/open-telemetry.md
- Vitest 5.0.5 and 5.1.1 `dist/traces.js` and `dist/chunks/run.*.js` (installed package and `npm pack`)
- `effect@4.1.3` `src/http/HttpTraceContext.ts`, `src/observability/internal/otlpEnv.ts`;
  `@effect/opentelemetry@4.1.3` `src/Resource.ts`
- https://github.com/jaegertracing/jaeger-idl/blob/main/proto/api_v3/query_service.proto
- https://github.com/grafana/tempo/blob/main/docs/sources/tempo/api_docs/_index.md
- https://docs.honeycomb.io/api/query-data/
- https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/fileexporter/README.md
