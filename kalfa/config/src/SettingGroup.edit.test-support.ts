import { inspect } from "node:util";
/**
 * What the laws of `SettingGroup.edit` (ticket 1843, slice 2) share: the generators, the typed configuration file, and the reach check.
 *
 * A typed file is a configuration file as a person types it, built from pieces: a table's header, a key's text, its value's text, its tail (a comment and the line break), comment lines and blank lines. Each template below marks the bytes a law cares about (the key, the value's range, the place a new line goes, a comment, a comma) with private-use characters, and `locate` takes the marks out and keeps their offsets. So a law knows which bytes may change and which may not without asking the code under test.
 *
 * The classes (a) to (y) are the plan's "Generators, slice 2". Every class is built from the drawn seeds in every run, so none is left to chance; a law keeps the ids it reached and `Reach.done` fails when one is missing.
 */
import { expect } from "@effect/vitest";
import { Cause, ConfigProvider, Effect, Exit, Layer, Predicate, Schema } from "effect";
import { Setting, SettingGroup } from "./index.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";

const ROOT = "/work";

const HOME = "/people/one";

const VERSION = "1.2.3";

// ---------------------------------------------------------------------------------------------
// Reach: a law names the classes it must reach, and fails loudly when one is never reached.
// ---------------------------------------------------------------------------------------------

export class Reach<Id extends string> {
  readonly #wanted: ReadonlyArray<Id>;
  readonly #seen = new Set<Id>();

  constructor(wanted: ReadonlyArray<Id>) {
    this.#wanted = wanted;
  }

  mark(...ids: ReadonlyArray<Id>) {
    for (const id of ids) {
      this.#seen.add(id);
    }
  }

  /** Fails, naming the classes never reached. */
  done() {
    expect(
      this.#wanted.filter((id) => !this.#seen.has(id)),
      "every class of the law is reached in every run",
    ).toEqual([]);
  }
}

// ---------------------------------------------------------------------------------------------
// Draws: Effect Schemas, so each has its own Arbitrary.
// ---------------------------------------------------------------------------------------------

const Small = Schema.Int.check(Schema.isBetween({ minimum: -1000, maximum: 1000 }));

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const Rule = Schema.Literals(["people", "robots", "owner"]);

/** Text TOML can write: no lone surrogate, and no DEL, which a fixture of ours would write raw. */
const Text = Schema.String.check(Schema.isPattern(/^[^\uD800-\uDFFF\u007f]*$/u), Schema.isMaxLength(12));

