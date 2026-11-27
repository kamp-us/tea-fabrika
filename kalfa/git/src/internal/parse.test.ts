// P1, P15, P17, P18, P20 and P21: what internal/parse.ts reads out of git's own output. The files under fixtures/ were recorded from
// real git runs (each names the git version and the command), one row per case with the value its note gives.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Predicate, Result, Schema } from "effect";
import * as Commit from "../Commit.ts";
import * as Diff from "../Diff.ts";
import catFile from "../fixtures/cat-file-2.40.1.json" with { type: "json" };
import diffTreePatch from "../fixtures/diff-tree-patch-2.40.1.json" with { type: "json" };
import diffTreeRaw from "../fixtures/diff-tree-raw-2.40.1.json" with { type: "json" };
import forEachRef from "../fixtures/for-each-ref-2.40.1.json" with { type: "json" };
import lsTree from "../fixtures/ls-tree-2.40.1.json" with { type: "json" };
import { commitIdArb, ModelDiff } from "../History.test-support.ts";
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

// Bytes the way git prints them: one byte for each character below U+0100.
const latin1 = (text: string): Uint8Array => Uint8Array.from(text, (character) => character.charCodeAt(0));

// The one-line row of the recording, to cut or bend by hand: the ids, a raw entry for a path, and the header of its section.
const before = "de980441c3ab03a8c07dda1ad27b8a11f39deb1e";

const after = "7be73ce3c1b1cdaea86e8168dfee8575175953bf";

const rawEntry = (path: string): Uint8Array => latin1(`:100644 100644 ${before} ${after} M\0${path}\0`);

const header = (path: string): string =>
  `diff --git a/${path} b/${path}\nindex ${before}..${after} 100644\n--- a/${path}\n+++ b/${path}\n`;

// Plant: read the text after a hunk header's second `@@` as a line; delete the section count check, so a raw list with more or
// fewer entries than the patch has sections still reads; stop a hunk at a line that looks like a header; name the last file in the
// raw list and not the failing one; strip the line end of every line; number every line from 1, or a removed line in the new file;
// decode a line with replacement, so the latin-1 rows read; read a binary file's bytes as lines; read a type change as one section.
// A path that is no path of a tree is unreadable: drop the path mapper. A raw entry of a tree's mode is unreadable too: drop the
// entry mapper. A line that starts with a BOM keeps it: decode with `ignoreBOM: false`.
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

  // Rows made by hand. Git never prints these, so no recording holds them.
  // A line that is not UTF-8 in a file whose raw path is no path of a tree names no file, so it is unreadable.
  const gitPath = Parse.changes(rawEntry(".git"));
  expect(Result.isSuccess(gitPath), "hand-made: the raw list of the path row reads").toBe(true);

  if (Result.isSuccess(gitPath)) {
    expect(
      unreadable(Parse.patch(gitPath.success, latin1(`${header(".git")}@@ -1 +1 @@\n-\u00ff\n+B\n`))),
      "hand-made: a line that is not UTF-8 in a file whose raw path is no path of a tree is unreadable",
    ).toBe(true);
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

  // An entry that lacks a side its status needs is unreadable, and never a throw: a new file with no new side, a deleted file with
  // no old side, a changed file with no old side, and a type change with no new side.
  const bare = (status: Parse.Change["status"], side: "before" | "after" | "both"): Parse.Change => ({
    status,
    path: "a",
    ...(side === "after" || side === "both" ? { after: { mode: "100644", id: after } } : {}),
    ...(side === "before" || side === "both" ? { before: { mode: "100644", id: before } } : {}),
    gitlink: false,
  });

  for (const [note, lacking, kept] of [
    ["a new file with no new side", "A", "before"],
    ["a deleted file with no old side", "D", "after"],
    ["a changed file with no old side", "M", "after"],
    ["a changed file with no new side", "M", "before"],
    ["a type change with no old side", "T", "after"],
  ] as const) {
    expect(unreadable(Parse.files([[bare(lacking, kept), empty]])), `hand-made: ${note} is unreadable`).toBe(true);
  }

  expect(
    Result.isSuccess(Parse.files([[bare("M", "both"), empty]])),
    "hand-made: a changed file with both sides reads",
  ).toBe(true);
});

const int = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

