// The laws of the values (G1 to G8): a commit id, a ref name, a branch name, a commit and its signatures,
// the settings, a path in a tree, a tree id, a blob id and a file mode, and a patch id. Every class a generator must reach is applied to each run's drawn value, and the law
// names the classes it needs, so a class dropped from a generator fails here loudly.
import { expect, it } from "@effect/vitest";
import { Effect, Option, Result, Schema } from "effect";
import * as Commit from "./Commit.ts";
import * as CommitId from "./CommitId.ts";
import checkRefFormat from "./fixtures/check-ref-format-2.40.1.json" with { type: "json" };
import {
  DOT_GIT_FORMS,
  MODE_ACCEPT,
  MODE_REFUSALS,
  NEAR_DOT_GIT,
  PROTOTYPE_NAMES,
  pathAccepted,
  pathArb,
  pathRefused,
  branchAccepted,
  branchRefused,
  commitIdArb,
  ID_ACCEPT_CLASSES,
  ID_REFUSE_CLASSES,
  idRefusals,
  limitsArb,
  MESSAGE_CLASSES,
  messageVariants,
  partArb,
  flatSignatureArb,
  refAccepted,
  refRefused,
  SIGNATURE_CLASSES,
  signatureRefusals,
  signatureVariants,
  toPlain,
  wordArb,
} from "./History.test-support.ts";
import * as Ref from "./Ref.ts";
import { expectFailure } from "./Repository.test-support.ts";
import * as Settings from "./Settings.ts";
import * as Tree from "./Tree.ts";

const RUNS = { arbitrary: { runs: 200, seed: 119120 } };

const REF_ACCEPT_CLASSES = [
  "plain",
  "a character past U+024F inside the Basic Multilingual Plane",
  "a character from U+E000 to U+FFFF",
  "a character outside the Basic Multilingual Plane",
  "every ASCII mark git allows",
  "a lone @ part",
  "@ inside a part",
  "a dot inside a part",
  "a part starting with a dash",
  "a part HEAD",
  "a part of 200 bytes",
  "ten parts deep",
  "past 1000 characters in all",
  "a candidate ref",
  "a remote ref",
  "a tag ref",
  "two parts",
];

const REF_REFUSE_CLASSES = [
  "a part starting with a dot",
  "a part .",
  "a part ..",
  "a space",
  "a tab",
  "a line feed",
  "a carriage return",
  "DEL",
  "~",
  "^",
  ":",
  "?",
  "*",
  "[",
  "a backslash",
  "two dots",
  "@{",
  "the name @",
  "a part ending .lock",
  "a part .lock inside",
  "an empty part",
  "a leading slash",
  "a trailing slash",
  "a trailing dot",
  "a lone high surrogate inside",
  "a lone low surrogate inside",
  "a lone surrogate at the end",
  "the empty text",
  "refs alone",
  "a name not under refs/",
  // every other control character, U+0000 to U+001F
  ...Array.from({ length: 32 }, (_, code) => code)
    .filter((code) => code !== 9 && code !== 10 && code !== 13)
    .map((code) => `the control character U+${code.toString(16).padStart(4, "0")}`),
];

// Accepted ref names that are not under refs/heads/, or that no branch name may start like.
const NOT_BRANCHES = [
  "a part starting with a dash",
  "ten parts deep",
  "a candidate ref",
  "a remote ref",
  "a tag ref",
  "two parts",
];

const classLabels = (rows: ReadonlyArray<readonly [string, string]>, suffix = /\s\(on .*\)$/): ReadonlyArray<string> =>
  [...new Set(rows.map(([label]) => label.replace(suffix, "")))].sort();