/** Text that pushes the edge: quotes, a backslash, a line break, `#`, `=`, brackets and non-ASCII letters. */
const Quoted = Schema.String.check(Schema.isPattern(/^[a-z"'\\#= \t\n\ré雪[\]{},.]{0,10}$/u));

/** A record's key: the keys that need quotes (`a.b`, the empty key, 雪) are in its alphabet. */
const KeyText = Schema.String.check(Schema.isPattern(/^[a-z.雪 ]{0,3}$/u));

const Word = Schema.String.check(Schema.isPattern(/^[a-z]{3,6}$/u));

/** A secret-looking word, with a character that changes in JSON and in a URL. */
const Hidden = Schema.String.check(Schema.isPattern(/^sk-([A-Za-z0-9]{6,12})["/ +\\&][A-Za-z0-9]{3}$/u));

const Style = Schema.Struct({
  eol: Schema.Literals(["\n", "\r\n"]),
  gap: Schema.Literals([" = ", "  =\t", "="]),
  tail: Schema.Literals(["", " # tail", "   # tail", "\t# tail"]),
  above: Schema.Boolean,
  banner: Schema.Boolean,
  blanks: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 })),
  final: Schema.Boolean,
});

type Style = typeof Style.Type;

/**
 * How many keys a drawn record holds, and how many each record of a drawn table holds. A record drawn with no cap grows
 * with fast-check's size, and a table of records grows with its square (about 4800 keys at size 100). One edit of a
 * document that size took seconds, so a run of a law took up to 3 s and a law ran past CI's 60 s at full depth. A few
 * keys reach every class a record has (a key that needs quotes, an empty one, none at all). A wide record is not lost: it
 * is one case beside the drawn value, in `valuesFor`.
 */
const RECORD_KEYS = 5;

/** One drawn value for each kind of setting. */
const Values = Schema.Struct({
  port: Schema.Union([Schema.Literals([1, 65535]), Port]),
  rule: Rule,
  count: Schema.Union([
    Schema.Literals([0, 7]),
    Schema.Int.check(Schema.isBetween({ minimum: -100000, maximum: 100000 })),
  ]),
  flag: Schema.Boolean,
  real: Schema.Union([
    Schema.Literals([1.5, 1e-12, -0]),
    Schema.Finite.check(Schema.isBetween({ minimum: -1000000, maximum: 1000000 })),
  ]),
  text: Schema.Union([Quoted, Text]),
  texts: Schema.Array(Text).check(Schema.isMaxLength(5)),
  grid: Schema.Array(Schema.Array(Small).check(Schema.isMaxLength(3))).check(Schema.isMaxLength(3)),
  rows: Schema.Array(Schema.Struct({ n: Small, tag: Schema.optionalKey(Text) })).check(Schema.isMaxLength(3)),
  rec: Schema.Record(KeyText, Small).check(Schema.isMaxProperties(RECORD_KEYS)),
  tree: Schema.Record(KeyText, Schema.Record(KeyText, Small).check(Schema.isMaxProperties(RECORD_KEYS))).check(
    Schema.isMaxProperties(RECORD_KEYS),
  ),
  shape: Schema.Struct({
    a: Schema.optionalKey(Small),
    b: Schema.optionalKey(Schema.Struct({ c: Schema.optionalKey(Small) })),
  }),
});

type Values = typeof Values.Type;

/** What every law draws: an app, a word for the names, three styles, a value for each kind, and a file. */
export const Draw = Schema.Struct({
  app: Word,
  w: Word,
  styles: Schema.Tuple([Style, Style, Style]),
  values: Values,
  file: Schema.Literals(["repo", "user"]),
  /** Values a schema refuses, or the format cannot write, past the types. */
  bad: Schema.Struct({
    port: Schema.Union([
      Schema.Int.check(Schema.isBetween({ minimum: -1000000, maximum: 0 })),
      Schema.Int.check(Schema.isBetween({ minimum: 65536, maximum: 1000000000 })),
    ]),
    text: Text,
    date: Schema.Date,
    surrogate: Schema.Literals(["\uD800", "a\uDC00b", "x\uDBFF"]),
  }),
  /** A secret-looking word. */
  secret: Hidden,
  /** Lines before a fault, the text that breaks a file, and text a literal string can hold. */
  more: Schema.Struct({
    fillers: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
    broken: Schema.Literals(["= oops", "@@@", "x y = 1", "a = = 1"]),
    plain: Schema.String.check(Schema.isPattern(/^[a-z ]{0,6}$/u)),
  }),
});

export type Draw = typeof Draw.Type;

// ---------------------------------------------------------------------------------------------
// Settings: one kind per schema, in four modes.
// ---------------------------------------------------------------------------------------------

const KINDS = [
  "port",
  "rule",
  "count",
  "flag",
  "real",
  "text",
  "texts",
  "grid",
  "rows",
  "rec",
  "tree",
  "shape",
] as const;

type Kind = (typeof KINDS)[number];

const MODES = ["restart", "live", "fileOnly", "required"] as const;

type Mode = (typeof MODES)[number];

interface Options {
  readonly mode?: Mode;
  readonly files?: Setting.Files;
}

/** The value a kind holds in a file before an edit, as the file writes it, and as it reads. */
export const OLD: Readonly<Record<Kind, { readonly raw: string; readonly value: unknown }>> = {
  port: { raw: "4100", value: 4100 },
  rule: { raw: '"robots"', value: "robots" },
  count: { raw: '"5"', value: 5 },
  flag: { raw: "false", value: false },
  real: { raw: "2.5", value: 2.5 },
  text: { raw: '"old"', value: "old" },
  texts: { raw: '["old"]', value: ["old"] },
  grid: { raw: "[[1]]", value: [[1]] },
  rows: { raw: "[{ n = 1 }]", value: [{ n: 1 }] },
  rec: { raw: "{ old = 1 }", value: { old: 1 } },
  tree: { raw: "{ old = { a = 1 } }", value: { old: { a: 1 } } },
  shape: { raw: "{ a = 1 }", value: { a: 1 } },
};

/** What a kind reads as when no file holds it. */
export const FALLBACK: Readonly<Record<Kind, unknown>> = {
  port: 18787,
  rule: "people",
  count: 7,
  flag: false,
  real: 0.5,
  text: "dflt",
  texts: [],
  grid: [],
  rows: [],
  rec: {},
  tree: {},
  shape: {},
};

/** Values that push an edge, as fast-check's `examples` do: a class that is only its drawn value may miss them. */
const EDGES: Readonly<Record<Kind, ReadonlyArray<unknown>>> = {
  port: [1, 65535],
  rule: [],
  count: [0],
  flag: [true],
  real: [1.5, 1e-12, -0],
  text: ['a"b\\c\nd#e=f é雪', ""],
  texts: [[], ["a", "b#c"]],
  grid: [[], [[1, 2], [3]]],
  rows: [[], [{ n: 1, tag: "x" }]],
  rec: [{}, { "a.b": 1, "": 2, 雪: 3 }],
  tree: [{}, { x: { "a.b": 1 } }],
  shape: [{}, { a: 1, b: { c: 2 } }],
};

const dress = (base: Setting.Setting<string, any, false>, options: Options): Setting.Any => {
  const scoped = options.files === undefined ? base : base.pipe(Setting.files(options.files));
  const marked = options.mode === "fileOnly" ? scoped.pipe(Setting.fileOnly) : scoped;

  return options.mode === "live" ? marked.pipe(Setting.live) : marked;
};

const Rows = Schema.Array(Schema.Struct({ n: Small, tag: Schema.optionalKey(Text) }));

const Tree = Schema.Record(KeyText, Schema.Record(KeyText, Small));

const Shape = Schema.Struct({
  a: Schema.optionalKey(Small),
  b: Schema.optionalKey(Schema.Struct({ c: Schema.optionalKey(Small) })),
});

const described = (made: Setting.Setting<string, any, false>, fallback: unknown, options: Options) => {
  const with_ = made.pipe(Setting.withDescription("A generated setting."));

  return dress(options.mode === "required" ? with_ : with_.pipe(Setting.withDefault(fallback)), options);
};

/** A setting of this kind, named `name`. Its default is none for a required one. */
const declare = (kind: Kind, name: string, options: Options = {}): Setting.Any => {
  const fallback = FALLBACK[kind];

  switch (kind) {
    case "port":
      return described(Setting.make(name, Port), fallback, options);
    case "rule":
      return described(Setting.make(name, Rule), fallback, options);
    case "count":
      return described(Setting.make(name, Schema.FiniteFromString), fallback, options);
    case "flag":
      return described(Setting.make(name, Schema.Boolean), fallback, options);
    case "real":
      return described(Setting.make(name, Schema.Finite), fallback, options);
    case "text":
      return described(Setting.make(name, Schema.String), fallback, options);
    case "texts":
      return described(Setting.make(name, Schema.Array(Schema.String)), fallback, options);
    case "grid":
      return described(Setting.make(name, Schema.Array(Schema.Array(Schema.Int))), fallback, options);
    case "rows":
      return described(Setting.make(name, Rows), fallback, options);
    case "rec":
      return described(Setting.make(name, Schema.Record(Schema.String, Schema.Finite)), fallback, options);
    case "tree":
      return described(Setting.make(name, Tree), fallback, options);
    case "shape":
      return described(Setting.make(name, Shape), fallback, options);
  }
};

const makeGroup = (app: string, settings: ReadonlyArray<Setting.Any>) => SettingGroup.make(app, ...settings);

type Group = ReturnType<typeof makeGroup>;

/** The file as a person reads it. */
export const fileName = (app: string, file: Setting.File) =>
  file === "repo" ? `.${app}/${app}.toml` : `~/.${app}/${app}.toml`;

const filePath = (app: string, file: Setting.File) =>
  file === "repo" ? `${ROOT}/.${app}/${app}.toml` : `${HOME}/.${app}/${app}.toml`;

/** The environment variable that sets a setting: `DEMO_INSTANCE_PORT`. */
export const variable = (app: string, name: string) =>
  [app.toUpperCase(), ...name.split(".").map((word) => word.replace(/-/gu, "_").toUpperCase())].join("_");

export const field = (name: string) =>
  (name.split(".").at(-1) ?? name).replace(/-([a-z0-9])/gu, (_, letter: string) => letter.toUpperCase());

// ---------------------------------------------------------------------------------------------
// Text a person types, written without the code under test.
// ---------------------------------------------------------------------------------------------

const isTable = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Predicate.isObject(value) && !Array.isArray(value);

/** A value as TOML text, with inline tables and JSON strings. */
const literal = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(literal).join(", ")}]`;
  }

  if (isTable(value)) {
    const members = Object.entries(value).map(([key, child]) => `${JSON.stringify(key)} = ${literal(child)}`);

    return members.length === 0 ? "{}" : `{ ${members.join(", ")} }`;
  }

  // JSON erases a negative zero: the same TOML number as a whole float.
  return Object.is(value, -0) ? "-0.0" : JSON.stringify(value);
};

/** Whether two values are the same data, as a file reads them: `1.0` is `1`, and `-0` is `0`. */
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/** The line a byte offset sits on, from 1. */
export const lineNumber = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

/** Where the line holding `offset` starts. */
const lineStart = (text: string, offset: number) => text.lastIndexOf("\n", offset - 1) + 1;

// ---------------------------------------------------------------------------------------------
// Marks: private-use characters in a template, read out and removed by `locate`.
// ---------------------------------------------------------------------------------------------

const K = "\uE000";

const VS = "\uE001";

const VE = "\uE002";

const AT = "\uE003";

const CS = "\uE004";

const CE = "\uE005";

const MS = "\uE006";

const ME = "\uE007";

/** In a lead: the file's line break, which is `\n` for a text that holds none to copy. */
const LINE = "\uE008";

interface Range {
  readonly start: number;
  readonly end: number;
}

interface Located {
  readonly text: string;
  /** Where the edited key starts. */
  readonly key: number | undefined;
  /** The old value's range. */
  readonly value: Range | undefined;
  /** Where a new line or member goes, for a key the file lacks. */
  readonly at: number | undefined;
  /** The comments inside the old value. */
  readonly comments: ReadonlyArray<Range>;
  /** The commas that separate the members of the inline table the key sits in. */
  readonly commas: ReadonlyArray<Range>;
}

const locate = (template: string): Located => {
  let text = "";
  const found: Record<string, Array<number>> = {};
  const marks = new Set([K, VS, VE, AT, CS, CE, MS, ME]);

  for (const char of template) {
    if (marks.has(char)) {
      (found[char] ??= []).push(text.length);
    } else {
      text += char;
    }
  }

  const pairs = (open: string, close: string) =>
    (found[open] ?? []).map((start, n) => ({ start, end: found[close]?.[n] ?? start }));

  return {
    text,
    key: found[K]?.[0],
    value: pairs(VS, VE)[0],
    at: found[AT]?.[0],
    comments: pairs(CS, CE),
    commas: pairs(MS, ME),
  };
};

// ---------------------------------------------------------------------------------------------
// Positions: where the edited key sits, or where it would go.
// ---------------------------------------------------------------------------------------------

export type Id =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "x"
  | "y";

export const SET_IDS: ReadonlyArray<Id> = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "y"];

interface Names {
  /** The edited setting's name, as words. */
  readonly path: ReadonlyArray<string>;
  /** Its table. */
  readonly tp: ReadonlyArray<string>;
  readonly key: string;
  readonly other: ReadonlyArray<string>;
  readonly extra: ReadonlyArray<string>;
  readonly later: ReadonlyArray<string>;
  readonly deep: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<string>;
}

/** The names of the edited setting and its neighbors, from one drawn word. `three` makes the edited name three words. */
const namesFor = (w: string, three: boolean): Names => {
  const path = three ? [w, `${w}s`, `${w}k`] : [w, `${w}k`];
  const tp = path.slice(0, -1);

  return {
    path,
    tp,
    key: `${w}k`,
    other: [...tp, `${w}o`],
    extra: [...tp, `${w}x`],
    later: [`${w}t`, `${w}p`],
    deep: [...tp, `${w}d`, `${w}l`],
    rows: [...tp, `${w}r`],
  };
};

type Neighbor = "other" | "extra" | "later" | "deep" | "rows";

const NEIGHBOR_KIND: Readonly<Record<Neighbor, Kind>> = {
  other: "port",
  extra: "port",
  later: "rule",
  deep: "port",
  rows: "rows",
};

/** What one place of a key is: built once, then edited as a set or a removal. */
export interface Position {
  readonly ids: ReadonlyArray<Id>;
  readonly app: string;
  readonly kind: Kind;
  readonly mode: Mode;
  readonly names: Names;
  readonly file: Setting.File;
  readonly neighbors: ReadonlyArray<Neighbor>;
  readonly located: Located;
  readonly eol: string;
  /** For a key the file lacks: the text the new text starts with. */
  readonly lead: string;
  /** Whether the new text goes inside an inline table. */
  readonly inline: boolean;
  /** What the key reads as before the edit, when the file holds it. */
  readonly old: unknown;
}

export const targetSetting = (p: Position, mode: Mode = p.mode) => declare(p.kind, p.names.path.join("."), { mode });

const settingsFor = (p: Position, mode: Mode = p.mode): ReadonlyArray<Setting.Any> => [
  targetSetting(p, mode),
  ...p.neighbors.map((n) => declare(NEIGHBOR_KIND[n], p.names[n].join("."))),
];

export const groupFor = (p: Position, mode: Mode = p.mode) => makeGroup(p.app, settingsFor(p, mode));

interface Context {
  readonly r: Names;
  readonly s: Style;
  readonly old: string;
  readonly E: string;
  readonly G: string;
}

const body = (c: Context, lines: ReadonlyArray<string>) => lines.join(c.E) + (c.s.final ? c.E : "");

const header = (path: ReadonlyArray<string>) => `[${path.join(".")}]`;

const banner = (c: Context): ReadonlyArray<string> => (c.s.banner ? ["# banner one", "# banner two", ""] : []);

const above = (c: Context): ReadonlyArray<string> => (c.s.above ? ["# above the key"] : []);

const blanks = (c: Context): ReadonlyArray<string> => Array.from({ length: c.s.blanks }, () => "");

const line = (c: Context, name: ReadonlyArray<string>, raw: string) => `${name.at(-1)}${c.G}${raw}`;

/** The lines of a neighbor: a setting of the same table, a later table, a deeper header, an array of tables. */
const neighbor = (c: Context, which: Neighbor): ReadonlyArray<string> => {
  const r = c.r;

  switch (which) {
    case "other":
      return [line(c, r.other, "7")];
    case "extra":
      return [line(c, r.extra, "8")];
    case "later":
      return [header(r.later.slice(0, -1)), line(c, r.later, '"robots"')];
    case "deep":
      return [header(r.deep.slice(0, -1)), line(c, r.deep, "9")];
    case "rows":
      return [`[[${r.rows.join(".")}]]`, `n${c.G}1`];
  }
};

interface Built {
  readonly template: string;
  readonly neighbors: ReadonlyArray<Neighbor>;
  readonly ids: ReadonlyArray<Id>;
  readonly lead?: string;
  readonly inline?: boolean;
  /** The old value, when it is not the kind's own. */
  readonly old?: unknown;
}

const keyed = (c: Context, key: string) => `${K}${key}${c.G}${VS}${c.old}${VE}${c.s.tail}`;

/** The block of comment and blank lines that ends a section, with the place a new line goes in front of it. */
const closing = (c: Context): ReadonlyArray<string> => {
  const block = [...blanks(c), "# a note after the table"];

  return [`${AT}${block[0]}`, ...block.slice(1)];
};

/** The new header and the key under it, as a new line starts. */
const heading = (c: Context) => `${header(c.r.tp)}${LINE}${c.r.key} = `;

const builders = {
  // (a) the key under its table's header, then the neighbors a draw asks for.
  under: (c: Context, after: ReadonlyArray<Neighbor>, ids: ReadonlyArray<Id>): Built => ({
    template: body(c, [
      ...banner(c),
      header(c.r.tp),
      ...above(c),
      keyed(c, c.r.key),
      ...blanks(c),
      ...after.flatMap((which) => neighbor(c, which)),
    ]),
    neighbors: after,
    ids,
  }),

  // (b) a dotted key, at the root.
  dottedRoot: (c: Context): Built => ({
    template: body(c, [keyed(c, c.r.path.join(".")), ...neighbor(c, "later")]),
    neighbors: ["later"],
    ids: ["b"],
  }),

  // (b) a dotted key under a header, the table's own word left off.
  dottedUnder: (c: Context): Built => ({
    template: body(c, [header(c.r.path.slice(0, 1)), keyed(c, c.r.path.slice(1).join(".")), ...neighbor(c, "later")]),
    neighbors: ["later"],
    ids: ["b"],
  }),

  // (c) a member of an inline table: first, middle or last.
  inline: (c: Context, at: "first" | "middle" | "last"): Built => {
    const table = c.r.tp.at(-1) ?? "";
    const first = `${c.r.other.at(-1)} = 7`;
    const last = `${c.r.extra.at(-1)} = 8`;
    const own = `${K}${c.r.key}${c.G}${VS}${c.old}${VE}`;
    const comma = `${MS},${ME}`;

    // The edited key is the first, the middle or the last of three members.
    const [one, two, three] = { first: [own, first, last], middle: [first, own, last], last: [first, last, own] }[at];
    const members = `${one}${comma} ${two}${comma} ${three}`;

    return {
      template: body(c, [`${table}${c.G}{ ${members} }${c.s.tail}`]),
      neighbors: ["other", "extra"],
      ids: ["c"],
    };
  },

  // (c) one inline table inside another.
  nested: (c: Context): Built => ({
    template: body(c, [
      `${c.r.path[0]}${c.G}{ ${c.r.path[1]}${c.G}{ ${K}${c.r.key}${c.G}${VS}${c.old}${VE} } }${c.s.tail}`,
      ...neighbor(c, "later"),
    ]),
    neighbors: ["later"],
    ids: ["c"],
  }),

  // (c) a key the file lacks, with its inline table there: a member goes before the closing brace.
  inlineAbsent: (c: Context): Built => ({
    template: body(c, [`${c.r.tp.at(-1)}${c.G}{ ${c.r.other.at(-1)} = 7 ${AT}}${c.s.tail}`]),
    neighbors: ["other"],
    lead: `, ${c.r.key} = `,
    inline: true,
    ids: ["c"],
  }),

  // (d) a key the file lacks, its table there: a key, a comment, a later table.
  missing: (c: Context, ids: ReadonlyArray<Id>): Built => ({
    template: body(c, [
      ...banner(c),
      header(c.r.tp),
      ...above(c),
      line(c, c.r.other, "7"),
      ...closing(c),
      ...neighbor(c, "later"),
    ]),
    neighbors: ["other", "later"],
    lead: `${c.r.key} = `,
    ids,
  }),

  // (d) the same, the last table of the file: the line goes at the end of the text.
  lastTable: (c: Context, ids: ReadonlyArray<Id>): Built => ({
    template: `${[...banner(c), header(c.r.tp), line(c, c.r.other, "7"), "# the last note"].join(c.E)}${c.s.final ? c.E : ""}${AT}`,
    neighbors: ["other"],
    lead: `${c.r.key} = `,
    ids,
  }),

  // (e) a key the file lacks, with no table: an empty file, a comment-only file, and a file with no final line break.
  empty: (c: Context): Built => ({ template: AT, neighbors: [], lead: heading(c), ids: ["e"] }),

  commentOnly: (c: Context): Built => ({
    template: `# only a note${c.s.final ? c.E : ""}${AT}`,
    neighbors: [],
    lead: heading(c),
    ids: ["e"],
  }),

  noBreak: (c: Context): Built => ({
    template: `${neighbor(c, "later").join(c.E)}${AT}`,
    neighbors: ["later"],
    lead: heading(c),
    ids: ["e"],
  }),

  // (f) quoted key spellings, and a header with spaces.
  quotedRoot: (c: Context): Built => ({
    template: body(c, [keyed(c, c.r.path.map((word) => `"${word}"`).join(".")), ...neighbor(c, "later")]),
    neighbors: ["later"],
    ids: ["f"],
  }),

  literalRoot: (c: Context): Built => ({
    template: body(c, [keyed(c, [`'${c.r.path[0]}'`, ...c.r.path.slice(1)].join(".")), ...neighbor(c, "later")]),
    neighbors: ["later"],
    ids: ["f"],
  }),

  spaced: (c: Context): Built => ({
    template: body(c, [
      `[ ${c.r.tp.map((word) => `"${word}"`).join(" . ")} ]`,
      keyed(c, c.r.key),
      ...neighbor(c, "later"),
    ]),
    neighbors: ["later"],
    ids: ["f"],
  }),

  spacedAbsent: (c: Context): Built => ({
    template: body(c, [
      `[ ${c.r.tp.map((word) => `"${word}"`).join(" . ")} ]`,
      line(c, c.r.other, "7"),
      `${AT}${neighbor(c, "later")[0]}`,
      ...neighbor(c, "later").slice(1),
    ]),
    neighbors: ["other", "later"],
    lead: `${c.r.key} = `,
    ids: ["f"],
  }),

  // (g) a comment inside a multi-line array value.
  inArray: (c: Context): Built => ({
    template: body(c, [
      header(c.r.tp),
      `${K}${c.r.key}${c.G}${VS}[`,
      `  "a", ${CS}# first${CE}`,
      `  "b" ${CS}# second${CE}`,
      `]${VE}${c.s.tail}`,
      ...neighbor(c, "later"),
    ]),
    neighbors: ["later"],
    ids: ["g"],
    old: ["a", "b"],
  }),

  // (i) a deeper header, or an array of tables, right after the table: the line goes before it.
  before: (c: Context, which: "deep" | "rows"): Built => ({
    template: body(c, [
      header(c.r.tp),
      line(c, c.r.other, "7"),
      `${AT}${neighbor(c, which)[0]}`,
      ...neighbor(c, which).slice(1),
    ]),
    neighbors: ["other", which],
    lead: `${c.r.key} = `,
    ids: ["i"],
  }),
};

