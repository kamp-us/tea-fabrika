/**
 * What the laws of a whole-record edit share (ticket 1844, kalfa/config, new work): the generators, the typed configuration
 * file, and the judge that says what an answer must look like.
 *
 * A typed file is a configuration file as a person types it, built from units (a header with its keys, a run of dotted
 * keys, another setting's table), joined by gaps of comment and blank lines. Every line knows who owns it: the record's
 * key at a path, the block of a table header (its comment lines right above the header, its comments and blank lines),
 * or nobody (another setting, a banner, a comment no header claims). So a law says which lines must stay, which must go
 * and which may change, from the file it built and the record it asks for, without asking the code under test.
 *
 * The classes (a) to (z) are the plan's "Generators" (.kalfa/quests/kalfa-config-record-PLAN.md). Each is built from the
 * drawn seeds in every run, one case per class, never the cross product; a law keeps the ids it reached and `Reach.done`
 * fails when one is missing.
 */
import { Predicate, Schema } from "effect";
import { Setting, SettingGroup } from "./index.ts";
import { Reach } from "./SettingGroup.edit.test-support.ts";

export { Reach };

// ---------------------------------------------------------------------------------------------
// Values: a record is a table of tables, three deep below its items.
// ---------------------------------------------------------------------------------------------

/** What a key holds: a number or a word, a list of numbers, or a table. */
export type Node = number | string | ReadonlyArray<Node> | { readonly [key: string]: Node };

export interface Rec {
  readonly [key: string]: Node;
}

type Path = ReadonlyArray<string>;

export const isRec = (value: unknown): value is Rec => Predicate.isObject(value);

const nonEmpty = (value: unknown): value is Rec => isRec(value) && Object.keys(value).length > 0;

const entries = (value: Rec): ReadonlyArray<readonly [string, Node]> => Object.entries(value);

/** The value at `path`, or none; an own key only. */
const read = (value: unknown, path: Path): unknown =>
  path.reduce<unknown>((parent, key) => (isRec(parent) && Object.hasOwn(parent, key) ? parent[key] : undefined), value);

/** The same data, whatever the key order. */
const canon = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canon)
    : isRec(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canon(value[key])]),
        )
      : value;

export const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canon(left)) === JSON.stringify(canon(right));

const Small = Schema.Int.check(Schema.isBetween({ minimum: -50, maximum: 50 }));

const Word = Schema.String.check(Schema.isPattern(/^[a-z]{3,6}$/u));

/** A secret-looking word, with a character that changes in JSON and in a URL. */
const Hidden = Schema.String.check(Schema.isPattern(/^sk-([A-Za-z0-9]{6,12})["/ +\\&][A-Za-z0-9]{3}$/u));

const Leaf = Schema.Union([Small, Word]);

/** The schemas of the record settings: items hold keys, keys hold tables, two below an item. */
const Free = Schema.Union([Schema.Int, Schema.String]);

const Arr = Schema.Array(Free).check(Schema.isMaxLength(3));

const R0 = Schema.Record(Schema.String, Schema.Union([Free, Arr]));

const R1 = Schema.Record(Schema.String, Schema.Union([Free, Arr, R0]));

const R2 = Schema.Record(Schema.String, Schema.Union([Free, Arr, R1]));

const RulesRecord = Schema.Record(Schema.String, Schema.Union([Free, Arr, R2]));

/** The record setting's value: a record of items, or an array of tables (a kind change must be writable). */
const RulesSchema = Schema.Union([RulesRecord, Schema.Array(R2).check(Schema.isMaxLength(3))]);

/** The array setting's value: tables and plain numbers or words. */
const StepsSchema = Schema.Array(Schema.Union([R1, Free])).check(Schema.isMaxLength(4));

/** What the record reads as when no file holds it: never empty, so a start that finds no line is told apart. */
export const DEFAULT = { "default-item": { n: 0 } };

// ---------------------------------------------------------------------------------------------
// Draws
// ---------------------------------------------------------------------------------------------

const Pattern = Schema.Literals(["", "b", "c", "bc", "cb", "bb"]);

const Style = Schema.Struct({
  gap: Schema.Literals([" = ", "  =\t", "="]),
  tail: Schema.Literals(["", " # tail", "   # tail", "\t# tail"]),
  inside: Schema.Boolean,
  gaps: Schema.Tuple([Pattern, Pattern, Pattern, Pattern]),
  inner: Schema.Literals(["", "b"]),
});

type Style = typeof Style.Type;

const ItemSeed = Schema.Struct({
  word: Word,
  leaves: Schema.Array(Leaf).check(Schema.isMinLength(1), Schema.isMaxLength(2)),
  desired: Schema.Array(Leaf).check(Schema.isMaxLength(2)),
  deep: Schema.Boolean,
  list: Schema.Array(Small).check(Schema.isMinLength(2), Schema.isMaxLength(3)),
});

type ItemSeed = typeof ItemSeed.Type;

/** What every record law draws: names, three old items, one that arrives, and styles. */
export const Draw = Schema.Struct({
  app: Word,
  table: Word,
  name: Word,
  items: Schema.Tuple([ItemSeed, ItemSeed, ItemSeed]),
  fresh: ItemSeed,
  styles: Schema.Tuple([Style, Style, Style, Style]),
  leave: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 })),
  delta: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9 })),
  steps: Schema.Array(Small).check(Schema.isMinLength(1), Schema.isMaxLength(3)),
  secret: Hidden,
  secrets: Schema.Tuple([Hidden, Hidden]),
});

export type Draw = typeof Draw.Type;

// ---------------------------------------------------------------------------------------------
// Text a person types, written without the code under test.
// ---------------------------------------------------------------------------------------------

/** A key as TOML writes it: bare when it can be, quoted when it must be. */
const bare = (key: string): string => (/^[A-Za-z0-9_-]+$/u.test(key) ? key : JSON.stringify(key));

const dots = (path: Path): string => path.map(bare).join(".");

