// Today's lead tooling. The laws of the levels (decision 0532 for sev0; 0611 for the sev1 fix, the
// sev0's fixes and the admin route): how the log folds to one sev0, and how the level comes out of it
// and the open issues. Pure, apart from one law on the log file in a temporary folder.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, FileSystem, Option, Path, Result, Schema, Array as Arr, pipe } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import * as Land from "../../lead/scripts/land.ts";
import * as Level from "./Level.ts";

const AT = "2026-11-14T19:00:00.000Z";

const BRANCH = Schema.Literals(["fabrikalfa/ci-cache", "fabrikalfa/ci-legs", "fabrikalfa/ci-flake"]);

/** One command a person can give, as the line it would write. */
const Move = Schema.Struct({
  tag: Schema.Literals(["opened", "allowed", "next", "closed", "looping", "ended"]),
  branch: BRANCH,
});

const lineFor = (move: typeof Move.Type): Level.Entry => {
  switch (move.tag) {
    case "opened":
      return Level.Entry.cases.opened.make({ at: AT, by: "owner", reason: "slow", allow: [move.branch], issues: [] });
    case "allowed":
      return Level.Entry.cases.allowed.make({ at: AT, branch: move.branch });
    case "next":
      return Level.Entry.cases.next.make({ at: AT, branch: move.branch, before: [] });
    case "closed":
      return Level.Entry.cases.closed.make({ at: AT, by: "lead" });
    case "looping":
      return Level.Entry.cases.looping.make({ at: AT, pid: 7 });
    case "ended":
      return Level.Entry.cases.ended.make({ at: AT, by: "loop" });
  }
};

const issue = (number: number): Level.Alert => ({ number, title: "Scheduled CI is red on main", since: AT });

describe("fold", () => {
  it.prop(
    "property: whatever commands are tried, the lines written fold, and every opened comes after a close or first, so two sev0s are never open at once",
    { moves: Schema.Array(Move) },
    ({ moves }) => {
      const written: Array<Level.Entry> = [];
      let sev0: Level.Sev0 = Level.Sev0.cases.closed.make({});

      for (const move of moves) {
        const entry = lineFor(move);
        const next = Level.step(sev0, entry, written.length);

        // An open while one is open is always refused, and so is a move of a sev0 when none is.
        const fits =
          entry._tag === "opened"
            ? sev0._tag === "closed"
            : entry._tag === "looping" || entry._tag === "ended" || sev0._tag === "open";

        expect(Result.isSuccess(next)).toBe(fits);

        if (Result.isSuccess(next)) {
          written.push(entry);
          sev0 = next.success;
        }
      }

      const folded = Level.fold(written);
      expect(folded).toEqual(Result.succeed(sev0));
      const opens = Arr.flatMap(written, (e) => (e._tag === "opened" || e._tag === "closed" ? [e._tag] : []));
      expect(Arr.every(opens, (tag, i) => (i % 2 === 0 ? tag === "opened" : tag === "closed"))).toBe(true);
    },
  );

  it.prop(
    "property: while a sev0 is open, next leaves exactly its branch allowed and allow adds its branch once",
    { first: BRANCH, later: Schema.Array(Schema.Struct({ next: Schema.Boolean, branch: BRANCH })) },
    ({ first, later }) => {
      let model: ReadonlyArray<string> = [first];
      const entries: Array<Level.Entry> = [lineFor({ tag: "opened", branch: first })];

      for (const { next, branch } of later) {
        model = next ? [branch] : model.includes(branch) ? model : [...model, branch];
        entries.push(lineFor({ tag: next ? "next" : "allowed", branch }));
      }

      const folded = Level.fold(entries);

      return (
        Result.isSuccess(folded) &&
        folded.success._tag === "open" &&
        Arr.join(folded.success.allow, ",") === Arr.join(model, ",")
      );
    },
  );

  it("vector: a log with two opened in a row, or a close with none open, does not fold, and the reason names the line", () => {
    const opened = lineFor({ tag: "opened", branch: "fabrikalfa/ci-cache" });
    const closed = lineFor({ tag: "closed", branch: "fabrikalfa/ci-cache" });
    expect(Level.fold([opened, opened])).toEqual(
      Result.fail(`line 2 of the log (opened): a sev0 is open already, since ${AT}`),
    );
    expect(Level.fold([closed])).toEqual(Result.fail("line 1 of the log (closed): no sev0 is open"));
    expect(Level.fold([opened, closed, closed])).toEqual(Result.fail("line 3 of the log (closed): no sev0 is open"));
  });

  it("format: an opened line whose caller is not the owner does not decode, since only the owner calls a sev0", () => {
    const line = { _tag: "opened", at: AT, by: "lead", reason: "slow", allow: [], issues: null };
    expect(Result.isFailure(Schema.decodeUnknownResult(Level.Entry)(line))).toBe(true);
    expect(Result.isSuccess(Schema.decodeUnknownResult(Level.Entry)({ ...line, by: "owner" }))).toBe(true);
  });
});

