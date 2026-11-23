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
import { Effect, Option, Schema } from "effect";
import { Setting, SettingGroup } from "./index.ts";
import { debounce } from "./internal/window.ts";
import * as JsonSchema from "./JsonSchema.ts";
import {
  BREAKS,
  describe,
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
  pick,
  Reach,
  readJson,
  reads,
  sectionsFor,
  type Spec,
  specsA,
  specsB,
  startAccepts,
  TEXTS,
  TextDraw,
  topAt,
  variable,
  word,
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

      for (const specs of [specsA(draw), specsB(draw)]) {
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

const SAFE = Number.MAX_SAFE_INTEGER;

// Plants: (h) leave the version out of the repo schema: the safe version is refused, red; write the pattern with `\d*` for a
// component: `01.2.3` is accepted, red.
it.effect.prop(
  "X1b pinned: the version pattern holds the largest safe integer as a limit it cannot say: a component up to 9007199254740991 is read alike by the editor and the start, and one above it is read by the editor and refused by the start",
  { draw: TextDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<"safe" | "above">(["safe", "above"]);
      const group = makeGroup(draw.app, specsB(draw));
      const editor = editorFor(SettingGroup.jsonSchema(group, "repo"));
      const key = `${draw.app}-version`;
      const part = pick(draw, 0) % 3;

      const at = (n: number | string) => [`${n}.0.0`, `0.${n}.0`, `0.0.${n}`][part] ?? `${n}.0.0`;
      const safe = at(SAFE - (pick(draw, 1) % 2));
      const above = at(`${SAFE + 1}`);

      for (const [version, id] of [
        [safe, "safe"],
        [above, "above"],
      ] as const) {
        const value = { [key]: version };
        const start = yield* startAccepts(group, "repo", value);

        expect(start, `${id}: the start`).toBe(id === "safe");
        // The pattern is a text shape, so it takes the one above the limit too: the known gap, held whole.
        expect(editorAccepts(editor, value), `${id}: the editor`).toBe(true);
        reach.mark(id);
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

      for (const specs of [specsA(draw), specsB(draw)]) {
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
            reach.mark("version");
          }

          // The same group with its settings in another order.
          const turned = pick(draw, 4) % specs.length;
          const other = makeGroup(draw.app, [...specs.slice(turned), ...specs.slice(0, turned)].reverse());

          expect(SettingGroup.jsonSchema(other, file), "another order").toBe(text);
          reach.mark("order");
        }
      }

      // A setting whose schema has a bare filter has no JSON Schema form: the call throws, for either file.
      const bare = Setting.make(
        namesFor(draw)[0] ?? "x.y",
        Schema.String.check(Schema.makeFilter((text: string) => text.length > 0)),
      ).pipe(Setting.withDescription("A text with a bare check."), Setting.withDefault("x"));

      const throws = (grouped: SettingGroup.SettingGroup<string, ReadonlyArray<Setting.Any>>) => {
        for (const file of FILES) {
          expect(() => SettingGroup.jsonSchema(grouped, file)).toThrow(
            "A setting's schema cannot be written as JSON Schema without loosening it.",
          );
        }
      };

      throws(SettingGroup.make(draw.app, bare));
      throws(SettingGroup.make(draw.app, Setting.live(bare)));

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
      description: describe(draw, 2, { br: lf ?? "\n" }),
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

// Plants: (g) drop `escape`: a `*word*` description parses as emphasis, red; (i) write every default in single backticks:
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

        // The description, as written but for a final break, which a paragraph cannot hold.
        expect(section.paragraph, `${spec.name}: its description`).toBe(
          spec.description.replace(/(?:\r\n|\r|\n)$/u, ""),
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
