/**
 * What the laws of `SettingGroup.jsonSchema` and `SettingGroup.reference` (ticket 1846, slice 1) share: the draws, the declared groups, the documents a file may hold, and the readers that read a schema text or a reference text back.
 *
 * Every generator is an Effect Schema, so each has its own Arbitrary. A law builds one case for each class it lists from the drawn seeds, never the cross product, and `Reach.done` fails when a class was not reached. A description is built from drawn lines, and a line that every class needs is added by the builder, so a class never depends on chance.
 *
 * Nothing here reads a file. A group's start is only its whole-file check, `internal/check.ts`'s `check`, read on a document as a JavaScript value.
 */
import { Effect, Match, Option, Predicate, Result, Schema } from "effect";
import * as EffectJsonSchema from "effect/JsonSchema";
import * as SchemaRepresentation from "effect/SchemaRepresentation";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { Setting, SettingGroup } from "./index.ts";
import { check, version } from "./internal/check.ts";
import { shown } from "./internal/place.ts";
import { toml } from "./internal/toml.ts";
import { watched } from "./internal/window.ts";
import * as JsonSchema from "./JsonSchema.ts";
import { Reach } from "./SettingGroup.edit.test-support.ts";

export { Reach };

type Json = typeof Schema.Json.Type;

// ---------------------------------------------------------------------------------------------
// Draws
// ---------------------------------------------------------------------------------------------

const clean = Schema.makeFilter(
  (text: string) =>
    !["person", "instance", "config", "watch", "debounce", "home", "version"].some((word) => text.includes(word)),
);

const Word = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{3,7}$/u), clean);

const Table = Schema.String.check(Schema.isPattern(/^[a-z]{2,6}(-[a-z]{1,4})?$/u), clean);

const Key = Schema.String.check(Schema.isPattern(/^[a-z]{2,6}(-[a-z]{1,4})?$/u), clean);

const Small = Schema.String.check(Schema.isPattern(/^[a-z]{2,6}$/u), clean);

const Pick = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 999 }));

const Count = Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 60000 }));