describe("level", () => {
  const open = Level.Sev0.cases.open.make({ since: AT, reason: "slow", allow: ["fabrikalfa/ci-cache"], index: 0 });

  it.prop(
    "property: an open sev0 wins whatever issues are open; with none open, any open issue is a sev1 holding exactly those, and no issue is none",
    { numbers: Schema.Array(Schema.Int), sev0: Schema.Boolean },
    ({ numbers, sev0 }) => {
      const issues = Arr.map(numbers, issue);
      const level = Level.level(sev0 ? open : Level.Sev0.cases.closed.make({}), issues);

      if (sev0) {
        return level._tag === "sev0" && Arr.join(level.allow, ",") === "fabrikalfa/ci-cache";
      }

      return issues.length === 0
        ? level._tag === "none"
        : level._tag === "sev1" &&
            pipe(
              level.issues,
              Arr.map((i) => String(i.number)),
              Arr.join(","),
            ) === Arr.join(Arr.map(numbers, String), ",");
    },
  );
});

// ---------------------------------------------------------------- 0611: the sev1 fix, the sev0's fixes, the admin route

/** The laws of this part run 100 cases on seed 119120, as the plan's laws do (0611). */
const LAW = { arbitrary: { seed: 119120, runs: runsFor({ fast: 100, full: 100 }) } };

const NUMBER = Schema.Int.check(Schema.isBetween({ minimum: 1330, maximum: 1340 }));

/** A fix line as `sev.ts fix` writes it: the branch it names (null for a drop) and the issues it answers. */
const FixLine = Schema.Struct({ branch: Schema.NullOr(BRANCH), issues: Schema.Array(NUMBER) });

/** The fix lines of a log, oldest first, and the open ci-scheduled issues the sev1 has now. */
const Fixes = Schema.Struct({ fixes: Schema.Array(FixLine), open: Schema.Array(NUMBER) });

const fixLine = (branch: string | null, issues: ReadonlyArray<number>): Level.Entry =>
  Level.Entry.cases.fix.make({ at: AT, branch, issues: [...issues] });

/** Each number once, in the order given: a list of open issues names each one once. */
const distinct = (numbers: ReadonlyArray<number>): ReadonlyArray<number> => [...new Set(numbers)];

/**
 * The branch a sev1 fix has to be named as, from the fix lines and the open issues: the newest line's
 * branch, while an issue that line answers is open and no open issue is above every number it answered.
 * Issue numbers only grow, so an issue above them was opened after the fix was named (0611).
 */
const namedBy = (fixes: ReadonlyArray<typeof FixLine.Type>, open: ReadonlyArray<number>): string | null => {
  const last = Arr.last(fixes);

  if (Option.isNone(last) || last.value.branch === null) {
    return null;
  }

  const answered = last.value.issues;

  return open.some((n) => answered.includes(n)) && open.every((n) => n <= Math.max(...answered))
    ? last.value.branch
    : null;
};

/** The cases the sev1 fix law must reach, each named as `sev1Reaches` names the generated value it reaches. */
const SEV1_CASES = [
  "no fix line",
  "a drop",
  "a fix named",
  "an answer open with a newer issue",
  "answers closed, nothing newer",
  "answers closed, a newer issue open",
];

const sev1Reaches = (given: typeof Fixes.Type): ReadonlyArray<string> => {
  const last = Arr.last(given.fixes);

  if (Option.isNone(last)) {
    return ["no fix line"];
  }

  if (last.value.branch === null) {
    return ["a drop"];
  }

  const answered = last.value.issues;
  const answersOpen = given.open.some((n) => answered.includes(n));
  const newer = given.open.some((n) => n > Math.max(...answered));

  if (answersOpen && !newer) {
    return ["a fix named"];
  }

  if (answersOpen) {
    return ["an answer open with a newer issue"];
  }

  return newer ? ["answers closed, a newer issue open"] : ["answers closed, nothing newer"];
};

