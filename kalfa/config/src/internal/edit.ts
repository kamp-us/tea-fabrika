import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

/** @internal */
export type Path = ReadonlyArray<string | number>;

/** @internal */
export interface Range {
  readonly start: number;
  readonly end: number;
}

/** @internal */
export interface Assignment extends Range {
  readonly path: Path;
  readonly line: number;
  readonly value: Range;
  readonly inline?: Range;
}

/** @internal */
export interface Inline extends Range {
  readonly path: Path;
  readonly members: ReadonlyArray<Assignment>;
  readonly commas: ReadonlyArray<Range>;
}

/** @internal */
export interface Section {
  readonly path: Path;
  readonly line: number;
  /** The offset of the header's own line (the start of the text for the root). */
  readonly start: number;
  readonly end: number;
}

/** @internal */
export interface Index {
  readonly value: Readonly<Record<string, unknown>>;
  readonly assignments: ReadonlyArray<Assignment>;
  readonly inlines: ReadonlyArray<Inline>;
  readonly sections: readonly [Section, ...Array<Section>];
  readonly comments: ReadonlyArray<Range>;
}

/** @internal */
export interface Refusal {
  readonly line: number;
  readonly cause: Error;
}

interface Splice extends Range {
  readonly text: string;
}

/** @internal */
export const prefix = (parent: Path, path: Path): boolean =>
  parent.length <= path.length && parent.every((key, i) => key === path[i]);

const same = (left: Path, right: Path): boolean => left.length === right.length && prefix(left, right);

/** @internal */
export const read = (value: Index["value"], path: Path): unknown =>
  path.reduce<unknown>(
    (parent, key) =>
      Predicate.hasProperty(parent, key) && Rec.has<string, unknown>(parent, String(key)) ? parent[key] : undefined,
    value,
  );

/** @internal */
export const equal = (left: unknown, right: unknown): boolean => {
  if (Predicate.isDate(left) || Predicate.isDate(right)) {
    return Equal.equals(left, right);
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, i) => equal(value, right[i]));
  }

  if (Predicate.isObject(left) && Predicate.isObject(right)) {
    const keys = Rec.keys(left);

    return (
      keys.length === Rec.keys(right).length && keys.every((key) => Rec.has(right, key) && equal(left[key], right[key]))
    );
  }

  return Equal.equals(left, right);
};

/** The text's own line break: its first one, or LF. @internal */
export const ending = (text: string): string => /\r?\n/.exec(text)?.[0] ?? "\n";

/**
 * Where the line holding offset `at` starts. The text before `at` holds that line's newline, so a
 * line that starts at `at` itself is found.
 *
 * @internal
 */
export const lineStart = (text: string, at: number): number =>
  Option.match(Str.lastIndexOf("\n")(Str.slice(0, at)(text)), { onNone: () => 0, onSome: (newline) => newline + 1 });

const apply = (text: string, edits: ReadonlyArray<Splice>): string =>
  [...edits]
    .sort((a, b) => b.start - a.start || b.end - a.end)
    .reduce((source, edit) => Str.slice(0, edit.start)(source) + edit.text + Str.slice(edit.end)(source), text);

// Removing the last line must not turn its preceding separator into a final newline.
const tidy = (text: string, candidate: string): string =>
  !Str.endsWith("\n")(text) && Str.endsWith("\n")(candidate) ? `${candidate} ` : candidate;

// Comments are parser ranges, including the #, never text guessed from a string's contents.
const retained = (text: string, index: Index, range: Range, eol: string): string =>
  index.comments
    .filter((comment) => comment.start >= range.start && comment.end <= range.end)
    .map((comment) => Str.slice(comment.start, comment.end)(text) + eol)
    .join("");

/** @internal */
export const check = (index: Index, path: ReadonlyArray<string>): Result.Result<void, Refusal> => {
  let line = 1;

  for (let i = 0; i <= path.length; i++) {
    const at = path.slice(0, i);

    const entry =
      index.assignments.find((assignment) => same(assignment.path, at)) ??
      index.sections.find((section) => same(section.path, at)) ??
      index.sections.find((section) => i > 0 && prefix(at, section.path));

    if (entry !== undefined) {
      line = entry.line;
    }

    const value = read(index.value, at);

    if (
      path.length === 0 ||
      (i < path.length && value !== undefined && (!Predicate.isObject(value) || Predicate.isDate(value))) ||
      (i === path.length && value !== undefined && !index.assignments.some((assignment) => same(assignment.path, path)))
    ) {
      return Result.fail({ line, cause: new Error("The path does not name an editable setting.") });
    }
  }

  return Result.succeed(undefined);
};

