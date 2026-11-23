import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  changedChecks,
  choose,
  DEFAULT_CAP,
  flaky,
  GITHUB_FAILED,
  KINDS,
  type Kind,
  lintable,
  merges,
  type Outcome,
  type Probe,
  type Refusal,
  capFrom,
  readCheck,
  readLint,
  readScope,
  readSigned,
  Replay,
  replayAll,
  report,
  settled,
  scopeDriver,
  signedDriver,
  signedRefusal,
  type Target,
} from "./replay.ts";

// Today's tooling (ticket 1302). The probe is the one place replay reads git and GitHub, so every law here
// gives replayAll a probe that answers from generated sets: the laws are about what replay does with what
// the checks said. The real read of land.ts is the proof run by hand, quoted in the pull request.

const LEAD = ".agents/skills/lead/scripts/";

const word = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/);

/** A path that is no check: a doc, a product file in next/, a test of a check. */
const noCheck = fc.oneof(
  word.map((w) => `docs/${w}.md`),
  word.map((w) => `next/apps/${w}/src/${w}.ts`),
  fc.constantFrom(
    "README.md",
    "AGENTS.md",
    `${LEAD}land.test.ts`,
    `${LEAD}pr/Queue.test.ts`,
    `${LEAD}pr/PullRequestsTest.ts`,
    ".agents/skills/lead/SKILL.md",
    "oxlint-plugins/no-of.test.ts",
    ".github/ci/slow-test-reporter.test.ts",
    ".agents/skills/mutation/scripts/survivors.test.ts",
  ),
);

/** One path of each kind of check, by the kind's id. */
const checkPaths = [
  [`${LEAD}land.ts`, "land"],
  [`${LEAD}pr/Queue.ts`, "land"],
  [`${LEAD}pr/Arm.ts`, "land"],
  [`${LEAD}leakgrep.sh`, "land"],
  [".agents/skills/step-commit/scripts/stepcommit.sh", "stepcommit"],
  [".agents/skills/mutation/scripts/survivors.ts", "survivors"],
  [".agents/skills/mutation/scripts/scope.ts", "survivors"],
  ["oxlint-plugins/no-of.ts", "oxlint"],
  ["oxlint-plugins/index.ts", "oxlint"],
  [".github/ci/slow-test-reporter.ts", "reporters"],
  ["vitest.hostrun.ts", "reporters"],
  ["oxlint-plugins/css-support.ts", "oxlint"],
  ["oxlint-plugins/README.md", "oxlint"],
  [".agents/skills/mutation/scripts/run.sh", "survivors"],
  [".agents/skills/step-commit/scripts/exam.py", "stepcommit"],
  [`${LEAD}ci/ChecksGh.ts`, "land"],
  [".github/ci/gate.mjs", "gates"],
  [".github/ci/required.mjs", "gates"],
  [".github/workflows/check.yaml", "gates"],
] as const;

const landPath = fc.constantFrom(...checkPaths.filter(([, id]) => id === "land").map(([p]) => p));

const target = (number: number): Target => ({
  number,
  oid: "a".repeat(40),
  state: "OPEN",
  tree: "b".repeat(40),
  files: [],
});

const targets = fc
  .uniqueArray(fc.integer({ min: 1, max: 9999 }), { minLength: 1, maxLength: 5 })
  .map((ns) => ns.map(target));

const reasons = fc.constantFrom("not signed", "no names", "leak", "ticket closed");

/** Every refusal a pull request may be given, from a small pool, so a head and a base share some. */
const refusalsFor = (pr: number): ReadonlyArray<Refusal> =>
  [0, 1, 2].map((i) => ({ pr, check: `land check: c${i}`, reason: `reason ${i}` }));

/** A few pull requests, with what the head and the base each refuse on every one. */
const world = targets.chain((ts) =>
  fc.record({
    ts: fc.constant(ts),
    heads: fc.tuple(...ts.map((t) => fc.subarray([...refusalsFor(t.number)]))),
    bases: fc.tuple(...ts.map((t) => fc.subarray([...refusalsFor(t.number)]))),
  }),
);

