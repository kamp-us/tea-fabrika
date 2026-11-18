import { run } from "@demlik/tea/effect";
// Today's lead tooling. Raw reports and traces remain private; only these decoded facts may leave.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Cause,
  Console,
  Context,
  DateTime,
  Effect,
  Exit,
  FileSystem,
  Option,
  Path,
  Ref,
  Result,
  Schema,
  Scope,
  Stream,
} from "effect";
import { Digest } from "effect/crypto";
import { FetchHttpClient, HttpClient } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Cases from "./l11-cases.ts";
import { Reason, Phase, Outcome as PhaseOutcome, Model, machine } from "./l11-machine.ts";
import { Attribution, Metadata } from "./l11-reporter.ts";
import { diffOptions, unchanged, type Snapshot as PlantSnapshot } from "./plant.ts";

const Nonnegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

export const Status = Schema.Literals(["passed", "failed", "skipped", "pending", "todo", "disabled"]);

const Assertion = Schema.Struct({
  fullName: Schema.String,
  status: Status,
  duration: Schema.optional(Schema.NullOr(Nonnegative)),
  failureMessages: Schema.NullOr(Schema.Array(Schema.String)),
  meta: Schema.optional(Metadata),
});

const Reporter = Schema.Struct({
  success: Schema.Boolean,
  testResults: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      status: Schema.Literals(["passed", "failed"]),
      message: Schema.String,
      startTime: Nonnegative,
      endTime: Nonnegative,
      assertionResults: Schema.Array(Assertion),
    }),
  ),
});

const Collection = Schema.Array(Schema.Struct({ name: Schema.String, file: Schema.String }));

export const Counts = Schema.Struct({ reply: Schema.Int, span: Schema.Int, row: Schema.Int, log: Schema.Int });

const Cut = Schema.Struct({ path: Schema.String, operation: Schema.Int, statement: Schema.String });

const Pick = Schema.Struct({ point: Schema.Int, encoding: Schema.Literals([0, 1, 2]) });

export const Trace = Schema.TaggedUnion({
  inventory: { inventory: Schema.Array(Cut) },
  walk: { walk: Schema.Int, secret: Schema.String, forms: Schema.Array(Schema.String) },
  pick: { walk: Schema.Int, move: Schema.Int, pick: Pick, cut: Cut, repeat: Schema.Boolean, marker: Schema.String },
  inspect: {
    walk: Schema.Int,
    move: Schema.Int,
    counts: Counts,
    leaks: Schema.Struct({ reply: Schema.Boolean, span: Schema.Boolean, row: Schema.Boolean, log: Schema.Boolean }),
  },
  move: { walk: Schema.Int, moves: Schema.Int },
  end: { walk: Schema.Int, moves: Schema.Int },
  complete: { remaining: Schema.Int, reached: Schema.Int },
  project: {
    path: Schema.Literals(Cases.paths),
    output: Schema.Literals(Cases.outputs),
    secret: Schema.String,
    forms: Schema.Array(Schema.String),
  },
  "project-pick": {
    path: Schema.Literals(Cases.paths),
    output: Schema.Literals(Cases.outputs),
    move: Schema.Int,
    pick: Pick,
    available: Schema.Array(Schema.String),
    repeat: Schema.Boolean,
  },
  "project-cut": {
    path: Schema.Literals(Cases.paths),
    output: Schema.Literals(Cases.outputs),
    point: Schema.String,
    marker: Schema.String,
  },
  "project-end": {
    path: Schema.Literals(Cases.paths),
    output: Schema.Literals(Cases.outputs),
    moves: Schema.Int,
    reached: Schema.Int,
    expected: Schema.Int,
    inspected: Schema.Int,
    leaked: Schema.Boolean,
  },
});

export type Trace = typeof Trace.Type;

export const Fact = Schema.Struct({
  // Whole-file scenario names are represented by their collection ordinal, never arbitrary reporter strings.
  index: Schema.Int,
  target: Schema.NullOr(Schema.Literals(Cases.titles)),
  status: Status,
  duration: Schema.NullOr(Nonnegative),
  timeout: Schema.Boolean,
  lowerBound: Schema.NullOr(Schema.Literal(60000)),
  final: Schema.Boolean,
  observations: Schema.Array(Attribution),
  assertion: Schema.NullOr(Schema.Struct({ line: Schema.Int, column: Schema.Int })),
});

export type Fact = typeof Fact.Type;

export const Observation = Schema.TaggedUnion({
  observed: { assertions: Schema.Array(Fact), failed: Schema.Boolean, elapsed: Nonnegative },
  incomplete: { reason: Reason, assertions: Schema.Array(Fact) },
});

export type Observation = typeof Observation.Type;

const missing = (reason: Reason, assertions: readonly Fact[] = []): Observation =>
  Observation.cases.incomplete.make({ reason, assertions });

const targetName = Schema.decodeUnknownOption(Schema.Literals(Cases.titles));

const target = (name: string): Fact["target"] => {
  const value = targetName(name);

  return Option.getOrNull(value);
};

const timeout = (messages: readonly string[]) =>
  messages.some((message) => /Test timed out in 60000ms|Test timed out in 60000 ms/.test(message));

export const reconcile = (request: Cases.Request, collection: unknown, report: unknown, exit: number): Observation => {
  const listed = Schema.decodeUnknownResult(Collection)(collection, { onExcessProperty: "ignore" });

  if (Result.isFailure(listed) || listed.success.length === 0) {
    return missing("missing_collection");
  }

  const names = listed.success.map((entry) => entry.name);

  if (
    new Set(names).size !== names.length ||
    !Cases.selected(request).every((name) => names.includes(name)) ||
    listed.success.some(
      (entry) => !entry.file.replaceAll("\\", "/").endsWith(`/${Cases.file}`) && entry.file !== Cases.file,
    )
  ) {
    return missing("collection_mismatch");
  }

  if (report === null || report === undefined) {
    return missing("missing_report");
  }

  const parsed = Schema.decodeUnknownResult(Reporter)(report);

  if (Result.isFailure(parsed)) {
    return missing("malformed_report");
  }

  const files = parsed.success.testResults;

  if (files.length === 0) {
    return missing("empty_report");
  }

  if (files.length !== 1) {
    return missing("collection_mismatch");
  }

  const suite = files[0];

  if (suite === undefined || suite.assertionResults.length === 0) {
    return missing("startup");
  }

  if (suite.name !== listed.success[0]?.file) {
    return missing("collection_mismatch");
  }

  const channel = Cases.output(request);

  if (
    channel !== null &&
    suite.assertionResults.some((entry) => !names.includes(entry.fullName) && entry.status !== "skipped")
  ) {
    return missing("collection_mismatch");
  }

  const actual =
    channel === null
      ? suite.assertionResults
      : suite.assertionResults.filter((entry) => names.includes(entry.fullName));

  const facts = actual.map((entry): Fact => ({
    index: names.indexOf(entry.fullName),
    target: target(entry.fullName),
    status: entry.status,
    duration: entry.duration ?? null,
    timeout: timeout(entry.failureMessages ?? []) || entry.meta?.l11Causal?.timeout === true,
    lowerBound: timeout(entry.failureMessages ?? []) || entry.meta?.l11Causal?.timeout === true ? 60000 : null,
    final:
      Cases.output(request) !== null &&
      entry.meta?.l11Causal?.finals.some((output) => output === Cases.output(request)) === true,
    observations: entry.meta?.l11 ?? [],
    assertion: entry.meta?.l11Causal?.assertion ?? null,
  }));

  if (
    actual.length !== names.length ||
    new Set(actual.map((entry) => entry.fullName)).size !== actual.length ||
    facts.some((fact) => fact.index < 0)
  ) {
    return missing("collection_mismatch", facts);
  }

  const inactive = actual.find((entry) => entry.status !== "passed" && entry.status !== "failed");

  if (inactive !== undefined) {
    return missing(
      inactive.status === "disabled"
        ? "skipped"
        : inactive.status === "passed" || inactive.status === "failed"
          ? "wrong_assertion"
          : inactive.status,
      facts,
    );
  }

  const failed = facts.some((fact) => fact.status === "failed");

  if (
    (failed ? exit !== 1 : exit !== 0) ||
    parsed.success.success === failed ||
    suite.status !== (failed ? "failed" : "passed") ||
    suite.message !== "" ||
    suite.endTime < suite.startTime ||
    actual.some((entry) => entry.status === "passed" && (entry.failureMessages?.length ?? 0) !== 0)
  ) {
    return missing("wrong_assertion", facts);
  }

  return Observation.cases.observed.make({ assertions: facts, failed, elapsed: suite.endTime - suite.startTime });
};

export const plant = (seen: Observation): Reason | null =>
  Observation.match(seen, {
    incomplete: ({ reason }) => reason,
    observed: ({ assertions, failed }) =>
      !failed
        ? "green_plant"
        : assertions.some((fact) => fact.timeout)
          ? "timeout"
          : assertions.some((fact) => fact.status === "failed" && !fact.final)
            ? "early_assertion"
            : assertions.some((fact) => fact.status === "failed" && fact.final)
              ? null
              : "wrong_assertion",
  });

const decodeTrace = Schema.decodeUnknownResult(Schema.fromJsonString(Trace));

const parsedTrace = (
  stdout: string,
  decoded?: Map<string, Trace>,
): { readonly events: readonly Trace[]; readonly reason: Reason | null } => {
  const events: Trace[] = [];

  for (const line of stdout.split("\n")) {
    if (!line.startsWith(Cases.tracePrefix)) {
      continue;
    }

    const known = decoded?.get(line);

    if (known !== undefined) {
      events.push(known);
      continue;
    }

    const result = decodeTrace(line.slice(Cases.tracePrefix.length), {
      onExcessProperty: "error",
    });

    if (Result.isFailure(result)) {
      return { events, reason: "trace_incomplete" };
    }

    decoded?.set(line, result.success);
    events.push(result.success);
  }

  return { events, reason: events.length === 0 ? "trace_missing" : null };
};

const readTrace = (stdout: string, decoded: Map<string, Trace>): Result.Result<readonly Trace[], Reason> => {
  const parsed = parsedTrace(stdout, decoded);

  return parsed.reason === null ? Result.succeed(parsed.events) : Result.fail(parsed.reason);
};

const normalized = Schema.encodeSync(Schema.Array(Trace));

const forms = (secret: string) => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const failures = {
  descriptor: ["owner", "descriptor"],
  recovery: ["exists", "owner", "descriptor"],
  configuration: ["pending", "configure", "ack"],
  exit: ["exit_write", "down", "watch_cleanup", "retire"],
};

