// Ticket 1926: reading and writing a Markdown file's frontmatter against a Schema. Laws F1 to F13.
//
// Every property law takes one `run` (see Frontmatter.test-support.ts) and checks it once per group of input, so each group is reached in
// every run. A law keeps the group ids it checked and fails when `REQUIRED` is not all there.
import { expect, it, vi } from "@effect/vitest";
import { deepStrictEqual, strictEqual } from "@effect/vitest/utils";
import { Effect, Option, Predicate, Result, Schema, Tracer } from "effect";
import { isAlias, isCollection, isScalar, parseDocument, visit } from "yaml";
import * as Support from "./Frontmatter.test-support.ts";
import * as Frontmatter from "./Frontmatter.ts";

const runs = (count: number) => ({ arbitrary: { runs: count } });

const GROUPS = Support.REQUIRED;

type Failure = Frontmatter.NoFrontmatter | Frontmatter.BadFrontmatter;

// The error as a BadFrontmatter, or a failed law that names what it was.
const failed = (error: Failure, label: string): Frontmatter.BadFrontmatter =>
  Predicate.isTagged(error, "BadFrontmatter") ? error : expect.unreachable(`${label}: ${error._tag}`);

// The reason of a BadFrontmatter, or the tag of what else it was.
const tagOrReason = (error: Failure): string =>
  Predicate.isTagged(error, "BadFrontmatter") ? error.reason : error._tag;

const at = <A>(list: ReadonlyArray<A>, n: number): A => {
  const found = list[n % list.length];

  return found === undefined ? expect.unreachable("an empty list") : found;
};

const missing = (checked: ReadonlyArray<string>, wanted: ReadonlyArray<string>): ReadonlyArray<string> =>
  wanted.filter((id) => !checked.includes(id));

// A reading that failed names which file and shape it was, since a property run only reports the drawn input.
const labeled = <A, E extends { readonly message: string }, R>(label: string, effect: Effect.Effect<A, E, R>) =>
  Effect.mapError(effect, (error) => new Error(`${label}: ${error.message}`));

const writeOk = <S extends Schema.Codec<unknown, unknown>>(
  data: S["Type"],
  body: string,
  schema: S,
  label: string,
): string => {
  const written = Frontmatter.write({ data, body }, schema);

  if (Result.isFailure(written)) {
    return expect.unreachable(`${label}: write refused its own data: ${written.failure.message}`);
  }

  return written.success;
};

const roundTrip = Effect.fnUntraced(function* <S extends Schema.Codec<unknown, unknown>>(
  label: string,
  schema: S,
  data: S["Type"],
  body: string,
): Effect.fn.Return<void, Error> {
  const text = writeOk(data, body, schema, label);
  const file = yield* labeled(label, Frontmatter.read(text, schema));

  deepStrictEqual(file.data, data, `${label}: data`);
  strictEqual(file.body, body, `${label}: body`);
});

// ---------------------------------------------------------------------------------------------------------------------

// F1. Plants, each one wrong rule in Frontmatter.ts (run once, never kept):
//  read under yaml-1.1: `yes` reads back true, (h) red; write under failsafe: 87 comes back as text, S2 red;
//  rebuild the body from lines split on a lone \r too, (c) and (u) red; take the last fence, not the next, (t) red;
//  trim the body, (a) and (b) red; replace lone surrogates before writing, (f) red; key the map by key.toLowerCase(), (m) red.
it.effect.prop(
  "F1 write then read gives the same data and body, for every shape and every group of input",
  { run: Support.run },
  ({ run }) =>
    Effect.gen(function* () {
      const checked: Array<string> = [];

      for (const variant of Support.dataVariants(run.seeds)) {
        strictEqual(Support.reachedBy(variant), true, `group ${variant.group} is not in its pool`);

        const json = Support.jsonData(run.json, variant.pools);
        const label = (shape: string) => `${shape} ${variant.group}`;

        checked.push(variant.group, ...Support.jsonReached(json));

        yield* roundTrip(label("S1"), Support.S1, json, variant.body);
        yield* roundTrip(label("S2"), Support.S2, Support.s2Data(run, variant.pools), variant.body);
        yield* roundTrip(label("S3"), Support.S3, Support.s3Data(run, variant.pools), variant.body);
        yield* roundTrip(label("S3 date"), Support.S3Date, Support.s3DateData(run, variant.pools), variant.body);
        yield* roundTrip(label("S4"), Support.S4, Support.s4Data(run, variant.pools), variant.body);
        yield* roundTrip(label("S5"), Support.S5, Support.s5Data(run, variant.pools), variant.body);
      }

      for (const variant of Support.bodyVariants(run.seeds)) {
        checked.push(variant.group);

        yield* roundTrip(`body ${variant.group}`, Support.S1, Support.jsonData(run.json, variant.pools), variant.body);
      }

      deepStrictEqual(missing(checked, GROUPS), [], "groups never checked in this run");
    }),
  runs(300),
);