/** A value as TOML text on one line, as a person types it (`odd` spells numbers as floats and words as literals). */
const lit = (value: Node, odd = false): string => {
  if (Predicate.isNumber(value)) {
    return odd ? `${value}.0` : String(value);
  }

  if (Predicate.isString(value)) {
    return odd ? `'${value}'` : JSON.stringify(value);
  }

  if (isRec(value)) {
    const members = entries(value).map(([key, child]) => `${bare(key)} = ${lit(child, odd)}`);

    return members.length === 0 ? "{}" : `{ ${members.join(", ")} }`;
  }

  return `[${value.map((item) => lit(item, odd)).join(", ")}]`;
};

type Own =
  | { readonly t: "stay" }
  | { readonly t: "block"; readonly path: Path }
  | { readonly t: "key"; readonly path: Path; readonly lead: string; readonly tail: string }
  | { readonly t: "more"; readonly note?: string };

interface Line {
  readonly text: string;
  readonly own: Own;
  /** A table header's path, in the file. */
  readonly head?: Path;
}

const STAY: Own = { t: "stay" };

const block = (path: Path): Own => ({ t: "block", path });

interface Cx {
  readonly table: string;
  readonly name: string;
  readonly style: Omit<Style, "tail" | "inner"> & { readonly tail: string; readonly inner: string };
  /** Spell a number as a float and a word as a literal string. */
  readonly odd: boolean;
  /** Write a list on several lines, with a comment inside. */
  readonly multi: boolean;
  /** Write the first item of a root-dotted record as one inline table. */
  readonly inlineFirst: boolean;
  /** Write the first item of a record under headers as dotted keys at the root, before the headers. */
  readonly rootFirst: boolean;
  n: number;
}

const note = (c: Cx): string => `# note ${c.n++}`;

const settingPath = (c: Cx): Path => [c.table, c.name];

/** One `key = value` line, or several when the value is a list written over lines. */
const assignment = (c: Cx, spelled: string, path: Path, value: Node): ReadonlyArray<Line> => {
  const lead = `${spelled}${c.style.gap}`;

  if (c.multi && Array.isArray(value) && value.length > 0) {
    const text = note(c);

    return [
      { text: `${lead}[`, own: { t: "key", path, lead, tail: "" } },
      ...value.map((item, i): Line => {
        const comment = i === 0 ? `   ${text}` : "";

        return { text: `  ${item},${comment}`, own: { t: "more", ...(i === 0 ? { note: text } : {}) } };
      }),
      { text: "]", own: { t: "more" } },
    ];
  }

  return [{ text: `${lead}${lit(value, c.odd)}${c.style.tail}`, own: { t: "key", path, lead, tail: c.style.tail } }];
};

/** The dotted lines of a table: every key that holds no table is a line, every table is dotted deeper. */
const dotted = (c: Cx, prefix: string, base: Path, value: Rec): ReadonlyArray<Line> =>
  entries(value).flatMap(([key, child]) =>
    nonEmpty(child)
      ? dotted(c, `${prefix}${bare(key)}.`, [...base, key], child)
      : assignment(c, `${prefix}${bare(key)}`, [...base, key], child),
  );

/** An item written as one inline table over several lines, with a comment inside it. */
const spread = (c: Cx, key: string, value: Rec): ReadonlyArray<Line> => {
  const lead = `${bare(key)}${c.style.gap}`;
  const comment = note(c);

  return [
    { text: `${lead}{`, own: { t: "key", path: [key], lead, tail: "" } },
    ...entries(value).map(([name, child], i): Line => {
      const text = i === 0 ? `   ${comment}` : "";

      return {
        text: `  ${bare(name)} = ${lit(child, c.odd)},${text}`,
        own: { t: "more", ...(i === 0 ? { note: comment } : {}) },
      };
    }),
    { text: "}", own: { t: "more" } },
  ];
};

// ---------------------------------------------------------------------------------------------
// Units, gaps and the file
// ---------------------------------------------------------------------------------------------

interface Unit {
  readonly lines: ReadonlyArray<Line>;
  /** Who owns the blank and comment lines right below it that no header claims. */
  readonly below: Own;
  /** Who owns a run of comment lines right above its first line: the header's block, or none for a unit with no header. */
  readonly above: Own | undefined;
}

/** A table under its own header: the header, a comment inside, then a line per key and a block of its own per table. */
const blocks = (c: Cx, path: Path, value: Rec): ReadonlyArray<Unit> => {
  const abs = [...settingPath(c), ...path];

  const lines: Array<Line> = [{ text: `[${dots(abs)}]`, own: block(path), head: abs }];

  if (c.style.inside) {
    lines.push({ text: note(c), own: block(path) });
  }

  for (const [key, child] of entries(value)) {
    if (!nonEmpty(child)) {
      lines.push(...assignment(c, bare(key), [...path, key], child));
    }
  }

  return [
    { lines, below: block(path), above: block(path) },
    ...entries(value).flatMap(([key, child]) => (nonEmpty(child) ? blocks(c, [...path, key], child) : [])),
  ];
};

/** The record's own header, and the lines under it. */
const headed = (c: Cx, body: ReadonlyArray<Line>): Unit => {
  const abs = settingPath(c);

  const lines: Array<Line> = [{ text: `[${dots(abs)}]`, own: block([]), head: abs }];

  if (c.style.inside) {
    lines.push({ text: note(c), own: block([]) });
  }

  return { lines: [...lines, ...body], below: block([]), above: block([]) };
};

/** A run of dotted lines, an own-line comment (that no header owns) between two items. */
const run = (c: Cx, prefix: string, old: Rec): ReadonlyArray<Line> =>
  entries(old).flatMap(([key, child], i) => [
    ...(c.style.inside && i > 0 ? [{ text: note(c), own: STAY }] : []),
    ...(nonEmpty(child) && !(c.inlineFirst && i === 0)
      ? dotted(c, `${prefix}${bare(key)}.`, [key], child)
      : assignment(c, `${prefix}${bare(key)}`, [key], child)),
  ]);

type Form = "a" | "b" | "c" | "d" | "e" | "f" | "g";

