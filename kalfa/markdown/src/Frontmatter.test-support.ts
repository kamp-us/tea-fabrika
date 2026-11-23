// The generators for Frontmatter's laws (ticket 1926), all Effect `Arbitrary` values built from Schemas and their combinators.
//
// Effect's own string arbitrary reaches only printable ASCII and a few fixed cases, so the texts are built here, by group. A group is one
// class of input the reader and writer must survive. Each run draws six seeds, and every group turns them into a pool of texts: the
// group's fixed pieces (all of them, every run) and one random piece per seed. A law takes the run's pools, one group at a time, so every
// group is checked in every run, never left to chance. `variants` lists them, `REQUIRED` names them, and a law fails when one is missing
// or when a variant's pool does not hold what its group says.
import { Arbitrary, Result, Schema } from "effect";
import * as JsonSchema from "effect/JsonSchema";
import * as SchemaRepresentation from "effect/SchemaRepresentation";
import * as Frontmatter from "./Frontmatter.ts";

export type Json = null | boolean | number | string | ReadonlyArray<Json> | { readonly [key: string]: Json };

// ---------------------------------------------------------------------------------------------------------------------
// Seeds and texts

const Pick = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9999 }));

const Seed = Schema.Struct({ noise: Schema.String.check(Schema.isMaxLength(8)), a: Pick, b: Pick });

export type Seed = typeof Seed.Type;

/** Six seeds: one run's whole supply of randomness for texts. */
export const seeds: Arbitrary.Arbitrary<ReadonlyArray<Seed>> = Arbitrary.array(Arbitrary.schema(Seed), {
  minLength: 6,
  maxLength: 6,
});

export const at = (list: ReadonlyArray<string>, n: number): string => list[n % list.length] ?? "";

const halves = (seed: Seed): readonly [string, string] => {
  const cut = seed.noise.length >> 1;

  return [seed.noise.slice(0, cut), seed.noise.slice(cut)];
};

// A piece alone, at the start of some noise, inside it, or at its end.
const around = (piece: string, seed: Seed): string => {
  const [left, right] = halves(seed);

  switch (seed.b % 4) {
    case 0:
      return piece;
    case 1:
      return piece + right;
    case 2:
      return left + piece + right;
    default:
      return left + right + piece;
  }
};

export interface TextGroup {
  /** The plan's letter for the group. */
  readonly id: string;
  /**
   * Every fixed piece, then one random piece per seed. Not `wide`, the fixed pieces over `SHORT` characters are left out: every run draws them alike,
   * so a law that takes the pool in each of its runs takes them once, in a run of its own.
   */
  readonly pool: (drawn: ReadonlyArray<Seed>, wide?: boolean) => ReadonlyArray<string>;
  /** What the pool must hold, or the generator lost the group. */
  readonly reached: (pool: ReadonlyArray<string>) => boolean;
}

/** The longest fixed piece a run that is not `wide` takes. */
const SHORT = 200;

const group = (
  id: string,
  fixed: ReadonlyArray<string>,
  make: (seed: Seed) => string,
  reached: (text: string) => boolean,
): TextGroup => ({
  id,
  pool: (drawn, wide = true) => [
    ...(wide ? fixed : fixed.filter((piece) => piece.length <= SHORT)),
    ...drawn.map(make),
  ],
  reached: (pool) => pool.some(reached),
});

// The last four are a line of only blanks, then a break: the class a text with a break in it is quoted for.
const BLANKS = ["", " ", "   ", "\t", "\n", "\r\n", "\n\n", "\r", " \n", "  \n", " \t\n", "\n \n"];

const code = (point: number): string => String.fromCodePoint(point);

const NBSP = code(0xa0);

export const NEL = code(0x85);

export const LS = code(0x2028);

export const PS = code(0x2029);

export const BOM = code(0xfeff);

const PADS = [" ", "\t", "\n", "\r\n", NBSP, "  "];

export const BREAKS = ["\n", "\r\n", "\r", "\n\n", NEL, LS, PS];

export const CONTROLS = [
  ...Array.from({ length: 0x20 }, (_, point) => String.fromCodePoint(point)),
  String.fromCodePoint(0x7f),
  BOM,
];

export const LETTERS = [0xe9, 0x15f, 0x130, 0x131, 0x3b1, 0x436, 0x8bbe, 0xfffd, 0x1f600, 0x10ffff, 0xd800, 0xdc00].map(
  code,
);