/** A probe that answers from what each target's head and base give; it counts each call. */
const probing = (given: ReadonlyMap<number, Readonly<Record<"head" | "base", ReadonlyArray<Refusal>>>>) => {
  const calls: Array<string> = [];

  const probe: Probe = (kind, version, t) =>
    Effect.sync(() => {
      calls.push(`${kind.id}:${version}:${t.number}`);

      return { refusals: given.get(t.number)?.[version] ?? [], unreadable: [] } satisfies Outcome;
    });

  return { probe, calls };
};

const ran = <A>(law: Effect.Effect<A>) =>
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
  Effect.runPromise(law);

const land = (): Kind => {
  const kind = KINDS.find((k) => k.id === "land");

  if (kind === undefined) {
    throw new Error("no land kind");
  }

  return kind;
};

describe("changedChecks", () => {
  it("a diff that touches land.ts names the land checks, whatever else it holds", () =>
    fc.assert(
      fc.property(landPath, fc.array(fc.oneof(noCheck, landPath)), (path, rest) => {
        const ids = changedChecks([...rest, path]).map((k) => k.id);
        expect(ids).toContain("land");
      }),
    ));

  it("a diff of docs, product files and a check's own tests names no check", () =>
    fc.assert(
      fc.property(fc.array(noCheck), (paths) => {
        expect(changedChecks(paths)).toEqual([]);
      }),
    ));

  it("each kind of check is named by its own files, and by no other kind", () =>
    fc.assert(
      fc.property(fc.constantFrom(...checkPaths), ([path, id]) => {
        expect(changedChecks([path]).map((k) => k.id)).toEqual([id]);
      }),
    ));

  it("names each kind once, in a fixed order, however the paths come", () =>
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...checkPaths.map(([p]) => p))), (paths) => {
        const ids = changedChecks(paths).map((k) => k.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual(KINDS.map((k) => k.id).filter((id) => ids.includes(id)));
      }),
    ));
});

describe("a check's folder", () => {
  // Every folder a check keeps its files in, with the kind it makes; reporters share .github/ci with the gates, told by name.
  const folders = [
    [`${LEAD}pr/`, "land"],
    [`${LEAD}ci/`, "land"],
    [".agents/skills/step-commit/scripts/", "stepcommit"],
    [".agents/skills/mutation/scripts/", "survivors"],
    ["oxlint-plugins/", "oxlint"],
    [".github/ci/", "gates"],
  ] as const;

  const kept = fc.tuple(fc.constantFrom(...folders), word, fc.constantFrom("ts", "mjs", "sh", "py", "md", "json"));

  it("every file in it that is no test, test helper or fixture names its check", () =>
    fc.assert(
      fc.property(kept, ([[folder, id], name, ext]) => {
        fc.pre(!(folder === ".github/ci/" && ext === "ts" && name.endsWith("reporter")));
        expect(changedChecks([`${folder}${name}.${ext}`]).map((k) => k.id)).toEqual([id]);
      }),
    ));

  it("a test, a test-support file, a helper or a fixture in it names no check", () =>
    fc.assert(
      fc.property(
        fc.constantFrom(...folders),
        word,
        fc.constantFrom(
          "{n}.test.ts",
          "{n}.test-support.ts",
          "{n}.integration.test.ts",
          "test-helpers/{n}.ts",
          "fixtures/{n}.ts",
        ),
        ([folder], name, shape) => {
          expect(changedChecks([`${folder}${shape.replaceAll("{n}", name)}`])).toEqual([]);
        },
      ),
    ));
});

