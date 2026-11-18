// Today's CI, serving both versions. What a branch's proof run tests (0590): scheduled.yaml started
// by hand on a branch other than main runs only the tests its change reaches. Its `select` job runs
// this, after an install, and the `changed` job's legs run what it prints.
//
//   the branch's change against origin/main      the run tests
//   touches a file in forceRerunTriggers         the full set, on the `tests` job, as main does,
//                                                less every `.integration.` law (0602)
//   is started with `scope: full` for a `law`     the full set too, and the record keeps the inputs
//   reaches some tests                           those, on as many `changed` legs as they need
//   reaches no test                              nothing: the run is green with no test leg
//
// The set is Vitest's own (0040): `vitest list --changed <base>` over the `next`, `next-visual` and
// `tooling` projects, the import graph `--changed` walks, with the files vitest.config.ts hands it as
// watched files. The `.integration.` laws, `next-integration`'s and `tooling-integration`'s, run
// only on main's full run (0602), so a proof run lists none of them, even one its change reaches,
// and `choose` drops any name a list still gives; today's run in no CI job (0533). A next/ change
// adds the in-memory reader tests too (changes.mjs's `readers`), as the merge line does: they read
// next/'s source as text, so the import graph cannot reach them, and making each file they read a
// rerun trigger would make every next/ change run everything.
//
// Rerun triggers are checked here on git's own diff, before Vitest's narrowing of the lockfile and
// the manifests (vitest.changed.ts): a change to any of them runs the full set (0590), as Vitest's own
// `filterTestsBySource` does when a changed file matches `forceRerunTriggers` (Vitest 5.0.5,
// dist/chunks/cli-api.De07GUeT.js). The match is vitest.config.ts's: Vitest's installed picomatch,
// with `dot: true`, over `testConfig`'s triggers.
//
// A changed set of zero files is a green run with no test leg, and its record says so: the lead asked
// for a proof of this head, the set Vitest gave is that proof, and main's full run, every test on
// every push (0581), stays the net for a miss. Ending the run with no verdict would leave arm with
// nothing to read at the head, the same as no run at all.
//
// Legs are sized from the full-depth seconds the schedule measured (vitest.shards.ts's `rowsAt`), the
// fewest whose longest share fits half a leg's test step limit less an end-to-end leg's setup, as
// legs.ts sizes the merge line's, up to the matrix's `max-parallel`. Each leg runs exactly its list.
//
// A hand start says what it wants as `scope` (scheduled.yaml's input, `changed` unless a person says
// `full`) and, for `full`, the `law`: the test file that needs the full set. This script holds both
// to the rules in `inputsOf` and has no default of its own, so the workflow's input is the one place a
// default is declared (0069). `scope: changed` does not override a rerun trigger: 0590 stands.
//
// The run keeps what it tested as its `proof-set` artifact and in its summary: the base commit, the
// head, git's changed files, the inputs, each leg's files and seconds, and when. origin/main moves on,
// so the set cannot be worked out again later.
import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Config, DateTime, Result, Schema } from "effect";
import vitestPackage from "vitest/package.json" with { type: "json" };
import { isIntegration } from "../../oxlint-plugins/test-names.ts";
import { rowsAt } from "../../vitest.shards.ts";
import { readers, validSha } from "./changes.mjs";
import { E2E_SETUP, fewest, isTrigger, list, room, seconds, split, withReaders } from "./legs.ts";
import { readEnv, stepFiles } from "./step-env.ts";

export { isTrigger };

/**
 * The projects a proof run lists and runs: every one CI runs but `next-integration` and
 * `tooling-integration`, which only main's full run runs (0602), and today's left out (0533).
 */
export const PROJECTS = ["next", "next-visual", "tooling"] as const;

/** The `--project` flags of `projects`, in their order. */
const flags = (projects: readonly string[]) => projects.flatMap((project) => ["--project", project]);

/**
 * The `vitest list` calls a changed set is read from: `reached`, the tests the change reaches
 * against `base` over PROJECTS, and `readers`, the in-memory reader tests, asked for only when the
 * change touches next/ (`null` otherwise). Neither names an integration project (0602).
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
      readonly inputs: Inputs;
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
    };

/** The hand start's `scope` input, as scheduled.yaml gives it (0590). */
const ScopeInput = Schema.Literals(["changed", "full"]);

/** The hand start's inputs, decoded: `full` carries the `law` that needs the full set. */
export const Inputs = Schema.TaggedUnion({ changed: {}, full: { law: Schema.String } });

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

/** Whether `vitest list` over the proof's projects gives back exactly `path`, by `lister`. */
export const inProjects =
  (lister: (args: readonly string[]) => readonly string[]) =>
  (path: string): boolean =>
    lister([...PROJECTS.flatMap((project) => ["--project", project]), path]).includes(path);

/**
 * What the run tests. `triggers` come first, and so does `scope: full`: a change to a rerun trigger or
 * a hand start for the full set is the full set whatever the import graph says. Else `files`, the set
 * Vitest listed, split by `sizing`, less every `.integration.` law, of next/ or of tooling: only
 * main's full run runs those (0602). PROJECTS already lists none of them; the name holds them out
 * whatever a list gives.
 */
export const choose = (seen: Seen, triggers: readonly string[], files: readonly string[], sizing: Sizing): Proof => {
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

  const legs = legsOf(
    files.filter((path) => !isIntegration(path)),
    sizing,
  );

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
 * What the select step gives the next jobs: `scope`, `full` or `changed`; `legs`, the `changed`
 * job's matrix, a JSON list, `[]` when it starts no leg; and `files`, each leg's files as one line of
 * words, a JSON map by leg; and `slots`, the proof groups rotated by the workflow run number. `count`
 * is how many proof groups there are, MOST and PROOF_SLOTS (0598).
 */
export const outputs = (proof: Proof, run: number, count: number): string[] => {
  const legs = proof._tag === "changed" ? proof.legs : {};
  const groups = slots(run, count);

  return [
    `scope=${proof._tag}`,
    `legs=${JSON.stringify(Object.keys(legs))}`,
    `files=${JSON.stringify(Object.fromEntries(Object.entries(legs).map(([leg, list]) => [leg, list.join(" ")])))}`,
    `slots=${JSON.stringify(groups)}`,
  ];
};

const Positive = Schema.Int.check(Schema.isGreaterThan(0));

/**
 * A full permutation of the `count` proof groups (0598), turned by the workflow run number, so
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
  const head = `Proof run at ${proof.head.slice(0, 9)}, against origin/main at ${proof.base.slice(0, 9)} (decision 0590).`;

  if (proof._tag === "full") {
    const why =
      proof.inputs._tag === "full"
        ? [
            `The full set, chosen by hand (\`scope: full\`) for the law \`${proof.inputs.law}\`: it runs every test but the \`.integration.\` laws, which only main's full run runs (decision 0602).`,
          ]
        : [];

    const triggered =
      proof.triggers.length > 0
        ? [
            "The full set: the change touches a rerun trigger, so it runs every test but the `.integration.` laws, which only main's full run runs (decision 0602).",
            "",
            ...proof.triggers.map((path) => `- \`${path}\``),
          ]
        : [];

    return [head, "", ...why, ...(why.length > 0 && triggered.length > 0 ? [""] : []), ...triggered, ""].join("\n");
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

  const inputs = inputsOf(
    env.scope,
    env.law,
    inProjects((args) => list(root, args)),
  );

  const files =
    triggers.length > 0 || inputs._tag === "full"
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