const FENCES = new Set(["---", "---\r", "..."]);

const anchored = (yaml: string): boolean => {
  let found = false;

  visit(parseDocument(yaml, { version: "1.2", schema: "core" }), {
    Node(_key, node) {
      if (isAlias(node) || ((isScalar(node) || isCollection(node)) && node.anchor !== undefined)) {
        found = true;
      }
    },
  });

  return found;
};

// F2. Plants: leave aliasDuplicateObjects at yaml's default, so (s) writes `&a1`, red; write `{}` for the empty map, red.
it.prop(
  "F2 the file's form: two fences, YAML with no fence line and no anchor, then the body byte for byte",
  { run: Support.run },
  ({ run }) => {
    const checked: Array<string> = [];

    for (const variant of [...Support.dataVariants(run.seeds), ...Support.bodyVariants(run.seeds)]) {
      const data = Support.jsonData(run.json, variant.pools);
      const text = writeOk(data, variant.body, Support.S1, variant.group);
      const tail = `---\n${variant.body}`;

      strictEqual(text.startsWith("---\n"), true, `${variant.group}: opens with a fence`);
      strictEqual(text.endsWith(tail), true, `${variant.group}: ends with a fence and the body`);

      const yaml = text.slice(4, text.length - tail.length);

      for (const line of yaml.split("\n")) {
        strictEqual(FENCES.has(line), false, `${variant.group}: a written line is ${JSON.stringify(line)}`);
      }

      strictEqual(anchored(yaml), false, `${variant.group}: an anchor or alias was written`);
      strictEqual(
        writeOk({}, variant.body, Support.S1, variant.group),
        `---\n---\n${variant.body}`,
        `${variant.group}: the empty map`,
      );
      checked.push(variant.group, ...Support.jsonReached(data));
    }

    deepStrictEqual(missing(checked, GROUPS), [], "groups never checked in this run");
  },
  runs(200),
);

// F3. Plants: compare `line.trim()` with `---`, so (w)'s `--- ` is a fence, red; take the last fence, not the next, (t) red.
it.prop(
  "F3 the one split: the next fence closes the frontmatter, with LF or CRLF fences; no first fence means none",
  { run: Support.run },
  ({ run }) => {
    const checked: Array<string> = [];

    for (const variant of [...Support.dataVariants(run.seeds), ...Support.bodyVariants(run.seeds)]) {
      const lines = Support.fenceFree(variant.pools.texts);

      for (const fence of ["---\n", "---\r\n"]) {
        const cut = Frontmatter.split(`${fence}${lines}${fence}${variant.body}`);

        deepStrictEqual(cut.frontmatter, Option.some(lines), `${variant.group}: frontmatter`);
        strictEqual(cut.body, variant.body, `${variant.group}: body`);
      }

      checked.push(variant.group);
    }

    for (const bare of Support.bareFiles(run.seeds)) {
      const cut = Frontmatter.split(bare.text);

      deepStrictEqual(cut.frontmatter, Option.none(), `${bare.group}: ${JSON.stringify(bare.text.slice(0, 40))}`);
      strictEqual(cut.body, bare.text, `${bare.group}: the whole file is the body`);
      checked.push(bare.group);
    }

    deepStrictEqual(
      missing(checked, [...Support.TEXT_REQUIRED, ...Support.BARE_REQUIRED]),
      [],
      "groups never checked in this run",
    );
  },
  runs(300),
);

// F4. Plant: read an unclosed `---` as an empty frontmatter, (x) red.
it.effect.prop(
  "F4 no frontmatter: a file with no opening fence, or no closing one, fails with NoFrontmatter",
  { run: Support.run },
  ({ run }) =>
    Effect.gen(function* () {
      const checked: Array<string> = [];

      for (const bare of Support.bareFiles(run.seeds)) {
        for (const [name, schema] of [
          ["S1", Support.S1],
          ["S2", Support.S2],
        ] as const) {
          const error = yield* Effect.flip(Frontmatter.read(bare.text, schema));

          strictEqual(error._tag, "NoFrontmatter", `${name} ${bare.group}: ${JSON.stringify(bare.text.slice(0, 40))}`);
        }

        checked.push(bare.group);
      }

      deepStrictEqual(missing(checked, Support.BARE_REQUIRED), [], "groups never checked in this run");
    }),
  runs(200),
);

