// Ticket 1846, kalfa/config (new work), slice 1: W1, X1, X2, X3 and X1b of the approved plan
// (.kalfa/quests/kalfa-config-command-PLAN.md), for `SettingGroup.jsonSchema`, `SettingGroup.reference` and the quiet
// window's pattern. Written before the code.
//
// What the code does, as these laws hold it to (the plan's "The shape"):
// - The quiet window's text check is one pattern, so `jsonSchema` never throws for a group with a live setting, and the
//   pattern reads exactly what `Schema.DurationFromString` reads (W1).
// - `jsonSchema(group, file)` is the editor's JSON Schema of one file as committed text, built from the one tree the
//   start's whole-file check reads: each leaf holds its description and, when it has one, its encoded default. The repo
//   file also holds `<app>-version` as a version pattern. Read back by Effect's own JSON Schema reader it accepts a
//   document exactly when a start of the group accepts that file (X1, X2).
// - `reference(group)` is Markdown, one section per setting by name, the window included, one final `\n` (X3).
// The version pattern cannot say Effect's last rule, a number no larger than the largest safe integer: X1b pins that
// one gap.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { ConfigProvider, Effect, Layer, Match, Option, Schema } from "effect";
import { Setting, SettingGroup } from "./index.ts";
import { debounce } from "./internal/window.ts";
import * as JsonSchema from "./JsonSchema.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";
import { refusal } from "./SettingGroup.snapshot.test-support.ts";
import {
  BREAKS,
  describe,
  LOOSE,
  looseSetting,
  lone,
  committed,
  DOC_CLASSES,
  type DocClass,
  documents,
  DURATION_CLASSES,
  type DurationClass,
  durations,
  editorAccepts,
  editorFor,
  leafAt,
  makeGroup,
  namesFor,
  number,
  pick,
  Reach,
  readJson,
  reads,
  sectionsFor,
  type Spec,
  specsA,
  specsB,
  specsC,
  specsD,
  startAccepts,
  TEXTS,
  TextDraw,
  topAt,
  variable,
  word,
  WINDOWS_REFUSED,
} from "./SettingGroup.text.test-support.ts";

const check = { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } };

const FILES = ["repo", "user"] as const;

const WINDOW = "config.watch.debounce";

// ---------------------------------------------------------------------------------------------
// W1, the window's pattern reads what Effect reads
// ---------------------------------------------------------------------------------------------

