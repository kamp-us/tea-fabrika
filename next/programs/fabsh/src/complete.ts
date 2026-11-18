import { Result, Schema, SchemaAST } from "effect";
import { type Declaration, type ProgramList, own, wire } from "./check.ts";
import { BUILTINS, parse, Refused, Statement } from "./grammar.ts";
import { Token, words } from "./words.ts";

export interface Job {
  readonly program: string;
  readonly inputs: Declaration["inputs"];
  readonly processes?: ReadonlyArray<{
    readonly process: string;
    readonly program: string;
    readonly inputs: Declaration["inputs"];
  }>;
}

export type Jobs = ReadonlyMap<number, Job>;

export interface Talk {
  readonly names: ReadonlyArray<string>;
  readonly harnesses: ReadonlyArray<string>;
  readonly offers?: Readonly<Record<string, ReadonlyArray<string>>>;
}

export interface Completed {
  readonly word: string;
  readonly candidates: ReadonlyArray<string>;
}

const choices = (schema: Schema.Constraint | undefined): ReadonlyArray<string> => {
  if (schema === undefined) {
    return [];
  }

  const values = (ast: SchemaAST.AST): ReadonlyArray<string> => {
    if (SchemaAST.isLiteral(ast)) {
      return [String(ast.literal)];
    }

    if (SchemaAST.isUnion(ast)) {
      return ast.types.flatMap(values);
    }

    if (SchemaAST.isBoolean(ast)) {
      return ["true", "false"];
    }

    return [];
  };
  return values(SchemaAST.toType(schema.ast));
};

export function complete(
  line: string,
  programs: ProgramList,
  jobs: Jobs = new Map(),
  talk: Talk = { names: [], harnesses: [] },
): Completed {
  const read = words(line);
  const last = read.tokens.at(-1);
  const current = !read.trailing && last !== undefined && Token.guards.word(last) ? last : undefined;
  const word = current === undefined ? "" : line.slice(current.start);
  const result = (all: Iterable<string>): Completed => ({
    word,
    candidates: [...new Set(all)].filter((value) => value.startsWith(word)),
  });
  const lead = line.trimStart();

  if (lead.startsWith("@")) {
    return /\s/.test(lead) ? result([]) : result(talk.names.map((name) => `@${name}`));
  }

  if (read.open || (current !== undefined && current.text !== word)) {
    return result([]);
  }

  const before = current === undefined ? read.tokens : read.tokens.slice(0, -1);
  const cut = before.findLastIndex((token) => Token.guards.op(token));
  const opener = before[cut];
  const args = before.slice(cut + 1).flatMap((token) => Token.match(token, { word: (t) => [t.text], op: () => [] }));
  const [head, ...rest] = args;

  if (head === undefined) {
    const piped = opener !== undefined && Token.guards.op(opener) && opener.op === "|";
    let source: Declaration | undefined;
    let output: string | null = null;

    if (piped) {
      let depth = 0;
      let start = 0;

      for (let i = cut - 1; i >= 0; i -= 1) {
        const token = before[i];

        if (token === undefined) {
          continue;
        }

        if (Token.guards.op(token)) {
          if (token.op === ")") {
            depth += 1;
          } else if (token.op === "$(" && depth > 0) {
            depth -= 1;
          } else if (depth === 0) {
            start = token.end;
            break;
          }
        }
      }

      const parsed = parse(line.slice(start, opener.start));

      if (!Schema.is(Refused)(parsed)) {
        const statement = parsed.statements.at(-1);

        if (statement !== undefined && Statement.guards.run(statement)) {
          const command = statement.pipeline.commands.at(-1);
          source = command === undefined ? undefined : programs.get(command.program.name);
          output = command?.out?.name ?? null;
        }
      }
    }

    const inPipe = piped || (opener !== undefined && Token.guards.op(opener) && opener.op === "$(");
    const names = [...programs.values()]
      .filter(
        (program) =>
          source === undefined ||
          [null, ...Object.keys(program.inputs)].some((input) =>
            Result.isSuccess(wire(source, program, output, input)),
          ),
      )
      .map((program) => program.name);
    return result([...names, ...(inPipe ? [] : BUILTINS)]);
  }

  if (head === "summon") {
    if (rest.length === 0) {
      return result(talk.harnesses);
    }

    if (rest.includes("as")) {
      return result([]);
    }

    return result(
      rest.length >= 3
        ? ["as"]
        : ["as", ...(talk.offers?.[String(rest.at(0))] ?? []).filter((name) => !rest.includes(name))],
    );
  }

  if (head === "dismiss") {
    return result(rest.length === 0 ? talk.names : []);
  }

  if (head === "help") {
    return result(rest.length === 0 ? programs.keys() : []);
  }

  if (["tell", "close", "stop", "attach"].includes(head)) {
    const [job, input] = rest;

    if (job === undefined) {
      return result(
        [...jobs].flatMap(([number, job]) => [
          `%${number}`,
          ...(job.processes ?? []).map((process) => process.process),
        ]),
      );
    }

    const numbered = /^%[0-9]+$/.test(job) ? jobs.get(Number(job.slice(1))) : undefined;
    const process = [...jobs.values()].flatMap((entry) => entry.processes ?? []).find((entry) => entry.process === job);
    const entry = process ?? numbered?.processes?.at(0) ?? numbered;

    if (entry === undefined || (head !== "tell" && head !== "close")) {
      return result([]);
    }

    return result(
      input === undefined ? Object.keys(entry.inputs) : head === "tell" ? choices(own(entry.inputs, input)) : [],
    );
  }

  const program = programs.get(head);

  if (program === undefined) {
    return result([]);
  }

  const prior = rest.at(-1);

  if (prior === "--help" || prior === "-h") {
    return result([
      ...Object.keys(program.flags).map((name) => `--${name}`),
      ...Object.keys(program.inputs),
      ...Object.keys(program.outputs).map((name) => `>${name}`),
    ]);
  }

  if (prior?.startsWith("--") && prior !== "--all" && !prior.includes("=")) {
    return result(choices(own(program.flags, prior.slice(2))?.schema));
  }

  if (word.includes("=")) {
    const eq = word.indexOf("=");
    const name = word.slice(0, eq);
    const schema = name.startsWith("--") ? own(program.flags, name.slice(2))?.schema : own(program.inputs, name);
    return result(choices(schema).map((value) => `${name}=${value}`));
  }

  if (word.startsWith(">") || word.startsWith("<")) {
    return result(
      Object.keys(word.startsWith(">") ? program.outputs : program.inputs).map((name) => word.charAt(0) + name),
    );
  }

  const given = new Set(rest.filter((part) => part.startsWith("--")).map((part) => part.slice(2).split("=")[0]));
  return result([
    ...Object.keys(program.flags)
      .filter((name) => !given.has(name))
      .map((name) => `--${name}`),
    ...(word.startsWith("-") ? [] : Object.keys(program.inputs).map((name) => `${name}=`)),
    ...(rest.length === 0 || word.startsWith("-") ? ["--help"] : []),
    ...(word.startsWith("-") && program.table === true && !given.has("all") ? ["--all"] : []),
  ]);
}