/** A line of a description: every character Markdown reads, a tab and `雪` inside, never a space or a tab at either end. */
const Line = Schema.String.check(
  Schema.isPattern(
    /^[A-Za-z0-9*_[\]<>#|&~+!\\.:`雪=()@-](?:[A-Za-z0-9*_[\]<>#|&~+!\\.:`雪=()@ \t-]{0,10}[A-Za-z0-9*_[\]<>#|&~+!\\.:`雪=()@-])?$/u,
  ),
);

const isText = Schema.is(Schema.String);

const field = (name: string) =>
  (name.split(".").at(-1) ?? name).replace(/-([a-z0-9])/gu, (_, letter: string) => letter.toUpperCase());

/** The environment variable that sets a setting: `DEMO_INSTANCE_PORT`. */
export const variable = (app: string, name: string) =>
  [app.toUpperCase(), ...name.split(".").map((word) => word.replace(/-/gu, "_").toUpperCase())].join("_");

export const TextDraw = Schema.Struct({
  app: Word,
  tables: Schema.Array(Table).check(Schema.isMinLength(4), Schema.isMaxLength(4)),
  keys: Schema.Array(Key).check(Schema.isMinLength(4), Schema.isMaxLength(4)),
  lines: Schema.Array(Line).check(Schema.isMinLength(4), Schema.isMaxLength(8)),
  words: Schema.Array(Small).check(Schema.isMinLength(4), Schema.isMaxLength(6)),
  numbers: Schema.Array(Count).check(Schema.isMinLength(4), Schema.isMaxLength(6)),
  picks: Schema.Array(Pick).check(Schema.isMinLength(8), Schema.isMaxLength(12)),
}).check(
  Schema.makeFilter((draw) => {
    const names = namesFor(draw);

    return (
      new Set(draw.tables).size === 4 &&
      new Set(names).size === 4 &&
      new Set(names.map(field)).size === 4 &&
      new Set(names.map((name) => variable("a", name))).size === 4 &&
      // A name is never the table of another.
      names.every((name) => names.every((other) => other === name || !other.startsWith(`${name}.`)))
    );
  }),
);

export type TextDraw = typeof TextDraw.Type;

export const pick = (draw: TextDraw, n: number): number => draw.picks[n % draw.picks.length] ?? 0;

export const number = (draw: TextDraw, n: number): number => draw.numbers[n % draw.numbers.length] ?? 4100;

export const word = (draw: TextDraw, n: number): string => draw.words[n % draw.words.length] ?? "w";

/** Four names: the second sits in the first's table when a seed says so, and the fourth is three words deep. */
export const namesFor = (draw: TextDraw): ReadonlyArray<string> => {
  const [t0, t1, t2, t3] = draw.tables;
  const [k0, k1, k2, k3] = draw.keys;
  const shared = (draw.picks[0] ?? 0) % 2 === 0;

  return [`${t0}.${k0}`, `${shared ? t0 : t1}.${k1}`, `${t2}.${k2}`, `${t3}.${draw.words[3] ?? "sub"}.${k3}`];
};

// ---------------------------------------------------------------------------------------------
// Descriptions: the breaks, the lines, and the class a builder always adds
// ---------------------------------------------------------------------------------------------

type Break = "\n" | "\r\n" | "\r";

export const BREAKS: ReadonlyArray<Break> = ["\n", "\r\n", "\r"];

/** The first line of a description: each character Markdown reads inside a line, a line that starts `1.`, a bar, a tab, `雪` and a backtick. */
const MARKS = [
  "1. a|b *c* _d_ [e] <f> #g &h ~i +j !k -l `m =n (o) @p",
  "12) 10.5 x\\y\\\\z:w",
  "  10. 雪\ttab",
  " 7) x",
];

/**
 * Every line that, at the start of a line or under a text line, changes what a block means in Markdown: an underline that
 * turns the line above into a heading, a list of each marker, an ordered list with a dot and with a bracket, a heading, a
 * quote, a fence, a table row and its delimiter row, a rule, a link definition, an HTML block and a task.
 */
const CONSTRUCTS: ReadonlyArray<string> = [
  "=",
  "===",
  "---",
  "***",
  "___",
  "- x",
  "* x",
  "+ x",
  "1) x",
  "2) x",
  "1. x",
  "# x",
  "## x",
  "> x",
  "```",
  "```js",
  "~~~",
  "| a | b |",
  "|---|---|",
  ":---:",
  "[x]: y",
  "<div>",
  "- [ ] t",
  "  1. x",
  " 12) x",
];

/**
 * One description: a line of marks, then each construct under a drawn text line (the construct is the line below a text
 * line, and the first of the description is the marks), joined by a break (the seeds' unless one is given), and a final
 * break when asked. The order of the constructs turns with the seeds, and every one is in every description. The first text
 * line ends in two spaces, and the whole description does too when `spaced` is given.
 */
export const describe = (
  draw: TextDraw,
  n: number,
  options: { final?: boolean; br?: Break; spaced?: boolean } = {},
): string => {
  const br = options.br ?? BREAKS[pick(draw, n + 1) % BREAKS.length] ?? "\n";
  const turn = pick(draw, n + 3) % CONSTRUCTS.length;
  const order = [...CONSTRUCTS.slice(turn), ...CONSTRUCTS.slice(0, turn)];

  // The first text line ends in two spaces, which Markdown reads as a hard line break and drops.
  const lines = order.flatMap((construct, i) => [
    `${draw.lines[(n + i) % draw.lines.length] ?? "x"}${i === 0 ? "  " : ""}`,
    construct,
  ]);

  const body = `${[MARKS[n % MARKS.length] ?? "z", ...lines].join(br)}${options.spaced === true ? "  " : ""}`;

  return options.final === true ? `${body}${br}` : body;
};

// ---------------------------------------------------------------------------------------------
// Declared settings and groups
// ---------------------------------------------------------------------------------------------

type Kind =
  | "int"
  | "literal"
  | "pattern"
  | "branded"
  | "record"
  | "array"
  | "required"
  | "text"
  // The kinds whose checks have an exact JSON Schema form: a text of at least one character, a text of code points
  // between bounds, an array of at least one item or between bounds, an array without a repeat, a record with at least one
  // property, and a text that starts with a letter.
  | "nonempty"
  | "codepoints"
  | "arrmin"
  | "arrbounds"
  | "unique"
  | "props"
  | "starts"
  // An array held by a group of checks, `makeFilterGroup`, whose members each ask for the type they check.
  | "grouped";

type Files = Setting.Files;

export interface Spec {
  readonly name: string;
  readonly kind: Kind;
  readonly files: Files;
  readonly live: boolean;
  readonly fileOnly: boolean;
  readonly description: string;
  /** The default as the file writes it, or none for a required setting. */
  readonly default: Option.Option<Json>;
}

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const Rule = Schema.Literals(["people", "robots", "owner"]);

const Slug = Schema.String.pipe(Schema.brand("Slug"));

const Pairing = Schema.Struct({ a: Schema.optionalKey(Schema.Int) });

const Letters = Schema.String.check(Schema.isPattern(/^[a-z]+$/u));

/** The defaults of a text setting that push a code span: backticks, a run of them, a bar, a quote, and the empty text. */
export const TEXTS: ReadonlyArray<string> = ["a`b", "``", "`lead", "trail`", "p|q", "`|`", 'say "hi"', "", "雪\t1"];

const described = (spec: Spec) => Setting.withDescription(spec.description);

const scoped = (spec: Spec) => Setting.files(spec.files);

const marked = (spec: Spec, made: Setting.Setting<string, any>): Setting.Any => {
  if (spec.fileOnly) {
    return spec.live ? Setting.live(Setting.fileOnly(made)) : Setting.fileOnly(made);
  }

  return spec.live ? Setting.live(made) : made;
};

/** The setting a spec stands for. */
const declare = (spec: Spec): Setting.Any => {
  const defaulted = Option.getOrUndefined(spec.default);

  switch (spec.kind) {
    case "int":
      return marked(
        spec,
        Setting.make(spec.name, Port).pipe(Setting.withDefault(18787), described(spec), scoped(spec)),
      );
    case "literal":
      return marked(
        spec,
        Setting.make(spec.name, Rule).pipe(Setting.withDefault("people"), described(spec), scoped(spec)),
      );
    case "pattern":
      return marked(
        spec,
        Setting.make(spec.name, Letters).pipe(Setting.withDefault("abc"), described(spec), scoped(spec)),
      );
    case "branded":
      return marked(
        spec,
        Setting.make(spec.name, Slug).pipe(Setting.withDefault(Slug.make("slug")), described(spec), scoped(spec)),
      );
    case "record":
      return marked(
        spec,
        Setting.make(spec.name, Pairing).pipe(Setting.withDefault({ a: 90 }), described(spec), scoped(spec)),
      );
    case "array":
      return marked(
        spec,
        Setting.make(spec.name, Schema.Array(Schema.Int)).pipe(
          Setting.withDefault([70]),
          described(spec),
          scoped(spec),
        ),
      );
    case "required":
      return marked(spec, Setting.make(spec.name, Port).pipe(described(spec), scoped(spec)));
    case "nonempty":
      return marked(
        spec,
        Setting.make(spec.name, Schema.NonEmptyString).pipe(Setting.withDefault("x"), described(spec), scoped(spec)),
      );
    case "codepoints":
      return marked(
        spec,
        Setting.make(spec.name, Schema.String.check(Schema.isMinCodePoints(2), Schema.isMaxCodePoints(8))).pipe(
          Setting.withDefault("ab"),
          described(spec),
          scoped(spec),
        ),
      );
    case "arrmin":
      return marked(
        spec,
        Setting.make(spec.name, Schema.Array(Schema.Int).check(Schema.isMinLength(1))).pipe(
          Setting.withDefault([1]),
          described(spec),
          scoped(spec),
        ),
      );
    case "arrbounds":
      return marked(
        spec,
        Setting.make(spec.name, Schema.Array(Schema.Int).check(Schema.isBetweenLength(1, 3))).pipe(
          Setting.withDefault([1, 2]),
          described(spec),
          scoped(spec),
        ),
      );
    case "unique":
      return marked(
        spec,
        Setting.make(spec.name, Schema.Array(Schema.Int).check(Schema.isUnique())).pipe(
          Setting.withDefault([1, 2]),
          described(spec),
          scoped(spec),
        ),
      );
    case "props":
      return marked(
        spec,
        Setting.make(spec.name, Schema.Record(Schema.String, Schema.Int).check(Schema.isMinProperties(1))).pipe(
          Setting.withDefault({ x: 1 }),
          described(spec),
          scoped(spec),
        ),
      );
    case "grouped":
      return marked(
        spec,
        Setting.make(
          spec.name,
          Schema.Array(Schema.Int).check(
            Schema.makeFilterGroup([Schema.isMinLength(1), Schema.isMaxLength(3)], {
              toJsonSchema: () => ({ minItems: 1, maxItems: 3 }),
            }),
          ),
        ).pipe(Setting.withDefault([1]), described(spec), scoped(spec)),
      );
    case "starts":
      return marked(
        spec,
        Setting.make(spec.name, Schema.String.check(Schema.isStartingWith("a"))).pipe(
          Setting.withDefault("a1"),
          described(spec),
          scoped(spec),
        ),
      );
    case "text":
      return marked(
        spec,
        Setting.make(spec.name, Schema.String).pipe(
          Setting.withDefault(isText(defaulted) ? defaulted : "fallback"),
          described(spec),
          scoped(spec),
        ),
      );
  }
};

export const makeGroup = (app: string, specs: ReadonlyArray<Spec>) =>
  SettingGroup.make(app, ...specs.map((spec) => declare(spec)));

type Group = ReturnType<typeof makeGroup>;

const FILES: ReadonlyArray<Files> = [["repo", "user"], ["repo"], ["user"]];

/** The files of the n-th setting of a group: the first is the repo's only, the second the user's only, the rest as a seed says. */
const filesFor = (draw: TextDraw, n: number, seed: number): Files => {
  if (n === 0) {
    return ["repo"];
  }

  if (n === 1) {
    return ["user"];
  }

  return FILES[pick(draw, seed) % FILES.length] ?? ["repo", "user"];
};

const defaultFor = (kind: Kind, text: string): Option.Option<Json> =>
  Match.value(kind).pipe(
    Match.when("int", () => Option.some(18787)),
    Match.when("literal", () => Option.some("people")),
    Match.when("pattern", () => Option.some("abc")),
    Match.when("branded", () => Option.some("slug")),
    Match.when("record", () => Option.some({ a: 90 })),
    Match.when("array", () => Option.some([70])),
    Match.when("required", () => Option.none()),
    Match.when("nonempty", () => Option.some("x")),
    Match.when("codepoints", () => Option.some("ab")),
    Match.when("arrmin", () => Option.some([1])),
    Match.when("arrbounds", () => Option.some([1, 2])),
    Match.when("unique", () => Option.some([1, 2])),
    Match.when("props", () => Option.some({ x: 1 })),
    Match.when("starts", () => Option.some("a1")),
    Match.when("grouped", () => Option.some([1])),
    Match.orElse(() => Option.some(text)),
  );

/** Group A: an integer with bounds (live), a literal union, a text with a pattern and a branded text. The first is the repo's only, the second the user's only, so a key of each file is outside the other's. */
export const specsA = (draw: TextDraw): ReadonlyArray<Spec> => {
  const names = namesFor(draw);
  const kinds: ReadonlyArray<Kind> = ["int", "literal", "pattern", "branded"];

  return kinds.map((kind, n) => ({
    name: names[n] ?? "x.y",
    kind,
    files: filesFor(draw, n, n + 2),
    live: n === 0,
    fileOnly: false,
    description: describe(draw, n),
    default: defaultFor(kind, ""),
  }));
};

/** Group B: a record with an optional key, an array, a required integer and a text, with no live setting, so no quiet window. */
export const specsB = (draw: TextDraw): ReadonlyArray<Spec> => {
  const names = namesFor(draw);
  const kinds: ReadonlyArray<Kind> = ["record", "array", "required", "text"];

  return kinds.map((kind, n) => ({
    name: names[n] ?? "x.y",
    kind,
    files: filesFor(draw, n, n + 4),
    live: false,
    fileOnly: false,
    description: describe(draw, n + 1),
    default: defaultFor(kind, TEXTS[pick(draw, n) % TEXTS.length] ?? ""),
  }));
};

/** Groups C and D: the kinds whose checks have an exact JSON Schema form, so `jsonSchema` never throws for them. */
export const specsC = (draw: TextDraw): ReadonlyArray<Spec> =>
  exact(draw, ["nonempty", "codepoints", "arrmin", "props"], 6);

export const specsD = (draw: TextDraw): ReadonlyArray<Spec> =>
  exact(draw, ["arrbounds", "unique", "starts", "grouped"], 7);

const exact = (draw: TextDraw, kinds: ReadonlyArray<Kind>, seed: number): ReadonlyArray<Spec> => {
  const names = namesFor(draw);

  return kinds.map((kind, n) => ({
    name: names[n] ?? "x.y",
    kind,
    files: filesFor(draw, n, n + seed),
    live: false,
    fileOnly: false,
    description: describe(draw, n + seed),
    default: defaultFor(kind, ""),
  }));
};

// ---------------------------------------------------------------------------------------------
// Documents: what a file may hold, one case for each class
// ---------------------------------------------------------------------------------------------

export type DocClass =
  | "valid"
  | "empty"
  | "refused"
  | "unknown"
  | "scope"
  | "table-for-value"
  | "value-for-table"
  | "excess-in-record"
  | "version-valid"
  | "version-refused"
  | "version-user"
  | "window-valid"
  | "window-refused"
  | "window-absent";

export const DOC_CLASSES: ReadonlyArray<DocClass> = [
  "valid",
  "empty",
  "refused",
  "unknown",
  "scope",
  "table-for-value",
  "value-for-table",
  "excess-in-record",
  "version-valid",
  "version-refused",
  "version-user",
  "window-valid",
  "window-refused",
  "window-absent",
];

/** A document of one class: the value a file holds, and whether a start of the group accepts it, as the plan's classes say. */
interface Doc {
  readonly id: DocClass;
  readonly value: Readonly<Record<string, Json>>;
  readonly accepted: boolean;
}

type Tree = Readonly<Record<string, Json>>;

const isTree = Schema.is(Schema.Record(Schema.String, Schema.Json));

/** The document with `value` put at the dotted name. */
const put = (tree: Tree, name: string, value: Json): Tree => {
  const [head = "", ...rest] = name.split(".");

  if (rest.length === 0) {
    return { ...tree, [head]: value };
  }

  const below = tree[head];
  const inner: Tree = isTree(below) ? below : {};

  return { ...tree, [head]: put(inner, rest.join("."), value) };
};

/** A value the setting's schema accepts, as the file writes it. */
export const validValue = (draw: TextDraw, spec: Spec, n: number): Json =>
  Match.value(spec.kind).pipe(
    Match.when("int", () => number(draw, n)),
    Match.when("literal", () => "robots"),
    Match.when("pattern", () => word(draw, n)),
    Match.when("branded", () => word(draw, n + 1)),
    Match.when("record", () => ({ a: number(draw, n) })),
    Match.when("array", () => [number(draw, n), number(draw, n + 1)]),
    Match.when("required", () => number(draw, n + 2)),
    Match.when("nonempty", () => word(draw, n)),
    Match.when("codepoints", () => `${word(draw, n)}雪`),
    Match.when("arrmin", () => [number(draw, n)]),
    Match.when("arrbounds", () => [number(draw, n), number(draw, n + 1)]),
    Match.when("unique", () => [number(draw, n), number(draw, n + 1) + 1]),
    Match.when("props", () => ({ [word(draw, n)]: number(draw, n) })),
    Match.when("starts", () => `a${word(draw, n)}`),
    Match.when("grouped", () => [number(draw, n), number(draw, n + 1)]),
    Match.orElse(() => TEXTS[pick(draw, n) % TEXTS.length] ?? "x"),
  );

/** A value the setting's schema refuses. */
const refusedValue = (draw: TextDraw, spec: Spec): Json =>
  Match.value(spec.kind).pipe(
    Match.when("int", () => (pick(draw, 3) % 2 === 0 ? 70000 : "x")),
    Match.when("literal", () => "nope"),
    Match.when("pattern", () => "ABC1"),
    Match.when("branded", () => 5),
    Match.when("record", () => ({ a: "x" })),
    Match.when("array", () => [1, "x"]),
    Match.when("required", () => "x"),
    Match.when("nonempty", () => ""),
    Match.when("codepoints", () => "a"),
    Match.when("arrmin", () => []),
    Match.when("arrbounds", () => [1, 2, 3, 4]),
    Match.when("unique", () => [1, 1]),
    Match.when("props", () => ({})),
    Match.when("starts", () => "b"),
    Match.when("grouped", () => []),
    Match.orElse(() => 5),
  );

const VERSIONS_VALID = [
  "0.0.1",
  "1.2.3-beta.1+build.5",
  "10.20.30",
  "1.0.0-0.3.7",
  "1.0.0+21AF26D3--117B344092BD",
  "1.0.0-x-y-z.--",
];

const VERSIONS_REFUSED: ReadonlyArray<Json> = [
  "1.02.3",
  "1.2",
  "v1.2.3",
  "1.2.3-",
  "1.2.3-01",
  "1.2.3+",
  "01.2.3",
  "1.2.3.4",
  "",
  " 1.2.3",
  "1.2.3 ",
  "1.2.3-a..b",
  5,
];

export const WINDOWS_VALID = ["100 millis", "2 weeks", "1.5 seconds", "-Infinity", "Infinity", "3 minute", "0 nanos"];

export const WINDOWS_REFUSED: ReadonlyArray<Json> = [
  "2 fortnights",
  "1millis",
  "1 Millis",
  "",
  "1e3 millis",
  "1 2 millis",
  100,
];

/** One document for each class the group and the file can have. */
export const documents = (
  draw: TextDraw,
  app: string,
  specs: ReadonlyArray<Spec>,
  file: Setting.File,
): ReadonlyArray<Doc> => {
  const own = specs.filter((spec) => spec.files.includes(file));
  const others = specs.filter((spec) => !spec.files.includes(file));
  const first = own[pick(draw, 5) % Math.max(own.length, 1)];
  const live = specs.some((spec) => spec.live);
  const key = `${app}-version`;

  const filled = own.reduce<Tree>((tree, spec, n) => put(tree, spec.name, validValue(draw, spec, n)), {});

  const docs: Array<Doc> = [
    { id: "valid", value: filled, accepted: true },
    { id: "empty", value: {}, accepted: true },
    { id: "unknown", value: put(filled, "zzzz", 1), accepted: false },
    {
      id: "unknown",
      value: put(own[0] === undefined ? {} : filled, `${(own[0]?.name ?? "zzzz.yy").split(".")[0]}.zzzz`, 1),
      accepted: false,
    },
  ];

  if (first !== undefined) {
    docs.push({ id: "refused", value: put({}, first.name, refusedValue(draw, first)), accepted: false });
    docs.push({ id: "table-for-value", value: put({}, first.name, { zz: "q" }), accepted: false });
    docs.push({ id: "value-for-table", value: put({}, first.name.split(".")[0] ?? "x", 1), accepted: false });
  }

  const outside = others[0];

  if (outside !== undefined) {
    docs.push({ id: "scope", value: put({}, outside.name, validValue(draw, outside, 0)), accepted: false });
  }

  const record = own.find((spec) => spec.kind === "record");

  if (record !== undefined) {
    docs.push({ id: "excess-in-record", value: put({}, record.name, { a: 1, zz: 2 }), accepted: false });
  }

  if (file === "repo") {
    docs.push({
      id: "version-valid",
      value: { [key]: VERSIONS_VALID[pick(draw, 6) % VERSIONS_VALID.length] ?? "1.2.3" },
      accepted: true,
    });
    docs.push({
      id: "version-refused",
      value: { [key]: VERSIONS_REFUSED[pick(draw, 7) % VERSIONS_REFUSED.length] ?? "x" },
      accepted: false,
    });
  } else {
    docs.push({ id: "version-user", value: { [key]: "1.2.3" }, accepted: false });
  }

  const window = (value: Json) => put({}, "config.watch.debounce", value);

  if (live) {
    docs.push({
      id: "window-valid",
      value: window(WINDOWS_VALID[pick(draw, 8) % WINDOWS_VALID.length] ?? "1 millis"),
      accepted: true,
    });
    docs.push({
      id: "window-refused",
      value: window(WINDOWS_REFUSED[pick(draw, 9) % WINDOWS_REFUSED.length] ?? ""),
      accepted: false,
    });
  } else {
    docs.push({ id: "window-absent", value: window("100 millis"), accepted: false });
  }

  return docs;
};

// ---------------------------------------------------------------------------------------------
// The two readers of a document: the start's whole-file check, and the editor's schema read back
// ---------------------------------------------------------------------------------------------

/** Whether a start of the group accepts the file: its minimum version reads, and its whole-file check holds. */
export const startAccepts = (group: Group, file: Setting.File, value: Tree) => {
  const names = shown(group.app, toml);
  const loaded = { name: names[file], document: { value, spans: [] } };

  if (file === "repo" && Result.isFailure(version(group.app, loaded))) {
    return Effect.succeed(false);
  }

  return check({ app: group.app, settings: watched(group.settings) }, file, loaded, names).pipe(
    Effect.match({ onSuccess: () => true, onFailure: () => false }),
  );
};

const parsed = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)));