describe("--check", () => {
  const touched = fc.subarray([...KINDS], { minLength: 1 });
  const ids = fc.subarray(KINDS.map((k) => k.id));

  it("keeps the kinds it names and leaves out the rest: none lost, none twice", () =>
    fc.assert(
      fc.property(touched, ids, (kinds, only) => {
        const { run, leftOut } = choose(kinds, only);
        expect([...run, ...leftOut].map((k) => k.id).sort()).toEqual(kinds.map((k) => k.id).sort());
        expect(run.filter((k) => leftOut.includes(k))).toEqual([]);
        expect(run.every((k) => only.length === 0 || only.includes(k.id))).toBe(true);
        expect(leftOut.length === 0 || only.length > 0).toBe(true);
      }),
    ));

  it("each kind it leaves out is a `not replayed (left out by --check)` line, and no run fails for it", () =>
    fc.assert(
      fc.asyncProperty(touched, targets, (kinds, ts) =>
        ran(
          Effect.gen(function* () {
            const { run, leftOut } = choose(kinds, [kinds[0]?.id ?? ""]);
            const replayed = yield* replayAll({ kinds: run, targets: ts, probe: probing(new Map()).probe, leftOut });
            const said = report({ ...replayed, targets: ts.length });

            for (const kind of leftOut) {
              expect(said.lines).toContain(`not replayed (left out by --check): ${kind.label}`);
            }

            expect(said.code).toBe(0);
          }),
        ),
      ),
    ));
});

describe("GitHub's trouble", () => {
  const trouble = fc.constantFrom(
    "gh api --paginate exited 1: gh: Server Error (HTTP 502)",
    "gh pr view exited 1: HTTP 503: Service Unavailable",
    "gh api graphql exited 1: API rate limit exceeded",
    "gh pr view exited 1: Could not resolve host: api.github.com",
  );

  const line = (check: string, cause: string) => `land: refused at the ${check} check: pr 1: ${cause}\n`;

  it("a failed `gh` read inside a refusal is listed as not read, never a refusal of the pull request", () =>
    fc.assert(
      fc.property(
        fc.integer({ min: 1 }),
        fc.constantFrom("body", "leak", "queue", "check"),
        trouble,
        (pr, at, cause) => {
          const read = readCheck(pr, 1, line(at, cause));
          expect(read.refusals).toEqual([]);
          expect(read.unreadable).toHaveLength(1);
          expect(flaky(read)).toBe(true);
        },
      ),
    ));

  it("a refusal that names no `gh` failure is a refusal, and not tried again", () =>
    fc.assert(
      fc.property(fc.integer({ min: 1 }), fc.constantFrom("body", "leak"), reasons, (pr, at, cause) => {
        const read = readCheck(pr, 1, line(at, cause));
        expect(read.refusals).toHaveLength(1);
        expect(flaky(read)).toBe(false);
      }),
    ));

  const failing = (times: number) => {
    const calls: Array<number> = [];

    const probe: Probe = () =>
      Effect.sync(() => {
        calls.push(calls.length);

        return calls.length <= times
          ? ({ refusals: [], unreadable: [`${GITHUB_FAILED}HTTP 502`] } satisfies Outcome)
          : ({ refusals: [], unreadable: [] } satisfies Outcome);
      });

    return { probe, calls };
  };

  it("a probe is tried again while GitHub fails, up to the retries, and the last answer stands", () =>
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 5 }), (times, again) =>
        ran(
          Effect.gen(function* () {
            const { probe, calls } = failing(times);
            const got = yield* settled(probe, again, 0)(land(), "head", target(1));
            expect(calls).toHaveLength(Math.min(times, again) + 1);
            expect(flaky(got)).toBe(times > again);
            expect(got.refusals).toEqual([]);
          }),
        ),
      ),
    ));
});

describe("the files cap", () => {
  // Pinned: the flag's default is the cap survivors.ts itself holds, so a run with no flag replays the real gate.
  it("pinned: the default of --cap is the MUTATE_FILES default of survivors.ts", () => {
    const source = readFileSync(join(import.meta.dirname, "../../mutation/scripts/survivors.ts"), "utf8");
    expect(capFrom(source)).toBe(DEFAULT_CAP);
  });
});

