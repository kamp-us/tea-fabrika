// Today's CI, both versions. The missing projects of an automatic PR/queue check; next and visual
// remain on the existing next matrix. A pull request and a queue group pick tooling's plain laws
// alone: every `.integration.` law, `next-integration`'s and `tooling-integration`'s alike, runs only
// on main's full run (scheduled.yaml, on a push to main and hourly, 0581), never on a pull request, a
// queue group or a branch's proof run (0602, 0584; `onMergeLine`). A selector error fails the
// required check, never means zero.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Effect, FileSystem, Match, Option, Path, Result, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { isIntegration } from "../../oxlint-plugins/test-names.ts";
import { rowsAt } from "../../vitest.shards.ts";
import { readers, validSha } from "./changes.mjs";
import { E2E_SETUP, list, room, withReaders } from "./legs.ts";
import { isTrigger, legsOf, whole } from "./proof.ts";

// T1076. The package's tested archive and its root consumer. P2 (`PACKAGE`) builds, packs and installs
// the archive; main's full run keeps it (0602), so the merge line never selects it, and the receipt
// below judges what each numbered leg of that run left. P1 (`CONSUMER`) imports the package by name,
// and Vitest's `--changed` follows imports, which no change to the package or to the fault's route
// reaches, so `wantsConsumerLaw` adds it by path, as `wantsChecklistLaw` adds the checklist fixture.
const KALFA = "kalfa/config";

const PACKAGE = `${KALFA}/src/Package.integration.test.ts`;

const CONSUMER = "scripts/kalfa-config.test.ts";

/** The paths, beside the package, whose change must run P1 and its fault: the fault's route. */
const ROUTE = new Set([".github/ci/related.ts", ".github/workflows/check.yaml", ".github/ci/workflow-lint/related.ts"]);

/** Whether a change keeps P1 in the run: the package (built files aside) or the fault's route, or history unreadable. */
export const wantsConsumerLaw = (paths: readonly string[] | null): boolean =>
  paths === null || paths.some((path) => (path.startsWith(`${KALFA}/`) && !path.includes("/dist/")) || ROUTE.has(path));

/** Adds a law only after Vitest lists it, alone, in its own project; anything else throws. */
export const confirmed = (
  selected: readonly string[],
  listed: readonly string[],
  file: string,
  needed: boolean,
): string[] => {
  if (needed && (listed.length !== 1 || listed[0] !== file)) {
    throw new Error(`related: ${file} must be discovered in its existing project`);
  }

  return withReaders(selected, needed ? listed : []);
};

const ARCHIVE = "kalfa-config-0.0.0.tgz";

const SUBPATHS = [
  "App",
  "Setting",
  "Sources",
  "Toml",
  "TomlParser",
  "Codec",
  "Files",
  "JsonSchema",
  "Reference",
  "Print",
  "Snapshot",
  "Load",
];

const STAGES = ["build", "pack", "install", "runtime", "imports", "private", "types"];

const REFUSALS = ["source", "parser", "declarations", "workspace"];

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const sameKeys = (found: readonly string[], expected: readonly string[]) =>
  found.length === expected.length && expected.every((key) => found.includes(key));

const Receipt = Schema.Struct({
  source: Schema.String,
  requested: Schema.String,
  archive: Schema.Literal(ARCHIVE),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  versions: Schema.Struct({
    node: Schema.String,
    pnpm: Schema.String,
    npm: Schema.String,
    compiler: Schema.String,
  }),
  exports: Schema.Record(Schema.String, Schema.Unknown),
  stages: Schema.Record(Schema.String, Schema.String),
  negatives: Schema.Record(Schema.String, Schema.String),
});

// A Vitest JSON report, as much of it as the two checks read.
const Suite = Schema.Struct({
  name: Schema.String,
  status: Schema.String,
  message: Schema.optionalKey(Schema.String),
  assertionResults: Schema.Array(
    Schema.Struct({
      status: Schema.String,
      failureMessages: Schema.optionalKey(Schema.Array(Schema.String)),
    }),
  ),
});