export type Draws = Draw;

const MODE_AT = (n: number): Mode => MODES[n % MODES.length] ?? "restart";

/** The kinds a value class (j), (k) or (l) is about. */
const VALUE_CLASS: Readonly<Record<Kind, Id>> = {
  port: "j",
  rule: "j",
  count: "j",
  flag: "j",
  real: "j",
  text: "j",
  texts: "k",
  grid: "k",
  rows: "k",
  rec: "l",
  tree: "l",
  shape: "l",
};

interface Plan {
  readonly build: (c: Context) => Built;
  readonly three?: boolean;
  readonly kind?: Kind;
  readonly style?: Style;
  /** The old value's text, when it is not the kind's own, and what it reads as. */
  readonly raw?: string;
  readonly value?: unknown;
}

/** Turns a plan into a position: its names, its style and its kind cycled from the draw. */
const place = (draw: Draws, n: number, plan: Plan, extra: ReadonlyArray<Id> = []): Position => {
  const kind = plan.kind ?? KINDS[n % KINDS.length] ?? "port";
  const r = namesFor(draw.w, plan.three ?? n % 2 === 0);
  const s = plan.style ?? draw.styles[n % 3] ?? draw.styles[0];
  const c: Context = { r, s, old: plan.raw ?? OLD[kind].raw, E: s.eol, G: s.gap };
  const built = plan.build(c);
  const located = locate(built.template);
  const eol = /\r?\n/u.exec(located.text)?.[0] ?? "\n";

  return {
    ids: [...built.ids, ...extra],
    app: draw.app,
    kind,
    mode: MODE_AT(n),
    names: r,
    file: n % 5 === 0 ? (draw.file === "repo" ? "user" : "repo") : draw.file,
    neighbors: built.neighbors,
    located,
    eol,
    lead: (built.lead ?? "").replaceAll(LINE, eol),
    inline: built.inline ?? false,
    old: built.old ?? plan.value ?? OLD[kind].value,
  };
};