const complete = (events: readonly Trace[]): Reason | null => {
  let cursor = 0;
  const take = () => events[cursor++];
  const first = take();

  if (first === undefined || !Trace.isAnyOf(["inventory"])(first)) {
    return "inventory_mismatch";
  }

  const inventory = first.inventory;

  if (
    !Cases.storagePaths.every((path) => inventory.some((cut) => cut.path === path)) ||
    inventory.some(
      (cut) => !Cases.storagePaths.some((path) => path === cut.path) || cut.operation < 0 || cut.statement.length === 0,
    ) ||
    new Set(inventory.map((cut) => `${cut.path}/${cut.operation}`)).size !== inventory.length
  ) {
    return "inventory_mismatch";
  }

  const remaining = [...inventory];
  const encodings = new Set<number>();
  const perWalk = Math.max(4, Math.ceil(inventory.length / 100));

  for (let walk = 0; walk < 100; walk++) {
    const start = take();

    if (
      start === undefined ||
      !Trace.isAnyOf(["walk"])(start) ||
      start.walk !== walk ||
      !same(start.forms, forms(start.secret))
    ) {
      return "trace_incomplete";
    }

    let moves = 0;

    while (true) {
      const event = take();

      if (event === undefined) {
        return "trace_incomplete";
      }

      if (Trace.isAnyOf(["end"])(event)) {
        if (event.walk !== walk || event.moves !== moves || moves < perWalk || moves > perWalk + 8) {
          return "trace_incomplete";
        }

        break;
      }

      if (!Trace.isAnyOf(["pick"])(event) || event.walk !== walk || event.move !== moves || event.pick.point < 0) {
        return "trace_incomplete";
      }

      const available = remaining.length > 0 ? remaining : inventory;

      if (
        event.repeat !== (remaining.length === 0) ||
        !same(event.cut, available[event.pick.point % available.length]) ||
        event.marker !== start.forms[event.pick.encoding]
      ) {
        return "trace_incomplete";
      }

      const inspection = take();
      const moved = take();

      if (
        inspection === undefined ||
        !Trace.isAnyOf(["inspect"])(inspection) ||
        inspection.walk !== walk ||
        inspection.move !== moves ||
        Object.values(inspection.counts).some((count) => count < 0) ||
        Object.values(inspection.leaks).some(Boolean) ||
        moved === undefined ||
        !Trace.isAnyOf(["move"])(moved) ||
        moved.walk !== walk ||
        moved.moves !== moves + 1
      ) {
        return "trace_incomplete";
      }

      encodings.add(event.pick.encoding);

      if (remaining.length > 0) {
        remaining.splice(event.pick.point % remaining.length, 1);
      }

      moves++;
    }
  }

  const done = take();

  if (
    done === undefined ||
    !Trace.isAnyOf(["complete"])(done) ||
    done.remaining !== 0 ||
    done.reached !== inventory.length ||
    remaining.length !== 0
  ) {
    return "trace_incomplete";
  }

  if (encodings.size !== 3) {
    return "encoding_missing";
  }

  for (const path of Cases.paths) {
    for (const output of Cases.outputs) {
      for (let walk = 0; walk < 100; walk++) {
        const start = take();

        if (
          start === undefined ||
          !Trace.isAnyOf(["project"])(start) ||
          start.path !== path ||
          start.output !== output ||
          !same(start.forms, forms(start.secret))
        ) {
          return "trace_incomplete";
        }

        const available = [...failures[path]];
        let moves = 0;

        while (true) {
          const event = take();

          if (event === undefined) {
            return "trace_incomplete";
          }

          if (Trace.isAnyOf(["project-end"])(event)) {
            if (
              event.path !== path ||
              event.output !== output ||
              event.moves !== moves ||
              moves < 4 ||
              moves > 12 ||
              available.length !== 0 ||
              event.reached !== failures[path].length ||
              event.expected !== failures[path].length ||
              event.inspected <= 0 ||
              event.leaked
            ) {
              return "trace_incomplete";
            }

            break;
          }

          if (
            !Trace.isAnyOf(["project-pick"])(event) ||
            event.path !== path ||
            event.output !== output ||
            event.move !== moves ||
            event.pick.point < 0 ||
            !same(event.available, available) ||
            event.repeat !== (available.length === 0)
          ) {
            return "trace_incomplete";
          }

          if (available.length > 0) {
            const cut = take();
            const point = event.pick.point % available.length;

            if (
              cut === undefined ||
              !Trace.isAnyOf(["project-cut"])(cut) ||
              cut.path !== path ||
              cut.output !== output ||
              cut.point !== available[point] ||
              cut.marker !== start.forms[event.pick.encoding]
            ) {
              return "trace_incomplete";
            }

            available.splice(point, 1);
          }

          moves++;
        }
      }
    }
  }

  return cursor === events.length ? null : "trace_incomplete";
};

export const equality = (left: string, right: string): Result.Result<{ cuts: number; events: number }, Reason> => {
  // Repeated lines share strict decoding only within this comparison; every position stays in the trace.
  const decoded = new Map<string, Trace>();
  // Identical bytes share validation within this call; neither input can skip it.
  const before = readTrace(left, decoded);
  const after = left === right ? before : readTrace(right, decoded);

  if (Result.isFailure(before)) {
    return Result.fail(before.failure);
  }

  if (Result.isFailure(after)) {
    return Result.fail(after.failure);
  }

  const reason = complete(before.success) ?? (before === after ? null : complete(after.success));

  if (reason !== null) {
    return Result.fail(reason);
  }

  // Encode through the same schema to compare complete ordered values, independent of JSON key order.
  if (before !== after && JSON.stringify(normalized(before.success)) !== JSON.stringify(normalized(after.success))) {
    return Result.fail("trace_mismatch");
  }

  return Result.succeed({
    cuts: before.success.filter(Trace.isAnyOf(["pick"])).length,
    events: before.success.length,
  });
};

export const BatchSlot = Schema.Struct({
  slot: Cases.Slot,
  source: Schema.Literal(Cases.cached),
  state: Schema.Literals(["passed", "failed", "incomplete", "unstarted", "canceled"]),
  reason: Schema.NullOr(Reason),
  attempt: Schema.Literal(1),
});

export type BatchSlot = typeof BatchSlot.Type;

export const batch = (input: unknown) => {
  const decoded = Schema.decodeUnknownResult(Schema.Array(BatchSlot))(input, { onExcessProperty: "error" });

  if (
    Result.isFailure(decoded) ||
    decoded.success.length !== 10 ||
    decoded.success.some((slot, index) => slot.slot !== index + 1)
  ) {
    return Result.fail<Reason>("batch_incomplete");
  }

  const slots = decoded.success;
  const first = slots.findIndex((slot) => slot.state !== "passed" || slot.reason !== null);

  return Result.succeed({
    slots,
    complete: first < 0,
    ordered: first < 0 || slots.slice(first + 1).every((slot) => slot.state === "unstarted"),
  });
};

export class WorkspaceError extends Schema.TaggedError<WorkspaceError, { readonly brand: unique symbol }>()(
  "WorkspaceError",
  { reason: Reason },
) {}

export type Saved = {
  readonly bytes: Uint8Array;
  readonly mode: number;
  readonly regular: boolean;
  readonly parents: boolean;
};

export type Identity = { readonly head: string; readonly index: string; readonly status: string };

// This is the multiple-file contract. The real adapter composes FileSystem and Git after 1133 lands.
export class Workspace extends Context.Service<
  Workspace,
  {
    readonly identity: Effect.Effect<Identity, WorkspaceError>;
    readonly read: (path: string) => Effect.Effect<Saved, WorkspaceError>;
    readonly write: (path: string, saved: Saved) => Effect.Effect<void, WorkspaceError>;
  }
>()("ci/l11/Workspace") {}

const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sameIdentity = (left: Identity, right: Identity) =>
  left.head === right.head && left.index === right.index && left.status === right.status;

export const temporary = Effect.fnUntraced(function* <A, E, R>(
  request: Cases.Request,
  variant: Cases.Variant,
  edits: readonly Cases.Edit[],
  use: Effect.Effect<A, E, R>,
) {
  const workspace = yield* Workspace;
  const restored = yield* Ref.make(false);

  const value = yield* Effect.scoped(
    Effect.gen(function* () {
      const identity = yield* workspace.identity;

      if (
        identity.head !== Cases.sources[variant].sha ||
        identity.status !== "" ||
        (variant === "uncached" && request.case !== "l11-inputs" && request.case !== "l11-compare")
      ) {
        return yield* WorkspaceError.make({ reason: "source_drift" });
      }

      const paths = [...new Set(edits.map((edit) => edit.path))].toSorted();
      const saved = new Map<string, Saved>();

      for (const path of paths) {
        const source = yield* workspace.read(path);

        if (!source.regular || !source.parents || source.mode !== 0o100644) {
          return yield* WorkspaceError.make({ reason: "source_drift" });
        }

        saved.set(path, { ...source, bytes: source.bytes.slice() });
      }

      const changed = Cases.derive(new Map([...saved].map(([path, source]) => [path, source.bytes])), edits);

      if (Result.isFailure(changed)) {
        return yield* WorkspaceError.make({ reason: changed.failure.reason });
      }

      yield* Effect.acquireRelease(Effect.succeed(saved), (files) =>
        Effect.gen(function* () {
          const writes = yield* Effect.forEach(
            [...files],
            ([path, source]) => workspace.write(path, source).pipe(Effect.exit),
            { concurrency: 1 },
          );

          const reads = yield* Effect.forEach(
            [...files],
            ([path, source]) =>
              workspace.read(path).pipe(
                Effect.map(
                  (now) => now.regular && now.parents && now.mode === source.mode && sameBytes(now.bytes, source.bytes),
                ),
                Effect.exit,
              ),
            { concurrency: 1 },
          );

          const after = yield* Effect.exit(workspace.identity);

          const clean =
            writes.every(Exit.isSuccess) &&
            reads.every((exit) => Exit.isSuccess(exit) && exit.value) &&
            Exit.isSuccess(after) &&
            sameIdentity(after.value, identity);

          yield* Ref.set(restored, clean);
        }),
      );

      for (const [path, bytes] of changed.success) {
        const source = saved.get(path);

        if (source === undefined) {
          return yield* WorkspaceError.make({ reason: "source_missing" });
        }

        yield* workspace.write(path, { ...source, bytes });
      }

      for (const [path, bytes] of changed.success) {
        const now = yield* workspace.read(path);

        if (!now.regular || !now.parents || now.mode !== 0o100644 || !sameBytes(now.bytes, bytes)) {
          return yield* WorkspaceError.make({ reason: "source_drift" });
        }
      }

      const after = yield* workspace.identity;

      if (
        after.head !== identity.head ||
        after.index !== identity.index ||
        after.status !== paths.map((path) => ` M ${path}\0`).join("")
      ) {
        return yield* WorkspaceError.make({ reason: "source_drift" });
      }

      return yield* use;
    }),
  ).pipe(Effect.exit);

  return { value, restored: yield* Ref.get(restored) };
});