const Report = Schema.Struct({
  success: Schema.Boolean,
  numFailedTests: Schema.Finite,
  numFailedTestSuites: Schema.Finite,
  testResults: Schema.Array(Suite),
});

const decodeReport = Schema.decodeUnknownResult(Report);

const decodeReceipt = Schema.decodeUnknownResult(Schema.fromJsonString(Receipt));

/** The suites of a report that ran this file, by the end of their path. */
const suitesOf = (report: typeof Report.Type, file: string) =>
  report.testResults.filter((suite) => suite.name.replaceAll("\\", "/").endsWith(`/${file}`) || suite.name === file);

/** Passed, with at least one assertion and none skipped, todo, pending or failed. */
const passedClean = (suite: typeof Suite.Type | undefined): boolean =>
  suite !== undefined &&
  suite.status === "passed" &&
  suite.assertionResults.length > 0 &&
  suite.assertionResults.every((assertion) => assertion.status === "passed");

export type Delivery =
  | { readonly _tag: "kept"; readonly sha256: string; readonly source: string }
  | { readonly _tag: "absent" }
  | {
      readonly _tag: "refused";
      readonly reason:
        | "event"
        | "discovery"
        | "stray"
        | "missing"
        | "extra"
        | "unreadable"
        | "digest"
        | "source"
        | "requested"
        | "stage"
        | "exports"
        | "result";
    };

const refused = (reason: Extract<Delivery, { _tag: "refused" }>["reason"]): Delivery => ({ _tag: "refused", reason });

/** The refs and events whose run is main's full run: a push, the hourly catch-up or a hand start on main. */
const KEEPS_ON = ["push", "schedule", "workflow_dispatch"];

/**
 * What the receipt step of one numbered leg of main's full run keeps, judged by that leg's own report.
 * `kept`: P2 ran here, passed once and unskipped, and the delivery folder holds exactly the archive and
 * its receipt, whose digest, tested commit, requested head (both the run's commit), stages, refusals and
 * export keys agree. `absent`: P2 ran on another leg, so this report holds no P2 and no folder is lying
 * about. Anything else is refused, with the reason. The receipt's strings are written whatever happened;
 * only P2's own passing result proves its four refusals and the restored positive.
 */
