// Today's field records. Cores measured against 437 notes and the last 500 runs
// by the approved T342 plan. README drift advises; unknown facts stay unknown.
// A finding row's core is decision 0035's own: its keys, the closed `rule` list and its proof.
// Decision 0090: a new row is its own file, field/<log>/<date>-<slug>.json; the old .jsonl files
// are history. Both hold the same rows, so one schema reads both.
import { Schema } from "effect";

const Log = Schema.Literals(["notes", "runs", "findings"]);
export type Log = typeof Log.Type;

/** The log a path holds rows of: its old `.jsonl` file, or anything in its folder. */
export const logOf = (file: string): Log | null => {
  const log = /^field\/([^/]+)(?:\.jsonl$|\/)/.exec(file)?.[1];
  return Schema.is(Log)(log) ? log : null;
};

/** A row file's name: the date plus a short kebab-case slug, which is the row's id (0090). */
export const rowName = /^field\/(?:notes|runs|findings)\/(\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)\.json$/;

/** True for a path in a log's folder, a row file or a misnamed one, never an old `.jsonl` file. */
export const inFolder = (file: string) => /^field\/(?:notes|runs|findings)\//.test(file);

const dated = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const Day = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
const Text = Schema.NullOr(Schema.String);
const Count = Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)));

// A note lists its quests (0546). A row written before the rename lists them as `lanes`, and a row
// is never edited, so a note holds exactly one of the two keys, checked in `checkRow`.
const Quests = Schema.Array(Schema.Unknown);
const questKeys = ["quests", "lanes"] as const;

const Note = Schema.Struct({
  id: Schema.String,
  date: Day,
  stage: Schema.String,
  kind: Schema.String,
  what: Schema.String,
  fix: Text,
  cause: Schema.optionalKey(Text),
  person: Schema.optionalKey(Schema.Boolean),
  primitive: Schema.optionalKey(Text),
  test: Schema.optionalKey(Text),
  links: Schema.optionalKey(Schema.Array(Schema.String)),
});

/** One plant a step ran once (0093): the law, the break, and `red` if the law caught it, else `green`. */
const Plant = Schema.Struct({ law: Schema.String, plant: Schema.String, result: Schema.Literals(["red", "green"]) });

const Run = Schema.Struct({
  date: Day,
  role: Schema.String,
  model: Text,
  effort: Text,
  outcome: Text,
  note: Schema.optionalKey(Text),
  why: Text,
  tokens: Count,
  tools: Count,
  minutes: Count,
  run: Schema.optionalKey(Schema.String),
  started: Schema.optionalKey(Text),
  ended: Schema.optionalKey(Text),
  parent: Schema.optionalKey(Text),
  active: Schema.optionalKey(Count),
  costUsd: Schema.optionalKey(Count),
  listUsd: Schema.optionalKey(Count),
  billed: Schema.optionalKey(Count),
  inputTokens: Schema.optionalKey(Count),
  cachedTokens: Schema.optionalKey(Count),
  outputTokens: Schema.optionalKey(Count),
  driver_caused: Schema.optionalKey(Schema.Boolean),
  plants: Schema.optionalKey(Schema.Array(Plant)),
});

// A finding and its rating (decision 0035). The fields table is field/README.md, "A finding".
const Words = Schema.String.check(Schema.isPattern(/\S/));

const Found = Schema.Struct({
  _tag: Schema.Literal("finding"),
  id: Schema.String,
  date: Day,
  by: Words,
  model: Text,
  rule: Schema.Literals(["bug", "dead_code", "duplicate", "missing_test", "flaky_test", "doc_drift", "rule_break"]),
  location: Schema.Struct({
    path: Words,
    line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  }),
  says: Words,
  proof: Words,
  cost: Words,
  head: Schema.String,
  ticket: Text,
  pr: Text,
});

const Rated = Schema.Struct({
  _tag: Schema.Literal("rated"),
  finding: Schema.String,
  says: Schema.Literals(["fix", "noise"]),
  by: Words,
  date: Day,
  ticket: Text,
});

const fields = {
  file: Schema.String,
  line: Schema.Number,
  field: Schema.String,
  reason: Schema.String,
};

export const Finding = Schema.TaggedUnion({ error: fields, warning: fields });
export type Finding = typeof Finding.Type;

const words: Record<string, readonly string[]> = {
  stage: ["report", "triage", "plan", "ruling", "build", "review", "ship", "harness", "driver"],
  kind: ["failure", "friction", "cost", "success"],
  role: [
    "operator",
    "builder",
    "reviewer",
    "shipper",
    "triager",
    "planner",
    "machine",
    "acp",
    "hand",
    "session",
    "pipeline",
    "driver",
    "step",
  ],
  outcome: ["merged", "pass", "fail", "triaged", "parked", "skip", "stopped"],
};

// A row is read with JSON.parse, so every value in it is JSON's.
const isObject = (value: unknown): value is Schema.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A row's fields, as JSON.parse gives them. */
export type Fields = Schema.JsonObject;

/** The fields of a parsed row, or none when it is not a JSON object. */
export const fieldsOf = (value: unknown): Fields => (isObject(value) ? value : {});