// Plants: (j) leave the check a bare `Schema.makeFilter`, as today: it has no JSON Schema form, red; (j) drop `weeks?` from the pattern: `2 weeks` is refused, red; (j) drop the `^` anchor: `x1 millis` passes, red.
it.effect.prop(
  "W1 the window's pattern reads what Effect reads: for a generated text, the window's check holds exactly when `Schema.DurationFromString` decodes it",
  { draw: TextDraw },
  ({ draw }) =>
    Effect.sync(() => {
      const reach = new Reach<DurationClass>(DURATION_CLASSES);
      const holds = Schema.is(debounce.schema);

      // The check has a JSON Schema form, so `jsonSchema` never throws for a group with a live setting.
      expect(() => JsonSchema.make(Schema.toCodecJson(debounce.schema))).not.toThrow();

      for (const one of durations(draw)) {
        expect(holds(one.text), `${one.id}: ${JSON.stringify(one.text)}`).toBe(reads(one.text));
        reach.mark(one.id);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// X1, the editor schema agrees with the start
// ---------------------------------------------------------------------------------------------

type Reached = DocClass | "none-scope";

// Plants: (a) write each leaf as `Schema.Unknown`: a refused value passes the schema, red; (b) drop `onExcessProperty:
// "error"` from `JsonSchema.make`: an unknown key passes, red; (h) leave `<app>-version` out of the repo schema: a valid
// version is refused, red; (d) build the schema from `group.settings`, not `watched`: the window's key is refused, red;
// (e) take every setting whatever its scope: a key outside its scope passes, red.
it.effect.prop(
  "X1 the editor schema agrees with the start: for a generated group, file and document, the document read back from `jsonSchema(group, file)` by Effect's JSON Schema reader is accepted exactly when the start's whole-file check of that file accepts it",
  { draw: TextDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Reached>([...DOC_CLASSES, "none-scope"]);

      for (const specs of [specsA(draw), specsB(draw), specsC(draw), specsD(draw)]) {
        const group = makeGroup(draw.app, specs);

        for (const file of FILES) {
          const editor = editorFor(SettingGroup.jsonSchema(group, file));

          for (const doc of documents(draw, draw.app, specs, file)) {
            const label = `${doc.id} in the ${file} file of ${specs[0]?.kind}`;
            const start = yield* startAccepts(group, file, doc.value);

            // The start is the oracle, and it says what the class says: a law that always agreed on "refused" would hold nothing.
            expect(start, `${label}: the start`).toBe(doc.accepted);
            expect(editorAccepts(editor, doc.value), `${label}: the editor`).toBe(start);
            reach.mark(doc.id);
          }
        }
      }

      // A file no setting may be set in refuses every key, the repo's `<app>-version` aside.
      const only = makeGroup(draw.app, [lone(draw)]);
      const none = editorFor(SettingGroup.jsonSchema(only, "user"));
      const key = `${draw.app}-version`;

      for (const [value, accepted] of [
        [{}, true],
        [{ [word(draw, 0)]: 1 }, false],
        [{ [key]: "1.2.3" }, false],
      ] as const) {
        expect(editorAccepts(none, value), JSON.stringify(value)).toBe(accepted);
        expect(yield* startAccepts(only, "user", value), JSON.stringify(value)).toBe(accepted);
      }

      reach.mark("none-scope");
      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// X1b, the version pattern and the largest safe integer
// ---------------------------------------------------------------------------------------------

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

type Place = "major" | "minor" | "patch" | "prerelease" | "build";

const PLACES: ReadonlyArray<Place> = ["major", "minor", "patch", "prerelease", "build"];

/** The numbers a version holds around the limit: the edge, one past it, sixteen and seventeen digits, and what the seeds draw. */
const edges = (draw: TextDraw): ReadonlyArray<string> => [
  "0",
  "1",
  `${SAFE - 1n}`,
  `${SAFE}`,
  `${SAFE + 1n}`,
  `${SAFE + 2n}`,
  "8999999999999999",
  "9999999999999999",
  "10000000000000000",
  "1000000000000000",
  "99999999999999999999",
  `${BigInt(number(draw, 0)) * BigInt(number(draw, 1)) * BigInt(number(draw, 2)) * 1000000n}`,
];

const versionWith = (place: Place, n: string) =>
  Match.value(place).pipe(
    Match.when("major", () => `${n}.0.0`),
    Match.when("minor", () => `0.${n}.0`),
    Match.when("patch", () => `0.0.${n}`),
    Match.when("prerelease", () => `1.0.0-${n}`),
    Match.orElse(() => `1.0.0+${n}`),
  );

// Plants: (h) leave the version out of the repo schema: the safe version is refused, red; write each number as at most
// fifteen digits: the largest safe integer, with sixteen, is refused, red; write each number as `\d+`: one past the limit
// is accepted, red; leave a numeric pre-release identifier as `\d+`: one past the limit is accepted, red.
it.effect.prop(
  "X1b the version pattern holds the largest safe integer: the editor and the start read alike a version whose number is up to, at and past 9007199254740991, in each of the three parts, in a numeric pre-release identifier, and in a build identifier, which has no limit",
  { draw: TextDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Place | "above">([...PLACES, "above"]);
      const group = makeGroup(draw.app, specsB(draw));
      const editor = editorFor(SettingGroup.jsonSchema(group, "repo"));
      const key = `${draw.app}-version`;

      for (const place of PLACES) {
        for (const n of edges(draw)) {
          const value = { [key]: versionWith(place, n) };
          const start = yield* startAccepts(group, "repo", value);
          // The start's own rule: a number is at most the largest safe integer, a build identifier is any digits.
          const wanted = place === "build" || BigInt(n) <= SAFE;

          expect(start, `${place} ${n}: the start`).toBe(wanted);
          expect(editorAccepts(editor, value), `${place} ${n}: the editor`).toBe(start);

          if (place !== "build" && BigInt(n) > SAFE) {
            reach.mark("above");
          }
        }

        reach.mark(place);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// X2, the schema text's form
// ---------------------------------------------------------------------------------------------

// Plants: (a) drop the `default` annotation: red; (f) keep the group's order in `fields`: a reordered group gives other
// text, red; (u) catch the throw and write `{}`: red; (e) take every setting whatever its scope: red.
type Form = "description" | "default" | "required" | "window" | "version" | "order" | "text" | "throws" | "scope";

const FORMS: ReadonlyArray<Form> = [
  "description",
  "default",
  "required",
  "window",
  "version",
  "order",
  "text",
  "throws",
  "scope",
];

it.effect.prop(
  "X2 the schema text's form: each setting in the file's scope has its description and, when it has one, its encoded default at its node, a required one has no default, the text ends in exactly one line break and is the committed form of its own document, the same group in another order gives the same text, and a schema with no JSON Schema form throws",
  { draw: TextDraw },
  ({ draw }) =>
    Effect.sync(() => {
      const reach = new Reach<Form>(FORMS);

      for (const specs of [specsA(draw), specsB(draw), specsC(draw), specsD(draw)]) {
        const group = makeGroup(draw.app, specs);
        const live = specs.some((spec) => spec.live);

        for (const file of FILES) {
          // A group with a live setting never makes `jsonSchema` throw: the window is a pattern, not a bare filter.
          const text = SettingGroup.jsonSchema(group, file);
          const document = readJson(text);

          expect(text.endsWith("\n") && !text.endsWith("\n\n"), "one final line break").toBe(true);
          expect(committed(text), "the committed form").toBe(text);
          reach.mark("text");

          for (const spec of specs) {
            const node = leafAt(document, spec.name);

            if (!spec.files.includes(file)) {
              expect(Option.isNone(node), `${spec.name} is not in the ${file} file`).toBe(true);
              reach.mark("scope");
              continue;
            }

            expect(Option.isSome(node), `${spec.name} is in the ${file} file`).toBe(true);
            const leaf: Record<string, unknown> = Option.getOrElse(node, () => ({}));

            expect(leaf.description, `${spec.name}: its description`).toBe(spec.description);
            reach.mark("description");

            if (Option.isSome(spec.default)) {
              expect(leaf.default, `${spec.name}: its encoded default`).toEqual(spec.default.value);
              reach.mark("default");
            } else {
              expect("default" in leaf, `${spec.name}: a required setting has no default`).toBe(false);
              reach.mark("required");
            }
          }

          const window = leafAt(document, WINDOW);

          expect(
            Option.isSome(window),
            `the quiet window is in the ${file} file of a group with a live setting only`,
          ).toBe(live);

          if (Option.isSome(window)) {
            expect(window.value.default).toBe("100 millis");
            expect(window.value.description, "the window has a description").toBeDefined();
            reach.mark("window");
          }

          expect(
            Option.isSome(topAt(document, `${draw.app}-version`)),
            "the repo's version key, and only the repo's",
          ).toBe(file === "repo");

          if (file === "repo") {
            expect(
              Option.getOrUndefined(topAt(document, `${draw.app}-version`))?.description,
              "the version's description",
            ).toBe(`The oldest ${draw.app} version this repo works with, as 1.2.3.`);
            reach.mark("version");
          }

          // The same group with its settings in another order.
          const turned = pick(draw, 4) % specs.length;
          const other = makeGroup(draw.app, [...specs.slice(turned), ...specs.slice(0, turned)].reverse());

          expect(SettingGroup.jsonSchema(other, file), "another order").toBe(text);
          reach.mark("order");
        }
      }

      // A setting whose schema has no exact JSON Schema form has none: the call throws, for either file, live or not, and
      // names why. A schema that has one, beside it, does not save it.
      const throws = (grouped: SettingGroup.SettingGroup<string, ReadonlyArray<Setting.Any>>, label: string) => {
        for (const file of FILES) {
          expect(() => SettingGroup.jsonSchema(grouped, file), label).toThrow(
            "A setting's schema cannot be written as JSON Schema without loosening it.",
          );
        }
      };

      for (const one of LOOSE) {
        const name = namesFor(draw)[0] ?? "x.y";
        const loose = looseSetting(name, one.schema);
        const beside = looseSetting(namesFor(draw)[1] ?? "x.z", Schema.String);

        throws(SettingGroup.make(draw.app, loose), one.label);
        throws(SettingGroup.make(draw.app, Setting.live(loose)), `${one.label}, live`);
        throws(SettingGroup.make(draw.app, beside, loose), `${one.label}, beside one that has a form`);
      }

      reach.mark("throws");
      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// X3, the reference reads back
// ---------------------------------------------------------------------------------------------

type Part =
  | "description"
  | "break-lf"
  | "break-crlf"
  | "break-cr"
  | "final-break"
  | "default"
  | "backtick"
  | "file-only"
  | "required"
  | "window"
  | "order";

const PARTS: ReadonlyArray<Part> = [
  "description",
  "break-lf",
  "break-crlf",
  "break-cr",
  "final-break",
  "default",
  "backtick",
  "file-only",
  "required",
  "window",
  "order",
];

const reference = (draw: TextDraw): ReadonlyArray<Spec> => {
  const names = namesFor(draw);
  const [lf, crlf, cr] = BREAKS;

  return [
    {
      name: names[0] ?? "a.b",
      kind: "text",
      files: ["repo", "user"],
      live: false,
      fileOnly: false,
      description: describe(draw, 0, { br: crlf ?? "\r\n" }),
      default: Option.some(TEXTS[pick(draw, 0) % 6] ?? "a`b"),
    },
    {
      name: names[1] ?? "a.c",
      kind: "int",
      files: ["user"],
      live: true,
      fileOnly: false,
      description: describe(draw, 1, { br: cr ?? "\r" }),
      default: Option.some(18787),
    },
    {
      name: names[2] ?? "d.e",
      kind: "literal",
      files: ["repo"],
      live: false,
      fileOnly: true,
      description: describe(draw, 2, { br: lf ?? "\n", spaced: true }),
      default: Option.some("people"),
    },
    {
      name: names[3] ?? "f.g.h",
      kind: "required",
      files: ["repo", "user"],
      live: false,
      fileOnly: false,
      description: describe(draw, 3, { br: crlf ?? "\r\n", final: true }),
      default: Option.none(),
    },
  ];
};

// Every description holds each line that changes a block's meaning, at the start and under a text line: a setext
// underline (`=`, `===`, `---`), a list marker of each kind, `1)` and `2)` as well as `1.`, a heading, a quote, a fence,
// a table row and its delimiter row, a rule, a link definition, an HTML block and a task. On the plan's `escape` (the old
// one, moved) `=`, `===`, `1)` and `2)` swallow the section's table, so the build's `escape` must read them too.
// Plants: (g) leave `=` out of `escape`: a `=` line under text makes a heading, red; (g) leave `)` out of the ordered-list
// rule: a first line `1) x` makes a list, red; (g) drop `escape`: a `*word*` description parses as emphasis, red; (i) write every default in single backticks:
// a default with a backtick breaks its cell, red; (i) leave `\|` unescaped: the row gains a cell, red; (e) write the
// variable for a file-only setting: red; (c) write each description with `\n` in place of its own breaks: a CRLF
// description changes, red; (f) keep the group's order: red.
it.effect.prop(
  "X3 the reference reads back: parsed with the GFM parser it has one section per setting, the window included, by name, each with its description, line breaks as given, its files, its variable and flag or none for a file-only setting, its default or none for a required one, and whether it applies live or at a restart; and it ends in one line break and is the same for another order",
  { draw: TextDraw },
  ({ draw }) =>
    Effect.sync(() => {
      const reach = new Reach<Part>(PARTS);
      const specs = reference(draw);
      const group = makeGroup(draw.app, specs);
      const text = SettingGroup.reference(group);
      const sections = sectionsFor(text);

      const files: Record<Setting.File, string> = {
        repo: `.${draw.app}/${draw.app}.toml`,
        user: `~/.${draw.app}/${draw.app}.toml`,
      };

      expect(text.endsWith("\n") && !text.endsWith("\n\n"), "one final line break").toBe(true);
      expect(
        sections.map((section) => section.name),
        "one section per setting, by name, the window included",
      ).toEqual([...specs.map((spec) => spec.name), WINDOW].sort());
      reach.mark("window");

      for (const spec of specs) {
        const section = sections.find((one) => one.name === spec.name);

        expect(section, spec.name).toBeDefined();

        if (section === undefined) {
          continue;
        }

        // The description, as written but for a final break, which a paragraph cannot hold, and for the one to three spaces
        // that start a line, which Markdown drops from a paragraph's lines (four would make a code block).
        expect(section.paragraph, `${spec.name}: its description`).toBe(
          spec.description.replace(/(?:\r\n|\r|\n)$/u, "").replace(/^ {1,3}(?=\S)/gmu, ""),
        );
        expect(section.paragraphs, `${spec.name}: one paragraph`).toBe(1);
        expect(section.tables, `${spec.name}: one table`).toBe(1);
        reach.mark("description");

        expect(Object.keys(section.rows), `${spec.name}: its rows`).toEqual([
          "Files",
          "Environment",
          "Flag",
          "Default",
          "Applies",
        ]);
        expect([...(section.rows.Files?.codes ?? [])].sort(), `${spec.name}: its files`).toEqual(
          spec.files.map((file) => files[file]).sort(),
        );

        const none = "none: file-only";

        if (spec.fileOnly) {
          expect(section.rows.Environment?.text, `${spec.name}: no variable`).toBe(none);
          expect(section.rows.Flag?.text, `${spec.name}: no flag`).toBe(none);
          reach.mark("file-only");
        } else {
          expect(section.rows.Environment?.codes, `${spec.name}: its variable`).toEqual([
            variable(draw.app, spec.name),
          ]);
          expect(section.rows.Flag?.codes, `${spec.name}: its flag`).toEqual([`--${spec.name}`]);
        }

        if (Option.isSome(spec.default)) {
          const [shown] = section.rows.Default?.codes ?? [];

          expect(section.rows.Default?.codes, `${spec.name}: one code span`).toHaveLength(1);
          expect(shown === undefined ? undefined : readValue(shown), `${spec.name}: its default`).toEqual(
            spec.default.value,
          );
          reach.mark("default");

          if (Schema.is(Schema.String)(spec.default.value) && /[`|]/u.test(spec.default.value)) {
            reach.mark("backtick");
          }
        } else {
          expect(section.rows.Default?.text, `${spec.name}: required`).toBe("none: required");
          reach.mark("required");
        }

        expect(section.rows.Applies?.text, `${spec.name}: when it applies`).toBe(spec.live ? "live" : "restart");
      }

      for (const [mark, spec, br] of [
        ["break-crlf", specs[0], "\r\n"],
        ["break-cr", specs[1], "\r"],
        ["break-lf", specs[2], "\n"],
        ["final-break", specs[3], "\r\n"],
      ] as const) {
        expect(spec?.description.includes(br), `${mark}: the description holds it`).toBe(true);
        reach.mark(mark);
      }

      const window = sections.find((one) => one.name === WINDOW);

      expect(
        window?.rows.Default?.codes.map((code) => readValue(code)),
        "the window's default",
      ).toEqual(["100 millis"]);
      expect(window?.rows.Applies?.text, "the window applies at a restart").toBe("restart");
      expect(window?.rows.Environment?.codes, "the window's variable").toEqual([variable(draw.app, WINDOW)]);

      const turned = pick(draw, 4) % specs.length;

      expect(
        SettingGroup.reference(makeGroup(draw.app, [...specs.slice(turned), ...specs.slice(0, turned)].reverse())),
        "another order",
      ).toBe(text);
      reach.mark("order");

      reach.done();
    }),
  check,
);

const readValue = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

// ---------------------------------------------------------------------------------------------
// W3, the window's refusal says what it wants
// ---------------------------------------------------------------------------------------------

type Source = "file" | "variable" | "flag";

const SOURCES: ReadonlyArray<Source> = ["file", "variable", "flag"];

const WANTS = "is not a length of time. Write it as text, as 100 millis or 2 seconds.";

// Plants: (j) drop the window's `title` annotation: the refusal says "a valid value", red; drop its `description`: the
// rule is gone from the message, red.
it.effect.prop(
  "W3 the window's refusal says what it wants: a text that is no length of time, set in a file, by a variable and by a flag, stops the start `invalid`, naming where it was and saying it is not a length of time and how to write one",
  { draw: TextDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Source>(SOURCES);
      const group = makeGroup(draw.app, specsA(draw));
      const closing = `${draw.app} did not start.`;
      const pad = pick(draw, 2) % 4;
      const comments = Array.from({ length: pad }, (_, n) => `# note ${n}\n`).join("");
      const repo = `/work/.${draw.app}/${draw.app}.toml`;

      const started = (
        files: Record<string, string>,
        env: Record<string, string>,
        flags: Record<string, Option.Option<string>>,
      ) =>
        Effect.exit(
          Effect.scoped(
            Layer.build(
              SettingGroup.layer(group, { version: "1.2.3", repo: "/work", flags }).pipe(
                Layer.provide(MemoryFiles.layer({ files })),
              ),
            ),
          ).pipe(
            Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME: "/people/one", ...env } }))),
          ),
        );

      for (const bad of WINDOWS_REFUSED) {
        // A file holds a text or a number, and the window is a text either way.
        const inFile = refusal(
          yield* started({ [repo]: `${comments}[config.watch]\ndebounce = ${JSON.stringify(bad)}\n` }, {}, {}),
        );

        expect(inFile.reason, `file ${JSON.stringify(bad)}`).toBe("invalid");
        expect(inFile.line, `file ${JSON.stringify(bad)}: its line`).toBe(pad + 2);
        expect(inFile.message, `file ${JSON.stringify(bad)}`).toBe(
          `.${draw.app}/${draw.app}.toml, line ${pad + 2}: ${WINDOW} ${WANTS}\n  ${closing}`,
        );
        reach.mark("file");

        if (Schema.is(Schema.NonEmptyString)(bad)) {
          const byVariable = refusal(yield* started({}, { [variable(draw.app, WINDOW)]: bad }, {}));

          expect(byVariable.reason, `variable ${bad}`).toBe("invalid");
          expect(byVariable.message, `variable ${bad}`).toBe(`${variable(draw.app, WINDOW)} ${WANTS}\n  ${closing}`);
          reach.mark("variable");

          const byFlag = refusal(yield* started({}, {}, { [WINDOW]: Option.some(bad) }));

          expect(byFlag.reason, `flag ${bad}`).toBe("invalid");
          expect(byFlag.message, `flag ${bad}`).toBe(`--${WINDOW} ${WANTS}\n  ${closing}`);
          reach.mark("flag");
        }
      }

      reach.done();
    }),
  check,
);