const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

const Commit = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/));

const Stamp = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/));

const NumberId = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));

const RunId = Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/));

const Job = Schema.Literals([
  "manifest",
  "compare",
  "inputs",
  "output",
  "slot-1",
  "slot-2",
  "slot-3",
  "slot-4",
  "slot-5",
  "slot-6",
  "slot-7",
  "slot-8",
  "slot-9",
  "slot-10",
  "collect",
]);

const JobUrl = Schema.String.check(
  Schema.isPattern(
    /^https:\/\/github\.com\/kamp-us\/tea-fabrika\/(?:actions\/runs\/[0-9]+\/job\/[0-9]+|runs\/[0-9]+\/jobs\/[0-9]+)$/,
  ),
);

export const Internal = Schema.TaggedUnion({
  manifest: {},
  compare: { variant: Cases.Variant },
  inputs: {},
  output: {},
  batch: { slot: Cases.Slot },
  collect: {},
});

export type Internal = typeof Internal.Type;

const identityFields = {
  run: RunId,
  attempt: NumberId,
  caller: NumberId,
  workflow: Commit,
  job: Job,
  url: Schema.NullOr(JobUrl),
  id: Schema.NullOr(NumberId),
  dispatched: Schema.Null,
};

export const IdentityRecord = Schema.TaggedUnion({
  unverified: { ...identityFields, head: Schema.NullOr(Commit) },
  verified: { ...identityFields, head: Commit },
});

export type IdentityRecord = typeof IdentityRecord.Type;

const Versions = Schema.Struct({
  node: Schema.Literal("26.13.0"),
  effect: Schema.Literal("4.1.3"),
  vitest: Schema.Literal("5.0.5"),
  fastCheck: Schema.Literal("4.10.2"),
  tea: Schema.Literal("0.27.0"),
});

export const SourceFact = Schema.Struct({
  variant: Cases.Variant,
  sha: Schema.Literals([Cases.cached, Cases.uncached]),
  tree: Commit,
  product: Commit,
  index: Commit,
  law: Hash,
  lock: Hash,
  node: Schema.Literal("26.13.0"),
  git: Schema.String.check(Schema.isPattern(/^git version [0-9.]+$/)),
  versions: Schema.NullOr(Versions),
});

export type SourceFact = typeof SourceFact.Type;

const Names = Schema.Array(Schema.Literals(Cases.names));

const testFields = {
  phase: Phase,
  variant: Cases.Variant,
  started: Stamp,
  pid: Schema.NullOr(NumberId),
  collected: Names,
  collection: Hash,
  stdout: Hash,
  stderr: Hash,
  observation: Observation,
};

export const TestRecord = Schema.TaggedUnion({
  running: {
    ...testFields,
    ended: Schema.Null,
    elapsed: Schema.Null,
    exit: Schema.Null,
    stdout: Schema.Null,
    stderr: Schema.Null,
    observation: Observation.cases.incomplete,
  },
  captured: {
    ...testFields,
    ended: Stamp,
    elapsed: Nonnegative,
    exit: Schema.Int,
    observation: Observation.cases.incomplete,
  },
  completed: { ...testFields, ended: Stamp, elapsed: Nonnegative, exit: Schema.Int },
});

export type TestRecord = typeof TestRecord.Type;

export const Cleanup = Schema.Struct({
  variant: Cases.Variant,
  restored: Schema.Boolean,
  files: Schema.Boolean,
  head: Schema.Boolean,
  index: Schema.Boolean,
  status: Schema.Boolean,
});

export type Cleanup = typeof Cleanup.Type;

const TraceFacts = Schema.Struct({
  variant: Cases.Variant,
  trace: Hash,
  inventory: Schema.NullOr(Hash),
  events: Schema.Int,
  cuts: Schema.Int,
  walks: Schema.Int,
  complete: Schema.Boolean,
  encodings: Schema.Array(Schema.Literals([0, 1, 2])),
  inspections: Counts,
});

const InputFacts = Schema.Struct({ equal: Schema.Boolean, partial: Schema.Array(TraceFacts) });

const TargetFact = Schema.Struct({
  observations: Schema.Array(Attribution),
  title: Schema.Literals(Cases.titles),
  final: Schema.Boolean,
  output: Schema.Literals(Cases.outputs),
  encodings: Schema.Array(Schema.Literals([0, 1, 2])),
  reason: Schema.NullOr(Reason),
});

const SlotFact = Schema.Struct({
  slot: Cases.Slot,
  source: Schema.Literal(Cases.cached),
  attempt: Schema.Literal(1),
  state: Schema.Literals(["passed", "failed", "incomplete", "unstarted", "canceled"]),
  reason: Schema.NullOr(Reason),
  job: Schema.NullOr(JobUrl),
  record: Schema.NullOr(Hash),
});

const Receipt = Schema.Struct({ job: Job, url: Schema.NullOr(JobUrl), hash: Hash });

export const ReportResult = Schema.TaggedUnion({ observed: {}, incomplete: { reason: Reason } });

export const Report = Schema.Struct({
  version: Schema.Literal(1),
  request: Cases.Request,
  internal: Internal,
  identity: IdentityRecord,
  started: Stamp,
  ended: Stamp,
  result: ReportResult,
  sources: Schema.Array(SourceFact),
  tests: Schema.Array(TestRecord),
  cleanup: Schema.Array(Cleanup),
  transforms: Schema.Array(Hash),
  input: Schema.NullOr(InputFacts),
  targets: Schema.Array(TargetFact),
  slots: Schema.Array(SlotFact),
  receipts: Schema.Array(Receipt),
  paired: Schema.Boolean,
  reliability: Schema.Null,
  active: Schema.NullOr(Phase),
  gaps: Schema.Array(Schema.Literals(["row", "initialization", "Runner", "CPU profile"])),
});

export type Report = typeof Report.Type;

export type Trial = {
  readonly exit: number;
  readonly started: string;
  readonly ended: string;
  readonly elapsed: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly report: unknown;
  readonly pid?: number;
};

export type ActionJob = {
  readonly key: typeof Job.Type | null;
  readonly variant: Cases.Variant | null;
  readonly id: number;
  readonly url: string;
  readonly state: "passed" | "failed" | "canceled" | "unstarted" | "incomplete";
};

export class Executor extends Context.Service<
  Executor,
  {
    readonly now: Effect.Effect<string>;
    readonly inspect: (variant: Cases.Variant) => Effect.Effect<SourceFact, WorkspaceError>;
    readonly install: (variant: Cases.Variant) => Effect.Effect<typeof Versions.Type, WorkspaceError>;
    readonly collect: (
      variant: Cases.Variant,
    ) => Effect.Effect<readonly { readonly name: string; readonly file: string }[], WorkspaceError>;
    readonly apply: (variant: Cases.Variant) => Effect.Effect<string, WorkspaceError>;
    readonly test: (variant: Cases.Variant, phase: Phase) => Effect.Effect<Trial, WorkspaceError>;
    readonly restore: (variant: Cases.Variant) => Effect.Effect<Cleanup, WorkspaceError>;
    readonly hash: (value: string) => Effect.Effect<string>;
    readonly reports: Effect.Effect<readonly unknown[], WorkspaceError>;
    readonly jobs: Effect.Effect<readonly ActionJob[], WorkspaceError>;
    readonly checkpoint: (report: Report) => Effect.Effect<void, WorkspaceError>;
  }
>()("ci/l11/Executor") {}

export const internal = (
  request: Cases.Request,
  values: {
    readonly mode?: string | undefined;
    readonly variant?: string | undefined;
    readonly slot?: string | undefined;
  },
): Result.Result<Internal, Reason> => {
  switch (values.mode) {
    case "manifest":
      return request.case === "l11-batch"
        ? Result.succeed(Internal.cases.manifest.make({}))
        : Result.fail<Reason>("request_invalid");
    case "compare": {
      const variant = Schema.decodeUnknownResult(Cases.Variant)(values.variant);

      return request.case === "l11-compare" && Result.isSuccess(variant)
        ? Result.succeed(Internal.cases.compare.make({ variant: variant.success }))
        : Result.fail<Reason>("request_invalid");
    }

    case "inputs":
      return request.case === "l11-inputs"
        ? Result.succeed(Internal.cases.inputs.make({}))
        : Result.fail<Reason>("request_invalid");
    case "output":
      return Cases.output(request) !== null
        ? Result.succeed(Internal.cases.output.make({}))
        : Result.fail<Reason>("request_invalid");
    case "batch": {
      const slot = Schema.decodeUnknownResult(Schema.Literals(Cases.Slot.literals.map(String)))(values.slot);

      if (Result.isFailure(slot)) {
        return Result.fail("request_invalid");
      }

      const selected = Schema.decodeUnknownResult(Cases.Slot)(Number(slot.success));

      return request.case === "l11-batch" && Result.isSuccess(selected)
        ? Result.succeed(Internal.cases.batch.make({ slot: selected.success }))
        : Result.fail("request_invalid");
    }

    case "collect":
      return Result.succeed(Internal.cases.collect.make({}));
    default:
      return Result.fail<Reason>("request_invalid");
  }
};

const declared = (): Array<typeof SlotFact.Type> =>
  Cases.Slot.literals.map((slot) => ({
    slot,
    source: Cases.cached,
    attempt: 1,
    state: "unstarted",
    reason: null,
    job: null,
    record: null,
  }));

const variants = (mode: Internal): readonly Cases.Variant[] =>
  Internal.matchOrElse(
    mode,
    {
      compare: ({ variant }) => [variant],
      inputs: () => ["uncached", "cached"] as const,
    },
    () => ["cached"] as const,
  );

const observed = (record: TestRecord) =>
  TestRecord.isAnyOf(["completed"])(record) && Observation.isAnyOf(["observed"])(record.observation);