/** Never put a value or a decoder's input-bearing error into a finding. */
export const checkRow = (file: string, line: number, value: unknown): Finding[] => {
  const error = (field: string, reason: string) => Finding.cases.error.make({ file, line, field, reason });
  const warning = (field: string, reason: string) => Finding.cases.warning.make({ file, line, field, reason });

  if (!isObject(value)) {
    return [error("row", "expected a JSON object")];
  }

  const log = logOf(file);
  const found = log === "findings";
  // A row file's own id is checked against its name in field-check.ts; a counter's shape is old.
  const folder = inFolder(file);

  if (found && value["_tag"] !== "finding" && value["_tag"] !== "rated") {
    return [error("_tag", "expected finding or rated")];
  }

  const schema =
    log === "notes" ? Note : log === "runs" ? Run : found ? (value["_tag"] === "rated" ? Rated : Found) : null;

  if (schema === null) {
    return [warning("row", "no detailed schema for this file")];
  }

  const failures = Object.entries(schema.fields).flatMap(([field, rule]) =>
    Schema.is(Schema.Struct({ [field]: rule }))(value) ? [] : [error(field, "invalid or missing core field")],
  );

  if (schema === Note) {
    const keys = questKeys.filter((key) => key in value);
    const key = keys.length > 1 ? "quests" : (keys[0] ?? "quests");

    if (keys.length > 1) {
      failures.push(error(key, "a note lists its quests under `quests` or `lanes`, never both"));
    } else if (!Schema.is(Quests)(value[key])) {
      failures.push(error(key, "invalid or missing core field"));
    }
  }

  // The proposed shape said `at`. AGENTS.md keeps `at` for a time, so the place is `location`.
  if (schema === Found && "at" in value) {
    failures.push(error("at", "a finding's place is `location`"));
  }

  if (failures.length > 0) {
    return failures;
  }

  const findings: Finding[] = [];

  if (found) {
    for (const field of folder ? ["finding"] : ["id", "finding"]) {
      const text = String(value[field]);

      if (field in value && !/^\d{4}-\d{2}-\d{2}-f\d{2,}$/.test(text) && !(folder && dated.test(text))) {
        findings.push(warning(field, "unusual record id"));
      }
    }

    if ("head" in value && !/^[0-9a-f]{40}$/.test(String(value["head"]))) {
      findings.push(warning("head", "not a full commit sha"));
    }

    const place = value["location"];

    if (isObject(place) && /^[/~]|^[A-Za-z]:|(?:^|\/)\.\.(?:\/|$)/.test(String(place["path"]))) {
      findings.push(warning("location", "path is not repo-relative"));
    }
  }

  const note = log === "notes";
  const metadata = note
    ? ["cause", "person", "primitive", "test", "links"]
    : ["run", "ticket", "pr", "started", "ended", "parent", "active", "driver_caused", "costUsd", "billed"];

  for (const field of found ? [] : metadata) {
    if (!(field in value)) {
      findings.push(warning(field, "README metadata is absent"));
    }
  }

  for (const field of found ? [] : note ? ["stage", "kind"] : ["role", "outcome"]) {
    if (!(words[field] ?? []).includes(String(value[field]))) {
      findings.push(warning(field, "word outside README list"));
    }
  }

  for (const key of questKeys) {
    const quests = value[key];

    if (Array.isArray(quests) && quests.some((quest) => typeof quest !== "string")) {
      findings.push(warning(key, "quest member is not text"));
    }
  }

  const id = note ? "id" : "run";

  if (
    !found &&
    !folder &&
    typeof value[id] === "string" &&
    !/^\d{4}-\d{2}-\d{2}-(?:r)?\d+(?:-c\d+)?$/.test(value[id])
  ) {
    findings.push(warning(id, "unusual record id"));
  }

  const day = value["date"];

  if (
    typeof day === "string" &&
    (!Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day)
  ) {
    findings.push(warning("date", "unusual calendar date"));
  }

  for (const field of ["started", "ended"]) {
    const time = value[field];

    if (
      typeof time === "string" &&
      (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(time) || !Number.isFinite(Date.parse(time)))
    ) {
      findings.push(warning(field, "unusual timestamp"));
    }
  }

  for (const field of ["ticket", "pr"]) {
    const ref = value[field];

    if (ref != null && (typeof ref !== "string" || !/^[^/\s]+\/[^#\s]+#\d+$/.test(ref))) {
      findings.push(warning(field, "unusual reference"));
    }
  }

  if (
    typeof value["parent"] === "string" &&
    !/^\d{4}-\d\d-\d\d-r\d+(?:-c\d+)?$/.test(value["parent"]) &&
    !dated.test(value["parent"])
  ) {
    findings.push(warning("parent", "unusual parent reference"));
  }

  if (
    typeof value["started"] === "string" &&
    typeof value["ended"] === "string" &&
    Date.parse(value["ended"]) < Date.parse(value["started"])
  ) {
    findings.push(warning("ended", "end precedes start"));
  }

  if (
    typeof value["active"] === "number" &&
    typeof value["minutes"] === "number" &&
    value["active"] > value["minutes"]
  ) {
    findings.push(warning("active", "active time exceeds wall time"));
  }

  if (
    typeof value["cachedTokens"] === "number" &&
    typeof value["inputTokens"] === "number" &&
    value["cachedTokens"] > value["inputTokens"]
  ) {
    findings.push(warning("cachedTokens", "cached count exceeds input count"));
  }

  if (
    typeof value["billed"] === "number" &&
    typeof value["inputTokens"] === "number" &&
    typeof value["outputTokens"] === "number" &&
    value["billed"] !== value["inputTokens"] + value["outputTokens"]
  ) {
    findings.push(warning("billed", "billed count differs from input plus output"));
  }

  if (
    Array.isArray(value["links"]) &&
    value["links"].some((link) => typeof link === "string" && !/^https?:\/\/\S+$/.test(link))
  ) {
    findings.push(warning("links", "unusual public URL"));
  }

  return findings;
};