/** The record, written in one of the plan's forms (a) to (g): one group of units for each item that stands apart. */
const written = (c: Cx, form: Form, old: Rec): ReadonlyArray<ReadonlyArray<Unit>> => {
  const items = entries(old);

  switch (form) {
    case "a":
      return [
        [
          headed(
            c,
            items.flatMap(([key, item]) => assignment(c, bare(key), [key], item)),
          ),
        ],
      ];
    case "b":
      return [[headed(c, run(c, "", old))]];
    case "c":
      return items.map(([key, item], i) =>
        c.rootFirst && i === 0
          ? [
              {
                lines: isRec(item)
                  ? dotted(c, `${bare(c.table)}.${bare(c.name)}.${bare(key)}.`, [key], item)
                  : assignment(c, `${bare(c.table)}.${bare(c.name)}.${bare(key)}`, [key], item),
                below: STAY,
                above: undefined,
              },
            ]
          : nonEmpty(item)
            ? blocks(c, [key], item)
            : [headed(c, assignment(c, bare(key), [key], item))],
      );
    case "d":
      return [
        [
          {
            lines: [{ text: `[${bare(c.table)}]`, own: STAY, head: [c.table] }, ...run(c, `${bare(c.name)}.`, old)],
            below: STAY,
            above: STAY,
          },
        ],
      ];
    case "e":
      return [[{ lines: run(c, `${bare(c.table)}.${bare(c.name)}.`, old), below: STAY, above: undefined }]];
    case "f":
      return items.map(([key, item], i) =>
        i === 0
          ? [
              headed(
                c,
                nonEmpty(item) ? dotted(c, `${bare(key)}.`, [key], item) : assignment(c, bare(key), [key], item),
              ),
            ]
          : nonEmpty(item)
            ? blocks(c, [key], item)
            : [{ lines: assignment(c, bare(key), [key], item), below: block([]), above: undefined }],
      );
    case "g":
      return [
        [
          headed(
            c,
            items.flatMap(([key, item]) =>
              nonEmpty(item) ? spread(c, key, item) : assignment(c, bare(key), [key], item),
            ),
          ),
        ],
      ];
  }
};

/** The other settings of the group: each has a table of its own, a key and the text of its value. */
export const OTHERS = {
  delivery: { key: "approver", raw: '"people"', value: "people", name: "delivery.approver" },
  instance: { key: "port", raw: "4100", value: 4100, name: "instance.port" },
  gate: { key: "limit", raw: "3", value: 3, name: "gate.limit" },
} as const;

type Other = keyof typeof OTHERS;

/** The other settings' tables, in the order the group lists them. */
export const OTHER_KEYS: ReadonlyArray<Other> = ["delivery", "instance", "gate"];

/** Another setting's table, with a comment right above its header. */
const other = (c: Cx, which: Other): Unit => ({
  lines: [
    { text: note(c), own: STAY },
    { text: `[${which}]`, own: STAY, head: [which] },
    { text: `${OTHERS[which].key}${c.style.gap}${OTHERS[which].raw}`, own: STAY },
  ],
  below: STAY,
  above: STAY,
});

type Gap = ReadonlyArray<"b" | "c">;

const gapLines = (pattern: string): Gap => [...pattern].flatMap((char) => (char === "b" || char === "c" ? [char] : []));

const joined = (
  c: Cx,
  groups: ReadonlyArray<ReadonlyArray<Unit>>,
  gapAt: (boundary: number) => string,
  top: ReadonlyArray<Line>,
): ReadonlyArray<Line> => {
  const lines: Array<Line> = [...top];
  let before: Unit | undefined;
  let boundary = 0;

  for (const group of groups) {
    for (const [i, unit] of group.entries()) {
      if (before !== undefined) {
        const pattern = gapLines(i === 0 ? gapAt(boundary++) : c.style.inner);
        // A run of comments right above the header belongs to it; the rest, to the unit above.
        let split = pattern.length;

        while (split > 0 && pattern[split - 1] === "c" && unit.above !== undefined) {
          split--;
        }

        for (const [k, kind] of pattern.entries()) {
          const own = k < split ? before.below : (unit.above ?? STAY);

          lines.push({ text: kind === "b" ? "" : note(c), own });
        }
      }

      lines.push(...unit.lines);
      before = unit;
    }
  }

  return lines;
};

// ---------------------------------------------------------------------------------------------
// The scene: a file, the record it holds, the record asked for, and where a new item must go.
// ---------------------------------------------------------------------------------------------

interface Slot {
  readonly label: string;
  readonly test: (line: string) => boolean;
  /** The line break that must follow the line: the old line's own, or the file's first one for a new line. None when it is not known. */
  readonly brk?: string;
}

const exact = (text: string, brk?: string): Slot => ({
  label: JSON.stringify(text),
  test: (line) => line === text,
  // A blank line may be matched by another blank line of the answer, so only a line with text is held to its break.
  ...(brk === undefined || brk === "" || text.trim() === "" ? {} : { brk }),
});

const like = (lead: string, tail: string, brk?: string): Slot => ({
  label: `${JSON.stringify(lead)} ... ${JSON.stringify(tail)}`,
  test: (line) => line.startsWith(lead) && line.endsWith(tail) && line.length > lead.length + tail.length,
  ...(brk === undefined || brk === "" ? {} : { brk }),
});

interface Arrival {
  /** The old line the new lines go before; the old line count for the end of the file. */
  readonly before: number;
  readonly slots: ReadonlyArray<Slot>;
  /** The blank lines the arrival may add: one before each new block. */
  readonly blanks: number;
  /** Whether lines of a leaving block that lie after the arrival may stay behind it (a new block written after the last block's keys). */
  readonly spare: boolean;
}

export interface Scene {
  readonly ids: ReadonlyArray<Id>;
  readonly label: string;
  readonly app: string;
  readonly group: ReturnType<typeof makeGroup>;
  readonly setting: Setting.Any;
  readonly name: string;
  readonly path: Path;
  readonly lines: ReadonlyArray<Line>;
  /** The file's first line break: the one a new line is written with. */
  readonly eol: string;
  /** Whether the file mixes the two kinds of line break: then the break of a new line is the writer's own choice. */
  readonly mixed: boolean;
  /** The break after each line, as the file has it (they differ in a file of mixed line ends); none after the last when the file has no final one. */
  readonly breaks: ReadonlyArray<string>;
  readonly final: boolean;
  readonly text: string;
  /** What the file holds. */
  readonly old: unknown;
  /** What the call sets, or none for a remove. */
  readonly next: unknown;
  readonly remove: boolean;
  readonly arrival: Arrival | undefined;
  /** The other settings the file names, for the start's other values. */
  readonly others: ReadonlyArray<Other>;
  /** Lines the answer must still hold, as they were: the header of a table that is now empty. */
  readonly keeps: ReadonlyArray<string>;
  /** Lines the answer may add anywhere, once each: where a value that changed its kind is written again. */
  readonly free: ReadonlyArray<Slot>;
  /** The record is the whole file and the call removes it: nothing is left to keep, so the answer is empty text. */
  readonly alone: boolean;
}

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
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z";