const commentEdits = (
  text: string,
  index: Index,
  assignment: Assignment,
  removed: Range,
  eol: string,
): Array<Splice> => {
  const comments = retained(text, index, removed, eol);

  if (comments === "") {
    return [];
  }

  // An inline member can follow a sibling's comments. Keep retained comments after that sibling.
  const at = assignment.inline !== undefined ? assignment.start : lineStart(text, assignment.start);
  const before = at > lineStart(text, at) ? eol : "";

  return [{ start: at, end: at, text: before + comments }];
};

/** @internal */
export const remove = (
  text: string,
  index: Index,
  path: ReadonlyArray<string>,
  eol: string,
): Result.Result<string, Refusal> => {
  const checked = check(index, path);

  if (Result.isFailure(checked)) {
    return Result.fail<Refusal>(checked.failure);
  }

  const assignment = index.assignments.find((candidate) => same(candidate.path, path));

  if (assignment === undefined) {
    return Result.succeed(text);
  }

  const edits: Array<Splice> = [{ ...assignment, text: "" }, ...commentEdits(text, index, assignment, assignment, eol)];

  if (assignment.inline !== undefined) {
    const start = assignment.inline.start;
    const parent = index.inlines.find((inline) => inline.start === start);

    const comma =
      parent?.commas.find((token) => token.start >= assignment.end) ??
      parent?.commas.findLast((token) => token.end <= assignment.start);

    if (comma !== undefined) {
      edits.push({ ...comma, text: "" });
    }
  }

  return Result.succeed(tidy(text, apply(text, edits)));
};

const insertLine = (text: string, at: number, content: string, eol: string): string => {
  const before = at > 0 && text[at - 1] !== "\n" ? eol : "";
  const after = at < text.length || Str.endsWith("\n")(text) ? eol : "";

  return apply(text, [{ start: at, end: at, text: before + content + after }]);
};

/** @internal */
export const set = (
  text: string,
  index: Index,
  path: ReadonlyArray<string>,
  value: unknown,
  rendered: string,
  keys: ReadonlyArray<string>,
  eol: string,
): Result.Result<string, Refusal> => {
  const checked = check(index, path);

  if (Result.isFailure(checked)) {
    return Result.fail<Refusal>(checked.failure);
  }

  const assignment = index.assignments.find((candidate) => same(candidate.path, path));

  if (assignment !== undefined) {
    if (equal(read(index.value, path), value)) {
      return Result.succeed(text);
    }

    return Result.succeed(
      apply(text, [
        { ...assignment.value, text: rendered },
        ...commentEdits(text, index, assignment, assignment.value, eol),
      ]),
    );
  }

  const parent = [...index.inlines]
    .filter((inline) => prefix(inline.path, path))
    .sort((a, b) => b.path.length - a.path.length)[0];

  if (parent !== undefined) {
    const at = parent.end - 1;
    const last = parent.members.at(-1);
    const separator = last !== undefined && !parent.commas.some((comma) => comma.start >= last.end) ? ", " : "";

    return Result.succeed(
      apply(text, [
        {
          start: at,
          end: at,
          text: `${separator}${keys.slice(parent.path.length).join(".")} = ${rendered}`,
        },
      ]),
    );
  }

  const parentPath = path.slice(0, -1);

  if (parentPath.length > 0 && read(index.value, parentPath) === undefined) {
    return Result.succeed(
      insertLine(text, text.length, `[${keys.slice(0, -1).join(".")}]${eol}${keys.at(-1)} = ${rendered}`, eol),
    );
  }

  const section =
    [...index.sections]
      .filter((candidate) => prefix(candidate.path, parentPath))
      .sort((a, b) => b.path.length - a.path.length)[0] ?? index.sections[0];

  return Result.succeed(
    insertLine(text, section.end, `${keys.slice(section.path.length).join(".")} = ${rendered}`, eol),
  );
};

// ---------------------------------------------------------------------------------------------
// A whole table: compared key by key, so only the keys that differ are written.
// ---------------------------------------------------------------------------------------------

/**
 * One change to one key or table. A step runs on the text the step before it made.
 *
 * @internal
 */
