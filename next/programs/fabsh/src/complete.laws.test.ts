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
    const programs: Map<string, NonNullable<ReturnType<ProgramList["get"]>>> = new Map(
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
    const piped = complete("source | ", programs, jobs, talk).candidates;
    expect(piped).toEqual(expect.arrayContaining(names));
    expect(piped).not.toContain("wrong");
    expect(piped).not.toContain("source");

    const typed = `only${input.word.slice(0, Math.abs(input.cut) % (input.word.length + 1))}`;
    const one = complete(typed, programs, jobs, talk);
    expect(one.candidates).toEqual([head]);
    const source = typed.slice(0, typed.length - one.word.length) + one.candidates[0] + " ";
    expect(
      Match.value(roles(source, programs)[0]!.role).pipe(
        Match.tag("error", () => false),
        Match.orElse(() => true),
      ),
    ).toBe(true);
  },
  { arbitrary: { runs: runsFor({ fast: 300, full: 300 }) } },
);