/** The schema text read back by Effect's own JSON Schema reader, with the patterns applied. */
export const editorFor = (text: string): Schema.Codec<unknown, unknown> =>
  // SAFETY: a schema read back from JSON Schema decodes JSON values to JSON values and needs no service.
  SchemaRepresentation.fromJsonSchemaDocument(EffectJsonSchema.fromSchemaDraft2020_12(parsed(text)), {
    patterns: "apply",
  }) as Schema.Codec<unknown, unknown>;

export const editorAccepts = (editor: Schema.Codec<unknown, unknown>, value: unknown): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(editor)(value, { onExcessProperty: "error" }));

// ---------------------------------------------------------------------------------------------
// The schema text read back
// ---------------------------------------------------------------------------------------------

export const readJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)));

const isRecord = Schema.is(Schema.Record(Schema.String, Schema.Json));

const target = (document: Readonly<Record<string, Json>>, ref: string): Readonly<Record<string, Json>> => {
  const prefix = "#/$defs/";
  const name = decodeURIComponent(ref.slice(prefix.length)).replaceAll("~1", "/").replaceAll("~0", "~");
  const defs = document.$defs;
  const found = isRecord(defs) ? defs[name] : undefined;

  return isRecord(found) ? found : {};
};

/** A node with its references followed: the referenced fields, with the node's own over them. */
const resolve = (
  document: Readonly<Record<string, Json>>,
  node: Readonly<Record<string, Json>>,
): Record<string, Json> => {
  const { $ref, allOf, ...own } = node;
  const below = isText($ref) ? resolve(document, target(document, $ref)) : {};
  const parts = Array.isArray(allOf) ? allOf.flatMap((part) => (isRecord(part) ? [resolve(document, part)] : [])) : [];

  return Object.assign({}, below, ...parts, own);
};