const supported = (request: Cases.Request, mode: Internal): boolean =>
  Internal.match(mode, {
    compare: () => request.case === "l11-compare",
    inputs: () => request.case === "l11-inputs",
    output: () => Cases.output(request) !== null,
    batch: () => request.case === "l11-batch",
    manifest: () => request.case === "l11-batch",
    collect: () => true,
  });

const passed = (record: TestRecord) =>
  TestRecord.isAnyOf(["completed"])(record) &&
  Observation.match(record.observation, { observed: ({ failed }) => !failed, incomplete: () => false });

const failure = (record: TestRecord): Reason | null =>
  Observation.match(record.observation, { incomplete: ({ reason }) => reason, observed: () => null });

const targetFacts = (request: Cases.Request, record: TestRecord): Array<typeof TargetFact.Type> => {
  const channel = Cases.output(request);

  if (channel === null) {
    return [];
  }

  const assertions = record.observation.assertions;

  return Cases.selected(request).map((title) => {
    const assertion = assertions.find((fact) => fact.target === title);
    const final = assertion?.final === true && assertion.status === "failed" && !assertion.timeout;

    const field =
      request.case === "l11-span-name"
        ? "name"
        : request.case === "l11-span-code"
          ? "code"
          : request.case === "l11-span-errcode"
            ? "errcode"
            : null;

    const path = Cases.paths.find((path) => title === Cases.sibling(path, "span"));

    const observations =
      channel !== "span" || field === null || !final
        ? []
        : (assertion?.observations ?? []).filter(
            (fact) =>
              fact.field === field &&
              (title === Cases.aggregate
                ? Cases.storagePaths.some((path) => path === fact.path) && fact.operation !== null
                : fact.path === path && fact.operation === null),
          );

    const encodings = [...new Set(observations.map((fact) => fact.encoding))].sort();

    return {
      title,
      final,
      output: channel,
      observations,
      encodings,
      reason: !final
        ? "wrong_assertion"
        : channel === "span" && (encodings.length === 0 || (field !== "name" && !encodings.includes(2)))
          ? "encoding_missing"
          : null,
    };
  });
};

const sameRequest = (left: Report, request: Cases.Request, identity: IdentityRecord) =>
  IdentityRecord.isAnyOf(["verified"])(left.identity) &&
  IdentityRecord.isAnyOf(["verified"])(identity) &&
  left.request.case === request.case &&
  left.request.sha === request.sha &&
  left.identity.run === identity.run &&
  left.identity.attempt === identity.attempt &&
  left.identity.workflow === identity.workflow &&
  left.identity.head === identity.workflow &&
  left.identity.caller === identity.caller;