describe("the sev1 fix (0611)", () => {
  // Issue numbers only grow, so "opened after the fix was named" is "above every number the fix answered": no clock.
  it.prop(
    "property: a sev1 fix is named while an issue it answered is open and no open issue opened after it; a drop, or no fix line, names none",
    Fixes.fields,
    ({ fixes, open }) => {
      expect(
        Level.sev1Fix(
          fixes.map((f) => fixLine(f.branch, f.issues)),
          distinct(open).map(issue),
        ),
      ).toBe(namedBy(fixes, distinct(open)));
    },
    LAW,
  );

  it.effect(
    "scenario: the sev1 fix law's generator reaches every case it must hold on, with the law's seed and count",
    () =>
      Effect.gen(function* () {
        const sample = yield* Arbitrary.sampleEffect(Arbitrary.schema(Fixes), {
          count: LAW.arbitrary.runs,
          seed: LAW.arbitrary.seed,
        });

        const reached = new Set(sample.flatMap(sev1Reaches));

        expect(SEV1_CASES.filter((c) => !reached.has(c))).toEqual([]);
      }).pipe(Effect.orDie),
  );

  it("pinned: fabrikalfa/x answered 1333 and 1700; with 1333 still open and 1700 closed, an issue opened at 1800 expires it, so no fix is named (0611; the 2026-11-19 review)", () => {
    const named = fixLine("fabrikalfa/x", [1333, 1700]);

    expect(Level.sev1Fix([named], [issue(1333), issue(1800)])).toBeNull();
    expect(Level.sev1Fix([named], [issue(1333)])).toBe("fabrikalfa/x");
    expect(Level.sev1Fix([named], [issue(1333), issue(1700)])).toBe("fabrikalfa/x");
    expect(Level.sev1Fix([named, fixLine(null, [])], [issue(1333)])).toBeNull();
    expect(Level.sev1Fix([named], [])).toBeNull();
  });
});

/** A move of an open sev0 that names a branch: `next` makes it the only one, `allow` adds a ready pull request. */
const Step = Schema.Struct({ tag: Schema.Literals(["next", "allowed"]), branch: BRANCH });

/** A log: an earlier sev0 (its steps, then a close) when `earlier` has steps, then the latest one, begun by `open --allow`. */
const Sev0Log = Schema.Struct({ earlier: Schema.Array(Step), allow: Schema.Array(BRANCH), steps: Schema.Array(Step) });

const stepLine = (step: typeof Step.Type): Level.Entry =>
  step.tag === "next"
    ? Level.Entry.cases.next.make({ at: AT, branch: step.branch, before: [] })
    : Level.Entry.cases.allowed.make({ at: AT, branch: step.branch });

const openedLine = (allow: ReadonlyArray<string>): Level.Entry =>
  Level.Entry.cases.opened.make({ at: AT, by: "owner", reason: "slow", allow: [...allow], issues: [] });

const sev0Log = (given: typeof Sev0Log.Type): ReadonlyArray<Level.Entry> => [
  ...(given.earlier.length === 0
    ? []
    : [openedLine([]), ...given.earlier.map(stepLine), Level.Entry.cases.closed.make({ at: AT, by: "lead" })]),
  openedLine(given.allow),
  ...given.steps.map(stepLine),
];

/** The fixes a sev0's lines name: the list its latest `open --allow` or `next` sets. A plain `allow` sets none. */
const setBy = (lines: ReadonlyArray<Level.Entry>): ReadonlyArray<string> => {
  const sets = lines.flatMap((e) =>
    Level.Entry.guards.opened(e) ? [e.allow] : Level.Entry.guards.next(e) ? [[e.branch]] : [],
  );

  return Option.getOrElse(Arr.last(sets), () => []);
};

const SEV0_CASES = ["an earlier sev0", "a next", "an open --allow with branches", "a plain allow"];

const sev0Reaches = (given: typeof Sev0Log.Type): ReadonlyArray<string> => [
  ...(given.earlier.length > 0 ? ["an earlier sev0"] : []),
  ...(given.steps.some((s) => s.tag === "next")
    ? ["a next"]
    : given.allow.length > 0
      ? ["an open --allow with branches"]
      : []),
  ...(given.steps.some((s) => s.tag === "allowed") ? ["a plain allow"] : []),
];

describe("the sev0's fixes (0603, 0611)", () => {
  // `open --allow` and `next` name the fixes of a sev0, the latest one; a plain `allow` names a ready pull request,
  // and a sev0 before the latest one counts for none.
  it.prop(
    "property: an open sev0's fixes are the list its latest `open --allow` or `next` set; a plain `allow` names none, and an earlier sev0 counts for none",
    Sev0Log.fields,
    (given) => {
      const lines = sev0Log(given);

      const latest = lines.slice(
        Option.getOrElse(
          Arr.findLastIndex(lines, (e) => e._tag === "opened"),
          () => 0,
        ),
      );

      expect(Level.sev0Fixes(latest)).toEqual(setBy(latest));
      expect(Level.sev0Fixes(lines)).toEqual(setBy(latest));
    },
    LAW,
  );

  it.effect(
    "scenario: the sev0 law's generator reaches every case it must hold on, with the law's seed and count",
    () =>
      Effect.gen(function* () {
        const sample = yield* Arbitrary.sampleEffect(Arbitrary.schema(Sev0Log), {
          count: LAW.arbitrary.runs,
          seed: LAW.arbitrary.seed,
        });

        const reached = new Set(sample.flatMap(sev0Reaches));

        expect(SEV0_CASES.filter((c) => !reached.has(c))).toEqual([]);
      }).pipe(Effect.orDie),
  );
});