describe("the verdict", () => {
  it("exits 1 exactly when the head gives a refusal the base does not, and marks each one", () =>
    fc.assert(
      fc.asyncProperty(fc.record({ world }), ({ world: { ts, heads, bases } }) =>
        ran(
          Effect.gen(function* () {
            const given = new Map(
              ts.map((t, i) => [t.number, { head: heads[i] ?? [], base: bases[i] ?? [] }] as const),
            );

            const replayed = yield* replayAll({ kinds: [land()], targets: ts, probe: probing(given).probe });
            const said = report({ ...replayed, targets: ts.length });

            const fresh = ts.flatMap((_t, i) =>
              (heads[i] ?? []).filter(
                (r) => !(bases[i] ?? []).some((b) => b.check === r.check && b.reason === r.reason),
              ),
            );

            expect(said.code).toBe(fresh.length > 0 ? 1 : 0);
            expect(replayed.found.filter((f) => f.fresh).length).toBe(fresh.length);
            expect(replayed.found.length).toBe(heads.flat().length);
            expect(said.lines.filter((l) => l.startsWith("refused:") && l.includes(" new: ")).length).toBe(
              fresh.length,
            );
          }),
        ),
      ),
    ));

  it("a refusal the base gives too is listed as also on main and never fails the replay", () =>
    fc.assert(
      fc.asyncProperty(fc.record({ ts: targets }), ({ ts }) =>
        ran(
          Effect.gen(function* () {
            const given = new Map(
              ts.map(
                (t, i) =>
                  [
                    t.number,
                    { head: refusalsFor(t.number).slice(0, 1 + (i % 3)), base: refusalsFor(t.number) },
                  ] as const,
              ),
            );

            const replayed = yield* replayAll({ kinds: [land()], targets: ts, probe: probing(given).probe });
            const said = report({ ...replayed, targets: ts.length });

            expect(said.code).toBe(0);
            expect(replayed.found.length).toBeGreaterThan(0);
            expect(said.lines.filter((l) => l.startsWith("refused:")).every((l) => l.includes("also on main"))).toBe(
              true,
            );
          }),
        ),
      ),
    ));

  it("the refusals the base gives too are one line for each pull request and check, with their count", () =>
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9999 }), fc.integer({ min: 1, max: 40 }), word, (pr, count, check) => {
        const found = Array.from({ length: count }, (_, i) => ({ pr, check, reason: `reason ${i}`, fresh: false }));
        const said = report({ found, notReplayed: [], leftOut: [], targets: 1 });
        const lines = said.lines.filter((l) => l.startsWith("refused:"));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`${count} refusal(s)`);
        expect(said.code).toBe(0);
      }),
    ));

  it("one line for each refusal naming its pull request, its check and its reason", () =>
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9999 }), word, reasons, (pr, check, reason) => {
        const said = report({ found: [{ pr, check, reason, fresh: true }], notReplayed: [], leftOut: [], targets: 1 });
        const line = said.lines.find((l) => l.startsWith("refused:"));
        expect(line).toContain(`pr ${pr}`);
        expect(line).toContain(check);
        expect(line).toContain(reason);
      }),
    ));

  it("the base is asked only about a pull request the head refuses", () =>
    fc.assert(
      fc.asyncProperty(
        fc.record({ ts: targets, flips: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }) }),
        ({ ts, flips }) =>
          ran(
            Effect.gen(function* () {
              const refused = ts.map((_t, i) => flips[i] === true);

              const given = new Map(
                ts.map(
                  (t, i) =>
                    [t.number, { head: refused[i] ? refusalsFor(t.number).slice(0, 1) : [], base: [] }] as const,
                ),
              );

              const { probe, calls } = probing(given);
              yield* replayAll({ kinds: [land()], targets: ts, probe });
              expect(calls.filter((c) => c.includes(":head:")).length).toBe(ts.length);
              expect(calls.filter((c) => c.includes(":base:")).length).toBe(refused.filter(Boolean).length);
            }),
          ),
      ),
    ));
});