export const Step = Schema.TaggedUnion({
  Set: { path: Schema.Array(Schema.String), value: Schema.Unknown },
  Remove: { path: Schema.Array(Schema.String) },
  /** An array of tables replaced whole, where its first `[[...]]` block started. */
  Blocks: { path: Schema.Array(Schema.String), value: Schema.Array(Schema.Unknown) },
});

/** @internal */
export type Step = typeof Step.Type;

/**
 * How the text writes the value at a path: no line holds it (`absent`), one assignment holds it whole (`one`: a scalar,
 * an array, an inline table, or a key inside one), a table no single assignment holds (`spread`: under its own header,
 * under headers below it, or by dotted keys), or an array of tables (`tables`).
 *
 * @internal
 */
export type Form = "absent" | "one" | "spread" | "tables";

/** @internal */
export const formAt = (index: Index, path: ReadonlyArray<string>): Form => {
  const old = read(index.value, path);

  if (old === undefined) {
    return "absent";
  }

  // The root is no key: a one-key step refuses it.
  if (path.length === 0 || index.assignments.some((assignment) => same(assignment.path, path))) {
    return "one";
  }

  return Array.isArray(old) ? "tables" : "spread";
};

/** Whether the array can be written as `[[...]]` blocks: it holds a table, and every element is one. */
export const asBlocks = (value: ReadonlyArray<unknown>): boolean => value.length > 0 && value.every(Predicate.isObject);

/** The table the line above the first block of the array at `path` sits in: where a line written in its place lives. */
export const above = (index: Index, path: ReadonlyArray<string>): Path => {
  const first = index.sections.findIndex((section) => section.path.length > path.length && prefix(path, section.path));

  return index.sections.at(first - 1)?.path ?? [];
};

const holds = (index: Index, path: ReadonlyArray<string>): boolean => {
  const table = above(index, path);

  return table.length < path.length && prefix(table, path);
};

const write = (path: ReadonlyArray<string>, value: unknown): Step => Step.cases.Set.make({ path, value });

const leave = (path: ReadonlyArray<string>): Step => Step.cases.Remove.make({ path });

/**
 * The steps that turn the text's value at `path` into `next`. Data, not text, decides: `1.0` is `1` and a table's key
 * order carries nothing, so no change is no step. Arrivals come before departures, so a new item is placed while its
 * leaving siblings still mark the place.
 *
 * @internal
 */
export const plan = (index: Index, path: ReadonlyArray<string>, next: unknown): ReadonlyArray<Step> => {
  const old = read(index.value, path);
  const form = formAt(index, path);

  if (equal(old, next)) {
    return [];
  }

  if (form === "spread" && Predicate.isObject(old) && Predicate.isObject(next)) {
    // An empty table that no header names once its keys go is written `= {}`, so a start reads {} back.
    if (Rec.isEmptyRecord(next) && !index.sections.some((section) => same(section.path, path))) {
      return [leave(path), write(path, {})];
    }

    return [
      ...Rec.keys(next).flatMap((key) => plan(index, [...path, key], next[key])),
      ...Rec.keys(old)
        .filter((key) => !Rec.has(next, key))
        .map((key) => leave([...path, key])),
    ];
  }

  // A new array that cannot be blocks is one line where the first block started, when that table can hold it.
  if (form === "tables" && Array.isArray(next) && (asBlocks(next) || holds(index, path))) {
    return [Step.cases.Blocks.make({ path, value: next })];
  }

  return form === "absent" || form === "one" ? [write(path, next)] : [leave(path), write(path, next)];
};

/** Where a header's own comment lines start: up over comment lines only, stopping at a blank line or a key. */
const headerStart = (text: string, section: Section): number => {
  let start = section.start;

  while (start > 0) {
    // start - 1 is the newline that ends the line above.
    const previous = lineStart(text, start - 1);

    if (!/^\s*#[^\r\n]*\s*$/.test(Str.slice(previous, start)(text))) {
      break;
    }

    start = previous;
  }

  return start;
};

/** Where the run of blank lines right above `at` starts. */
const blanksAbove = (text: string, at: number): number => {
  let start = at;

  while (start > 0 && /^\s*$/.test(Str.slice(lineStart(text, start - 1), start)(text))) {
    start = lineStart(text, start - 1);
  }

  return start;
};

interface Block extends Range {
  readonly path: Path;
  /** The offset of the header's own line. */
  readonly header: number;
}