const patch = (draw: Draws, index: number, change: Partial<Style>): Style => ({
  ...(draw.styles[index] ?? draw.styles[0]),
  ...change,
});

const plans = (draw: Draws): ReadonlyArray<Plan> => {
  const plain = patch(draw, 0, { eol: "\n", final: true, above: false, banner: false, blanks: 0, tail: "" });
  const b = builders;

  return [
    // (a)
    { build: (c) => b.under(c, [], ["a"]) },
    { build: (c) => b.under(c, ["other"], ["a"]), three: false },
    { build: (c) => b.under(c, ["other", "later"], ["a", "i"]) },
    { build: (c) => b.under(c, ["deep"], ["a", "i"]) },
    { build: (c) => b.under(c, ["rows"], ["a", "i"]) },
    // (b)
    { build: b.dottedRoot, three: false },
    { build: b.dottedRoot, three: true },
    { build: b.dottedUnder, three: true },
    // (c)
    { build: (c) => b.inline(c, "first"), three: false },
    { build: (c) => b.inline(c, "middle"), three: false },
    { build: (c) => b.inline(c, "last"), three: false },
    { build: b.nested, three: true },
    { build: b.inlineAbsent, three: false },
    // (d)
    { build: (c) => b.missing(c, ["d"]), three: false },
    { build: (c) => b.missing(c, ["d"]), three: true },
    { build: (c) => b.lastTable(c, ["d"]), three: false },
    { build: (c) => b.lastTable(c, ["d"]), three: true },
    // (e)
    { build: b.empty, three: false },
    { build: b.empty, three: true },
    { build: b.commentOnly, three: false },
    { build: b.noBreak, three: false },
    { build: b.noBreak, three: true },
    // (f)
    { build: b.quotedRoot, three: false },
    { build: b.literalRoot, three: false },
    { build: b.spaced, three: false },
    { build: b.spacedAbsent, three: false },
    // (g)
    ...([" # tail", "   # tail", "\t# tail"] as const).map((tail): Plan => ({
      build: (c) => b.under(c, ["later"], ["g"]),
      style: patch(draw, 1, { tail }),
    })),
    { build: (c) => b.under(c, ["later"], ["g"]), style: patch(draw, 2, { above: true, banner: true }) },
    { build: b.inArray, three: false, kind: "texts" },
    // (h)
    ...(["\n", "\r\n"] as const).flatMap((eol): ReadonlyArray<Plan> => [
      { build: (c) => b.missing(c, ["d", "h"]), three: false, style: patch(draw, 0, { eol, final: true }) },
      { build: (c) => b.lastTable(c, ["d", "h"]), three: false, style: patch(draw, 1, { eol, final: false }) },
    ]),
    { build: (c) => b.under(c, ["other", "later"], ["a", "h"]), style: plain },
    // (i)
    { build: (c) => b.missing(c, ["d", "i"]), three: false },
    { build: (c) => b.before(c, "deep"), three: false },
    { build: (c) => b.before(c, "rows"), three: false },
  ];
};