export const execute = Effect.fnUntraced(function* (request: Cases.Request, mode: Internal, identity: IdentityRecord) {
  const io = yield* Executor;
  const started = yield* io.now;
  const sources: SourceFact[] = [];
  const tests: TestRecord[] = [];
  const cleanup: Cleanup[] = [];
  const transforms: string[] = [];
  const collections = new Map<Cases.Variant, readonly { readonly name: string; readonly file: string }[]>();
  const targets: Array<typeof TargetFact.Type> = [];
  let input: typeof InputFacts.Type | null = null;
  const receipts: Array<typeof Receipt.Type> = [];

  let slots: Array<typeof SlotFact.Type> =
    request.case === "l11-batch" && Internal.isAnyOf(["manifest", "collect"])(mode) ? declared() : [];

  let paired = false;
  let active: Phase | null = null;

  const finish = Effect.fnUntraced(function* (result: typeof ReportResult.Type) {
    return Report.make({
      version: 1,
      request,
      internal: mode,
      identity,
      started,
      ended: yield* io.now,
      result,
      sources,
      tests,
      cleanup,
      transforms,
      input,
      targets,
      slots,
      receipts,
      paired,
      reliability: null,
      active,
      gaps: ["row", "initialization", "Runner", "CPU profile"],
    });
  });

  if (!supported(request, mode)) {
    return yield* finish(ReportResult.cases.incomplete.make({ reason: "request_invalid" }));
  }

  if (!IdentityRecord.isAnyOf(["verified"])(identity) || identity.head !== identity.workflow) {
    return yield* finish(ReportResult.cases.incomplete.make({ reason: "workflow_unverified" }));
  }

  if (request.case === "l11-row") {
    return yield* finish(ReportResult.cases.incomplete.make({ reason: "row_mapping_missing" }));
  }

  if (identity.attempt !== 1) {
    return yield* finish(ReportResult.cases.incomplete.make({ reason: "batch_incomplete" }));
  }

  if (identity.url === null) {
    return yield* finish(ReportResult.cases.incomplete.make({ reason: "metadata_unavailable" }));
  }

  if (Internal.isAnyOf(["manifest"])(mode)) {
    slots = declared();

    return yield* finish(ReportResult.cases.observed.make({}));
  }

  if (Internal.isAnyOf(["collect"])(mode)) {
    const files = yield* io.reports;
    const reports: Report[] = [];
    let invalid = false;

    for (const file of files) {
      const decoded = Schema.decodeUnknownResult(Report)(file, { onExcessProperty: "error" });

      if (Result.isFailure(decoded) || !sameRequest(decoded.success, request, identity)) {
        invalid = true;
        continue;
      }

      reports.push(decoded.success);
      sources.push(...decoded.success.sources);
      tests.push(...decoded.success.tests);
      cleanup.push(...decoded.success.cleanup);
      transforms.push(...decoded.success.transforms);
      targets.push(...decoded.success.targets);

      if (decoded.success.input !== null) {
        input = decoded.success.input;
      }

      receipts.push({
        job: decoded.success.identity.job,
        url: decoded.success.identity.url,
        hash: yield* io.hash(JSON.stringify(Schema.encodeSync(Report)(decoded.success))),
      });
    }

    if (request.case === "l11-batch") {
      const manifest = reports.filter((report) => Internal.isAnyOf(["manifest"])(report.internal));

      const manifestValid =
        reports.length <= 11 &&
        manifest.length === 1 &&
        manifest[0]?.slots.length === 10 &&
        manifest[0].slots.every(
          (slot, index) =>
            slot.slot === index + 1 &&
            slot.source === Cases.cached &&
            slot.attempt === 1 &&
            slot.state === "unstarted" &&
            slot.reason === null &&
            slot.job === null &&
            slot.record === null,
        ) &&
        ReportResult.isAnyOf(["observed"])(manifest[0].result);

      yield* io.checkpoint(yield* finish(ReportResult.cases.incomplete.make({ reason: "pending" })));
      const jobs = yield* io.jobs;
      const declaredBy = manifest[0];

      const manifestJob =
        declaredBy !== undefined &&
        jobs.filter(
          (job) =>
            job.key === "manifest" &&
            job.id === declaredBy.identity.id &&
            job.url === declaredBy.identity.url &&
            job.state === "passed",
        ).length === 1;

      slots = declared();

      for (const slot of slots) {
        const found = reports.filter((report) =>
          Internal.matchOrElse(report.internal, { batch: (mode) => mode.slot === slot.slot }, () => false),
        );

        const job = jobs.find((job) => job.key === `slot-${slot.slot}`);
        const report = found[0];
        const record = report === undefined ? null : yield* io.hash(JSON.stringify(Schema.encodeSync(Report)(report)));

        const state =
          found.length > 1
            ? "incomplete"
            : job?.state === "unstarted"
              ? "unstarted"
              : job?.state === "canceled"
                ? "canceled"
                : report === undefined
                  ? "incomplete"
                  : job?.state === "passed" &&
                      report.identity.id === job.id &&
                      report.identity.url === job.url &&
                      report.identity.job === `slot-${slot.slot}` &&
                      report.sources.length === 1 &&
                      report.sources[0]?.sha === Cases.cached &&
                      ReportResult.isAnyOf(["observed"])(report.result) &&
                      report.tests.length === 1 &&
                      report.tests[0]?.variant === "cached" &&
                      record !== null &&
                      report.tests[0] !== undefined &&
                      passed(report.tests[0]) &&
                      report.cleanup.length > 0 &&
                      report.cleanup.every((row) => row.restored)
                    ? "passed"
                    : "failed";

        slots[slot.slot - 1] = {
          ...slot,
          state,
          reason:
            state === "passed" || state === "unstarted"
              ? null
              : report === undefined
                ? "missing_report"
                : "batch_failed",
          job: job?.url ?? null,
          record,
        };
      }

      const checked = batch(slots.map(({ job: _job, record: _record, ...slot }) => slot));

      return yield* finish(
        !invalid &&
          manifestValid &&
          manifestJob &&
          Result.isSuccess(checked) &&
          checked.success.complete &&
          checked.success.ordered
          ? ReportResult.cases.observed.make({})
          : ReportResult.cases.incomplete.make({ reason: "batch_incomplete" }),
      );
    }

    if (request.case === "l11-compare") {
      const sides = reports.filter((report) => Internal.isAnyOf(["compare"])(report.internal));

      const before = sides.find((report) =>
        Internal.matchOrElse(report.internal, { compare: ({ variant }) => variant === "uncached" }, () => false),
      );

      const after = sides.find((report) =>
        Internal.matchOrElse(report.internal, { compare: ({ variant }) => variant === "cached" }, () => false),
      );

      yield* io.checkpoint(yield* finish(ReportResult.cases.incomplete.make({ reason: "pending" })));
      const jobs = yield* io.jobs;

      const real = (report: Report, variant: Cases.Variant) =>
        jobs.some(
          (job) =>
            job.key === "compare" &&
            job.variant === variant &&
            job.state === (exitCode(report) === 0 ? "passed" : "failed") &&
            report.identity.id === job.id &&
            report.identity.url === job.url &&
            report.identity.job === "compare",
        );

      paired =
        !invalid &&
        sides.length === 2 &&
        reports.length === 2 &&
        before !== undefined &&
        after !== undefined &&
        real(before, "uncached") &&
        ReportResult.isAnyOf(["observed"])(before.result) &&
        ReportResult.isAnyOf(["observed"])(after.result) &&
        real(after, "cached") &&
        before.sources.length === 1 &&
        after.sources.length === 1 &&
        before.sources[0]?.sha === Cases.uncached &&
        after.sources[0]?.sha === Cases.cached &&
        before.sources[0]?.product === after.sources[0]?.product &&
        before.tests.length === 1 &&
        after.tests.length === 1 &&
        before.tests[0] !== undefined &&
        before.tests[0].variant === "uncached" &&
        before.tests[0].phase === "measurement" &&
        observed(before.tests[0]) &&
        after.tests[0] !== undefined &&
        after.tests[0].variant === "cached" &&
        after.tests[0].phase === "measurement" &&
        observed(after.tests[0]) &&
        same(before.tests[0]?.collected, after.tests[0]?.collected) &&
        before.cleanup.length > 0 &&
        after.cleanup.length > 0 &&
        before.cleanup.every((row) => row.restored) &&
        after.cleanup.every((row) => row.restored);

      return yield* finish(
        paired
          ? ReportResult.cases.observed.make({})
          : ReportResult.cases.incomplete.make({ reason: "missing_report" }),
      );
    }

    const leaves = reports.filter((report) => !Internal.isAnyOf(["collect"])(report.internal));
    yield* io.checkpoint(yield* finish(ReportResult.cases.incomplete.make({ reason: "pending" })));
    const jobs = yield* io.jobs;
    const leaf = leaves[0];

    const matched =
      leaf !== undefined &&
      jobs.some(
        (job) =>
          job.key === leaf.identity.job &&
          job.id === leaf.identity.id &&
          job.url === leaf.identity.url &&
          job.state === (exitCode(leaf) === 0 ? "passed" : "failed"),
      );

    return yield* finish(
      !invalid &&
        leaves.length === 1 &&
        leaf !== undefined &&
        matched &&
        supported(request, leaf.internal) &&
        leaf.identity.job === jobKey(leaf.internal)
        ? leaf.result
        : ReportResult.cases.incomplete.make({ reason: "missing_report" }),
    );
  }

  const test = Effect.fnUntraced(function* (variant: Cases.Variant, phase: Phase) {
    const names = collections.get(variant);

    if (names === undefined) {
      return yield* WorkspaceError.make({ reason: "missing_collection" });
    }

    const actual = yield* io.test(variant, phase);
    const observation = reconcile(request, names, actual.report, actual.exit);

    const record = TestRecord.cases.completed.make({
      phase,
      variant,
      started: actual.started,
      ended: actual.ended,
      elapsed: actual.elapsed,
      exit: actual.exit,
      pid: actual.pid ?? null,
      collected: names.map((row) => row.name),
      collection: yield* io.hash(JSON.stringify(names.map((row) => row.name))),
      stdout: yield* io.hash(actual.stdout),
      stderr: yield* io.hash(actual.stderr),
      observation,
    });

    tests.push(record);

    return { record, raw: actual.stdout };
  });

  const phase = Effect.fnUntraced(function* (phase: Phase): Effect.fn.Return<typeof PhaseOutcome.Type, WorkspaceError> {
    switch (phase) {
      case "inspect": {
        for (const variant of variants(mode)) {
          const source = yield* io.inspect(variant);
          sources.push(source);
          const versions = yield* io.install(variant);
          sources[sources.length - 1] = { ...source, versions };
          collections.set(variant, yield* io.collect(variant));
        }

        return PhaseOutcome.cases.ready.make({});
      }

      case "measurement": {
        const variant = Internal.matchOrElse(mode, { compare: ({ variant }) => variant }, () => "cached" as const);
        const { record } = yield* test(variant, phase);
        const reason = failure(record);

        return reason === null
          ? PhaseOutcome.cases.timing.make({
              failed: !passed(record),
              timeout: record.observation.assertions.some((fact) => fact.timeout),
            })
          : PhaseOutcome.cases.incomplete.make({ reason });
      }

      case "diagnostic": {
        const raw: string[] = [];
        const partial: Array<typeof TraceFacts.Type> = [];
        input = { equal: false, partial };
        let problem: Reason | null = null;

        for (const variant of ["uncached", "cached"] as const) {
          transforms.push(yield* io.apply(variant));
          const result = yield* test(variant, phase);
          raw.push(result.raw);
          const parsed = parsedTrace(result.raw);
          const inspections = { reply: 0, span: 0, row: 0, log: 0 };
          const encodings = new Set<0 | 1 | 2>();
          let inventory: string | null = null;

          for (const event of parsed.events) {
            if (Trace.isAnyOf(["inventory"])(event)) {
              inventory = yield* io.hash(JSON.stringify(event.inventory));
            }

            if (Trace.isAnyOf(["inspect"])(event)) {
              for (const output of Cases.outputs) {
                inspections[output] += event.counts[output];
              }
            }

            if (Trace.isAnyOf(["pick"])(event)) {
              encodings.add(event.pick.encoding);
            }
          }

          partial.push({
            variant,
            trace: yield* io.hash(JSON.stringify(normalized(parsed.events))),
            inventory,
            events: parsed.events.length,
            cuts: parsed.events.filter(Trace.isAnyOf(["pick"])).length,
            walks: parsed.events.filter(Trace.isAnyOf(["walk"])).length,
            complete: parsed.reason === null && complete(parsed.events) === null,
            encodings: [...encodings].sort(),
            inspections,
          });
          cleanup.push(yield* io.restore(variant));

          if (!cleanup.at(-1)?.restored) {
            return PhaseOutcome.cases.incomplete.make({ reason: "restore_failed" });
          }

          if (!passed(result.record)) {
            problem ??=
              failure(result.record) ??
              (result.record.observation.assertions.some((fact) => fact.timeout) ? "timeout" : "trace_incomplete");
          }
        }

        const equal = equality(raw[0] ?? "", raw[1] ?? "");

        if (problem !== null) {
          return PhaseOutcome.cases.incomplete.make({ reason: problem });
        }

        if (Result.isFailure(equal)) {
          return PhaseOutcome.cases.incomplete.make({ reason: equal.failure });
        }

        input = { equal: true, partial };

        return PhaseOutcome.cases.equal.make({});
      }

      case "baseline":
      case "restored": {
        const { record } = yield* test("cached", phase);

        return passed(record)
          ? PhaseOutcome.cases.passed.make({})
          : PhaseOutcome.cases.incomplete.make({
              reason: failure(record) ?? (phase === "baseline" ? "baseline_failed" : "restored_failed"),
            });
      }

      case "broken": {
        transforms.push(yield* io.apply("cached"));
        const { record } = yield* test("cached", phase);
        targets.push(...targetFacts(request, record));
        const reason = plant(record.observation) ?? targets.find((target) => target.reason !== null)?.reason ?? null;

        return reason === null ? PhaseOutcome.cases.leaked.make({}) : PhaseOutcome.cases.incomplete.make({ reason });
      }

      case "restore": {
        for (const variant of variants(mode)) {
          cleanup.push(yield* io.restore(variant));
        }

        return cleanup.every((row) => row.restored)
          ? PhaseOutcome.cases.restored.make({})
          : PhaseOutcome.cases.incomplete.make({ reason: "restore_failed" });
      }
    }
  });

  const handle = yield* run(machine, {
    ctx: { request },
    terminal: Model.isAnyOf(["observed", "incomplete"]),
    interpret: {
      l11_phase: (command) =>
        Effect.gen(function* () {
          active = command.phase;
          yield* io.checkpoint(yield* finish(ReportResult.cases.incomplete.make({ reason: "pending" })));

          return yield* phase(command.phase);
        }).pipe(
          Effect.map((outcome) => ({ phase: command.phase, outcome })),
          Effect.catch((error) =>
            Effect.succeed({
              phase: command.phase,
              outcome: PhaseOutcome.cases.incomplete.make({ reason: error.reason }),
            }),
          ),
          Effect.catchCause(() =>
            Effect.succeed({
              phase: command.phase,
              outcome: PhaseOutcome.cases.incomplete.make({ reason: "operation_failed" }),
            }),
          ),
          Effect.tap(() =>
            Effect.gen(function* () {
              active = null;
              yield* io.checkpoint(yield* finish(ReportResult.cases.incomplete.make({ reason: "pending" })));
            }),
          ),
          Effect.catchCause(() =>
            Effect.succeed({
              phase: command.phase,
              outcome: PhaseOutcome.cases.incomplete.make({ reason: "operation_failed" }),
            }),
          ),
        ),
    },
    onError: () => {},
  });

  const runtime = yield* handle.ready;
  const model = yield* runtime.done();
  active = null;

  return yield* finish(
    Model.matchOrElse(
      model,
      {
        observed: () => ReportResult.cases.observed.make({}),
        incomplete: ({ reason }) => ReportResult.cases.incomplete.make({ reason }),
      },
      () => ReportResult.cases.incomplete.make({ reason: "operation_failed" }),
    ),
  );
}, Effect.scoped);

const Environment = Schema.Struct({
  CI: Schema.Literal("true"),
  GITHUB_ACTIONS: Schema.Literal("true"),
  RUNNER_OS: Schema.Literal("Linux"),
  GITHUB_EVENT_NAME: Schema.Literal("workflow_dispatch"),
  GITHUB_REF: Schema.Literal("refs/heads/main"),
  GITHUB_REPOSITORY: Schema.Literal("kamp-us/tea-fabrika"),
  GITHUB_WORKFLOW_REF: Schema.Literal("kamp-us/tea-fabrika/.github/workflows/l11-exercise.yaml@refs/heads/main"),
  GITHUB_WORKFLOW_SHA: Commit,
  GITHUB_SHA: Commit,
  GITHUB_RUN_ID: RunId,
  GITHUB_RUN_ATTEMPT: RunId,
  GITHUB_JOB: Job,
  GITHUB_WORKSPACE: Schema.NonEmptyString,
  GITHUB_EVENT_PATH: Schema.NonEmptyString,
  RUNNER_TEMP: Schema.NonEmptyString,
  RUNNER_NAME: Schema.NonEmptyString,
  PATH: Schema.NonEmptyString,
  L11_CASE: Schema.Literals(Cases.cases),
  L11_SHA: Schema.Literal(Cases.cached),
  L11_MODE: Schema.String,
  L11_VARIANT: Schema.optional(Schema.String),
  L11_SLOT: Schema.optional(Schema.String),
});

export type Environment = typeof Environment.Type;

const ActionJobs = Schema.Struct({
  total_count: Schema.Int,
  jobs: Schema.Array(
    Schema.Struct({
      id: NumberId,
      run_id: NumberId,
      head_sha: Commit,
      name: Schema.String,
      html_url: JobUrl,
      runner_name: Schema.NullOr(Schema.String),
      status: Schema.Literals(["queued", "waiting", "pending", "in_progress", "completed"]),
      conclusion: Schema.NullOr(
        Schema.Literals([
          "success",
          "failure",
          "cancelled",
          "skipped",
          "timed_out",
          "action_required",
          "neutral",
          "stale",
          "startup_failure",
        ]),
      ),
    }),
  ),
});

