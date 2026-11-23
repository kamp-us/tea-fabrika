// Today's CI, serving both versions. What a branch's proof run tests (a branch's proof run runs only the tests its change reaches): scheduled.yaml started
// by hand on a branch other than main runs only the tests its change reaches. Its `select` job runs
// this, after an install, and the `changed` job's legs run what it prints.
//
//   the branch's change against origin/main      the run tests
//   is started with `integration` files          only those files, on one `changed` leg, one slot,
//                                                whatever the change touches
//   touches a file in forceRerunTriggers         the full set, on the `tests` job, as main does,
//                                                less every `.integration.` law (integration laws run only in main's full run)
//   is started with `scope: full` for a `law`     the full set too, and the record keeps the inputs
//   reaches some tests                           those, on as many `changed` legs as they need,
//                                                the `.integration.` laws it reaches included
//   reaches no test                              nothing: the run is green with no test leg
//
// The set is Vitest's own (an existing, widely used tool comes before a hand-written one): `vitest list --changed <base>` over every
// project CI runs (PROJECTS), the import graph `--changed` walks, with the files vitest.config.ts hands it as
// watched files. That includes the `.integration.` laws, `next-integration`'s (next/ and kalfa/) and
// `tooling-integration`'s: the owner decided on 2026-11-22 that a proof run the lead starts runs the
// integration laws its changed set reaches, or only the ones it names in `integration`, on one leg,
// so an adapter's real-binary laws run before merge. A full set still runs none (FULL_PROJECTS), and
// pull requests and the merge queue run none (related.ts's `onMergeLine`, check.yaml). Today's
// tests run in no CI job (CI runs none of today's version's tests). A next/ change
// adds the in-memory reader tests too (changes.mjs's `readers`), as the merge line does: they read
// next/'s source as text, so the import graph cannot reach them, and making each file they read a
// rerun trigger would make every next/ change run everything.
//
// Rerun triggers are checked here on git's own diff, before Vitest's narrowing of the lockfile and
// the manifests (vitest.changed.ts): a change to any of them runs the full set (a branch's proof run runs only the tests its change reaches), as Vitest's own
// `filterTestsBySource` does when a changed file matches `forceRerunTriggers` (Vitest 5.0.5,
// dist/chunks/cli-api.De07GUeT.js). The match is vitest.config.ts's: Vitest's installed picomatch,
// with `dot: true`, over `testConfig`'s triggers.
//
// A changed set of zero files is a green run with no test leg, and its record says so: the lead asked
// for a proof of this head, the set Vitest gave is that proof, and main's full run, every test on
// every push (main's full run starts on a push to main and an hourly catch-up), stays the net for a miss. Ending the run with no verdict would leave arm with
// nothing to read at the head, the same as no run at all.
//
// Legs are sized from the full-depth seconds the schedule measured (vitest.shards.ts's `rowsAt`), the
// fewest whose longest share fits half a leg's test step limit less an end-to-end leg's setup, as
// legs.ts sizes the merge line's, up to the matrix's `max-parallel`. Each leg runs exactly its list.
//
// A hand start says what it wants as `scope` (scheduled.yaml's input, `changed` unless a person says
// `full`) and, for `full`, the `law`: the test file that needs the full set. This script holds both
// to the rules in `inputsOf` and has no default of its own, so the workflow's input is the one place a
// default is declared (a choice that makes sense as a setting is a setting, declared once). `scope: changed` does not override a rerun trigger: the proof-run rule stands.
// The third input, `integration`, names `.integration.test.ts` files to run alone (`integrationOf`):
// one or more paths, split on whitespace, each one Vitest lists in an integration project at this
// head. It is the narrow way to run a real-resource law before merge, so it wins over a trigger.
//
// The run keeps what it tested as its `proof-set` artifact and in its summary: the base commit, the
// head, git's changed files, the inputs, each leg's files and seconds, and when. origin/main moves on,
// so the set cannot be worked out again later.
import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Config, DateTime, Result, Schema } from "effect";
import vitestPackage from "vitest/package.json" with { type: "json" };
import { rowsAt } from "../../vitest.shards.ts";
import { readers, validSha } from "./changes.mjs";
import { E2E_SETUP, fewest, isTrigger, list, room, seconds, split, withReaders } from "./legs.ts";
import { readEnv, stepFiles } from "./step-env.ts";

export { isTrigger };

