// P1: what internal/parse.ts reads out of git's own output. The two files under fixtures/ were recorded from
// real git runs (each names the git version and the command), one row per case with the value its note gives.
import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import * as Commit from "../Commit.ts";
import catFile from "../fixtures/cat-file-2.40.1.json" with { type: "json" };
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

// Plant: decode the message with a decoder that replaces bad bytes, so the latin-1 row passes as text.
it("P1 vector: parse.commits reads every object of each cat-file --batch output recorded from git", () => {
  const recorded = Schema.decodeUnknownSync(CatFile)(catFile);
  expect(recorded.git).toContain("git version");
  expect(recorded.rows.length).toBeGreaterThan(15);

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