// Plant: allow `{40}|{64}` in the pattern; add the `i` flag; trim the text before checking it.
it.prop(
  "G1 commit ids: CommitId.from accepts 40 lowercase hex and refuses each other form with BadCommitId holding the text",
  { id: commitIdArb },
  ({ id }) => {
    expect(ID_ACCEPT_CLASSES, "the accepted classes").toEqual(["lowercase hex"]);
    expect(Result.getOrThrow(CommitId.from(id))).toBe(id);
    const refusals = idRefusals(id);
    expect(
      refusals.map(([label]) => label),
      "the generator reaches every refused class",
    ).toEqual(ID_REFUSE_CLASSES);

    for (const [label, text] of refusals) {
      const result = CommitId.from(text);
      expect(Result.isFailure(result), `${label} is refused`).toBe(true);

      if (Result.isFailure(result)) {
        expectFailure(result.failure, CommitId.BadCommitId, { text }, `${label} says what it refused`);
      }
    }
  },
  RUNS,
);

// Plant, one per class, each a wrong rule in Ref.ts: allow a part starting with `.`; allow a space, a tab
// or a line break; refuse any character past U+024F; cap a name at 255 characters; let `.lock` through
// inside a name (`x.lock/y`); accept a lone surrogate.
it.prop(
  "G2 ref names agree with git: Ref.from accepts each accepted class and refuses each refused class with BadRefName",
  { part: partArb },
  ({ part }) => {
    const accepted = refAccepted(part);
    expect(
      accepted.map(([label]) => label),
      "the generator reaches every accepted class",
    ).toEqual(REF_ACCEPT_CLASSES);
    expect(classLabels(refRefused(part)), "the generator reaches every refused class").toEqual(
      [...REF_REFUSE_CLASSES].sort(),
    );

    for (const [label, name] of accepted) {
      const result = Ref.from(name);
      expect(Result.isSuccess(result), `${label} is accepted: ${name}`).toBe(true);

      if (Result.isSuccess(result)) {
        expect(result.success).toBe(name);
      }
    }

    for (const [label, name] of refRefused(part)) {
      const result = Ref.from(name);
      expect(Result.isFailure(result), `${label} is refused: ${JSON.stringify(name)}`).toBe(true);

      if (Result.isFailure(result)) {
        expectFailure(result.failure, Ref.BadRefName, { text: name }, `${label} says what it refused`);
      }
    }
  },
  RUNS,
);

const Recorded = Schema.Struct({
  git: Schema.String,
  command: Schema.String,
  rows: Schema.Array(Schema.Struct({ name: Schema.String, accepted: Schema.Boolean })),
});

// vector: git 2.40.1's own `check-ref-format` answers, one row per name (every name starts with refs/ or is
// refused by git whatever its form). Plant: accept `refs` alone.
it("G2v vector: Ref.from gives git's answer on every recorded check-ref-format row", () => {
  const recorded = Schema.decodeUnknownSync(Recorded)(checkRefFormat);
  expect(recorded.git).toContain("git version");
  expect(recorded.rows.length, "the list is not empty").toBeGreaterThan(40);

  for (const row of recorded.rows) {
    expect(
      Result.isSuccess(Ref.from(row.name)),
      `git ${row.accepted ? "accepts" : "refuses"} ${JSON.stringify(row.name)}`,
    ).toBe(row.accepted);
  }
});

const branchName = (text: string): Ref.BranchName => Schema.decodeUnknownSync(Ref.BranchName)(text);

