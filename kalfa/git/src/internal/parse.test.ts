// P1 and P13: what internal/parse.ts reads out of git's own output. The files under fixtures/ were recorded from
// real git runs (each names the git version and the command), one row per case with the value its note gives.
import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import * as Commit from "../Commit.ts";
import catFile from "../fixtures/cat-file-2.40.1.json" with { type: "json" };
import diffTreeRaw from "../fixtures/diff-tree-raw-2.40.1.json" with { type: "json" };
import forEachRef from "../fixtures/for-each-ref-2.40.1.json" with { type: "json" };
import * as Ref from "../Ref.ts";
import { expectFailure } from "../Repository.test-support.ts";
import * as Repository from "../Repository.ts";
import * as Parse from "./parse.ts";

const FAILURES = {
  UnreadableCommit: Repository.UnreadableCommit,
  NoSuchCommit: Repository.NoSuchCommit,
  RefNotCommit: Repository.RefNotCommit,
} as const;

const Side = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  at: Schema.Struct({ seconds: Schema.Finite, offset: Schema.String }),
});

const Expected = Schema.Union([
  Schema.Struct({
    id: Schema.String,
    tree: Schema.String,
    parents: Schema.Array(Schema.String),
    author: Side,
    committer: Side,
    message: Schema.String,
  }),
  Schema.Struct({ failure: Schema.Literal("UnreadableCommit"), id: Schema.String, reason: Schema.String }),
  Schema.Struct({ failure: Schema.Literal("NoSuchCommit"), id: Schema.String }),
]);

const CatFile = Schema.Struct({
  git: Schema.String,
  command: Schema.String,
  rows: Schema.Array(Schema.Struct({ note: Schema.String, output: Schema.String, expect: Schema.Array(Expected) })),
});

const ExpectedRef = Schema.Union([
  Schema.Struct({ name: Schema.String, commit: Schema.String }),
  Schema.Struct({ failure: Schema.Literal("RefNotCommit"), ref: Schema.String, points: Schema.String }),
]);

const ForEachRef = Schema.Struct({
  git: Schema.String,
  command: Schema.String,
  rows: Schema.Array(Schema.Struct({ note: Schema.String, output: Schema.String, expect: Schema.Array(ExpectedRef) })),
});

// The commits of the last four rows are well formed but for their tree line (a real `hash-object --literally` run):
// none, two, one after the author line, one in uppercase hex. Each must be UnreadableCommit, reason `header`.
//
// Plant: decode the message with a decoder that replaces bad bytes, so the latin-1 row passes as text; keep the first of
// two `tree` lines; take a `tree` line anywhere in the header; skip the `TreeId` decode; read the tree from the second
// header line; answer git's empty tree whatever the line says.
it("P1 vector: parse.commits reads every object of each cat-file --batch output recorded from git, with its tree", () => {
  const recorded = Schema.decodeUnknownSync(CatFile)(catFile);
  expect(recorded.git).toContain("git version");
  expect(recorded.rows.length).toBeGreaterThan(15);

  const trees = new Set(
    recorded.rows.flatMap((row) => row.expect.flatMap((each) => ("tree" in each ? [each.tree] : []))),
  );

  expect(trees.size, "the rows hold trees besides git's empty tree").toBeGreaterThan(3);

  const header = recorded.rows.filter(
    (row) => row.expect[0] !== undefined && "reason" in row.expect[0] && row.expect[0].reason === "header",
  );

  expect(header.length, "the rows hold the objects whose tree line is wrong").toBeGreaterThanOrEqual(4);

  for (const row of recorded.rows) {
    const result = Parse.commits(new Uint8Array(Buffer.from(row.output, "base64")));
    const [first] = row.expect;

    if (first !== undefined && "failure" in first) {
      expect(Result.isFailure(result), `${row.note} fails`).toBe(true);

      if (Result.isFailure(result)) {
        const { failure, ...fields } = first;
        expectFailure(result.failure, FAILURES[failure], fields, row.note);
      }
    } else {
      expect(Result.isSuccess(result), `${row.note} reads`).toBe(true);

      if (Result.isSuccess(result)) {
        expect(
          result.success.map((commit) => Schema.encodeSync(Commit.Commit)(commit)),
          row.note,
        ).toEqual(row.expect);
      }
    }
  }
});