// F5. Plants: parse with logLevel "silent", so the second-document cases succeed, red; report the block's own line, not the file's, red.
it.effect.prop(
  "F5 not YAML: BadFrontmatter syntax, with the file's line, after any number of good lines",
  { run: Support.run },
  ({ run }) =>
    Effect.gen(function* () {
      const body = Support.dataVariants(run.seeds)
        .map((variant) => variant.body)
        .join("");

      const counts = [(run.picks[0] ?? 0) % 6, 0, 5];

      for (const count of counts) {
        for (const broken of Support.BROKEN) {
          const good = Math.max(count, broken.minGood);
          const lines = [...Support.goodLines(good), ...broken.lines];
          const label = `${broken.name} after ${good} good lines`;
          const error = yield* Effect.flip(Frontmatter.read(`---\n${lines.join("\n")}\n---\n${body}`, Support.S1));

          strictEqual(tagOrReason(error), "syntax", label);

          const line = failed(error, label).line;

          if (line === undefined) {
            return expect.unreachable(`${label}: no line`);
          }

          strictEqual(line >= 2 && line <= lines.length + 2, true, `${label}: line ${line} is outside the block`);

          if (broken.at !== undefined) {
            strictEqual(line, good + 2 + broken.at, label);
          }
        }
      }
    }),
  runs(200),
);

// F6. Plants: drop the Schema.JsonObject step, so `!!set` passes Schema.Unknown, red; drop the key walk, so `1` and `"1"` merge, red;
// call toJS unwrapped, so the alias bomb is a defect, red.
it.effect.prop(
  "F6 YAML that is not data here: BadFrontmatter value, at any depth, even for a Schema that takes any value",
  { run: Support.run },
  ({ run }) =>
    Effect.gen(function* () {
      const body = at(Support.dataVariants(run.seeds), run.picks[0] ?? 0).body;
      const depths = [0, (run.picks[1] ?? 0) % 4, (run.picks[2] ?? 0) % 4];

      for (const unread of Support.UNREAD) {
        for (const depth of unread.top ? [0] : depths) {
          const label = `${unread.name} at depth ${depth}`;
          const text = `---\n${Support.nested(depth, unread.lines).join("\n")}\n---\n${body}`;

          for (const schema of [Support.S1, Schema.Unknown]) {
            const error = yield* Effect.flip(Frontmatter.read(text, schema));

            strictEqual(tagOrReason(error), "value", label);
          }
        }
      }
    }),
  runs(200),
);

// F7. Plants: map every decode failure to `syntax`, red; drop the cause, red.
it.effect.prop(
  "F7 the Schema refuses: BadFrontmatter schema, whose cause is a SchemaError naming the broken field",
  { run: Support.run },
  ({ run }) =>
    Effect.gen(function* () {
      const number = Math.max(2, run.decision.number);

      const word =
        Support.dataVariants(run.seeds)
          .at(0)
          ?.pools.texts.at(0)
          ?.replaceAll(/[^a-z]/gu, "") ?? "w";

      const files = Support.refusedFiles(number, word.length === 0 ? "w" : word);
      const body = "# Body\n";
      const valid = yield* Frontmatter.read(`---\n${files.valid.join("\n")}\n---\n${body}`, Support.S2);

      strictEqual(valid.data.number, number, "the file with no break reads");

      for (const refused of files.broken) {
        const error = yield* Effect.flip(
          Frontmatter.read(`---\n${refused.lines.join("\n")}\n---\n${body}`, Support.S2),
        );

        const bad = failed(error, refused.name);

        strictEqual(bad.reason, "schema", refused.name);
        strictEqual(Schema.isSchemaError(bad.cause), true, `${refused.name}: the cause is a SchemaError`);
        strictEqual(
          String(bad.cause).includes(JSON.stringify(refused.field)),
          true,
          `${refused.name}: names ${refused.field}`,
        );
      }
    }),
  runs(200),
);