/** The node a dotted name has in a schema document, followed through its references, or none. */
export const leafAt = (document: Readonly<Record<string, Json>>, name: string): Option.Option<Record<string, Json>> =>
  name.split(".").reduce<Option.Option<Record<string, Json>>>((node, word) => {
    if (Option.isNone(node)) {
      return node;
    }

    const properties = resolve(document, node.value).properties;
    const found = isRecord(properties) ? properties[word] : undefined;

    return isRecord(found) ? Option.some(resolve(document, found)) : Option.none();
  }, Option.some(document));

/** The node of a top-level key, as the repo's `<app>-version`. */
export const topAt = (document: Readonly<Record<string, Json>>, key: string): Option.Option<Record<string, Json>> => {
  const properties = document.properties;
  const found = isRecord(properties) ? properties[key] : undefined;

  return isRecord(found) ? Option.some(resolve(document, found)) : Option.none();
};

// ---------------------------------------------------------------------------------------------
// The reference text read back
// ---------------------------------------------------------------------------------------------

const GFM = { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] };

type Root = ReturnType<typeof fromMarkdown>;

type Node = Root["children"][number];

/** The text a node reads as: its own value, or what its children read as. */
const plain = (node: unknown): string => {
  if (!Predicate.isObject(node)) {
    return "";
  }

  if (isText(node.value)) {
    return node.value;
  }

  return Array.isArray(node.children) ? node.children.map(plain).join("") : "";
};