// Plant: allow a leading `-`; strip every `refs/heads/` in `fromRef`.
it.prop(
  "G3 branch names: Ref.branch accepts each accepted class and refuses -x, HEAD and the refused classes; toRef and fromRef agree",
  { part: partArb },
  ({ part }) => {
    expect(
      branchAccepted(part).map(([label]) => label),
      "the generator reaches every accepted class",
    ).toEqual([
      ...REF_ACCEPT_CLASSES.filter((label) => !NOT_BRANCHES.includes(label)),
      "a branch that is named like a ref",
    ]);
    const refused = branchRefused(part);
    expect(
      refused.map(([label]) => label),
      "the generator reaches the dash, HEAD and the empty name",
    ).toEqual(expect.arrayContaining(["a leading dash", "HEAD", "the empty name"]));

    for (const [label, text] of branchAccepted(part)) {
      const result = Ref.branch(text);
      expect(Result.isSuccess(result), `${label} is accepted: ${text}`).toBe(true);
      const name = branchName(text);
      expect(Ref.toRef(name), `${label}: its ref`).toBe(`refs/heads/${text}`);
      expect(Ref.fromRef(Ref.toRef(name)), `${label}: back to the branch`).toEqual(Option.some(name));
    }

    for (const [label, text] of refused) {
      const result = Ref.branch(text);
      expect(Result.isFailure(result), `${label} is refused: ${JSON.stringify(text)}`).toBe(true);

      if (Result.isFailure(result)) {
        expectFailure(result.failure, Ref.BadBranchName, { text }, "");
      }
    }

    for (const name of [`refs/tags/${part}`, `refs/kalfa/candidates/${part}`, `refs/remotes/origin/${part}`]) {
      expect(Ref.fromRef(Schema.decodeUnknownSync(Ref.RefName)(name)), `${name} is no branch`).toEqual(Option.none());
    }

    expect(
      Ref.fromRef(Schema.decodeUnknownSync(Ref.RefName)(`refs/heads/refs/heads/${part}`)),
      "only the first refs/heads/ is a prefix",
    ).toEqual(Option.some(branchName(`refs/heads/${part}`)));
  },
  RUNS,
);

// Plant: trim the message; store the offset as a number of minutes, so `-0000` comes back `+0000`; refuse an
// empty name or email; refuse a space at either end of a name; leave `tree` out of the value, so it does not come back.
it.prop(
  "G4 a commit's values: Commit and Signature round-trip every class and refuse what git's format cannot hold",
  { base: flatSignatureArb, word: wordArb, id: commitIdArb, parent: commitIdArb, tree: commitIdArb },
  ({ base, word, id, parent, tree }) => {
    const messages = messageVariants(word);
    const signatures = signatureVariants(base);
    expect(
      messages.map(([label]) => label),
      "the generator reaches every message class",
    ).toEqual(MESSAGE_CLASSES);
    expect(
      signatures.map(([label]) => label),
      "the generator reaches every signature class",
    ).toEqual(SIGNATURE_CLASSES);

    const plainCommit = (over: Partial<typeof Commit.Commit.Encoded>): typeof Commit.Commit.Encoded => ({
      id,
      tree,
      parents: [parent, id],
      author: toPlain(base),
      committer: toPlain(base),
      message: word,
      ...over,
    });

    const roundTrips = (label: string, plain: typeof Commit.Commit.Encoded): void => {
      const decoded = Schema.decodeUnknownResult(Commit.Commit)(plain);
      expect(Result.isSuccess(decoded), `${label} decodes`).toBe(true);

      if (Result.isSuccess(decoded)) {
        expect(Schema.encodeSync(Commit.Commit)(decoded.success), `${label} encodes back to what was read`).toEqual(
          plain,
        );
      }
    };

    for (const [label, message] of messages) {
      roundTrips(`message ${label}`, plainCommit({ message }));
    }

    for (const [label, flat] of signatures) {
      roundTrips(`author ${label}`, plainCommit({ author: toPlain(flat) }));
      roundTrips(`committer ${label}`, plainCommit({ committer: toPlain(flat) }));
      const alone = Schema.decodeUnknownSync(Commit.Signature)(toPlain(flat));
      expect(Schema.encodeSync(Commit.Signature)(alone), `${label} as a signature`).toEqual(toPlain(flat));
    }

    for (const [label, plain] of signatureRefusals(base)) {
      expect(Result.isFailure(Schema.decodeUnknownResult(Commit.Signature)(plain)), `${label} is refused`).toBe(true);
      expect(
        Result.isFailure(Schema.decodeUnknownResult(Commit.Commit)(plainCommit({ author: plain }))),
        `${label} is refused in a commit's author`,
      ).toBe(true);
    }
  },
  RUNS,
);

const decoded = Schema.decodeUnknownResult(Settings.Settings);

const KEYS = ["commits", "refs", "bytes", "files", "diff", "time"] as const;

const NOT_A_TIME = [
  ["zero seconds", "0 seconds"],
  ["zero milliseconds", "0 millis"],
  ["a word", "ten"],
  ["a bare number", 5],
  ["a bare number as text", "5"],
  ["a negative amount", "-5 seconds"],
  ["infinity, which has no end to wait for", "Infinity"],
  ["negative infinity", "-Infinity"],
  ["a unit with no amount", "seconds"],
  ["the empty text", ""],
] as const;