const APPROVER = Setting.make("delivery.approver", Schema.Literals(["people", "robots", "owner"])).pipe(
  Setting.withDefault("people"),
  Setting.withDescription("Who may approve a change request."),
);

const PORT = Setting.make("instance.port", Schema.Int).pipe(
  Setting.withDefault(18787),
  Setting.withDescription("The port the bot listens on."),
);

const LIMIT = Setting.make("gate.limit", Schema.Int).pipe(
  Setting.withDefault(9),
  Setting.withDescription("How many runs the gate lets through."),
);

const rules = (name: string) =>
  Setting.make(name, RulesSchema).pipe(
    Setting.withDefault(DEFAULT),
    Setting.withDescription("What each ref must look like."),
    Setting.files(["repo"]),
  );

const steps = (name: string) =>
  Setting.make(name, StepsSchema).pipe(
    Setting.withDefault([]),
    Setting.withDescription("The steps of a run."),
    Setting.files(["repo"]),
  );

const makeGroup = (app: string, settings: ReadonlyArray<Setting.Any>) => SettingGroup.make(app, ...settings);

export const fileName = (app: string) => `.${app}/${app}.toml`;

/** The breaks of a file: its own line break after each line, the other kind after every second one when the file mixes them. */
const breaksFor = (count: number, eol: string, mixed: boolean, final: boolean): ReadonlyArray<string> =>
  Array.from({ length: count }, (_, i) => {
    if (i === count - 1 && !final) {
      return "";
    }

    return mixed && i % 2 === 1 ? (eol === "\r\n" ? "\n" : "\r\n") : eol;
  });

const render = (lines: ReadonlyArray<Line>, breaks: ReadonlyArray<string>): string =>
  lines.map((line, i) => line.text + (breaks[i] ?? "")).join("");

const quiet = (text: string): boolean => text.trim() === "" || text.trimStart().startsWith("#");

/** Where a section's last line is: right after its last line that holds data, before the blank and comment lines that lead to the next header (the file's end for the last one). */
const sectionEnd = (lines: ReadonlyArray<Line>, header: number): number => {
  const next = lines.findIndex((line, i) => i > header && line.head !== undefined);

  if (next < 0) {
    return lines.length;
  }

  let end = next;

  while (end > header + 1 && quiet(lines[end - 1]?.text ?? "x")) {
    end--;
  }

  return end;
};

/** The texts of a new block under its own header, as the format writes them: the header, a line per key, a block per table. */
const blockTexts = (root: Path, path: Path, value: Rec): ReadonlyArray<string> => [
  `[${dots([...root, ...path])}]`,
  ...entries(value).flatMap(([key, child]) => (nonEmpty(child) ? [] : [`${bare(key)} = ${lit(child)}`])),
  ...entries(value).flatMap(([key, child]) => (nonEmpty(child) ? blockTexts(root, [...path, key], child) : [])),
];

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Where and how a new item is written: its own header after the last block when the items sit under headers, else one inline line at the end of the record's section. */
const arrivalFor = (c: Cx, form: Form, lines: ReadonlyArray<Line>, item: readonly [string, Rec]): Arrival => {
  const [name, value] = item;
  const root = settingPath(c);

  if (form === "c") {
    const last = lines.findLastIndex((line) => line.own.t === "block" && line.head !== undefined);
    const texts = blockTexts(root, [name], value);

    return {
      before: sectionEnd(lines, last),
      slots: texts.map((text) => exact(text)),
      blanks: texts.filter((text) => text.startsWith("[")).length,
      spare: true,
    };
  }

  const header =
    form === "e"
      ? -1
      : lines.findIndex(
          (line) => line.head !== undefined && line.head.join(".") === (form === "d" ? c.table : root.join(".")),
        );

  const spelled: Readonly<Record<Form, string>> = {
    a: "",
    b: "",
    c: "",
    d: `${bare(c.name)}.`,
    e: `${bare(c.table)}.${bare(c.name)}.`,
    f: "",
    g: "",
  };

  const prefix = spelled[form];
  const pattern = new RegExp(`^${escape(`${prefix}${bare(name)}`)} = \\{.*\\}$`, "u");

  return {
    before: sectionEnd(lines, header),
    slots: [
      { label: `a line that writes ${prefix}${bare(name)} as an inline table`, test: (line) => pattern.test(line) },
    ],
    blanks: 0,
    spare: true,
  };
};

/** The record the draw's three items make, `fresh` not in it. */
const itemData = (seed: ItemSeed, lists = false): Rec => ({
  n: seed.leaves[0] ?? 0,
  // At most three keys in an item: the lists of RC4 and RC5 take the place of the second leaf.
  ...(lists ? { list: seed.list } : seed.leaves[1] === undefined ? {} : { m: seed.leaves[1] }),
  ...(seed.desired.length === 0
    ? {}
    : {
        desired: {
          a: seed.desired[0] ?? 0,
          ...(seed.desired[1] === undefined ? {} : { b: seed.desired[1] }),
          ...(seed.deep ? { deep: { c: 1 } } : {}),
        },
      }),
});

export const oldRecord = (draw: Draw, lists = false): Rec =>
  Object.fromEntries(draw.items.map((seed, i) => [`${seed.word}${i}`, itemData(seed, lists)]));

/** The item that arrives. */
const freshItem = (draw: Draw): readonly [string, Rec] => [`${draw.fresh.word}z`, itemData(draw.fresh)];

const names = (old: Rec): ReadonlyArray<string> => Object.keys(old);

