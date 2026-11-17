import { Result, Schema } from "effect";
import { At, Token, words } from "./words.ts";

const Named = Schema.Struct({ name: Schema.String, at: At });

type Named = typeof Named.Type;

export const BUILTINS: ReadonlyArray<string> = [
  "jobs",
  "ps",
  "tell",
  "close",
  "stop",
  "attach",
  "programs",
  "help",
  "exit",
  "summon",
  "dismiss",
  "agents",
];

export const Refused = Schema.TaggedStruct("refused", {
  at: Schema.Int,
  reason: Schema.String,
  status: Schema.Int,
  guess: Schema.NullOr(Schema.String),
});

export type Refused = typeof Refused.Type;

export interface Pipeline {
  readonly commands: ReadonlyArray<Command>;
  readonly bars: ReadonlyArray<At>;
  readonly at: At;
}

export const Value = Schema.TaggedUnion({
  text: { text: Schema.String, at: At },
  sub: { pipeline: Schema.suspend((): Schema.Schema<Pipeline> => PipelineSchema), at: At },
});

export type Value = typeof Value.Type;

const Given = Schema.Struct({ name: Schema.String, at: At, value: Value });

const CommandSchema = Schema.Struct({
  program: Named,
  flags: Schema.Array(Given),
  told: Schema.Array(Given),
  out: Schema.NullOr(Named),
  into: Schema.NullOr(Named),
  help: Schema.NullOr(Schema.Struct({ at: At, name: Schema.NullOr(Named) })),
  all: Schema.NullOr(At),
  at: At,
});

export type Command = typeof CommandSchema.Type;

const PipelineSchema = Schema.Struct({ commands: Schema.Array(CommandSchema), bars: Schema.Array(At), at: At });

export const Statement = Schema.TaggedUnion({
  run: {
    pipeline: PipelineSchema,
    background: Schema.Boolean,
    after: Schema.NullOr(Schema.Literals(["&&", "||"])),
    text: Schema.String,
  },
  builtin: {
    name: Schema.String,
    args: Schema.Array(Named),
    background: Schema.Boolean,
    after: Schema.NullOr(Schema.Literals(["&&", "||"])),
    text: Schema.String,
  },
  said: {
    room: Schema.NullOr(Named),
    mentions: Schema.Array(Named),
    prose: Schema.Struct({ text: Schema.String, at: At }),
    text: Schema.String,
  },
});

export type Statement = typeof Statement.Type;

const Parsed = Schema.TaggedStruct("parsed", { statements: Schema.Array(Statement) });

export type Parsed = typeof Parsed.Type | Refused;

export const refusal = (at: number, reason: string, status = 2, guess: string | null = null): Refused =>
  Refused.make({ at, reason, status, guess });

/** The rest of an agent or room line is prose, including shell punctuation. */
const said = (line: string): Statement | null => {
  const start = line.length - line.trimStart().length;
  const mark = line.charAt(start);

  if (mark !== "@" && mark !== "#") {
    return null;
  }

  const match = /^[^\s]*/.exec(line.slice(start))?.[0] ?? "";

  if (mark === "#" && match.length < 2) {
    return null;
  }

  let end = start + match.length;
  const name = { name: match.slice(1), at: { start: start + 1, end } };
  const room = mark === "#" ? name : null;
  const mentions: Named[] = mark === "@" ? [name] : [];

  if (/[ \t]/.test(line.charAt(end))) {
    end += 1;
  }

  if (room !== null) {
    while (line.charAt(end) === "@") {
      const mention = /^[^\s]*/.exec(line.slice(end))?.[0] ?? "";
      mentions.push({ name: mention.slice(1), at: { start: end + 1, end: end + mention.length } });
      end += mention.length;

      if (/[ \t]/.test(line.charAt(end))) {
        end += 1;
      }
    }
  }

  return Statement.cases.said.make({
    room,
    mentions,
    prose: { text: line.slice(end), at: { start: end, end: line.length } },
    text: line,
  });
};

