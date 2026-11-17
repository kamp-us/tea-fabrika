// Today's CI diagnostics. Events describe observations; they never decide a test verdict.
import type { Path } from "effect";
import { Result, Schema } from "effect";
import type { Leg } from "./time-table.ts";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Position = Schema.Int.check(Schema.isGreaterThan(0));

const Hash = Schema.Int.check(Schema.isBetween({ minimum: -2147483648, maximum: 2147483647 }));

const Id = Schema.String.check(
  Schema.isPattern(/^(?:0|-?[1-9][0-9]{0,9})(?:_(?:0|[1-9][0-9]*))*$/),
  Schema.makeFilter<string>((id) => Schema.is(Hash)(Number(id.split("_")[0]))),
);

const File = Schema.String.check(
  Schema.isPattern(/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.[cm]?[jt]sx?$/),
  Schema.makeFilter<string>((file) => file.split("/").every((part) => part !== "." && part !== "..")),
);

export const Hook = Schema.Literals(["beforeAll", "afterAll", "beforeEach", "afterEach"]);

export const EndReason = Schema.Literals(["passed", "failed", "interrupted"]);

export const LegIdentity = Schema.Struct({
  run: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)),
  attempt: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)),
  workflow: Schema.Literals(["check", "scheduled"]),
  event: Schema.Literals(["push", "schedule", "workflow_dispatch", "pull_request", "merge_group"]),
  sha: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
  job: Schema.Literals(["next", "tests", "changed"]),
  leg: Schema.String.check(Schema.isPattern(/^(?:[1-9][0-9]*|e2e-[1-9][0-9]*|tooling-[1-9][0-9]*)$/)),
});

const fields = {
  seq: Position,
  at: Count,
  project: Schema.Literals(["next", "next-integration", "next-visual", "tooling"]),
  file: File,
  id: Id,
  line: Schema.optionalKey(Position),
  column: Schema.optionalKey(Count),
};

export const Event = Schema.TaggedUnion({
  module: { ...fields, phase: Schema.Literals(["queued", "collected", "started", "ended"]) },
  test: { ...fields, phase: Schema.Literals(["started", "ended"]) },
  hook: { ...fields, phase: Schema.Literals(["started", "ended"]), hook: Hook },
});

export type Event = typeof Event.Type;

export const Header = Schema.Struct({
  _tag: Schema.Literal("run"),
  phase: Schema.Literal("started"),
  version: Schema.Literal(1),
  leg: LegIdentity,
  seq: Schema.Literal(0),
  at: Count,
});

export const End = Schema.Struct({
  _tag: Schema.Literal("run"),
  phase: Schema.Literal("ended"),
  reason: EndReason,
  seq: Position,
  at: Count,
});

const Reason = Schema.Literals([
  "unread",
  "header",
  "identity",
  "malformed",
  "truncated",
  "sequence",
  "write_gap",
  "missing_end",
  "after_end",
]);

const HookStart = Schema.Struct({
  ...fields,
  _tag: Schema.Literal("hook"),
  phase: Schema.Literal("started"),
  hook: Hook,
});

const Activity = Schema.TaggedUnion({
  module: { ...fields, phase: Schema.Literals(["queued", "collected", "started"]) },
  test: { ...fields, phase: Schema.Literal("started") },
  hook: {
    project: fields.project,
    file: File,
    id: Id,
    line: fields.line,
    column: fields.column,
    phase: Schema.Literal("started"),
    hook: Hook,
    pending: Position,
    starts: Schema.Array(HookStart).check(Schema.isMinLength(1)),
  },
});

type Activity = typeof Activity.Type;

const facts = {
  version: Schema.Literal(1),
  leg: LegIdentity,
  start: Schema.Struct({ seq: Schema.Literal(0), at: Count }),
  events: Schema.Array(Event),
  active: Schema.Array(Activity),
  gaps: Schema.Array(Position),
};

export const Progress = Schema.TaggedUnion({
  unavailable: { reason: Reason },
  read: { ...facts, complete: Schema.Literal(true), end: End },
  partial: { ...facts, complete: Schema.Literal(false), end: Schema.NullOr(End), reasons: Schema.Array(Reason) },
});

export type Progress = typeof Progress.Type;

const Line = Schema.fromJsonString(Schema.Union([Header, Event, End]));

const Callback = Schema.TaggedUnion({
  module: { ...fields, file: Schema.String, phase: Schema.Literals(["queued", "collected", "started", "ended"]) },
  test: { ...fields, file: Schema.String, phase: Schema.Literals(["started", "ended"]) },
  hook: { ...fields, file: Schema.String, phase: Schema.Literals(["started", "ended"]), hook: Hook },
});

export const project = (root: string, path: Path.Path, input: unknown): Result.Result<Event, "metadata"> => {
  const decoded = Schema.decodeUnknownResult(Callback)(input);

  if (Result.isFailure(decoded)) {
    return Result.fail("metadata");
  }

  const value = decoded.success;

  if (
    !path.isAbsolute(root) ||
    !path.isAbsolute(value.file) ||
    value.file.includes("\0") ||
    value.file.split(/[\\/]/).some((part) => part === "." || part === "..")
  ) {
    return Result.fail("metadata");
  }

  const file = path.relative(root, value.file).replaceAll("\\", "/");

  if (!file || file.startsWith("../") || path.isAbsolute(file)) {
    return Result.fail("metadata");
  }

  const result = Schema.decodeUnknownResult(Event)({ ...value, file }, { onExcessProperty: "error" });

  return Result.mapError(result, () => "metadata" as const);
};