describe("a check that cannot be replayed", () => {
  const cannot = KINDS.filter((k) => Replay.guards.none(k.replay));

  it("is listed with its reason, never run, and does not fail the replay", () =>
    fc.assert(
      fc.asyncProperty(fc.record({ kinds: fc.subarray([...cannot], { minLength: 1 }), ts: targets }), ({ kinds, ts }) =>
        ran(
          Effect.gen(function* () {
            const { probe, calls } = probing(new Map());
            const replayed = yield* replayAll({ kinds, targets: ts, probe });
            const said = report({ ...replayed, targets: ts.length });

            expect(calls).toEqual([]);
            expect(said.code).toBe(0);

            for (const kind of kinds) {
              const line = said.lines.find((l) => l.startsWith("not replayed:") && l.includes(kind.label));
              expect(line).toBeDefined();
              expect(line).toContain(Replay.guards.none(kind.replay) ? kind.replay.reason.slice(0, 40) : "");
            }
          }),
        ),
      ),
    ));

  it("every kind that is not replayed gives its reason", () =>
    fc.assert(
      fc.property(fc.constantFrom(...KINDS), (kind) => {
        expect(!Replay.guards.none(kind.replay) || kind.replay.reason.length > 20).toBe(true);
      }),
    ));

  it("a kind replayed in part lists what it cannot see, once, whatever the pull requests", () =>
    fc.assert(
      fc.asyncProperty(fc.constantFrom(...KINDS.filter((k) => k.gap !== undefined)), targets, (kind, ts) =>
        ran(
          Effect.gen(function* () {
            const replayed = yield* replayAll({ kinds: [kind], targets: ts, probe: probing(new Map()).probe });
            expect(replayed.notReplayed.filter((line) => line === `${kind.label}: ${kind.gap}`)).toHaveLength(1);
          }),
        ),
      ),
    ));

  it("a pull request a replayed check could not read is listed by number, not dropped", () =>
    fc.assert(
      fc.asyncProperty(fc.record({ ts: targets, cause: word }), ({ ts, cause }) =>
        ran(
          Effect.gen(function* () {
            const probe: Probe = (_kind, version, t) =>
              Effect.succeed({ refusals: [], unreadable: version === "head" ? [`${cause} ${t.number}`] : [] });

            const replayed = yield* replayAll({ kinds: [land()], targets: ts, probe });
            const said = report({ ...replayed, targets: ts.length });

            for (const t of ts) {
              expect(said.lines.some((l) => l.startsWith("not replayed:") && l.includes(`pr ${t.number}`))).toBe(true);
            }
          }),
        ),
      ),
    ));
});

