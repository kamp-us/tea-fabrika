import { Equal, Predicate, Result } from "effect";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";

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
  parent.length <= path.length && Arr.every(parent, (key, i) => key === path[i]);

const same = (left: Path, right: Path): boolean => left.length === right.length && prefix(left, right);

/** @internal */
export const read = (value: unknown, path: Path): unknown =>
  Arr.reduce(path, value as unknown, (parent, key) =>
    Predicate.hasProperty(parent, key) && Object.hasOwn(parent, key) ? parent[key] : undefined,
  );

const equal = (left: unknown, right: unknown): boolean => {
  if (Predicate.isDate(left) || Predicate.isDate(right)) {
    return Equal.equals(left, right);
  }

  if (Arr.isArray(left) && Arr.isArray(right)) {
    return left.length === right.length && Arr.every(left, (value, i) => equal(value, right[i]));
  }

  if (Predicate.isObject(left) && Predicate.isObject(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      Arr.every(keys, (key) => Object.hasOwn(right, key) && equal(left[key], right[key]))
    );
  }

  return Equal.equals(left, right);
};

const ending = (text: string): string => /\r?\n/.exec(text)?.[0] ?? "\n";
const lineStart = (text: string, at: number): number => text.lastIndexOf("\n", at - 1) + 1;

const apply = (text: string, edits: ReadonlyArray<Splice>): string =>
  Arr.reduce(
    [...edits].sort((a, b) => b.start - a.start || b.end - a.end),
    text,
    (source, edit) => source.slice(0, edit.start) + edit.text + source.slice(edit.end),
  );

// Comments are parser ranges, including the #, never text guessed from a string's contents.
const retained = (text: string, index: Index, range: Range): string =>
  Arr.join(
    Arr.map(
      Arr.filter(index.comments, (comment) => comment.start >= range.start && comment.end <= range.end),
      (comment) => text.slice(comment.start, comment.end) + ending(text),
    ),
    "",
  );

/** @internal */
export const check = (index: Index, path: ReadonlyArray<string>): Result.Result<void, Refusal> => {
  let line = 1;

  for (let i = 0; i <= path.length; i++) {
    const at = path.slice(0, i);
    const entry = Arr.findFirst(index.assignments, (assignment) => same(assignment.path, at)).pipe(
      Option.orElse(() => Arr.findFirst(index.sections, (section) => same(section.path, at))),
      Option.orElse(() => Arr.findFirst(index.sections, (section) => i > 0 && prefix(at, section.path))),
    );

    if (Option.isSome(entry)) {
      line = entry.value.line;
    }

    const value = read(index.value, at);

    if (
      path.length === 0 ||
      (i < path.length && value !== undefined && (!Predicate.isObject(value) || Predicate.isDate(value))) ||
      (i === path.length &&
        value !== undefined &&
        !Arr.some(index.assignments, (assignment) => same(assignment.path, path)))
    ) {
      return Result.fail({ line, cause: new Error("The path does not name an editable setting.") });
    }
  }

  return Result.succeed(undefined);
};

const commentEdits = (text: string, index: Index, assignment: Assignment, removed: Range): Array<Splice> => {
  const comments = retained(text, index, removed);

  if (!comments) {
    return [];
  }

  // An inline member can follow a sibling's comments. Keep retained comments after that sibling.
  const at = assignment.inline ? assignment.start : lineStart(text, assignment.start);
  const before = at > lineStart(text, at) ? ending(text) : "";
  return [{ start: at, end: at, text: before + comments }];
};

/** @internal */
export const remove = (text: string, index: Index, path: ReadonlyArray<string>): Result.Result<string, Refusal> => {
  const checked = check(index, path);

  if (Result.isFailure(checked)) {
    return Result.fail<Refusal>(checked.failure);
  }

  const found = Arr.findFirst(index.assignments, (candidate) => same(candidate.path, path));

  if (Option.isNone(found)) {
    return Result.succeed(text);
  }

  const assignment = found.value;

  const edits: Array<Splice> = [{ ...assignment, text: "" }, ...commentEdits(text, index, assignment, assignment)];

  if (assignment.inline) {
    const start = assignment.inline.start;
    const comma = Arr.findFirst(index.inlines, (inline) => inline.start === start).pipe(
      Option.flatMap((parent) =>
        Arr.findFirst(parent.commas, (token) => token.start >= assignment.end).pipe(
          Option.orElse(() => Arr.findLast(parent.commas, (token) => token.end <= assignment.start)),
        ),
      ),
    );

    if (Option.isSome(comma)) {
      edits.push({ ...comma.value, text: "" });
    }
  }

  const candidate = apply(text, edits);
  // Removing the last assignment must not turn its preceding separator into a final newline.
  return Result.succeed(!text.endsWith("\n") && candidate.endsWith("\n") ? `${candidate} ` : candidate);
};

const insertLine = (text: string, at: number, content: string): string => {
  const eol = ending(text);
  const before = at > 0 && text[at - 1] !== "\n" ? eol : "";
  const after = at < text.length || text.endsWith("\n") ? eol : "";
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
): Result.Result<string, Refusal> => {
  const checked = check(index, path);

  if (Result.isFailure(checked)) {
    return Result.fail<Refusal>(checked.failure);
  }

  const found = Arr.findFirst(index.assignments, (candidate) => same(candidate.path, path));

  if (Option.isSome(found)) {
    const assignment = found.value;

    if (equal(read(index.value, path), value)) {
      return Result.succeed(text);
    }

    return Result.succeed(
      apply(text, [
        { ...assignment.value, text: rendered },
        ...commentEdits(text, index, assignment, assignment.value),
      ]),
    );
  }

  const parent = Arr.filter(index.inlines, (inline) => prefix(inline.path, path)).sort(
    (a, b) => b.path.length - a.path.length,
  )[0];

  if (parent) {
    const at = parent.end - 1;
    const last = parent.members.at(-1);
    const separator = last && !Arr.some(parent.commas, (comma) => comma.start >= last.end) ? ", " : "";
    return Result.succeed(
      apply(text, [
        {
          start: at,
          end: at,
          text: `${separator}${Arr.join(keys.slice(parent.path.length), ".")} = ${rendered}`,
        },
      ]),
    );
  }

  const parentPath = path.slice(0, -1);

  if (parentPath.length > 0 && read(index.value, parentPath) === undefined) {
    return Result.succeed(
      insertLine(text, text.length, `[${Arr.join(keys.slice(0, -1), ".")}]${ending(text)}${keys.at(-1)} = ${rendered}`),
    );
  }

  const section =
    Arr.filter(index.sections, (candidate) => prefix(candidate.path, parentPath)).sort(
      (a, b) => b.path.length - a.path.length,
    )[0] ?? index.sections[0];
  return Result.succeed(
    insertLine(text, section.end, `${Arr.join(keys.slice(section.path.length), ".")} = ${rendered}`),
  );
};