export const checkDelivery = (input: {
  /** `GITHUB_REF`, which the runner sets on every step. */
  readonly ref: string | undefined;
  /** `GITHUB_EVENT_NAME`. */
  readonly event: string | undefined;
  /** `GITHUB_SHA`, the commit the leg checked out. */
  readonly head: string;
  /** What `vitest list --project next-integration <P2>` named. */
  readonly listed: readonly string[];
  /** The delivery folder's files, or null when there is no folder. */
  readonly folder: Readonly<Record<string, Uint8Array>> | null;
  /** The leg's own Vitest report. */
  readonly report: unknown;
}): Delivery => {
  if (input.ref !== "refs/heads/main" || input.event === undefined || !KEEPS_ON.includes(input.event)) {
    return refused("event");
  }

  // Every leg proves P2 is a next-integration file: one leg cannot see the others, so a dropped or
  // renamed P2 turns every numbered leg red, not silently nothing.
  if (input.listed.length !== 1 || input.listed[0] !== PACKAGE) {
    return refused("discovery");
  }

  const report = decodeReport(input.report);

  if (
    Result.isFailure(report) ||
    !report.success.success ||
    report.success.numFailedTests !== 0 ||
    report.success.numFailedTestSuites !== 0
  ) {
    return refused("result");
  }

  const mine = suitesOf(report.success, PACKAGE);

  if (mine.length > 1 || (mine.length === 1 && !passedClean(mine[0]))) {
    return refused("result");
  }

  if (mine.length === 0) {
    return input.folder === null ? { _tag: "absent" } : refused("stray");
  }

  if (input.folder === null) {
    return refused("missing");
  }

  const names = Object.keys(input.folder);
  const archive = input.folder[ARCHIVE];
  const written = input.folder["receipt.json"];

  if (archive === undefined || written === undefined) {
    return refused("missing");
  }

  if (names.length !== 2) {
    return refused("extra");
  }

  const decoded = decodeReceipt(new TextDecoder().decode(written));

  if (Result.isFailure(decoded)) {
    return refused("unreadable");
  }

  const receipt = decoded.success;

  if (receipt.sha256 !== sha256(archive)) {
    return refused("digest");
  }

  // On main the run's commit is the only head: what P2 tested and what it was asked for are one.
  if (receipt.source !== input.head) {
    return refused("source");
  }

  if (receipt.requested !== input.head) {
    return refused("requested");
  }

  if (
    !sameKeys(Object.keys(receipt.stages), STAGES) ||
    !STAGES.every((stage) => receipt.stages[stage] === "passed") ||
    !sameKeys(Object.keys(receipt.negatives), REFUSALS) ||
    !REFUSALS.every((name) => receipt.negatives[name] === "refused")
  ) {
    return refused("stage");
  }

  if (!sameKeys(Object.keys(receipt.exports), [...SUBPATHS.map((name) => `./${name}`), "./package.json"])) {
    return refused("exports");
  }

  return { _tag: "kept", sha256: receipt.sha256, source: receipt.source };
};

export type Fault =
  | { readonly _tag: "proven"; readonly digest: string }
  | {
      readonly _tag: "refused";
      readonly reason: "environment" | "not_red" | "wrong_reason" | "not_restored" | "not_green";
    };

const unproven = (reason: Extract<Fault, { _tag: "refused" }>["reason"]): Fault => ({ _tag: "refused", reason });

/** The fault runs in CI only: it rewrites a tracked manifest, which a person's checkout must never see. */
const inCi = (env: Readonly<Record<string, string | undefined>>) =>
  env["CI"] === "true" && env["GITHUB_ACTIONS"] === "true";

/**
 * Whether P1 is proven by its fault: the run with the package's App export pointed at a missing module
 * fails, and for that export; the manifest's bytes come back unchanged; and the second run passes P1,
 * unskipped. The digest is of the manifest's own bytes.
 */
export const checkFault = (input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly before: Uint8Array;
  readonly faulted: { readonly status: number; readonly report: unknown };
  readonly after: Uint8Array;
  readonly rerun: { readonly status: number; readonly report: unknown };
}): Fault => {
  if (!inCi(input.env)) {
    return unproven("environment");
  }

  if (input.faulted.status === 0) {
    return unproven("not_red");
  }

  const faulted = decodeReport(input.faulted.report);

  const failed = Result.isSuccess(faulted) ? suitesOf(faulted.success, CONSUMER) : [];

  const said = failed.flatMap((suite) => [
    suite.message ?? "",
    ...suite.assertionResults.flatMap((assertion) => assertion.failureMessages ?? []),
  ]);

  if (
    failed.length !== 1 ||
    failed[0]?.status !== "failed" ||
    !said.some((text) => text.includes("@kalfa/config/App"))
  ) {
    return unproven("wrong_reason");
  }

  const digest = sha256(input.before);

  if (sha256(input.after) !== digest) {
    return unproven("not_restored");
  }

  const rerun = decodeReport(input.rerun.report);

  if (
    input.rerun.status !== 0 ||
    Result.isFailure(rerun) ||
    suitesOf(rerun.success, CONSUMER).length !== 1 ||
    !passedClean(suitesOf(rerun.success, CONSUMER)[0])
  ) {
    return unproven("not_green");
  }

  return { _tag: "proven", digest };
};

const PROJECTS = ["next-integration", "tooling"] as const;