// F8. Plant: drop the Schema.JsonObject step on write, so a Date is written as its ISO text, red.
it.prop(
  "F8 write refuses and gives no text: a value the Schema's checks refuse, or that JSON has no word for",
  { run: Support.run },
  ({ run }) => {
    const pools = at(Support.dataVariants(run.seeds), run.picks[0] ?? 0).pools;

    const refusals: ReadonlyArray<readonly [string, string, Result.Result<string, Frontmatter.BadFrontmatter>]> = [
      [
        "an integer field at a fraction",
        "schema",
        Frontmatter.write(
          { data: { ...Support.s2Data(run, pools), number: (run.picks[1] ?? 0) + 0.5 }, body: "" },
          Support.S2,
        ),
      ],
      [
        "a plain Date",
        "value",
        Frontmatter.write({ data: { when: new Date(run.count.when) }, body: "" }, Schema.Struct({ when: Schema.Date })),
      ],
      ...[Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].map(
        (n): readonly [string, string, Result.Result<string, Frontmatter.BadFrontmatter>] => [
          `a number at ${n}`,
          "value",
          // Schema.Unknown holds NaN as Schema.Number would; the editor's diagnostic for Schema.Number is for finite domains.
          Frontmatter.write({ data: { n }, body: "" }, Schema.Struct({ n: Schema.Unknown })),
        ],
      ),
      [
        "an optional field holding undefined",
        "value",
        Frontmatter.write(
          { data: { maybe: undefined }, body: "" },
          Schema.Struct({ maybe: Schema.optional(Schema.String) }),
        ),
      ],
      [
        "a BigInt",
        "value",
        Frontmatter.write(
          { data: { big: BigInt(run.picks[2] ?? 0) }, body: "" },
          Schema.Struct({ big: Schema.BigInt }),
        ),
      ],
    ];

    for (const [name, reason, answer] of refusals) {
      if (Result.isSuccess(answer)) {
        return expect.unreachable(`${name}: wrote ${JSON.stringify(answer.success)}`);
      }

      strictEqual(answer.failure._tag, "BadFrontmatter", name);
      strictEqual(answer.failure.reason, reason, name);
    }
  },
  runs(100),
);

// F9. Plant: read under failsafe, so `0146` reads as text and the first line passes, red.
it.effect("pinned: F9 the readings this change states, YAML 1.2's core schema in the installed yaml 2.9.1", () =>
  Effect.gen(function* () {
    const file = (...lines: ReadonlyArray<string>) => `---\n${lines.join("\n")}\n---\n`;
    const asText = yield* Effect.flip(Frontmatter.read(file("id: 0146"), Schema.Struct({ id: Schema.String })));

    strictEqual(tagOrReason(asText), "schema", "id: 0146 is not text");

    const asNumber = yield* Frontmatter.read(file("id: 0146"), Schema.Struct({ id: Schema.Finite }));

    deepStrictEqual(asNumber.data, { id: 146 });

    const words = yield* Frontmatter.read(file("a: yes", "b: on", "c: 2026-11-22", "d: ~"), Support.S1);

    deepStrictEqual(words.data, { a: "yes", b: "on", c: "2026-11-22", d: null });

    const nan = yield* Effect.flip(Frontmatter.read(file("a: .nan"), Support.S1));

    strictEqual(tagOrReason(nan), "value", ".nan is not data");

    strictEqual(
      Result.getOrThrow(Frontmatter.write({ data: { id: "0146" }, body: "" }, Schema.Struct({ id: Schema.String }))),
      file('id: "0146"'),
      "the text 0146 is written quoted",
    );
  }),
);

// F10. Plant: read under failsafe, so `number: 87` is text and the good file fails, red.
it.effect("scenario: F10 a decision-shaped file against a Schema made from a JSON Schema file", () =>
  Effect.gen(function* () {
    const body = "# A title\n\nText.\n";
    const good = `---\nnumber: 87\nstatus: accepted\ndecided: 2026-11-22\nsupersedes: [12, 40]\ndraft: false\nnote: ~\n---\n${body}`;
    const file = yield* Frontmatter.read(good, Support.S5);

    deepStrictEqual(file.data, {
      number: 87,
      status: "accepted",
      decided: "2026-11-22",
      supersedes: [12, 40],
      draft: false,
      note: null,
    });
    strictEqual(file.body, body);

    const again = yield* Frontmatter.read(Result.getOrThrow(Frontmatter.write(file, Support.S5)), Support.S5);

    deepStrictEqual(again, file, "writing what was read and reading it again gives it back");

    for (const [name, bad] of [
      ["number as text", good.replace("number: 87", "number: '87'")],
      ["draft: yes", good.replace("draft: false", "draft: yes")],
    ] as const) {
      const error = yield* Effect.flip(Frontmatter.read(bad, Support.S5));

      strictEqual(tagOrReason(error), "schema", name);
    }
  }),
);