const Json = Schema.fromJsonString(Schema.Unknown);

const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

const reason = (reason: Reason) => WorkspaceError.make({ reason });

const issue = (fallback: Reason) => (error: unknown) => (Schema.is(WorkspaceError)(error) ? error : reason(fallback));

const jobKey = (mode: Internal): typeof Job.Type =>
  Internal.match(mode, {
    manifest: (): typeof Job.Type => "manifest",
    compare: (): typeof Job.Type => "compare",
    inputs: (): typeof Job.Type => "inputs",
    output: (): typeof Job.Type => "output",
    collect: (): typeof Job.Type => "collect",
    batch: ({ slot }) => Schema.decodeUnknownSync(Job)(`slot-${slot}`),
  });

const display = (mode: Internal) =>
  Internal.matchOrElse(mode, { compare: ({ variant }) => `l11-compare-${variant}` }, () => `l11-${jobKey(mode)}`);

const actionJobs = Effect.fnUntraced(function* (env: Environment) {
  // Public job metadata needs no token. One request, no polling or retry: GitHub REST workflow-jobs.
  const response = yield* HttpClient.get(
    `https://api.github.com/repos/kamp-us/tea-fabrika/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}/jobs`,
    {
      urlParams: { per_page: "100" },
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "tea-fabrika-l11-exercise",
        "x-github-api-version": "2026-03-10",
      },
    },
  ).pipe(Effect.mapError(() => reason("metadata_unavailable")));

  if (response.status !== 200) {
    return yield* reason("metadata_unavailable");
  }

  const data = yield* response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ActionJobs)),
    Effect.mapError(() => reason("metadata_unavailable")),
  );

  if (
    data.total_count !== data.jobs.length ||
    new Set(data.jobs.map((job) => job.id)).size !== data.jobs.length ||
    data.jobs.some((job) => String(job.run_id) !== env.GITHUB_RUN_ID || job.head_sha !== env.GITHUB_SHA)
  ) {
    return yield* reason("metadata_unavailable");
  }

  return data.jobs;
});

const decodedJobs = Effect.fnUntraced(function* (env: Environment) {
  const jobs = yield* actionJobs(env);

  return jobs.map((job): ActionJob => {
    const compare =
      job.name === "l11-compare-cached" ? "cached" : job.name === "l11-compare-uncached" ? "uncached" : null;

    const key = compare !== null ? "compare" : (Job.literals.find((key) => job.name === `l11-${key}`) ?? null);
    const expected = `https://github.com/kamp-us/tea-fabrika/actions/runs/${env.GITHUB_RUN_ID}/job/${job.id}`;
    const legacy = `https://github.com/kamp-us/tea-fabrika/runs/${env.GITHUB_RUN_ID}/jobs/${job.id}`;

    return {
      key,
      variant: compare,
      id: job.id,
      url: job.html_url === expected || job.html_url === legacy ? job.html_url : "",
      state:
        job.status !== "completed"
          ? "incomplete"
          : job.conclusion === "success"
            ? "passed"
            : job.conclusion === "skipped"
              ? "unstarted"
              : job.conclusion === "cancelled"
                ? "canceled"
                : job.conclusion === "failure" || job.conclusion === "timed_out" || job.conclusion === "startup_failure"
                  ? "failed"
                  : "incomplete",
    };
  });
});

type Lease = {
  readonly before: Identity;
  readonly summary: string;
  readonly files: ReadonlyMap<string, Saved>;
  readonly edits: readonly Cases.Edit[];
};

const safePath = Effect.fnUntraced(
  function* (fs: FileSystem.FileSystem, path: Path.Path, base: string, relative: string, type: "File" | "Directory") {
    const target = path.resolve(base, relative);

    if (
      path
        .relative(base, target)
        .split(path.sep)
        .some((part) => part === "..") ||
      (target === base && type !== "Directory")
    ) {
      return yield* reason("source_drift");
    }

    const baseStat = yield* fs.lstat(base);

    if (baseStat.type !== "Directory" || (yield* fs.realPath(base)) !== base) {
      return yield* reason("source_drift");
    }

    const parts = path.relative(base, target).split(path.sep).filter(Boolean);
    let at = base;

    for (const [index, part] of parts.entries()) {
      at = path.join(at, part);
      const stat = yield* fs.lstat(at);

      if (stat.type !== (index === parts.length - 1 ? type : "Directory")) {
        return yield* reason("source_drift");
      }
    }

    return target;
  },
  Effect.mapError(() => reason("source_drift")),
);

const saveReport = Effect.fnUntraced(
  function* (
    fs: FileSystem.FileSystem,
    path: Path.Path,
    env: Environment,
    mode: Internal,
    scratch: string,
    last: Ref.Ref<Report>,
    record: Report,
  ) {
    const temp = path.resolve(env.RUNNER_TEMP);
    const publicRoot = path.join(temp, "l11-exercise", "public");
    const publicFile = path.join(publicRoot, "record.json");
    const previous = yield* Ref.get(last);

    const pending = Internal.isAnyOf(["collect", "manifest"])(mode)
      ? []
      : previous.tests.filter(
          (test) =>
            !TestRecord.isAnyOf(["completed"])(test) &&
            !record.tests.some((next) => next.phase === test.phase && next.variant === test.variant),
        );

    const merged = Report.make({ ...record, tests: [...record.tests, ...pending] });
    yield* fs.makeDirectory(publicRoot, { recursive: true, mode: 0o700 });
    yield* safePath(fs, path, temp, "l11-exercise/public", "Directory");
    const file = path.join(scratch, "publish.json");
    const handle = yield* fs.open(file, { flag: "w", noFollow: true, mode: 0o600 });
    yield* handle.writeAll(new TextEncoder().encode(`${JSON.stringify(Schema.encodeSync(Report)(merged))}\n`));
    yield* fs.rename(file, publicFile);
    yield* Ref.set(last, merged);
  },
  Effect.scoped,
  Effect.mapError(() => reason("operation_failed")),
);