const checklistFixture = "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts";

type Project = (typeof PROJECTS)[number];

export type Sizing = Readonly<Record<Project, { readonly most: number; readonly limit: number }>> & {
  readonly table: Readonly<Record<string, number>>;
};

/**
 * Keep the existing product law in the ordinary related run when its former plant inputs change.
 * It is a `next-integration` file, so only a run that picks that project runs it (`projectsOf`); on
 * a pull request or a queue group it waits for main's full run like every other integration law.
 */
export const wantsChecklistLaw = (paths: readonly string[] | null): boolean =>
  paths === null ||
  paths.some(
    (path) =>
      path === checklistFixture ||
      /^\.github\/ci\/plant(?:-cases|-errors|-machine|-reporter|-related)?\.ts$/.test(path),
  );

/**
 * Whether the GitHub event that started a related run is the merge line: a pull request or a merge
 * queue group. The owner moved every `.integration.` law back to main's full run on 2026-11-18
 * (0602), after real-resource laws failed about a dozen of that night's pull request and queue runs
 * on code those changes never touched (0536's rule). Any other event, which in check.yaml is a push
 * to main whose changes job failed, picks both lists, as before; tooling's laws that start a process
 * are in neither, since they are `tooling-integration`'s.
 */
const onMergeLine = (event: string | undefined): boolean => event === "pull_request" || event === "merge_group";

/** The projects a related run picks from: tooling alone on the merge line, both otherwise. */
const projectsOf = (event: string | undefined): readonly Project[] => (onMergeLine(event) ? ["tooling"] : PROJECTS);

/** Each project's files, asked for only when the run picks that project, so a skipped one is never listed. */
type Lists = Readonly<Record<Project, () => readonly string[]>>;

/** Separate project legs keep their existing full-depth counts and test-step limits. */

export const select = (event: string | undefined, lists: Lists, sizing: Sizing) => {
  const listed = projectsOf(event).map((project) => [project, lists[project]()] as const);

  const all = listed.flatMap(([, paths]) => paths);

  // Every listed file is checked, a dropped one too: a broken list fails loudly on every event.
  if (all.some((path) => /\s/.test(path)) || new Set(all).size !== all.length) {
    throw new Error("related: selected files must be distinct paths without whitespace");
  }

  // A tooling law that starts a process is an `.integration.` law too (0584). Its own project,
  // `tooling-integration`, already keeps it out of tooling's list; the name holds it off the merge
  // line whatever a list gives.
  const picked = listed.map(
    ([project, paths]) => [project, onMergeLine(event) ? paths.filter((path) => !isIntegration(path)) : paths] as const,
  );

  const legs: Record<string, readonly string[]> = {};

  const projects: Record<string, Project> = {};

  for (const [project, paths] of picked) {
    const split = legsOf(paths, { ...sizing[project], table: sizing.table });

    for (const paths of Object.values(split)) {
      const name = String(Object.keys(legs).length + 1);
      legs[name] = paths;
      projects[name] = project;
    }
  }

  if (Object.keys(legs).length > 9) {
    throw new Error("related: the selection must fit check.yaml's related max-parallel of nine legs");
  }

  // P1 has one owning leg, in tooling: any other placement is a selector error. P2 is never added by
  // path (0602), so no leg owns it.
  const owners = Object.keys(legs).filter((leg) => projects[leg] === "tooling" && legs[leg]?.includes(CONSUMER));

  if (all.includes(CONSUMER) && owners.length !== 1) {
    throw new Error(`related: ${CONSUMER} must sit on exactly one tooling leg`);
  }

  return { legs, projects, consumer: owners[0] ?? "" };
};

export const outputs = (selection: ReturnType<typeof select>): string[] => [
  `run=${Object.keys(selection.legs).length > 0}`,
  `legs=${JSON.stringify(Object.keys(selection.legs))}`,
  `files=${JSON.stringify(Object.fromEntries(Object.entries(selection.legs).map(([leg, paths]) => [leg, paths.join(" ")])))}`,
  `projects=${JSON.stringify(selection.projects)}`,
  `consumer=${selection.consumer}`,
];

