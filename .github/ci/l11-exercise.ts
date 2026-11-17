// Today's lead tooling. Raw reports and traces remain private; only these decoded facts may leave.
import { Context, Effect, Exit, Option, Ref, Result, Schema } from "effect";
import * as Cases from "./l11-cases.ts";
import { Reason } from "./l11-machine.ts";

const Nonnegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

export const Status = Schema.Literals(["passed", "failed", "skipped", "pending", "todo", "disabled"]);

const Assertion = Schema.Struct({
  fullName: Schema.String,
  status: Status,
  duration: Schema.optional(Schema.NullOr(Nonnegative)),
  failureMessages: Schema.NullOr(Schema.Array(Schema.String)),
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
  final: Schema.Boolean,
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

const finalScan = (request: Cases.Request, name: string, messages: readonly string[]) => {
  const channel = Cases.output(request);

  if (channel === null) {
    return false;
  }

  if (name === Cases.aggregate) {
    return messages.some(
      (message) =>
        /L11: \d+ storage operations were cut; storage text or metadata reached these outputs/.test(message) &&
        message.includes(`-> ${channel}`),
    );
  }

  return Cases.paths.some(
    (path) =>
      name === Cases.sibling(path, channel) &&
      messages.some((message) => message.includes(`L11: ${path} leaked storage text or metadata into ${channel}`)),
  );
};

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
    timeout: timeout(entry.failureMessages ?? []),
    final: finalScan(request, entry.fullName, entry.failureMessages ?? []),
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

const readTrace = (stdout: string): Result.Result<readonly Trace[], Reason> => {
  const events: Trace[] = [];

  for (const line of stdout.split("\n")) {
    if (!line.startsWith(Cases.tracePrefix)) {
      continue;
    }

    const decoded = decodeTrace(line.slice(Cases.tracePrefix.length), {
      onExcessProperty: "error",
    });

    if (Result.isFailure(decoded)) {
      return Result.fail("trace_incomplete");
    }

    events.push(decoded.success);
  }

  return events.length === 0 ? Result.fail("trace_missing") : Result.succeed(events);
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
  const before = readTrace(left);
  const after = readTrace(right);

  if (Result.isFailure(before)) {
    return before;
  }

  if (Result.isFailure(after)) {
    return after;
  }

  const reason = complete(before.success) ?? complete(after.success);

  if (reason !== null) {
    return Result.fail(reason);
  }

  // Encode through the same schema to compare complete ordered values, independent of JSON key order.
  if (JSON.stringify(normalized(before.success)) !== JSON.stringify(normalized(after.success))) {
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