const MARKS = [
  "---",
  "...",
  "-",
  "- ",
  "? ",
  ": ",
  " #",
  "#",
  "&a",
  "*a",
  "!a",
  "!!str",
  "%",
  "@",
  "`",
  "|",
  ">",
  "'",
  '"',
  "[",
  "]",
  "{",
  "}",
  ",",
  "<<",
];

const WORDS = [
  "true",
  "False",
  "TRUE",
  "yes",
  "No",
  "on",
  "off",
  "y",
  "null",
  "Null",
  "~",
  "0146",
  "0o17",
  "0x1F",
  "1e3",
  "1_000",
  "+1",
  "-0",
  ".5",
  ".inf",
  "-.Inf",
  ".nan",
  "2026-11-22",
  "2026-11-22T10:00:00Z",
];

const PROTOTYPES = ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty"];

const PATHS = [".x", "..", "...", "a b", " a", "a ", "a.b", "a/b", "1", "007", "-1", "1.5"];

const PAIRS = ["Key", "key", "KEY", "a b", "a  b", "ab", " ab", "ab ", "A B"];

const FENCE_LINE = /^---\r?$/;

/** The text groups (a) to (j), for values, keys and bodies alike. */
export const TEXT_GROUPS: ReadonlyArray<TextGroup> = [
  group(
    "a",
    BLANKS,
    (seed) => at(BLANKS, seed.a) + at(BLANKS, seed.b),
    (text) => text.trim() === "",
  ),
  group(
    "b",
    PADS.flatMap((pad) => [`${pad}x`, `x${pad}`, `${pad}x${pad}`]),
    (seed) => `${at(PADS, seed.a)}x${seed.noise}x${at(PADS, seed.b)}`,
    (text) => PADS.some((pad) => text.startsWith(pad)) && PADS.some((pad) => text.endsWith(pad)),
  ),
  group(
    "c",
    BREAKS.map((lineBreak) => `a${lineBreak}b`),
    (seed) => {
      const [left, right] = halves(seed);

      return `${left}${at(BREAKS, seed.a)}${right}`;
    },
    (text) => BREAKS.some((lineBreak) => text.includes(lineBreak)),
  ),
  group(
    "d",
    ["a\tb", "a\t\tb", "\tx", "x\t"],
    (seed) => {
      const [left, right] = halves(seed);

      return `${left}\t${right}`;
    },
    (text) => text.includes("\t"),
  ),
  group(
    "e",
    // U+FEFF first, then a key that starts with it: yaml drops that mark at the start of a document.
    [`${BOM}x`, ...CONTROLS.flatMap((control) => [control, `a${control}b`, `a${control}`])],
    (seed) => around(at(CONTROLS, seed.a), seed),
    (text) => CONTROLS.some((control) => text.includes(control)),
  ),
  group(
    "f",
    [...LETTERS, ...LETTERS.map((letter) => `a${letter}b`)],
    (seed) => around(at(LETTERS, seed.a), seed),
    (text) => LETTERS.some((letter) => text.includes(letter)),
  ),
  group(
    "g",
    MARKS.flatMap((mark) => [mark, `${mark}x`, `x${mark}x`]),
    (seed) => around(at(MARKS, seed.a), seed),
    (text) => MARKS.some((mark) => text.includes(mark)),
  ),
  group(
    "h",
    WORDS,
    (seed) => at(WORDS, seed.a),
    (text) => WORDS.includes(text),
  ),
  group(
    "i",
    PROTOTYPES,
    (seed) => at(PROTOTYPES, seed.a),
    (text) => PROTOTYPES.includes(text),
  ),
  group(
    "j",
    ["word ".repeat(40), "word ".repeat(1000), "x".repeat(200), "x".repeat(5000)],
    (seed) => (seed.b % 2 === 0 ? "word ".repeat(40 + (seed.a % 960)) : "x".repeat(200 + (seed.a % 4800))),
    (text) => text.length >= 200,
  ),
];

/** The key groups (k) to (m), which a key meets beyond the text groups. */
export const KEY_GROUPS: ReadonlyArray<TextGroup> = [
  group(
    "k",
    PATHS,
    (seed) => around(at(PATHS, seed.a), seed),
    (text) => PATHS.some((path) => text.includes(path)),
  ),
  group(
    "l",
    ["k".repeat(1025), "k".repeat(2000), "k ".repeat(600)],
    (seed) => `${"k".repeat(1025 + (seed.a % 500))}${seed.noise}`,
    (text) => text.length > 1024,
  ),
  {
    id: "m",
    // Two keys that differ only in letter case or whitespace must meet in one map, so nothing here is random.
    pool: () => PAIRS,
    reached: (pool) => pool.includes("Key") && pool.includes("key") && pool.includes("a b") && pool.includes("a  b"),
  },
];