/** What a failed fault run says, so a log reader sees which of the five steps it stopped at. */
class FaultError extends Schema.TaggedError<FaultError, { readonly brand: unique symbol }>()("FaultError", {
  reason: Schema.String,
}) {}

/**
 * The arguments of one P1 run of the `--fault` mode, after `pnpm`. The module cache is off: the tooling
 * step has just run P1 in this tree, and Vitest 5.0.5's file-system module cache (`fsModuleCache`, on by
 * default, under node_modules/.vitest-cache) would hand the faulted run that step's cached resolution of
 * `@kalfa/config/App`, so the broken export would never be read and the fault would never show.
 */
export const consumerArgs = (out: string): readonly string[] => [
  "exec",
  "vitest",
  "run",
  "--project",
  "tooling",
  CONSUMER,
  "--fsModuleCache=false",
  "--reporter=json",
  `--outputFile.json=${out}`,
];

/** What stopped the fault run, in words that hold no path and no value: the reason, or the error's tag. */
const why = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.findErrorOption(cause);

  if (Option.isNone(error)) {
    return Cause.hasInterrupts(cause) ? "interrupted" : "defect";
  }

  const value = error.value;

  if (Schema.is(FaultError)(value)) {
    return value.reason;
  }

  if (typeof value === "object" && value !== null && "_tag" in value) {
    const inner = "reason" in value && typeof value.reason === "object" && value.reason !== null ? value.reason : null;

    return inner !== null && "_tag" in inner ? `${String(value._tag)}, ${String(inner._tag)}` : String(value._tag);
  }

  return "failed";
};

const readJson = (text: string): unknown => {
  const decoded = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown))(text);

  return Result.isSuccess(decoded) ? decoded.success : null;
};

/**
 * The `--fault` mode: P1's source fault, in CI only. The five steps are the approved plan's: keep the
 * manifest's digest; point exports["./App"] at a missing module; run P1, which must fail for that
 * export; restore the original bytes in a finalizer and see git agree; run P1 again, which must pass.
 */
const fault = Effect.fn("related.fault")(function* (env: Readonly<Record<string, string | undefined>>) {
  if (!inCi(env)) {
    return unproven("environment");
  }

  const fs = yield* FileSystem.FileSystem;

  const path = yield* Path.Path;

  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

  const manifest = path.join(root, KALFA, "package.json");

  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "related-fault-" });

  // One P1 run: its exit status and its JSON report, null when Vitest wrote none.
  const run = Effect.fn("related.fault.run")(function* (name: string) {
    const out = path.join(scratch, `${name}.json`);

    const child = yield* spawner.spawn(
      ChildProcess.make("pnpm", consumerArgs(out), { cwd: root, stdin: "ignore", extendEnv: true }),
    );

    const [status, output] = yield* Effect.all([child.exitCode, child.all.pipe(Stream.decodeText(), Stream.mkString)], {
      concurrency: "unbounded",
    });

    console.log(`related: P1 ${name} run exited ${Number(status)}`);
    console.log(output.trim());

    const report = (yield* fs.exists(out)) ? readJson(yield* fs.readFileString(out)) : null;

    return { status: Number(status), report };
  }, Effect.scoped);

  // 1. The manifest's bytes and digest.
  const before = yield* fs.readFile(manifest);

  const unreadable = () => FaultError.make({ reason: "manifest_unreadable" });

  const parsed = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(
    new TextDecoder().decode(before),
  ).pipe(Effect.mapError(unreadable));

  const exported = yield* Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown))(
    parsed["exports"],
  ).pipe(Effect.mapError(unreadable));

  const broken = `${JSON.stringify({ ...parsed, exports: { ...exported, "./App": "./src/Missing.ts" } }, null, 2)}\n`;

  const faulted = yield* Effect.scoped(
    Effect.gen(function* () {
      // 2. Point the App export at a missing module; the finalizer puts the original bytes back,
      // whether the run below passed, failed or was interrupted.
      yield* Effect.acquireRelease(fs.writeFileString(manifest, broken), () =>
        fs.writeFile(manifest, before).pipe(
          Effect.tapCause(() => Effect.sync(() => console.error("related: the manifest could not be restored"))),
          Effect.orDie,
        ),
      );

      // 3. P1 must fail, for the export.
      return yield* run("faulted");
    }),
  );

  // 4. The bytes are back, and git sees no change to the manifest.
  const after = yield* fs.readFile(manifest);

  const clean = yield* spawner
    .spawn(
      ChildProcess.make("git", ["diff", "--exit-code", "--", `${KALFA}/package.json`], { cwd: root, stdin: "ignore" }),
    )
    .pipe(
      Effect.flatMap((child) => child.exitCode),
      Effect.scoped,
    );

  // 5. P1 again, which must pass.
  const rerun = yield* run("rerun");

  console.log(`related: manifest digest ${sha256(before)}, restored ${sha256(after)}, git exit ${Number(clean)}`);

  return Number(clean) === 0 ? checkFault({ env, before, faulted, after, rerun }) : unproven("not_restored");
}, Effect.scoped);

