// Today's tooling. Stock JSON writes the private report; this keeps only closed causal facts.
import { Option, RegExp as Regex, Schema } from "effect";
import { parseSync } from "oxc-parser";
import type { Reporter } from "vitest/node";
import * as Cases from "./l11-cases.ts";

export const Attribution = Schema.Struct({
  path: Schema.Literals([...new Set([...Cases.storagePaths, ...Cases.paths])]),
  field: Schema.Literals(["name", "code", "errcode"]),
  encoding: Schema.Literals([1, 2]),
  operation: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});

export const Causal = Schema.Struct({
  finals: Schema.Array(Schema.Literals(Cases.outputs)),
  timeout: Schema.Boolean,
  assertion: Schema.NullOr(
    Schema.Struct({
      line: Schema.Int.check(Schema.isGreaterThan(0)),
      column: Schema.Int.check(Schema.isGreaterThan(0)),
    }),
  ),
});

export const Metadata = Schema.Struct({
  l11: Schema.optional(Schema.Array(Attribution)),
  l11Causal: Schema.optional(Causal),
});

const Details = Schema.Struct({
  name: Schema.String,
  message: Schema.String,
  stack: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Unknown),
  actual: Schema.optional(Schema.Unknown),
});

const actual = (value: unknown): readonly string[] => {
  const decoded = Schema.decodeUnknownOption(Schema.Array(Schema.String))(value);

  if (Option.isSome(decoded)) {
    return decoded.value;
  }

  if (typeof value !== "string") {
    return [];
  }

  // Vitest serializes non-string assertion values with pretty-format. Accept only its literal string array.
  const parsed = parseSync("assertion.js", `const actual = ${value};`);
  const statement = parsed.program.body[0];

  if (
    parsed.errors.length > 0 ||
    parsed.program.body.length !== 1 ||
    statement?.type !== "VariableDeclaration" ||
    statement.declarations.length !== 1
  ) {
    return [];
  }

  const array = statement.declarations[0]?.init;

  if (array?.type !== "ArrayExpression") {
    return [];
  }

  const values: string[] = [];

  for (const entry of array.elements) {
    if (entry?.type !== "Literal" || typeof entry.value !== "string") {
      return [];
    }

    values.push(entry.value);
  }

  return values;
};

const final = (title: string, output: (typeof Cases.outputs)[number], error: typeof Details.Type): boolean => {
  if (title === Cases.aggregate) {
    return (
      /^L11: [0-9]+ storage operations were cut; storage text or metadata reached these outputs(?::|\n|$)/.test(
        error.message,
      ) && actual(error.actual).some((text) => text.endsWith(` -> ${output}`))
    );
  }

  return Cases.paths.some(
    (path) =>
      title === Cases.sibling(path, output) &&
      error.message === `L11: ${path} leaked storage text or metadata into ${output}`,
  );
};

export const causal = (title: string, errors: readonly unknown[]): typeof Causal.Type => {
  const empty = Causal.make({ finals: [], timeout: false, assertion: null });

  if (!Cases.titles.includes(title) || errors.length !== 1) {
    return empty;
  }

  let current = errors[0];
  const seen = new Set<unknown>();

  while (!seen.has(current)) {
    seen.add(current);
    const decoded = Schema.decodeUnknownOption(Details)(current);

    if (Option.isNone(decoded)) {
      return empty;
    }

    const error = decoded.value;

    if (error.name === "Error" && error.cause != null) {
      current = error.cause;
      continue;
    }

    if (error.cause != null) {
      return empty;
    }

    if (error.name === "Error" && /^Test timed out in 60000 ?ms\b/.test(error.message)) {
      return Causal.make({ finals: [], timeout: true, assertion: null });
    }

    if (error.name !== "AssertionError") {
      return empty;
    }

    const frame = new RegExp(`${Regex.escape(Cases.file)}:([0-9]+):([0-9]+)`).exec(error.stack ?? "");

    return Causal.make({
      finals: Cases.outputs.filter((output) => final(title, output, error)),
      timeout: false,
      assertion: frame === null ? null : { line: Number(frame[1]), column: Number(frame[2]) },
    });
  }

  return empty;
};

// This structural input is the public TestCase subset this hook reads, so memory stand-ins stay small.
type CaseResult = {
  readonly fullName: string;
  readonly meta: () => object;
  readonly result: () => { readonly state: string; readonly errors?: readonly unknown[] | undefined };
};

export default class L11Reporter implements Pick<Reporter, "onTestCaseResult"> {
  onTestCaseResult(test: CaseResult): void {
    const fixed = Cases.collection.find((row) => row.name === test.fullName);
    const result = test.result();

    if (fixed !== undefined && result.state === "failed") {
      Object.assign(test.meta(), { l11Causal: causal(fixed.reporter, result.errors ?? []) });
    }
  }
}
