import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
// K1 to K5: what the package's own files say. It stands alone (decision on small libraries usable alone):
// it names no other package of this repository, it has no dependencies, and no file in it names the repository. K5 holds its
// code free of a fixed limit: every limit is a setting.
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import manifest from "../package.json" with { type: "json" };
import * as HistoryTest from "./HistoryTest.ts";
import * as RepositoryTest from "./RepositoryTest.ts";

const Manifest = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.Record(Schema.String, Schema.String),
  peerDependencies: Schema.Record(Schema.String, Schema.String),
  peerDependenciesMeta: Schema.Record(Schema.String, Schema.Struct({ optional: Schema.Boolean })),
  exports: Schema.Record(Schema.String, Schema.String),
});

// The names are written in two halves so this file does not hold them whole.
const OTHERS = [`@kal${"fa"}/`, `@kam${"pus"}/`, `@tea-fab${"rika"}/`];

const EXPORTS = [
  "./CommitId",
  "./Ref",
  "./Commit",
  "./Tree",
  "./Diff",
  "./Settings",
  "./Repository",
  "./MergeCommit",
  "./CommitEdit",
  "./memory",
  "./process",
  "./test",
  "./test/History",
  "./package.json",
];

// Plant: add a package of the repository (the shared test package) to the dev dependencies; add the npm package `diff` to
// `dependencies`; leave `./Diff` or `./CommitEdit` out of the exports; export `./internal/object`; point `./MergeCommit` at a file that is not there.
it("K1 scenario: the manifest names no workspace package, has no dependencies, exports exactly the plan's list, and each export is a file", () => {
  const parsed = Schema.decodeUnknownSync(Manifest)(manifest);

  const names = [
    ...Object.keys(parsed.devDependencies),
    ...Object.keys(parsed.peerDependencies),
    ...Object.keys(parsed.dependencies ?? {}),
  ];

  expect(
    names.filter((name) => OTHERS.some((other) => name.startsWith(other))),
    "no package of this repository",
  ).toEqual([]);
  expect(parsed.dependencies, "no dependencies").toBeUndefined();

  const optional = Object.entries(parsed.peerDependenciesMeta)
    .filter(([, meta]) => meta.optional)
    .map(([name]) => name);

  expect(
    Object.keys(parsed.peerDependencies).filter((name) => !optional.includes(name)),
    "effect is the one required peer",
  ).toEqual(["effect"]);
  expect([...optional].sort(), "the test tools are optional peers").toEqual(["@effect/vitest", "vitest"]);
  expect(Object.keys(parsed.exports).sort()).toEqual([...EXPORTS].sort());

  for (const [name, target] of Object.entries(parsed.exports)) {
    expect(
      existsSync(fileURLToPath(new URL(target, new URL("../", import.meta.url)))),
      `${name} is the file ${target}`,
    ).toBe(true);
  }
});

const WORDS = [`fab${"rika"}`, `kam${"pus"}`, `kamp-${"us"}`, `.kal${"fa/"}`];

const filesUnder = (root: URL): ReadonlyArray<string> =>
  readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((path) => !path.split("/").includes("node_modules"))
    .map((path) => fileURLToPath(new URL(path, root)))
    .filter((path) => statSync(path).isFile());

// Plant: write the repository's own name in the README.
it("K2 scenario: no file of the package names this repository or its records, in any letter case", () => {
  const files = filesUnder(new URL("../", import.meta.url));
  expect(files.length, "the package has files").toBeGreaterThan(5);

  for (const file of files) {
    const text = readFileSync(file, "utf8").toLowerCase();

    for (const word of WORDS) {
      expect(text.includes(word), `${file} names ${word}`).toBe(false);
    }
  }
});

// The word for a human being, written in two halves so this file does not hold it whole.
const NOT_A_SIGNATURE = `Per${"son"}`;

// Plant: name a test type for a human being again.
it("K3 scenario: no file of the package names a signature for a human being; the glossary's word is Signature", () => {
  const files = filesUnder(new URL("../", import.meta.url));

  for (const file of files) {
    expect(readFileSync(file, "utf8").includes(NOT_A_SIGNATURE), `${file} holds the word`).toBe(false);
  }
});

// Plant: export one more helper from either entry.
it("K4 scenario: the public test entries export only what a caller needs", () => {
  expect(Object.keys(RepositoryTest).sort(), "/test").toEqual(["settings", "suite"]);
  expect(Object.keys(HistoryTest).sort(), "/test/History").toEqual(["shapes", "textureArb"]);
});

// What K5 leaves out: a test names a time on purpose, the two test layers hold test settings, and `Settings.ts` is where limits are named.
const NOT_SCANNED = /(?:\.test\.ts|\.test-support\.ts)$|^(?:RepositoryTest|HistoryTest|Settings)\.ts$/;

const UNITS = "nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?";