const codes = (node: unknown): ReadonlyArray<string> => {
  if (!Predicate.isObject(node)) {
    return [];
  }

  if (node.type === "inlineCode" && isText(node.value)) {
    return [node.value];
  }

  return Array.isArray(node.children) ? node.children.flatMap(codes) : [];
};

/** One cell of a section's table: what it reads as, and each code span in it. */
interface Cell {
  readonly text: string;
  readonly codes: ReadonlyArray<string>;
}

/** One section of the reference as the GFM parser reads it. */
interface Section {
  /** The heading's code span. */
  readonly name: string;
  /** The paragraphs' text, joined by nothing: a description has one paragraph, or none. */
  readonly paragraph: string;
  readonly paragraphs: number;
  /** The table's rows by the first cell's text, and the row count. */
  readonly rows: Readonly<Record<string, Cell>>;
  readonly tables: number;
}

export const sectionsFor = (text: string): ReadonlyArray<Section> => {
  const sections: Array<{
    name: string;
    paragraph: string;
    paragraphs: number;
    rows: Record<string, Cell>;
    tables: number;
  }> = [];

  for (const node of fromMarkdown(text, GFM).children satisfies ReadonlyArray<Node>) {
    if (node.type === "heading") {
      sections.push({ name: codes(node).join(""), paragraph: "", paragraphs: 0, rows: {}, tables: 0 });
      continue;
    }

    const current = sections.at(-1);

    if (current === undefined) {
      continue;
    }

    if (node.type === "paragraph") {
      current.paragraph += plain(node);
      current.paragraphs += 1;
    }

    if (node.type === "table") {
      current.tables += 1;

      for (const row of node.children.slice(1)) {
        const [key, value] = row.children;
        current.rows[plain(key)] = { text: plain(value), codes: codes(value) };
      }
    }
  }

  return sections;
};