export const live = Effect.fnUntraced(function* (
  env: Environment,
  request: Cases.Request,
  mode: Internal,
  scratch: string,
  last: Ref.Ref<Report>,
  finalizers: Ref.Ref<readonly Cleanup[]>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const digest = yield* Digest.Digest;
  const owner = yield* Effect.scope;
  const client = yield* HttpClient.HttpClient;
  const root = path.resolve(env.GITHUB_WORKSPACE);
  const temp = path.resolve(env.RUNNER_TEMP);
  const leases = new Map<Cases.Variant, Lease>();
  const collection = new Map<Cases.Variant, readonly { readonly name: string; readonly file: string }[]>();
  let serial = 0;
  const hash = (value: string) => digest.digestHex(Digest.sha256, new TextEncoder().encode(value));
  const bytesHash = (value: Uint8Array) => digest.digestHex(Digest.sha256, value);

  const safe = (base: string, relative: string, type: "File" | "Directory") => safePath(fs, path, base, relative, type);

  const source = (variant: Cases.Variant) => path.join(root, `source-${variant}`);

  const persist = (record: Report) => saveReport(fs, path, env, mode, scratch, last, record);

  const childEnv = {
    PATH: env.PATH,
    HOME: path.join(scratch, "home"),
    TMPDIR: path.join(scratch, "tmp"),
    CI: env.CI,
    FABRIKA_TEST_DEPTH: "full",
    FABRIKA_MAX_WORKERS: "1",
    LANG: "C.UTF-8",
  };

  yield* fs.makeDirectory(childEnv.HOME, { mode: 0o700 });
  yield* fs.makeDirectory(childEnv.TMPDIR, { mode: 0o700 });

  const capture = Effect.fnUntraced(
    function* (
      exe: "git" | "pnpm" | "node",
      args: readonly string[],
      cwd: string,
      test?: { readonly variant: Cases.Variant; readonly phase: Phase },
    ) {
      const start = yield* DateTime.now;

      const handle = yield* spawner.spawn(
        ChildProcess.make(exe === "pnpm" ? "nice" : exe, exe === "pnpm" ? ["-n", "19", "pnpm", ...args] : [...args], {
          cwd,
          env: childEnv,
          extendEnv: false,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        }),
      );

      const names = test === undefined ? [] : (collection.get(test.variant)?.map((row) => row.name) ?? []);
      const collectionHash = yield* hash(JSON.stringify(names));

      if (test !== undefined) {
        const current = yield* Ref.get(last);
        yield* persist(
          Report.make({
            ...current,
            tests: [
              ...current.tests,
              TestRecord.cases.running.make({
                ...test,
                started: DateTime.formatIso(start),
                pid: handle.pid,
                collected: names,
                collection: collectionHash,
                stdout: null,
                stderr: null,
                ended: null,
                elapsed: null,
                exit: null,
                observation: Observation.cases.incomplete.make({ reason: "pending", assertions: [] }),
              }),
            ],
          }),
        );
      }

      const [stdout, stderr, exit] = yield* Effect.all(
        [
          handle.stdout.pipe(
            Stream.decodeText(),
            Stream.runCollect,
            Effect.map((chunks) => chunks.join("")),
          ),
          handle.stderr.pipe(
            Stream.decodeText(),
            Stream.runCollect,
            Effect.map((chunks) => chunks.join("")),
          ),
          handle.exitCode,
        ],
        { concurrency: 3 },
      );

      const end = yield* DateTime.now;
      const label = `${serial++}-${exe}`;
      yield* fs.writeFileString(path.join(scratch, `${label}.out`), stdout, { mode: 0o600 });
      yield* fs.writeFileString(path.join(scratch, `${label}.err`), stderr, { mode: 0o600 });

      const actual = {
        exit: Number(exit),
        started: DateTime.formatIso(start),
        ended: DateTime.formatIso(end),
        elapsed: end.epochMilliseconds - start.epochMilliseconds,
        stdout,
        stderr,
        pid: Number(handle.pid),
      };

      if (test !== undefined) {
        const current = yield* Ref.get(last);
        yield* persist(
          Report.make({
            ...current,
            tests: [
              ...current.tests.filter((record) => record.phase !== test.phase || record.variant !== test.variant),
              TestRecord.cases.captured.make({
                ...test,
                ...actual,
                collected: names,
                collection: collectionHash,
                stdout: yield* hash(stdout),
                stderr: yield* hash(stderr),
                observation: Observation.cases.incomplete.make({ reason: "missing_report", assertions: [] }),
              }),
            ],
          }),
        );
      }

      return actual;
    },
    Effect.scoped,
    Effect.mapError(() => reason("operation_failed")),
  );

  const git = Effect.fnUntraced(function* (cwd: string, args: readonly string[]) {
    const result = yield* capture("git", args, cwd);

    if (result.exit !== 0) {
      return yield* reason("source_drift");
    }

    return result.stdout;
  });

  const identity = Effect.fnUntraced(function* (variant: Cases.Variant): Effect.fn.Return<Identity, WorkspaceError> {
    const cwd = source(variant);

    return {
      head: (yield* git(cwd, ["rev-parse", "HEAD"])).trim(),
      index: (yield* git(cwd, ["write-tree"])).trim(),
      status: yield* git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    };
  });

  const read = Effect.fnUntraced(function* (
    variant: Cases.Variant,
    file: string,
  ): Effect.fn.Return<Saved, WorkspaceError> {
    const target = yield* safe(source(variant), file, "File");
    const stat = yield* fs.lstat(target).pipe(Effect.mapError(() => reason("source_drift")));
    const bytes = yield* fs.readFile(target).pipe(Effect.mapError(() => reason("source_drift")));

    return { bytes, mode: stat.mode, regular: stat.type === "File", parents: true };
  });

  const write = Effect.fnUntraced(
    function* (variant: Cases.Variant, file: string, saved: Saved) {
      const target = yield* safe(source(variant), file, "File");
      const handle = yield* fs.open(target, { flag: "w", noFollow: true, mode: saved.mode & 0o777 });
      yield* handle.writeAll(saved.bytes);
      yield* fs.chmod(target, saved.mode & 0o777);
    },
    Effect.scoped,
    Effect.mapError(() => reason("restore_failed")),
  );

  const restore = Effect.fnUntraced(function* (variant: Cases.Variant): Effect.fn.Return<Cleanup> {
    const saved = leases.get(variant);

    if (saved === undefined) {
      return { variant, restored: true, files: true, head: true, index: true, status: true };
    }

    const targets = [...new Set(saved.edits.map((edit) => edit.path))];

    const writes = yield* Effect.forEach(
      targets,
      (file) => {
        const value = saved.files.get(file);

        return value === undefined
          ? Effect.succeed(false)
          : write(variant, file, value).pipe(
              Effect.as(true),
              Effect.catchCause(() => Effect.succeed(false)),
            );
      },
      { concurrency: 1 },
    );

    const files = yield* Effect.forEach(
      [...saved.files],
      ([file, before]) =>
        read(variant, file).pipe(
          Effect.map((after) => after.mode === before.mode && sameBytes(after.bytes, before.bytes)),
          Effect.catchCause(() => Effect.succeed(false)),
        ),
      { concurrency: 1 },
    );

    const after = yield* identity(variant).pipe(Effect.option);
    const head = Option.isSome(after) && after.value.head === saved.before.head;
    const index = Option.isSome(after) && after.value.index === saved.before.index;
    const status = Option.isSome(after) && after.value.status === saved.before.status;
    const valid = writes.every(Boolean) && files.every(Boolean);

    return { variant, restored: valid && head && index && status, files: valid, head, index, status };
  });

  const inspect = Effect.fnUntraced(function* (variant: Cases.Variant) {
    yield* safe(root, `source-${variant}`, "Directory");
    const before = yield* identity(variant);

    if (before.head !== Cases.sources[variant].sha || before.status !== "") {
      return yield* reason("source_drift");
    }

    const files = new Map<string, Saved>();

    for (const file of [Cases.file, Cases.runtime, Cases.children]) {
      const saved = yield* read(variant, file);

      const expected =
        file === Cases.file
          ? Cases.sources[variant].law
          : file === Cases.runtime
            ? Cases.hashes[Cases.runtime]
            : Cases.hashes[Cases.children];

      if (saved.mode !== 0o100644 || (yield* bytesHash(saved.bytes)) !== expected) {
        return yield* reason("source_drift");
      }

      files.set(file, { ...saved, bytes: saved.bytes.slice() });
    }

    for (const [file, expected] of [
      ["pnpm-lock.yaml", Cases.hashes.lock],
      ["pnpm-workspace.yaml", Cases.hashes.workspace],
    ] as const) {
      const saved = yield* read(variant, file);

      if ((yield* bytesHash(saved.bytes)) !== expected) {
        return yield* reason("lock_mismatch");
      }
    }

    const edits = request.case === "l11-inputs" ? Cases.observer(variant) : Cases.mappings(request);
    const lease = { before, summary: "", files, edits };
    yield* Scope.provide(owner)(
      Effect.acquireRelease(
        Effect.sync(() => {
          leases.set(variant, lease);

          return variant;
        }),
        (variant) =>
          restore(variant).pipe(
            Effect.catchCause(() =>
              Effect.succeed({ variant, restored: false, files: false, head: false, index: false, status: false }),
            ),
            Effect.flatMap((fact) => Ref.update(finalizers, (rows) => [...rows, fact])),
          ),
      ),
    );
    const product = (yield* git(source(variant), ["rev-parse", "HEAD:next/packages/libfabrika"])).trim();

    if (product !== Cases.hashes.product) {
      return yield* reason("source_drift");
    }

    const fact = SourceFact.make({
      variant,
      sha: Cases.sources[variant].sha,
      tree: (yield* git(source(variant), ["rev-parse", "HEAD^{tree}"])).trim(),
      product,
      index: before.index,
      law: Cases.sources[variant].law,
      lock: yield* bytesHash((yield* read(variant, "pnpm-lock.yaml")).bytes),
      node: "26.13.0",
      git: (yield* git(root, ["--version"])).trim(),
      versions: null,
    });

    return fact;
  });

  const install = Effect.fnUntraced(
    function* (variant: Cases.Variant) {
      const result = yield* capture("pnpm", ["install", "--frozen-lockfile"], source(variant));

      if (result.exit !== 0) {
        return yield* reason("setup");
      }

      const node = yield* capture("pnpm", ["exec", "node", "--version"], source(variant));

      if (node.exit !== 0 || node.stdout.trim() !== "v26.13.0") {
        return yield* reason("runner_unverified");
      }

      const version = Effect.fnUntraced(function* (name: string) {
        const json = yield* fs.readFileString(path.join(source(variant), "node_modules", name, "package.json"));

        const value = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
        )(json);

        return value.version;
      });

      const actual = {
        node: node.stdout.trim().slice(1),
        effect: yield* version("effect"),
        vitest: yield* version("vitest"),
        fastCheck: yield* version("fast-check"),
        tea: yield* version("@demlik/tea"),
      };

      return yield* Schema.decodeUnknownEffect(Versions)(actual).pipe(Effect.mapError(() => reason("lock_mismatch")));
    },
    Effect.mapError(issue("setup")),
  );

  const collect = Effect.fnUntraced(
    function* (variant: Cases.Variant) {
      const output = path.join(scratch, `collection-${variant}.json`);
      const result = yield* capture("pnpm", Cases.argv(request, output, true), source(variant));

      if (result.exit !== 0) {
        return yield* reason("missing_collection");
      }

      const raw = yield* fs.readFileString(output);

      const rows = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(
          Schema.Array(
            Schema.Struct({ name: Schema.Literals(Cases.collection.map((row) => row.name)), file: Schema.String }),
          ),
        ),
      )(raw).pipe(Effect.mapError(() => reason("collection_mismatch")));

      if (
        rows.length === 0 ||
        new Set(rows.map((row) => row.name)).size !== rows.length ||
        !Cases.selected(request).every((name) =>
          rows.some((row) => Cases.collection.some((fixed) => fixed.reporter === name && fixed.name === row.name)),
        ) ||
        rows.some((row) => row.file !== path.join(source(variant), Cases.file))
      ) {
        return yield* reason("collection_mismatch");
      }

      const projected: Array<{ name: string; file: string }> = [];

      for (const row of rows) {
        const fixed = Cases.collection.find((entry) => entry.name === row.name);

        if (fixed === undefined) {
          return yield* reason("collection_mismatch");
        }

        projected.push({ name: fixed.reporter, file: row.file });
      }

      if (!Cases.selected(request).every((name) => projected.some((row) => row.name === name))) {
        return yield* reason("collection_mismatch");
      }

      collection.set(variant, projected);

      return projected;
    },
    Effect.mapError(issue("missing_collection")),
  );

  const apply = Effect.fnUntraced(function* (variant: Cases.Variant) {
    const lease = leases.get(variant);

    if (lease === undefined) {
      return yield* reason("source_missing");
    }

    const changed = yield* Cases.prepare(
      request,
      variant,
      new Map([...lease.files].map(([file, value]) => [file, value.bytes])),
    ).pipe(Effect.provideService(Digest.Digest, digest));

    if (Result.isFailure(changed)) {
      return yield* reason("source_drift");
    }

    for (const [file, bytes] of changed.success) {
      const before = lease.files.get(file);

      if (before === undefined) {
        return yield* reason("source_missing");
      }

      yield* write(variant, file, { ...before, bytes });
    }

    const after = yield* identity(variant);
    const selected = [...changed.success.keys()].sort();

    if (
      after.head !== lease.before.head ||
      after.index !== lease.before.index ||
      after.status !== selected.map((file) => ` M ${file}\0`).join("")
    ) {
      return yield* reason("source_drift");
    }

    for (const [file, bytes] of changed.success) {
      const current = yield* read(variant, file);

      if (current.mode !== lease.files.get(file)?.mode || !sameBytes(current.bytes, bytes)) {
        return yield* reason("source_drift");
      }

      if (selected.length === 1) {
        const original = lease.files.get(file);

        if (original === undefined) {
          return yield* reason("source_missing");
        }

        const before: PlantSnapshot = {
          ...lease.before,
          bytes: original.bytes,
          mode: original.mode,
          summary: lease.summary,
        };

        const snapshot: PlantSnapshot = {
          ...after,
          bytes: current.bytes,
          mode: current.mode,
          summary: yield* git(source(variant), [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--summary",
            "--",
            ...selected,
          ]),
        };

        if (!unchanged(before, snapshot, bytes, file)) {
          return yield* reason("source_drift");
        }
      }
    }

    if (
      (yield* hash(JSON.stringify(diffOptions))) !== "cd07479fff269feb8e7f0920ba825d5f732ef84c094a9b0021f8bf4512b09a30"
    ) {
      return yield* reason("source_drift");
    }

    const diff = yield* git(source(variant), [...diffOptions, "--", ...selected]);
    const diffHash = yield* hash(diff);

    if (diffHash !== Cases.diffs[`${request.case}/${variant}`]) {
      return yield* reason("diff_mismatch");
    }

    return diffHash;
  });

  const test = Effect.fnUntraced(function* (variant: Cases.Variant, phase: Phase) {
    const output = path.join(scratch, `report-${variant}-${phase}.json`);

    const actual = yield* capture(
      "pnpm",
      Cases.argv(request, output, false, path.join(root, ".github/ci/l11-reporter.ts")),
      source(variant),
      { variant, phase },
    );

    const report = yield* fs.readFileString(output).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Json)),
      Effect.catchCause(() => Effect.succeed(null)),
    );

    return { ...actual, report };
  });

  const reports = Effect.gen(function* () {
    const values: unknown[] = [];

    const artifacts = Job.literals
      .filter((key) => key !== "collect" && key !== "compare")
      .map((key) => `l11-exercise-${key}`);

    artifacts.push("l11-exercise-compare-cached", "l11-exercise-compare-uncached");

    for (const artifact of artifacts) {
      const file = `l11-exercise/collected/${artifact}/record.json`;

      if (!(yield* fs.exists(path.join(temp, file)))) {
        continue;
      }

      const target = yield* safe(temp, file, "File");

      const value = yield* fs.readFileString(target).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Json)),
        Effect.catchCause(() => Effect.succeed(null)),
      );

      values.push(value);
    }

    return values;
  }).pipe(Effect.mapError(issue("missing_report")));

  return {
    executor: Executor.of({
      now,
      inspect,
      install,
      collect,
      apply,
      test,
      restore,
      hash,
      reports,
      jobs: decodedJobs(env).pipe(
        Effect.flatMap((jobs) =>
          jobs.some((job) => job.url === "") ? Effect.fail(reason("metadata_unavailable")) : Effect.succeed(jobs),
        ),
        Effect.provideService(HttpClient.HttpClient, client),
      ),
      checkpoint: persist,
    }),
    persist,
    git,
  };
});