/** What the select step reads from outside itself: its variables, git, and Vitest's list of files. */
export type Step = {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** git's trimmed output for `args`, run in the checkout; it throws when git fails. */
  readonly git: (args: readonly string[]) => string;
  /** `vitest list` over `args`, the files it names, from the repo root. */
  readonly list: (args: readonly string[]) => string[];
};

/**
 * The select step, on what `step` gives it: the tested commit and the change from its variables
 * and git, the run's event from `GITHUB_EVENT_NAME`, which the runner sets on every step
 * (`pull_request`, `merge_group` or `push` in check.yaml), and each picked project's files. It
 * gives the record it keeps and the lines it prints, and writes nothing itself.
 */
export const run = (step: Step) => {
  const { env, git } = step;

  const head = git(["rev-parse", "--verify", "HEAD^{commit}"]);

  if (!validSha(head) || head !== env["HEAD"]) {
    throw new Error("related: checkout HEAD must equal this check's tested commit");
  }

  const from = env["BASE"];

  const base = from !== undefined && validSha(from) ? git(["merge-base", from, head]) : null;

  const changed =
    base === null
      ? null
      : git(["diff", "--name-only", "-z", `${base}...${head}`])
          .split("\0")
          .filter(Boolean);

  const triggers = changed?.filter(isTrigger) ?? [];

  const full = changed === null || triggers.length > 0;

  const narrowed = !full && base !== null ? [`--changed=${base}`] : [];

  const event = env["GITHUB_EVENT_NAME"];

  // P1 by path, on a full run or a change to the package or the fault's route, and only once Vitest lists
  // it in tooling. P2 is never added by path: main's full run runs it (0602). Each list stays lazy, so a
  // project the event does not pick is never listed.
  const need = full || wantsConsumerLaw(changed);

  const lists: Lists = {
    "next-integration": () =>
      withReaders(step.list(["--project", "next-integration", ...narrowed]), [
        // A reader test reads the parser adapter's location under kalfa/config/src as text.
        ...(!full && changed?.some((path) => path.startsWith("next/") || path.startsWith("kalfa/"))
          ? step.list(["--project", "next-integration", ...readers])
          : []),
        ...(wantsChecklistLaw(changed) ? [checklistFixture] : []),
      ]),
    tooling: () =>
      confirmed(
        step.list(["--project", "tooling", ...narrowed]),
        need ? step.list(["--project", "tooling", CONSUMER]) : [],
        CONSUMER,
        need,
      ),
  };

  const sizing: Sizing = {
    "next-integration": {
      most: whole("MOST_INTEGRATION", env["MOST_INTEGRATION"]),
      limit: room(whole("LIMIT_INTEGRATION", env["LIMIT_INTEGRATION"]), E2E_SETUP),
    },
    tooling: {
      most: whole("MOST_TOOLING", env["MOST_TOOLING"]),
      limit: room(whole("LIMIT_TOOLING", env["LIMIT_TOOLING"]), E2E_SETUP),
    },
    table: rowsAt("full"),
  };

  const selected = select(event, lists, sizing);

  return {
    record: { event, base, head, at: new Date().toISOString(), changed, triggers, full, ...selected },
    lines: outputs(selected),
  };
};