// ---------------------------------------------------------------------------------------------
// W1: texts that are, or are almost, a length of time
// ---------------------------------------------------------------------------------------------

export type DurationClass =
  | "units"
  | "decimal"
  | "negative"
  | "infinity"
  | "spaces"
  | "nospace"
  | "unit-unknown"
  | "unit-capital"
  | "trailing"
  | "leading"
  | "exponent"
  | "two-numbers"
  | "empty"
  | "bare"
  | "signed"
  | "dots"
  | "break"
  | "huge";

export const DURATION_CLASSES: ReadonlyArray<DurationClass> = [
  "units",
  "decimal",
  "negative",
  "infinity",
  "spaces",
  "nospace",
  "unit-unknown",
  "unit-capital",
  "trailing",
  "leading",
  "exponent",
  "two-numbers",
  "empty",
  "bare",
  "signed",
  "dots",
  "break",
  "huge",
];

const UNITS = ["nano", "micro", "milli", "second", "minute", "hour", "day", "week"];

/** The texts of each class, from the drawn numbers: every unit in the singular and the plural, decimals, a negative, `Infinity`, and near misses. */
export const durations = (draw: TextDraw): ReadonlyArray<{ readonly id: DurationClass; readonly text: string }> => {
  const n = number(draw, 0);
  const unit = UNITS[pick(draw, 1) % UNITS.length] ?? "milli";
  const plural = pick(draw, 2) % 2 === 0 ? "s" : "";

  return [
    ...UNITS.flatMap((each) => [
      { id: "units" as const, text: `${n} ${each}` },
      { id: "units" as const, text: `${n} ${each}s` },
    ]),
    { id: "decimal", text: `${n}.${number(draw, 1)} ${unit}${plural}` },
    { id: "negative", text: `-${n} ${unit}${plural}` },
    { id: "infinity", text: pick(draw, 3) % 2 === 0 ? "Infinity" : "-Infinity" },
    { id: "infinity", text: pick(draw, 3) % 2 === 0 ? "infinity" : "Infinity " },
    { id: "spaces", text: `${n}\t${unit}${plural}` },
    { id: "spaces", text: `${n}   ${unit}${plural}` },
    { id: "nospace", text: `${n}${unit}${plural}` },
    { id: "unit-unknown", text: `${n} fortnight${plural}` },
    { id: "unit-unknown", text: `${n} ${unit}x` },
    { id: "unit-capital", text: `${n} ${unit.toUpperCase()}${plural}` },
    { id: "unit-capital", text: `${n} ${unit[0]?.toUpperCase() ?? ""}${unit.slice(1)}${plural}` },
    { id: "trailing", text: `${n} ${unit}${plural} ` },
    { id: "leading", text: ` ${n} ${unit}${plural}` },
    { id: "exponent", text: `1e${pick(draw, 4) % 5} ${unit}${plural}` },
    { id: "two-numbers", text: `${n} ${number(draw, 2)} ${unit}${plural}` },
    { id: "empty", text: "" },
    { id: "bare", text: `${n}` },
    { id: "bare", text: `${unit}${plural}` },
    { id: "signed", text: `+${n} ${unit}${plural}` },
    { id: "signed", text: `--${n} ${unit}${plural}` },
    { id: "dots", text: `.${n} ${unit}${plural}` },
    { id: "dots", text: `${n}. ${unit}${plural}` },
    { id: "dots", text: `${n}.${n}.${n} ${unit}${plural}` },
    { id: "break", text: `${n} ${unit}${plural}\n` },
    { id: "break", text: `${n}\n${unit}${plural}` },
    { id: "huge", text: `${"9".repeat(25)} ${unit}${plural}` },
  ];
};