/** A leaf made different. */
const bump = (value: Node, delta: number): Node => {
  if (Predicate.isNumber(value)) {
    return value + delta;
  }

  if (Predicate.isString(value)) {
    return `${value}x`;
  }

  return isRec(value) ? value : [...value, delta];
};

/** The record asked for: one key of one item changes (h), one item leaves (i), a new item arrives (j). */
const derive = (
  draw: Draw,
  old: Rec,
  change: { readonly h?: boolean; readonly i?: boolean; readonly j?: boolean },
): Rec => {
  const all = names(old);
  const gone = all[draw.leave % all.length];
  const edited = all[(draw.leave + 1) % all.length];
  const deeper = all[(draw.leave + 2) % all.length];

  const out: Record<string, Node> = {};

  for (const [key, item] of entries(old)) {
    if (change.i === true && key === gone) {
      continue;
    }

    if (change.h === true && isRec(item) && key === edited) {
      // One key of one item changes.
      out[key] = { ...item, n: bump(item["n"] ?? 0, draw.delta) };
    } else if (change.h === true && isRec(item) && key === deeper) {
      // A key inside the table of another item changes, or its first key when it has none.
      const desired = item["desired"];

      out[key] = isRec(desired)
        ? { ...item, desired: { ...desired, a: bump(desired["a"] ?? 0, draw.delta) } }
        : { ...item, n: bump(item["n"] ?? 0, draw.delta) };
    } else {
      out[key] = item;
    }
  }

  if (change.j === true) {
    const [name, item] = freshItem(draw);
    out[name] = item;
  }

  return out;
};

export interface Spec {
  readonly ids: ReadonlyArray<Id>;
  readonly label: string;
  readonly form: Form;
  readonly style: number;
  readonly eol: string;
  readonly final: boolean;
  readonly others?: ReadonlyArray<"before" | "between" | "after">;
  /** The old record, when it is not the draw's. */
  readonly old?: Rec;
  /** The record asked for, or its change; none for a remove. */
  readonly change?: { readonly h?: boolean; readonly i?: boolean; readonly j?: boolean };
  readonly next?: Rec | ReadonlyArray<Node>;
  readonly remove?: boolean;
  readonly multi?: boolean;
  readonly odd?: boolean;
  /** The gap patterns between the groups, instead of the style's. */
  readonly gaps?: ReadonlyArray<string>;
  readonly inner?: "" | "b";
  readonly inside?: boolean;
  /** Which item leaves, instead of the draw's. */
  readonly leave?: number;
  /** The tail comment after each value, instead of the style's. */
  readonly tail?: string;
  /** Where the arrival is looked for (a block form or not); none for no arrival. */
  readonly arrive?: boolean;
  readonly top?: boolean;
  /** One line of another setting above the record and nothing else, so once the record is cut the text holds no line break to copy. */
  readonly lone?: boolean;
  /** Lines the answer must still hold, as they were. */
  readonly keeps?: ReadonlyArray<string>;
  /** Lines the answer may add anywhere, once each. */
  readonly free?: ReadonlyArray<RegExp>;
  /** The file mixes the two kinds of line break, one after another. */
  readonly mixed?: boolean;
  /** The file holds only the record and the call removes it. */
  readonly alone?: boolean;
  /** The first item is written as one inline table, in a record of dotted keys at the root. */
  readonly inlineFirst?: boolean;
  /** The first item is written as dotted keys at the root, before the headers of the others. */
  readonly rootFirst?: boolean;
}

/** A scene from a spec: the file as a person types it, and what the call must do to it. */
export const buildScene = (given: Draw, spec: Spec): Scene => {
  const draw = spec.leave === undefined ? given : { ...given, leave: spec.leave };
  const style = draw.styles[spec.style % draw.styles.length] ?? draw.styles[0];

  const c: Cx = {
    table: draw.table,
    name: draw.name,
    style: {
      ...style,
      ...(spec.inside === undefined ? {} : { inside: spec.inside }),
      ...(spec.inner === undefined ? {} : { inner: spec.inner }),
      ...(spec.tail === undefined ? {} : { tail: spec.tail }),
    },
    odd: spec.odd === true,
    multi: spec.multi === true,
    inlineFirst: spec.inlineFirst === true,
    rootFirst: spec.rootFirst === true,
    n: 0,
  };

  const old = spec.old ?? oldRecord(draw, spec.multi === true);
  const groups = written(c, spec.form, old);
  const around = spec.others ?? [];
  const settleBetween = spec.form === "e" ? [] : around;

  const all: Array<ReadonlyArray<Unit>> = [];

  if (settleBetween.includes("before")) {
    all.push([other(c, "delivery")]);
  }

  const leaveAt = draw.leave % Math.max(groups.length, 1);

  for (const [i, group] of groups.entries()) {
    all.push(group);

    if (settleBetween.includes("between") && groups.length > 1 && i === leaveAt && i < groups.length - 1) {
      all.push([other(c, "instance")]);
    }
  }

  if (around.includes("after") || (settleBetween.includes("between") && groups.length === 1)) {
    all.push([other(c, "gate")]);
  }

  const gaps = spec.gaps ?? c.style.gaps;

  const lines = joined(
    c,
    all,
    (boundary) => gaps[boundary % gaps.length] ?? "",
    spec.lone === true
      ? [{ text: `instance.port${c.style.gap}4100`, own: STAY }]
      : spec.top === true
        ? [
            { text: "# top", own: STAY },
            { text: "", own: STAY },
          ]
        : [],
  );

  const change = spec.change ?? {};
  const next = spec.remove === true ? undefined : (spec.next ?? derive(draw, old, change));

  const arrival =
    change.j === true || spec.arrive === true
      ? arrivalFor(c, spec.rootFirst === true ? "e" : spec.form, lines, freshItem(draw))
      : undefined;

  const breaks = breaksFor(lines.length, spec.eol, spec.mixed === true, spec.final);

  return {
    ids: spec.ids,
    label: spec.label,
    app: draw.app,
    group: makeGroup(draw.app, [rules(`${draw.table}.${draw.name}`), APPROVER, PORT, LIMIT]),
    setting: rules(`${draw.table}.${draw.name}`),
    name: `${draw.table}.${draw.name}`,
    path: settingPath(c),
    lines,
    eol: spec.eol,
    breaks,
    mixed: spec.mixed === true,
    final: spec.final,
    text: render(lines, breaks),
    old,
    next,
    remove: spec.remove === true,
    arrival,
    others: OTHER_KEYS.filter((which) => lines.some((line) => line.head?.join(".") === which)),
    keeps: spec.keeps ?? [],
    alone: spec.alone === true,
    free: (spec.free ?? []).map((pattern): Slot => ({ label: String(pattern), test: (line) => pattern.test(line) })),
  };
};