// ---------------------------------------------------------------------------------------------------------------------
// Pools, and the data a skeleton draws from them

interface Pools {
  readonly texts: ReadonlyArray<string>;
  readonly keys: ReadonlyArray<string>;
}

const text = (pools: Pools, i: number): string => at(pools.texts, i);

const key = (pools: Pools, i: number): string => at(pools.keys, i);

// One text of every group, so a pool of a mix.
export const mixedTexts = (drawn: ReadonlyArray<Seed>): ReadonlyArray<string> =>
  drawn.map((seed, i) => {
    const chosen = TEXT_GROUPS[(seed.a + i) % TEXT_GROUPS.length];

    return chosen === undefined ? "" : (chosen.pool([seed]).at(-1) ?? "");
  });

export const mixedKeys = (drawn: ReadonlyArray<Seed>): ReadonlyArray<string> =>
  drawn.map((seed, i) => {
    const groups = [...TEXT_GROUPS, ...KEY_GROUPS];
    const chosen = groups[(seed.b + i) % groups.length];

    return chosen === undefined ? "" : (chosen.pool([seed]).at(-1) ?? "");
  });

export const NUMBERS = [
  0,
  -0,
  1,
  -1,
  Number.MAX_SAFE_INTEGER,
  -Number.MAX_SAFE_INTEGER,
  2 ** 53 + 2,
  0.1,
  1 / 3,
  1e21,
  5e-324,
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
];

type Skeleton =
  | { readonly kind: "null" }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "num"; readonly pick: number; readonly free: number }
  | { readonly kind: "str"; readonly i: number }
  | { readonly kind: "list"; readonly items: ReadonlyArray<Skeleton> }
  | {
      readonly kind: "map";
      readonly entries: ReadonlyArray<{ readonly k: number; readonly v: Skeleton; readonly reuse: boolean }>;
    };

const leaf: Arbitrary.Arbitrary<Skeleton> = Arbitrary.schema(
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("null") }),
    Schema.Struct({ kind: Schema.Literal("bool"), value: Schema.Boolean }),
    Schema.Struct({ kind: Schema.Literal("num"), pick: Pick, free: Schema.Finite }),
    Schema.Struct({ kind: Schema.Literal("str"), i: Pick }),
  ]),
);

const entries = (inner: Arbitrary.Arbitrary<Skeleton>, width: number) =>
  Arbitrary.array(Arbitrary.all({ k: Arbitrary.schema(Pick), v: inner, reuse: Arbitrary.schema(Schema.Boolean) }), {
    maxLength: width,
  });

// Depth `depth` below the top map, each level narrower than the one above.
const level = (depth: number, width: number): Arbitrary.Arbitrary<Skeleton> => {
  if (depth === 0) {
    return leaf;
  }

  const inner = level(depth - 1, Math.max(2, width - 2));

  const list = Arbitrary.map(Arbitrary.array(inner, { maxLength: width }), (items): Skeleton => ({
    kind: "list",
    items,
  }));

  const map = Arbitrary.map(entries(inner, width), (items): Skeleton => ({ kind: "map", entries: items }));

  return Arbitrary.flatMap(Arbitrary.schema(Schema.Literals(["leaf", "list", "map"])), (pick) => {
    if (pick === "leaf") {
      return leaf;
    }

    return pick === "list" ? list : map;
  });
};

// A map of 0 to 8 keys, nested to depth 4.
const topMap = entries(level(3, 5), 8);

type Entries = ReadonlyArray<{ readonly k: number; readonly v: Skeleton; readonly reuse: boolean }>;

const realizeEntries = (items: Entries, pools: Pools): Record<string, Json> => {
  const made: Array<[string, Json]> = [];

  for (const entry of items) {
    const previous = made.at(-1);

    // `reuse` puts the same object at two keys, which yaml would write as an anchor unless told not to.
    made.push([key(pools, entry.k), entry.reuse && previous !== undefined ? previous[1] : realize(entry.v, pools)]);
  }

  return Object.fromEntries(made);
};

