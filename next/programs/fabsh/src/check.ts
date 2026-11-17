import { Match, Result, Schema, SchemaAST } from "effect";
import { type Command, type Parsed, Refused, refusal, Statement, Value, type Pipeline } from "./grammar.ts";

export interface Declaration {
  readonly name: string;
  readonly table?: boolean;
  readonly flags: Readonly<
    Record<string, { readonly schema: Schema.ConstraintDecoder<unknown>; readonly required: boolean }>
  >;
  readonly inputs: Readonly<Record<string, Schema.ConstraintDecoder<unknown>>>;
  readonly outputs: Readonly<Record<string, Schema.ConstraintDecoder<unknown>>>;
}

export type ProgramList = ReadonlyMap<string, Declaration>;

export const own = <A>(record: Readonly<Record<string, A>>, name: string): A | undefined =>
  Object.hasOwn(record, name) ? record[name] : undefined;

/** Unknown comparisons refuse. A reader needs only its declared fields, not the writer's extra fields. */
const accepts = (writer: SchemaAST.AST, reader: SchemaAST.AST): boolean => {
  if (writer === reader || SchemaAST.isNever(writer)) {
    return true;
  }

  if ((reader.checks ?? []).some((check) => !writer.checks?.includes(check))) {
    return false;
  }

  if (SchemaAST.isUnknown(reader) || SchemaAST.isAny(reader)) {
    return true;
  }

  if (SchemaAST.isUnion(writer)) {
    return writer.types.every((member) => accepts(member, reader));
  }

  if (SchemaAST.isUnion(reader)) {
    return reader.types.some((member) => accepts(writer, member));
  }

  if (SchemaAST.isLiteral(writer)) {
    if (SchemaAST.isLiteral(reader)) {
      return writer.literal === reader.literal;
    }

    return Match.value(reader).pipe(
      Match.tag("String", () => typeof writer.literal === "string"),
      Match.tag("Number", () => typeof writer.literal === "number"),
      Match.tag("Boolean", () => typeof writer.literal === "boolean"),
      Match.orElse(() => false),
    );
  }

  if (SchemaAST.isObjects(writer) && SchemaAST.isObjects(reader)) {
    if (reader.indexSignatures.length > 0) {
      return false;
    }

    return reader.propertySignatures.every((needed) => {
      const field = writer.propertySignatures.find((given) => given.name === needed.name);
      return field === undefined
        ? SchemaAST.isOptional(needed.type)
        : (SchemaAST.isOptional(needed.type) || !SchemaAST.isOptional(field.type)) && accepts(field.type, needed.type);
    });
  }

  return Match.value(reader).pipe(
    Match.tag("String", () => SchemaAST.isString(writer)),
    Match.tag("Number", () => SchemaAST.isNumber(writer)),
    Match.tag("Boolean", () => SchemaAST.isBoolean(writer)),
    Match.tag("BigInt", () => SchemaAST.isBigInt(writer)),
    Match.tag("Null", () => SchemaAST.isNull(writer)),
    Match.tag("Undefined", () => SchemaAST.isUndefined(writer)),
    Match.orElse(() => false),
  );
};

export const fits = (writer: Schema.Constraint, reader: Schema.Constraint): boolean =>
  accepts(SchemaAST.toType(writer.ast), SchemaAST.toType(reader.ast));

interface Wire {
  readonly output: string;
  readonly input: string;
}

export const wire = (
  writer: Declaration,
  reader: Declaration,
  out: string | null = null,
  into: string | null = null,
): Result.Result<Wire, string> => {
  const outputs = out === null ? Object.keys(writer.outputs) : [out];
  const inputs = into === null ? Object.keys(reader.inputs) : [into];
  const matches: Wire[] = [];

  for (const output of outputs) {
    const from = own(writer.outputs, output);

    for (const input of inputs) {
      const to = own(reader.inputs, input);

      if (from !== undefined && to !== undefined && fits(from, to)) {
        matches.push({ output, input });
      }
    }
  }

  return matches.length === 1
    ? Result.succeed(matches[0]!)
    : Result.fail(
        matches.length === 0
          ? `${writer.name}'s outputs fit no input of ${reader.name}`
          : "several ports fit: name >output or <input",
      );
};

