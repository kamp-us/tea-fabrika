// Today's lead tooling. Only the causal assertion can identify the intended temporary break.
import { Option, RegExp as Regex, Schema } from "effect";
import { cases, type Request } from "./plant-cases.ts";

export const Failure = Schema.Struct({
  diagnostic: Schema.Literals([
    "AssertionError: a notice names its process",
    "AssertionError: expected _tag loaded; received _tag same",
    "AssertionError: expected _tag loaded; received _tag unknown",
    "AssertionError: expected _tag failed; received _tag same",
    "AssertionError: expected _tag failed; received _tag unknown",
  ]),
  assertion: Schema.NullOr(
    Schema.Struct({
      line: Schema.Int.check(Schema.isGreaterThan(0)),
      column: Schema.Int.check(Schema.isGreaterThan(0)),
    }),
  ),
});

const ErrorDetails = Schema.Struct({
  name: Schema.String,
  message: Schema.String,
  stack: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Unknown),
});

const diagnostic = (key: Request["case"], message: string) => {
  if (key === "checklist-pid" && /^a notice names its process(?::|\n|$)/.test(message)) {
    return "AssertionError: a notice names its process";
  }

  if (key === "watcher-r1") {
    const received = /^expected \{\s*_tag: 'same'/.test(message)
      ? "same"
      : message.startsWith("expected { Object (_tag, program, ...) }")
        ? "unknown"
        : null;

    const expected =
      /to match object \{\s*_tag: '(loaded)'\s*\}/.exec(message)?.[1] ??
      /to match object \{\s*_tag: '(failed)',\s*reason: 'bundle'\s*\}/.exec(message)?.[1];

    if (received !== null && expected !== undefined) {
      return `AssertionError: expected _tag ${expected}; received _tag ${received}`;
    }
  }

  return null;
};

export const failure = (key: Request["case"], errors: readonly unknown[]) => {
  if (errors.length !== 1) {
    return null;
  }

  let current = errors[0];
  const seen = new Set<unknown>();

  while (!seen.has(current)) {
    seen.add(current);
    const decoded = Schema.decodeUnknownOption(ErrorDetails)(current);

    if (Option.isNone(decoded)) {
      return null;
    }

    const error = decoded.value;

    if (error.name === "Error" && error.cause != null) {
      current = error.cause;
      continue;
    }

    if (error.name !== "AssertionError" || error.cause != null) {
      return null;
    }

    const safe = diagnostic(key, error.message);
    const frame = new RegExp(`${Regex.escape(cases[key].test)}:([0-9]+):([0-9]+)`).exec(error.stack ?? "");
    const assertion = frame === null ? null : { line: Number(frame[1]), column: Number(frame[2]) };

    return Option.getOrNull(Schema.decodeUnknownOption(Failure)({ diagnostic: safe, assertion }));
  }

  return null;
};