// ---------------------------------------------------------------------------------------------
// The judge: what an answer must be, from the file and the record asked for.
// ---------------------------------------------------------------------------------------------

/** Whether the record still holds a table at `path` once the call is done. */
const present = (next: unknown, path: Path): boolean =>
  next !== undefined && (path.length === 0 ? isRec(next) : isRec(read(next, path)));

/** The lines an answer must hold, in order, and the blank lines it may add besides. */
const expected = (
  scene: Scene,
): { readonly slots: ReadonlyArray<Slot>; readonly blanks: number; readonly spare: ReadonlyArray<string> } => {
  const { lines, next, old, arrival } = scene;
  const target = scene.remove ? undefined : next;
  const slots: Array<Slot> = [];

  // The value the file already holds, in any spelling or key order: no line changes.
  if (!scene.remove && same(old, next)) {
    return { slots: lines.map((line, i) => exact(line.text, scene.breaks[i])), blanks: 0, spare: [] };
  }

  const spare: Array<string> = [];
  let blanks = 0;
  /** Where the slots stood when a run of lines that leave began with a block's own line, or none. */
  let runAt: number | undefined;
  let running = false;

  const leave = (own: Own, at: number) => {
    if (!running) {
      running = true;
      runAt = own.t === "block" ? at : undefined;
    }
  };

  const keep = () => {
    running = false;
    runAt = undefined;
  };

  const arrive = () => {
    slots.push(...(arrival?.slots ?? []).map((slot): Slot => (scene.mixed ? slot : { ...slot, brk: scene.eol })));
    blanks += arrival?.blanks ?? 0;
    keep();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line === undefined) {
      continue;
    }

    if (arrival?.before === i) {
      arrive();
    }

    const own = line.own;

    if (own.t === "stay") {
      slots.push(exact(line.text, scene.breaks[i]));
      keep();
    } else if (own.t === "block") {
      if (present(target, own.path)) {
        slots.push(exact(line.text, scene.breaks[i]));
        keep();
      } else {
        // A new block written right after the last block's keys leaves behind it the lines that followed them.
        if (arrival?.spare === true && i >= arrival.before) {
          spare.push(line.text);
        }

        leave(own, slots.length);
      }
    } else if (own.t === "key") {
      let end = i + 1;

      while (lines[end]?.own.t === "more") {
        end++;
      }

      const rest = lines.slice(i + 1, end);

      const notes = rest.flatMap((more) =>
        more.own.t === "more" && more.own.note !== undefined ? [more.own.note] : [],
      );

      const ancestors = Array.from({ length: own.path.length }, (_, n) => own.path.slice(0, n));

      if (target === undefined || ancestors.some((ancestor) => !present(target, ancestor))) {
        leave(own, slots.length);
      } else if (read(target, own.path) === undefined) {
        // One key out: its assignment goes; a comment inside its value stays, on a line of its own, and the line's tail stays.
        slots.push(...notes.map((text) => exact(text, scene.mixed ? undefined : scene.eol)));

        if (own.tail === "") {
          blanks++;
        } else {
          slots.push(exact(own.tail, scene.breaks[end - 1]));
        }

        keep();
      } else if (!same(read(old, own.path), read(target, own.path))) {
        slots.push(
          ...notes.map((text) => exact(text, scene.mixed ? undefined : scene.eol)),
          like(own.lead, own.tail, scene.breaks[end - 1]),
        );
        keep();
      } else {
        slots.push(
          exact(line.text, scene.breaks[i]),
          ...rest.map((more, n) => exact(more.text, scene.breaks[i + 1 + n])),
        );
        keep();
      }

      i = end - 1;
    }
  }

  if (arrival?.before === lines.length) {
    arrive();
  }

  // A block that ends the file takes the blank lines right above it.
  if (running && runAt !== undefined && slots.length === runAt) {
    while (slots.length > 0 && slots[slots.length - 1]?.label === '""') {
      slots.pop();
    }
  }

  return { slots, blanks, spare };
};

/** The lines of a text, whatever line break ends each, a final one dropped. */
const splitLines = (text: string): ReadonlyArray<string> => {
  const parts = text.split(/\r?\n/u);

  return parts[parts.length - 1] === "" ? parts.slice(0, -1) : parts;
};

/** The lines of an answer and the break that follows each: none after the last when the text has no final one. */
const withBreaks = (text: string): ReadonlyArray<readonly [string, string]> => {
  const pieces = text.split(/(\r?\n)/u);
  const found: Array<readonly [string, string]> = [];

  for (let i = 0; i < pieces.length; i += 2) {
    const line = pieces[i] ?? "";
    const brk = pieces[i + 1] ?? "";

    if (line !== "" || brk !== "" || i + 2 < pieces.length) {
      found.push([line, brk]);
    }
  }

  return found;
};