/** Edit distance supplies the same small typo hint for programs and declared parts. */
const distance = (left: string, right: string): number => {
  let row = Array.from({ length: right.length + 1 }, (_, n) => n);

  for (let i = 0; i < left.length; i += 1) {
    const next = [i + 1];

    for (let j = 0; j < right.length; j += 1) {
      next.push(Math.min(next[j]! + 1, row[j + 1]! + 1, row[j]! + (left.charAt(i) === right.charAt(j) ? 0 : 1)));
    }

    row = next;
  }

  return row[right.length]!;
};

const guess = (name: string, names: Iterable<string>): string | null => {
  const ranked = [...names]
    .map((candidate) => ({ candidate, cost: distance(name, candidate) }))
    .sort((a, b) => a.cost - b.cost);
  const first = ranked[0];
  return first !== undefined && first.cost <= 2 && first.cost < (ranked[1]?.cost ?? Infinity) ? first.candidate : null;
};

const entry = (command: Command, programs: ProgramList) => {
  const found = programs.get(command.program.name);
  return found === undefined
    ? Result.fail(
        refusal(
          command.program.at.start,
          `no program named ${command.program.name}`,
          127,
          guess(command.program.name, programs.keys()),
        ),
      )
    : Result.succeed(found);
};

const literal = (text: string, schema: Schema.ConstraintDecoder<unknown>): Result.Result<unknown, string> => {
  const raw: unknown[] = [text];

  if (text === "true" || text === "false") {
    raw.push(text === "true");
  }

  if (text.trim() !== "" && Number.isFinite(Number(text))) {
    raw.push(Number(text));
  }

  const json = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown))(text);

  if (Result.isSuccess(json)) {
    raw.push(json.success);
  }

  for (const value of raw) {
    const decoded = Schema.decodeUnknownResult(schema)(value);

    if (Result.isSuccess(decoded)) {
      return Result.succeed(decoded.success);
    }
  }

  return Result.fail(`value ${text} does not fit its declared shape`);
};

const checkedValue = (
  value: Value,
  schema: Schema.ConstraintDecoder<unknown>,
  programs: ProgramList,
): Result.Result<unknown, Refused> =>
  Value.match(value, {
    text: (v) => Result.mapError(literal(v.text, schema), (reason) => refusal(v.at.start, reason)),
    sub: (v) =>
      Result.gen(function* () {
        yield* checkedPipe(v.pipeline, programs, false);
        const last = v.pipeline.commands.at(-1);

        if (last === undefined) {
          return yield* Result.fail(refusal(v.at.start, "$( ) is empty"));
        }

        const declaration = yield* entry(last, programs);
        const ports = last.out === null ? Object.keys(declaration.outputs) : [last.out.name];
        const matches = ports.filter((name) => {
          const output = own(declaration.outputs, name);
          return output !== undefined && fits(output, schema);
        });

        if (matches.length !== 1) {
          return yield* Result.fail(refusal(v.at.start, "$( ) needs one output that fits this value"));
        }

        return v;
      }),
  });

