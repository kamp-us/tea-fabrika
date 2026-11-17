// next/, S1. Fault descriptions are for one CI run after build, then restoration.
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Arbitrary, Match, Schema } from "effect";
import { check, type ProgramList } from "./check.ts";
import { parse } from "./grammar.ts";
import { roles } from "./roles.ts";
import { words } from "./words.ts";

const options = (runs: number) => ({ arbitrary: { runs: runsFor({ fast: runs, full: runs }) } });

const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{0,11}$/));

const catalog = (names: ReadonlyArray<string>): ProgramList =>
  new Map(
    names.map((name) => [
      name,
      {
        name,
        flags: {},
        inputs: {},
        outputs: {},
      },
    ]),
  );

const alphabet = [..."ab09 -_=><@#|&;$()'\"\\\t\n", "漢", "é", "😀"];

const Lines = Arbitrary.schema(Schema.String).pipe(
  Arbitrary.map((text) =>
    Array.from(text, (char) => alphabet[(char.codePointAt(0) ?? 0) % alphabet.length] ?? "a").join(""),
  ),
);

const tag = (role: ReturnType<typeof roles>[number]["role"]) =>
  Match.value(role).pipe(
    Match.tag("error", () => "error"),
    Match.orElse((value) => value._tag),
  );

describe("fabsh S1 reader", () => {
  // L1 plant: omit the closing quote from its span.
  it.prop(
    "L1 spans cover every non-space character exactly once in source order",
    { line: Lines },
    ({ line }) => {
      for (const source of [line, `known '${line.replaceAll("'", "")}' `, `#room ${line}`, `known # ${line}`]) {
        const spans = roles(source, catalog(["known"]));
        let end = 0;
        const covered = new Uint8Array(source.length);

        for (const span of spans) {
          expect(span.start).toBeGreaterThanOrEqual(end);
          expect(span.end).toBeGreaterThan(span.start);
          expect(span.end).toBeLessThanOrEqual(source.length);

          for (let at = span.start; at < span.end; at += 1) {
            covered[at] = (covered[at] ?? 0) + 1;
          }

          end = span.end;
        }

        for (let at = 0; at < source.length; at += 1) {
          if (!/\s/.test(source.charAt(at))) {
            expect(covered[at], `${source} at ${at}`).toBe(1);
          }
        }
      }
    },
    options(500),
  );

  // L2 plant: classify a finished missing program as program.
  it.prop(
    "L2 only a finished unknown first word is an error",
    {
      sample: Schema.Struct({ names: Schema.Array(Name), missing: Name }),
    },
    ({ sample }) => {
      const known = [...new Set(["known", ...sample.names])];
      const missing = `absent${sample.missing}`;
      const programs = catalog(known.filter((name) => name !== missing));

      for (const name of known.filter((name) => name !== missing)) {
        expect(tag(roles(`${name} `, programs)[0]!.role)).not.toBe("error");
      }

      expect(tag(roles(`${missing} `, programs)[0]!.role)).toBe("error");
      expect(tag(roles("help ", programs)[0]!.role)).toBe("builtin");
      expect(check(parse(`${missing} `), programs)).toMatchObject({ _tag: "refused", status: 127 });

      for (const name of known.filter((candidate) => candidate !== missing)) {
        const required: ProgramList = new Map([
          [
            name,
            {
              name,
              flags: { n: { schema: Schema.Int, required: true } },
              inputs: {},
              outputs: {},
            },
          ],
        ]);
        expect(tag(roles(`${name} `, required)[0]!.role)).not.toBe("error");
        expect(check(parse(`${name} `), required)).toMatchObject({ _tag: "refused", status: 2 });
      }
    },
    options(300),
  );

  // L4 plant: require exact record equality instead of the reader's needed fields.
  it.prop(
    "L4 pipe roles and check use needed fields and accept extra writer fields",
    {
      fields: Schema.Struct({
        needed: Name,
        extra: Name,
        absent: Name,
        length: Schema.Int.check(Schema.isBetween({ minimum: 3, maximum: 8 })),
      }),
    },
    ({ fields }) => {
      const needed = `n${fields.needed}`;
      const extra = `e${fields.extra}`;
      const absent = `a${fields.absent}`;
      const source = {
        name: "source",
        flags: {},
        inputs: {},
        outputs: {
          out: Schema.Struct({ [needed]: Schema.Int, [extra]: Schema.String }),
        },
      };

      for (const [fits, shape] of [
        [true, Schema.Struct({ [needed]: Schema.Int })],
        [true, Schema.Struct({ [needed]: Schema.Int, [extra]: Schema.String })],
        [false, Schema.Struct({ [needed]: Schema.Int, [absent]: Schema.String })],
        [false, Schema.Struct({ [needed]: Schema.String })],
      ] as const) {
        const programs: ProgramList = new Map([
          ["source", source],
          ["sink", { name: "sink", flags: {}, inputs: { take: shape }, outputs: {} }],
        ]);
        const line = "source | sink ";
        const pipe = roles(line, programs).find((span) => line.slice(span.start, span.end) === "|");
        expect(pipe).toBeDefined();
        expect(tag(pipe!.role)).toBe(fits ? "pipe" : "error");
        expect(
          Match.value(check(parse(line), programs)).pipe(
            Match.tag("refused", () => false),
            Match.orElse(() => true),
          ),
        ).toBe(fits);
      }

      const stages = Array.from({ length: fields.length }, (_, n) => `stage${n}`);
      const chain: ProgramList = new Map(
        stages.map((name) => [
          name,
          {
            name,
            flags: {},
            inputs: { take: Schema.Struct({ [needed]: Schema.String }) },
            outputs: { out: Schema.Struct({ [needed]: Schema.Int }) },
          },
        ]),
      );
      const piped = stages.join(" | ");

      for (const line of [piped + " ", `unknown ; ${piped} `, `wrapper value=$(${piped}) `, `${piped} ; ${piped} `]) {
        const bars = roles(line, chain).filter((span) => line.slice(span.start, span.end) === "|");
        expect(bars).toHaveLength((line.match(/\|/g) ?? []).length);
        expect(bars.every((span) => tag(span.role) === "error")).toBe(true);
      }
    },
    options(300),
  );

  // L6 plants: shift token start by one; judge the unfinished cursor word.
  it.prop(
    "L6 tokens keep their source and the word at the cursor stays unfinished",
    {
      text: Lines,
      cut: Schema.Int,
    },
    ({ text, cut }) => {
      const source = text.slice(0, Math.abs(cut) % (text.length + 1));
      const programs = catalog(["known"]);
      let end = 0;

      for (const token of words(source).tokens) {
        expect(token.start).toBeGreaterThanOrEqual(end);
        expect(token.end).toBeGreaterThan(token.start);
        expect(token.end).toBeLessThanOrEqual(source.length);
        const raw = source.slice(token.start, token.end);
        const local = words(raw).tokens;
        expect(local).toHaveLength(1);
        expect(
          Match.value(token).pipe(
            Match.tag("word", (word) => word.text),
            Match.tag("op", (op) => op.op),
            Match.exhaustive,
          ),
        ).toEqual(
          Match.value(local[0]!).pipe(
            Match.tag("word", (word) => word.text),
            Match.tag("op", (op) => op.op),
            Match.exhaustive,
          ),
        );
        end = token.end;
      }

      const unfinished = `missing${Math.abs(cut)}${source.replaceAll(/[^a-z0-9]/g, "")}`;
      expect(tag(roles(unfinished, programs).at(-1)!.role)).not.toBe("error");
      expect(tag(roles(`${unfinished} `, programs)[0]!.role)).toBe("error");

      // The source text is an independent oracle for decoding quotes and escapes.
      const literal = text.replaceAll(/[\r\n']/g, "");
      const quoted = words(`'${literal}' `).tokens[0]!;
      expect(quoted).toMatchObject({ _tag: "word", start: 0, end: literal.length + 2, text: literal });
      const escaped = words(`"${literal.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}" `).tokens[0]!;
      expect(escaped).toMatchObject({ _tag: "word", text: literal });

      const tail = `absent${Math.abs(cut)} --bad value `;
      const position = Math.abs(cut) % (tail.indexOf(" ") + 1);
      expect(tag(roles(tail, programs, position)[0]!.role)).not.toBe("error");
      expect(tag(roles(tail, programs, tail.length)[0]!.role)).toBe("error");
      const flagLine = "known --bad value ";
      const flag = roles(flagLine, programs, flagLine.indexOf("bad") + 1).find(
        (span) => flagLine.slice(span.start, span.end) === "--bad",
      );
      expect(tag(flag!.role)).not.toBe("error");

      // Faults: reject repeated inputs; accept --all without a table; erase help namespaces.
      const field = `v${Math.abs(cut)}`;
      const n = Math.abs(cut % 100000);

      for (const table of [false, true]) {
        const declaration = { name: "known", flags: {}, inputs: { n: Schema.Int }, outputs: {}, table };
        const list: ProgramList = new Map([["known", declaration]]);
        expect(check(parse(`known n=${n} n=${n + 1}`), list)).not.toMatchObject({ _tag: "refused" });
        const all = check(parse("known --all"), list);
        expect(
          Match.value(all).pipe(
            Match.tag("refused", () => false),
            Match.orElse(() => true),
          ),
        ).toBe(table);
      }

      for (const namespace of ["flag", "input", "output"]) {
        const declaration = {
          name: "known",
          flags: namespace === "flag" ? { [field]: { schema: Schema.String, required: false } } : {},
          inputs: namespace === "input" ? { [field]: Schema.String } : {},
          outputs: namespace === "output" ? { [field]: Schema.String } : {},
        };
        const list: ProgramList = new Map([["known", declaration]]);

        for (const [part, accepts] of [
          [`--${field}`, namespace === "flag"],
          [`<${field}`, namespace === "input"],
          [`${field}=`, namespace === "input"],
          [`>${field}`, namespace === "output"],
          [field, true],
        ] as const) {
          const source = `known --help ${part}`;
          const checked = check(parse(source), list);
          expect(
            Match.value(checked).pipe(
              Match.tag("refused", () => false),
              Match.orElse(() => true),
            ),
          ).toBe(accepts);

          if (!accepts) {
            expect(checked).toMatchObject({ _tag: "refused", at: source.indexOf(part, "known --help ".length) });
          }
        }

        for (const help of ["--help", "-h"]) {
          expect(check(parse(`known --help ${help}`), list)).not.toMatchObject({ _tag: "refused" });
        }
      }
    },
    options(300),
  );
});
