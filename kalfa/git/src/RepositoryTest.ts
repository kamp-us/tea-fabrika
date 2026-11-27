// The laws every adapter of `Repository` passes (S1 to S24), exported as `/test`. A runner gives a
// `Subject`: how to seed a history into its own kind of store. The suite draws a texture, makes one
// history for each shape class from it, seeds each, and compares every answer with the model in
// History.test-support.ts. A subject that passes these laws answers as every other one does.
import { describe, expect, it } from "@effect/vitest";
import type { Tracer } from "effect";
import { Effect, Option, Predicate, Result, Schema, type Scope } from "effect";
import * as Commit from "./Commit.ts";
import type * as CommitId from "./CommitId.ts";
import * as Diff from "./Diff.ts";
import {
  CONFLICT_MERGE_CLASSES,
  MERGE_CLASSES,
  MESSAGE_CLASSES,
  SIGNATURE_CLASSES,
  asWritten,
  basesModel,
  committerAccepted,
  committerFrom,
  edgeMessages,
  messageVariants,
  MOVE,
  moveCarrier,
  NUL_CLASSES,
  nulMessages,
  signatureVariants,
  writeSpecs,
  WRITE_SHAPE_CLASSES,
  writtenSize,
  changedFiles,
  comparedBytes,
  diffLines,
  diffModel,
  EDIT_CLASSES,
  editCarrier,
  LIMIT_CLASSES,
  limitCarrier,
  blobId,
  NAME_CLASSES,
  nameCarrier,
  READ_CLASSES,
  readCarrier,
  readModel,
  reachedReadClasses,
  textModel,
  type ReadCarrier,
  type ReadCase,
  type ReadModel,
  reachedEditClasses,
  withCanary,
  CARRIER_CLASSES,
  carrier,
  isAncestorModel,
  lineOrder,
  mergeCarrier,
  missingId,
  objectSize,
  PAIR_KINDS,
  drawPairs,
  parentsFirst,
  RANGE_CLASSES,
  RANGE_PATCH_CLASSES,
  rangeCarrier,
  drawRanges,
  refsModel,
  CANARY,
  SHAPE_CLASSES,
  cutShallow,
  sameFiles,
  shapes,
  textureArb,
  toPlain,
  TREE_CARRIER_CLASSES,
  TREE_ID,
  treeCarrier,
  refQueries,
  walkModel,
  CRISS,
  type DiffModel,
  editModel,
  reachedTreeEditClasses,
  TREE_EDIT_CLASSES,
  treeEditCarrier,
  type EditCarrier,
  type EditCase,
  type EditModel,
  type FileSpec,
  type FlatSignature,
  type TreeEditCarrier,
  type TreeEditCase,
  type Committer,
  type History,
  type MergeCase,
  type Shape,
  type Texture,
} from "./History.test-support.ts";
import {
  clockAt,
  commitIdFrom,
  editFrom,
  conflictPaths,
  encodeCommit,
  expectedRefs,
  expectedWrite,
  expectNamedSpan,
  failed,
  flatAt,
  idAt,
  isTooShort,
  mergeArgs,
  mergedTree,
  numAt,
  plainRefs,
  readRefsBack,
  refNameFrom,
  seedEach,
  toSignature,
  traced,
  treeAt,
  type Fields,
} from "./Laws.test-support.ts";
import { COMMITTER, expectFailure } from "./Repository.test-support.ts";
import * as Repository from "./Repository.ts";
import * as Settings from "./Settings.ts";
import * as Tree from "./Tree.ts";

/** A seeded store: the service to ask, the id each history commit got, and what the laws may look at. */
export interface Seeded {
  readonly repository: Repository.Repository["Service"];
  /** The id of each commit of the history, by index. */
  readonly ids: ReadonlyArray<CommitId.CommitId>;
  /** The tree id of each commit of the history, by index, as the seeder's own store has it. */
  readonly trees: ReadonlyArray<Tree.TreeId>;
  /** Anything that changes when the store changes: a call must never change it (S10). */
  readonly fingerprint: Effect.Effect<unknown>;
  /** Text that must never appear in a span, such as the repository's path. */
  readonly hidden: ReadonlyArray<string>;
}

export interface Subject {
  readonly seed: (history: History, settings: Settings.Settings) => Effect.Effect<Seeded, never, Scope.Scope>;
}

export interface SuiteOptions {
  /** How many drawn textures each law checks. */
  readonly runs: number;
  /** The most one law may take, in milliseconds. */
  readonly timeout: number;
}

/** Settings with generous limits, the ones a law wants to push set, and the committer every written commit names. */
export const settings = (
  limits: {
    readonly commits?: number;
    readonly refs?: number;
    readonly bytes?: number;
    readonly files?: number;
    readonly diff?: number;
    readonly blob?: number;
    readonly time?: string;
    readonly kill?: string;
  } = {},
  committer: Committer = COMMITTER,
): Settings.Settings =>
  Schema.decodeUnknownSync(Settings.Settings)({
    limits: {
      commits: 1000,
      refs: 1000,
      bytes: 1_000_000,
      files: 1000,
      diff: 10_000_000,
      blob: 10_000_000,
      time: "10 seconds",
      kill: "5 seconds",
      ...limits,
    },
    committer,
  });

const nodeAt = (history: History, i: number): History["nodes"][number] => {
  const node = history.nodes[i];

  if (node === undefined) {
    throw new Error(`no commit ${i}`);
  }

  return node;
};

const nonEmpty = <A>(items: ReadonlyArray<A>): readonly [A, ...Array<A>] => {
  const [first, ...rest] = items;

  if (first === undefined) {
    throw new Error("a range needs one include");
  }

  return [first, ...rest];
};

/** What `readCommit` of commit `i` must answer, as plain data. */
const expectedCommit = (
  history: History,
  ids: ReadonlyArray<CommitId.CommitId>,
  trees: ReadonlyArray<Tree.TreeId>,
  i: number,
): typeof Commit.Commit.Encoded => {
  const node = history.nodes[i];

  if (node === undefined) {
    throw new Error(`no commit ${i}`);
  }

  return {
    id: idAt(ids, i),
    tree: treeAt(trees, i),
    parents: node.parents.map((parent) => idAt(ids, parent)),
    author: toPlain(node.author),
    committer: toPlain(node.committer),
    message: node.message,
  };
};

const sorted = (numbers: ReadonlyArray<number>): ReadonlyArray<number> => [...numbers].sort((a, b) => a - b);

const everyShape = (texture: Texture): ReadonlyArray<Shape> => {
  const all = shapes(texture);
  expect(
    all.map((shape) => shape.label),
    "the generator reaches every shape class",
  ).toEqual(SHAPE_CLASSES);

  return all;
};

const DEFAULT = settings();

/** The refusals S12 reaches in every run, one for each check a write passes before the store is touched. */
const REFUSAL_CLASSES = [
  ...NUL_CLASSES,
  "a tree the store lacks",
  "a commit's id given as the tree",
  "a parent the store lacks",
  "a tree's id given as a parent",
  "a parent the store lacks, second of two",
  "a parent the store lacks, first of two",
];

/** What S13 reaches in every run: the moves that succeed, then the moves refused. */
const MOVE_CLASSES = [
  "making a candidate ref",
  "making a remote ref",
  "moving a branch forward",
  "moving a branch back to an older commit",
  "moving a branch to the commit it is at",
  "from none while the ref exists",
  "from a commit while the ref is at another",
  "from a commit while the ref is gone",
  "making a ref inside a ref's name",
  "making a ref above two refs, which names the first by bytes",
  "to a commit the store lacks",
  "to a tree's id",
  "two moves from one commit at once",
];

// ---------------------------------------------------------------------------------------------------------
// The checks a few laws share
// ---------------------------------------------------------------------------------------------------------

const readBack = (seeded: Seeded, history: History, label: string): Effect.Effect<void, unknown> =>
  Effect.forEach(
    history.nodes,
    (_, i) =>
      Effect.map(seeded.repository.readCommit(idAt(seeded.ids, i)), (commit) => {
        expect(encodeCommit(commit), `${label}: commit ${i}`).toEqual(
          expectedCommit(history, seeded.ids, seeded.trees, i),
        );
      }),
    { concurrency: 1 },
  );

const isMissing = Schema.is(Repository.NoSuchCommit);

const failure = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<E, never> => Effect.flip(effect).pipe(Effect.orDie);

/** What a span holds beyond what a call's arguments say, and what it must not hold. */
interface Extra {
  readonly present: Record<string, unknown>;
  readonly absent: ReadonlyArray<string>;
}

const NO_EXTRA: Extra = { present: {}, absent: [] };

const NOTHING_PATCHED: Extra = { present: {}, absent: ["kalfa.git.patch"] };

const patched = (id: Option.Option<string>): Extra =>
  Option.isSome(id) ? { present: { "kalfa.git.patch": id.value }, absent: [] } : NOTHING_PATCHED;

/** What a span of `diff` holds beyond its arguments: how many files and how many lines the answer has. */
const counted = (files: ReadonlyArray<typeof Diff.FileChange.Type>): Extra => ({
  present: {
    "kalfa.git.files": files.length,
    "kalfa.git.lines": files.reduce(
      (total, each) => total + (Predicate.isTagged(each.content, "Text") ? each.content.lines.length : 0),
      0,
    ),
  },
  absent: [],
});

/** The failure of a call that must fail: a call that answers is a failed law, with `label` to say which. */
const refused = <A, E>(effect: Effect.Effect<A, E>, label: string): Effect.Effect<E | undefined> =>
  Effect.map(Effect.result(effect), (result) => {
    expect(Result.isFailure(result), `${label} fails`).toBe(true);

    return Result.isFailure(result) ? result.failure : undefined;
  });

/** The answer of a call that must answer: a call that fails is a failed law, with `label` to say which. */
const answered = <A, E>(effect: Effect.Effect<A, E>, label: string): Effect.Effect<A | undefined> =>
  Effect.map(Effect.result(effect), (result) => {
    expect(Result.isSuccess(result), `${label} answers`).toBe(true);

    return Result.isSuccess(result) ? result.success : undefined;
  });

/** The patch id of each case of an edit carrier, in case order: the id, or undefined for no change. */
const patchIds = (seeded: Seeded, carrier: EditCarrier): Effect.Effect<ReadonlyArray<string | undefined>> =>
  Effect.forEach(
    carrier.cases,
    (each) =>
      Effect.map(
        answered(seeded.repository.patchId(idAt(seeded.ids, each.from), idAt(seeded.ids, each.to)), each.label),
        (id) => (id === undefined ? undefined : Option.getOrUndefined(id)),
      ),
    { concurrency: 1 },
  );

// Each is built when it is called, so a suite that is loaded before the product names exist still loads.
const encodeDiff = (files: Diff.Diff) => Schema.encodeSync(Schema.Array(Diff.FileChange))(files);

const isNotUtf8 = (error: unknown): error is Repository.NotUtf8 => Schema.is(Repository.NotUtf8)(error);

const isUnclear = (error: unknown): error is Repository.UnclearBase => Schema.is(Repository.UnclearBase)(error);

/** What a `diff` call came to, as plain data a law compares whole: the files, or the failure and, for `NotUtf8`, the path it names. */
type Outcome = { readonly files: ReadonlyArray<object> } | { readonly failure: string; readonly path?: string };

const diffResult = <E>(result: Result.Result<Diff.Diff, E>): Outcome => {
  if (Result.isSuccess(result)) {
    return { files: encodeDiff(result.success) };
  }

  const error: unknown = result.failure;

  return isNotUtf8(error) ? { failure: "NotUtf8", path: error.path } : { failure: "another failure" };
};

/** What the model says a `diff` call comes to. */
const expectedOutcome = (model: DiffModel): Outcome =>
  model.kind === "files" ? { files: model.files } : { failure: "NotUtf8", path: model.path };

/** The `diff` of one case of an edit carrier, which must be the model's answer exactly. */
const diffCase = (seeded: Seeded, each: EditCase): Effect.Effect<DiffModel> =>
  Effect.gen(function* () {
    const model = diffModel(each.before, each.after);
    const result = yield* Effect.result(seeded.repository.diff(idAt(seeded.ids, each.from), idAt(seeded.ids, each.to)));
    expect(diffResult(result), `${each.label}: the diff is the model's`).toEqual(expectedOutcome(model));

    return model;
  });

const everyEditClass = (carrier: EditCarrier): EditCarrier => {
  expect(reachedEditClasses(carrier), "the generator reaches every edit class").toEqual(EDIT_CLASSES);

  return carrier;
};

// ---------------------------------------------------------------------------------------------------------
// The checks the read laws share (ticket 1935, slice 1)
// ---------------------------------------------------------------------------------------------------------

const pathFrom = (text: string): Tree.Path => Schema.decodeUnknownSync(Tree.Path)(text);

/** What a read at one path comes to under a size limit: the model's answer, or a file too large to read. */
type ReadOutcome = ReadModel | { readonly kind: "too-large"; readonly path: string; readonly most: number };

const readOutcome = (model: ReadModel, path: string, limit: number): ReadOutcome =>
  model.kind === "file" && model.bytes.length > limit ? { kind: "too-large", path, most: limit } : model;

/** The answer of `readFile` or `readText` is the outcome: its bytes or text, none, or the failure and the fields it holds. */
const expectRead = <A, B>(
  place: string,
  result: Result.Result<Option.Option<A>, unknown>,
  outcome: ReadOutcome,
  unwrap: (found: A) => B,
  want: B | undefined,
): void => {
  if (outcome.kind === "not-a-file" || outcome.kind === "too-large") {
    expect(Result.isFailure(result), `${place}: fails`).toBe(true);

    if (Result.isFailure(result)) {
      if (outcome.kind === "not-a-file") {
        expectFailure(result.failure, Repository.NotAFile, { path: outcome.path, holds: outcome.holds }, place);
      } else {
        expectFailure(result.failure, Repository.FileTooLarge, { path: outcome.path, most: outcome.most }, place);
      }
    }

    return;
  }

  expect(Result.isSuccess(result), `${place}: answers`).toBe(true);

  if (Result.isSuccess(result)) {
    if (outcome.kind === "none") {
      expect(Option.isNone(result.success), `${place}: is none`).toBe(true);
    } else {
      expect(Option.isSome(result.success), `${place}: is a file`).toBe(true);
      expect(Option.map(result.success, unwrap), `${place}: the file as it is`).toEqual(Option.some(want));
    }
  }
};

/** Every read of a carrier on a seeded store, `readFile` and `readText` both, against the model under a limit on a file's size. */
const readAll = (
  seeded: Seeded,
  carrier: ReadCarrier,
  label: string,
  limit: number,
  kinds: { readonly raw?: boolean; readonly text?: boolean; readonly only?: (each: ReadCase) => boolean } = {},
): Effect.Effect<number> =>
  Effect.gen(function* () {
    let reads = 0;

    for (const each of carrier.cases.filter(kinds.only ?? (() => true))) {
      reads += 1;
      const commit = idAt(seeded.ids, each.commit);
      const place = `${label}: ${each.label}`;
      const outcome = readOutcome(each.expected, each.path, limit);

      if (kinds.raw !== false) {
        const raw = yield* Effect.result(seeded.repository.readFile(commit, pathFrom(each.path)));
        const bytes = each.expected.kind === "file" ? each.expected.bytes : undefined;
        expectRead(`${place}, readFile`, raw, outcome, (found) => found, bytes);
      }

      if (kinds.text === false) {
        continue;
      }

      const text = yield* Effect.result(seeded.repository.readText(commit, pathFrom(each.path)));
      const decoded = each.expected.kind === "file" ? textModel(each.expected.bytes) : undefined;

      if (outcome.kind === "file" && decoded === undefined) {
        expect(Result.isFailure(text), `${place}, readText: bytes that are not UTF-8 fail`).toBe(true);

        if (Result.isFailure(text)) {
          expectFailure(text.failure, Repository.NotUtf8, { path: each.path }, `${place}, readText`);
        }
      } else {
        expectRead(`${place}, readText`, text, outcome, (found) => found, decoded);
      }
    }

    return reads;
  });