/**
 * The projects a changed set lists and runs: every one CI runs, the two integration projects
 * included (the owner decided on 2026-11-22), and today's left out (CI runs none of today's version's
 * tests). scheduled.yaml's `changed` legs name these, in this order.
 */
export const PROJECTS = ["next", "next-integration", "next-visual", "tooling", "tooling-integration"] as const;

/**
 * The projects a branch's full set runs, on scheduled.yaml's `tests` legs, and so the projects a full
 * start's `law` must be in: no integration project (integration laws run only in main's full run).
 */
export const FULL_PROJECTS = ["next", "next-visual", "tooling"] as const;

/** The projects a named `integration` file must be in. */
const INTEGRATION_PROJECTS = ["next-integration", "tooling-integration"] as const;

/** The `--project` flags of `projects`, in their order. */
const flags = (projects: readonly string[]) => projects.flatMap((project) => ["--project", project]);

/**
 * The `vitest list` calls a changed set is read from: `reached`, the tests the change reaches
 * against `base` over PROJECTS, the integration laws among them, and `readers`, the in-memory
 * reader tests, asked for only when the change touches next/ (`null` otherwise).
 */
export const listings = (base: string, changed: readonly string[]) => ({
  reached: [...flags(PROJECTS), `--changed=${base}`],
  readers: changed.some((path) => path.startsWith("next/")) ? [...flags(["next"]), ...readers] : null,
});

/** What the proof run tests, and the facts it was chosen from. */
export type Proof =
  | {
      readonly _tag: "full";
      readonly base: string;
      readonly head: string;
      readonly at: string;
      readonly vitest: string;
      /** The hand start's inputs: `changed` when a rerun trigger alone made this the full set. */
      readonly inputs: Exclude<Inputs, { readonly _tag: "integration" }>;
      /** git's changed files, base to head: the input of the choice, which a squash merge loses. */
      readonly changed: readonly string[];
      /** The changed files that match a rerun trigger. */
      readonly triggers: readonly string[];
    }
  | {
      readonly _tag: "changed";
      readonly base: string;
      readonly head: string;
      readonly at: string;
      readonly vitest: string;
      /** Always `changed`: the inputs `scope: full` make the full set, never a changed set. */
      readonly inputs: { readonly _tag: "changed" };
      /** git's changed files, base to head. */
      readonly changed: readonly string[];
      /** Each leg's test files, by the leg's name: `"1"` to `"N"`. No leg for a set of zero files. */
      readonly legs: Readonly<Record<string, readonly string[]>>;
      /** Each leg's measured seconds, a file with no row at the table's median. */
      readonly seconds: Readonly<Record<string, number>>;
    }
  | {
      readonly _tag: "integration";
      readonly base: string;
      readonly head: string;
      readonly at: string;
      readonly vitest: string;
      /** The named files, which the one leg runs. */
      readonly inputs: { readonly _tag: "integration"; readonly files: readonly string[] };
      /** git's changed files, base to head. */
      readonly changed: readonly string[];
      /** One leg, `"1"`, the named files. */
      readonly legs: Readonly<Record<string, readonly string[]>>;
      readonly seconds: Readonly<Record<string, number>>;
    };

/** The hand start's `scope` input, as scheduled.yaml gives it (a branch's proof run runs only the tests its change reaches). */
const ScopeInput = Schema.Literals(["changed", "full"]);

/**
 * The hand start's inputs, decoded: `full` carries the `law` that needs the full set, and
 * `integration` the `.integration.` files to run alone.
 */
export const Inputs = Schema.TaggedUnion({
  changed: {},
  full: { law: Schema.String },
  integration: { files: Schema.Array(Schema.String) },
});

export type Inputs = typeof Inputs.Type;

/** What the select step read: the commits, git's changed files, the inputs, and when. */
export type Seen = {
  readonly base: string;
  readonly head: string;
  readonly at: string;
  readonly vitest: string;
  readonly changed: readonly string[];
  readonly inputs: Inputs;
};

/** How a changed set is split: the most legs at once, and the seconds one leg's files may take. */
export type Sizing = {
  readonly most: number;
  readonly limit: number;
  readonly table: Readonly<Record<string, number>>;
};

/** The changed files that match a rerun trigger, in git's order. */
export const triggered = (changed: readonly string[], isTrigger: (path: string) => boolean): string[] =>
  changed.filter(isTrigger);

/** The changed set split into legs `"1"` to `"N"`, the fewest that fit, as `Sizing` says. */
export const legsOf = (files: readonly string[], sizing: Sizing): Record<string, string[]> => {
  const count = fewest(files, sizing.most, sizing.limit, sizing.table);

  return Object.fromEntries(split(files, count, sizing.table).map((leg, i) => [`${i + 1}`, leg]));
};

