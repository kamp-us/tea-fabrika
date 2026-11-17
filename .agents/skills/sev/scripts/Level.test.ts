// Today's lead tooling. The laws of the levels (decision 0532 for sev0; the sev1 rule is being
// recorded): how the log folds to one sev0, and how the level comes out of it and the open issues.
// Pure, apart from one law on the log file in a temporary folder.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Result, Schema } from "effect";
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
      const opens = written.flatMap((e) => (e._tag === "opened" || e._tag === "closed" ? [e._tag] : []));
      expect(opens.every((tag, i) => (i % 2 === 0 ? tag === "opened" : tag === "closed"))).toBe(true);
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

      return Result.isSuccess(folded) && folded.success._tag === "open" && folded.success.allow.join() === model.join();
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
      const issues = numbers.map(issue);
      const level = Level.level(sev0 ? open : Level.Sev0.cases.closed.make({}), issues);

      if (sev0) {
        return level._tag === "sev0" && level.allow.join() === "fabrikalfa/ci-cache";
      }

      return issues.length === 0
        ? level._tag === "none"
        : level._tag === "sev1" && level.issues.map((i) => i.number).join() === numbers.join();
    },
  );
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