/**
 * The reads that stand for the rest: the first `perClass` cases of each set of classes the generator drew, and every case `keep` names.
 * A law that asks git for each read takes these, since each read is a git command and the cases of one class repeat each other.
 */
const sampled = (
  carrier: ReadCarrier,
  perClass: number,
  keep: (each: ReadCase) => boolean = () => false,
): ((each: ReadCase) => boolean) => {
  const seen = new Map<string, number>();
  const chosen = new Set<ReadCase>();

  for (const each of carrier.cases) {
    const key = each.classes.join("|");
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);

    if (count < perClass || keep(each)) {
      chosen.add(each);
    }
  }

  return (each) => chosen.has(each);
};

const everyReadClass = (carrier: ReadCarrier, prefixes: ReadonlyArray<string>): ReadCarrier => {
  expect(
    reachedReadClasses(carrier).filter((label) => prefixes.some((prefix) => label.startsWith(prefix))),
    "the generator reaches every read class",
  ).toEqual(READ_CLASSES.filter((label) => prefixes.some((prefix) => label.startsWith(prefix))));

  return carrier;
};

// ---------------------------------------------------------------------------------------------------------
// The checks the edit laws share (ticket 1935, slice 2)
// ---------------------------------------------------------------------------------------------------------

/** What a case must answer under a limit on a file's size: the model, over the files of the commit the edit is made on. */
const editWant = (carrier: TreeEditCarrier, each: TreeEditCase, limit: number): EditModel =>
  editModel(carrier.history.nodes[each.base]?.files ?? [], each.changes, limit);

/** The tree id or the failure `editTree` gives is the model's: the tree of the commit that holds the model's files, or the refusal. */
const expectEdit = (
  place: string,
  result: Result.Result<Tree.TreeId, unknown>,
  model: EditModel,
  tree: Tree.TreeId | undefined,
): void => {
  if (model.kind === "files") {
    expect(Result.isSuccess(result), `${place}: answers`).toBe(true);

    if (Result.isSuccess(result)) {
      expect(result.success, `${place}: the tree of the model's files`).toBe(tree);
    }

    return;
  }

  expect(Result.isFailure(result), `${place}: fails`).toBe(true);

  if (Result.isFailure(result)) {
    if (model.kind === "too-large") {
      expectFailure(result.failure, Repository.FileTooLarge, { path: model.path, most: model.most }, place);
    } else if (model.kind === "not-a-file") {
      expectFailure(result.failure, Repository.NotAFile, { path: model.path, holds: model.holds }, place);
    } else {
      expectFailure(result.failure, Repository.PathInTheWay, { path: model.path, other: model.other }, place);
    }
  }
};

/** Every edit class is reached, and each case comes to what it was drawn to come to when no file is too large. */
const everyTreeEditClass = (carrier: TreeEditCarrier): TreeEditCarrier => {
  expect(reachedTreeEditClasses(carrier), "the generator reaches every edit class").toEqual([...TREE_EDIT_CLASSES]);

  for (const each of carrier.cases) {
    const model = editWant(carrier, each, Number.MAX_SAFE_INTEGER);
    const meant = each.intent === "tree" || each.intent === "no change" ? "files" : each.intent;
    expect(model.kind, `${each.label}: the case comes to what it is drawn to`).toBe(meant);

    if (each.tight !== undefined) {
      expect(editWant(carrier, each, each.tight).kind, `${each.label}: a tight limit makes it too large first`).toBe(
        "too-large",
      );
    }
  }

  return carrier;
};

/** Runs one case of the carrier on a seeded store, as the law's `k`th, and gives `editTree`'s result. */
const editing = (seeded: Seeded, each: TreeEditCase, k: number) =>
  Effect.result(seeded.repository.editTree(idAt(seeded.ids, each.base), editFrom(each.changes, k % 2 === 1)));

const answerTree = (seeded: Seeded, each: TreeEditCase): Tree.TreeId | undefined =>
  each.node === undefined ? undefined : treeAt(seeded.trees, each.node);

/** The largest new content of the cases that make a tree. */
const largestContent = (carrier: TreeEditCarrier): number =>
  Math.max(
    ...carrier.cases.flatMap((each) =>
      each.intent === "tree" ? each.changes.map(([, change]) => (change === "absent" ? 0 : change.length)) : [],
    ),
  );

const AUTHOR: FlatSignature = { name: "Writer", email: "writer@example.test", seconds: 1_500_000_000, offset: "+0000" };

/**
 * A commit on a tree made by `editTree`, and each of the given paths read at it: the model's bytes, none or the refusal, as the
 * model's files say. Reading is what shows that a tree an edit answered holds the files, and that its blobs can be read back.
 */
const readEdited = (
  seeded: Seeded,
  tree: Tree.TreeId,
  files: ReadonlyArray<FileSpec>,
  paths: ReadonlyArray<string>,
  place: string,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const commit = yield* seeded.repository.writeCommit({
      tree,
      parents: [],
      author: toSignature(AUTHOR),
      message: "edited\n",
    });

    for (const path of paths) {
      const read = yield* Effect.result(seeded.repository.readFile(commit.id, pathFrom(path)));
      const model = readModel(files, path);
      const bytes = model.kind === "file" ? model.bytes : undefined;
      expectRead(
        `${place}: ${path} read back`,
        read,
        readOutcome(model, path, DEFAULT.limits.blob),
        (found) => found,
        bytes,
      );
    }
  });

// ---------------------------------------------------------------------------------------------------------
// The checks the write laws share
// ---------------------------------------------------------------------------------------------------------

const treeIdFrom = (text: string): Tree.TreeId => Schema.decodeUnknownSync(Tree.TreeId)(text);

const writeCall = (repo: Repository.Repository["Service"], fields: Fields) =>
  repo.writeCommit({
    tree: fields.tree,
    parents: fields.parents,
    author: toSignature(fields.author),
    message: fields.message,
  });

/** Writes a commit and reads it back: the answer and the read both hold the fields and the committer of the settings. */
const writeAndRead = (
  repo: Repository.Repository["Service"],
  fields: Fields,
  committer: Committer,
  seconds: number,
  place: string,
) =>
  Effect.gen(function* () {
    const commit = yield* writeCall(repo, fields);
    const expected = expectedWrite(commit.id, fields, committer, seconds);
    expect(encodeCommit(commit), `${place}: what was written`).toEqual(expected);
    expect(encodeCommit(yield* repo.readCommit(commit.id)), `${place}: read back`).toEqual(expected);

    return commit;
  });

/** A write that fails with `kind` holding `held`, and leaves the store as it was. */
const refusedWrite = (
  seeded: Seeded,
  fields: Fields,
  kind: abstract new (...args: never[]) => object,
  held: object,
  place: string,
) =>
  Effect.gen(function* () {
    const before = yield* seeded.fingerprint;
    expectFailure(yield* failed(writeCall(seeded.repository, fields), place), kind, held, place);
    expect(yield* seeded.fingerprint, `${place}: nothing was written`).toEqual(before);
  });

/** Every ref the model holds, asked for in every way a caller asks: each ref, each folder, and the places a wrong move would leave one. */
const readModelBack = (
  seeded: Seeded,
  history: History,
  model: ReadonlyMap<string, number>,
  extra: ReadonlyArray<string>,
  place: string,
): Effect.Effect<void, unknown> => {
  const now: History = { ...history, refs: [...model].map(([name, commit]) => ({ name, commit })) };

  return Effect.forEach(
    [...new Set([...refQueries(now), ...extra])],
    (under) =>
      Effect.map(seeded.repository.readRefs(refNameFrom(under)), (refs) => {
        expect(plainRefs(refs), `${place}: refs under ${under}`).toEqual(expectedRefs(now, seeded.ids, under));
      }),
    { concurrency: 1 },
  );
};

/** One span named `git.<call>`, ended, with the attributes, none of them a bare key and none holding a secret. */
const expectSpan = (
  place: string,
  spans: ReadonlyArray<Tracer.NativeSpan>,
  call: string,
  expected: Record<string, unknown>,
  secrets: ReadonlyArray<string>,
): Record<string, unknown> => {
  const gits = spans.filter((span) => span.name.startsWith("git."));
  expect(
    gits.map((span) => span.name),
    `${place}: one span`,
  ).toEqual([`git.${call}`]);
  const span = gits[0];
  expect(span?.status._tag, `${place}: the span ended`).toBe("Ended");
  const attributes = Object.fromEntries(span?.attributes ?? []);
  expect(attributes, `${place}: the attributes`).toMatchObject(expected);

  for (const key of Object.keys(attributes)) {
    expect(["id", "ref", "count"], `${place}: the key ${key} is not bare`).not.toContain(key);
  }

  const text = JSON.stringify(Object.values(attributes));

  for (const secret of secrets) {
    expect(text.includes(secret), `${place}: no attribute holds ${secret}`).toBe(false);
  }

  return attributes;
};

// ---------------------------------------------------------------------------------------------------------
// The laws
// ---------------------------------------------------------------------------------------------------------

/** A path of the history's files, drawn by `k`, or one no history holds. */
const readPath = (history: History, k: number): string => {
  const paths = history.nodes.flatMap((node) => node.files.map((each) => each.path));

  return paths.length === 0 ? "x" : (paths[k % paths.length] ?? "x");
};

/** The span of `editTree` for an edit that makes a tree and for one that fails, each on a history whose paths and bytes hold the canary. */
const editSpans = (seeded: Seeded, history: History, tip: CommitId.CommitId, missing: CommitId.CommitId) => {
  const last = history.nodes[history.nodes.length - 1]?.files[0];

  const changes = new Map<Tree.Path, Uint8Array | "absent">([
    [pathFrom(`${CANARY}-edit/${CANARY}-new`), new TextEncoder().encode(`${CANARY}-content\n`)],
  ]);

  if (last !== undefined) {
    changes.set(pathFrom(last.path), "absent");
  }

  const edit: Repository.Edit = changes;

  return [
    {
      call: "editTree",
      note: "a tree made",
      run: Effect.map(seeded.repository.editTree(tip, edit), (tree): Extra => ({
        present: { "kalfa.git.tree": tree },
        absent: [],
      })),
      expected: { "vcs.ref.base.revision": tip, "kalfa.git.changes": edit.size },
    },
    {
      call: "editTree",
      note: "an unknown base",
      run: Effect.map(Effect.result(seeded.repository.editTree(missing, edit)), (): Extra => ({
        present: {},
        absent: ["kalfa.git.tree"],
      })),
      expected: { "vcs.ref.base.revision": missing, "kalfa.git.changes": edit.size },
    },
  ];
};

/** The spans of `readFile` and `readText`: found or not, and the size only for a file. The path and the bytes are never an attribute. */
const reading = (seeded: Seeded, history: History, tip: CommitId.CommitId) => {
  const last = history.nodes.length - 1;
  const file = history.nodes[last]?.files[0];
  const size = file?.content.length ?? 0;
  const there = pathFrom(file?.path ?? "none");
  const gone = pathFrom(`${CANARY}-gone`);

  const calls: ReadonlyArray<{
    readonly call: string;
    readonly run: (path: Tree.Path) => Effect.Effect<Option.Option<unknown>, unknown>;
  }> = [
    { call: "readFile", run: (path) => seeded.repository.readFile(tip, path) },
    { call: "readText", run: (path) => seeded.repository.readText(tip, path) },
  ];

  return calls.flatMap(({ call, run }) => [
    {
      call,
      note: "a file",
      run: Effect.map(run(there), (): Extra => ({
        present: { "kalfa.git.found": true, "kalfa.git.bytes": size },
        absent: [],
      })),
      expected: { "vcs.ref.head.revision": tip },
    },
    {
      call,
      note: "no file",
      run: Effect.map(run(gone), (): Extra => ({ present: { "kalfa.git.found": false }, absent: ["kalfa.git.bytes"] })),
      expected: { "vcs.ref.head.revision": tip },
    },
  ]);
};