const checkedPipe = (
  pipeline: Pipeline,
  programs: ProgramList,
  top: boolean,
): Result.Result<ReadonlyArray<Wire>, Refused> =>
  Result.gen(function* () {
    const asked = top ? pipeline.commands.find((command) => command.help !== null) : undefined;

    if (asked !== undefined && asked.help !== null) {
      const declared = yield* entry(asked, programs);
      const name = asked.help.name?.name;

      if (name !== undefined) {
        const part = name.startsWith("--")
          ? name.slice(2)
          : name.startsWith(">") || name.startsWith("<")
            ? name.slice(1)
            : name.endsWith("=")
              ? name.slice(0, -1)
              : name;
        const fields = name.startsWith("--")
          ? [declared.flags]
          : name.startsWith(">")
            ? [declared.outputs]
            : name.startsWith("<") || name.endsWith("=")
              ? [declared.inputs]
              : [declared.flags, declared.inputs, declared.outputs];

        if (!fields.some((names) => Object.hasOwn(names, part))) {
          return yield* Result.fail(refusal(asked.help.name!.at.start, `${declared.name} has no part named ${name}`));
        }
      }

      return [];
    }

    const entries: Declaration[] = [];

    for (const command of pipeline.commands) {
      entries.push(yield* entry(command, programs));
    }

    const wires: Wire[] = [];

    for (let i = 0; i < pipeline.bars.length; i += 1) {
      const from = pipeline.commands[i]!;
      const to = pipeline.commands[i + 1]!;
      const bar = pipeline.bars[i]!;
      wires.push(
        yield* Result.mapError(
          wire(entries[i]!, entries[i + 1]!, from.out?.name ?? null, to.into?.name ?? null),
          (reason) => refusal(bar.start, reason),
        ),
      );
    }

    for (let i = 0; i < pipeline.commands.length; i += 1) {
      const command = pipeline.commands[i]!;
      const declared = entries[i]!;

      if (command.help !== null) {
        return yield* Result.fail(refusal(command.help.at.start, "--help gives no value to a $( )"));
      }

      if (command.into !== null && i === 0) {
        return yield* Result.fail(refusal(command.into.at.start, "<input needs a pipe before this program"));
      }

      if (command.out !== null && i === pipeline.commands.length - 1 && top) {
        return yield* Result.fail(refusal(command.out.at.start, ">output needs a pipe or $( ) to take it"));
      }

      if (command.all !== null && declared.table !== true) {
        return yield* Result.fail(
          refusal(command.all.start, `--all shows every row of a table, and ${declared.name} prints no table`),
        );
      }

      const seen = new Set<string>();

      for (const flag of command.flags) {
        const shape = own(declared.flags, flag.name);

        if (shape === undefined || seen.has(flag.name)) {
          return yield* Result.fail(
            refusal(
              flag.at.start,
              shape === undefined ? `${declared.name} has no flag --${flag.name}` : `--${flag.name} is given twice`,
              2,
              guess(flag.name, Object.keys(declared.flags)),
            ),
          );
        }

        seen.add(flag.name);
        yield* checkedValue(flag.value, shape.schema, programs);
      }

      for (const [name, flag] of Object.entries(declared.flags)) {
        if (flag.required && !seen.has(name)) {
          return yield* Result.fail(refusal(command.program.at.start, `${declared.name} needs --${name}`));
        }
      }

      for (const input of command.told) {
        const shape = own(declared.inputs, input.name);

        if (shape === undefined || wires[i - 1]?.input === input.name) {
          return yield* Result.fail(
            refusal(
              input.at.start,
              `${declared.name} has no unused input ${input.name}`,
              2,
              guess(input.name, Object.keys(declared.inputs)),
            ),
          );
        }

        yield* checkedValue(input.value, shape, programs);
      }
    }

    return wires;
  });

/** Diagnostics for every pipe, including nested substitutions and later statements. */
export const pipeErrors = (parsed: Parsed, programs: ProgramList): ReadonlyArray<Refused> => {
  const errors = new Map<number, Refused>();
  const visit = (pipeline: Pipeline): void => {
    for (let i = 0; i < pipeline.bars.length; i += 1) {
      const from = pipeline.commands[i]!;
      const to = pipeline.commands[i + 1]!;
      const writer = programs.get(from.program.name);
      const reader = programs.get(to.program.name);

      if (writer !== undefined && reader !== undefined) {
        const result = wire(writer, reader, from.out?.name ?? null, to.into?.name ?? null);

        if (Result.isFailure(result)) {
          const at = pipeline.bars[i]!.start;
          errors.set(at, refusal(at, result.failure));
        }
      }
    }

    for (const command of pipeline.commands) {
      for (const given of [...command.flags, ...command.told]) {
        Value.matchOrElse(given.value, { sub: ({ pipeline }) => visit(pipeline) }, () => {});
      }
    }
  };

  if (Schema.is(Refused)(parsed)) {
    for (const pipeline of parsed.pipelines) {
      visit(pipeline);
    }
  } else {
    for (const statement of parsed.statements) {
      Statement.matchOrElse(statement, { run: ({ pipeline }) => visit(pipeline) }, () => {});
    }
  }

  return [...errors.values()].sort((a, b) => a.at - b.at);
};

const Accepted = Schema.TaggedStruct("checked", { statements: Schema.Array(Statement) });

/** Check the entire line before its caller can start a program. */
export const check = (parsed: Parsed, programs: ProgramList): typeof Accepted.Type | Refused => {
  if (Schema.is(Refused)(parsed)) {
    return parsed;
  }

  for (const statement of parsed.statements) {
    const result = Statement.match(statement, {
      run: (s) => checkedPipe(s.pipeline, programs, true),
      builtin: () => Result.succeed([]),
      said: () => Result.succeed([]),
    });

    if (Result.isFailure(result)) {
      return result.failure;
    }
  }

  return Accepted.make({ statements: parsed.statements });
};