// Plant: give `commits` a default; drop the text check on `time`, so `"ten"` is accepted; drop the finite check on `time`,
// so `"Infinity"` is accepted; give `diff` a default; accept `files: 0` (a `files` that is any whole number); leave `files`
// out of the limits.
it.prop(
  "G5 settings: Settings accepts every positive count and duration text, refuses the rest, and has no default",
  { limits: limitsArb },
  ({ limits }) => {
    const good = {
      commits: limits.commits,
      refs: limits.refs,
      bytes: limits.bytes,
      files: limits.files,
      diff: limits.diff,
      time: limits.time,
    };

    expect(Result.isSuccess(decoded({ limits: good })), `${limits.time} is accepted`).toBe(true);

    for (const key of KEYS) {
      const { [key]: _gone, ...without } = good;
      expect(Result.isFailure(decoded({ limits: without })), `${key} missing is refused`).toBe(true);

      if (key !== "time") {
        for (const bad of [0, -limits.commits, limits.commits + 0.5]) {
          expect(Result.isFailure(decoded({ limits: { ...good, [key]: bad } })), `${key} of ${bad} is refused`).toBe(
            true,
          );
        }
      }
    }

    for (const [label, bad] of NOT_A_TIME) {
      expect(Result.isFailure(decoded({ limits: { ...good, time: bad } })), `${label} is refused as a time`).toBe(true);
    }

    expect(
      Result.isFailure(decoded({ limits: { ...good, time: `-${limits.time}` } })),
      "the negative of a good time",
    ).toBe(true);
    expect(Result.isFailure(decoded({})), "{} has no default").toBe(true);
    expect(Result.isFailure(decoded({ limits: {} })), "{ limits: {} } has no default").toBe(true);
  },
  { arbitrary: { runs: 100, seed: 119120 } },
);

const NOT_DOT_GIT = [
  "an empty part: the empty text",
  "an empty part: a leading slash",
  "an empty part: a trailing slash",
  "an empty part: two slashes inside",
  "a part .: alone",
  "a part .: first",
  "a part .: inside",
  "a part .: last",
  "a part ..: alone",
  "a part ..: first",
  "a part ..: inside",
  "a part ..: last",
  "a NUL: inside a part",
  "a NUL: alone as a part",
  "a NUL: first in a part",
  "a NUL: last in a path",
  "a lone surrogate: a high one inside",
  "a lone surrogate: a low one inside",
  "a lone surrogate: one at the end",
];

// Every part git's own check calls `.git` (`git fsck --strict` on git 2.40.1 answered `hasDotgit` for each one).
const DOT_GIT_PARTS = [
  ".git",
  ".GIT",
  ".Git",
  ".git ",
  ".git  ",
  ".git.",
  ".GIT. ",
  ".git .",
  "git~1",
  "GIT~1",
  "git~1 ",
  "git~1.",
  ".git:x",
  ".git:",
  ".g\u200Cit",
  ".g\u200Fit",
  ".g\u202Ait",
  ".g\u202Eit",
  ".g\u206Ait",
  ".g\u206Fit",
  ".g\uFEFFit",
  ".git\u200C",
  "\u200C.git",
  ".git\uFEFF",
  "\uFEFF.git",
  "x\\.git",
  ".git\\x",
  "x\\git~1",
  "git~1\\x",
  "x\\.GIT ",
  ".G\u200CIT",
  ".Gi\u202Et",
];

// Parts the same run showed git accepts, next to the ones above.
const NEAR_PARTS = [
  ".gitx",
  "git",
  "..a",
  "a.",
  ".git2",
  "git~2",
  "git~10",
  ".g\u200Bit",
  ".g\u2010it",
  ".g\u2029it",
  ".g\u202Fit",
  ".g\u2069it",
  ".g\u2070it",
  ".g\uFEFEit",
  "x\\.g\u200Cit",
  "\u200C.git\\x",
  ".git\u200C\\x",
  "x\\git~2",
];

