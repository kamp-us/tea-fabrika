// The laws of the values (G1 to G5): a commit id, a ref name, a branch name, a commit and its signatures,
// and the settings. Every class a generator must reach is applied to each run's drawn value, and the law
// names the classes it needs, so a class dropped from a generator fails here loudly.
import { expect, it } from "@effect/vitest";
import { Option, Result, Schema } from "effect";
import * as Commit from "./Commit.ts";
import * as CommitId from "./CommitId.ts";
import checkRefFormat from "./fixtures/check-ref-format-2.40.1.json" with { type: "json" };
import {
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
// empty name or email; refuse a space at either end of a name.
it.prop(
  "G4 a commit's values: Commit and Signature round-trip every class and refuse what git's format cannot hold",
  { base: flatSignatureArb, word: wordArb, id: commitIdArb, parent: commitIdArb },
  ({ base, word, id, parent }) => {
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

const KEYS = ["commits", "refs", "bytes", "time"] as const;

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
// so `"Infinity"` is accepted.
it.prop(
  "G5 settings: Settings accepts every positive count and duration text, refuses the rest, and has no default",
  { limits: limitsArb },
  ({ limits }) => {
    const good = { commits: limits.commits, refs: limits.refs, bytes: limits.bytes, time: limits.time };
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