/**
 * The step's SCOPE and LAW, decoded, or a throw, so the step fails and prints nothing. No default:
 * scheduled.yaml's input holds the one default, so a missing SCOPE is an error, not `changed`.
 * `isLaw` says whether a path is a test file a proof run runs; a law that starts with a dash or holds
 * whitespace is refused before `isLaw` runs, so it can never read as a flag of `vitest list`.
 */
export const inputsOf = (
  scope: string | undefined,
  law: string | undefined,
  isLaw: (path: string) => boolean,
): Inputs => {
  const decoded = Schema.decodeUnknownResult(ScopeInput)(scope);

  if (Result.isFailure(decoded)) {
    throw new Error(`proof: SCOPE must be changed or full, not ${JSON.stringify(scope)}`);
  }

  const given = law ?? "";

  if (decoded.success === "changed") {
    if (given !== "") {
      throw new Error(`proof: LAW must be empty when the scope is changed, not ${JSON.stringify(given)}`);
    }

    return Inputs.cases.changed.make({});
  }

  if (!/^[^\s-]\S*$/.test(given) || !isLaw(given)) {
    throw new Error(
      `proof: LAW must be a test file vitest lists in the projects a proof runs when the scope is full, not ${JSON.stringify(given)}`,
    );
  }

  return Inputs.cases.full.make({ law: given });
};

/** Whether `vitest list` over the full set's projects gives back exactly `path`, by `lister`. */
export const inProjects =
  (lister: (args: readonly string[]) => readonly string[]) =>
  (path: string): boolean =>
    lister([...flags(FULL_PROJECTS), path]).includes(path);

/** The files `vitest list` over the integration projects gives back for `paths`, by `lister`. */
export const inIntegration =
  (lister: (args: readonly string[]) => readonly string[]) =>
  (paths: readonly string[]): readonly string[] =>
    lister([...flags(INTEGRATION_PROJECTS), ...paths]);

/**
 * The step's INTEGRATION, decoded onto `inputs`, or a throw, so the step fails and prints nothing.
 * Empty or whitespace alone keeps `inputs`. Else it names one or more `.integration.test.ts` files,
 * split on whitespace, each once, each listed by `listed` (Vitest over the integration projects, so a
 * file the branch lacks is refused), and only with `scope: changed`: a named start runs those files
 * and nothing else. A name or a repeat is refused before any list, so no path reads as a flag.
 */
export const integrationOf = (
  inputs: Inputs,
  given: string | undefined,
  listed: (paths: readonly string[]) => readonly string[],
): Inputs => {
  const paths = (given ?? "").split(/\s+/).filter((path) => path !== "");

  if (paths.length === 0) {
    return inputs;
  }

  if (new Set(paths).size !== paths.length) {
    throw new Error(`proof: INTEGRATION must name each file once, not ${JSON.stringify(paths)}`);
  }

  const unnamed = paths.filter((path) => !/^[^\s-]\S*\.integration\.test\.tsx?$/.test(path));

  if (unnamed.length > 0) {
    throw new Error(`proof: INTEGRATION must name .integration.test.ts files only, not ${JSON.stringify(unnamed)}`);
  }

  if (inputs._tag !== "changed") {
    throw new Error("proof: INTEGRATION must be empty when the scope is full");
  }

  const found = new Set(listed(paths));
  const missing = paths.filter((path) => !found.has(path));

  if (missing.length > 0) {
    throw new Error(
      `proof: INTEGRATION must name files vitest lists in next-integration or tooling-integration at this head, not ${JSON.stringify(missing)}`,
    );
  }

  return Inputs.cases.integration.make({ files: paths });
};

/**
 * What the run tests. A named start comes first: its `integration` files alone, on one leg, so one
 * slot, whatever the change touches. Then `triggers` and `scope: full`: a change to a rerun trigger or
 * a hand start for the full set is the full set whatever the import graph says. Else `files`, the set
 * Vitest listed, split by `sizing`, every `.integration.` law it holds included.
 */