const ACCEPTED_FIRST = [
  "plain",
  "a character past U+024F inside the Basic Multilingual Plane",
  "a character outside the Basic Multilingual Plane",
  "a character from U+E000 to U+FFFF",
  "a space",
  "a line break",
  "a tab and a carriage return",
  "a backslash",
  "a leading dash",
  "a leading quote",
  "a part of 300 bytes",
  "forty folders deep",
];

const decodePath = Schema.decodeUnknownResult(Tree.Path);

// Plant, one per class, each a wrong rule in Tree.ts: delete the empty-part rule; delete the `.` and `..` rule; delete
// the `.git` rule; compare `.git` case by case, so `.GIT` passes; keep the rule for `.git` and drop each other form's
// check in turn (a trailing space or dot, `git~1`, a stream name after a colon, each of the seven characters git's HFS
// check ignores, one before, inside and after); delete the NUL rule; delete the surrogate check; refuse characters past
// U+024F; refuse a part that starts with `.`, so `.gitx` is refused; refuse a part that starts with `_`.
it.prop(
  "G6 paths: Path accepts what git's tree can hold and refuses an empty part, `.`, `..`, every form of `.git`, a NUL and a lone surrogate",
  { path: pathArb },
  ({ path }) => {
    expect(
      DOT_GIT_FORMS.map(([, part]) => part),
      "the generator reaches every form of .git",
    ).toEqual(DOT_GIT_PARTS);
    expect(
      NEAR_DOT_GIT.map(([, part]) => part),
      "the generator reaches every part next to .git",
    ).toEqual(NEAR_PARTS);
    expect(PROTOTYPE_NAMES, "the names on the object prototype").toEqual([
      "__proto__",
      "constructor",
      "hasOwnProperty",
      "toString",
    ]);

    const accepted = pathAccepted(path);
    const refused = pathRefused(path);

    expect(
      accepted.slice(0, ACCEPTED_FIRST.length).map(([label]) => label),
      "the generator reaches every accepted class",
    ).toEqual(ACCEPTED_FIRST);
    expect(
      accepted.map(([, text]) => text),
      "the near parts and the prototype names are accepted at the top",
    ).toEqual(expect.arrayContaining([...NEAR_PARTS, ...PROTOTYPE_NAMES]));
    expect(
      refused.filter(([label]) => !label.startsWith(".git form")).map(([label]) => label),
      "the generator reaches every refused class",
    ).toEqual(NOT_DOT_GIT);
    expect(refused.length, "each form of .git at the top, as a folder and three folders deep").toBe(
      NOT_DOT_GIT.length + DOT_GIT_PARTS.length * 3,
    );

    for (const [label, text] of accepted) {
      const result = decodePath(text);
      expect(Result.isSuccess(result), `${label} is accepted: ${JSON.stringify(text)}`).toBe(true);

      if (Result.isSuccess(result)) {
        expect(result.success, `${label} is kept as it was`).toBe(text);
      }
    }

    for (const [label, text] of refused) {
      expect(Result.isFailure(decodePath(text)), `${label} is refused: ${JSON.stringify(text)}`).toBe(true);
    }
  },
  RUNS,
);