export const suite = (name: string, subject: Subject, options: SuiteOptions): void => {
  const run = { arbitrary: { runs: options.runs, seed: 119120 }, timeout: options.timeout };

  describe(`${name}: the shared laws of Repository`, () => {
    // Plant: each of G4's plants (trim the message, store the offset as a number, refuse an empty name or a
    // space at either end of a name) turns this red too; and in `/process`, take the name up to the last
    // space before `<`: a name with a trailing space comes back short. Trees: `commit` leaves `tree` out of the
    // value it returns, so it reads back as the empty tree; in the parser, read the tree from the second header line.
    it.effect.prop(
      "S1 read back: readCommit gives its tree, parents in order, author, committer and message byte for byte",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const made = carrier(texture);
          expect(made.classes, "the generator reaches every message and signature class").toEqual(CARRIER_CLASSES);
          const trees = treeCarrier(texture);
          expect(trees.classes, "the generator reaches every tree class").toEqual(TREE_CARRIER_CLASSES);

          const histories: ReadonlyArray<Shape> = [
            ...everyShape(texture),
            { label: "carrier", history: made.history },
            { label: "tree carrier", history: trees.history },
          ];

          yield* seedEach(subject, histories, DEFAULT, (seeded, shape) => readBack(seeded, shape.history, shape.label));
        }),
      run,
    );

    // Plant: answer `false` or `[]` for an unknown id in `isAncestor`; drop unknown excludes in `walk`; in `/process`'s
    // `known`, accept an object of any type, so a seeded commit's own tree id is read as a commit.
    it.effect.prop(
      "S2 unknown and wrong-type ids fail with NoSuchCommit naming one of them, never [] or false",
      { texture: textureArb },
      ({ texture }) =>
        seedEach(subject, everyShape(texture), DEFAULT, (seeded, shape) =>
          Effect.gen(function* () {
            const taken = seeded.ids;
            const first = commitIdFrom(missingId(texture, 0, taken));
            const second = commitIdFrom(missingId(texture, 1, [...taken, first]));
            const tree = commitIdFrom(TREE_ID);
            const known = seeded.ids[0] ?? second;
            // A real tree with files, which the repository holds as an object, and which is no commit.
            const real = seeded.trees.find((id) => id !== TREE_ID);

            if (shape.history.nodes.length > 0) {
              expect(real, `${shape.label}: a seeded history has a tree with files`).toBeDefined();
            }

            const missing = [first, second, tree, ...(real === undefined ? [] : [commitIdFrom(real)])];
            const repo = seeded.repository;
            const gone = seeded.ids.length === 0 ? missing : undefined;

            for (const absent of missing) {
              const calls: ReadonlyArray<Effect.Effect<unknown, unknown>> = [
                repo.readCommit(absent),
                repo.walk({ include: [absent], exclude: [] }),
                repo.walk({ include: [known], exclude: [absent] }),
                repo.mergeBases(absent, known),
                repo.mergeBases(known, absent),
                repo.isAncestor(absent, known),
                repo.isAncestor(known, absent),
              ];

              for (const [k, call] of calls.entries()) {
                const error = yield* failure(call);
                expect(isMissing(error), `${shape.label}: call ${k} on ${absent} fails with NoSuchCommit`).toBe(true);

                if (isMissing(error)) {
                  expect(gone ?? [absent], `${shape.label}: call ${k} names an id it was asked for`).toContain(
                    error.id,
                  );
                }
              }
            }
          }),
        ),
      run,
    );

    // Plant: sort with JavaScript's `<` (U+E000 to U+FFFF against the astral class); match by text
    // prefix, so `refs/heads/main-2` comes in under `refs/heads/main`.
    it.effect.prop(
      "S3 refs: readRefs answers the ref and every ref below it, sorted by UTF-8 bytes",
      { texture: textureArb },
      ({ texture }) =>
        seedEach(subject, everyShape(texture), DEFAULT, (seeded, shape) =>
          Effect.gen(function* () {
            yield* readRefsBack(seeded, shape.history, shape.label);

            if (shape.history.nodes.length > 0) {
              const heads = yield* seeded.repository.readRefs(refNameFrom("refs/heads"));
              const names: ReadonlyArray<string> = heads.map((ref) => ref.name);

              const positions = ["refs/heads/z-\u8BBE", "refs/heads/z-\uFF5A", "refs/heads/z-\u{1F600}"].map((n) =>
                names.indexOf(n),
              );

              expect(positions, `${shape.label}: the three trap refs are there`).not.toContain(-1);
              expect(positions, `${shape.label}: byte order puts U+8BBE, then U+FF5A, then U+1F600`).toEqual(
                [...positions].sort((x, y) => x - y),
              );
              const main = yield* seeded.repository.readRefs(refNameFrom("refs/heads/main"));
              expect(
                main.map((ref) => ref.name),
                `${shape.label}: a ref that only shares text is not below it`,
              ).toEqual(["refs/heads/main"]);
            }
          }),
        ),
      run,
    );

    // Plant: answer newest first; leave out the include commits themselves; stop at the first merge.
    it.effect.prop(
      "S4 walk: the set is what include reaches and exclude does not, parents first, each entry is readCommit's",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const reached = new Set<string>();
          yield* seedEach(
            subject,
            everyShape(texture).filter((s) => s.history.nodes.length > 0),
            DEFAULT,
            (seeded, shape) =>
              Effect.forEach(
                [0, 1],
                (k) =>
                  Effect.forEach(
                    drawRanges(shape.history, texture, k),
                    (range) =>
                      Effect.gen(function* () {
                        reached.add(range.label);
                        const place = `${shape.label}, ${range.label}`;

                        const answer = yield* seeded.repository.walk({
                          include: nonEmpty(range.include.map((i) => idAt(seeded.ids, i))),
                          exclude: range.exclude.map((i) => idAt(seeded.ids, i)),
                        });

                        const got = answer.map((commit) => seeded.ids.indexOf(commit.id));
                        const model = walkModel(shape.history, range.include, range.exclude);
                        expect(sorted(got), `${place}: the set`).toEqual(model);
                        expect(parentsFirst(shape.history, got), `${place}: each commit comes after its parents`).toBe(
                          true,
                        );
                        const line = lineOrder(shape.history, model);

                        if (line !== undefined) {
                          expect(got, `${place}: a line of commits has one order`).toEqual(line);
                        }

                        if (range.label === "include equal to exclude") {
                          expect(answer, `${place}: nothing is left`).toEqual([]);
                        }

                        for (const commit of answer) {
                          const again = yield* seeded.repository.readCommit(commit.id);
                          expect(encodeCommit(commit), `${place}: ${commit.id} as readCommit gives it`).toEqual(
                            encodeCommit(again),
                          );
                        }
                      }),
                    { concurrency: 1 },
                  ),
                { concurrency: 1 },
              ),
          );
          expect([...reached].sort(), "the generator reaches every range class").toEqual([...RANGE_CLASSES].sort());
        }),
      run,
    );

    // Plant: answer every common ancestor, not only the best; keep only one of a criss-cross's two.
    it.effect.prop(
      "S5 merge bases: the best common ancestors sorted by id, the same both ways round",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const kinds = new Set<string>();
          yield* seedEach(subject, everyShape(texture), DEFAULT, (seeded, shape) =>
            Effect.forEach(
              [0, 1],
              (k) =>
                Effect.forEach(
                  drawPairs(shape, texture, k),
                  ({ kind, a, b }) =>
                    Effect.gen(function* () {
                      kinds.add(kind);
                      const place = `${shape.label}, ${kind} pair ${a} ${b}`;

                      const expected = basesModel(shape.history, a, b)
                        .map((i) => idAt(seeded.ids, i))
                        .sort();

                      const forward = yield* seeded.repository.mergeBases(idAt(seeded.ids, a), idAt(seeded.ids, b));
                      const backward = yield* seeded.repository.mergeBases(idAt(seeded.ids, b), idAt(seeded.ids, a));
                      expect(forward, `${place}: the model`).toEqual(expected);
                      expect(backward, `${place}: the other way round`).toEqual(expected);

                      if (kind === "unrelated") {
                        expect(forward, `${place}: no common history`).toEqual([]);
                      }

                      if (kind === "ancestor") {
                        expect(forward, `${place}: an ancestor is its own best base`).toEqual([idAt(seeded.ids, a)]);
                      }

                      if (kind === "criss-cross") {
                        expect(forward, `${place}: both bases`).toEqual(
                          [CRISS.left, CRISS.right].map((i) => idAt(seeded.ids, i)).sort(),
                        );
                      }
                    }),
                  { concurrency: 1 },
                ),
              { concurrency: 1 },
            ),
          );
          expect([...kinds].sort(), "the generator reaches every pair class").toEqual([...PAIR_KINDS].sort());
        }),
      run,
    );

    // Plant: answer false for `x, x`.
    it.effect.prop(
      "S6 ancestors: isAncestor is the model's reachability, a commit is its own ancestor",
      { texture: textureArb },
      ({ texture }) =>
        seedEach(subject, everyShape(texture), DEFAULT, (seeded, shape) =>
          Effect.forEach(
            [0, 1],
            (k) =>
              Effect.forEach(
                drawPairs(shape, texture, k),
                ({ kind, a, b }) =>
                  Effect.gen(function* () {
                    const place = `${shape.label}, ${kind} pair ${a} ${b}`;
                    const forward = yield* seeded.repository.isAncestor(idAt(seeded.ids, a), idAt(seeded.ids, b));
                    const backward = yield* seeded.repository.isAncestor(idAt(seeded.ids, b), idAt(seeded.ids, a));
                    expect(forward, `${place}: the model`).toBe(isAncestorModel(shape.history, a, b));
                    expect(backward, `${place}: the other way round`).toBe(isAncestorModel(shape.history, b, a));

                    if (a !== b) {
                      expect(
                        forward && backward,
                        `${place}: two different commits are never each other's ancestor`,
                      ).toBe(false);
                    } else {
                      expect(forward, `${place}: a commit is its own ancestor`).toBe(true);
                    }

                    if (kind === "unrelated") {
                      expect(forward, `${place}: unrelated commits`).toBe(false);
                    }
                  }),
                { concurrency: 1 },
              ),
            { concurrency: 1 },
          ),
        ),
      run,
    );

    // Plant: answer the first `commits` items; count `>=` for `>`, so the exact-size answer fails.
    it.effect.prop(
      "S7 limits never cut: at the answer's exact size it answers, at one less it fails with TooMany or TooLarge",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const all = everyShape(texture);
          const line = all.find((shape) => shape.label === "a line");
          const criss = all.find((shape) => shape.label === "a criss-cross");

          if (line === undefined || criss === undefined) {
            return yield* Effect.die("the generator made no line or criss-cross");
          }

          const history = line.history;
          const last = history.nodes.length - 1;
          const first = yield* Effect.scoped(Effect.map(subject.seed(history, DEFAULT), (seeded) => seeded.ids));

          const objectBytes = (i: number): number =>
            objectSize(
              nodeAt(history, i),
              nodeAt(history, i).parents.map((p) => idAt(first, p)),
            );

          const biggest = Math.max(...history.nodes.map((_, i) => objectBytes(i)));
          const target = texture.nums[0] ?? 0;
          const one = target % history.nodes.length;
          const include = nonEmpty([idAt(first, last)]);

          // bytes: readCommit and walk
          for (const [limit, fails] of [
            [objectBytes(one), false],
            [objectBytes(one) - 1, true],
          ] as const) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(history, settings({ bytes: limit }));
                const read = seeded.repository.readCommit(idAt(seeded.ids, one));

                if (fails) {
                  expectFailure(
                    yield* failure(read),
                    Repository.TooLarge,
                    { id: idAt(seeded.ids, one), most: limit },
                    `readCommit at ${limit} bytes`,
                  );
                } else {
                  expect((yield* read).id, `readCommit at ${limit} bytes answers`).toBe(idAt(seeded.ids, one));
                }
              }),
            );
          }

          for (const [limit, fails] of [
            [biggest, false],
            [biggest - 1, true],
          ] as const) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(history, settings({ bytes: limit }));
                const walk = seeded.repository.walk({ include, exclude: [] });

                if (fails) {
                  expectFailure(yield* failure(walk), Repository.TooLarge, { most: limit }, `walk at ${limit} bytes`);
                } else {
                  expect((yield* walk).length, `walk at ${limit} bytes answers`).toBe(history.nodes.length);
                }
              }),
            );
          }

          // commits: walk
          for (const [limit, fails] of [
            [history.nodes.length, false],
            [history.nodes.length - 1, true],
          ] as const) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(history, settings({ commits: limit }));
                const walk = seeded.repository.walk({ include, exclude: [] });

                if (fails) {
                  expectFailure(
                    yield* failure(walk),
                    Repository.TooMany,
                    { limit: "commits", most: limit },
                    `walk of ${history.nodes.length} at ${limit}`,
                  );
                } else {
                  expect((yield* walk).length, `walk at ${limit} answers`).toBe(history.nodes.length);
                }
              }),
            );
          }

          // commits: merge bases of a criss-cross, which has two
          for (const [limit, fails] of [
            [2, false],
            [1, true],
          ] as const) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(criss.history, settings({ commits: limit }));

                const bases = seeded.repository.mergeBases(
                  idAt(seeded.ids, CRISS.first),
                  idAt(seeded.ids, CRISS.second),
                );

                if (fails) {
                  expectFailure(
                    yield* failure(bases),
                    Repository.TooMany,
                    { limit: "commits", most: limit },
                    `merge bases at ${limit}`,
                  );
                } else {
                  expect((yield* bases).length, `merge bases at ${limit} answers`).toBe(2);
                }
              }),
            );
          }

          // refs: readRefs of everything under refs/heads
          const wanted = refsModel(history, "refs/heads").length;

          for (const [limit, fails] of [
            [wanted, false],
            [wanted - 1, true],
          ] as const) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(history, settings({ refs: limit }));
                const refs = seeded.repository.readRefs(refNameFrom("refs/heads"));

                if (fails) {
                  expectFailure(
                    yield* failure(refs),
                    Repository.TooMany,
                    { limit: "refs", most: limit },
                    `readRefs of ${wanted} at ${limit}`,
                  );
                } else {
                  expect((yield* refs).length, `readRefs at ${limit} answers`).toBe(wanted);
                }
              }),
            );
          }
        }),
      run,
    );

    // Plant: answer the walk from what is there; fail `readRefs` and `readCommit` too.
    it.effect.prop(
      "S8 shallow: walk, mergeBases and isAncestor fail with HistoryTooShort; readCommit and readRefs answer",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const cut = everyShape(texture).flatMap((shape) => {
            const history = cutShallow(shape.history);

            return history === undefined ? [] : [{ label: `${shape.label}, shallow`, history }];
          });

          expect(cut.length, "most shape classes have a commit with parents").toBeGreaterThan(5);
          yield* seedEach(subject, cut, DEFAULT, (seeded, shape) =>
            Effect.gen(function* () {
              const last = shape.history.nodes.length - 1;
              const tip = idAt(seeded.ids, last);
              const repo = seeded.repository;

              const calls: ReadonlyArray<Effect.Effect<unknown, unknown>> = [
                repo.walk({ include: [tip], exclude: [] }),
                repo.mergeBases(tip, idAt(seeded.ids, 0)),
                repo.isAncestor(idAt(seeded.ids, 0), tip),
              ];

              for (const call of calls) {
                expect(isTooShort(yield* failure(call)), `${shape.label}: a call that reads history`).toBe(true);
              }

              yield* readBack(seeded, shape.history, shape.label);
              yield* readRefsBack(seeded, shape.history, shape.label);
            }),
          );
        }),
      run,
    );

    // Plant: name a span `Repository.walk`; annotate the author's name; put the walk's ids under a bare `include`; name
    // the span of `writeCommit` `Repository.writeCommit`; annotate the written message or the settings' committer;
    // leave `kalfa.git.from` out of `moveRef`, or put it in when `from` is none. Slice 2: annotate a diffed path, or a line's text,
    // (k) red; let `rangePatchId` call the wrapped calls, three spans: red; give `kalfa.git.files` the count of lines, or
    // `kalfa.git.lines` the count of files, red; put `kalfa.git.base` on a range that has no one merge base: red.
    // Ticket 1935, slice 1: annotate the path a read asked for, or the bytes, (a) red; let `readText` call the wrapped `readFile`, two spans:
    // red; set `kalfa.git.bytes` on a read that found no file: red; leave `kalfa.git.found` out: red.
    it.effect.prop(
      "S9 spans: each call, the write and merge calls too, ends one span named git.<call> with the attributes the plan gives, and leaks nothing",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const seen = everyShape(texture)
            .filter((shape) => shape.history.nodes.length > 0)
            .map((shape) => ({ label: shape.label, history: withCanary(shape.history, true) }));

          // The committer of the settings is a canary too, so a span that names the committer is seen.
          const config = settings({}, { name: `${CANARY}-bot`, email: `${CANARY}-bot@example.test` });

          yield* seedEach(subject, seen, config, (seeded, shape) =>
            Effect.gen(function* () {
              const ids = seeded.ids;
              const a = idAt(ids, 0);
              const b = idAt(ids, ids.length - 1);
              const merged = basesModel(shape.history, ids.length - 1, 0).map((i) => idAt(ids, i));

              // What a span holds only when the call has an answer to hold: the patch id, and none for no change.
              const calls: ReadonlyArray<{
                readonly call: string;
                readonly note?: string;
                readonly run: Effect.Effect<Extra, unknown>;
                readonly expected: Record<string, unknown>;
              }> = [
                {
                  call: "readCommit",
                  run: Effect.as(seeded.repository.readCommit(b), NO_EXTRA),
                  expected: { "vcs.ref.head.revision": b },
                },
                {
                  call: "readRefs",
                  run: Effect.as(seeded.repository.readRefs(refNameFrom("refs/heads/main")), NO_EXTRA),
                  expected: { "kalfa.git.under": "refs/heads/main", "kalfa.git.refs": 1 },
                },
                {
                  call: "walk",
                  run: Effect.as(seeded.repository.walk({ include: [b], exclude: [] }), NO_EXTRA),
                  expected: {
                    "kalfa.git.include": [b],
                    "kalfa.git.exclude": [],
                    "kalfa.git.commits": walkModel(shape.history, [ids.length - 1], []).length,
                  },
                },
                {
                  call: "mergeBases",
                  run: Effect.as(seeded.repository.mergeBases(a, b), NO_EXTRA),
                  expected: {
                    "vcs.ref.head.revision": a,
                    "vcs.ref.base.revision": b,
                    "kalfa.git.bases": basesModel(shape.history, 0, ids.length - 1).length,
                  },
                },
                {
                  call: "isAncestor",
                  run: Effect.as(seeded.repository.isAncestor(a, b), NO_EXTRA),
                  expected: {
                    "vcs.ref.base.revision": a,
                    "vcs.ref.head.revision": b,
                    "kalfa.git.ancestor": isAncestorModel(shape.history, 0, ids.length - 1),
                  },
                },
                {
                  call: "patchId",
                  note: "two commits",
                  run: Effect.map(seeded.repository.patchId(a, b), patched),
                  expected: { "vcs.ref.base.revision": a, "vcs.ref.head.revision": b },
                },
                {
                  call: "patchId",
                  note: "no change",
                  run: Effect.as(seeded.repository.patchId(b, b), NOTHING_PATCHED),
                  expected: { "vcs.ref.base.revision": b, "vcs.ref.head.revision": b },
                },
                {
                  call: "diff",
                  note: "two commits",
                  run: Effect.map(seeded.repository.diff(a, b), counted),
                  expected: { "vcs.ref.base.revision": a, "vcs.ref.head.revision": b },
                },
                {
                  call: "diff",
                  note: "no change",
                  run: Effect.map(seeded.repository.diff(b, b), counted),
                  expected: { "vcs.ref.base.revision": b, "vcs.ref.head.revision": b },
                },
                {
                  call: "rangePatchId",
                  note: `${merged.length} merge bases`,
                  run: Effect.map(
                    Effect.result(seeded.repository.rangePatchId({ upstream: a, commit: b })),
                    (result) => {
                      expect(
                        Result.isSuccess(result),
                        `${shape.label}: a range with one merge base answers, any other fails`,
                      ).toBe(merged.length === 1);

                      return Result.isSuccess(result)
                        ? {
                            present: { ...patched(result.success).present, "kalfa.git.base": merged[0] },
                            absent: patched(result.success).absent,
                          }
                        : { present: {}, absent: ["kalfa.git.base", "kalfa.git.patch"] };
                    },
                  ),
                  expected: { "vcs.ref.base.revision": a, "vcs.ref.head.revision": b },
                },
                ...reading(seeded, shape.history, b),
                ...editSpans(seeded, shape.history, b, commitIdFrom(missingId(texture, 7, ids))),
              ];

              const secrets = [CANARY, ...seeded.hidden];

              for (const { call, note, run: effect, expected } of calls) {
                const { answer: extra, spans } = yield* traced(effect);
                const place = `${shape.label}, ${call}${note === undefined ? "" : ` (${note})`}`;
                const attributes = expectSpan(place, spans, call, { ...expected, ...extra.present }, secrets);

                for (const key of extra.absent) {
                  expect(Object.keys(attributes), `${place}: no ${key} attribute`).not.toContain(key);
                }
              }

              // The write calls: a commit written and a ref made and moved, each ending one span.
              const tree = treeAt(seeded.trees, 0);

              const author = new Commit.Signature({
                name: `${CANARY}-writer`,
                email: `${CANARY}-writer@example.test`,
                at: { seconds: 1, offset: "+0000" },
              });

              const wrote = yield* traced(
                seeded.repository.writeCommit({ tree, parents: [a], author, message: `${CANARY}-new\n` }),
              );

              expectSpan(
                `${shape.label}, writeCommit`,
                wrote.spans,
                "writeCommit",
                { "kalfa.git.tree": tree, "kalfa.git.parents": [a], "kalfa.git.commit": wrote.answer.id },
                secrets,
              );

              const ref = refNameFrom("refs/remotes/origin/s9");
              const made = yield* traced(seeded.repository.moveRef({ ref, from: Option.none(), to: b }));

              const madeAttributes = expectSpan(
                `${shape.label}, moveRef making a ref`,
                made.spans,
                "moveRef",
                { "vcs.ref.head.name": ref, "vcs.ref.head.revision": b },
                secrets,
              );

              expect(Object.keys(madeAttributes), `${shape.label}: a move from none has no expected id`).not.toContain(
                "kalfa.git.from",
              );

              const moved = yield* traced(seeded.repository.moveRef({ ref, from: Option.some(b), to: a }));

              expectSpan(
                `${shape.label}, moveRef moving a ref`,
                moved.spans,
                "moveRef",
                { "vcs.ref.head.name": ref, "vcs.ref.head.revision": a, "kalfa.git.from": b },
                secrets,
              );
            }),
          );

          // The diff of edits whose every path and line holds the canary: the span says how many files and lines, and no path or line.
          const marked = { ...texture, parts: texture.parts.map((part) => `${CANARY}${part}`) };
          const editing = editCarrier(marked);

          yield* seedEach(subject, [{ label: "edits", history: editing.history }], config, (seeded, shape) =>
            Effect.gen(function* () {
              const secrets = [CANARY, ...seeded.hidden];
              let counts = 0;

              for (const each of editing.cases) {
                const model = diffModel(each.before, each.after);

                if (model.kind === "files") {
                  counts += 1;
                  const from = idAt(seeded.ids, each.from);
                  const to = idAt(seeded.ids, each.to);
                  const made = yield* traced(seeded.repository.diff(from, to));

                  expectSpan(
                    `${shape.label}, diff of ${each.label}`,
                    made.spans,
                    "diff",
                    {
                      "vcs.ref.base.revision": from,
                      "vcs.ref.head.revision": to,
                      "kalfa.git.files": model.files.length,
                      "kalfa.git.lines": diffLines(model.files),
                    },
                    secrets,
                  );
                }
              }

              expect(counts, "the generator reaches diffs that answer").toBeGreaterThan(20);

              // A range is one span: the patch id it ends with and the merge base it measured from, and no path or line.
              const ranged = rangeCarrier(marked);

              yield* Effect.scoped(
                Effect.gen(function* () {
                  const range = yield* subject.seed(ranged.history, config);

                  for (const each of ranged.cases) {
                    const args = { upstream: idAt(range.ids, each.upstream), commit: idAt(range.ids, each.commit) };
                    const answer = yield* range.repository.patchId(idAt(range.ids, each.base), args.commit);
                    const made = yield* traced(range.repository.rangePatchId(args));

                    expect(made.answer, `${each.label}: the range's id is the one from its merge base`).toEqual(answer);

                    const attributes = expectSpan(
                      `${shape.label}, rangePatchId of ${each.label}`,
                      made.spans,
                      "rangePatchId",
                      {
                        "vcs.ref.base.revision": args.upstream,
                        "vcs.ref.head.revision": args.commit,
                        "kalfa.git.base": idAt(range.ids, each.base),
                        ...patched(answer).present,
                      },
                      [CANARY, ...range.hidden],
                    );

                    for (const key of patched(answer).absent) {
                      expect(Object.keys(attributes), `${each.label}: no ${key} attribute`).not.toContain(key);
                    }
                  }
                }),
              );
            }),
          );

          // The merge calls, on a history whose every path, message and name holds the canary: a merge that is clean ends with
          // the tree it made, one that conflicts with how many paths, and no span names a path.
          const merging = mergeCarrier(texture, CANARY);

          yield* seedEach(
            subject,
            [{ label: "merges", history: withCanary(merging.history) }],
            config,
            (seeded, shape) =>
              Effect.gen(function* () {
                const secrets = [CANARY, ...seeded.hidden];
                const clean = merging.cases.find((each) => each.expected.kind === "clean");
                // The class with the most paths, so a count that is always one is seen.
                const conflicting = merging.cases.find((each) => each.label === MERGE_CLASSES.at(-1));

                if (clean === undefined || conflicting === undefined) {
                  return yield* Effect.die("the carrier holds no clean merge or no conflict");
                }

                const args = (merge: MergeCase) => mergeArgs(seeded, merge, false);
                const merged = yield* traced(Effect.result(seeded.repository.mergeTrees(args(clean))));
                expectNamedSpan(
                  `${shape.label}, a clean mergeTrees`,
                  merged.spans,
                  "git.mergeTrees",
                  {
                    "vcs.ref.base.revision": args(clean).ours,
                    "vcs.ref.head.revision": args(clean).theirs,
                    "kalfa.git.merge_base": args(clean).mergeBase,
                    "kalfa.git.tree": mergedTree(seeded, clean),
                  },
                  ["kalfa.git.conflicts"],
                  secrets,
                );

                const refused = yield* traced(Effect.result(seeded.repository.mergeTrees(args(conflicting))));
                expectNamedSpan(
                  `${shape.label}, a conflicting mergeTrees`,
                  refused.spans,
                  "git.mergeTrees",
                  {
                    "vcs.ref.base.revision": args(conflicting).ours,
                    "vcs.ref.head.revision": args(conflicting).theirs,
                    "kalfa.git.merge_base": args(conflicting).mergeBase,
                    "kalfa.git.conflicts": conflictPaths(conflicting).length,
                  },
                  ["kalfa.git.tree"],
                  secrets,
                );
              }),
          );
        }),
      run,
    );

    // Plant: add a `head` key to the service; let `readRefs` pack refs, so the object count changes; let `writeCommit`
    // point `refs/heads/main` at the commit it wrote; leave `diff` or `rangePatchId` out of the service, or let `rangePatchId` be a
    // call an adapter writes, so it is in `Raw` too. Ticket 1935, slice 1: leave `readFile` out of the service, or
    // let `readText` be a call an adapter writes, so it is in `Raw` too; let a read write an object, so the fingerprint moves: red.
    // Ticket 1938, slice 1: leave `fetch` out of the service: red on the keys. `fetch` is not in the list of reads, since it adds objects.
    it.effect.prop(
      "S10 no working copy: the service has the ten read calls, `fetch` and the four write calls, no list of reads changes the store, and no list of writes, edits or merges moves a ref",
      { texture: textureArb },
      ({ texture }) =>
        seedEach(subject, everyShape(texture), DEFAULT, (seeded, shape) =>
          Effect.gen(function* () {
            expect(Object.keys(seeded.repository).sort(), `${shape.label}: the keys`).toEqual([
              "diff",
              "editTree",
              "fetch",
              "isAncestor",
              "mergeBases",
              "mergeTrees",
              "moveRef",
              "patchId",
              "rangePatchId",
              "readCommit",
              "readFile",
              "readRefs",
              "readText",
              "walk",
              "writeCommit",
            ]);
            const before = yield* seeded.fingerprint;
            const n = shape.history.nodes.length;

            const pick = (k: number): CommitId.CommitId =>
              n === 0 ? commitIdFrom(missingId(texture, k, [])) : idAt(seeded.ids, (texture.nums[k] ?? 0) % n);

            // Each of the ten reads is asked twice, on drawn commits, and the writes, edits and merges six times each: git runs a command for
            // each, and this law runs over every shape.
            for (let k = 0; k < 20; k++) {
              const x = pick(k);
              const y = pick(k + 24);

              const calls: ReadonlyArray<Effect.Effect<unknown, unknown>> = [
                seeded.repository.readCommit(x),
                seeded.repository.readRefs(
                  refNameFrom(refQueries(shape.history)[k % refQueries(shape.history).length] ?? "refs/heads/main"),
                ),
                seeded.repository.walk({ include: [x], exclude: [y] }),
                seeded.repository.mergeBases(x, y),
                seeded.repository.isAncestor(x, y),
                seeded.repository.patchId(x, y),
                seeded.repository.diff(x, y),
                seeded.repository.rangePatchId({ upstream: x, commit: y }),
                seeded.repository.readFile(x, pathFrom(readPath(shape.history, k))),
                seeded.repository.readText(y, pathFrom(readPath(shape.history, k + 1))),
              ];

              yield* Effect.exit(calls[k % calls.length] ?? Effect.void);
            }

            expect(yield* seeded.fingerprint, `${shape.label}: the store is as it was`).toEqual(before);

            // Writes, some of them refused: a commit is made, and no ref is moved by it.
            const lacking = treeIdFrom(missingId(texture, 5, []));

            for (let k = 0; k < 6; k++) {
              yield* Effect.exit(
                writeCall(seeded.repository, {
                  tree: k % 4 === 3 ? lacking : n === 0 ? treeIdFrom(TREE_ID) : treeAt(seeded.trees, k % n),
                  parents: n === 0 ? [] : [pick(k + 12)],
                  author: flatAt(texture, k),
                  message: `write ${k}\n`,
                }),
              );
            }

            yield* readRefsBack(seeded, shape.history, `${shape.label}: after writes`);

            // Edits, some of them refused: trees are made, and no ref is moved by them.
            for (let k = 0; k < 6; k++) {
              const edit: Repository.Edit = new Map([
                [pathFrom(readPath(shape.history, k)), Uint8Array.of(k, 0xf0)],
                [pathFrom(`edit${k}/new`), Uint8Array.of(0xf1, k)],
              ]);

              yield* Effect.exit(seeded.repository.editTree(pick(k + 30), edit));
            }

            yield* readRefsBack(seeded, shape.history, `${shape.label}: after edits`);

            // Merges, most of them between commits that do not merge well: a merge writes objects and moves no ref.
            for (let k = 0; k < 6; k++) {
              const [x, y, z] = [pick(k + 3), pick(k + 15), pick(k + 27)];
              yield* Effect.exit(seeded.repository.mergeTrees({ mergeBase: x, ours: y, theirs: z }));
            }

            yield* readRefsBack(seeded, shape.history, `${shape.label}: after merges`);
          }),
        ),
      run,
    );

    // Plant: mix a commit's parents into its tree's id; leave the mode out of a tree's bytes; give every commit the
    // empty tree.
    it.effect.prop(
      "S11 same files, same tree: two commits have one tree id exactly when their paths, modes and bytes are equal",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const made = treeCarrier(texture);
          expect(made.classes, "the generator reaches every tree class").toEqual(TREE_CARRIER_CLASSES);
          let same = 0;
          let apart = 0;

          const histories: ReadonlyArray<Shape> = [
            ...everyShape(texture),
            { label: "tree carrier", history: made.history },
          ];

          yield* seedEach(subject, histories, DEFAULT, (seeded, shape) =>
            Effect.sync(() => {
              const nodes = shape.history.nodes;

              nodes.forEach((node, i) => {
                if (node.files.length === 0) {
                  expect(treeAt(seeded.trees, i), `${shape.label}: commit ${i} has no files, so git's empty tree`).toBe(
                    TREE_ID,
                  );
                }

                nodes.slice(i + 1).forEach((other, k) => {
                  const j = i + 1 + k;
                  const equal = sameFiles(node.files, other.files);

                  if (equal) {
                    same += 1;
                  } else {
                    apart += 1;
                  }

                  expect(
                    treeAt(seeded.trees, i) === treeAt(seeded.trees, j),
                    `${shape.label}: commits ${i} and ${j} ${equal ? "hold the same files" : "differ in their files"}`,
                  ).toBe(equal);
                });
              });

              if (shape.label === "tree carrier") {
                const first = treeAt(seeded.trees, 0);
                const place = (label: string): number => made.classes.indexOf(label);

                expect(
                  treeAt(seeded.trees, place("the same files on another parent")),
                  "the same files, another parent",
                ).toBe(first);

                for (const label of [
                  "one byte differs",
                  "one path differs",
                  "one folder level differs",
                  "one mode differs",
                ]) {
                  expect(treeAt(seeded.trees, place(label)), `${label}: a tree one change apart`).not.toBe(first);
                }
              }
            }),
          );

          expect(same, "the generator reaches commits with equal files").toBeGreaterThan(0);
          expect(apart, "the generator reaches commits with different files").toBeGreaterThan(0);
        }),
      run,
    );
    // Slice 1 of ticket 1933: the patch id. Each law relates ids one adapter gave; no law compares ids across adapters.

    // Plant: hash each line's number, (l) red; hash the base's mode where it does not change, (l) red; hash a text file's blob
    // ids, (l) red; read a NUL at byte 8001 as a binary file, (c) red.
    it.effect.prop(
      "S11b the same edit gives the same id: one edit on bases that differ in another file, the line next to it, the file's mode or where in the file it sits",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = everyEditClass(editCarrier(texture));

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(carrier.history, DEFAULT);
              const ids = yield* patchIds(seeded, carrier);
              let equal = 0;

              for (const group of carrier.same) {
                expect(group.length, "a group is an edit on more than one base").toBeGreaterThan(1);
                const [lead, ...rest] = group;

                for (const next of rest) {
                  const place = `${carrier.cases[next]?.label} and ${carrier.cases[lead ?? 0]?.label}`;
                  expect(carrier.cases[next]?.key, `${place}: the model names them alike`).toBe(
                    carrier.cases[lead ?? 0]?.key,
                  );
                  expect(ids[lead ?? 0], `${place}: the edit has an id`).toBeDefined();
                  expect(ids[next], `${place}: one edit, one id`).toBe(ids[lead ?? 0]);
                }
              }

              for (const [i, a] of carrier.cases.entries()) {
                for (const [j, b] of carrier.cases.entries()) {
                  if (i < j && a.key !== undefined && a.key === b.key) {
                    equal += 1;
                    expect(ids[i], `${a.label} and ${b.label}: the model names them alike, so they have one id`).toBe(
                      ids[j],
                    );
                  }
                }
              }

              expect(equal, "the generator reaches changes the model names alike").toBeGreaterThan(3);
            }),
          );
        }),
      run,
    );

    // Plant: strip whitespace before hashing, (m) red; drop each line's end, (m) red; hash a binary file by its path alone,
    // (n) red; leave modes out, (n) red; hash a new or deleted file by its path alone, (a) red; fold punctuation or non-ASCII
    // characters of a path together, (k) red; hash a file's first change block only, (g) red; read a NUL at byte 8000 as text or a
    // file as binary only when both sides have a NUL, (c) red.
    it.effect.prop(
      "S20 a different edit gives a different id: one line changed (its text, a trailing space, its line end), the mode, the path, the line, a binary byte, the other way round",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = everyEditClass(editCarrier(texture));

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(carrier.history, DEFAULT);
              const ids = yield* patchIds(seeded, carrier);
              const drawn = ids[carrier.drawn];
              let apart = 0;

              expect(drawn, "the drawn edit has an id").toBeDefined();

              for (const variant of carrier.variants) {
                const place = carrier.cases[variant]?.label;
                expect(carrier.cases[variant]?.key, `${place}: the model names it apart from the drawn edit`).not.toBe(
                  carrier.cases[carrier.drawn]?.key,
                );
                expect(ids[variant], `${place}: an id apart from the drawn edit's`).not.toBe(drawn);
                expect(ids[variant], `${place}: it has an id`).toBeDefined();
              }

              for (const [i, a] of carrier.cases.entries()) {
                for (const [j, b] of carrier.cases.entries()) {
                  if (i < j && a.key !== undefined && b.key !== undefined && a.key !== b.key) {
                    apart += 1;
                    expect(
                      ids[i],
                      `${a.label} and ${b.label}: the model names them apart, so their ids differ`,
                    ).not.toBe(ids[j]);
                  }
                }
              }

              expect(apart, "the generator reaches changes the model names apart").toBeGreaterThan(100);
            }),
          );
        }),
      run,
    );

    // Plant: answer an id for no change, (f) red; answer none for a mode-only change, (b) red; answer none for an empty new file,
    // (f) red; fail on bytes that are not UTF-8, (e) red; read the history, so a shallow repository fails, red.
    it.effect.prop(
      "S21 none means no change: patchId of a commit with itself, or with another commit of the same files, is none; a mode-only change, an empty new file and a latin-1 file each have an id, in a shallow repository too",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = everyEditClass(editCarrier(texture));
          const cut = cutShallow(carrier.history);
          expect(cut, "the carrier is a line of commits, so a commit has a parent to hide").toBeDefined();

          const check = (history: History, label: string) =>
            Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(history, DEFAULT);
                const ids = yield* patchIds(seeded, carrier);

                for (const [i, each] of carrier.cases.entries()) {
                  expect(
                    ids[i] === undefined,
                    `${label}: ${each.label} has ${each.key === undefined ? "no" : "an"} id`,
                  ).toBe(each.key === undefined);
                }

                for (const wanted of ["a mode-only change", "an empty file added", "latin-1 lines"]) {
                  const at = carrier.cases.findIndex((each) => each.label === wanted);
                  expect(at, `${wanted} is drawn`).toBeGreaterThanOrEqual(0);
                  expect(ids[at], `${label}: ${wanted} has an id`).toBeDefined();
                }

                for (const [k, id] of seeded.ids.entries()) {
                  expect(
                    Option.isNone(yield* seeded.repository.patchId(id, id)),
                    `${label}: commit ${k} with itself`,
                  ).toBe(true);
                }

                return ids;
              }),
            );

          const whole = yield* check(carrier.history, "whole");
          const shallow = yield* check(cut ?? carrier.history, "shallow");
          expect(shallow, "a shallow repository gives the ids a whole one gives").toEqual(whole);
        }),
      run,
    );

    // Plant: delete the files check, (h) red; delete the size check, (h) red; count `>=` for `>` on either limit: red; check the
    // size before the files: red; count the files that do not change: red; count only one side's bytes: red; the same plants in `diff`.
    it.effect.prop(
      "S17 limits never cut: at exactly limits.files files and limits.diff bytes patchId and diff answer, one more fails with TooMany or DiffTooLarge, over both is TooMany",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = limitCarrier(texture);
          const files = changedFiles(carrier.before, carrier.after);
          const bytes = comparedBytes(carrier.before, carrier.after);
          expect(files, "files to cut").toBeGreaterThan(1);
          expect(bytes, "bytes to cut").toBeGreaterThan(1);
          const reached = new Set<string>();

          const ask = <A, E>(
            limits: { readonly files: number; readonly diff: number },
            call: (seeded: Seeded) => Effect.Effect<A, E>,
          ): Effect.Effect<A, E> =>
            Effect.scoped(Effect.flatMap(subject.seed(carrier.history, settings(limits)), call));

          const patch = (seeded: Seeded) => seeded.repository.patchId(idAt(seeded.ids, 0), idAt(seeded.ids, 1));

          // The diff of the same two commits: at exactly the limits it answers the model's files, or `NotUtf8` when the drawn
          // bytes are not text, and one more is the same refusal `patchId` gives.
          const diff = (seeded: Seeded) => seeded.repository.diff(idAt(seeded.ids, 0), idAt(seeded.ids, 1));
          const model = expectedOutcome(diffModel(carrier.before, carrier.after));

          const outcome = (limits: { readonly files: number; readonly diff: number }) =>
            Effect.map(Effect.result(ask(limits, diff)), diffResult);

          expect(yield* outcome({ files, diff: bytes }), "diff at exactly both limits").toEqual(model);
          expect(yield* outcome({ files: files + 5, diff: bytes + 50 }), "diff with room to spare").toEqual(model);

          const diffMany = yield* refused(ask({ files: files - 1, diff: bytes }, diff), "diff, one file too many");
          expectFailure(diffMany, Repository.TooMany, { limit: "files", most: files - 1 }, "diff's files limit");

          const diffLarge = yield* refused(ask({ files, diff: bytes - 1 }, diff), "diff, one byte too many");
          expectFailure(diffLarge, Repository.DiffTooLarge, { most: bytes - 1 }, "diff's size limit");

          const diffBoth = yield* refused(ask({ files: files - 1, diff: bytes - 1 }, diff), "diff, over both limits");
          expectFailure(diffBoth, Repository.TooMany, { limit: "files", most: files - 1 }, "diff, over both is files");

          const exact = yield* answered(ask({ files, diff: bytes }, patch), "at exactly both limits");
          reached.add("exactly the files limit");
          reached.add("exactly the diff limit");
          expect(exact !== undefined && Option.isSome(exact), "at exactly both limits it has an id").toBe(true);

          const roomy = yield* answered(ask({ files: files + 5, diff: bytes + 50 }, patch), "with room to spare");
          expect(roomy, "limits that are not reached change nothing").toEqual(exact);

          const tooMany = yield* refused(ask({ files: files - 1, diff: bytes }, patch), "one file too many");
          reached.add("one file more than the limit");
          expectFailure(tooMany, Repository.TooMany, { limit: "files", most: files - 1 }, "the files limit");

          const tooLarge = yield* refused(ask({ files, diff: bytes - 1 }, patch), "one byte too many");
          reached.add("one byte more than the limit");
          expectFailure(tooLarge, Repository.DiffTooLarge, { most: bytes - 1 }, "the diff limit");

          const both = yield* refused(ask({ files: files - 1, diff: bytes - 1 }, patch), "over both limits");
          reached.add("over both limits");
          expectFailure(both, Repository.TooMany, { limit: "files", most: files - 1 }, "over both is the files limit");

          expect([...reached].sort(), "the law reaches every limit class").toEqual([...LIMIT_CLASSES].sort());
        }),
      run,
    );

    // Plant: answer none for an unknown `from`, (i) red; answer none for an unknown `to`, (i) red; check the limits before the
    // ids, red; answer `[]` from `diff` for an unknown id, (i) red; read a tree's id as a commit in `diff`, (i) red; answer none from
    // `rangePatchId` for an unknown upstream or tip, (i) red.
    it.effect.prop(
      "S18 unknown ids: an id the store lacks, or a tree's id, on either side fails patchId, diff and rangePatchId with NoSuchCommit naming it, never none or [], even when a limit would fail first",
      { texture: textureArb },
      ({ texture }) =>
        seedEach(subject, everyShape(texture), settings({ files: 1, diff: 1 }), (seeded, shape) =>
          Effect.gen(function* () {
            const taken = seeded.ids;
            const first = commitIdFrom(missingId(texture, 0, taken));
            const second = commitIdFrom(missingId(texture, 1, [...taken, first]));
            const tree = commitIdFrom(TREE_ID);
            const known = seeded.ids[0] ?? second;
            const real = seeded.trees.find((id) => id !== TREE_ID);
            const missing = [first, second, tree, ...(real === undefined ? [] : [commitIdFrom(real)])];
            const gone = seeded.ids.length === 0 ? missing : undefined;

            for (const absent of missing) {
              const calls: ReadonlyArray<readonly [string, Effect.Effect<unknown, unknown>]> = [
                ["from", seeded.repository.patchId(absent, known)],
                ["to", seeded.repository.patchId(known, absent)],
                ["from of a diff", seeded.repository.diff(absent, known)],
                ["to of a diff", seeded.repository.diff(known, absent)],
                ["upstream", seeded.repository.rangePatchId({ upstream: absent, commit: known })],
                ["tip", seeded.repository.rangePatchId({ upstream: known, commit: absent })],
              ];

              for (const [side, call] of calls) {
                const error = yield* refused(call, `${shape.label}: an unknown ${side}`);
                expect(isMissing(error), `${shape.label}: an unknown ${side} fails with NoSuchCommit`).toBe(true);

                if (isMissing(error)) {
                  expect(gone ?? [absent], `${shape.label}: it names the id it was asked for on ${side}`).toContain(
                    error.id,
                  );
                }
              }
            }
          }),
        ),
      run,
    );

    // Slice 2 of ticket 1933: the range and the diff. The model is `diffModel` and `rangeCarrier` in History.test-support.ts.

    // Plant: use `upstream` itself as the base, (o) red; take the first of two merge bases, (p) red; answer none for no merge base,
    // (p) red; read the merge bases without the shallow check, (q) red; refuse a merge base equal to the commit, (r) red; refuse
    // a commit equal to the upstream, (r) red.
    it.effect.prop(
      "S22 the range: rangePatchId is the patch id from the one merge base to the tip, the same for a rebased, merged or squashed branch, none when the tip is its merge base, UnclearBase naming the bases when there is none or two, HistoryTooShort in a shallow repository",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const reached = new Set<string>();
          const carrier = rangeCarrier(texture);

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(carrier.history, DEFAULT);
              const ids: Array<string | undefined> = [];

              for (const each of carrier.cases) {
                for (const label of each.classes) {
                  reached.add(label);
                }

                expect(
                  basesModel(carrier.history, each.commit, each.upstream),
                  `${each.label}: the model names one merge base`,
                ).toEqual([each.base]);

                const range = {
                  upstream: idAt(seeded.ids, each.upstream),
                  commit: idAt(seeded.ids, each.commit),
                };

                const answer = yield* answered(seeded.repository.rangePatchId(range), each.label);

                const direct = yield* answered(
                  seeded.repository.patchId(idAt(seeded.ids, each.base), range.commit),
                  `${each.label}, from its merge base`,
                );

                expect(answer, `${each.label}: the patch id from its merge base to the tip`).toEqual(direct);

                expect(
                  answer !== undefined && Option.isSome(answer),
                  `${each.label}: it has ${each.key === undefined ? "no" : "an"} id`,
                ).toBe(each.key !== undefined);

                ids.push(answer === undefined ? undefined : Option.getOrUndefined(answer));
              }

              let alike = 0;

              for (const [i, a] of carrier.cases.entries()) {
                for (const [j, b] of carrier.cases.entries()) {
                  if (i < j && a.key !== undefined && b.key !== undefined) {
                    alike += a.key === b.key ? 1 : 0;
                    expect(
                      ids[i] === ids[j],
                      `${a.label} and ${b.label}: one edit has one id and two edits have two`,
                    ).toBe(a.key === b.key);
                  }
                }
              }

              expect(alike, "the generator reaches ranges that make one edit").toBeGreaterThan(4);
            }),
          );

          // Every shape of history, and the pairs of commits it draws: one merge base answers the patch id from it, any other count
          // is `UnclearBase` naming exactly the merge bases.
          yield* seedEach(subject, everyShape(texture), DEFAULT, (seeded, shape) =>
            Effect.forEach(
              [0, 1],
              (k) =>
                Effect.forEach(
                  drawPairs(shape, texture, k),
                  ({ kind, a, b }) =>
                    Effect.gen(function* () {
                      const place = `${shape.label}, ${kind} pair ${a} ${b}`;
                      const range = { upstream: idAt(seeded.ids, b), commit: idAt(seeded.ids, a) };
                      const bases = basesModel(shape.history, a, b).map((i) => idAt(seeded.ids, i));

                      if (bases.length === 1) {
                        const direct = yield* seeded.repository.patchId(bases[0] ?? range.commit, range.commit);

                        expect(yield* seeded.repository.rangePatchId(range), `${place}: the one merge base`).toEqual(
                          direct,
                        );

                        return;
                      }

                      const error = yield* refused(seeded.repository.rangePatchId(range), place);
                      expect(error, `${place}: ${bases.length} merge bases`).toBeInstanceOf(Repository.UnclearBase);

                      if (isUnclear(error)) {
                        expect([...error.bases].sort(), `${place}: it names the merge bases`).toEqual(
                          [...bases].sort(),
                        );
                      }

                      reached.add(
                        bases.length === 0 ? "(p) no common history" : "(p) a criss-cross with two merge bases",
                      );
                    }),
                  { concurrency: 1 },
                ),
              { concurrency: 1 },
            ),
          );

          // A shallow repository cannot know its merge bases, so it fails and never guesses.
          const cut = everyShape(texture).flatMap((shape) => {
            const history = cutShallow(shape.history);

            return history === undefined ? [] : [{ label: `${shape.label}, shallow`, history }];
          });

          yield* seedEach(subject, cut, DEFAULT, (seeded, shape) =>
            Effect.gen(function* () {
              const tip = idAt(seeded.ids, shape.history.nodes.length - 1);

              const error = yield* refused(
                seeded.repository.rangePatchId({ upstream: idAt(seeded.ids, 0), commit: tip }),
                shape.label,
              );

              expect(isTooShort(error), `${shape.label}: a range that reads history`).toBe(true);
              reached.add("(q) a shallow repository");
            }),
          );

          expect([...reached].sort(), "the generator reaches every range class").toEqual(
            [...RANGE_PATCH_CLASSES].sort(),
          );
        }),
      run,
    );

    // Plant: report a type change as two files, (a) red; drop mode-only changes, (b) red; strip each line's end, (d) red; fail on
    // an empty new file, (f) red; join two change blocks into one, (g) red; sort paths with JavaScript's `<`, (k) red; number every
    // line from the top of its block, or a removed line in the new file, (g) red; give a changed file its old entry on both sides, red.
    it.effect.prop(
      "S23 the diff: for every edit the classes draw, diff is the model's answer exactly: the files in path byte order, each tag, entries, blob ids and lines with their own ends and where they sit, and [] for no change",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = everyEditClass(editCarrier(texture));
          const seen = new Set<string>();
          let empty = 0;
          let shifted = 0;
          let withoutEnd = 0;
          let crlf = 0;

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(carrier.history, DEFAULT);

              for (const each of carrier.cases) {
                const model = yield* diffCase(seeded, each);

                if (model.kind === "files") {
                  for (const file of model.files) {
                    seen.add(file._tag);
                    seen.add(file.content._tag);

                    if (Predicate.isTagged(file.content, "Text")) {
                      const { lines } = file.content;
                      empty += lines.length === 0 ? 1 : 0;
                      withoutEnd += lines.some((line) => !line.text.endsWith("\n")) ? 1 : 0;
                      crlf += lines.some((line) => line.text.endsWith("\r\n")) ? 1 : 0;

                      // A line sits at its place in the old file when removed and in the new one when added: the two differ in a
                      // block below lines that were inserted or removed.
                      shifted += lines.some((line, i) => {
                        const next = lines[i + 1];

                        return (
                          Predicate.isTagged(line, "Removed") &&
                          next !== undefined &&
                          Predicate.isTagged(next, "Added") &&
                          next.at !== line.at
                        );
                      })
                        ? 1
                        : 0;
                    }
                  }

                  if (each.key === undefined) {
                    expect(model.files, `${each.label}: no change`).toEqual([]);
                  }
                }
              }

              for (const [k, id] of seeded.ids.entries()) {
                expect(yield* seeded.repository.diff(id, id), `commit ${k} with itself: no change`).toEqual([]);
              }
            }),
          );

          expect([...seen].sort(), "the generator reaches every tag").toEqual(
            ["Binary", "Deleted", "Modified", "New", "Text"].sort(),
          );
          expect(empty, "the generator reaches files with no line").toBeGreaterThan(1);
          expect(withoutEnd, "the generator reaches a last line with no end").toBeGreaterThan(1);
          expect(crlf, "the generator reaches lines that end in CRLF").toBeGreaterThan(0);
          expect(shifted, "the generator reaches a changed block below an inserted line").toBeGreaterThan(0);
        }),
      run,
    );

    // Plant: drop the binary check, (c) red; look for a NUL in the whole file, (c) red; look in the first 8001 bytes or 7999, (c) red;
    // look at the new side only, or at the old side only, (c) red; answer `Binary` for a file whose bytes did not change, (b) red.
    it.effect.prop(
      "S24 binary and text: a NUL in the first 8000 bytes of either side is Binary with both blob ids, a NUL only past them is Text, and a binary file whose bytes did not change has no line",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = everyEditClass(editCarrier(texture));

          const binary = new Set([
            "(c) a NUL in the first 8000 bytes on one side",
            "(c) a NUL at byte 8000, binary",
            "(n) a binary edit with other bytes",
            "(n) the same binary edit on a base that differs in another file",
            "(a) a binary file made a link",
            "(a) a link made a binary file",
          ]);

          // What the class of a case says its content is, whatever the model says: a NUL among the first 8000 bytes is binary, a NUL
          // later is a line like any other, and bytes that did not change hold no line.
          const wantedContent = (each: EditCase): "Binary" | "Text" | undefined => {
            if (each.classes.some((label) => binary.has(label))) {
              return "Binary";
            }

            return each.classes.includes("(c) a NUL at byte 8001, text") ||
              each.label.startsWith("a mode-only change of ")
              ? "Text"
              : undefined;
          };

          let checked = 0;

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(carrier.history, DEFAULT);

              for (const each of carrier.cases) {
                const wanted = wantedContent(each);

                if (wanted !== undefined) {
                  checked += 1;

                  const files = yield* answered(
                    seeded.repository.diff(idAt(seeded.ids, each.from), idAt(seeded.ids, each.to)),
                    each.label,
                  );

                  const [file, ...rest] = files === undefined ? [] : encodeDiff(files);
                  expect(rest, `${each.label}: one changed file`).toEqual([]);
                  expect(file?.content._tag, `${each.label}: ${wanted}`).toBe(wanted);

                  if (
                    file !== undefined &&
                    Predicate.isTagged(file, "Modified") &&
                    Predicate.isTagged(file.content, "Binary")
                  ) {
                    expect(file.before.blob, `${each.label}: the two blobs are named`).not.toBe(file.after.blob);
                  }

                  const lines =
                    file !== undefined && Predicate.isTagged(file.content, "Text") ? file.content.lines : undefined;

                  if (each.classes.includes("(c) a NUL at byte 8001, text")) {
                    expect(
                      lines?.length ?? 0,
                      `${each.label}: a NUL past 8000 bytes is a line like any other`,
                    ).toBeGreaterThan(0);
                  }

                  if (each.label.startsWith("a mode-only change of ")) {
                    expect(lines, `${each.label}: bytes that did not change hold no line`).toEqual([]);
                  }
                }
              }
            }),
          );

          expect(checked, "the generator reaches binary files, text files and a binary file's mode").toBeGreaterThan(8);
        }),
      run,
    );

    // Plant: decode with replacement, (e) red; decode a binary file's bytes too, (c) red; name the last such file and not the
    // first, (e) red; read the lines before the limits are checked, red; fail `patchId` on the same bytes, (e) red.
    it.effect.prop(
      "S19 not UTF-8: diff over a text file whose lines are not UTF-8 fails with NotUtf8 naming the first such file by path bytes, after the limits, while patchId over the same edit answers an id and a binary file's bytes never fail",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = everyEditClass(editCarrier(texture));
          const p = texture.parts[0] ?? "";

          const bad = carrier.cases.filter((each) => diffModel(each.before, each.after).kind === "not-utf8");
          expect(bad.length, "the generator reaches files that are not UTF-8").toBeGreaterThan(1);

          const two = carrier.cases.find((each) => each.label === "two latin-1 files, named by bytes");
          const one = carrier.cases.find((each) => each.label === "latin-1 lines");
          const binary = carrier.cases.find((each) => each.label === "a binary file whose bytes are not UTF-8");

          if (two === undefined || one === undefined || binary === undefined) {
            return yield* Effect.die("the carrier holds no such case");
          }

          const ask = <A, E>(
            limits: { readonly files?: number; readonly diff?: number },
            call: (seeded: Seeded) => Effect.Effect<A, E>,
          ) => Effect.scoped(Effect.flatMap(subject.seed(carrier.history, settings(limits)), call));

          const askDiff = (each: EditCase) => (seeded: Seeded) =>
            seeded.repository.diff(idAt(seeded.ids, each.from), idAt(seeded.ids, each.to));

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(carrier.history, DEFAULT);

              for (const each of bad) {
                const model = diffModel(each.before, each.after);
                const error = yield* refused(askDiff(each)(seeded), each.label);
                expectFailure(
                  error,
                  Repository.NotUtf8,
                  { path: model.kind === "not-utf8" ? model.path : "" },
                  each.label,
                );

                const id = yield* answered(
                  seeded.repository.patchId(idAt(seeded.ids, each.from), idAt(seeded.ids, each.to)),
                  `${each.label}: patchId`,
                );

                expect(id !== undefined && Option.isSome(id), `${each.label}: the same bytes have a patch id`).toBe(
                  true,
                );
              }

              // Two files that are not UTF-8: the one whose path sorts first by UTF-8 bytes, which JavaScript's `<` puts last.
              const named = yield* refused(askDiff(two)(seeded), two.label);
              expectFailure(named, Repository.NotUtf8, { path: `\uE000${p}` }, "the first path by bytes");

              // Bytes that are not UTF-8 in a binary file are no lines, so nothing fails.
              const files = yield* answered(askDiff(binary)(seeded), binary.label);
              expect(files === undefined ? undefined : encodeDiff(files).map((file) => file.content._tag)).toEqual([
                "Binary",
              ]);
            }),
          );

          // The limits are checked before the lines are read: a files limit under the two files, and a size limit one byte under the
          // content, give their own failures and never `NotUtf8`.
          const many = yield* refused(ask({ files: 1 }, askDiff(two)), "two files over a limit of one");
          expectFailure(many, Repository.TooMany, { limit: "files", most: 1 }, "the files limit comes first");

          const bytes = comparedBytes(one.before, one.after);
          const large = yield* refused(ask({ diff: bytes - 1 }, askDiff(one)), "one byte over the limit");
          expectFailure(large, Repository.DiffTooLarge, { most: bytes - 1 }, "the size limit comes first");
        }),
      run,
    );

    // Plant: delete the NUL check in `make`, so memory writes the message; delete the size check; count the object's
    // characters and not its bytes, so the wide row passes at one byte over; delete the check of the tree; check only
    // the first parent; take the committer from the author; round the clock's second up; write the offset as the
    // machine's zone; trim the message; let `writeCommit` point `refs/heads/main` at the commit.
    it.effect.prop(
      "S12 write a commit: it reads back field for field with the settings' committer at the clock's second and +0000, a seeded commit's own fields give its id, a refusal writes nothing, no ref moves",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const committer = committerFrom(flatAt(texture, 4));
          const config = settings({}, committer);
          const word = texture.words[0] ?? "w";
          const reached = new Set<string>();
          const refused = new Set<string>();

          const histories = [
            ...everyShape(texture).filter((shape) => shape.history.nodes.length > 0),
            { label: "tree carrier", history: treeCarrier(texture).history },
          ].map(({ label, history }) => ({ label, history: asWritten(history, committer) }));

          // Every shape: each class of write, a seeded commit's own fields, and each class of refusal.
          yield* seedEach(subject, histories, config, (seeded, shape) =>
            Effect.gen(function* () {
              const { ids, trees, repository } = seeded;
              const history = shape.history;
              const n = history.nodes.length;
              const author = flatAt(texture, 1);

              for (const [k, spec] of writeSpecs(history, texture).entries()) {
                reached.add(spec.label);
                const seconds = 1_000_000 + numAt(texture, k);
                yield* clockAt(seconds, texture, k + 20);

                yield* writeAndRead(
                  repository,
                  {
                    tree: spec.tree === "empty" ? treeIdFrom(TREE_ID) : treeAt(trees, spec.tree),
                    parents: spec.parents.map((parent) => idAt(ids, parent)),
                    author,
                    message: `${spec.label}\n`,
                  },
                  committer,
                  seconds,
                  `${shape.label}, ${spec.label}`,
                );
              }

              // The first, the last and two drawn commits, written from their own fields: the same commit, so the same id.
              for (const i of new Set([0, n - 1, numAt(texture, 30) % n, numAt(texture, 31) % n])) {
                const node = nodeAt(history, i);
                yield* clockAt(node.committer.seconds, texture, 32 + i);

                const commit = yield* writeCall(repository, {
                  tree: treeAt(trees, i),
                  parents: node.parents.map((parent) => idAt(ids, parent)),
                  author: node.author,
                  message: node.message,
                });

                expect(encodeCommit(commit), `${shape.label}: commit ${i} written from its own fields`).toEqual(
                  expectedCommit(history, ids, trees, i),
                );
              }

              // Each refusal has a sound tree, sound parents and a small message but the one thing it breaks, so each
              // check is reached; nothing is written, and the clock is whatever it was.
              const sound: Fields = {
                tree: treeAt(trees, 0),
                parents: [idAt(ids, 0)],
                author,
                message: `${word}\n`,
              };

              const lacking = treeIdFrom(missingId(texture, 0, [...ids, ...trees]));
              const gone = commitIdFrom(missingId(texture, 1, [...ids, ...trees]));
              const place = (label: string): string => `${shape.label}, ${label}`;

              for (const [label, message] of nulMessages(word)) {
                refused.add(label);
                yield* refusedWrite(seeded, { ...sound, message }, Repository.NulInMessage, {}, place(label));
              }

              for (const [label, bad] of [
                ["a tree the store lacks", lacking],
                ["a commit's id given as the tree", treeIdFrom(idAt(ids, n - 1))],
              ] as const) {
                refused.add(label);
                yield* refusedWrite(seeded, { ...sound, tree: bad }, Repository.NoSuchTree, { id: bad }, place(label));
              }

              for (const [label, parents, bad] of [
                ["a parent the store lacks", [gone], gone],
                [
                  "a tree's id given as a parent",
                  [commitIdFrom(treeAt(trees, n - 1))],
                  commitIdFrom(treeAt(trees, n - 1)),
                ],
                ["a parent the store lacks, second of two", [idAt(ids, 0), gone], gone],
                ["a parent the store lacks, first of two", [gone, idAt(ids, 0)], gone],
              ] as const) {
                refused.add(label);
                yield* refusedWrite(seeded, { ...sound, parents }, Repository.NoSuchCommit, { id: bad }, place(label));
              }

              yield* readRefsBack(seeded, history, `${shape.label}: after every write and refusal`);
            }),
          );

          expect([...reached].sort(), "the generator reaches every write class").toEqual(
            [...WRITE_SHAPE_CLASSES].sort(),
          );
          expect([...refused].sort(), "the generator reaches every refusal class").toEqual([...REFUSAL_CLASSES].sort());

          const root = everyShape(texture).find((shape) => shape.label === "one root");

          if (root === undefined) {
            return yield* Effect.die("the generator made no root");
          }

          // The committer is the settings' one, whatever it holds, at each clock: the start of time, a drawn day, a second past 2^32.
          const clocks = [0, 1_700_000_000 + numAt(texture, 40), 4_294_967_296 + numAt(texture, 41)];
          expect(committerAccepted(flatAt(texture, 2)).length, "the committer classes").toBeGreaterThan(8);

          for (const [label, person] of committerAccepted(flatAt(texture, 2))) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(root.history, settings({}, person));

                for (const [k, seconds] of clocks.entries()) {
                  yield* clockAt(seconds, texture, 50 + k);

                  yield* writeAndRead(
                    seeded.repository,
                    {
                      tree: treeAt(seeded.trees, 0),
                      parents: [idAt(seeded.ids, 0)],
                      author: flatAt(texture, 3),
                      message: `${word}\n`,
                    },
                    person,
                    seconds,
                    `committer ${label}, second ${seconds}`,
                  );
                }
              }),
            );
          }

          // Every class of message and of author goes in and comes back whole (a NUL is the refusal above).
          expect(
            messageVariants(word).map(([label]) => label),
            "the generator reaches every message class",
          ).toEqual(MESSAGE_CLASSES);
          expect(
            signatureVariants(flatAt(texture, 1)).map(([label]) => label),
            "the generator reaches every signature class",
          ).toEqual(SIGNATURE_CLASSES);

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(root.history, config);
              const second = 1_700_000_000;
              const target = { tree: treeAt(seeded.trees, 0), parents: [idAt(seeded.ids, 0)] };
              yield* clockAt(second, texture, 60);

              for (const [label, message] of messageVariants(word)) {
                if (label !== "a NUL") {
                  yield* writeAndRead(
                    seeded.repository,
                    { ...target, author: flatAt(texture, 1), message },
                    committer,
                    second,
                    `message ${label}`,
                  );
                }
              }

              for (const [label, author] of signatureVariants(flatAt(texture, 1))) {
                yield* writeAndRead(
                  seeded.repository,
                  { ...target, author, message: `${word}\n` },
                  committer,
                  second,
                  `author ${label}`,
                );
              }
            }),
          );

          // The limit is on the object's bytes: exactly `limits.bytes` is written and read back, one byte more is refused,
          // with a one-byte, a three-byte and a four-byte character at the edge.
          const second = 1_700_000_000;
          const author = flatAt(texture, 1);

          for (const [label, message] of edgeMessages(word)) {
            const exact = writtenSize({
              tree: TREE_ID,
              parents: ["0".repeat(40)],
              author,
              committer,
              seconds: second,
              message,
            });

            for (const [limit, over] of [
              [exact, false],
              [exact - 1, true],
            ] as const) {
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const seeded = yield* subject.seed(root.history, settings({ bytes: limit }, committer));
                  const fields = { tree: treeAt(seeded.trees, 0), parents: [idAt(seeded.ids, 0)], author, message };
                  const at = `${label}, a limit of ${limit} bytes`;
                  yield* clockAt(second, texture, 61);

                  if (over) {
                    yield* refusedWrite(seeded, fields, Repository.TooLargeToWrite, { most: limit }, at);
                  } else {
                    yield* writeAndRead(seeded.repository, fields, committer, second, at);
                  }
                }),
              );
            }
          }
        }),
      run,
    );

    // Plant: refuse a ref outside `refs/heads/`; refuse a move that drops commits; delete the compare with `from`;
    // compare only when `from` is some; delete the check of a ref in the way; delete the check on `to`; read `to` as
    // a commit when it is a tree's id; move the ref before the compare; keep the first `from` for a second move.
    it.effect.prop(
      "S13 move a ref: each move that succeeds leaves the ref at `to` and every other ref as it was, each stale move, ref in the way or missing commit fails with its error and leaves every ref as it was",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const { history, names } = moveCarrier(texture);
          const classes = new Set<string>();
          const extra = [...Object.values(names), "refs/heads", "refs/kalfa/candidates", "refs/remotes/origin"];

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(history, DEFAULT);
              const repo = seeded.repository;
              const model = new Map<string, number>(history.refs.map((ref) => [ref.name, ref.commit]));
              const check = (place: string) => readModelBack(seeded, history, model, extra, place);
              const at = (index: number): CommitId.CommitId => idAt(seeded.ids, index);

              const move = (ref: string, from: Option.Option<number>, to: number) =>
                repo.moveRef({ ref: refNameFrom(ref), from: Option.map(from, at), to: at(to) });

              // Refused moves first, on the store as the history made it.
              for (const [label, ref, from, to] of [
                ["from none while the ref exists", names.side, Option.none(), MOVE.three],
                ["from a commit while the ref is at another", names.side, Option.some(MOVE.three), MOVE.merge],
                ["from a commit while the ref is gone", names.gone, Option.some(MOVE.three), MOVE.merge],
              ] as const) {
                classes.add(label);
                expectFailure(yield* failed(move(ref, from, to), label), Repository.RefMoved, { ref }, label);
                yield* check(`${label}: no ref moved`);
              }

              for (const [label, ref, other] of [
                ["making a ref inside a ref's name", `${names.main}/x`, names.main],
                ["making a ref above two refs, which names the first by bytes", "refs/kalfa/candidates", names.earlier],
              ] as const) {
                classes.add(label);

                expectFailure(
                  yield* failed(move(ref, Option.none(), MOVE.merge), label),
                  Repository.RefInTheWay,
                  { ref, other },
                  label,
                );
                yield* check(`${label}: no ref moved`);
              }

              for (const [label, to] of [
                ["to a commit the store lacks", missingId(texture, 5, [...seeded.ids, ...seeded.trees])],
                ["to a tree's id", treeAt(seeded.trees, 1)],
              ] as const) {
                classes.add(label);

                expectFailure(
                  yield* failed(
                    repo.moveRef({ ref: refNameFrom(names.branch), from: Option.none(), to: commitIdFrom(to) }),
                    label,
                  ),
                  Repository.NoSuchCommit,
                  { id: to },
                  label,
                );
                yield* check(`${label}: no ref moved`);
              }

              // Moves that succeed, one after the other: each leaves the ref at `to`, and no other ref moves.
              for (const [label, ref, from, to] of [
                ["making a candidate ref", names.fresh, Option.none(), MOVE.merge],
                ["making a remote ref", names.remote, Option.none(), MOVE.side],
                ["moving a branch forward", names.main, Option.some(MOVE.main), MOVE.merge],
                ["moving a branch back to an older commit", names.main, Option.some(MOVE.merge), MOVE.one],
                ["moving a branch to the commit it is at", names.main, Option.some(MOVE.one), MOVE.one],
              ] as const) {
                classes.add(label);
                yield* move(ref, from, to);
                model.set(ref, to);
                expect(
                  plainRefs(yield* repo.readRefs(refNameFrom(ref))),
                  `${label}: the ref is at its new commit`,
                ).toEqual([{ name: ref, commit: at(to) }]);
                yield* check(`${label}: every other ref is as it was`);
              }

              // Two moves from the commit the ref is at, run at once: one wins and the other finds the ref moved.
              classes.add("two moves from one commit at once");
              const racers = [MOVE.merge, MOVE.side];

              const raced = yield* Effect.forEach(
                racers,
                (to) => Effect.result(move(names.main, Option.some(MOVE.one), to)),
                { concurrency: "unbounded" },
              );

              expect(raced.filter(Result.isSuccess).length, "exactly one of two moves from one commit wins").toBe(1);

              for (const result of raced.filter(Result.isFailure)) {
                expectFailure(result.failure, Repository.RefMoved, { ref: names.main }, "the move that lost");
              }

              const [landed] = yield* repo.readRefs(refNameFrom(names.main));
              const winner = racers.find((to) => at(to) === landed?.commit);
              expect(winner, "the ref is at the commit of the move that won").toBeDefined();
              model.set(names.main, winner ?? MOVE.one);
              yield* check("two moves from one commit at once: the ref is where the winner put it");

              expect([...classes].sort(), "the generator reaches every move class").toEqual([...MOVE_CLASSES].sort());

              // A walk: each step reads where its ref is now, and a third of the steps ask from a commit that is wrong.
              const pool = [
                names.main,
                names.side,
                names.candidate,
                names.fresh,
                names.remote,
                names.branch,
                names.gone,
              ];

              const count = history.nodes.length;

              for (let k = 0; k < 18; k++) {
                const ref = pool[numAt(texture, 3 * k) % pool.length] ?? names.main;
                const to = numAt(texture, 3 * k + 1) % count;
                const current = model.get(ref);

                const wrong: Option.Option<number> =
                  current === undefined
                    ? Option.some((to + 1) % count)
                    : numAt(texture, 3 * k + 2) % 2 === 1
                      ? Option.none()
                      : Option.some((current + 1) % count);

                const place = `walk ${k}, ${ref}`;

                if (k % 3 === 0) {
                  expectFailure(yield* failed(move(ref, wrong, to), place), Repository.RefMoved, { ref }, place);
                } else {
                  yield* move(ref, Option.fromNullishOr(current), to);
                  model.set(ref, to);
                }

                yield* check(place);
              }
            }),
          );
        }),
      run,
    );

    // Plant: take ours whenever the sides differ; compare blobs and not modes, so a mode made executable on one side
    // comes back as it was; treat a change on both sides as theirs; name every changed path and not only the conflicting
    // ones; delete the check that the three are commits, so a missing id is a defect; leave the merged tree out of the
    // store, so a commit written on it fails with NoSuchTree; read the history, so a shallow store fails.
    it.effect.prop(
      "S14 merge trees: a clean merge gives the tree of the files the model gives and makes it when the store lacks it, a conflict names the model's paths and no others, ours and theirs swapped give the same answer, a shallow store answers, and an id that is no commit is NoSuchCommit",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const made = mergeCarrier(texture);
          expect(
            made.cases.map((each) => each.label),
            "the generator reaches every merge class",
          ).toEqual([...MERGE_CLASSES]);
          expect(
            made.cases.filter((each) => each.expected.kind === "conflict").map((each) => each.label),
            "the model finds a conflict in exactly the conflict classes",
          ).toEqual(CONFLICT_MERGE_CLASSES);

          const shallow = cutShallow(made.history);

          if (shallow === undefined) {
            return yield* Effect.die("the carrier has no commit with a parent");
          }

          const histories: ReadonlyArray<Shape> = [
            { label: "merges", history: made.history },
            { label: "merges, shallow", history: shallow },
          ];

          const trees = new Map<string, Tree.TreeId>();

          yield* seedEach(subject, histories, DEFAULT, (seeded, shape) =>
            Effect.gen(function* () {
              const repo = seeded.repository;

              for (const merge of made.cases) {
                // Swapped, the answer is the same: a clean merge gives one tree and a conflict names the same paths.
                for (const swapped of shape.label === "merges" ? [false, true] : [false]) {
                  const place = `${shape.label}, ${merge.label}${swapped ? ", ours and theirs swapped" : ""}`;
                  const answer = yield* Effect.result(repo.mergeTrees(mergeArgs(seeded, merge, swapped)));

                  if (merge.expected.kind === "clean") {
                    expect(Result.isSuccess(answer), `${place}: a clean merge answers a tree`).toBe(true);

                    if (Result.isSuccess(answer)) {
                      expect(answer.success, `${place}: the tree of the files the model gives`).toBe(
                        mergedTree(seeded, merge),
                      );
                      trees.set(merge.label, answer.success);
                    }
                  } else {
                    expect(Result.isFailure(answer), `${place}: a conflict is a failure`).toBe(true);

                    if (Result.isFailure(answer)) {
                      expectFailure(answer.failure, Repository.Conflict, { paths: conflictPaths(merge) }, place);
                    }
                  }
                }
              }

              // A commit the store lacks, and a tree's id, in each place a commit goes: nothing else is asked first.
              const first = made.cases[0];
              const real = seeded.trees.find((id) => id !== TREE_ID);

              if (first === undefined || real === undefined) {
                return yield* Effect.die("the carrier holds no merge or no tree with files");
              }

              const args = mergeArgs(seeded, first, false);
              const gone = commitIdFrom(missingId(texture, 7, [...seeded.ids, ...seeded.trees]));

              for (const [label, bad] of [
                ["a commit the store lacks", gone],
                ["a tree's id", commitIdFrom(real)],
              ] as const) {
                for (const [place, asked] of [
                  ["the merge base", { ...args, mergeBase: bad }],
                  ["ours", { ...args, ours: bad }],
                  ["theirs", { ...args, theirs: bad }],
                ] as const) {
                  expectFailure(
                    yield* failed(repo.mergeTrees(asked), `${shape.label}, ${label} as ${place}`),
                    Repository.NoSuchCommit,
                    { id: bad },
                    `${shape.label}, ${label} as ${place}`,
                  );
                }
              }
            }),
          );

          // With no commit that holds the merged files, the store has no such tree to find: the merge makes it, and a commit
          // can then be written on it.
          const bare = mergeCarrier(texture, "", false);

          yield* seedEach(
            subject,
            [{ label: "merges, no commit holds a merged tree", history: bare.history }],
            DEFAULT,
            (seeded) =>
              Effect.forEach(
                bare.cases.filter((merge) => merge.expected.kind === "clean"),
                (merge) =>
                  Effect.gen(function* () {
                    const place = `no answer commit, ${merge.label}`;
                    const tree = yield* seeded.repository.mergeTrees(mergeArgs(seeded, merge, false));
                    expect(tree, `${place}: the same tree as before`).toBe(trees.get(merge.label));

                    const written = yield* writeCall(seeded.repository, {
                      tree,
                      parents: [],
                      author: flatAt(texture, 2),
                      message: "m\n",
                    });

                    expect(
                      (yield* seeded.repository.readCommit(written.id)).tree,
                      `${place}: a commit on the tree`,
                    ).toBe(tree);
                  }),
                { concurrency: 1 },
              ),
          );
        }),
      run,
    );

    // Slice 1 of ticket 1935: reading a file. The model is `readModel` and `readCarrier` in History.test-support.ts.

    // Plant: answer none for an empty file, (a) red; pass the bytes through a UTF-8 decode and encode, (a) red; match a listed
    // name by its start, (b) red; answer the file above for a path below a file, (b) red.
    it.effect.prop(
      "S25 read a file: every path of every commit's tree reads back as its bytes, exactly; each path of the no-file classes is none, never no bytes and never an error; an empty file is Some of no bytes",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = everyReadClass(readCarrier(texture), ["(a)", "(b)"]);
          const plain = (each: ReadCase) => each.expected.kind === "file" || each.expected.kind === "none";

          const reads = yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(carrier.history, DEFAULT);

              return yield* readAll(seeded, carrier, "reads", DEFAULT.limits.blob, { text: false, only: plain });
            }),
          );

          const files = carrier.cases.filter((each) => each.expected.kind === "file");
          expect(files.length, "the generator reaches files").toBeGreaterThan(20);
          expect(reads - files.length, "the generator reaches paths that hold nothing").toBeGreaterThan(20);
          expect(
            files.some((each) => each.expected.kind === "file" && each.expected.bytes.length === 0),
            "the generator reaches an empty file",
          ).toBe(true);
        }),
      run,
    );

    // Plant: delete the folder check, so a folder answers none, (c) red; read a link's target as its content, (d) red; answer none
    // below a link, (d) red.
    it.effect.prop(
      "S26 not a file: a folder fails NotAFile with holds folder naming the path, a link fails with holds link, and a path below a link fails naming the link",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = everyReadClass(readCarrier(texture), ["(c)", "(d)"]);
          const refusing = (each: ReadCase) => each.expected.kind === "not-a-file";

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(carrier.history, DEFAULT);
              yield* readAll(seeded, carrier, "refusals", DEFAULT.limits.blob, { only: refusing });
            }),
          );

          const held = carrier.cases.flatMap((each) =>
            each.expected.kind === "not-a-file"
              ? [`${each.expected.holds} ${each.expected.path === each.path ? "at" : "above"}`]
              : [],
          );

          expect([...new Set(held)].sort(), "the generator reaches a folder, a link, and a path below a link").toEqual([
            "folder at",
            "link above",
            "link at",
          ]);
        }),
      run,
    );

    // Plant: delete the read's size check, (e) red; count `>=` for `>`, (e) red. The folder and link checks come first: a limit of
    // one byte leaves every refusal and every none as it was.
    it.effect.prop(
      "S27 the blob limit never cuts: a file of exactly limits.blob bytes reads, one byte more fails FileTooLarge naming it, from readFile and readText, and a refusal or none comes first",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = readCarrier(texture);
          const sizes = carrier.history.nodes.flatMap((node) => node.files.map((each) => each.content.length));
          const most = Math.max(...sizes);
          expect(most, "the generator reaches a file past 1000 bytes").toBeGreaterThan(1000);

          const large = (limit: number) =>
            carrier.cases.filter((each) => each.expected.kind === "file" && each.expected.bytes.length > limit).length;

          expect(large(most), "no file is over the largest").toBe(0);
          expect(large(most - 1), "the largest is one byte over").toBeGreaterThan(0);
          expect(large(1), "most files are over one byte").toBeGreaterThan(10);

          // Every file within one byte of the largest is read, the edge of the limit, and two cases of each class beside them.
          const only = sampled(
            carrier,
            2,
            (each) => each.expected.kind === "file" && each.expected.bytes.length >= most - 1,
          );

          for (const limit of [1, most, most - 1]) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(carrier.history, settings({ blob: limit }));
                yield* readAll(seeded, carrier, `a limit of ${limit} bytes`, limit, { only });
              }),
            );
          }

          // Slice 2: `editTree` writes a file of exactly `limits.blob` bytes and refuses one byte more, naming the first path by bytes,
          // and a refused edit leaves the store as it was.
          const edits = everyTreeEditClass(treeEditCarrier(texture));
          const largest = largestContent(edits);

          const sized = (each: TreeEditCase) =>
            each.changes.some(([, change]) => change !== "absent" && change.length === largest);

          expect(
            edits.cases.filter(sized).length,
            "the generator reaches a new content of the largest size",
          ).toBeGreaterThan(0);

          for (const limit of [largest, largest - 1, 1]) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(edits.history, settings({ blob: limit }));
                const chosen = edits.cases.filter((each, k) => sized(each) || k < 4);
                let refusals = 0;

                for (const [k, each] of chosen.entries()) {
                  const model = editWant(edits, each, limit);
                  const before = yield* seeded.fingerprint;
                  const result = yield* editing(seeded, each, k);
                  expectEdit(`${each.label}, a limit of ${limit} bytes`, result, model, answerTree(seeded, each));
                  refusals += model.kind === "too-large" ? 1 : 0;

                  if (model.kind !== "files") {
                    expect(
                      yield* seeded.fingerprint,
                      `${each.label}: a refused edit leaves the store as it was`,
                    ).toEqual(before);
                  }
                }

                expect(refusals > 0, `a limit of ${limit} bytes: some edit is too large`).toBe(limit < largest);
              }),
            );
          }
        }),
      run,
    );

    // Plant: answer none for an unknown commit, (f) red; check for a shallow store first, (h) red.
    it.effect.prop(
      "S28 unknown commits and shallow stores: an id the store lacks, or a tree's or blob's id, fails NoSuchCommit naming it, never none; a shallow store answers every read",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = readCarrier(texture);
          const shallow = cutShallow(carrier.history);
          expect(shallow, "the carrier has a commit with parents").toBeDefined();
          const first = carrier.cases[0];
          const blob = carrier.history.nodes.flatMap((node) => node.files).find((each) => each.content.length > 0);

          const only = sampled(carrier, 1);

          const stores = [
            { label: "whole", history: carrier.history },
            ...(shallow === undefined ? [] : [{ label: "shallow", history: shallow }]),
          ];

          for (const store of stores) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(store.history, DEFAULT);
                yield* readAll(seeded, carrier, store.label, DEFAULT.limits.blob, { only });

                const lacking = [
                  commitIdFrom(missingId(texture, 0, seeded.ids)),
                  commitIdFrom(TREE_ID),
                  ...(blob === undefined ? [] : [commitIdFrom(blobId(blob.content))]),
                  ...seeded.trees
                    .filter((id) => id !== TREE_ID)
                    .slice(0, 1)
                    .map(commitIdFrom),
                ];

                for (const absent of lacking) {
                  const calls: ReadonlyArray<readonly [string, Effect.Effect<unknown, unknown>]> = [
                    ["readFile", seeded.repository.readFile(absent, pathFrom(first?.path ?? "x"))],
                    ["readText", seeded.repository.readText(absent, pathFrom(first?.path ?? "x"))],
                  ];

                  for (const [call, effect] of calls) {
                    const error = yield* refused(effect, `${store.label}: ${call} of ${absent}`);
                    expect(isMissing(error), `${store.label}: ${call} of ${absent} fails with NoSuchCommit`).toBe(true);

                    if (isMissing(error)) {
                      expect(error.id, `${store.label}: ${call} names the id it was asked for`).toBe(absent);
                    }
                  }
                }
              }),
            );
          }

          // Slice 2: `editTree` of an id the store lacks, or of a tree's or a blob's id, fails NoSuchCommit naming it; and on a
          // shallow store every edit answers as on a whole one.
          const edits = everyTreeEditClass(treeEditCarrier(texture));
          const cut = cutShallow(edits.history);
          expect(cut, "the edit carrier has a commit with parents").toBeDefined();
          const small: Repository.Edit = new Map([[pathFrom("some/new"), Uint8Array.of(1, 2)]]);
          const blobFile = edits.history.nodes.flatMap((node) => node.files).find((each) => each.content.length > 0);

          for (const store of [
            { label: "whole", history: edits.history },
            ...(cut === undefined ? [] : [{ label: "shallow", history: cut }]),
          ]) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(store.history, DEFAULT);

                for (const [k, each] of edits.cases.entries()) {
                  if (k % 4 === 0) {
                    expectEdit(
                      `${store.label}: ${each.label}`,
                      yield* editing(seeded, each, k),
                      editWant(edits, each, DEFAULT.limits.blob),
                      answerTree(seeded, each),
                    );
                  }
                }

                const lacking = [
                  commitIdFrom(missingId(texture, 1, seeded.ids)),
                  commitIdFrom(TREE_ID),
                  ...(blobFile === undefined ? [] : [commitIdFrom(blobId(blobFile.content))]),
                  ...seeded.trees
                    .filter((id) => id !== TREE_ID)
                    .slice(0, 1)
                    .map(commitIdFrom),
                ];

                for (const absent of lacking) {
                  const before = yield* seeded.fingerprint;

                  const error = yield* refused(
                    seeded.repository.editTree(absent, small),
                    `${store.label}: editTree of ${absent}`,
                  );

                  expect(isMissing(error), `${store.label}: editTree of ${absent} fails with NoSuchCommit`).toBe(true);

                  if (isMissing(error)) {
                    expect(error.id, `${store.label}: editTree names the id it was asked for`).toBe(absent);
                  }

                  expect(yield* seeded.fingerprint, `${store.label}: nothing was written`).toEqual(before);
                }
              }),
            );
          }
        }),
      run,
    );

    // Plant: decode with replacement, (g) red; drop a leading BOM, (g) red; read none as an empty text: red.
    it.effect.prop(
      "S29 text: readText is readFile decoded as UTF-8 exactly, a BOM, a CR and a NUL kept; bytes that are not UTF-8 fail NotUtf8 naming the path; none stays none",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = everyReadClass(readCarrier(texture), ["(g)"]);

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(carrier.history, DEFAULT);
              yield* readAll(seeded, carrier, "text", DEFAULT.limits.blob, { raw: false });
            }),
          );

          const failing = carrier.cases.filter(
            (each) => each.expected.kind === "file" && textModel(each.expected.bytes) === undefined,
          );

          expect(failing.length, "the generator reaches bytes that are not UTF-8").toBeGreaterThan(1);
          expect(
            carrier.cases.some(
              (each) => each.expected.kind === "file" && (textModel(each.expected.bytes) ?? "").startsWith("\uFEFF"),
            ),
            "the generator reaches a BOM",
          ).toBe(true);
        }),
      run,
    );

    // Plant: answer the store's own array, (j) red.
    it.effect.prop(
      "S30 the caller's bytes: changing the bytes an answer gave changes nothing read later, and each answer is its own array",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = readCarrier(texture);
          let changed = 0;

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(carrier.history, DEFAULT);

              const files = carrier.cases.filter(
                (each) => each.expected.kind === "file" && each.expected.bytes.length > 0,
              );

              for (const each of files) {
                const commit = idAt(seeded.ids, each.commit);
                const first = yield* seeded.repository.readFile(commit, pathFrom(each.path));

                if (Option.isSome(first)) {
                  changed += 1;
                  first.value.fill(((first.value[0] ?? 0) ^ 0x5a) & 0xff);
                  const again = yield* seeded.repository.readFile(commit, pathFrom(each.path));
                  const want = each.expected.kind === "file" ? each.expected.bytes : undefined;
                  expect(Option.getOrUndefined(again), `${each.label}: read again`).toEqual(want);
                  expect(Option.getOrUndefined(again), `${each.label}: not the array given before`).not.toBe(
                    first.value,
                  );
                }
              }
            }),
          );

          expect(changed, "the generator reaches files with bytes").toBeGreaterThan(20);

          // Slice 2: the bytes given to `editTree` are the caller's: changing them after the call changes nothing read later.
          const edits = everyTreeEditClass(treeEditCarrier(texture));
          let given = 0;

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(edits.history, DEFAULT);

              for (const [k, each] of edits.cases.entries()) {
                const model = editWant(edits, each, DEFAULT.limits.blob);

                if (each.intent !== "tree" || model.kind !== "files" || given >= 6) {
                  continue;
                }

                const passed = editFrom(each.changes, k % 2 === 1);
                const result = yield* Effect.result(seeded.repository.editTree(idAt(seeded.ids, each.base), passed));
                expectEdit(each.label, result, model, answerTree(seeded, each));

                for (const change of passed.values()) {
                  if (change !== "absent") {
                    given += 1;
                    change.fill(((change[0] ?? 0) ^ 0x5a) & 0xff);
                  }
                }

                if (Result.isSuccess(result)) {
                  yield* readEdited(
                    seeded,
                    result.success,
                    model.files,
                    each.changes.map(([path]) => path),
                    `${each.label}, after the caller changed its bytes`,
                  );
                }
              }
            }),
          );

          expect(given, "the generator reaches new contents").toBeGreaterThan(5);
        }),
      run,
    );

    // Plant: match a listed name by its start, its end or its length only, (b) red; take the first listed name that shares the asked
    // name's first bytes. On `/process` the match is the bytes of the listed name against the asked name's: compare one byte less,
    // skip the length check, accept any byte, or stop at the first equal byte.
    it.effect.prop(
      "S36 the asked name among its neighbors: with siblings that start with it, end with it, are its start, or differ from it in one character or in other characters of the same byte length, each file reads as its own bytes, in the top folder and in a folder below",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = nameCarrier(texture);
          expect(carrier.classes, "the generator reaches every name class").toEqual(NAME_CLASSES);
          expect(carrier.cases.length, "the generator reaches many names").toBeGreaterThan(40);

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(carrier.history, DEFAULT);
              yield* readAll(seeded, carrier, "names", DEFAULT.limits.blob, { text: false });
            }),
          );
        }),
      run,
    );

    // Slice 2 of ticket 1935: editing a tree. The model is `editModel` and `treeEditCarrier` in History.test-support.ts: each edit that
    // makes a tree has a commit in the history whose files are the model's, so the tree id of that commit is the answer.

    // Plant: keep a folder left with no files, (k) red; drop the untouched files of a rewritten folder, (k) red; give a replaced file
    // mode 100644, (m) red; give a new file a sibling's mode, (m) red; match a changed name to a listed one by its start, (q) red.
    it.effect.prop(
      "S31 edit a tree: for every edit the classes and the draws make, editTree answers the tree id of the commit that holds the model's files, readFile at a commit on that tree gives each changed path its new bytes or none, and every other path is as before",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = everyTreeEditClass(treeEditCarrier(texture));
          let made = 0;
          let read = 0;

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(carrier.history, DEFAULT);

              for (const [k, each] of carrier.cases.entries()) {
                const model = editWant(carrier, each, DEFAULT.limits.blob);

                if (each.intent !== "tree") {
                  continue;
                }

                made += 1;
                const result = yield* editing(seeded, each, k);
                expectEdit(each.label, result, model, answerTree(seeded, each));

                if (k % 3 === 0 && Result.isSuccess(result) && model.kind === "files") {
                  read += 1;
                  const changed = new Set(each.changes.map(([path]) => path));
                  const other = model.files.find((file) => !changed.has(file.path));

                  yield* readEdited(
                    seeded,
                    result.success,
                    model.files,
                    [...changed, ...(other === undefined ? [] : [other.path])],
                    each.label,
                  );
                }
              }
            }),
          );

          expect(made, "the generator reaches many edits that change").toBeGreaterThan(20);
          expect(read, "the generator reads some of the trees back").toBeGreaterThan(5);
          expect(
            carrier.cases.filter((each) => each.classes.includes("(k) a random edit") && each.intent === "tree").length,
            "the drawn edits make trees",
          ).toBeGreaterThan(2);
        }),
      run,
    );

    // Plant: refuse "absent" on a path that holds nothing, (l) red; give a file replaced with its own bytes mode 100644, (l) red;
    // answer a new empty tree for an empty edit, (l) red.
    it.effect.prop(
      "S32 no change gives back the same tree: an empty edit, a file replaced with its own bytes and absent on a path that holds nothing each answer the base's own tree, and the store is as it was",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = everyTreeEditClass(treeEditCarrier(texture));
          let still = 0;

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(carrier.history, DEFAULT);

              for (const [k, each] of carrier.cases.entries()) {
                if (each.intent !== "no change") {
                  continue;
                }

                still += 1;
                const before = yield* seeded.fingerprint;
                const result = yield* editing(seeded, each, k);
                expectEdit(
                  each.label,
                  result,
                  editWant(carrier, each, DEFAULT.limits.blob),
                  treeAt(seeded.trees, each.base),
                );
                expect(yield* seeded.fingerprint, `${each.label}: the store is as it was`).toEqual(before);
              }
            }),
          );

          expect(still, "the generator reaches edits that change nothing").toBeGreaterThan(8);
        }),
      run,
    );

    // Plant: delete the check on a removed link, (n) red; delete the path-in-the-way check, (n) red; refuse a file made a folder, (n)
    // red; check the way before NotAFile, (p) red; name the last path by bytes, (p) red; check the size after NoSuchCommit, (p) red.
    it.effect.prop(
      "S33 refused edits: each refusal class fails with the error and the paths the model names, in the check order the plan gives, and leaves the store as it was",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = everyTreeEditClass(treeEditCarrier(texture));
          let refusals = 0;

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(carrier.history, DEFAULT);

              for (const [k, each] of carrier.cases.entries()) {
                if (each.intent !== "not-a-file" && each.intent !== "in-the-way") {
                  continue;
                }

                refusals += 1;
                const before = yield* seeded.fingerprint;
                const result = yield* editing(seeded, each, k);
                expectEdit(each.label, result, editWant(carrier, each, DEFAULT.limits.blob), undefined);
                expect(yield* seeded.fingerprint, `${each.label}: the store is as it was`).toEqual(before);
              }

              // An id the store lacks with a change at a folder is NoSuchCommit, as nothing can be said of that folder.
              const absent = commitIdFrom(missingId(texture, 2, seeded.ids));

              const folder = carrier.cases.find((each) =>
                each.classes.includes("(p) a change at a folder beside a new file in the way"),
              );

              expect(folder, "the generator reaches a change at a folder").toBeDefined();

              if (folder !== undefined) {
                const before = yield* seeded.fingerprint;

                const error = yield* refused(
                  seeded.repository.editTree(absent, editFrom(folder.changes, false)),
                  "an unknown base",
                );

                expect(isMissing(error), "an unknown base with a change at a folder: NoSuchCommit").toBe(true);
                expect(yield* seeded.fingerprint, "an unknown base: the store is as it was").toEqual(before);
              }
            }),
          );

          expect(refusals, "the generator reaches many refusals").toBeGreaterThan(14);

          // Under a limit that makes the largest content too large, that is the first refusal, before the commit is looked up and before
          // any folder is: a change at a folder, and an unknown base.
          const tight = carrier.cases.find((each) => each.tight !== undefined);
          const limit = tight?.tight;

          if (tight === undefined || limit === undefined) {
            return yield* Effect.die("the generator reaches no case that is too large first");
          }

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(carrier.history, settings({ blob: limit }));
              const before = yield* seeded.fingerprint;
              const model = editWant(carrier, tight, limit);
              expectEdit(tight.label, yield* editing(seeded, tight, 0), model, undefined);

              const absent = commitIdFrom(missingId(texture, 3, seeded.ids));
              const unknown = yield* Effect.result(seeded.repository.editTree(absent, editFrom(tight.changes, false)));
              expectEdit(`${tight.label}, an unknown base`, unknown, model, undefined);
              expect(yield* seeded.fingerprint, "a too large edit: the store is as it was").toEqual(before);
            }),
          );
        }),
      run,
    );
  });
};