if (import.meta.main && process.argv[2] === "--receipt") {
  const root = fileURLToPath(new URL("../../", import.meta.url));

  const directory = process.env["RUNNER_TEMP"];

  if (!directory) {
    throw new Error("related: the receipt check requires RUNNER_TEMP");
  }

  const folder = join(directory, "kalfa-config-package");

  // A name that is not a file reads as empty, so a folder named like the archive is a digest fault.
  const files = existsSync(folder)
    ? Object.fromEntries(
        readdirSync(folder, { withFileTypes: true }).map((entry) => [
          entry.name,
          entry.isFile() ? new Uint8Array(readFileSync(join(folder, entry.name))) : new Uint8Array(),
        ]),
      )
    : null;

  const results = join(directory, "results.json");

  const verdict = checkDelivery({
    ref: process.env["GITHUB_REF"],
    event: process.env["GITHUB_EVENT_NAME"],
    head: process.env["GITHUB_SHA"] ?? "",
    listed: list(root, ["--project", "next-integration", PACKAGE]),
    folder: files,
    report: existsSync(results) ? readJson(readFileSync(results, "utf8")) : null,
  });

  const keep = (kept: boolean) => {
    const output = process.env["GITHUB_OUTPUT"];

    if (output) {
      appendFileSync(output, `kept=${kept}\n`);
    }
  };

  Match.valueTags(verdict, {
    kept: (found) => {
      console.log(`related: kept ${ARCHIVE} sha256 ${found.sha256} from ${found.source}`);
      keep(true);
    },
    absent: () => {
      console.log("related: no package archive on this leg: P2 ran elsewhere, and no delivery folder is here");
      keep(false);
    },
    refused: (found) => {
      console.error(`related: the package delivery is refused: ${found.reason}`);
      process.exitCode = 1;
    },
  });
} else if (import.meta.main && process.argv[2] === "--fault") {
  NodeRuntime.runMain(
    fault(process.env).pipe(
      Effect.tap((verdict) =>
        Effect.sync(() => {
          if (verdict._tag === "refused") {
            console.error(`related: the consumer fault is not proven: ${verdict.reason}`);
            process.exitCode = 1;
          } else {
            console.log(`related: the consumer fault is proven, manifest digest ${verdict.digest}`);
          }
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          console.error(`related: the consumer fault could not run: ${why(cause)}`);
          process.exitCode = 1;
        }),
      ),
      Effect.provide(NodeServices.layer),
    ),
  );
} else if (import.meta.main) {
  const root = fileURLToPath(new URL("../../", import.meta.url));

  const git = (args: readonly string[]): string => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });

    if (result.status !== 0) {
      throw new Error(`related: git ${args.join(" ")} exited ${result.status}`);
    }

    return result.stdout.trim();
  };

  const { record, lines } = run({ env: process.env, git, list: (args) => list(root, args) });

  const target = process.env["RECORD"];

  if (target) {
    writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
  }

  console.log(JSON.stringify(record));
  console.log(lines.join("\n"));

  const output = process.env["GITHUB_OUTPUT"];

  if (output) {
    appendFileSync(output, `${lines.join("\n")}\n`);
  }
}