// Plant: drop the pattern from `BlobId` and keep its brand; drop it from `TreeId`; accept `644`; accept `160000`; type
// `Commit.tree` as a plain string.
it.prop(
  "G7 ids, modes and a commit's tree: TreeId and BlobId accept 40 lowercase hex and refuse each wrong form; Mode and Entry accept the three file kinds only; a commit's tree is a TreeId",
  { id: commitIdArb, tree: commitIdArb, base: flatSignatureArb, word: wordArb },
  ({ id, tree, base, word }) => {
    const refusals = idRefusals(id);
    expect(
      refusals.map(([label]) => label),
      "the generator reaches every refused form",
    ).toEqual(ID_REFUSE_CLASSES);

    const ids: ReadonlyArray<readonly [string, (text: string) => Result.Result<unknown, unknown>]> = [
      ["TreeId", Schema.decodeUnknownResult(Tree.TreeId)],
      ["BlobId", Schema.decodeUnknownResult(Tree.BlobId)],
    ];

    for (const [name, decode] of ids) {
      const good = decode(id);
      expect(Result.isSuccess(good), `${name} accepts lowercase hex`).toBe(true);

      if (Result.isSuccess(good)) {
        expect(good.success, `${name} keeps the text`).toBe(id);
      }

      for (const [label, text] of refusals) {
        expect(Result.isFailure(decode(text)), `${name} refuses ${label}`).toBe(true);
      }
    }

    expect(MODE_ACCEPT, "the accepted file kinds").toEqual(["100644", "100755", "120000"]);
    expect(MODE_REFUSALS.map(([label]) => label)).toEqual([
      "a submodule",
      "a folder with a leading zero",
      "a folder",
      "a mode with three digits",
      "a mode git does not write",
      "the empty text",
    ]);

    for (const mode of MODE_ACCEPT) {
      expect(Schema.decodeUnknownSync(Tree.Mode)(mode), `${mode} is a mode`).toBe(mode);
      const entry = Schema.decodeUnknownSync(Tree.Entry)({ mode, blob: id });
      expect(Schema.encodeSync(Tree.Entry)(entry), `${mode} with its blob comes back`).toEqual({ mode, blob: id });
    }

    for (const [label, mode] of MODE_REFUSALS) {
      expect(Result.isFailure(Schema.decodeUnknownResult(Tree.Mode)(mode)), `${label} is no mode`).toBe(true);
      expect(Result.isFailure(Schema.decodeUnknownResult(Tree.Entry)({ mode, blob: id })), `${label} is no entry`).toBe(
        true,
      );
    }

    for (const [label, text] of refusals) {
      expect(
        Result.isFailure(Schema.decodeUnknownResult(Tree.Entry)({ mode: "100644", blob: text })),
        `an entry refuses a blob id with ${label}`,
      ).toBe(true);
    }

    const plain = {
      id,
      tree,
      parents: [],
      author: toPlain(base),
      committer: toPlain(base),
      message: word,
    };

    const kept = Schema.decodeUnknownResult(Commit.Commit)(plain);
    expect(Result.isSuccess(kept), "a commit with a tree decodes").toBe(true);

    if (Result.isSuccess(kept)) {
      expect(kept.success.tree, "the tree is kept").toBe(tree);
    }

    const { tree: _gone, ...without } = plain;
    expect(
      Result.isFailure(Schema.decodeUnknownResult(Commit.Commit)(without)),
      "a commit with no tree is refused",
    ).toBe(true);

    for (const [label, text] of refusals) {
      expect(
        Result.isFailure(Schema.decodeUnknownResult(Commit.Commit)({ ...plain, tree: text })),
        `a commit whose tree is ${label} is refused`,
      ).toBe(true);
    }
  },
  RUNS,
);

// Plant: allow `{40}|{64}` in the pattern; add the `i` flag; drop the pattern from `PatchId` and keep its brand. The module is
// imported inside the law, so a module that is not built yet fails this law and not every law of the file.
it.effect.prop(
  "G8 patch ids: PatchId accepts 40 lowercase hex and refuses each other form, and keeps the text",
  { id: commitIdArb },
  ({ id }) =>
    Effect.gen(function* () {
      const Diff = yield* Effect.orDie(Effect.tryPromise({ try: () => import("./Diff.ts"), catch: (cause) => cause }));
      const refusals = idRefusals(id);
      expect(
        refusals.map(([label]) => label),
        "the generator reaches every refused form",
      ).toEqual(ID_REFUSE_CLASSES);

      const decode = Schema.decodeUnknownResult(Diff.PatchId);
      const good = decode(id);
      expect(Result.isSuccess(good), "lowercase hex is a patch id").toBe(true);

      if (Result.isSuccess(good)) {
        expect(good.success, "the text is kept").toBe(id);
      }

      for (const [label, text] of refusals) {
        expect(Result.isFailure(decode(text)), `${label} is refused`).toBe(true);
      }
    }),
  RUNS,
);
