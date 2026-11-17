import { Schema } from "effect";
import { check, pipeErrors, type ProgramList } from "./check.ts";
import { BUILTINS, parse, Refused } from "./grammar.ts";
import { Token, words } from "./words.ts";

export const Role = Schema.TaggedUnion({
  program: {},
  builtin: {},
  flag: {},
  argument: {},
  input: {},
  pipe: {},
  separator: {},
  mention: {},
  room: {},
  string: {},
  substitution: {},
  comment: {},
  error: { reason: Schema.String },
});

export type Role = typeof Role.Type;

export const Span = Schema.Struct({ start: Schema.Int, end: Schema.Int, role: Role });

export type Span = typeof Span.Type;

/** Coloring reads the same words and checker as Enter and completion. */
export function roles(line: string, programs: ProgramList, cursor = line.length): ReadonlyArray<Span> {
  const lead = line.length - line.trimStart().length;

  if (line.charAt(lead) === "@" || /^#[^\s]+/.test(line.slice(lead))) {
    const first = /^\S+/.exec(line.slice(lead))?.[0] ?? "";
    const spans: Span[] = [
      {
        start: lead,
        end: lead + first.length,
        role: first.startsWith("@") ? Role.cases.mention.make({}) : Role.cases.room.make({}),
      },
    ];

    for (const match of line.slice(lead + first.length).matchAll(/\S+/g)) {
      const start = lead + first.length + match.index;
      spans.push({
        start,
        end: start + match[0].length,
        role: match[0].startsWith("@") ? Role.cases.mention.make({}) : Role.cases.argument.make({}),
      });
    }

    return spans;
  }

  const read = words(line);
  const spans: Span[] = [];
  let head = true;

  for (let i = 0; i < read.tokens.length; i += 1) {
    const token = read.tokens[i]!;
    const unfinished = Token.guards.word(token) && token.start <= cursor && cursor <= token.end;
    const role = Token.match(token, {
      op: (t): Role => {
        if (t.op === "|") {
          head = true;
          return Role.cases.pipe.make({});
        }

        head = t.op !== ")";
        return t.op === "$(" || t.op === ")" ? Role.cases.substitution.make({}) : Role.cases.separator.make({});
      },
      word: (t): Role => {
        if (head) {
          head = false;

          if (BUILTINS.includes(t.text)) {
            return Role.cases.builtin.make({});
          }

          return programs.has(t.text) || unfinished
            ? Role.cases.program.make({})
            : Role.cases.error.make({ reason: `no program is named ${t.text}` });
        }

        if (t.text.startsWith("@")) {
          return Role.cases.mention.make({});
        }

        if (t.text.startsWith("--") || t.text === "-h") {
          return Role.cases.flag.make({});
        }

        if (t.text.includes("=") || /^[<>]/.test(t.text)) {
          return Role.cases.input.make({});
        }

        if (/['"]/.test(line.slice(t.start, t.end))) {
          return Role.cases.string.make({});
        }

        return Role.cases.argument.make({});
      },
    });
    spans.push({ start: token.start, end: token.end, role });
  }

  for (const comment of read.comments) {
    spans.push({ ...comment, role: Role.cases.comment.make({}) });
  }

  const parsed = parse(line);
  const checked = check(parsed, programs);
  const diagnostics = [...pipeErrors(parsed, programs), ...(Schema.is(Refused)(checked) ? [checked] : [])];

  for (const error of diagnostics) {
    const span = spans.find((s) => s.start <= error.at && error.at < s.end);

    if (span === undefined || Role.isAnyOf(["program", "builtin"])(span.role)) {
      continue;
    }

    const token = read.tokens.find((t) => t.start === span.start);
    const unfinished = token !== undefined && Token.guards.word(token) && token.start <= cursor && cursor <= token.end;

    if (!unfinished) {
      spans[spans.indexOf(span)] = { ...span, role: Role.cases.error.make({ reason: error.reason }) };
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}