// Plant: drop `%(symref)` from the format, so the symbolic ref reads as a plain branch.
it("P1 vector: parse.refs reads every line of each for-each-ref output recorded from git", () => {
  const recorded = Schema.decodeUnknownSync(ForEachRef)(forEachRef);
  expect(recorded.git).toContain("git version");
  expect(recorded.rows.length).toBeGreaterThan(8);

  for (const row of recorded.rows) {
    const result = Parse.refs(row.output);
    const [first] = row.expect;

    if (first !== undefined && "failure" in first) {
      expect(Result.isFailure(result), `${row.note} fails`).toBe(true);

      if (Result.isFailure(result)) {
        expectFailure(result.failure, FAILURES[first.failure], { ref: first.ref, points: first.points }, row.note);
      }
    } else {
      expect(Result.isSuccess(result), `${row.note} reads`).toBe(true);

      if (Result.isSuccess(result)) {
        expect(
          result.success.map((ref) => Schema.encodeSync(Ref.Ref)(ref)),
          row.note,
        ).toEqual(row.expect);
      }
    }
  }
});

const ChangeSide = Schema.NullOr(Schema.Struct({ mode: Schema.String, id: Schema.String }));

const ExpectedChange = Schema.Struct({
  status: Schema.Literals(["A", "D", "M", "T"]),
  path: Schema.String,
  before: ChangeSide,
  after: ChangeSide,
  gitlink: Schema.Boolean,
});

const DiffTreeRaw = Schema.Struct({
  git: Schema.String,
  command: Schema.String,
  rows: Schema.Array(
    Schema.Struct({ note: Schema.String, output: Schema.String, expect: Schema.Array(ExpectedChange) }),
  ),
});

const fromBase64 = (output: string): Uint8Array => new Uint8Array(Buffer.from(output, "base64"));

// Plant: split an entry's fields on spaces and not on NUL, so the path with a space reads short; read a submodule as a file
// (`gitlink` false); take the status from the wrong field; drop the check that an entry ends with its NUL.
it("P13 vector: parse.changes reads every entry of each diff-tree -r -z output recorded from git, a submodule kept apart", () => {
  const recorded = Schema.decodeUnknownSync(DiffTreeRaw)(diffTreeRaw);
  expect(recorded.git).toContain("git version");
  expect(recorded.rows.length).toBeGreaterThan(15);

  const everything = recorded.rows.flatMap((row) => row.expect);

  expect(
    [...new Set(everything.map((each) => each.status))].sort(),
    "the rows hold every status git prints for a file",
  ).toEqual(["A", "D", "M", "T"]);
  expect(
    everything.some((each) => each.path.includes(" ")),
    "a path with a space",
  ).toBe(true);
  expect(
    everything.some((each) => each.path.includes("\t")),
    "a path with a tab",
  ).toBe(true);
  expect(
    everything.some((each) => each.path.includes("\u00e9")),
    "a path with an accent",
  ).toBe(true);
  expect(everything.filter((each) => each.gitlink).length, "the rows hold submodules").toBeGreaterThanOrEqual(4);
  expect(everything.filter((each) => !each.gitlink).length, "the rows hold files").toBeGreaterThan(10);

  for (const row of recorded.rows) {
    const result = Parse.changes(fromBase64(row.output));
    expect(Result.isSuccess(result), `${row.note} reads`).toBe(true);

    if (Result.isSuccess(result)) {
      expect(
        result.success.map((each) => ({
          status: each.status,
          path: each.path,
          before: each.before ?? null,
          after: each.after ?? null,
          gitlink: each.gitlink,
        })),
        row.note,
      ).toEqual(row.expect);
    }

    // The last byte of an entry is a NUL after its path: without it the entry is cut, which is no answer.
    if (row.output !== "") {
      const cut = Parse.changes(fromBase64(row.output).subarray(0, -1));
      expect(Result.isFailure(cut), `${row.note}: a list cut short fails`).toBe(true);

      if (Result.isFailure(cut)) {
        expect(cut.failure, `${row.note}: and it is GitUnavailable`).toBeInstanceOf(Repository.GitUnavailable);
        expect(cut.failure.reason, `${row.note}: because git's text is unreadable`).toBeInstanceOf(
          Repository.Unreadable,
        );
      }
    }
  }

  // Two outputs one after the other are the two lists one after the other.
  const [first, second] = recorded.rows.filter((row) => row.expect.length > 1);

  if (first === undefined || second === undefined) {
    throw new Error("the recorded rows hold two lists of more than one entry");
  }

  const joined = new Uint8Array([...fromBase64(first.output), ...fromBase64(second.output)]);
  const both = Parse.changes(joined);
  expect(Result.isSuccess(both) ? both.success.length : -1, "two outputs read as one list").toBe(
    first.expect.length + second.expect.length,
  );
});
