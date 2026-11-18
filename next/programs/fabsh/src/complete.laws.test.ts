// next/, S1. L7 fault: offer every program after a pipe, including incompatible readers.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Match, Schema } from "effect";
import type { ProgramList } from "./check.ts";
import { complete } from "./complete.ts";
import { roles } from "./roles.ts";

const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{0,11}$/));

it.prop(
  "L7 completion filters by prefix, context and pipe fit and completes one valid word",
  {
    input: Schema.Struct({ names: Schema.Array(Name), word: Name, cut: Schema.Int, job: Schema.Int }),
  },
  ({ input }) => {
    const names = [...new Set([`only${input.word}`, ...input.names.map((name) => `p${name}`)])];
    const programs = new Map<string, NonNullable<ReturnType<ProgramList["get"]>>>(
      names.map((name) => [
        name,
        {
          name,
          flags: { mode: { schema: Schema.Literals(["read", "write"]), required: false } },
          inputs: { value: Schema.Struct({ n: Schema.Int }) },
          outputs: {},
        },
      ]),
    );
    programs.set("source", {
      name: "source",
      flags: {},
      inputs: {},
      outputs: {
        out: Schema.Struct({ n: Schema.Int, extra: Schema.String }),
      },
    });
    programs.set("wrong", {
      name: "wrong",
      flags: {},
      inputs: { value: Schema.Struct({ text: Schema.String }) },
      outputs: {},
    });
    const n = Math.abs(input.job % 1000) + 1;
    const jobs = new Map([[n, { program: names[0]!, inputs: programs.get(names[0]!)!.inputs }]]);
    const talk = { names: [`agent${input.word}`], harnesses: [] };
    const head = names[0]!;
    const prefix = head.slice(0, (Math.abs(input.cut) % head.length) + 1);
    const cases = [
      prefix,
      `${head} --m`,
      `${head} --mode r`,
      `${head} v`,
      `${head} --h`,
      `${head} --help --m`,
      "source | ",
      `source | ${prefix}`,
      "tell %",
      `tell %${n} v`,
      "@agent",
    ];

    for (const line of cases) {
      const result = complete(line, programs, jobs, talk);
      expect(new Set(result.candidates).size).toBe(result.candidates.length);

      for (const candidate of result.candidates) {
        expect(candidate.startsWith(result.word)).toBe(true);
      }
    }

    expect(complete(`${head} --m`, programs, jobs, talk).candidates).toContain("--mode");
    expect(complete(`${head} --mode r`, programs, jobs, talk).candidates).toEqual(["read"]);
    expect(complete(`${head} v`, programs, jobs, talk).candidates).toContain("value=");
    expect(complete("tell %", programs, jobs, talk).candidates).toContain(`%${n}`);
    expect(complete("@agent", programs, jobs, talk).candidates).toEqual(talk.names.map((name) => `@${name}`));
    expect(complete(`${head} `, programs, jobs, talk).candidates).toContain("--help");

    for (const table of [false, true]) {
      const catalog = new Map(programs);
      catalog.set(head, { ...programs.get(head)!, table });
      expect(complete(`${head} --a`, catalog, jobs, talk).candidates.includes("--all")).toBe(table);
      expect(complete(`${head} --all --a`, catalog, jobs, talk).candidates).not.toContain("--all");
    }

    const harness = `harness${input.word}`;
    const model = `model${input.word}`;
    const effort = `effort${input.word}`;
    const spare = `spare${input.word}`;
    const offered = { names: talk.names, harnesses: [harness], offers: { [harness]: [model, effort, spare] } };
    expect(complete(`summon ${harness} `, programs, jobs, offered).candidates).toEqual(["as", model, effort, spare]);
    expect(complete(`summon ${harness} ${model} `, programs, jobs, offered).candidates).toEqual(["as", effort, spare]);
    expect(complete(`summon ${harness} ${model} ${effort} `, programs, jobs, offered).candidates).toEqual(["as"]);
    expect(complete(`summon ${harness} as `, programs, jobs, offered).candidates).toEqual([]);
    const first = `process${input.word}a`;
    const second = `process${input.word}b`;
    const withProcesses = new Map([
      [
        n,
        {
          ...jobs.get(n)!,
          processes: [
            { process: first, program: head, inputs: programs.get(head)!.inputs },
            { process: second, program: "second", inputs: { other: Schema.Literals(["yes", "no"]) } },
          ],
        },
      ],
    ]);

    for (const name of ["tell", "close", "stop", "attach"]) {
      expect(complete(`${name} `, programs, withProcesses, talk).candidates).toEqual(
        expect.arrayContaining([`%${n}`, first, second]),
      );
    }

    expect(complete(`tell ${first} `, programs, withProcesses, talk).candidates).toContain("value");
    expect(complete(`tell ${second} `, programs, withProcesses, talk).candidates).toEqual(["other"]);
    expect(complete(`close ${second} `, programs, withProcesses, talk).candidates).toEqual(["other"]);
    expect(complete(`tell ${second} other y`, programs, withProcesses, talk).candidates).toEqual(["yes"]);

    const piped = complete("source | ", programs, jobs, talk).candidates;
    expect(piped).toEqual(expect.arrayContaining(names));
    expect(piped).not.toContain("wrong");
    expect(piped).not.toContain("source");

    const typed = `only${input.word.slice(0, Math.abs(input.cut) % (input.word.length + 1))}`;
    const one = complete(typed, programs, jobs, talk);
    expect(one.candidates).toEqual([head]);
    const source = `${typed.slice(0, typed.length - one.word.length)}${one.candidates[0]} `;
    expect(
      Match.value(roles(source, programs)[0]!.role).pipe(
        Match.tag("error", () => false),
        Match.orElse(() => true),
      ),
    ).toBe(true);
  },
  { arbitrary: { runs: runsFor({ fast: 300, full: 300 }) } },
);