/**
 * Every place a key sits, once each, with a kind, a mode, a file and a style cycled from the draw. `ids` names the classes it reaches.
 */
export const positions = (draw: Draws): ReadonlyArray<Position> =>
  plans(draw).map((plan, n) => place(draw, n + 1, plan));

/** A key set in each kind: the key exists, and the key is missing, so the value is written both ways. Reaches (j), (k) and (l). */
export const valued = (draw: Draws): ReadonlyArray<Position> =>
  KINDS.flatMap((kind, n) => [
    place(draw, n, { build: (c) => builders.under(c, [], ["a"]), kind, style: draw.styles[0] }, [VALUE_CLASS[kind]]),
    place(draw, n, { build: (c) => builders.missing(c, ["d"]), kind, three: false, style: draw.styles[1] }, [
      VALUE_CLASS[kind],
    ]),
  ]);

/** The values a position is set to: the kind's drawn one first, then its edges. */
export const valuesFor = (draw: Draws, p: Position): ReadonlyArray<unknown> => {
  const drawn = draw.values[p.kind];
  const own = p.ids.some((id) => id === "j" || id === "k" || id === "l");
  const base = draw.values.texts;

  // An array of 60 items: the drawn items again, or one letter when none were drawn.
  const sixty =
    p.kind === "texts" && own ? [Array.from({ length: 60 }, (_, n) => base[n % Math.max(1, base.length)] ?? "x")] : [];

  // A record of 60 keys and a table of 8 records of 8 keys: the width the drawn records once had, in one case in place of
  // every case. The keys are distinct and in a record key's alphabet: `aa`, `ab`, ... `ba`, ...
  const keys = (count: number) =>
    Array.from(
      { length: count },
      (_, n) => `${String.fromCharCode(97 + Math.floor(n / 26))}${String.fromCharCode(97 + (n % 26))}`,
    );

  const wide = (names: ReadonlyArray<string>, make: (n: number) => unknown) =>
    Object.fromEntries(names.map((name, n) => [name, make(n)]));

  const broad =
    own && p.kind === "rec"
      ? [wide(keys(60), (n) => n)]
      : own && p.kind === "tree"
        ? [wide(keys(8), () => wide(keys(8), (n) => n))]
        : [];

  return [drawn, ...(own ? [...EDGES[p.kind], ...sixty, ...broad] : [])];
};

// ---------------------------------------------------------------------------------------------
// What the answer must be.
// ---------------------------------------------------------------------------------------------

/** The old text, cut where the new bytes go: the answer starts with `pre`, ends with `post`, and holds the new text between. */
interface Splice {
  readonly pre: string;
  readonly post: string;
  /** What the new text starts with, before the value's own text. */
  readonly lead: string;
  /** Where the key starts, in the answer. */
  readonly key: number;
}