const realize = (skeleton: Skeleton, pools: Pools): Json => {
  switch (skeleton.kind) {
    case "null":
      return null;
    case "bool":
      return skeleton.value;
    case "num":
      return skeleton.pick % (NUMBERS.length + 1) === NUMBERS.length
        ? skeleton.free
        : (NUMBERS[skeleton.pick % NUMBERS.length] ?? 0);
    case "str":
      return text(pools, skeleton.i);
    case "list":
      return skeleton.items.map((item) => realize(item, pools));
    case "map":
      return realizeEntries(skeleton.entries, pools);
  }
};

/** What every variant's data holds besides the drawn entries, so groups (n) to (s) are in every one. */
const structure = (pools: Pools): Record<string, Json> => {
  const shared = { [key(pools, 0)]: [key(pools, 1), text(pools, 1)], [key(pools, 2)]: {} };
  const deep = { [key(pools, 0)]: { [key(pools, 1)]: { [key(pools, 2)]: { [key(pools, 3)]: text(pools, 3) } } } };

  return {
    "t:null": null,
    "t:true": true,
    "t:false": false,
    "t:numbers": NUMBERS,
    "t:empty": [[], {}, [[]], [[[]]], [{}], [[], []]],
    "t:lists": [[[[text(pools, 0)]]], [{ [key(pools, 0)]: [] }, {}], [null, true, 1, text(pools, 1), [], {}]],
    "t:maps": deep,
    "t:sharedA": shared,
    "t:sharedB": shared,
    "t:texts": pools.texts,
    "t:keyed": Object.fromEntries(pools.keys.map((name, i) => [name, text(pools, i)])),
  };
};

/** The data of S1: every key and text of the pools, the template of groups (n) to (s), and the run's drawn entries. */
export const jsonData = (drawn: Entries, pools: Pools): Record<string, Json> => ({
  ...Object.fromEntries(pools.keys.map((name, i) => [name, text(pools, i)])),
  ...structure(pools),
  ...realizeEntries(drawn, pools),
});

/** Groups (n) to (s), read from the data itself: null, true and false; numbers; strings; lists; maps; one object at two keys. */
export const jsonReached = (data: Record<string, Json>): ReadonlyArray<string> => {
  const reached: Array<string> = [];
  const numbers = data["t:numbers"];

  if (data["t:null"] === null && data["t:true"] === true && data["t:false"] === false) {
    reached.push("n");
  }

  if (Array.isArray(numbers) && numbers.length === NUMBERS.length && numbers.some((n) => Object.is(n, -0))) {
    reached.push("o");
  }

  if (Array.isArray(data["t:texts"]) && data["t:texts"].length > 0) {
    reached.push("p");
  }

  if (Array.isArray(data["t:lists"]) && Array.isArray(data["t:empty"])) {
    reached.push("q");
  }

  if (data["t:maps"] !== undefined && data["t:empty"] !== undefined) {
    reached.push("r");
  }

  if (data["t:sharedA"] === data["t:sharedB"] && data["t:sharedA"] !== undefined) {
    reached.push("s");
  }

  return reached;
};

// ---------------------------------------------------------------------------------------------------------------------
// Variants: one text group at a time, in every run

interface Variant {
  /** The group id, or `drawn` for the random mix and `structure` for plain keys. */
  readonly group: string;
  readonly pools: Pools;
  readonly body: string;
}

const PLAIN_KEYS = Array.from({ length: 10 }, (_, i) => `k${i}`);

/** Every group in the plan, which every law that takes `variants` must have checked at the end of a run. */
export const REQUIRED: ReadonlyArray<string> = [
  ...TEXT_GROUPS.map((g) => g.id),
  ...KEY_GROUPS.map((g) => g.id),
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
];

/** The groups of text, key and body alone: every group but (n) to (s), which are about the data's own shape. */
export const TEXT_REQUIRED: ReadonlyArray<string> = REQUIRED.filter(
  (id) => !["n", "o", "p", "q", "r", "s"].includes(id),
);

/** The variants that change the data: the random mix, each text group, each key group, and plain keys. */
export const dataVariants = (drawn: ReadonlyArray<Seed>, wide = true): ReadonlyArray<Variant> => {
  const texts = mixedTexts(drawn);
  const mixed = { texts, keys: mixedKeys(drawn) };
  const list: Array<Variant> = [{ group: "drawn", pools: mixed, body: texts.join("") }];

  for (const g of TEXT_GROUPS) {
    const pool = g.pool(drawn, wide);

    list.push({ group: g.id, pools: { texts: pool, keys: pool }, body: pool.join("") });
  }

  for (const g of KEY_GROUPS) {
    list.push({ group: g.id, pools: { texts, keys: g.pool(drawn, wide) }, body: texts.join("") });
  }

  list.push({ group: "structure", pools: { texts, keys: PLAIN_KEYS }, body: texts.join("") });

  return list;
};