// The recorded patches that git printed and `parse.patch` reads, each with its raw list and what it reads to.
const readable = Schema.decodeUnknownSync(DiffTreePatch)(diffTreePatch).rows.flatMap((row) => {
  const listed = Parse.changes(fromBase64(row.raw));
  const output = fromBase64(row.output);

  return "failure" in row.expect || !Result.isSuccess(listed) || output.length === 0
    ? []
    : [{ note: row.note, changed: listed.success, output, expect: row.expect }];
});

type Reading = ReturnType<typeof encodeContents>;

const text = (octets: Uint8Array): string => String.fromCharCode(...octets);

// A patch as its lines, each without its newline; the last item is what follows the last newline, which is nothing for a whole patch.
const splitPatch = (octets: Uint8Array): ReadonlyArray<string> => text(octets).split("\n");

const joinLines = (lines: ReadonlyArray<string>): Uint8Array => latin1(lines.join("\n"));

const sectionStarts = (lines: ReadonlyArray<string>): ReadonlyArray<number> =>
  lines.flatMap((line, at) => (line.startsWith("diff --git ") ? [at] : []));

// The lines of a section's header that `parse.patch` does not read: all but its first, up to its first hunk, and not the marker
// of a binary file, which it does read.
const quietHeaders = (lines: ReadonlyArray<string>): ReadonlyArray<number> => {
  const starts = sectionStarts(lines);

  return starts.flatMap((start, n) => {
    const end = starts[n + 1] ?? lines.length;
    const hunk = lines.findIndex((line, at) => at > start && at < end && line.startsWith("@@ "));
    const stop = hunk === -1 ? end : hunk;

    return lines.flatMap((line, at) =>
      at > start && at < stop && !line.startsWith("Binary files ") && line !== "" ? [at] : [],
    );
  });
};

const hunkHeaders = (lines: ReadonlyArray<string>): ReadonlyArray<number> =>
  lines.flatMap((line, at) => (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line) ? [at] : []));

const without = (lines: ReadonlyArray<string>, at: number): ReadonlyArray<string> => lines.filter((_, i) => i !== at);

const inserted = (lines: ReadonlyArray<string>, at: number, line: string): ReadonlyArray<string> => [
  ...lines.slice(0, at),
  line,
  ...lines.slice(at),
];

// The last line may lose or gain its end where the marker is cut off, so it is compared without its end.
const bare = (line: string): string => line.replace(/\r?\n$/, "");

// Whether a reading is a shorter reading of another: the same files, each but the last the same, and the last a binary file read
// as a file with no line (its marker is cut) or a text file with the first lines of the whole one.
const isShorterReading = (whole: Reading, got: Reading): boolean => {
  const last = whole.length - 1;

  if (
    got.length !== whole.length ||
    !got.slice(0, last).every((each, at) => JSON.stringify(each) === JSON.stringify(whole[at]))
  ) {
    return false;
  }

  const [kept, cut] = [whole[last], got[last]];

  if (kept === undefined || cut === undefined || !Predicate.isTagged(cut, "Text")) {
    return JSON.stringify(kept) === JSON.stringify(cut);
  }

  const keptLines = Predicate.isTagged(kept, "Text") ? kept.lines : [];

  return (
    cut.lines.length <= keptLines.length &&
    cut.lines.every(
      (line, at) =>
        line._tag === keptLines[at]?._tag &&
        line.at === keptLines[at]?.at &&
        (at < cut.lines.length - 1
          ? line.text === keptLines[at]?.text
          : bare(line.text) === bare(keptLines[at]?.text ?? "")),
    )
  );
};

// The cases P18 draws. The mutation box caps a property's count to `MUTATE_RUNS`, so the tally below is read only after all of these.
const P18_RUNS = 400;

const tally = new Map<string, number>();

const counted = (kind: string): void => {
  tally.set(kind, (tally.get(kind) ?? 0) + 1);
};