/**
 * A route's inputs: an open sev0's log, with the fix lines a log may hold before it (a sev0 outranks a
 * sev1), or else the fix lines of a closed one; and the issue list the route reads, or fails to.
 */
const Given = Schema.Struct({
  sev0Open: Schema.Boolean,
  before: Schema.Array(FixLine),
  sev0: Sev0Log,
  fixes: Schema.Array(FixLine),
  issues: Schema.Array(NUMBER),
  unreadable: Schema.Boolean,
});

const routeLog = (given: typeof Given.Type): ReadonlyArray<Level.Entry> =>
  given.sev0Open
    ? [...given.before.map((f) => fixLine(f.branch, f.issues)), ...sev0Log(given.sev0)]
    : given.fixes.map((f) => fixLine(f.branch, f.issues));

const readIssues = (given: typeof Given.Type) =>
  given.unreadable ? Result.fail("gh issue list exited 1") : Result.succeed(distinct(given.issues).map(issue));

const ROUTE_CASES = [
  "a sev0 open",
  "a sev0 open over a fix line",
  "a sev1 fix named",
  "an unreadable list with a fix line",
];

const routeReaches = (given: typeof Given.Type): ReadonlyArray<string> => {
  if (given.sev0Open) {
    return given.before.length > 0 ? ["a sev0 open", "a sev0 open over a fix line"] : ["a sev0 open"];
  }

  if (given.unreadable) {
    return given.fixes.length > 0 ? ["an unreadable list with a fix line"] : [];
  }

  return namedBy(given.fixes, distinct(given.issues)) === null ? [] : ["a sev1 fix named"];
};

describe("the admin route names a fix as Level says (0611)", () => {
  it.prop(
    "property: the admin route names a sev0's fixes as Level.sev0Fixes does and a sev1 fix as Level.sev1Fix does over the open issues; an unreadable list names no sev1 fix and still builds the route",
    Given.fields,
    (given) => {
      const entries = routeLog(given);
      const folded = Level.fold(entries);

      expect(Result.isSuccess(folded)).toBe(true);

      const sev0 = Result.getOrThrow(folded);
      const read = readIssues(given);

      expect(Land.routeFromLog(entries, sev0, read)).toEqual(
        sev0._tag === "open"
          ? { _tag: "admin", sev0: [...sev0.allow], sev0Fixes: Level.sev0Fixes(entries.slice(sev0.index)), sev1: null }
          : {
              _tag: "admin",
              sev0: [],
              sev0Fixes: [],
              sev1: Result.isSuccess(read) ? Level.sev1Fix(entries, read.success) : null,
            },
      );
    },
    LAW,
  );

  it.effect(
    "scenario: the route law's generator reaches every case it must hold on, with the law's seed and count",
    () =>
      Effect.gen(function* () {
        const sample = yield* Arbitrary.sampleEffect(Arbitrary.schema(Given), {
          count: LAW.arbitrary.runs,
          seed: LAW.arbitrary.seed,
        });

        const reached = new Set(sample.flatMap(routeReaches));

        expect(ROUTE_CASES.filter((c) => !reached.has(c))).toEqual([]);
      }).pipe(Effect.orDie),
  );

  it("pinned: an unreadable issue list names no sev1 fix and still builds the admin route, so a docs-only merge is not refused (0611, fail closed; the 2026-11-19 review)", () => {
    expect(
      Land.routeFromLog(
        [fixLine("fabrikalfa/x", [1333])],
        Level.Sev0.cases.closed.make({}),
        Result.fail("gh issue list exited 1"),
      ),
    ).toEqual({ _tag: "admin", sev0: [], sev0Fixes: [], sev1: null });
  });
});

describe("the log file", () => {
  it.effect("scenario: write refuses a second sev0 and leaves the file as it was", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "sev-" });
      const opened = lineFor({ tag: "opened", branch: "fabrikalfa/ci-cache" });
      yield* Level.write(dir, opened);
      const before = yield* fs.readFileString((yield* Path.Path).join(dir, "log.jsonl"));

      expect(yield* Effect.flip(Level.write(dir, opened))).toMatchObject({
        _tag: "Refused",
        reason: `a sev0 is open already, since ${AT}`,
      });
      expect(yield* fs.readFileString((yield* Path.Path).join(dir, "log.jsonl"))).toBe(before);
      expect((yield* Level.read(dir)).sev0._tag).toBe("open");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