// F11. Plant: take a fence only when the line is exactly `---`, red.
it.effect.prop(
  "F11 line ends do not change data: the same file with CRLF through the closing fence reads the same",
  { run: Support.run },
  ({ run }) =>
    Effect.gen(function* () {
      const checked: Array<string> = [];

      for (const variant of [...Support.dataVariants(run.seeds), ...Support.bodyVariants(run.seeds)]) {
        const data = Support.jsonData(run.json, variant.pools);
        const text = writeOk(data, variant.body, Support.S1, variant.group);
        const head = text.slice(0, text.length - variant.body.length).replaceAll("\n", "\r\n");
        const file = yield* labeled(variant.group, Frontmatter.read(`${head}${variant.body}`, Support.S1));

        deepStrictEqual(file.data, data, `${variant.group}: data`);
        strictEqual(file.body, variant.body, `${variant.group}: body`);
        checked.push(variant.group);
      }

      deepStrictEqual(missing(checked, Support.TEXT_REQUIRED), [], "groups never checked in this run");
    }),
  runs(100),
);

// F12. Plants: name the span `Frontmatter.read`, red; annotate the body on it, red. `split` and `write` are plain calls, so a span
// of theirs could only come from a call made inside `read`: none is seen here, and none can be planted without changing their types.
it.effect.prop(
  "F12 the span: read ends one span named markdown.frontmatter.read, on success and on each failure, with no file text in it",
  { run: Support.run },
  ({ run }) =>
    Effect.gen(function* () {
      const marker = `zq${run.picks[0] ?? 0}x${run.picks[1] ?? 0}q`;
      const body = `# ${marker}\n`;
      const Note = Schema.Struct({ note: Schema.String });

      const files: ReadonlyArray<readonly [string, string, Schema.Codec<unknown, unknown>]> = [
        ["success", Result.getOrThrow(Frontmatter.write({ data: { note: marker }, body }, Note)), Note],
        ["no frontmatter", `${marker}\n`, Note],
        ["syntax", `---\n\t${marker}: 1\n---\n${body}`, Note],
        ["value", `---\n- ${marker}\n---\n${body}`, Note],
        ["schema", `---\nnote: 5\nother: ${marker}\n---\n${body}`, Note],
      ];

      for (const [name, text, schema] of files) {
        const spans: Array<Tracer.NativeSpan> = [];

        const tracer = Tracer.make({
          span(options) {
            const span = new Tracer.NativeSpan(options);

            spans.push(span);

            return span;
          },
        });

        yield* Effect.exit(Frontmatter.read(text, schema)).pipe(Effect.withTracer(tracer));

        // Calls that are not an Effect make no span, whatever the text.
        yield* Effect.sync(() => {
          Frontmatter.split(text);
          Frontmatter.write({ data: { note: marker }, body }, Note);
        }).pipe(Effect.withTracer(tracer));

        strictEqual(spans.length, 1, `${name}: spans made`);

        const span = at(spans, 0);

        strictEqual(span.name, "markdown.frontmatter.read", name);
        strictEqual(span.status._tag, "Ended", `${name}: ended`);

        for (const [attribute, value] of span.attributes) {
          strictEqual(
            `${attribute}=${String(value)}`.includes(marker),
            false,
            `${name}: attribute ${attribute} holds file text`,
          );
        }

        for (const [event, , attributes] of span.events) {
          strictEqual(
            `${event} ${JSON.stringify(attributes)}`.includes(marker),
            false,
            `${name}: an event holds file text`,
          );
        }
      }
    }),
  runs(100),
);

// F13. Plant: parse with yaml's default log level and call toJS before the key walk, so the warning fires, red.
it.effect(
  "scenario: F13 reading prints nothing: a list as a key and an unknown tag fail by value and warn nowhere",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() => ({
        warning: vi.spyOn(process, "emitWarning").mockImplementation(() => undefined),
        printers: (["log", "info", "warn", "error", "debug", "trace"] as const).map((name) =>
          vi.spyOn(console, name).mockImplementation(() => undefined),
        ),
      })),
      ({ warning, printers }) =>
        Effect.gen(function* () {
          for (const lines of [["? [a]", ": 1"], ["x: !x 1"]]) {
            const error = yield* Effect.flip(Frontmatter.read(`---\n${lines.join("\n")}\n---\n`, Support.S1));

            strictEqual(tagOrReason(error), "value", lines.join(" "));
          }

          strictEqual(warning.mock.calls.length, 0, "process.emitWarning was called");

          for (const printer of printers) {
            strictEqual(printer.mock.calls.length, 0, "a console method was called");
          }
        }),
      ({ warning, printers }) =>
        Effect.sync(() => {
          warning.mockRestore();

          for (const printer of printers) {
            printer.mockRestore();
          }
        }),
    ),
);