// `Duration.seconds(5)`, with any space around the dot or before the parenthesis.
const DURATION_CALL = /Duration\s*\.\s*(?:nanos|micros|millis|seconds|minutes|hours|days|weeks)\s*\(/;

// A unit as a quoted word, with an amount or without: `"5 seconds"`, and the `"seconds"` of `[5, "seconds"]`.
const DURATION_TEXT = new RegExp(`["'\`]\\s*(?:\\d[\\d_.]*\\s*)?(?:${UNITS})\\s*["'\`]`);

// A number written out, or a sum or product of numbers: `5000`, `10_000`, `5 * 1000`.
const NUMBER = String.raw`\d[\d_.]*(?:\s*[-+*/%]\s*\(?\s*\d[\d_.]*\s*\)?)*`;

// A top-level constant of any case, annotated or not, that is only a number: `const KILL_AFTER: Duration.Input = 5000;`.
// It starts at the line's first column, so an indented `const first = 0;` inside a function is not a limit and is not read.
const COUNT_CONSTANT = new RegExp(
  String.raw`^(?:export )?const (\w+)\s*(?::[^=\n]+)?=\s*\(?\s*${NUMBER}\s*\)?\s*;`,
  "gm",
);

// A name that says it is a length of time or a wait, given a number: `forceKillAfter: 5000`, `duration: 10_000`, `timeout = 30`.
// A bare `time` is not here: `{ time: 0 }` is a commit's timestamp, a point in time and not a length. `waitTime: 5` is.
const TIME_KEY = new RegExp(
  String.raw`\b\w*(?:killafter|duration|timeout|delay|interval|wait|deadline|ttl|after|\w+time|${UNITS.replaceAll("?", "")})\s*[:=]\s*\(?\s*${NUMBER}\s*\)?\s*(?=[,;)}\n])`,
  "i",
);

// Each is git's own rule or git's own fixed format, not a limit an app could choose: how far into a file git looks for a NUL
// to call it binary, and how much of a printed row a parser reads.
const GIT_OWN = ["BINARY_WINDOW", "HEADER_BYTES", "HEAD_BYTES"];

// Plant: put `const KILL_AFTER = Duration.seconds(5);` back in `ProcessRepository.ts`; write `forceKillAfter: "5 seconds"`
// there; and each of `forceKillAfter: 5000`, `const KILL_AFTER: Duration.Input = 5000;`, `const killAfter = 5000;`,
// `const KILL_AFTER = 5 * 1000;`, `[5, "seconds"]`, `Duration.seconds (5)` and `duration: 10_000`; add `const MOST_PATHS = 1000;` to `internal/lookup.ts` and scan only the top folder, so the scanned-list check fails it;
// remove `BINARY_WINDOW` from `internal/lines.ts` and keep it allowed, so "found exactly once" fails it.
it("K5 scenario: no code of the package holds a fixed duration or a fixed number as a limit, except git's own three constants", () => {
  const root = new URL("./", import.meta.url);

  const scanned = filesUnder(root)
    .map((file) => relative(fileURLToPath(root), file))
    .filter((file) => file.endsWith(".ts") && !NOT_SCANNED.test(file));

  expect(scanned, "the scan reads the adapters and a folder below").toEqual(
    expect.arrayContaining([
      "ProcessRepository.ts",
      "MemoryRepository.ts",
      "internal/parse.ts",
      "internal/lines.ts",
      "internal/lookup.ts",
    ]),
  );

  const found: Array<string> = [];

  for (const file of scanned) {
    const text = readFileSync(new URL(file, root), "utf8");
    expect(DURATION_CALL.test(text), `${file} builds a fixed duration`).toBe(false);
    expect(DURATION_TEXT.test(text), `${file} writes a fixed duration as text`).toBe(false);
    expect(TIME_KEY.exec(text)?.[0], `${file} gives a time or wait a number`).toBeUndefined();

    for (const [, name] of text.matchAll(COUNT_CONSTANT)) {
      found.push(name ?? "");
    }
  }

  expect(found.toSorted(), "each constant that is a number is git's own, found once").toEqual(GIT_OWN.toSorted());
});

// Plant: widen `COUNT_CONSTANT` back to `^[ \t]*`: the function-local `const first = 0;` is found, red. Widen `TIME_KEY` back to a bare
// `time`: `{ time: 0 }` is found, red. Drop `after` and `killafter` from `TIME_KEY`: `forceKillAfter: 5000` is not found, red; drop `\w+time`: `waitTime: 5` is not found, red.
it("K5 vector: a number kept inside a function or as a timestamp is not a limit, and every spelling of a fixed limit stays caught", () => {
  const constants = (text: string) => [...text.matchAll(COUNT_CONSTANT)].map(([, name]) => name);

  for (const local of [
    "const f = () => {\n  const first = 0;\n  return first;\n};",
    "export const walk = () => {\n    const start = 1;\n};",
    "const g = () => {\n\tconst last = 5 * 1000;\n};",
  ]) {
    expect(constants(local), local).toEqual([]);
  }

  expect(TIME_KEY.exec("const sig = { name, email, time: 0, offset: 0 };")?.[0]).toBeUndefined();

  for (const [text, name] of [
    ["const KILL_AFTER: Duration.Input = 5000;", "KILL_AFTER"],
    ["const killAfter = 5000;", "killAfter"],
    ["const KILL_AFTER = 5 * 1000;", "KILL_AFTER"],
    ["export const MOST_PATHS = 1000;", "MOST_PATHS"],
    ["const f = () => {\n  const first = 0;\n};\nconst LIMIT = 10_000;", "LIMIT"],
  ] as const) {
    expect(constants(text), text).toEqual([name]);
  }

  for (const text of [
    "forceKillAfter: 5000,",
    "duration: 10_000,",
    "timeout = 30;",
    "{ waitTime: 5 }",
    "{ seconds: 5 }",
  ]) {
    expect(TIME_KEY.exec(text)?.[0], text).toBeDefined();
  }
});