export const choose = (seen: Seen, triggers: readonly string[], files: readonly string[], sizing: Sizing): Proof => {
  if (seen.inputs._tag === "integration") {
    const legs = { "1": seen.inputs.files };

    return {
      _tag: "integration",
      base: seen.base,
      head: seen.head,
      at: seen.at,
      vitest: seen.vitest,
      inputs: seen.inputs,
      changed: seen.changed,
      legs,
      seconds: { "1": Math.round(seconds(legs["1"], sizing.table) * 10) / 10 },
    };
  }

  if (triggers.length > 0 || seen.inputs._tag === "full") {
    return {
      _tag: "full",
      base: seen.base,
      head: seen.head,
      at: seen.at,
      vitest: seen.vitest,
      inputs: seen.inputs,
      changed: seen.changed,
      triggers,
    };
  }

  if (files.some((path) => /\s/.test(path))) {
    throw new Error("proof: a test file's path holds a space, so it cannot be one word of a leg's list");
  }

  const legs = legsOf(files, sizing);

  return {
    _tag: "changed",
    base: seen.base,
    head: seen.head,
    at: seen.at,
    vitest: seen.vitest,
    inputs: seen.inputs,
    changed: seen.changed,
    legs,
    seconds: Object.fromEntries(
      Object.entries(legs).map(([leg, list]) => [leg, Math.round(seconds(list, sizing.table) * 10) / 10]),
    ),
  };
};

/**
 * What the select step gives the next jobs: `scope`, `full` or `changed` (a named start is `changed`,
 * so the `changed` job runs its one leg); `legs`, the `changed`
 * job's matrix, a JSON list, `[]` when it starts no leg; and `files`, each leg's files as one line of
 * words, a JSON map by leg; and `slots`, the proof groups rotated by the workflow run number. `count`
 * is how many proof groups there are, MOST and PROOF_SLOTS (the merge line leaves the scheduled job groups).
 */
export const outputs = (proof: Proof, run: number, count: number): string[] => {
  const legs = proof._tag === "full" ? {} : proof.legs;
  const groups = slots(run, count);

  return [
    `scope=${proof._tag === "full" ? "full" : "changed"}`,
    `legs=${JSON.stringify(Object.keys(legs))}`,
    `files=${JSON.stringify(Object.fromEntries(Object.entries(legs).map(([leg, list]) => [leg, list.join(" ")])))}`,
    `slots=${JSON.stringify(groups)}`,
  ];
};

const Positive = Schema.Int.check(Schema.isGreaterThan(0));

/**
 * A full permutation of the `count` proof groups (the merge line leaves the scheduled job groups), turned by the workflow run number, so
 * `count` runs in a row send every leg to every group. A retry keeps its workflow run number.
 */
const slots = (run: number, count: number): Record<string, string> => {
  const parsed = Schema.decodeUnknownResult(Positive)(run);

  if (Result.isFailure(parsed)) {
    throw new Error("proof: RUN_NUMBER must be a positive safe whole number");
  }

  const groups = Schema.decodeUnknownResult(Positive)(count);

  if (Result.isFailure(groups)) {
    throw new Error("proof: MOST must be a positive safe whole number");
  }

  const offset = parsed.success % groups.success;

  return Object.fromEntries(
    Array.from({ length: groups.success }, (_, index) => [
      String(index + 1),
      String(((index + offset) % groups.success) + 1),
    ]),
  );
};

/** The run's summary: what it tests and why, and each leg's files. */
export const summary = (proof: Proof): string => {
  const head = `Proof run at ${proof.head.slice(0, 9)}, against origin/main at ${proof.base.slice(0, 9)} (a branch's proof run runs only the tests its change reaches).`;

  if (proof._tag === "full") {
    const why =
      proof.inputs._tag === "full"
        ? [
            `The full set, chosen by hand (\`scope: full\`) for the law \`${proof.inputs.law}\`: it runs every test but the \`.integration.\` laws, which only main's full run runs.`,
          ]
        : [];

    const triggered =
      proof.triggers.length > 0
        ? [
            "The full set: the change touches a rerun trigger, so it runs every test but the `.integration.` laws, which only main's full run runs.",
            "",
            ...proof.triggers.map((path) => `- \`${path}\``),
          ]
        : [];

    return [head, "", ...why, ...(why.length > 0 && triggered.length > 0 ? [""] : []), ...triggered, ""].join("\n");
  }

  if (proof._tag === "integration") {
    return [
      head,
      "",
      `The named integration laws, chosen by hand (\`integration\`): ${proof.inputs.files.length} files on one leg, about ${proof.seconds["1"] ?? 0} s, and no other test:`,
      "",
      ...proof.inputs.files.map((path) => `- \`${path}\``),
      "",
    ].join("\n");
  }

  const legs = Object.entries(proof.legs);
  const files = legs.reduce((sum, [, list]) => sum + list.length, 0);

  if (legs.length === 0) {
    return [
      head,
      "",
      `The changed set holds no test file: ${proof.changed.length} changed files reach no test, so no leg starts and the run is green. Main's full run tests every file.`,
      "",
    ].join("\n");
  }

  return [
    head,
    "",
    `The changed set: ${files} test files that ${proof.changed.length} changed files reach, on ${legs.length} legs.`,
    "",
    ...legs.flatMap(([leg, list]) => [
      `Leg ${leg}, ${list.length} files, about ${proof.seconds[leg] ?? 0} s:`,
      "",
      ...list.map((path) => `- \`${path}\``),
      "",
    ]),
  ].join("\n");
};

