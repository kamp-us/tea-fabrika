// P1, P15 and P17: what internal/parse.ts reads out of git's own output. The files under fixtures/ were recorded from
// real git runs (each names the git version and the command), one row per case with the value its note gives.
import { expect, it } from "@effect/vitest";
import { Predicate, Result, Schema } from "effect";
import * as Commit from "../Commit.ts";
import * as Diff from "../Diff.ts";
import catFile from "../fixtures/cat-file-2.40.1.json" with { type: "json" };
import diffTreePatch from "../fixtures/diff-tree-patch-2.40.1.json" with { type: "json" };
import diffTreeRaw from "../fixtures/diff-tree-raw-2.40.1.json" with { type: "json" };
import forEachRef from "../fixtures/for-each-ref-2.40.1.json" with { type: "json" };
import { ModelDiff } from "../History.test-support.ts";
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
it("P15 vector: parse.changes reads every entry of each diff-tree -r -z output recorded from git, a submodule kept apart", () => {
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

const DiffTreePatch = Schema.Struct({
  git: Schema.String,
  command: Schema.String,
  rows: Schema.Array(
    Schema.Struct({
      note: Schema.String,
      raw: Schema.String,
      output: Schema.String,
      expect: Schema.Union([
        Schema.Array(ModelDiff.Content),
        Schema.Struct({ failure: Schema.Literal("NotUtf8"), path: Schema.String }),
        Schema.Struct({ failure: Schema.Literal("Unreadable") }),
      ]),
    }),
  ),
});

// Built when it is called, so this file loads before the product names exist.
const encodeContents = (contents: ReadonlyArray<typeof Diff.Content.Type>) =>
  Schema.encodeSync(Schema.Array(Diff.Content))(contents);

const isUnavailable = Schema.is(Repository.GitUnavailable);

const isUnreadableReason = Schema.is(Repository.Unreadable);

/** The reader failed with GitUnavailable for the reason Unreadable: git printed what no call reads. */
const unreadable = (result: Result.Result<unknown, Repository.GitUnavailable | Repository.NotUtf8>): boolean =>
  Result.isFailure(result) && isUnavailable(result.failure) && isUnreadableReason(result.failure.reason);

// Plant: read the text after a hunk header's second `@@` as a line; delete the section count check, so a raw list with more or
// fewer entries than the patch has sections still reads; stop a hunk at a line that looks like a header; name the last file in the
// raw list and not the failing one; strip the line end of every line; number every line from 1, or a removed line in the new file;
// decode a line with replacement, so the latin-1 rows read; read a binary file's bytes as lines; read a type change as one section.
// A cut patch, a marker with no line before it, a section with no header, a header that is none, a line that lacks its side's
// prefix and a path that is no path are each unreadable: drop the final-newline check, the no-line-before-the-marker check, the
// section-header check, the hunk-header check, either `take` prefix (read it as the empty string) or the path mapper. A raw entry of
// a tree's mode is unreadable too: drop the entry mapper. A line that starts with a BOM keeps it: decode with `ignoreBOM: false`.
it("P17 vector: parse.patch reads every section of each diff-tree -p -U0 output recorded from git to the value its note gives, one section for each raw entry and two for a type change", () => {
  const recorded = Schema.decodeUnknownSync(DiffTreePatch)(diffTreePatch);
  expect(recorded.git).toContain("git version");
  expect(recorded.rows.length).toBeGreaterThan(20);

  const contents = recorded.rows.flatMap((row) => ("failure" in row.expect ? [] : row.expect));
  expect(
    contents.filter((each) => Predicate.isTagged(each, "Binary")).length,
    "the rows hold binary files",
  ).toBeGreaterThan(3);

  expect(
    contents.filter((each) => Predicate.isTagged(each, "Text") && each.lines.length === 0).length,
    "the rows hold files with no line",
  ).toBeGreaterThan(3);

  expect(
    contents.some((each) => Predicate.isTagged(each, "Text") && each.lines.some((line) => line.text.endsWith("\r\n"))),
    "the rows hold CRLF lines",
  ).toBe(true);

  expect(
    contents.some((each) => Predicate.isTagged(each, "Text") && each.lines.some((line) => !line.text.endsWith("\n"))),
    "the rows hold a line with no end",
  ).toBe(true);

  expect(
    recorded.rows.filter((row) => "path" in row.expect).length,
    "the rows hold lines that are not UTF-8",
  ).toBeGreaterThanOrEqual(3);

  for (const row of recorded.rows) {
    const listed = Parse.changes(fromBase64(row.raw));
    expect(Result.isSuccess(listed), `${row.note}: the raw list reads`).toBe(true);

    if (!Result.isSuccess(listed)) {
      continue;
    }

    const result = Parse.patch(listed.success, fromBase64(row.output));

    if ("failure" in row.expect) {
      expect(Result.isFailure(result), `${row.note}: fails`).toBe(true);

      if (row.expect.failure === "Unreadable") {
        expect(unreadable(result), `${row.note}: is unreadable`).toBe(true);
      } else if (Result.isFailure(result)) {
        expectFailure(result.failure, Repository.NotUtf8, { path: row.expect.path }, row.note);
      }

      continue;
    }

    expect(Result.isSuccess(result), `${row.note}: reads`).toBe(true);

    if (Result.isSuccess(result)) {
      expect(encodeContents(result.success), row.note).toEqual(row.expect);
    }

    // A raw list with one entry fewer, or one more, than the patch has sections is no answer. A type change is two sections.
    if (listed.success.length > 0) {
      const fewer = Parse.patch(listed.success.slice(0, -1), fromBase64(row.output));
      expect(unreadable(fewer), `${row.note}: one entry fewer is unreadable`).toBe(true);
    }

    const last = listed.success.at(-1);

    if (last !== undefined) {
      const more = Parse.patch([...listed.success, last], fromBase64(row.output));
      expect(unreadable(more), `${row.note}: one entry more is unreadable`).toBe(true);
    }

    if (listed.success.some((each) => each.status === "T")) {
      const one = listed.success.map((each) => ({ ...each, status: "M" as const }));
      const miscounted = Parse.patch(one, fromBase64(row.output));
      expect(unreadable(miscounted), `${row.note}: a type change is two sections`).toBe(true);
    }

    // A patch cut after a line of a hunk holds fewer lines than its header says: it is cut, which is no answer.
    const patch = fromBase64(row.output);
    const lines = new TextDecoder("latin1").decode(patch).split("\n").slice(0, -1);
    const lastLine = lines.at(-1) ?? "";

    if (lastLine.startsWith("+") || lastLine.startsWith("-")) {
      const cut = Parse.patch(listed.success, patch.subarray(0, patch.length - lastLine.length - 1));
      expect(unreadable(cut), `${row.note}: a patch cut short is unreadable`).toBe(true);
    }
  }

  // Rows made by hand. Git never prints these, so no recording holds them: each is the one-line row of the recording, cut or bent.
  const before = "de980441c3ab03a8c07dda1ad27b8a11f39deb1e";
  const after = "7be73ce3c1b1cdaea86e8168dfee8575175953bf";
  const latin1 = (text: string): Uint8Array => Uint8Array.from(text, (character) => character.charCodeAt(0));
  const rawEntry = (path: string): Uint8Array => latin1(`:100644 100644 ${before} ${after} M\0${path}\0`);

  const header = (path: string): string =>
    `diff --git a/${path} b/${path}\nindex ${before}..${after} 100644\n--- a/${path}\n+++ b/${path}\n`;

  const bent: ReadonlyArray<{ readonly note: string; readonly path: string; readonly output: Uint8Array }> = [
    {
      note: "hand-made: a patch with a partial row after its last section has no final newline, and that row is not dropped",
      path: "a",
      output: latin1(`${header("a")}@@ -2 +2 @@ a\n-b\n+B\nx`),
    },
    {
      note: "hand-made: a `\\ No newline` marker with no line before it, after a hunk side of zero lines",
      path: "a",
      output: latin1(`${header("a")}@@ -0,0 +2 @@ a\n\\ No newline at end of file\n+B\n`),
    },
    {
      note: "hand-made: a section that does not start with `diff --git`, its header lines replaced by one line of text",
      path: "a",
      output: latin1("garbage\n@@ -2 +2 @@ a\n-b\n+B\n"),
    },
    {
      note: "hand-made: a hunk header that is no header, a line of text that starts with `@@ `",
      path: "a",
      output: latin1(`${header("a")}@@ -x +y @@\n-b\n+B\n`),
    },
    {
      note: "hand-made: the new side of a hunk holds a line that is not an added line",
      path: "a",
      output: latin1(`${header("a")}@@ -2,0 +2 @@ a\n-b\n`),
    },
    {
      note: "hand-made: the old side of a hunk holds a line that is not a removed line",
      path: "a",
      output: latin1(`${header("a")}@@ -2 +2,0 @@ a\n+B\n`),
    },
    {
      note: "hand-made: a line that is not UTF-8 in a file whose raw path is no path of a tree names no file, so it is unreadable",
      path: ".git",
      output: latin1(`${header(".git")}@@ -1 +1 @@\n-\u00ff\n+B\n`),
    },
  ];

  for (const row of bent) {
    const listed = Parse.changes(rawEntry(row.path));
    expect(Result.isSuccess(listed), `${row.note}: the raw list reads`).toBe(true);

    if (Result.isSuccess(listed)) {
      expect(unreadable(Parse.patch(listed.success, row.output)), `${row.note}: is unreadable`).toBe(true);
    }
  }

  // A line that starts with a BOM keeps it: the line is read as it is, and a reader that drops a leading BOM reads another line.
  const marked = Parse.changes(rawEntry("a"));
  const bom = new TextEncoder().encode(`${header("a")}@@ -1 +1 @@\n-\uFEFFb\n+\uFEFFB\n`);
  const readBom = Result.isSuccess(marked) ? Parse.patch(marked.success, bom) : undefined;
  expect(readBom !== undefined && Result.isSuccess(readBom), "hand-made: a line that starts with a BOM reads").toBe(
    true,
  );

  if (readBom !== undefined && Result.isSuccess(readBom)) {
    expect(readBom.success, "hand-made: the BOM is part of each line").toEqual([
      Diff.Text.make({
        lines: [Diff.Removed.make({ at: 1, text: "\uFEFFb\n" }), Diff.Added.make({ at: 1, text: "\uFEFFB\n" })],
      }),
    ]);
  }

  // A raw entry that names a file no tree holds is unreadable, and one that names a file a tree holds reads.
  const empty = Diff.Text.make({ lines: [] });

  const entryWith = (mode: string): Parse.Change => ({
    status: "A",
    path: "a",
    after: { mode, id: after },
    gitlink: false,
  });

  expect(unreadable(Parse.files([[entryWith("040000"), empty]])), "hand-made: a tree's mode is no file").toBe(true);
  expect(Result.isSuccess(Parse.files([[entryWith("100644"), empty]])), "hand-made: a file's mode reads").toBe(true);
});