/** The variants that change only the body: each blank text alone, and groups (t) to (v). */
export const bodyVariants = (drawn: ReadonlyArray<Seed>): ReadonlyArray<Variant> => {
  const texts = mixedTexts(drawn);
  const pools = { texts, keys: mixedKeys(drawn) };
  const lines = `# ${at(texts, 0)}\n${at(texts, 1)}\nlast line\n`;

  const bodies: ReadonlyArray<readonly [string, string]> = [
    ...BLANKS.map((blank): readonly [string, string] => ["a", blank]),
    ["t", `---\n${lines}`],
    ["t", `---\r\n${lines}`],
    ["t", `${lines}---\n${lines}---\n`],
    ["t", `---\na: 1\n---\n${lines}`],
    ["u", `\n${lines}`],
    ["u", lines.replace(/\n+$/u, "")],
    ["u", lines.replaceAll("\n", "\r\n")],
    ["v", `# ${at(texts, 2)}\n\n${lines}`],
    ["v", `\`\`\`\n---\n\`\`\`\n${lines}`],
  ];

  return bodies.map(([group, body]) => ({ group, pools, body }));
};

/** Whether the variant's pools truly hold what its group says. A group that is lost fails loudly, never quietly. */
export const reachedBy = (variant: Variant): boolean => {
  const found = [...TEXT_GROUPS, ...KEY_GROUPS].find((g) => g.id === variant.group);

  if (found === undefined) {
    return true;
  }

  return KEY_GROUPS.includes(found) ? found.reached(variant.pools.keys) : found.reached(variant.pools.texts);
};

// ---------------------------------------------------------------------------------------------------------------------
// The shapes: the Schemas the laws read and write against, with their data

const DecisionSkeleton = Schema.Struct({
  number: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
  status: Schema.Literals(["proposed", "accepted", "superseded"]),
  decided: Pick,
  supersedes: Schema.Array(Schema.Int),
  tags: Schema.Array(Pick),
  note: Schema.optionalKey(Pick),
  draft: Schema.Boolean,
  second: Schema.NullOr(Schema.Finite),
});

const CountSkeleton = Schema.Struct({
  count: Schema.Finite,
  label: Pick,
  when: Schema.Int.check(Schema.isBetween({ minimum: -8.64e15, maximum: 8.64e15 })),
});

const RecordSkeleton = Schema.Array(Schema.Struct({ k: Pick, v: Schema.Array(Schema.Array(Pick)) }));

/** One run: everything a law may draw. A law takes what it needs and ignores the rest. */
export interface Run {
  readonly seeds: ReadonlyArray<Seed>;
  readonly json: Entries;
  readonly decision: typeof DecisionSkeleton.Type;
  readonly count: typeof CountSkeleton.Type;
  readonly record: typeof RecordSkeleton.Type;
  /** Small whole numbers, for the places a law picks: a count of good lines, a depth, which field to break. */
  readonly picks: ReadonlyArray<number>;
}

export const run: Arbitrary.Arbitrary<Run> = Arbitrary.all({
  seeds,
  json: topMap,
  decision: Arbitrary.schema(DecisionSkeleton),
  count: Arbitrary.schema(CountSkeleton),
  record: Arbitrary.schema(RecordSkeleton),
  picks: Arbitrary.array(Arbitrary.schema(Pick), { minLength: 6, maxLength: 6 }),
});

/** S1, a plain JSON object. */
export const S1 = Schema.JsonObject;

/** S2, a decision-like Struct. */
export const S2 = Schema.Struct({
  number: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  status: Schema.Literals(["proposed", "accepted", "superseded"]),
  decided: Schema.String,
  supersedes: Schema.Array(Schema.Int),
  tags: Schema.Array(Schema.String),
  note: Schema.optionalKey(Schema.String),
  draft: Schema.Boolean,
  meta: Schema.Struct({ "a.b": Schema.String, " c": Schema.NullOr(Schema.Finite) }),
});

/** S3, text in the file and a number in the data. */
export const S3 = Schema.Struct({ count: Schema.FiniteFromString, label: Schema.String });

/** S3's second half: a Date in the data and its ISO text in the file, through `Schema.toCodecJson`. */
export const S3Date = Schema.toCodecJson(Schema.Struct({ when: Schema.Date, label: Schema.String }));

