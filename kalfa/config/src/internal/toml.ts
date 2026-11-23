/**
 * The TOML format: the only file that knows the TOML parser and serializer. Edit receives source positions and text.
 */
import { stringify } from "@decimalturn/toml-patch";
import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { type AST, getStaticTOMLValue, ParseError, parseTOML } from "toml-eslint-parser";
import * as Edit from "./edit.ts";
import { type Document, Fault, type Format } from "./format.ts";

const range = (node: AST.HasLocs): Edit.Range => ({ start: node.range[0], end: node.range[1] });

const key = (node: AST.TOMLKey): Array<string> => getStaticTOMLValue(node);

// A terminator keeps 1.0.3's EOF-zero token range complete, without changing source offsets.
const syntax = (text: string): AST.TOMLProgram => parseTOML(`${text} `);

// Own properties matter here: TOML keys may spell __proto__, constructor or toString, and a hole in
// an array stays missing when its prototype holds that index.
const owns = <P extends string | number>(target: object, name: P): target is { [K in P]: unknown } =>
  Predicate.hasProperty(target, name) && Rec.has<string, unknown>(target, String(name));

const put = (table: object, path: Edit.Path, value: unknown): void => {
  let parent = table;

  for (const [i, segment] of path.entries()) {
    if (i === path.length - 1) {
      Object.defineProperty(parent, segment, { value, enumerable: true, writable: true, configurable: true });
    } else {
      if (!owns(parent, segment)) {
        Object.defineProperty(parent, segment, {
          value: Predicate.isNumber(path[i + 1]) ? [] : {},
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }

      const next = owns(parent, segment) ? parent[segment] : undefined;

      // An array of tables is a step too. The parser refuses a document that writes through a
      // scalar, so a scalar here is a bug in this walk, and it fails as main's defineProperty did.
      if (!Predicate.isObjectOrArray(next)) {
        throw new TypeError("A TOML path steps through a value that is not a table or an array.");
      }

      parent = next;
    }
  }
};

/** A value as the parser reads it: a string, number, boolean or date, an array, or a table. */
type Parsed = AST.TOMLValue["value"] | ReadonlyArray<Parsed> | { readonly [name: string]: Parsed };

const content = (node: AST.TOMLContentNode): Parsed => {
  if (node.type === "TOMLValue") {
    return node.value;
  }

  if (node.type === "TOMLArray") {
    return node.elements.map(content);
  }

  const value: { [name: string]: Parsed } = {};

  for (const assignment of node.body) {
    put(value, key(assignment.key), content(assignment.value));
  }

  return value;
};

const sectionStart = (text: string, node: AST.TOMLTable): number => {
  let start = Edit.lineStart(text, node.range[0]);

  while (start > 0) {
    // start - 1 is the newline that ends the line above.
    const previous = Edit.lineStart(text, start - 1);

    if (!/^\s*(?:#[^\r\n]*)?\s*$/.test(Str.slice(previous, start)(text))) {
      break;
    }

    start = previous;
  }

  return start;
};

const index = (text: string, program: AST.TOMLProgram): Edit.Index => {
  const nodes = program.body[0].body;
  const tables = nodes.filter((node) => node.type === "TOMLTable");
  const value: Record<string, unknown> = {};
  const assignments: Array<Edit.Assignment> = [];
  const inlines: Array<Edit.Inline> = [];

  const sections: [Edit.Section, ...Array<Edit.Section>] = [
    { path: [], line: 1, start: 0, end: tables[0] !== undefined ? sectionStart(text, tables[0]) : text.length },
  ];

  const visit = (parent: Edit.Path, node: AST.TOMLKeyValue, inline?: Edit.Range): Edit.Assignment => {
    const path = [...parent, ...key(node.key)];

    const assignment = {
      ...range(node),
      path,
      line: node.loc.start.line,
      value: range(node.value),
      ...(inline !== undefined ? { inline } : {}),
    };

    assignments.push(assignment);

    if (node.value.type === "TOMLInlineTable") {
      const container = range(node.value);
      const members = node.value.body.map((child) => visit(path, child, container));

      const commas = program.tokens
        .filter(
          (token) =>
            token.value === "," &&
            token.range[0] > container.start &&
            token.range[1] < container.end &&
            !members.some((member) => token.range[0] >= member.start && token.range[1] <= member.end),
        )
        .map(range);

      inlines.push({ ...container, path, members, commas });
    }

    return assignment;
  };

  for (const [i, table] of tables.entries()) {
    const next = tables[i + 1];
    sections.push({
      path: table.resolvedKey,
      line: table.loc.start.line,
      start: Edit.lineStart(text, table.range[0]),
      end: next !== undefined ? sectionStart(text, next) : text.length,
    });

    if (Edit.read(value, table.resolvedKey) === undefined) {
      put(value, table.resolvedKey, {});
    }
  }

  for (const node of nodes) {
    if (node.type === "TOMLKeyValue") {
      const assignment = visit([], node);
      put(value, assignment.path, content(node.value));
    } else {
      for (const child of node.body) {
        const assignment = visit(node.resolvedKey, child);
        put(value, assignment.path, content(child.value));
      }
    }
  }

  return { value, assignments, inlines, sections, comments: program.comments.map(range) };
};

const parseSource = (text: string): Result.Result<Edit.Index, Fault> =>
  Result.try({
    try: () => index(text, syntax(text)),
    catch: (cause: unknown) =>
      Fault.cases.Syntax.make({ line: cause instanceof ParseError ? cause.lineNumber : 1, cause }),
  });

const Scalar = Schema.Union([Schema.String, Schema.Boolean, Schema.Number.check(Schema.isFinite())]);

const scalar = Schema.decodeUnknownSync(Scalar);

/** A value checked for the serializer: a scalar, an array or a plain table of them, with no date. */
type Encoded = typeof Scalar.Type | ReadonlyArray<Encoded> | { readonly [name: string]: Encoded };

// Validate before encoding: serializers can otherwise omit unsupported members or coerce values.
const encoded = (value: unknown, ancestors: ReadonlySet<object> = new Set()): Encoded => {
  if (Predicate.isObjectOrArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError("A TOML value cannot contain a cycle.");
    }

    const next = new Set([...ancestors, value]);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (!owns(value, i)) {
          throw new TypeError("A TOML array cannot contain a missing element.");
        }
      }

      return value.map((child) => encoded(child, next));
    }

    if (
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      Object.getOwnPropertySymbols(value).length > 0
    ) {
      throw new TypeError("A TOML table must be a plain record with string keys.");
    }

    return Rec.fromEntries(Rec.toEntries(value).map(([name, child]) => [name, encoded(child, next)]));
  }

  const result = scalar(value);

  if (Predicate.isNumber(result) && Number.isInteger(result) && !Number.isSafeInteger(result)) {
    throw new TypeError("A TOML integer must be a safe JavaScript integer.");
  }

  return result;
};