/** Parse the tsh grammar. Refusals remain values; malformed input never throws. */
export function parse(line: string): Parsed {
  const prose = said(line);

  if (prose !== null) {
    return Parsed.make({ statements: [prose] });
  }

  const read = words(line);

  if (read.open) {
    return refusal(line.length, "a quote is not closed");
  }

  const tokens = read.tokens;
  let pos = 0;
  const peek = () => tokens[pos];
  const op = (name: string) => {
    const t = peek();
    return t !== undefined && Token.guards.op(t) && t.op === name;
  };
  const at = () => peek()?.start ?? line.length;
  const fail = (reason: string) => Result.fail(refusal(at(), reason));

  const value = (name: string): Result.Result<Value, Refused> => {
    const token = peek();

    if (token !== undefined && Token.guards.word(token)) {
      pos += 1;
      return Result.succeed(Value.cases.text.make({ text: token.text, at: token }));
    }

    if (!op("$(")) {
      return fail(`${name} needs a value`);
    }

    const start = at();
    pos += 1;
    return Result.gen(function* () {
      const inner = yield* pipeline();
      const close = peek();

      if (!op(")") || close === undefined) {
        return yield* Result.fail(refusal(start, "no ) closes this $("));
      }

      pos += 1;
      return Value.cases.sub.make({ pipeline: inner, at: { start, end: close.end } });
    });
  };

  const command = (): Result.Result<Command, Refused> =>
    Result.gen(function* () {
      const first = peek();

      if (first === undefined || !Token.guards.word(first) || /^[-<>]/.test(first.text) || first.text.includes("=")) {
        return yield* fail("expected a program name");
      }

      pos += 1;
      const program = { name: first.text, at: { start: first.start, end: first.end } };
      const flags: Array<typeof Given.Type> = [];
      const told: Array<typeof Given.Type> = [];
      let out: Named | null = null;
      let into: Named | null = null;
      let all: At | null = null;
      let end = first.end;

      // --help ignores the other parts of its command, including incomplete flags.
      let depth = 0;
      let help: Command["help"] = null;
      let scan = pos;

      for (; scan < tokens.length; scan += 1) {
        const t = tokens[scan]!;

        if (Token.guards.op(t)) {
          if (t.op === "$(") {
            depth += 1;
          } else if (t.op === ")" && depth > 0) {
            depth -= 1;
          } else if (depth === 0) {
            break;
          }
        } else if (depth === 0 && help === null && ["--help", "-h"].includes(t.text)) {
          const next = tokens[scan + 1];
          help = { at: t, name: next !== undefined && Token.guards.word(next) ? { name: next.text, at: next } : null };
        }
      }

      if (help !== null) {
        pos = scan;
        return {
          program,
          flags,
          told,
          out,
          into,
          help,
          all,
          at: { start: first.start, end: tokens[pos - 1]?.end ?? end },
        };
      }

      while (pos < tokens.length) {
        const t = peek()!;

        if (!Token.guards.word(t)) {
          break;
        }

        pos += 1;
        const text = t.text;
        const eq = text.indexOf("=");

        if (text === "--all") {
          if (all !== null) {
            return yield* Result.fail(refusal(t.start, "--all is given twice"));
          }

          all = t;
        } else if (text.startsWith(">") || text.startsWith("<")) {
          if (text.length === 1) {
            return yield* Result.fail(refusal(t.start, `${text} needs a name without a space`));
          }

          const named = { name: text.slice(1), at: { start: t.start, end: t.end } };

          if (text.startsWith(">")) {
            out = named;
          } else {
            into = named;
          }
        } else if (text.startsWith("--") || eq > 0) {
          const flag = text.startsWith("--");
          const name = text.slice(flag ? 2 : 0, eq < 0 ? undefined : eq);

          if (name === "") {
            return yield* Result.fail(refusal(t.start, "a flag needs a name after --"));
          }

          let given: Value;

          if (eq >= 0 && text.slice(eq + 1) !== "") {
            given = Value.cases.text.make({ text: text.slice(eq + 1), at: { start: t.start + eq + 1, end: t.end } });
          } else if (eq >= 0 && !(op("$(") && peek()?.start === t.end)) {
            return yield* Result.fail(refusal(t.end, `${name} needs a value after =`));
          } else {
            given = yield* value(name);
          }

          const part = { name, at: { start: t.start, end: t.start + (flag ? 2 : 0) + name.length }, value: given };
          (flag ? flags : told).push(part);
        } else {
          return yield* Result.fail(
            refusal(t.start, `expected --flag value, input=value, >output or <input, not ${text}`),
          );
        }

        end = tokens[pos - 1]?.end ?? t.end;
      }

      return { program, flags, told, out, into, help: null, all, at: { start: first.start, end } };
    });

  const pipeline = (): Result.Result<Pipeline, Refused> =>
    Result.gen(function* () {
      const head = yield* command();
      const commands = [head];
      const bars: At[] = [];

      while (op("|")) {
        const bar = peek()!;
        bars.push({ start: bar.start, end: bar.end });
        pos += 1;
        commands.push(yield* command());
      }

      return { commands, bars, at: { start: head.at.start, end: commands.at(-1)!.at.end } };
    });

  const result = Result.gen(function* () {
    const statements: Statement[] = [];
    let after: "&&" | "||" | null = null;

    while (pos < tokens.length) {
      if (op(";") && after === null) {
        pos += 1;
        continue;
      }

      const first = peek();

      if (first === undefined) {
        break;
      }

      let statement: Statement;

      if (Token.guards.word(first) && BUILTINS.includes(first.text)) {
        pos += 1;
        const args: Named[] = [];

        while (pos < tokens.length) {
          const t = peek()!;

          if (!Token.guards.word(t)) {
            break;
          }

          args.push({ name: t.text, at: t });
          pos += 1;
        }

        statement = Statement.cases.builtin.make({
          name: first.text,
          args,
          after,
          background: op("&"),
          text: line.slice(first.start, tokens[pos - 1]?.end),
        });
      } else {
        const piped = yield* pipeline();
        statement = Statement.cases.run.make({
          pipeline: piped,
          after,
          background: op("&"),
          text: line.slice(piped.at.start, piped.at.end),
        });
      }

      statements.push(statement);

      if (pos === tokens.length) {
        break;
      }

      if (op("&&") || op("||")) {
        after = op("&&") ? "&&" : "||";
        pos += 1;

        if (pos === tokens.length) {
          return yield* fail(`${after} needs a command after it`);
        }
      } else if (op(";") || op("&")) {
        if (op("&") && after !== null) {
          return yield* fail("a job cannot be part of an && or || chain");
        }

        after = null;
        pos += 1;
      } else {
        return yield* fail("expected ; or the end of the line");
      }
    }

    return Parsed.make({ statements });
  });
  return Result.match(result, { onFailure: (reason) => reason, onSuccess: (parsed) => parsed });
}