describe("reading land.ts check", () => {
  const check = fc.constantFrom("body", "leak", "queue");
  const trouble = fc.constantFrom("env", "check", "fetch");

  const wording = fc
    .stringMatching(/^[a-z0-9][a-z0-9 ,.:'()-]{0,78}[a-z0-9]$/)
    .filter((r) => !r.includes("are not signed"));

  it("a refusal at one of its own checks is a refusal, with that check and reason", () =>
    fc.assert(
      fc.property(fc.integer({ min: 1 }), check, wording, (pr, at, cause) => {
        const read = readCheck(pr, 1, `noise\nland: refused at the ${at} check: ${cause}\n`);
        expect(read.refusals).toEqual([{ pr, check: `land check: ${at}`, reason: cause }]);
        expect(read.unreadable).toEqual([]);
      }),
    ));

  it("trouble running it is listed as unread, never a refusal of the pull request", () =>
    fc.assert(
      fc.property(fc.integer({ min: 1 }), trouble, wording, (pr, at, cause) => {
        const read = readCheck(pr, 1, `land: refused at the ${at} check: ${cause}\n`);
        expect(read.refusals).toEqual([]);
        expect(read.unreadable.length).toBe(1);
      }),
    ));

  it("a failure that names no check is unread, and exit 0 is no refusal", () =>
    fc.assert(
      fc.property(
        fc.integer({ min: 1 }),
        fc.integer({ min: 1, max: 255 }),
        fc.string().filter((s) => !s.includes("land: refused")),
        (pr, code, err) => {
          expect(readCheck(pr, code, err).unreadable.length).toBe(1);
          expect(readCheck(pr, code, err).refusals).toEqual([]);
          expect(readCheck(pr, 0, err)).toEqual({ refusals: [], unreadable: [] });
        },
      ),
    ));

  it("its signed-commit line is left to the head's own unsignedCommits, so it is counted once", () =>
    fc.assert(
      fc.property(fc.integer({ min: 1 }), fc.integer({ min: 1, max: 9 }), (pr, n) => {
        const read = readCheck(
          pr,
          1,
          `land: refused at the body check: pr ${pr}: ${n} commit(s) since main are not signed: x\n`,
        );

        expect(read).toEqual({ refusals: [], unreadable: [] });
      }),
    ));
});

describe("the signed-commit driver", () => {
  const sha = fc.stringMatching(/^[0-9a-f]{40}$/);
  const dir = fc.stringMatching(/^\/[a-z0-9/-]{1,30}$/);

  it("names the version's own land.ts and the pull request's head, written as JSON text", () =>
    fc.assert(
      fc.property(dir, dir, sha, (landTs, tree, oid) => {
        const text = signedDriver(`${landTs}/land.ts`, tree, oid);
        expect(text).toContain(JSON.stringify(`file://${landTs}/land.ts`));
        expect(text).toContain(JSON.stringify(oid));
        expect(text).toContain(JSON.stringify(tree));
      }),
    ));

  it("a line that lists unsigned commits is one refusal, an empty list none, and a driver that failed is unread", () =>
    fc.assert(
      fc.property(fc.integer({ min: 1 }), fc.array(word, { minLength: 1 }), (pr, unsigned) => {
        const refused = readSigned(pr, 0, `${JSON.stringify({ unsigned })}\n`, "");
        expect(refused.refusals.length).toBe(1);
        expect(readSigned(pr, 0, `${JSON.stringify({ unsigned: [] })}\n`, "")).toEqual({
          refusals: [],
          unreadable: [],
        });
        expect(readSigned(pr, 0, `${JSON.stringify({ absent: true })}\n`, "")).toEqual({
          refusals: [],
          unreadable: [],
        });

        for (const failed of [
          readSigned(pr, 1, "", "boom"),
          readSigned(pr, 1, JSON.stringify({ unsigned: [] }), ""),
          readSigned(pr, 0, "not json", ""),
          readSigned(pr, 0, JSON.stringify({ unreadable: "x" }), ""),
        ]) {
          expect(failed.refusals).toEqual([]);
          expect(failed.unreadable.length).toBe(1);
        }
      }),
    ));
});

describe("signedRefusal", () => {
  it("is none for no unsigned commit, and one refusal naming each one otherwise", () =>
    fc.assert(
      fc.property(fc.integer({ min: 1 }), fc.array(word), (pr, unsigned) => {
        const refusals = signedRefusal(pr, unsigned);
        expect(refusals.length).toBe(unsigned.length === 0 ? 0 : 1);

        for (const sha of unsigned) {
          expect(refusals[0]?.reason).toContain(sha);
        }
      }),
    ));
});

describe("merges", () => {
  const sha = fc.stringMatching(/^[0-9a-f]{40}$/);

  it("takes the pull requests of the squash subjects with their commits, newest first, each once, at most `most`", () =>
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            sha,
            fc.oneof(
              fc.integer({ min: 1, max: 12 }).map((n) => `A change (#${n})`),
              word,
            ),
          ),
        ),
        fc.integer({ min: 1, max: 30 }),
        (rows, most) => {
          const got = merges(
            rows.map(([commit, subject]) => `${commit} ${subject}`),
            most,
          );

          const all = rows.flatMap(([commit, subject]) => {
            const n = /\(#(\d+)\)$/.exec(subject)?.[1];

            return n === undefined ? [] : [{ number: Number(n), commit }];
          });

          const first = all.filter((row, i) => all.findIndex((other) => other.number === row.number) === i);
          expect(got).toEqual(first.slice(0, most));
        },
      ),
    ));
});

describe("lintable", () => {
  it("takes the changed source files the pull request's tree still holds, and no other", () =>
    fc.assert(
      fc.property(
        fc.array(fc.tuple(word, fc.constantFrom("ts", "tsx", "mjs", "md", "json", "yaml"), fc.boolean())),
        (rows) => {
          const files = rows.map(([name, ext]) => `src/${name}.${ext}`);
          const tree = new Set(rows.flatMap(([name, ext, held]) => (held ? [`src/${name}.${ext}`] : [])));
          const got = lintable(files, tree);

          for (const file of got) {
            expect(tree.has(file)).toBe(true);
            expect(/\.(ts|tsx|mjs)$/.test(file)).toBe(true);
          }

          expect(got.length).toBe(files.filter((f) => tree.has(f) && /\.(ts|tsx|mjs)$/.test(f)).length);
        },
      ),
    ));
});

