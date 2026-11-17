// Today's lead tooling. Only the causal assertion can identify the intended temporary break.
import { Option, RegExp as Regex, Schema } from "effect";
import { cases, type Request } from "./plant-cases.ts";

export const Failure = Schema.Struct({
  diagnostic: Schema.Literals([
    "AssertionError: a notice names its process",
    "AssertionError: the update its Process published reached the client unchanged",
    "AssertionError: the client heard the checklist's views",
    "AssertionError: checklist notice count differs",
    "AssertionError: alarm completion waits for the real callback",
    "AssertionError: settled stays pending while the callback is held",
    "AssertionError: settled includes the rescheduled due callback",
    "AssertionError: canceling a schedule keeps the running call pending",
    "AssertionError: alarm failure reaches the completion waiter",
    "AssertionError: direct and nested pnpm versions differ from the explicit Node pin",
    "AssertionError: runtime discovery exceeded the existing command cleanup bound",
    "AssertionError: runtime discovery ignored the explicit Node pin",
    "AssertionError: pinned host environment retained a removed parent value",
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
  actual: Schema.optionalKey(Schema.Unknown),
  expected: Schema.optionalKey(Schema.Unknown),
  operator: Schema.optionalKey(Schema.String),
});

export const Issue = Schema.Struct({
  kind: Schema.Literals([
    "AssertionError",
    "SyntaxError",
    "ReferenceError",
    "TypeError",
    "RangeError",
    "Error",
    "timeout",
    "unknown",
  ]),
  frame: Failure.fields.assertion,
});

/** Diagnostic only: closed error names and a position in the selected test, never error text. */
export const issue = (key: Request["case"], input: unknown): typeof Issue.Type => {
  let current = input;
  const seen = new Set<unknown>();

  while (!seen.has(current)) {
    seen.add(current);

    const decoded = Schema.decodeUnknownOption(ErrorDetails)(current);

    if (Option.isNone(decoded)) {
      break;
    }

    const error = decoded.value;

    if (error.cause != null) {
      current = error.cause;
      continue;
    }

    const frame = new RegExp(`${Regex.escape(cases[key].test)}:([0-9]+):([0-9]+)`).exec(error.stack ?? "");

    const position = Schema.decodeUnknownOption(Failure.fields.assertion)(
      frame === null ? null : { line: Number(frame[1]), column: Number(frame[2]) },
    );

    const kind = Schema.decodeUnknownOption(Issue.fields.kind)(error.name);

    return Issue.make({
      kind: /^Test timed out in [0-9]+ms/.test(error.message) ? "timeout" : Option.getOrElse(kind, () => "unknown"),
      frame: Option.getOrNull(position),
    });
  }

  return Issue.make({ kind: "unknown", frame: null });
};

const Directory = Schema.String.check(Schema.isPattern(/^\/(?:[^/]+\/)*[^/]+$/));

const Fixture = Schema.Struct({
  keep: Schema.Literal("fixture child"),
  removed: Schema.Boolean,
  home: Schema.String,
  tmp: Directory,
  foreground: Schema.Literal(true),
  paid: Schema.Literal(true),
});

const Count = Schema.Union([
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.String.check(Schema.isPattern(/^(?:0|[1-9][0-9]*)$/)),
]);

const diagnostic = (key: Request["case"], error: typeof ErrorDetails.Type) => {
  const message = error.message;
  const selected = cases[key];

  if ("failures" in selected) {
    const fixed = selected.failures.find(
      (entry) =>
        entry.diagnostic !== "AssertionError: checklist notice count differs" &&
        new RegExp(`^${Regex.escape(entry.diagnostic.slice("AssertionError: ".length))}(?::|\\n|$)`).test(message),
    );

    if (fixed !== undefined) {
      return fixed.diagnostic;
    }

    if (
      key === "checklist-drop-notify" &&
      error.operator === "strictEqual" &&
      /^expected \+?[0-9]+ to be \+?[0-9]+ \/\/ Object.is equality$/.test(message)
    ) {
      const actual = Schema.decodeUnknownOption(Count)(error.actual);
      const expected = Schema.decodeUnknownOption(Count)(error.expected);

      if (
        Option.isSome(actual) &&
        Option.isSome(expected) &&
        Number.isFinite(Number(actual.value)) &&
        Number.isFinite(Number(expected.value)) &&
        Number(actual.value) !== Number(expected.value)
      ) {
        return "AssertionError: checklist notice count differs";
      }
    }

    return null;
  }

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

  if ((key === "host-pin" || key === "host-pnpm-path") && /^expected \[.*\] to deeply equal \[/s.test(message)) {
    return "AssertionError: direct and nested pnpm versions differ from the explicit Node pin";
  }

  if (key === "host-discovery-timeout" && /^expected [0-9]+(?:\.[0-9]+)? to be less than 10000\s*$/.test(message)) {
    return "AssertionError: runtime discovery exceeded the existing command cleanup bound";
  }

  if (error.operator !== "strictEqual" || !/^expected .* to be .* \/\/ Object.is equality$/s.test(message)) {
    return null;
  }

  if (key === "host-requested-pin" && error.actual === "0.0.0\n" && error.expected === "26.13.0\n") {
    return "AssertionError: runtime discovery ignored the explicit Node pin";
  }

  if (key === "host-env-order") {
    const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Fixture));
    const actual = decode(error.actual, { onExcessProperty: "error" });
    const expected = decode(error.expected, { onExcessProperty: "error" });

    if (
      Option.isSome(actual) &&
      Option.isSome(expected) &&
      !actual.value.removed &&
      expected.value.removed &&
      !actual.value.tmp.split("/").some((part) => part === "." || part === "..") &&
      expected.value.home === `${expected.value.tmp}/home`
    ) {
      // Matches immutable testHomes' socket-length rule before its mkdtemp calls.
      const root =
        new TextEncoder().encode(`${actual.value.tmp}/fh-XXXXXX/host/sock`).length < 103 ? actual.value.tmp : "/tmp";

      const host = new RegExp(`^${Regex.escape(actual.value.tmp)}/host-[^/]+$`);
      const home = new RegExp(`^${Regex.escape(root)}/fh-[^/]+$`);

      if (host.test(expected.value.tmp) && home.test(actual.value.home)) {
        return "AssertionError: pinned host environment retained a removed parent value";
      }
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

    const safe = diagnostic(key, error);
    const frame = new RegExp(`${Regex.escape(cases[key].test)}:([0-9]+):([0-9]+)`).exec(error.stack ?? "");
    const assertion = frame === null ? null : { line: Number(frame[1]), column: Number(frame[2]) };
    const selected = cases[key];

    if (
      "failures" in selected &&
      !selected.failures.some(
        (entry) => entry.diagnostic === safe && entry.line === assertion?.line && entry.column === assertion.column,
      )
    ) {
      return null;
    }

    if (
      (key === "host-requested-pin" && (assertion?.line !== 195 || assertion.column !== 62)) ||
      (key === "host-pnpm-path" && (assertion?.line !== 194 || assertion.column !== 70)) ||
      (key === "host-env-order" && (assertion?.line !== 197 || assertion.column !== 24))
    ) {
      return null;
    }

    return Option.getOrNull(Schema.decodeUnknownOption(Failure)({ diagnostic: safe, assertion }));
  }

  return null;
};