const format = { inlineTableStart: 0, multilineTable: false, multilineArray: false, trailingNewline: 0 } as const;

/** What the serializer writes for a value, as the text right of `=`. */
const written = (value: Encoded): string => {
  const source = stringify({ value }, format);
  const assignment = syntax(source).body[0].body[0];

  if (assignment?.type !== "TOMLKeyValue") {
    throw new TypeError("The encoder did not produce an assigned TOML value.");
  }

  return Str.slice(...assignment.value.range)(source);
};

/** A key as TOML writes it: bare when it can be, quoted when it must be. */
const quoted = (segment: string): string => {
  const text = stringify(Rec.fromEntries([[segment, 0]]), format);
  const node = syntax(text).body[0].body[0];

  if (node?.type !== "TOMLKeyValue") {
    throw new TypeError("The encoder did not produce a TOML key.");
  }

  return Str.slice(...node.key.range)(text);
};

const render = (path: ReadonlyArray<string>, value: unknown) =>
  Result.try({
    try: () => {
      const checked = encoded(value);

      return { value: checked, text: written(checked), keys: path.map(quoted) };
    },
    catch: (cause: unknown) => Fault.cases.Value.make({ cause }),
  });

type Table = { readonly [name: string]: Encoded };

const isTable = (value: Encoded): value is Table => Predicate.isObject(value);

const nonEmpty = (value: Encoded): value is Table => isTable(value) && !Rec.isEmptyRecord(value);

/** A table as lines: its header, a line per key, and a block of its own, after a blank line, for each non-empty table in it. */
const lines = (path: ReadonlyArray<string>, table: Table, header: string): ReadonlyArray<string> => {
  const rows = Rec.toEntries(table);

  return [
    header,
    ...rows.flatMap(([name, value]) => (nonEmpty(value) ? [] : [`${quoted(name)} = ${written(value)}`])),
    ...rows.flatMap(([name, value]) =>
      nonEmpty(value) ? ["", ...lines([...path, name], value, `[${[...path, name].map(quoted).join(".")}]`)] : [],
    ),
  ];
};