/** S4, a record of text keys to lists of lists of text. */
export const S4 = Schema.Record(Schema.String, Schema.Array(Schema.Array(Schema.String)));

// A type alias, not an interface: an interface has no implicit index signature, so it would not fit `Frontmatter.set`'s data.
type Decision = {
  readonly number: number;
  readonly status: "proposed" | "accepted" | "superseded";
  readonly decided: string;
  readonly supersedes: ReadonlyArray<number>;
  readonly draft: boolean;
  readonly note: string | null;
};

/** The decision-shaped JSON Schema (2020-12) that F10 reads a file against. */
const decisionJsonSchema = JsonSchema.fromSchemaDraft2020_12({
  type: "object",
  required: ["number", "status", "decided", "supersedes", "draft", "note"],
  properties: {
    number: { type: "integer", minimum: 1 },
    status: { enum: ["proposed", "accepted", "superseded"] },
    decided: { type: "string" },
    supersedes: { type: "array", items: { type: "integer" } },
    draft: { type: "boolean" },
    note: { type: ["string", "null"] },
  },
});

/** S5, a Schema made from a JSON Schema. It arrives as `Schema.Top`, so it is typed by its AST, as Effect does. */
export const S5: Schema.Codec<Decision> = Schema.make<Schema.Codec<Decision>>(
  SchemaRepresentation.fromJsonSchemaDocument(decisionJsonSchema).ast,
);

const wordAt = (pools: Pools, i: number): string => text(pools, i);

export const s2Data = (run: Run, pools: Pools): typeof S2.Type => {
  const skeleton = run.decision;

  return {
    number: skeleton.number,
    status: skeleton.status,
    decided: wordAt(pools, skeleton.decided),
    supersedes: skeleton.supersedes,
    tags: [...pools.texts, ...skeleton.tags.map((i) => wordAt(pools, i))],
    ...(skeleton.note === undefined ? {} : { note: wordAt(pools, skeleton.note) }),
    draft: skeleton.draft,
    meta: { "a.b": wordAt(pools, skeleton.decided + 1), " c": skeleton.second },
  };
};

export const s3Data = (run: Run, pools: Pools): typeof S3.Type => ({
  // `String(-0)` is "0", so the text in the file never says -0.
  count: Object.is(run.count.count, -0) ? 0 : run.count.count,
  label: wordAt(pools, run.count.label),
});

export const s3DateData = (run: Run, pools: Pools): typeof S3Date.Type => ({
  when: new Date(run.count.when),
  label: wordAt(pools, run.count.label),
});

export const s4Data = (run: Run, pools: Pools): typeof S4.Type =>
  Object.fromEntries([
    ...pools.keys.map((name, i): [string, ReadonlyArray<ReadonlyArray<string>>] => [
      name,
      [[wordAt(pools, i)], [], [wordAt(pools, i + 1), wordAt(pools, i + 2)]],
    ]),
    ...run.record.map((entry): [string, ReadonlyArray<ReadonlyArray<string>>] => [
      key(pools, entry.k),
      entry.v.map((list) => list.map((i) => wordAt(pools, i))),
    ]),
  ]);

export const s5Data = (run: Run, pools: Pools): Decision => {
  const skeleton = run.decision;

  return {
    number: skeleton.number,
    status: skeleton.status,
    decided: wordAt(pools, skeleton.decided),
    supersedes: skeleton.supersedes,
    draft: skeleton.draft,
    note: skeleton.note === undefined ? null : wordAt(pools, skeleton.note),
  };
};

// ---------------------------------------------------------------------------------------------------------------------
// Files with no frontmatter, files that are not YAML, YAML that is not data, and data a Schema refuses

/** `lines` as text with no fence among them: each line has no `\n`, and none is `---` or `---\r`. Each ends with `\n`. */
export const fenceFree = (texts: ReadonlyArray<string>): string =>
  texts
    .map((t) => t.replaceAll("\n", ""))
    .map((line) => (FENCE_LINE.test(line) ? `x${line}` : line))
    .map((line) => `${line}\n`)
    .join("");

const NEARLY = ["--- ", " ---", "----", "--", "---x", "--- # c", "---\t", `${BOM}---`, "***", "+++", "...", "- - -"];