/** What a set must answer: the old text again, or its splice. */
export const spliceFor = (p: Position, value: unknown): Splice | "same" => {
  const { text, key, value: range, at, comments } = p.located;

  if (range !== undefined && key !== undefined) {
    if (same(p.old, value)) {
      return "same";
    }

    // A comment inside the old value moves to the line above the key, one per line.
    const start = lineStart(text, key);
    const kept = comments.map((comment) => text.slice(comment.start, comment.end) + p.eol).join("");

    return {
      pre: text.slice(0, start) + kept + text.slice(start, range.start),
      post: text.slice(range.end),
      lead: "",
      key: key + kept.length,
    };
  }

  const place = at ?? 0;

  if (p.inline) {
    return { pre: text.slice(0, place), post: text.slice(place), lead: p.lead, key: place };
  }

  // A new line starts on a line of its own, and ends with the file's break unless the text ended without one.
  const before = place > 0 && text[place - 1] !== "\n" ? p.eol : "";
  const after = place < text.length || text.endsWith("\n") ? p.eol : "";

  return {
    pre: text.slice(0, place) + before,
    post: after + text.slice(place),
    lead: p.lead,
    key: place + before.length + p.lead.lastIndexOf(`${p.names.key} = `),
  };
};

/** The new text of an answer: what lies between the bytes kept before it and after it. */
export const middle = (answer: string, splice: Splice) =>
  answer.slice(splice.pre.length, answer.length - splice.post.length);

/** What a removal must answer, for a key the file holds: the old text without that assignment (and its comma). */
export const removed = (p: Position): string | undefined => {
  const { text, key, value, comments, commas } = p.located;

  if (key === undefined || value === undefined) {
    return undefined;
  }

  const comma = commas.find((c) => c.start >= value.end) ?? commas.findLast((c) => c.end <= key);

  const cuts = [{ start: key, end: value.end }, ...(comma === undefined ? [] : [comma])].sort(
    (a, b) => a.start - b.start,
  );

  let out = "";
  let cursor = 0;

  for (const cut of cuts) {
    out += text.slice(cursor, cut.start);
    cursor = cut.end;
  }

  out += text.slice(cursor);

  // A comment inside the removed value stays, on the line the key was on.
  const start = lineStart(text, key);
  const kept = comments.map((comment) => text.slice(comment.start, comment.end) + p.eol).join("");
  const moved = out.slice(0, start) + kept + out.slice(start);

  // A removed last line must not leave a final line break the text never had.
  return !text.endsWith("\n") && moved.endsWith("\n") ? `${moved} ` : moved;
};

// ---------------------------------------------------------------------------------------------
// Running an edit, and reading a file back.
// ---------------------------------------------------------------------------------------------

/** What a set or a remove left: the new text, or the error's parts. `printed` is every text the failure can print, its cause included, and what a structured logger would walk: every own property of the cause, to the bottom. */
export const Outcome = Schema.TaggedUnion({
  text: { text: Schema.String },
  error: {
    reason: Schema.String,
    file: Schema.UndefinedOr(Schema.String),
    line: Schema.UndefinedOr(Schema.Int),
    message: Schema.String,
    printed: Schema.String,
  },
});

export type Outcome = typeof Outcome.Type;

const outcome = (exit: Exit.Exit<string, unknown>): Outcome => {
  if (Exit.isSuccess(exit)) {
    return Outcome.cases.text.make({ text: exit.value });
  }

  const errors = exit.cause.reasons.flatMap((reason) => (reason._tag === "Fail" ? [reason.error] : []));
  const error = errors[0];

  // One edit, one error: never two, and never a defect beside it.
  expect(exit.cause.reasons).toHaveLength(1);
  expect(error).toBeInstanceOf(SettingGroup.SettingsError);

  return Schema.is(SettingGroup.SettingsError)(error)
    ? Outcome.cases.error.make({
        reason: error.reason,
        file: error.file,
        line: error.line,
        message: error.message,
        printed: [
          Cause.pretty(exit.cause),
          error.message,
          String(error.cause),
          inspect(error, { depth: null, customInspect: false, showHidden: true }),
        ].join("\n"),
      })
    : Outcome.cases.error.make({
        reason: "not a SettingsError",
        file: undefined,
        line: undefined,
        message: "",
        printed: "",
      });
};

export const doSet = (group: Group, text: string, file: Setting.File, setting: Setting.Any, value: unknown) =>
  Effect.map(Effect.exit(SettingGroup.edit(group, text, file).set(setting, value)), outcome);

export const doRemove = (group: Group, text: string, file: Setting.File, setting: Setting.Any) =>
  Effect.map(Effect.exit(SettingGroup.edit(group, text, file).remove(setting)), outcome);

export const mustText = (found: Outcome): string => {
  expect(found._tag === "text" ? "text" : `${found.reason}: ${found.message}`).toBe("text");

  return found._tag === "text" ? found.text : "";
};

export interface Files {
  readonly repo?: string;
  readonly user?: string;
}

/** The start over files in memory: the values, the origins and the one error, if any. */
export const startOn = (group: Group, app: string, files: Files) =>
  Effect.gen(function* () {
    const exit = yield* Effect.gen(function* () {
      const values = yield* group;
      const origins = yield* SettingGroup.origins(group);

      return { values, origins };
    }).pipe(Effect.provide(SettingGroup.layer(group, { version: VERSION, repo: ROOT })), Effect.exit);

    return exit;
  }).pipe(
    Effect.provide(
      Layer.merge(
        MemoryFiles.layer({ files: disk(app, files) }),
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME } })),
      ),
    ),
  );

const disk = (app: string, files: Files): Readonly<Record<string, string>> => ({
  ...(files.repo === undefined ? {} : { [filePath(app, "repo")]: files.repo }),
  ...(files.user === undefined ? {} : { [filePath(app, "user")]: files.user }),
});

// ---------------------------------------------------------------------------------------------
// The other classes: files that must be refused, or must come back as they were.
// ---------------------------------------------------------------------------------------------

const FILES: ReadonlyArray<Setting.File> = ["repo", "user"];

export const otherFile = (file: Setting.File): Setting.File => (file === "repo" ? "user" : "repo");

/** One file's names, style and context, for a scene of its own. */
const frame = (draw: Draws, n: number, three = false, kind: Kind = "port") => {
  const r = namesFor(draw.w, three);
  const s = draw.styles[n % 3] ?? draw.styles[0];
  const c: Context = { r, s, old: OLD[kind].raw, E: s.eol, G: s.gap };

  return { r, s, c };
};

const fillers = (draw: Draws): ReadonlyArray<string> =>
  Array.from({ length: draw.more.fillers }, (_, n) => `# filler ${n}`);

/** A group of the target and the neighbors a scene's file names. */
const sceneGroup = (draw: Draws, target: Setting.Any, ...others: ReadonlyArray<Setting.Any>) =>
  makeGroup(draw.app, [target, ...others]);

interface Scene {
  readonly app: string;
  readonly group: Group;
  readonly target: Setting.Any;
  readonly file: Setting.File;
  readonly text: string;
}

/** (n) A setting that may not be set in this file: its scope holds the other one. */
interface Scoped extends Scene {
  readonly scope: ReadonlyArray<Setting.File>;
  readonly fileOnly: boolean;
  readonly present: boolean;
}