/** A positive whole number from the step's env, or a throw, so the step fails and prints nothing. */
export const whole = (name: string, value: string | undefined): number => {
  const number = Number(value);

  if (value === undefined || value.trim() === "" || !Number.isInteger(number) || number < 1) {
    throw new Error(`proof: ${name} must be a positive whole number, not ${JSON.stringify(value)}`);
  }

  return number;
};

// Under Vitest `import.meta.main` is false, so a test that imports this file never lists or writes.
if (import.meta.main) {
  // The step's variables, read through Effect's Config. An empty variable stays empty, as a read of
  // process.env gave it, so `whole` still refuses an empty MOST, LIMIT or RUN_NUMBER.
  const env = readEnv(
    Config.all({
      most: Config.String("MOST").pipe(Config.withDefault(undefined)),
      limit: Config.String("LIMIT").pipe(Config.withDefault(undefined)),
      run: Config.String("RUN_NUMBER").pipe(Config.withDefault(undefined)),
      record: Config.String("RECORD").pipe(Config.withDefault(undefined)),
      scope: Config.String("SCOPE").pipe(Config.withDefault(undefined)),
      law: Config.String("LAW").pipe(Config.withDefault(undefined)),
      integration: Config.String("INTEGRATION").pipe(Config.withDefault(undefined)),
      ...stepFiles,
    }),
  );

  const run = whole("RUN_NUMBER", env.run);
  const most = whole("MOST", env.most);
  const groups = slots(run, most);
  const root = fileURLToPath(new URL("../../", import.meta.url));

  const git = (args: readonly string[]) => {
    const done = spawnSync("git", args, { cwd: root, encoding: "utf8" });

    if (done.status !== 0) {
      throw new Error(`proof: git ${args.join(" ")} exited ${done.status}: ${done.stderr}`);
    }

    return done.stdout;
  };

  const base = git(["rev-parse", "--verify", "origin/main^{commit}"]).trim();
  const head = git(["rev-parse", "--verify", "HEAD^{commit}"]).trim();

  if (!validSha(base) || !validSha(head)) {
    throw new Error(`proof: no base or head commit (${base}, ${head})`);
  }

  const changed = git(["diff", "--name-only", "-z", `${base}...${head}`])
    .split("\0")
    .filter((path) => path !== "");

  const triggers = triggered(changed, isTrigger);
  const reach = listings(base, changed);

  const lister = (args: readonly string[]) => list(root, args);

  const inputs = integrationOf(
    inputsOf(env.scope, env.law, inProjects(lister)),
    env.integration,
    inIntegration(lister),
  );

  const files =
    triggers.length > 0 || inputs._tag !== "changed"
      ? []
      : withReaders(list(root, reach.reached), reach.readers === null ? [] : list(root, reach.readers));

  const sizing: Sizing = {
    most,
    limit: room(whole("LIMIT", env.limit), E2E_SETUP),
    table: rowsAt("full"),
  };

  const proof = choose(
    { base, head, at: DateTime.formatIso(DateTime.nowUnsafe()), vitest: vitestPackage.version, changed, inputs },
    triggers,
    files,
    sizing,
  );

  const lines = outputs(proof, run, most);
  const said = summary(proof);
  console.log(said);
  console.log(lines.join("\n"));
  const record = env.record;

  if (record !== undefined && record !== "") {
    writeFileSync(record, `${JSON.stringify({ ...proof, slots: groups }, null, 2)}\n`);
  }

  const output = env.output;

  if (output !== undefined && output !== "") {
    appendFileSync(output, `${lines.join("\n")}\n`);
  }

  const step = env.summary;

  if (step !== undefined && step !== "") {
    appendFileSync(step, `${said}\n`);
  }
}