/** Files with no frontmatter, by group (w) to (z). */
export const bareFiles = (
  drawn: ReadonlyArray<Seed>,
): ReadonlyArray<{ readonly group: string; readonly text: string }> => {
  const texts = mixedTexts(drawn);
  const rest = fenceFree([...NEARLY, ...texts]);
  const first = (t: string): string => t.split("\n")[0] ?? "";
  const unfenced = (t: string): string => (FENCE_LINE.test(first(t)) ? `x${t}` : t);

  return [
    ...NEARLY.flatMap((line) => [
      { group: "w", text: `${line}\n${rest}` },
      { group: "w", text: `${line}\r\n${rest}---\n${at(texts, 0)}` },
    ]),
    { group: "x", text: `---\n${rest}` },
    { group: "x", text: `---\r\n${rest}` },
    { group: "x", text: `---\n${fenceFree(texts)}${fenceFree([at(texts, 1)]).slice(0, -1)}` },
    ...["", "---", "---\n", "---\r\n"].map((t) => ({ group: "y", text: t })),
    ...mixedTexts(drawn).map((t) => ({ group: "z", text: unfenced(t) })),
    ...TEXT_GROUPS.flatMap((g) => g.pool(drawn).map((t) => ({ group: "z", text: unfenced(t) }))),
  ];
};

/** What a `bare` file's groups are, for the coverage check. */
export const BARE_REQUIRED: ReadonlyArray<string> = ["w", "x", "y", "z"];

interface Broken {
  readonly name: string;
  /** The lines that break the file, after the good lines. */
  readonly lines: ReadonlyArray<string>;
  /** The offset from the first bad line of the line yaml reports, when the law pins it. */
  readonly at: number | undefined;
  /** The second-document case with a start marker needs a line before it. */
  readonly minGood: number;
}

const nine = (item: string): string => Array.from({ length: 9 }, () => item).join(", ");

export const BROKEN: ReadonlyArray<Broken> = [
  { name: "a tab as indentation", lines: ["\ta: 1"], at: 0, minGood: 0 },
  { name: "an unclosed [", lines: ["a: [1, 2"], at: undefined, minGood: 0 },
  { name: "an unclosed {", lines: ["a: {b: 1"], at: undefined, minGood: 0 },
  { name: 'an unclosed "', lines: ['a: "abc'], at: undefined, minGood: 0 },
  { name: "an unclosed '", lines: ["a: 'abc"], at: undefined, minGood: 0 },
  { name: "a duplicate key", lines: ["d: 1", "d: 2"], at: 1, minGood: 0 },
  { name: "a: b: c", lines: ["a: b: c"], at: undefined, minGood: 0 },
  { name: "a list item beside map keys", lines: ["x: 1", "- b"], at: undefined, minGood: 0 },
  { name: "a key indented past its sibling", lines: ["x: 1", "  b: 2"], at: undefined, minGood: 0 },
  { name: "a %YAML line", lines: ["%YAML 1.1", "a: 1"], at: undefined, minGood: 0 },
  { name: "a second document after ...", lines: ["...", "b: 2"], at: undefined, minGood: 0 },
  { name: "a second document after a start marker", lines: ["--- ", "b: 2"], at: undefined, minGood: 1 },
];

// Every key the cases of BROKEN, UNREAD and `nested` write, which a line of data must not repeat: a repeated key is a syntax
// error, or changes which line is the broken one.
const CASE_KEYS = new Set(["", "a", "b", "c", "d", "e", "x", "1", "true", "n1", "n2", "n3"]);

/**
 * `count` entries of `data` starting at `start`, as the YAML lines `write` makes of them: the lines of a file that is good
 * so far. An entry whose key a case writes is left out.
 */
export const dataLines = (data: Record<string, Json>, start: number, count: number): ReadonlyArray<string> => {
  const entries = Object.entries(data).filter(([name]) => !CASE_KEYS.has(name));
  const from = entries.length === 0 ? 0 : start % entries.length;
  const chosen = Object.fromEntries(entries.slice(from, from + count));
  const written = Frontmatter.write({ data: chosen, body: "" }, Schema.JsonObject);

  if (Result.isFailure(written)) {
    throw new Error(`write refused data that is JSON: ${written.failure.message}`);
  }

  return written.success.split("\n").slice(1, -2);
};

interface Unread {
  readonly name: string;
  readonly lines: ReadonlyArray<string>;
  /** A top level that is not a map has no depth to sit at. */
  readonly top: boolean;
}

