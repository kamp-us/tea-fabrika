// Today's CI, serving both versions. What a branch's proof run tests (0590): scheduled.yaml started
// by hand on a branch other than main runs only the tests its change reaches. Its `select` job runs
// this, after an install, and the `changed` job's legs run what it prints.
//
//   the branch's change against origin/main      the run tests
//   touches a file in forceRerunTriggers         the full set, on the `tests` job, as main does
//   reaches some tests                           those, on as many `changed` legs as they need
//   reaches no test                              nothing: the run is green with no test leg
//
// The set is Vitest's own (0040): `vitest list --changed <base>` over every project CI runs (the
// `next`, `next-integration`, `next-visual` and `tooling` projects; today's runs in no CI job, 0533),
// the import graph `--changed` walks, with the files vitest.config.ts hands it as watched files. A
// next/ change adds the reader tests too (changes.mjs's `readers`), as the merge line does: they read
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
// The run keeps what it tested as its `proof-set` artifact and in its summary: the base commit, the
// head, git's changed files, each leg's files and seconds, and when. origin/main moves on, so the set
// cannot be worked out again later.
import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Match } from "effect";
import vitestPackage from "vitest/package.json" with { type: "json" };
import { testConfig } from "../../vitest.config.ts";
import { rowsAt } from "../../vitest.shards.ts";
import { readers, validSha } from "./changes.mjs";
import { E2E_SETUP, fewest, list, room, seconds, split, withReaders } from "./legs.ts";

/** The projects a proof run lists and runs: every one CI runs, today's left out (0533). */
export const PROJECTS = ["next", "next-integration", "next-visual", "tooling"] as const;

/** What the proof run tests, and the facts it was chosen from. */
export type Proof =
  | {
      readonly _tag: "full";
      readonly base: string;
      readonly head: string;
      readonly at: string;
      readonly vitest: string;
      /** The changed files that match a rerun trigger. */
      readonly triggers: readonly string[];
    }
  | {
      readonly _tag: "changed";
      readonly base: string;
      readonly head: string;
      readonly at: string;
      readonly vitest: string;
      /** git's changed files, base to head. */
      readonly changed: readonly string[];
      /** Each leg's test files, by the leg's name: `"1"` to `"N"`. No leg for a set of zero files. */
      readonly legs: Readonly<Record<string, readonly string[]>>;
      /** Each leg's measured seconds, a file with no row at the table's median. */
      readonly seconds: Readonly<Record<string, number>>;
    };

/** What the select step read: the commits, git's changed files, and when. */
export type Seen = {
  readonly base: string;
  readonly head: string;
  readonly at: string;
  readonly vitest: string;
  readonly changed: readonly string[];
};

/** How a changed set is split: the most legs at once, and the seconds one leg's files may take. */
export type Sizing = {
  readonly most: number;
  readonly limit: number;
  readonly table: Readonly<Record<string, number>>;
};

// vitest.config.ts's own match: Vitest's installed picomatch, with dot files.
const match = createRequire(import.meta.resolve("vitest/package.json"))("picomatch");

/** Whether a path from the repo's top is one of vitest.config.ts's rerun triggers, as Vitest matches them. */
export const isTrigger = (path: string): boolean =>
  match.isMatch(path, testConfig.test.forceRerunTriggers, { dot: true });

/** The changed files that match a rerun trigger, in git's order. */
export const triggered = (changed: readonly string[], isTrigger: (path: string) => boolean): string[] =>
  changed.filter(isTrigger);

/** The changed set split into legs `"1"` to `"N"`, the fewest that fit, as `Sizing` says. */
export const legsOf = (files: readonly string[], sizing: Sizing): Record<string, string[]> => {
  const count = fewest(files, sizing.most, sizing.limit, sizing.table);

  return Object.fromEntries(split(files, count, sizing.table).map((leg, i) => [`${i + 1}`, leg]));
};

/**
 * What the run tests. `triggers` comes first: a change to a rerun trigger is the full set whatever
 * the import graph says. Else `files`, the set Vitest listed, split by `sizing`.
 */
export const choose = (seen: Seen, triggers: readonly string[], files: readonly string[], sizing: Sizing): Proof => {
  if (triggers.length > 0) {
    return { _tag: "full", base: seen.base, head: seen.head, at: seen.at, vitest: seen.vitest, triggers };
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
 * words, a JSON map by leg.
 */
export const outputs = (proof: Proof): string[] => {
  const legs: Readonly<Record<string, readonly string[]>> = Match.valueTags(proof, {
    changed: (changed) => changed.legs,
    full: () => ({}),
  });

  return [
    `scope=${proof._tag}`,
    `legs=${JSON.stringify(Object.keys(legs))}`,
    `files=${JSON.stringify(Object.fromEntries(Object.entries(legs).map(([leg, list]) => [leg, list.join(" ")])))}`,
  ];
};

/** The run's summary: what it tests and why, and each leg's files. */
export const summary = (proof: Proof): string => {
  const head = `Proof run at ${proof.head.slice(0, 9)}, against origin/main at ${proof.base.slice(0, 9)} (decision 0590).`;

  return Match.valueTags(proof, {
    full: (full) =>
      [
        head,
        "",
        "The full set: the change touches a rerun trigger, so it runs every test, as main's full run does.",
        "",
        ...full.triggers.map((path) => `- \`${path}\``),
        "",
      ].join("\n"),
    changed: (changed) => changedSummary(head, changed),
  });
};

/** The summary of a changed set: how many files reach which legs, and each leg's files. */
const changedSummary = (head: string, proof: Extract<Proof, { readonly _tag: "changed" }>): string => {
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
  const projects = PROJECTS.flatMap((project) => ["--project", project]);

  const files =
    triggers.length > 0
      ? []
      : withReaders(
          list(root, [...projects, `--changed=${base}`]),
          changed.some((path) => path.startsWith("next/"))
            ? list(root, ["--project", "next", "--project", "next-integration", ...readers])
            : [],
        );

  const sizing: Sizing = {
    most: whole("MOST", process.env["MOST"]),
    limit: room(whole("LIMIT", process.env["LIMIT"]), E2E_SETUP),
    table: rowsAt("full"),
  };

  const proof = choose(
    { base, head, at: new Date().toISOString(), vitest: vitestPackage.version, changed },
    triggers,
    files,
    sizing,
  );

  const lines = outputs(proof);
  const said = summary(proof);
  console.log(said);
  console.log(lines.join("\n"));
  const record = process.env["RECORD"];

  if (record !== undefined && record !== "") {
    writeFileSync(record, `${JSON.stringify(proof, null, 2)}\n`);
  }

  const output = process.env["GITHUB_OUTPUT"];

  if (output !== undefined && output !== "") {
    appendFileSync(output, `${lines.join("\n")}\n`);
  }

  const step = process.env["GITHUB_STEP_SUMMARY"];

  if (step !== undefined && step !== "") {
    appendFileSync(step, `${said}\n`);
  }
}
