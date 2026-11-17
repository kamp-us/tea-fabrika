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
    },
    options(300),
  );

  // L4 plant: require exact record equality instead of the reader's needed fields.
  it.prop(
    "L4 pipe roles and check use needed fields and accept extra writer fields",
    {
      fields: Schema.Struct({ needed: Name, extra: Name, absent: Name }),
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
    },
    options(300),
  );
});