const planned = <A>(result: Result.Result<A, Edit.Refusal>): Result.Result<A, Fault> =>
  Result.mapError(result, (refusal) => Fault.cases.Conflict.make({ line: refusal.line, cause: refusal.cause }));

const parse = (text: string): Result.Result<Document, Fault> =>
  Result.gen(function* () {
    const source = yield* parseSource(text);

    return {
      value: source.value,
      spans: [
        ...source.assignments.map((assignment) => ({ path: assignment.path.map(String), line: assignment.line })),
        ...source.sections
          .filter((section) => section.path.length > 0)
          .map((section) => ({ path: section.path.map(String), line: section.line })),
      ].sort((left, right) => left.line - right.line),
    };
  });

// Today's one-key edit: the path must be one assignment, or the edit is refused.
const oneSet = (text: string, path: ReadonlyArray<string>, value: unknown): Result.Result<string, Fault> =>
  Result.gen(function* () {
    const source = yield* parseSource(text);
    yield* planned(Edit.check(source, path));
    const rendered = yield* render(path, value);
    const candidate = yield* planned(Edit.set(text, source, path, rendered.value, rendered.text, rendered.keys));
    yield* parseSource(candidate);

    return candidate;
  });

const oneRemove = (text: string, path: ReadonlyArray<string>): Result.Result<string, Fault> =>
  Result.gen(function* () {
    const source = yield* parseSource(text);
    const candidate = yield* planned(Edit.remove(text, source, path));
    yield* parseSource(candidate);

    return candidate;
  });

/** Takes out the key at `path`, or the whole table or array of tables there with the comments it owns. */
const take = (text: string, source: Edit.Index, path: ReadonlyArray<string>): Result.Result<string, Fault> => {
  const form = Edit.formAt(source, path);

  return form === "spread" || form === "tables"
    ? Result.succeed(Edit.removeTable(text, source, path))
    : planned(Edit.remove(text, source, path));
};

/** One step of a plan, made on the text the step before it left. */
const step = (text: string, next: Edit.Step): Result.Result<string, Fault> =>
  Result.gen(function* () {
    const source = yield* parseSource(text);

    return yield* Edit.Step.match(next, {
      Set: ({ path, value }) =>
        Result.gen(function* () {
          const rendered = yield* render(path, value);
          const at = Edit.blockAt(source, path.slice(0, -1));

          // Items under headers of their own: a new item gets its own header after its siblings.
          if (at !== undefined && nonEmpty(rendered.value)) {
            return Edit.insertBlock(text, at, lines(path, rendered.value, `[${rendered.keys.join(".")}]`));
          }

          return yield* planned(Edit.set(text, source, path, rendered.value, rendered.text, rendered.keys));
        }),
      Remove: ({ path }) => take(text, source, path),
      Blocks: ({ path, value }) =>
        Result.map(render(path, value), (rendered) => {
          const blocks = Arr.ensure(rendered.value);

          return Edit.replaceBlocks(
            text,
            source,
            path,
            Edit.asBlocks(blocks)
              ? blocks.filter(isTable).map((element) => lines(path, element, `[[${rendered.keys.join(".")}]]`))
              : [[`${rendered.keys.slice(Edit.home(source, path).length).join(".")} = ${rendered.text}`]],
          );
        }),
    });
  });

/** Writes only the keys that differ: an item that is the same keeps its lines, a new one is written, a gone one leaves. */
const set = (text: string, path: ReadonlyArray<string>, value: unknown): Result.Result<string, Fault> =>
  Result.gen(function* () {
    const source = yield* parseSource(text);
    let answer = text;

    for (const next of Edit.plan(source, path, value)) {
      answer = yield* step(answer, next);
    }

    yield* parseSource(answer);

    return answer;
  });

const remove = (text: string, path: ReadonlyArray<string>): Result.Result<string, Fault> =>
  Result.gen(function* () {
    const source = yield* parseSource(text);
    const candidate = yield* take(text, source, path);
    yield* parseSource(candidate);

    return candidate;
  });

/** The TOML format. */
export const toml: Format = { name: "TOML", extension: "toml", parse, set, remove };

/** Today's one-key set and remove, for the `Toml` service: a table under its own header is refused, not compared. */
export const single = { set: oneSet, remove: oneRemove };