/** Whether Effect reads the text as a length of time. */
export const reads = (text: string): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(Schema.DurationFromString)(text));

/** The schema text as `JsonSchema.format` prints its own document: what a repo commits. */
export const committed = (text: string): string =>
  // SAFETY: the text was written by `JsonSchema.make` and `format`, so it is that document as plain JSON.
  JsonSchema.format(readJson(text) as Parameters<typeof JsonSchema.format>[0]);

/** One setting only the repo may set, for a file no setting may be set in. */
export const lone = (draw: TextDraw): Spec => ({
  name: namesFor(draw)[0] ?? "x.y",
  kind: "int",
  files: ["repo"],
  live: false,
  fileOnly: false,
  description: describe(draw, 0),
  default: defaultFor("int", ""),
});

// ---------------------------------------------------------------------------------------------
// Schemas JSON Schema cannot hold exactly: `jsonSchema` throws for each
// ---------------------------------------------------------------------------------------------

/** One setting whose schema has no exact JSON Schema form: a text length counts UTF-16 units where JSON Schema counts code points, a lowercase text and a pattern with no `u` flag have no form, and a bare filter none either. */
export const LOOSE: ReadonlyArray<{ readonly label: string; readonly schema: Schema.Codec<string, string> }> = [
  { label: "a text of at least two characters", schema: Schema.String.check(Schema.isMinLength(2)) },
  { label: "a text of at most eight characters", schema: Schema.String.check(Schema.isMaxLength(8)) },
  { label: "a text between bounds", schema: Schema.String.check(Schema.isBetweenLength(2, 8)) },
  { label: "a lowercase text", schema: Schema.String.check(Schema.isLowercased()) },
  { label: "a pattern without the u flag", schema: Schema.String.check(Schema.isPattern(/^a$/)) },
  { label: "a bare filter", schema: Schema.String.check(Schema.makeFilter((text: string) => text.length > 0)) },
];

/** A required setting of a schema. */
export const looseSetting = (name: string, schema: Schema.Codec<string, string>) =>
  Setting.make(name, schema).pipe(Setting.withDescription("A setting with no exact JSON Schema form."));