describe("reading the lint", () => {
  const place = fc.tuple(word, fc.integer({ min: 1, max: 999 }), fc.integer({ min: 1, max: 99 }), word);

  it("each line the lint blocks on is a refusal of the pull request, and a line of advice is none", () =>
    fc.assert(
      fc.property(
        fc.integer({ min: 1 }),
        fc.array(place, { minLength: 1 }),
        fc.array(place),
        (pr, blocked, advised) => {
          const out = [
            ...blocked.map(([file, line, col, rule]) => `${file}.ts:${line}:${col} fabrika(${rule}) a message`),
            ...advised.map(
              ([file, line, col, rule]) =>
                `${file}.ts:${line}:${col} fabrika(${rule}) advice, this folder is not at zero yet: x`,
            ),
            "oxlint: 1 blocking, 0 advice, 0 in agents-ledger.json, 0 in next-ledger.json",
          ].join("\n");

          const read = readLint(pr, 1, out, "");
          expect(read.refusals.length).toBe(blocked.length);
          expect(read.refusals.every((r) => r.pr === pr && r.check === "oxlint plugins")).toBe(true);
          expect(read.unreadable).toEqual([]);
        },
      ),
    ));

  it("a clean run is no refusal, and a failure that names no line is unread, never a pass", () =>
    fc.assert(
      fc.property(fc.integer({ min: 1 }), fc.integer({ min: 1, max: 255 }), (pr, code) => {
        expect(readLint(pr, 0, "oxlint: 0 blocking, 3 advice\n", "")).toEqual({ refusals: [], unreadable: [] });
        const failed = readLint(pr, code, "oxlint: 0 blocking\n", "boom");
        expect(failed.refusals).toEqual([]);
        expect(failed.unreadable.length).toBe(1);
      }),
    ));
});

describe("the survivor scope", () => {
  it("reads the cap from the MUTATE_FILES default of a survivors.ts, and none from one without it", () =>
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), (n) => {
        expect(capFrom(`const FILES = Config.schema(AtLeastOne, "MUTATE_FILES").pipe(Config.withDefault(${n}));`)).toBe(
          n,
        );
        expect(
          capFrom(`const FILES = Config.schema(AtLeastOne, "MUTATE_FILES").pipe(\n  Config.withDefault(${n}),\n);`),
        ).toBe(n);
        expect(capFrom("const FILES = 8;")).toBeNull();
      }),
    ));

  it("a refusal of `pick` is the pull request's, an absent `pick` or a pass is none, and a driver that failed is unread", () =>
    fc.assert(
      fc.property(fc.integer({ min: 1 }), word, fc.integer({ min: 0, max: 20 }), (pr, detail, n) => {
        const refused = readScope(pr, 0, `${JSON.stringify({ refused: detail })}\n`, "");
        expect(refused.refusals).toEqual([{ pr, check: "survivor scope", reason: detail }]);
        expect(readScope(pr, 0, `${JSON.stringify({ files: n })}\n`, "")).toEqual({ refusals: [], unreadable: [] });
        expect(readScope(pr, 0, `${JSON.stringify({ absent: true })}\n`, "")).toEqual({ refusals: [], unreadable: [] });

        for (const failed of [
          readScope(pr, 1, "", "boom"),
          readScope(pr, 1, JSON.stringify({ files: 1 }), ""),
          readScope(pr, 0, "no json", ""),
        ]) {
          expect(failed.refusals).toEqual([]);
          expect(failed.unreadable.length).toBe(1);
        }
      }),
    ));

  it("the driver imports the version's own survivors.ts and runs its `pick` on the input it is given", () =>
    fc.assert(
      fc.property(fc.stringMatching(/^\/[a-z0-9/-]{1,30}$/), (tree) => {
        const text = scopeDriver(`${tree}/survivors.ts`);
        expect(text).toContain(JSON.stringify(`file://${tree}/survivors.ts`));
        expect(text).toContain("survivors.pick(");
      }),
    ));
});