/** The blocks at or under `path`: from a header's own comment lines to the next header's own comment lines. */
const blocksUnder = (text: string, index: Index, path: ReadonlyArray<string>): ReadonlyArray<Block> =>
  index.sections.flatMap((section, i) => {
    const next = index.sections.at(i + 1);

    return section.path.length > 0 && prefix(path, section.path)
      ? [
          {
            path: section.path,
            header: section.start,
            start: headerStart(text, section),
            end: next !== undefined ? headerStart(text, next) : text.length,
          },
        ]
      : [];
  });

/** The blocks, in the text's order, merged where they touch. A run of blocks that ends the file takes the blank lines above it. */
const runs = (text: string, blocks: ReadonlyArray<Range>): ReadonlyArray<Range> => {
  const found: Array<Range> = [];

  for (const block of blocks) {
    const last = found.at(-1);

    if (last !== undefined && block.start <= last.end) {
      found[found.length - 1] = { start: last.start, end: Math.max(last.end, block.end) };
    } else {
      found.push(block);
    }
  }

  return found.map((run) => (run.end === text.length ? { start: blanksAbove(text, run.start), end: run.end } : run));
};

/** The line holding the range, whole, with its line break. */
const wholeLine = (text: string, range: Range): Range => {
  const newline = text.indexOf("\n", range.end);

  return { start: lineStart(text, range.start), end: newline < 0 ? text.length : newline + 1 };
};

/**
 * Takes out every block and every line that holds data at or under `path`: the comments inside a block go, and the
 * comment lines right above its header. A block that ends the file takes the blank lines above it. A dotted line goes whole.
 *
 * @internal
 */
export const removeTable = (text: string, index: Index, path: ReadonlyArray<string>): string => {
  const blocks = blocksUnder(text, index, path);

  const dotted = index.assignments
    .filter(
      (assignment) =>
        assignment.inline === undefined &&
        assignment.path.length > path.length &&
        prefix(path, assignment.path) &&
        !blocks.some((block) => assignment.start >= block.start && assignment.start < block.end),
    )
    .map((assignment) => wholeLine(text, assignment));

  return apply(
    text,
    [...runs(text, blocks), ...dotted].map((cut) => ({ ...cut, text: "" })),
  );
};

/**
 * Where a new item of the table at `parent` gets a header of its own: right after the table's last block. Only when the
 * table has no header and no line of its own, and its items sit under headers below it.
 *
 * @internal
 */
export const blockAt = (index: Index, parent: ReadonlyArray<string>): number | undefined => {
  // A line of the table's own: its header, or a dotted key that no header at or below the table holds.
  const own =
    index.sections.some((section) => same(section.path, parent)) ||
    index.assignments.some(
      (assignment) =>
        assignment.path.length > parent.length &&
        prefix(parent, assignment.path) &&
        !index.sections.some(
          (section) =>
            prefix(parent, section.path) && section.start <= assignment.start && assignment.start < section.end,
        ),
    );

  return own ? undefined : index.sections.findLast((section) => prefix(parent, section.path))?.end;
};

/** Writes `lines` as a block at `at`, one blank line before it. @internal */
export const insertBlock = (text: string, at: number, lines: ReadonlyArray<string>, eol: string): string =>
  insertLine(text, at, ["", ...lines].join(eol), eol);

/**
 * Takes out the blocks at or under `path` and writes the `groups` where the first of them started, at its header: the
 * comment lines right above it stay. A blank line stands between two groups when one stood above the second old block.
 *
 * @internal
 */
export const replaceBlocks = (
  text: string,
  index: Index,
  path: ReadonlyArray<string>,
  groups: ReadonlyArray<ReadonlyArray<string>>,
  eol: string,
): string => {
  const blocks = blocksUnder(text, index, path);
  const second = blocks.filter((block) => block.path.length === path.length + 1).at(1);
  const spaced = second !== undefined && blanksAbove(text, second.header) < second.header ? eol : "";

  return apply(text, [
    ...blocks.slice(0, 1).map((first) => ({
      start: first.header,
      end: first.end,
      text: groups.map((group) => group.join(eol)).join(eol + spaced) + eol,
    })),
    ...runs(text, blocks.slice(1)).map((cut) => ({ ...cut, text: "" })),
  ]);
};

/** The answer with the original's last line break: one only when the original ended with one. @internal */
export const keepEnd = (original: string, answer: string): string => {
  const broken = (text: string) => Str.endsWith("\n")(text);

  if (answer === "" || broken(original) === broken(answer)) {
    return answer;
  }

  return broken(answer) ? answer.replace(/\r?\n$/u, "") : answer + ending(original);
};