export const UNREAD: ReadonlyArray<Unread> = [
  { name: "a top level list", lines: ["- a", "- b"], top: true },
  { name: "a top level text", lines: ["just text"], top: true },
  { name: "a top level number", lines: ["42"], top: true },
  { name: "an explicit ~", lines: ["~"], top: true },
  { name: "!!set", lines: ["x: !!set {a, b}"], top: false },
  { name: "!!omap", lines: ["x: !!omap [a: 1]"], top: false },
  { name: "!!timestamp", lines: ["x: !!timestamp 2001-01-01"], top: false },
  { name: "!!binary", lines: ["x: !!binary aGVsbG8="], top: false },
  { name: "!!float 1", lines: ["x: !!float 1"], top: false },
  { name: "!x", lines: ["x: !x 1"], top: false },
  { name: ".nan", lines: ["x: .nan"], top: false },
  { name: ".inf", lines: ["x: .inf"], top: false },
  { name: "-.inf", lines: ["x: -.inf"], top: false },
  // A key that is not finite would read as the text "NaN" or "Infinity", which the file never says.
  { name: ".nan as a key", lines: [".nan: 1"], top: false },
  { name: ".inf as a key", lines: [".inf: 1"], top: false },
  { name: "-.inf as a key", lines: ["-.inf: 1"], top: false },
  { name: "a key that is a list", lines: ["? [a]", ": 1"], top: false },
  { name: "a key that is a map", lines: ["? {a: 1}", ": 1"], top: false },
  { name: "a null key", lines: ["~: 1"], top: false },
  { name: "1 and a text 1", lines: ["1: a", '"1": b'], top: false },
  { name: "true and a text true", lines: ["true: a", '"true": b'], top: false },
  { name: "~ and an empty text", lines: ["~: a", '"": b'], top: false },
  {
    name: "an alias bomb",
    lines: [
      "a: &a [x, x, x, x, x, x, x, x, x]",
      `b: &b [${nine("*a")}]`,
      `c: &c [${nine("*b")}]`,
      `d: &d [${nine("*c")}]`,
      `e: &e [${nine("*d")}]`,
    ],
    top: false,
  },
];

/** `lines` sitting `depth` maps down, with the `around` lines (data written by `dataLines`) at every level beside them. */
export const nested = (
  depth: number,
  lines: ReadonlyArray<string>,
  around: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  depth === 0
    ? [...around, ...lines]
    : [...around, `n${depth}:`, ...nested(depth - 1, lines, around).map((line) => `  ${line}`)];

const REFUSED_FIELDS = ["number", "status", "decided", "supersedes", "tags", "draft", "meta"] as const;

type Field = (typeof REFUSED_FIELDS)[number];

interface Refused {
  readonly name: string;
  readonly field: string;
  readonly lines: ReadonlyArray<string>;
}

/** S2 data written as YAML by hand, one good file and then files with one break at a field. `number` and `word` come from the run. */
export const refusedFiles = (
  number: number,
  word: string,
): { readonly valid: ReadonlyArray<string>; readonly broken: ReadonlyArray<Refused> } => {
  const valid: Readonly<Record<Field, ReadonlyArray<string>>> = {
    number: [`number: ${number}`],
    status: ["status: accepted"],
    decided: [`decided: ${JSON.stringify(word)}`],
    supersedes: ["supersedes: [1, 2]"],
    tags: [`tags: [${JSON.stringify(word)}, "b"]`],
    draft: ["draft: true"],
    meta: ["meta:", '  "a.b": x', '  " c": null'],
  };

  const lines = (field: Field, replacement: ReadonlyArray<string>): ReadonlyArray<string> =>
    REFUSED_FIELDS.flatMap((name) => (name === field ? replacement : valid[name]));

  const without = (field: Field): ReadonlyArray<string> =>
    REFUSED_FIELDS.filter((name) => name !== field).flatMap((name) => valid[name]);

  return {
    valid: lines("number", valid.number),
    broken: [
      { name: "text where an integer is wanted", field: "number", lines: lines("number", [`number: "${number}"`]) },
      { name: "an integer below 1", field: "number", lines: lines("number", ["number: 0"]) },
      { name: "a literal outside the three", field: "status", lines: lines("status", ["status: Accepted"]) },
      { name: "a number where text is wanted", field: "decided", lines: lines("decided", [`decided: ${number}`]) },
      { name: "a number in a list of text", field: "tags", lines: lines("tags", [`tags: [${number}]`]) },
      ...REFUSED_FIELDS.map((field) => ({ name: `${field} missing`, field, lines: without(field) })),
    ],
  };
};