export const exitCode = (report: Report): 0 | 1 => {
  if (ReportResult.isAnyOf(["incomplete"])(report.result)) {
    return 1;
  }

  if (report.request.case === "l11-compare" || report.request.case === "l11-batch") {
    return report.tests.some((test) => !passed(test)) ? 1 : 0;
  }

  return 0;
};

export const context = (raw: unknown) => Schema.decodeUnknownResult(Environment)(raw);

const initial = (request: Cases.Request, mode: Internal, identity: IdentityRecord, at: string): Report =>
  Report.make({
    version: 1,
    request,
    internal: mode,
    identity,
    started: at,
    ended: at,
    result: ReportResult.cases.incomplete.make({ reason: "workflow_unverified" }),
    sources: [],
    tests: [],
    cleanup: [],
    transforms: [],
    input: null,
    targets: [],
    receipts: [],
    paired: false,
    slots: request.case === "l11-batch" && Internal.isAnyOf(["manifest", "collect"])(mode) ? declared() : [],
    reliability: null,
    active: null,
    gaps: ["row", "initialization", "Runner", "CPU profile"],
  });

export const program = Effect.fnUntraced(function* (raw: unknown) {
  const decoded = context(raw);

  if (Result.isFailure(decoded) || process.platform !== "linux" || process.versions.node !== "26.13.0") {
    return yield* reason("runner_unverified");
  }

  const env = decoded.success;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const digest = yield* Digest.Digest;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  for (const directory of [env.GITHUB_WORKSPACE, env.RUNNER_TEMP]) {
    if (
      !path.isAbsolute(directory) ||
      (yield* fs.lstat(directory)).type !== "Directory" ||
      (yield* fs.realPath(directory)) !== path.resolve(directory)
    ) {
      return yield* reason("workflow_unverified");
    }
  }

  if (!path.isAbsolute(env.GITHUB_EVENT_PATH)) {
    return yield* reason("workflow_unverified");
  }

  const eventFile = yield* safePath(
    fs,
    path,
    env.RUNNER_TEMP,
    path.relative(env.RUNNER_TEMP, env.GITHUB_EVENT_PATH),
    "File",
  );

  const event = yield* fs.readFileString(eventFile).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.fromJsonString(
          Schema.Struct({
            inputs: Schema.Unknown,
            sender: Schema.Struct({ id: NumberId }),
            repository: Schema.Struct({ full_name: Schema.Literal("kamp-us/tea-fabrika") }),
          }),
        ),
      ),
    ),
    Effect.mapError(() => reason("request_invalid")),
  );

  const decodedRequest = Cases.decode(event.inputs);

  if (
    Result.isFailure(decodedRequest) ||
    decodedRequest.success.case !== env.L11_CASE ||
    decodedRequest.success.sha !== env.L11_SHA
  ) {
    return yield* reason("request_invalid");
  }

  const request = decodedRequest.success;
  const selected = internal(request, { mode: env.L11_MODE, variant: env.L11_VARIANT, slot: env.L11_SLOT });

  if (Result.isFailure(selected) || jobKey(selected.success) !== env.GITHUB_JOB) {
    return yield* reason("request_invalid");
  }

  const mode = selected.success;

  const attempt = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(NumberId))(env.GITHUB_RUN_ATTEMPT).pipe(
    Effect.mapError(() => reason("workflow_unverified")),
  );

  const scratch = yield* fs.makeTempDirectoryScoped({ directory: env.RUNNER_TEMP, prefix: "l11-private-" });
  const at = yield* now;

  const base = {
    run: env.GITHUB_RUN_ID,
    attempt,
    caller: event.sender.id,
    workflow: env.GITHUB_WORKFLOW_SHA,
    job: env.GITHUB_JOB,
    url: null,
    id: null,
    dispatched: null,
  };

  const seed = initial(request, mode, IdentityRecord.cases.unverified.make({ ...base, head: null }), at);
  const last = yield* Ref.make(seed);
  const finalizers = yield* Ref.make<readonly Cleanup[]>([]);
  yield* saveReport(fs, path, env, mode, scratch, last, seed);

  const saved = yield* Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.scoped(
        Effect.gen(function* () {
          const child = yield* spawner.spawn(
            ChildProcess.make("git", ["rev-parse", "HEAD"], {
              cwd: env.GITHUB_WORKSPACE,
              env: { PATH: env.PATH, HOME: scratch },
              extendEnv: false,
              stdin: "ignore",
              stdout: "pipe",
              stderr: "pipe",
            }),
          );

          const [head, _error, code] = yield* Effect.all(
            [
              child.stdout.pipe(
                Stream.decodeText(),
                Stream.runCollect,
                Effect.map((chunks) => chunks.join("").trim()),
              ),
              child.stderr.pipe(Stream.runDrain),
              child.exitCode,
            ],
            { concurrency: 3 },
          );

          return { head: Schema.decodeUnknownOption(Commit)(head), code: Number(code) };
        }),
      );

      const lock = yield* safePath(fs, path, env.GITHUB_WORKSPACE, "pnpm-lock.yaml", "File");

      if (
        root.code !== 0 ||
        Option.isNone(root.head) ||
        root.head.value !== env.GITHUB_WORKFLOW_SHA ||
        (yield* digest.digestHex(Digest.sha256, yield* fs.readFile(lock))) !== Cases.hashes.lock
      ) {
        return Report.make({
          ...seed,
          identity: IdentityRecord.cases.unverified.make({ ...base, head: Option.getOrNull(root.head) }),
        });
      }

      const identity = IdentityRecord.cases.verified.make({ ...base, head: root.head.value });

      const verified = Report.make({
        ...seed,
        identity,
        result: ReportResult.cases.incomplete.make({ reason: "setup" }),
      });

      yield* saveReport(fs, path, env, mode, scratch, last, verified);

      if (request.case === "l11-row") {
        return Report.make({
          ...verified,
          result: ReportResult.cases.incomplete.make({ reason: "row_mapping_missing" }),
        });
      }

      const jobs = yield* actionJobs(env).pipe(Effect.catchCause(() => Effect.succeed([])));
      const current = jobs.filter((job) => job.name === display(mode) && job.runner_name === env.RUNNER_NAME);
      const job = current[0];

      const canonical =
        job === undefined
          ? ""
          : `https://github.com/kamp-us/tea-fabrika/actions/runs/${env.GITHUB_RUN_ID}/job/${job.id}`;

      const legacy =
        job === undefined ? "" : `https://github.com/kamp-us/tea-fabrika/runs/${env.GITHUB_RUN_ID}/jobs/${job.id}`;

      const known =
        current.length === 1 && job !== undefined && (job.html_url === canonical || job.html_url === legacy);

      const identified = IdentityRecord.make({
        ...identity,
        id: known && job !== undefined ? job.id : null,
        url: known && job !== undefined ? job.html_url : null,
      });

      const envelope = Report.make({ ...verified, identity: identified });
      yield* saveReport(fs, path, env, mode, scratch, last, envelope);
      const backend = yield* live(env, request, mode, scratch, last, finalizers);

      return yield* execute(request, mode, identified).pipe(Effect.provideService(Executor, backend.executor));
    }),
  ).pipe(Effect.exit);

  const prior = yield* Ref.get(last);
  const closed = yield* Ref.get(finalizers);
  const error = Exit.isFailure(saved) ? Cause.findErrorOption(saved.cause) : Option.none();

  const result = Exit.isSuccess(saved)
    ? saved.value
    : Report.make({
        ...prior,
        result: ReportResult.cases.incomplete.make({
          reason:
            Option.isSome(error) && Schema.is(WorkspaceError)(error.value) ? error.value.reason : "operation_failed",
        }),
      });

  const facts = [...result.cleanup, ...closed];

  const complete = Report.make({
    ...result,
    ended: yield* now,
    active: null,
    cleanup: facts,
    result: facts.some((fact) => !fact.restored)
      ? ReportResult.cases.incomplete.make({ reason: "restore_failed" })
      : result.result,
  });

  yield* saveReport(fs, path, env, mode, scratch, last, complete);

  return yield* Ref.get(last);
}, Effect.scoped);

if (import.meta.main) {
  NodeRuntime.runMain(
    program(process.env).pipe(
      Effect.tap((report) =>
        Effect.sync(() => {
          process.exitCode = exitCode(report);
        }),
      ),
      Effect.provide(NodeServices.layer),
      Effect.provide(Digest.layerWebCrypto),
      Effect.provide(FetchHttpClient.layer),
      Effect.catchCause(() =>
        Console.error("l11-exercise: incomplete; read the sanitized report if available").pipe(
          Effect.andThen(
            Effect.sync(() => {
              process.exitCode = 1;
            }),
          ),
        ),
      ),
    ),
  );
}