/** What is wrong with an answer: each missing line, each line nobody asked for, each line break that is not the file's own. */
export const judge = (scene: Scene, answer: string): ReadonlyArray<string> => {
  // The record was the whole file, line breaks included: every line goes with its own break, so nothing is left, not even a lone break.
  if (scene.alone) {
    return answer === ""
      ? []
      : [`the file held only the record, so the answer is empty text, not ${JSON.stringify(answer)}`];
  }

  const pairs = withBreaks(answer);
  const found = pairs.map(([line]) => line);
  const problems: Array<string> = [];
  const last = pairs.length - 1;

  // The final line break stays as the file had it: a file with none answers with none, one with a final break keeps one.
  if (pairs.length > 0 && (pairs[last]?.[1] !== "") !== scene.final) {
    problems.push(
      scene.final
        ? "the file has a final line break, and the answer has none"
        : "the file has no final line break, and the answer ends with one",
    );
  }

  for (const [i, line] of found.entries()) {
    if (/\r/u.test(line)) {
      problems.push(`line ${i + 1} holds a stray carriage return: ${JSON.stringify(line)}`);
    }
  }

  const { slots, blanks, spare } = expected(scene);
  const used = new Set<number>();
  let at = 0;

  for (const slot of slots) {
    let j = at;

    while (j < found.length && !slot.test(found[j] ?? "")) {
      j++;
    }

    if (j >= found.length) {
      problems.push(`no line ${slot.label} after line ${at}`);
      break;
    }

    // Every line the call did not touch keeps the break it had: another setting's line is the same bytes.
    if (slot.brk !== undefined && j < last && pairs[j]?.[1] !== slot.brk) {
      problems.push(
        `line ${j + 1} ${slot.label} is followed by ${JSON.stringify(pairs[j]?.[1])}, not ${JSON.stringify(slot.brk)}`,
      );
    }

    used.add(j);
    at = j + 1;
  }

  if (problems.length === 0) {
    const left = [...spare];
    const free = [...scene.free];

    const extra = found
      .map((line, j) => ({ line, j }))
      .filter(({ j }) => !used.has(j))
      .filter(({ line, j }) => {
        const at = left.indexOf(line);

        if (at >= 0 && line.trim() !== "") {
          left.splice(at, 1);

          return false;
        }

        const own = free.findIndex((slot) => slot.test(line));

        if (own >= 0 && line.trim() !== "") {
          free.splice(own, 1);

          // A line the call writes ends with the file's own line break, the first one the text has.
          if (!scene.mixed && j < last && pairs[j]?.[1] !== scene.eol) {
            problems.push(
              `the new line ${j + 1} ${JSON.stringify(line)} is followed by ${JSON.stringify(pairs[j]?.[1])}, not ${JSON.stringify(scene.eol)}`,
            );
          }

          return false;
        }

        return true;
      })
      .map(({ line }) => line);

    // A line of spaces is a blank line: a removed last line leaves a space so the file does not gain a final line break.
    const loud = extra.filter((line) => line.trim() !== "");

    if (loud.length > 0) {
      problems.push(`lines nobody asked for: ${JSON.stringify(loud)}`);
    }

    const allowed = blanks + spare.filter((line) => line === "").length;

    if (extra.length > allowed) {
      problems.push(`${extra.length - allowed} more blank lines than a new block or a removed key leaves`);
    }
  }

  return problems.length === 0 ? [] : [...problems, `the answer:\n${JSON.stringify(answer)}`];
};

// ---------------------------------------------------------------------------------------------
// Reading an answer back: which line first names the setting.
// ---------------------------------------------------------------------------------------------

const unquote = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.String));

/** A key's parts: bare words and quoted strings, split at the dots outside quotes. */
const parts = (text: string): ReadonlyArray<string> =>
  [...text.matchAll(/"((?:[^"\\]|\\.)*)"|([A-Za-z0-9_-]+)/gu)].map((match) =>
    match[1] === undefined ? (match[2] ?? "") : unquote(`"${match[1]}"`),
  );