export const scoped = (draw: Draws): ReadonlyArray<Scoped> =>
  FILES.flatMap((file) =>
    [false, true].flatMap((fileOnly) =>
      [false, true].map((present, n) => {
        const { r, c } = frame(draw, n + (fileOnly ? 1 : 0));
        const scope: ReadonlyArray<Setting.File> = [otherFile(file)];

        const target = declare("port", r.path.join("."), {
          mode: fileOnly ? "fileOnly" : "restart",
          files: [otherFile(file)],
        });

        const other = declare("port", r.other.join("."));
        // The key is in the file it may not be set in, or it is not.
        const lines = present ? [header(r.tp), `${r.key}${c.G}${c.old}`] : [header(r.tp), line(c, r.other, "7")];

        return {
          app: draw.app,
          group: sceneGroup(draw, target, other),
          target,
          file,
          text: body(c, lines),
          scope,
          fileOnly,
          present,
        };
      }),
    ),
  );

/** (o) A value the schema refuses, or the format cannot write. */
interface Refused extends Scene {
  readonly value: unknown;
  readonly present: boolean;
}

export const refused = (draw: Draws): ReadonlyArray<Refused> => {
  const bads: ReadonlyArray<readonly [Kind, unknown]> = [
    ["port", draw.bad.port],
    ["port", draw.bad.text],
    ["text", draw.bad.date],
    ["text", draw.bad.surrogate],
  ];

  return bads.flatMap(([kind, value], n) =>
    [false, true].map((present) => {
      const { r, c } = frame(draw, n, n % 2 === 0, kind);
      const target = declare(kind, r.path.join("."));
      const other = declare("port", r.other.join("."));

      const lines = present
        ? [header(r.tp), `${r.key}${c.G}${c.old}`, line(c, r.other, "7")]
        : [header(r.tp), line(c, r.other, "7")];

      return {
        app: draw.app,
        group: sceneGroup(draw, target, other),
        target,
        file: n % 3 === 0 ? otherFile(draw.file) : draw.file,
        text: body(c, lines),
        value,
        present,
      };
    }),
  );
};

/** (p) A fault elsewhere in the file: the reason, and the line it sits on in the input. */
interface Faulty extends Scene {
  readonly fault: "near" | "far" | "scope" | "bad" | "table" | "version";
  readonly side: "before" | "after";
  readonly reason: "unknown" | "scope" | "invalid";
  readonly line: number;
  readonly value: unknown;
}

export const faulty = (draw: Draws): ReadonlyArray<Faulty> => {
  const faults = ["near", "far", "scope", "bad", "table", "version"] as const;

  return faults.flatMap((fault, f) =>
    (["before", "after"] as const).flatMap((side, n): ReadonlyArray<Faulty> => {
      // A root key cannot follow a table's header: the version's fault sits only before it.
      if (fault === "version" && side === "after") {
        return [];
      }

      const file = FILES[(f + n) % 2] ?? "repo";
      const { r, c } = frame(draw, f + n);
      const later = r.later;
      const target = declare("port", r.path.join("."));
      const other = declare("port", r.other.join("."));
      const rule = declare("rule", later.join("."), fault === "scope" ? { files: [otherFile(file)] } : {});

      const key = later.at(-1);

      const block: ReadonlyArray<string> = {
        near: [header(later.slice(0, -1)), `${K}${key}z${c.G}1`],
        far: [header(later.slice(0, -1)), `${K}qqqqzz${c.G}1`],
        scope: [header(later.slice(0, -1)), `${K}${key}${c.G}"robots"`],
        bad: [header(later.slice(0, -1)), `${K}${key}${c.G}12`],
        table: [`${K}${header(later)}`, `x${c.G}1`],
        version: [`${K}${draw.app}-version${c.G}${file === "repo" ? '"not a version"' : '"1.0.0"'}`],
      }[fault];

      // The minimum version may not be set in the user file at all: that is a scope fault, not a bad version.
      const reasons: Record<Faulty["fault"], Faulty["reason"]> = {
        near: "unknown",
        far: "unknown",
        scope: "scope",
        bad: "invalid",
        table: "invalid",
        version: file === "user" ? "scope" : "invalid",
      };

      const mine = [header(r.tp), line(c, r.other, "7")];
      const located = locate(body(c, side === "before" ? [...block, ...mine] : [...mine, ...block]));

      return [
        {
          app: draw.app,
          group: sceneGroup(draw, target, other, rule),
          target,
          file,
          text: located.text,
          fault,
          side,
          reason: reasons[fault],
          line: lineNumber(located.text, located.key ?? 0),
          value: draw.values.port,
        },
      ];
    }),
  );
};

/** (p) A plain value where the edited key's table goes, at each depth of the key's path. */
interface Flat extends Scene {
  readonly depth: number;
  readonly kind: (typeof FLAT_KINDS)[number];
  readonly value: unknown;
}

const FLAT_KINDS = ["integer", "float", "text", "boolean", "array"] as const;

export const flat = (draw: Draws): ReadonlyArray<Flat> =>
  [false, true].flatMap((three) =>
    FLAT_KINDS.flatMap((kind, k) =>
      Array.from({ length: three ? 2 : 1 }, (_, n) => n + 1).map((depth): Flat => {
        const { r, c } = frame(draw, k + depth, three);
        const raw = { integer: "5", float: "1.5", text: '"x"', boolean: "true", array: "[1, 2]" }[kind];
        const above = r.path.slice(0, depth);

        // A plain value stands where a table goes: a root key at depth 1, a key under its parent's header deeper.
        const lines =
          depth === 1
            ? [`${K}${above[0]}${c.G}${raw}`]
            : [`[${above.slice(0, -1).join(".")}]`, `${K}${above.at(-1)}${c.G}${raw}`];

        const located = locate(body(c, [...fillers(draw), ...lines]));
        const target = declare("port", r.path.join("."));

        return {
          app: draw.app,
          group: sceneGroup(draw, target, declare("port", r.other.join("."))),
          target,
          file: FILES[(k + depth) % 2] ?? "repo",
          text: located.text,
          depth,
          kind,
          value: draw.values.port,
        };
      }),
    ),
  );

/** What a start over the file refuses with, as the edit must refuse: the reason, the file and the line. */
export const startRefusal = (exit: Exit.Exit<unknown, unknown>) => {
  const errors = Exit.isFailure(exit)
    ? exit.cause.reasons.flatMap((reason) => (reason._tag === "Fail" ? [reason.error] : []))
    : [];

  const error = errors[0];

  return Schema.is(SettingGroup.SettingsError)(error)
    ? { reason: error.reason, file: error.file, line: error.line }
    : undefined;
};

/** (q) A fault at the edited setting itself: a bad old value, as a position the set and the remove can both read. */
export const ownFaults = (draw: Draws): ReadonlyArray<Position> => {
  const olds: ReadonlyArray<readonly [Kind, string, unknown]> = [
    ["port", '"x"', "x"],
    ["port", "70000", 70000],
    ["port", "{ a = 1 }", { a: 1 }],
    ["text", "[1, 2]", [1, 2]],
  ];

  return olds.map(([kind, raw, value], n) =>
    place(draw, n + 1, { build: (c) => builders.under(c, ["other"], ["q"]), kind, three: n % 2 === 1, raw, value }),
  );
};