export const replay = (events: readonly Event[]): readonly Activity[] => {
  const active = new Map<string, Exclude<Activity, { readonly _tag: "hook" }>>();

  const hooks = new Map<
    string,
    { pending: number; starts: [typeof HookStart.Type, ...Array<typeof HookStart.Type>] }
  >();

  for (const event of events) {
    const key = JSON.stringify([
      event.project,
      event.file,
      event.id,
      event._tag,
      event._tag === "hook" ? event.hook : null,
    ]);

    if (event._tag === "hook") {
      const group = hooks.get(key);

      if (event.phase === "ended") {
        if (group && group.pending > 1) {
          group.pending--;
        } else {
          hooks.delete(key);
        }
      } else {
        const start = { ...event, phase: "started" as const };

        if (group) {
          group.pending++;
          group.starts.push(start);
        } else {
          hooks.set(key, { pending: 1, starts: [start] });
        }
      }
    } else if (event.phase === "ended") {
      active.delete(key);
    } else if (event._tag === "module") {
      active.set(key, Activity.cases.module.make({ ...event, phase: event.phase }));
    } else {
      active.set(key, Activity.cases.test.make({ ...event, phase: "started" }));
    }
  }

  return [
    ...active.values(),
    ...[...hooks.values()].map((group) => {
      const first = group.starts[0];

      return Activity.cases.hook.make({
        project: first.project,
        file: first.file,
        id: first.id,
        ...(first.line === undefined ? {} : { line: first.line }),
        ...(first.column === undefined ? {} : { column: first.column }),
        phase: "started",
        hook: first.hook,
        pending: group.pending,
        starts: group.starts,
      });
    }),
  ];
};

export const read = (text: string, expected: Leg): Progress => {
  const lines = text.split("\n");
  const terminated = lines.pop() === "";

  const header = Schema.decodeUnknownResult(Schema.fromJsonString(Header))(lines.shift() ?? "", {
    onExcessProperty: "error",
  });

  if (Result.isFailure(header)) {
    return Progress.cases.unavailable.make({ reason: "header" });
  }

  const identity = Schema.decodeUnknownResult(LegIdentity)(expected);

  if (
    Result.isFailure(identity) ||
    (["run", "attempt", "workflow", "event", "sha", "job", "leg"] as const).some(
      (key) => header.success.leg[key] !== identity.success[key],
    )
  ) {
    return Progress.cases.unavailable.make({ reason: "identity" });
  }

  const events: Event[] = [];
  const gaps: number[] = [];
  const reasons: Array<typeof Reason.Type> = [];
  let next = 1;
  let end: typeof End.Type | null = null;

  for (const line of lines) {
    if (end !== null) {
      reasons.push("after_end");
      break;
    }

    const decoded = Schema.decodeUnknownResult(Line)(line, { onExcessProperty: "error" });

    if (Result.isFailure(decoded)) {
      reasons.push("malformed");
      break;
    }

    const event = decoded.success;

    if (event.seq < next) {
      reasons.push("sequence");
      break;
    }

    if (event.seq > next) {
      gaps.push(next);
      reasons.push("write_gap");
    }

    next = event.seq + 1;

    if (event._tag === "run") {
      if (event.phase !== "ended") {
        reasons.push("malformed");
        break;
      }

      end = event;
    } else {
      events.push(event);
    }
  }

  if (!terminated) {
    reasons.push("truncated");
  }

  if (end === null) {
    reasons.push("missing_end");
  }

  const facts = {
    version: 1 as const,
    leg: header.success.leg,
    start: { seq: header.success.seq, at: header.success.at },
    events,
    active: replay(events),
    gaps,
  };

  return end !== null && reasons.length === 0
    ? Progress.cases.read.make({ ...facts, complete: true, end })
    : Progress.cases.partial.make({ ...facts, complete: false, end, reasons: [...new Set(reasons)] });
};

export const markdown = (progress: Progress): string => {
  if (Progress.isAnyOf(["unavailable"])(progress)) {
    return `### Test progress\n\nProgress unavailable: ${progress.reason}`;
  }

  const rows = progress.active.map(
    (event) =>
      `| ${event.project} | ${event.file} | ${event.id} | ${event.line ?? "-"}:${event.column ?? "-"} | ${event._tag} ${event.phase}${event._tag === "hook" ? ` ${event.hook}, ${event.pending} unmatched; possible start sequences ${event.starts.map((start) => start.seq).join(", ")}` : ""} |`,
  );

  return [
    "### Test progress",
    "",
    `Last observed activity. Journal ${progress._tag}; overlapping hooks with the same key are indistinguishable; possible starts do not identify which hook remains.`,
    `Reasons: ${progress._tag === "partial" ? progress.reasons.join(", ") : "none"}. Gap starts: ${progress.gaps.join(", ") || "none"}.`,
    "",
    "| Project | File | ID | Position | Observation |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
};