// Plant: drop the final-newline check, so a patch cut inside a line reads that part of the line; drop the check that a hunk holds the
// lines its header counts, so a cut inside a hunk, or a count that is wrong, still reads; drop the section-header check, so a line
// before the first section or a section with no header still reads; drop the section count check, so a section lost or doubled still
// reads; drop the hunk-header check, so a header that is none reads with no start; read a side's lines with no prefix check, so a
// line of the other side reads as one of this side. Every one is read as a valid but wrong reading, or it throws.
it.prop(
  "P18 parse.patch: a patch cut at any byte or bent in one place is unreadable, or a shorter reading of the whole, and never throws",
  { row: int(0, 1_000_000), kind: int(0, 6), pick: int(0, 1_000_000), flip: int(0, 1), junk: int(0, 3) },
  ({ row, kind, pick, flip, junk }) => {
    counted("case");
    const chosen = readable[row % readable.length];
    expect(chosen, "a recorded row").toBeDefined();

    if (chosen === undefined) {
      return;
    }

    const { note, changed, output, expect: whole } = chosen;
    const lines = splitPatch(output);
    const starts = sectionStarts(lines);
    const here = (items: ReadonlyArray<number>): number => items[pick % Math.max(1, items.length)] ?? -1;

    const ask = (patch: Uint8Array) => {
      const read = Parse.patch(changed, patch);
      expect(Result.isSuccess(read) || unreadable(read), `${note}: a success, or Unreadable and no other failure`).toBe(
        true,
      );

      return read;
    };

    // A cut at any byte, or at the end of any line: unreadable, or a shorter reading of the whole. A cut that keeps every section
    // and loses only whole hunks, or the header of the last section after its first line, leaves a patch that is valid and holds
    // fewer lines: nothing in a patch says a later hunk was there. A cut inside a hunk or a line, or one that loses a whole section,
    // is no patch of the raw list.
    if (kind === 0) {
      counted("cut");
      const ends = lines.map((_, at) => lines.slice(0, at).reduce((total, line) => total + line.length + 1, 0));
      const read = ask(output.subarray(0, flip === 0 ? (ends[pick % ends.length] ?? 0) : pick % (output.length + 1)));

      if (Result.isSuccess(read)) {
        counted("cut: a shorter reading");
        expect(
          isShorterReading(Schema.encodeSync(Schema.Array(ModelDiff.Content))(whole), encodeContents(read.success)),
          `${note}: a shorter reading`,
        ).toBe(true);
      }

      return;
    }

    // A section's `diff --git` line lost or doubled: a section is lost, or one is added with nothing in it, which no raw list has.
    if (kind === 1 || kind === 2) {
      const at = here(starts);
      counted(kind === 1 ? "drop a section line" : "double a section line");
      expect(
        unreadable(ask(joinLines(kind === 1 ? without(lines, at) : inserted(lines, at, lines[at] ?? "")))),
        `${note}: unreadable`,
      ).toBe(true);

      return;
    }

    // A header line that is not read, lost or doubled: the reading is the whole's or none. The reader reads a section's file from the
    // raw list and its lines from its hunks, so a line between its first line and its first hunk is ignored.
    if (kind === 3) {
      const at = here(quietHeaders(lines));

      if (at !== -1) {
        counted("a quiet header line");
        const read = ask(joinLines(flip === 0 ? without(lines, at) : inserted(lines, at, lines[at] ?? "")));

        if (Result.isSuccess(read)) {
          expect(encodeContents(read.success), `${note}: the same reading`).toEqual(whole);
        }
      }

      return;
    }

    // A hunk's count made one more or one less: the hunk holds more or fewer lines than the header says.
    if (kind === 4) {
      const at = here(hunkHeaders(lines));

      if (at !== -1) {
        const [, oldStart = "", oldCount, newStart = "", newCount, rest = ""] =
          /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(lines[at] ?? "") ?? [];

        const bend = (count: string | undefined): number =>
          (count === undefined ? 1 : Number(count)) + (flip === 0 || count === "0" ? 1 : -1);

        const [oldNext, newNext] = pick % 2 === 0 ? [bend(oldCount), newCount] : [oldCount, bend(newCount)];

        // A header whose numbers are no numbers: it is no header, so the lines after it are no hunk.
        if (junk === 0) {
          counted("a hunk header that is none");
          const bent = joinLines([...lines.slice(0, at), `@@ -x +y @@${rest}`, ...lines.slice(at + 1)]);
          expect(unreadable(ask(bent)), `${note}: unreadable`).toBe(true);

          return;
        }

        counted("a hunk count");

        expect(
          unreadable(
            ask(
              joinLines([
                ...lines.slice(0, at),
                `@@ -${oldStart},${oldNext ?? 1} +${newStart},${newNext ?? 1} @@${rest}`,
                ...lines.slice(at + 1),
              ]),
            ),
          ),
          `${note}: unreadable`,
        ).toBe(true);
      }

      return;
    }

    // A partial row after the last section, with no end of line: the patch was cut there, whatever the row holds.
    if (kind === 6) {
      counted("a partial row at the end");
      expect(
        unreadable(ask(latin1(`${text(output)}${["x", "+x", "@@ -1", "diff --git"][junk] ?? "x"}`))),
        `${note}: unreadable`,
      ).toBe(true);

      return;
    }

    // A line of junk before a section: the reader ignores it between a section with no hunk and the next, and fails anywhere else.
    const at = here(starts);
    counted("junk before a section");
    const read = ask(joinLines(inserted(lines, at, ["junk", "@@ junk", "+junk", "-junk"][junk] ?? "junk")));

    if (Result.isSuccess(read)) {
      expect(encodeContents(read.success), `${note}: the same reading`).toEqual(whole);
    }
  },
  { arbitrary: { runs: P18_RUNS, seed: 119120 } },
);

