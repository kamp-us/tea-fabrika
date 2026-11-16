// S9 of docs/plan/quests/port-scripts-0113-PLAN.md: the command line, on both entry points until
// integrator 2's switch. Lead tooling (0033), today's version. exam.py and exam.ts run as processes
// from the top of the repo, on the real exam-paths.json, and both must print `path<TAB>glob` for
// each exam path and exit 1 on any hit, 0 on none ("Keeping the commit path working while it is
// ported"). `TEST_EXAM` names one entry point to run alone, as the leak grep tests' `TEST_LEAKGREP`
// does; the switch drops exam.py from `ENTRIES`.
//
// It starts python3 and node, so it is an `.integration.` file (0584): no stand-in can show what
// the real interpreter prints or which code the process exits with. exam.test.ts holds the same
// rules in process on generated lists.
//
// The answer is commits.ts's matcher, the one the port imports. Its two known differences from
// exam.py (the plan's Findings) are left out of the generated paths, since there the two scripts
// answer apart on purpose until exam.py goes: a path with a control character, and the folder a
// `<folder>/**` row names.
//
// Planted once and restored by copy; the plant is named beside the law.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { runsFor } from "@kampus/vitest";
import { Option } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeExam, examMatcher } from "../../../../next/apps/fabrika/src/exam/commits.ts";

const root = resolve(import.meta.dirname, "../../../..");
const LIST = "exam-paths.json";

const ENTRIES =
  process.env.TEST_EXAM === undefined
    ? [join(import.meta.dirname, "exam.py"), join(import.meta.dirname, "exam.ts")]
    : [process.env.TEST_EXAM];

const rows = Option.getOrElse(decodeExam(readFileSync(join(root, LIST), "utf8")), () => {
  throw new Error("the list did not decode");
});

const stems = new Set(rows.filter((r) => r.glob.endsWith("/**")).map((r) => r.glob.slice(0, -3)));

/** The lines both scripts print for these paths: the first row that takes each. */
const oracle = (paths: ReadonlyArray<string>) =>
  paths.flatMap((path) => {
    const row = rows.find((r) => examMatcher([r])(path));
    return row === undefined ? [] : [`${path}\t${row.glob}\n`];
  });

/** One run of an entry point as a process: its exit code and its stdout. */
const runEntry = (entry: string, paths: ReadonlyArray<string>) => {
  const [command, ...args] = entry.endsWith(".py") ? ["python3", entry] : [process.execPath, entry];
  const ran = spawnSync(command ?? "", [...args, LIST, ...paths], { cwd: root, encoding: "utf8" });
  return { code: ran.status, out: ran.stdout, err: ran.stderr };
};

const seg = fc.stringMatching(/^[a-z0-9._][a-z0-9._-]{0,6}$/);
const name = fc.oneof(fc.constant(""), seg);
const folders = (min: number) => fc.array(seg, { minLength: min, maxLength: 2 });

/** A path a row's glob takes, each wildcard filled. */
const fill = (glob: string) =>
  fc
    .tuple(
      ...glob
        .split(/(\*\*\/|\/\*\*$|\*\*|\*)/)
        .map((piece) =>
          piece === "**/"
            ? folders(0).map((fs) => fs.map((f) => `${f}/`).join(""))
            : piece === "/**"
              ? folders(1).map((fs) => `/${fs.join("/")}`)
              : piece === "**"
                ? folders(0).map((fs) => fs.join("/"))
                : piece === "*"
                  ? name
                  : fc.constant(piece),
        ),
    )
    .map((parts) => parts.join(""));

const taken = fc.constantFrom(...rows.map((r) => r.glob)).chain(fill);

const path = fc
  .oneof(
    { weight: 3, arbitrary: taken },
    { weight: 2, arbitrary: fc.tuple(taken, seg).map(([p, s]) => `${p}${s}`) },
    { weight: 1, arbitrary: fc.tuple(seg, taken).map(([s, p]) => `${s}/${p}`) },
    { weight: 1, arbitrary: folders(1).map((fs) => fs.join("/")) },
  )
  .filter((p) => p !== "" && !p.startsWith("-") && !stems.has(p));

describe.each(ENTRIES.map((entry) => ({ entry, shown: basename(entry) })))("$shown", ({ entry }) => {
  // Plant, run once: exam.ts exited 0 on a hit. Red: the hit case's exit was 0, not 1.
  it("property: prints path<TAB>glob for each exam path and exits 1 on any hit, 0 on none, as a process", () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(fc.array(path, { maxLength: 6 }), (paths) => {
        const want = oracle(paths);
        const got = runEntry(entry, paths);
        expect(got.out, got.err).toBe(want.join(""));
        expect(got.code, got.err).toBe(want.length > 0 ? 1 : 0);
        reached.add(want.length > 0 ? "exit 1" : "exit 0");
      }),
      // The first case is empty, a hit is likely by the second: both exits come up at the fast count.
      { seed: 119120, numRuns: runsFor({ fast: 8, full: 30 }), endOnFailure: true, examples: [[[]], [[LIST]]] },
    );
    expect([...reached].toSorted()).toEqual(["exit 0", "exit 1"]);
  });
});