/** (r) Text that is not TOML, broken on a line before the key and on a line after it. */
interface Broken extends Scene {
  readonly line: number;
}

export const broken = (draw: Draws): ReadonlyArray<Broken> =>
  (["before", "after"] as const).map((side, n) => {
    const { r, c } = frame(draw, n, n === 1);
    const target = declare("port", r.path.join("."));
    const key = `${r.key}${c.G}${c.old}`;

    const lines = [
      ...fillers(draw),
      ...(side === "before" ? [`${K}${draw.more.broken}`] : []),
      header(r.tp),
      key,
      ...(side === "after" ? [`${K}${draw.more.broken}`] : []),
    ];

    const located = locate(body(c, lines));

    return {
      app: draw.app,
      group: sceneGroup(draw, target),
      target,
      file: draw.file,
      text: located.text,
      line: lineNumber(located.text, located.key ?? 0),
    };
  });

/** (s) A key that is not one key here: a record setting under its own header, as dotted sub-keys, and as an array of tables. */
interface Tabled extends Scene {
  readonly line: number;
  readonly value: unknown;
}

export const tabled = (draw: Draws): ReadonlyArray<Tabled> =>
  [false, true].flatMap((three, t) =>
    (["header", "dotted", "root", "array"] as const).map((form, n) => {
      const { r, c } = frame(draw, n + t, three, "rec");
      const target = declare("rec", r.path.join("."));
      const path = r.path.join(".");

      const lines = {
        header: [`${K}[${path}]`, `a${c.G}1`],
        dotted: [header(r.tp), `${K}${r.key}.a${c.G}1`],
        root: [`${K}${path}.a${c.G}1`],
        array: [`${K}[[${path}]]`, `a${c.G}1`],
      }[form];

      const located = locate(body(c, [...fillers(draw), ...lines]));

      return {
        app: draw.app,
        group: sceneGroup(draw, target),
        target,
        file: draw.file,
        text: located.text,
        line: lineNumber(located.text, located.key ?? 0),
        value: draw.values.rec,
      };
    }),
  );

/** How a kind's value is written in a file: the same value, by the fixture writer (a number-as-text setting writes text). */
const fileForm = (kind: Kind, value: unknown) => (kind === "count" ? literal(String(value)) : literal(value));

/** (m) The value the file already holds: the same text, `1.0` for 1, and `'x'` for `"x"`. */
export const unchanged = (draw: Draws): ReadonlyArray<Position> => [
  ...KINDS.map((kind, n) =>
    place(draw, n + 1, {
      build: (c) => builders.under(c, ["later"], ["m"]),
      kind,
      raw: fileForm(kind, draw.values[kind]),
      value: draw.values[kind],
    }),
  ),
  ...[1, draw.values.port].map((port, n) =>
    place(draw, n + 20, {
      build: (c) => builders.under(c, ["later"], ["m"]),
      kind: "port",
      raw: `${port}.0`,
      value: port,
    }),
  ),
  place(draw, 30, {
    build: (c) => builders.under(c, ["later"], ["m"]),
    kind: "text",
    raw: `'${draw.more.plain}'`,
    value: draw.more.plain,
  }),
];

/** Every forms a secret takes in text: raw, JSON-escaped and URL-encoded. */
export const forms = (secret: string) => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];

/** (x) A secret-looking value, in each place a refusal could name it. */
interface Hiding extends Scene {
  readonly name: string;
  readonly value: unknown;
}

export const hiding = (draw: Draws): ReadonlyArray<Hiding> => {
  const secret = draw.secret;
  const quoted = JSON.stringify(secret);

  const make = (
    name: string,
    n: number,
    build: (
      r: Names,
      c: Context,
    ) => { text: string; target: Setting.Any; others: ReadonlyArray<Setting.Any>; value: unknown; file?: Setting.File },
  ): Hiding => {
    const { r, c } = frame(draw, n, n % 2 === 0);
    const made = build(r, c);

    return {
      name,
      app: draw.app,
      group: sceneGroup(draw, made.target, ...made.others),
      target: made.target,
      file: made.file ?? draw.file,
      text: made.text,
      value: made.value,
    };
  };

  return [
    // the set value, accepted, and the file refused for its file scope
    make("scope", 1, (r, c) => ({
      target: declare("text", r.path.join("."), { files: [otherFile(draw.file)] }),
      others: [declare("port", r.other.join("."))],
      text: body(c, [header(r.tp), line(c, r.other, "7")]),
      value: secret,
    })),
    // the set value, refused
    make("invalid", 2, (r, c) => ({
      target: declare("port", r.path.join(".")),
      others: [declare("port", r.other.join("."))],
      text: body(c, [header(r.tp), line(c, r.other, "7")]),
      value: secret,
    })),
    // a record whose member is refused, the secret being the member's key: the schema's own message names the path
    make("refused", 7, (r, c) => ({
      target: declare("rec", r.path.join(".")),
      others: [declare("port", r.other.join("."))],
      text: body(c, [header(r.tp), line(c, r.other, "7")]),
      value: { [secret]: "not a number" },
    })),
    // another key's value, refused
    make("other", 3, (r, c) => ({
      target: declare("text", r.path.join(".")),
      others: [declare("rule", r.later.join("."))],
      text: body(c, [header(r.later.slice(0, -1)), line(c, r.later, quoted)]),
      value: secret,
    })),
    // an unknown key's value
    make("unknown", 4, (r, c) => ({
      target: declare("text", r.path.join(".")),
      others: [declare("port", r.other.join("."))],
      text: body(c, [header(r.tp), `qqqqzz${c.G}${quoted}`]),
      value: secret,
    })),
    // the minimum version's value
    make("version", 5, (r, c) => ({
      target: declare("text", r.path.join(".")),
      others: [declare("port", r.other.join("."))],
      text: body(c, [`${draw.app}-version${c.G}${quoted}`, header(r.tp), line(c, r.other, "7")]),
      value: secret,
      file: "repo",
    })),
    // a record setting that is not one key here, set to a record with a secret key
    make("edit", 6, (r, c) => ({
      target: declare("rec", r.path.join(".")),
      others: [],
      text: body(c, [`[${r.path.join(".")}]`, `a${c.G}1`]),
      value: { [secret]: 1 },
    })),
  ];
};

/** The text of the other file for a start after a removal: it holds the key, so the start reads the next source. */
export const sibling = (p: Position): string => `${header(p.names.tp)}\n${p.names.key} = ${OLD[p.kind].raw}\n`;

/** Class (y): every mode of a setting (restart, live, file-only, required), with a name of two words and one of three. */
export const reachesY = (placed: ReadonlyArray<Position>) =>
  MODES.every((mode) => placed.some((p) => p.mode === mode)) &&
  [2, 3].every((words) => placed.some((p) => p.names.path.length === words));

const fromJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

/** Data as JSON: a start reads `-0.0` as `0`, which is the start's reading and not the edit's. */
export const plain = (value: unknown): unknown => fromJson(JSON.stringify(value ?? null));