/** Every header and every key of a text, with its full path and its line (from 1). */
const spans = (text: string): ReadonlyArray<{ readonly path: Path; readonly line: number }> => {
  let table: ReadonlyArray<string> = [];
  const found: Array<{ readonly path: Path; readonly line: number }> = [];
  const elements = new Map<string, number>();

  for (const [i, line] of splitLines(text).entries()) {
    const header = /^(\[\[?)\s*(.*?)\s*\]\]?\s*(?:#.*)?$/u.exec(line);
    const key = /^([^#\s[\]{}][^=]*?)\s*=/u.exec(line);

    if (header !== null) {
      const path = parts(header[2] ?? "");
      const count = elements.get(path.join("\u0000")) ?? 0;

      // An array of tables: each element's table is at the array's path and its index, as the parser reads it.
      if (header[1] === "[[") {
        elements.set(path.join("\u0000"), count + 1);
        table = [...path, String(count)];
      } else {
        table = path;
      }

      found.push({ path: table, line: i + 1 });
    } else if (key !== null) {
      found.push({ path: [...table, ...parts(key[1] ?? "")], line: i + 1 });
    }
  }

  return found;
};

/**
 * The line the start gives as a setting's origin (Sources.ts `file`): the line of the header or key at exactly its path,
 * or 0 when no line is at exactly that path (a record named only by the headers of its items, or by dotted keys).
 */
export const originLine = (text: string, path: Path): number =>
  spans(text).find((span) => span.path.length === path.length && span.path.every((word, n) => word === path[n]))
    ?.line ?? 0;

/** Whether some line of the text is at or under `path`. */
export const holds = (text: string, path: Path): boolean =>
  spans(text).some((span) => path.every((word, n) => span.path[n] === word));

// ---------------------------------------------------------------------------------------------
// Arrays: an inline one, and an array of tables written as `[[name]]` blocks.
// ---------------------------------------------------------------------------------------------

interface ArraySpec {
  readonly ids: ReadonlyArray<Id>;
  readonly label: string;
  /** An inline array on a key, or `[[name]]` blocks. */
  readonly form: "inline" | "tables";
  /** What the file holds: records for blocks. */
  readonly old: ReadonlyArray<Node>;
  /** What the call sets. */
  readonly next: unknown;
  /** A blank line between the blocks. */
  readonly sep?: boolean;
  /** A comment line right above the first block. */
  readonly above?: boolean;
  /** An own-line comment inside each block. */
  readonly inside?: boolean;
  readonly multi?: boolean;
  readonly style: number;
  readonly eol: string;
  readonly final: boolean;
  readonly others?: boolean;
  /** The file mixes the two kinds of line break, one after another. */
  readonly mixed?: boolean;
  /** The first block follows another setting's table, so the table it sat in is not its own. */
  readonly behind?: boolean;
  /** The first block sits right under the header of the table that holds it (`[table]`), not at the root. */
  readonly home?: boolean;
  /** The record setting, for a kind change, instead of the steps setting. */
  readonly rules?: boolean;
}

const othersIn = (lines: ReadonlyArray<Line>): ReadonlyArray<Other> =>
  OTHER_KEYS.filter((which) => lines.some((line) => line.head?.join(".") === which));

/** The texts of one element as a `[[name]]` block: its header, a line per key, a block per table inside it. */
const elementTexts = (root: Path, element: Rec): ReadonlyArray<string> => [
  `[[${dots(root)}]]`,
  ...entries(element).flatMap(([key, child]) => (nonEmpty(child) ? [] : [`${bare(key)} = ${lit(child)}`])),
  ...entries(element).flatMap(([key, child]) => (nonEmpty(child) ? blockTexts(root, [key], child) : [])),
];

export const arrayScene = (draw: Draw, spec: ArraySpec): Scene => {
  const style = draw.styles[spec.style % draw.styles.length] ?? draw.styles[0];

  const c: Cx = {
    table: draw.table,
    name: draw.name,
    style,
    odd: false,
    multi: spec.multi === true,
    inlineFirst: false,
    rootFirst: false,
    n: 0,
  };

  const root = settingPath(c);
  const array = spec.old;

  const lines: Array<Line> = [
    { text: "# top", own: STAY },
    { text: "", own: STAY },
  ];

  if (spec.form === "inline") {
    lines.push({ text: `[${bare(c.table)}]`, own: STAY, head: [c.table] });
    lines.push(...assignment(c, bare(c.name), [], array));
  } else {
    if (spec.home === true) {
      lines.push({ text: `[${bare(c.table)}]`, own: STAY, head: [c.table] });
    }

    if (spec.behind === true) {
      lines.push(...other(c, "instance").lines, { text: "", own: STAY });
    }

    if (spec.above === true) {
      lines.push({ text: note(c), own: STAY });
    }

    for (const [i, element] of array.entries()) {
      if (!isRec(element)) {
        continue;
      }

      if (i > 0 && spec.sep === true) {
        lines.push({ text: "", own: block([]) });
      }

      lines.push({ text: `[[${dots(root)}]]`, own: block([]), head: root });

      if (spec.inside === true) {
        lines.push({ text: note(c), own: block([]) });
      }

      for (const [key, child] of entries(element)) {
        if (!nonEmpty(child)) {
          lines.push(...assignment(c, bare(key), [], child).map((line): Line => ({ ...line, own: block([]) })));
        }
      }

      for (const [key, child] of entries(element)) {
        if (nonEmpty(child)) {
          lines.push({ text: `[${dots([...root, key])}]`, own: block([]), head: [...root, key] });

          for (const [name, leaf] of entries(child)) {
            lines.push({ text: `${bare(name)}${c.style.gap}${lit(leaf)}`, own: block([]) });
          }
        }
      }
    }

    // A blank line ends the last block: it goes with it. A file that ends in the block has none.
    if (spec.others === true) {
      lines.push({ text: "", own: block([]) });
    }
  }

  if (spec.others === true) {
    lines.push(...other(c, "delivery").lines);
  }

  const next = spec.next;
  const first = lines.findIndex((line) => line.own.t === "block");
  const elements = Array.isArray(next) ? next : [];
  const asBlocks = elements.length > 0 && elements.every(isRec);

  const arrival: Arrival | undefined =
    spec.form === "tables" && !same(array, next) && first >= 0
      ? asBlocks
        ? {
            before: first,
            slots: elements.flatMap((element) =>
              isRec(element) ? elementTexts(root, element).map((text) => exact(text)) : [],
            ),
            blanks:
              elements.length +
              elements.reduce(
                (count, element) =>
                  count + (isRec(element) ? entries(element).filter(([, child]) => nonEmpty(child)).length : 0),
                0,
              ),
            spare: false,
          }
        : spec.behind === true
          ? {
              // The table the first block sat in is another setting's: the line goes where a new key goes, in a table of its own at the end.
              before: lines.length,
              slots: [
                exact(`[${bare(c.table)}]`),
                {
                  label: "the array on one line",
                  test: (line) => new RegExp(`^${escape(bare(c.name))} = \\[.*\\]$`, "u").test(line),
                },
              ],
              blanks: 1,
              spare: false,
            }
          : {
              before: first,
              slots: [
                {
                  label: "the array on one line",
                  test: (line) =>
                    new RegExp(
                      `^${escape(spec.home === true ? bare(c.name) : `${bare(c.table)}.${bare(c.name)}`)} = \\[.*\\]$`,
                      "u",
                    ).test(line),
                },
              ],
              blanks: 1,
              spare: false,
            }
      : undefined;

  const setting = spec.rules === true ? rules(`${draw.table}.${draw.name}`) : steps(`${draw.table}.${draw.name}`);
  const breaks = breaksFor(lines.length, spec.eol, spec.mixed === true, spec.final);

  return {
    ids: spec.ids,
    label: spec.label,
    app: draw.app,
    group: makeGroup(draw.app, [setting, APPROVER, PORT, LIMIT]),
    setting,
    name: `${draw.table}.${draw.name}`,
    path: root,
    lines,
    eol: spec.eol,
    breaks,
    mixed: spec.mixed === true,
    final: spec.final,
    text: render(lines, breaks),
    old: array,
    next,
    remove: false,
    arrival,
    others: othersIn(lines),
    keeps: [],
    free: [],
    alone: false,
  };
};

/** How many blank lines stand directly above each `[[name]]` header after the first. */
export const separators = (text: string, root: Path): ReadonlyArray<number> => {
  const found = splitLines(text);
  const header = `[[${dots(root)}]]`;
  const at = found.flatMap((line, i) => (line === header ? [i] : []));

  return at.slice(1).map((i) => {
    let blank = 0;

    while (found[i - 1 - blank] === "") {
      blank++;
    }

    return blank;
  });
};

export { rules as rulesSetting, steps as stepsSetting, APPROVER, PORT, LIMIT, makeGroup };

/** A scene as a failure shows it: its label, the file it edits and the record it asks for. */
export const shown = (scene: Scene): string =>
  `${scene.label}\nthe file: ${JSON.stringify(scene.text)}\nthe call: ${scene.remove ? "remove" : `set ${JSON.stringify(scene.next)}`}`;