// The rows of P18 that were first found by hand, each the one-line row of the recording cut or bent, kept as they are.
it("pinned: P18 a patch with a partial row after its last section, a marker with no line before it, a section with no header, a hunk header that is none, and a side with a line of the other side are each unreadable", () => {
  const rows: ReadonlyArray<readonly [string, string]> = [
    [
      "a partial row after the last section has no final newline, and is not dropped",
      `${header("a")}@@ -2 +2 @@ a\n-b\n+B\nx`,
    ],
    [
      "a `\\ No newline` marker with no line before it, after a hunk side of zero lines",
      `${header("a")}@@ -0,0 +2 @@ a\n\\ No newline at end of file\n+B\n`,
    ],
    [
      "a section that does not start with `diff --git`, its header lines replaced by one line of text",
      "garbage\n@@ -2 +2 @@ a\n-b\n+B\n",
    ],
    ["a hunk header that is no header, a line of text that starts with `@@ `", `${header("a")}@@ -x +y @@\n-b\n+B\n`],
    ["the new side of a hunk holds a line that is not an added line", `${header("a")}@@ -2,0 +2 @@ a\n-b\n`],
    ["the old side of a hunk holds a line that is not a removed line", `${header("a")}@@ -2 +2,0 @@ a\n+B\n`],
  ];

  const listed = Parse.changes(rawEntry("a"));
  expect(Result.isSuccess(listed), "the raw list reads").toBe(true);

  for (const [note, patch] of rows) {
    if (Result.isSuccess(listed)) {
      expect(unreadable(Parse.patch(listed.success, latin1(patch))), `${note}: is unreadable`).toBe(true);
    }
  }

  // When the law above ran in this file, it drew exactly the cases it was given: its own count, or the box's cap when that is
  // smaller. Each kind of cut or bend was drawn, and a cut read as a shorter reading at least once, but only a full run can say so:
  // a capped run draws too few cases to reach every kind, so it skips the kinds. Both numbers are asserted, so a lost counter, a
  // gate that moved or a count that changed fails here and never skips quietly.
  if (tally.size > 0) {
    const drawn = tally.get("case") ?? 0;
    const cap = Number(process.env.MUTATE_RUNS) || P18_RUNS;
    const full = drawn >= P18_RUNS;
    expect(drawn, "P18 drew its cases").toBe(Math.min(P18_RUNS, cap));
    expect(full, "P18 is read at full depth only").toBe(cap >= P18_RUNS);

    if (!full) {
      return;
    }

    for (const kind of [
      "cut",
      "cut: a shorter reading",
      "drop a section line",
      "double a section line",
      "a quiet header line",
      "a hunk count",
      "a hunk header that is none",
      "junk before a section",
      "a partial row at the end",
    ]) {
      expect(tally.get(kind) ?? 0, `${kind}: drawn`).toBeGreaterThan(0);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Ticket 1935, slice 1: the reader of `ls-tree -z`. The build exports `Parse.listing(output)`, which answers each entry as
// `{ mode, type, id, name, line }`: the mode and the type as printed, the id, the name as the bytes git printed, and the whole
// entry's bytes without its closing NUL.
// ---------------------------------------------------------------------------------------------------------------------

const ListedRow = Schema.Struct({ mode: Schema.String, type: Schema.String, id: Schema.String, name: Schema.String });

const LsTree = Schema.Struct({
  git: Schema.String,
  command: Schema.String,
  rows: Schema.Array(Schema.Struct({ note: Schema.String, output: Schema.String, expect: Schema.Array(ListedRow) })),
});

const toBase64 = (octets: Uint8Array): string => Buffer.from(octets).toString("base64");

// The entries of an output as the bytes between its NULs, split here and not by the reader.
const entryBytes = (output: Uint8Array): ReadonlyArray<Uint8Array> => {
  const found: Array<Uint8Array> = [];

  for (let start = 0, end = output.indexOf(0); end !== -1; start = end + 1, end = output.indexOf(0, start)) {
    found.push(output.subarray(start, end));
  }

  return found;
};

// Plant: read the mode as a number, so `040000` comes back as `40000`; split the head at the last space before the tab; read the
// name as text, so the byte 0xff is lost; read the name up to the next space or tab; quote or unquote a name; sort the entries.
it("P21 vector: parse.listing reads every ls-tree -z output recorded from git to the entries its note gives: each mode and type, names with a space, a tab, a line break, an accent and a byte 0xff", () => {
  const recorded = Schema.decodeUnknownSync(LsTree)(lsTree);
  expect(recorded.git).toContain("git version");
  expect(recorded.rows.length).toBeGreaterThan(6);

  const entries = recorded.rows.flatMap((row) => row.expect);
  expect(new Set(entries.map((each) => each.mode)), "the rows hold every mode").toEqual(
    new Set(["100644", "100755", "120000", "040000", "160000"]),
  );
  expect(new Set(entries.map((each) => each.type)), "the rows hold every type").toEqual(
    new Set(["blob", "tree", "commit"]),
  );

  const names = entries.map((each) => fromBase64(each.name));
  expect(
    names.some((name) => name.includes(0xff)),
    "the rows hold a name with the byte 0xff",
  ).toBe(true);

  for (const byte of [0x20, 0x09, 0x0a]) {
    expect(
      names.some((name) => name.length > 1 && name.includes(byte)),
      `the rows hold a name with the byte ${byte}`,
    ).toBe(true);
  }

  for (const row of recorded.rows) {
    const output = fromBase64(row.output);
    const result = Parse.listing(output);
    expect(Result.isSuccess(result), `${row.note}: reads`).toBe(true);

    if (Result.isSuccess(result)) {
      expect(
        result.success.map((each) => ({ mode: each.mode, type: each.type, id: each.id, name: toBase64(each.name) })),
        row.note,
      ).toEqual(row.expect);
      expect(
        result.success.map((each) => toBase64(each.line)),
        `${row.note}: each raw line`,
      ).toEqual(entryBytes(output).map(toBase64));
    }
  }
});

const MODES = [
  ["100644", "blob"],
  ["100755", "blob"],
  ["120000", "blob"],
  ["040000", "tree"],
  ["160000", "commit"],
] as const;

// What a name is made of: letters, a space, a tab, a line break, a backslash, a quote, a dash, a dot, an accent, a byte that is not
// UTF-8, a UTF-8 sequence cut short and a character outside the Basic Multilingual Plane. Never a NUL or a slash.
const ATOMS: ReadonlyArray<ReadonlyArray<number>> = [
  [0x61],
  [0x62],
  [0x20],
  [0x09],
  [0x0a],
  [0x5c],
  [0x22],
  [0x2d],
  [0x2e],
  [0xc3, 0xa9],
  [0xff],
  [0xe2, 0x82],
  [0xf0, 0x9f, 0x98, 0x80],
];

const nameArb: Arbitrary.Arbitrary<ReadonlyArray<number>> = Arbitrary.array(int(0, ATOMS.length - 1), {
  minLength: 1,
  maxLength: 6,
}).pipe(Arbitrary.map((picks) => picks.flatMap((pick) => ATOMS[pick] ?? [])));

interface Drawn {
  readonly mode: string;
  readonly type: string;
  readonly id: string;
  readonly name: ReadonlyArray<number>;
}

const drawnArb: Arbitrary.Arbitrary<Drawn> = Arbitrary.all({
  mode: int(0, MODES.length - 1),
  id: commitIdArb,
  name: nameArb,
}).pipe(
  Arbitrary.map(({ mode, id, name }) => ({
    mode: MODES[mode]?.[0] ?? "100644",
    type: MODES[mode]?.[1] ?? "blob",
    id,
    name,
  })),
);

// One entry as git prints it, with its closing NUL or not.
const printedEntry = (each: Drawn, closed = true): Uint8Array =>
  Uint8Array.from([...latin1(`${each.mode} ${each.type} ${each.id}\t`), ...each.name, ...(closed ? [0] : [])]);

const joinedBytes = (parts: ReadonlyArray<Uint8Array>): Uint8Array =>
  Uint8Array.from(parts.flatMap((part) => [...part]));

// Plant: split a line at its last space before the tab, so a name with a space is cut, (v) red; read a name as text, so the byte
// 0xff is lost, (v) red; take the name up to the next tab; drop the check that an entry ends with its NUL, so a cut listing reads;
// drop the check on the id's length, so a short id reads.
it.prop(
  "P20 parse.listing: any drawn folder's ls-tree -z bytes read back to the same entries, each with its raw line; a listing cut at any byte or bent is unreadable or a shorter reading, and never throws",
  {
    rows: Arbitrary.array(drawnArb, { minLength: 0, maxLength: 8 }),
    pick: int(0, 1_000_000),
    second: int(0, 1_000_000),
  },
  ({ rows, pick, second }) => {
    const printed = rows.map((each) => printedEntry(each));
    const whole = joinedBytes(printed);
    const read = Parse.listing(whole);
    expect(Result.isSuccess(read), "the whole listing reads").toBe(true);

    if (Result.isSuccess(read)) {
      expect(
        read.success.map((each) => ({
          mode: each.mode,
          type: each.type,
          id: each.id,
          name: [...each.name],
          line: [...each.line],
        })),
        "the same entries, each with its raw line",
      ).toEqual(
        rows.map((each, i) => ({
          ...each,
          name: [...each.name],
          line: [...(printed[i] ?? new Uint8Array()).subarray(0, -1)],
        })),
      );
    }

    // A cut at any byte: at the end of an entry it is a shorter listing; anywhere else the last entry has no NUL and is unreadable.
    const cut = pick % (whole.length + 1);
    const ends = [0];

    for (const entry of printed) {
      ends.push((ends.at(-1) ?? 0) + entry.length);
    }

    const result = Parse.listing(whole.subarray(0, cut));

    if (ends.includes(cut)) {
      const kept = ends.indexOf(cut);
      expect(Result.isSuccess(result), `a cut after ${kept} entries reads`).toBe(true);

      if (Result.isSuccess(result)) {
        expect(
          result.success.map((each) => [...each.name]),
          "the first entries",
        ).toEqual(rows.slice(0, kept).map((each) => [...each.name]));
      }
    } else {
      expect(unreadable(result), `a cut inside an entry (byte ${cut}) is unreadable`).toBe(true);
    }

    // A bend in one entry, drawn by the second number: a short id and a lost tab are unreadable, a lost NUL joins two entries.
    const at = rows.length === 0 ? -1 : second % rows.length;
    const target = rows[at];

    if (target !== undefined) {
      const around = (entry: Uint8Array) => joinedBytes(printed.map((each, i) => (i === at ? entry : each)));

      const shortId = joinedBytes([
        latin1(`${target.mode} ${target.type} ${target.id.slice(1)}\t`),
        Uint8Array.from([...target.name, 0]),
      ]);

      expect(unreadable(Parse.listing(around(shortId))), "an id one digit short is unreadable").toBe(true);

      const noTab = joinedBytes([
        latin1(`${target.mode} ${target.type} ${target.id} `),
        Uint8Array.from([...target.name, 0]),
      ]);

      expect(unreadable(Parse.listing(around(noTab))), "a tab replaced by a space is unreadable").toBe(true);

      const next = printed[at + 1];

      if (next !== undefined) {
        const joined = joinedBytes(printed.flatMap((each, i) => (i === at ? [each.subarray(0, -1)] : [each])));

        const lost = Parse.listing(joined);
        expect(Result.isSuccess(lost), "a lost NUL reads, as one entry whose name holds the next").toBe(true);

        if (Result.isSuccess(lost)) {
          expect(lost.success.length, "one entry fewer").toBe(rows.length - 1);
        }
      }
    }
  },
  { arbitrary: { runs: 300, seed: 119120 } },
);
