// The generators for Frontmatter.set's laws (ticket 1927), all Effect `Arbitrary` values. They reuse the pools Frontmatter.test-support.ts
// draws for ticket 1926 (its text groups, key groups, numbers, body variants and broken files) and add the model of a typed file.
//
// A typed file is a frontmatter as a person types it, built from pieces. Each pair is a slot: its head (everything before the value's text, the
// indent, the key's text, the `:` and the gap), the value's text, its tail (a comment after the value and the line break) and the data it reads
// as. Comment and blank lines between pairs are plain strings. So the model knows each value's text span, and a law can say exactly which bytes
// may change.
//
// The plan names 26 classes, (a) to (z). A class is a list of forms, `FORMS`. Every case carries the forms its pieces hold, a law keeps the forms of the
// cases it checked, and a law fails when a class has a form that no checked case held (`unreached`), so no class is left to chance.
import { Effect, Equal, Predicate, Result, Schema } from "effect";
import * as Base from "./Frontmatter.test-support.ts";
import * as Frontmatter from "./Frontmatter.ts";

export type Json = Base.Json;

// ---------------------------------------------------------------------------------------------------------------------
// The model of a typed file

interface Slot {
  readonly key: string;
  readonly form: string;
  /** 0 is set to a scalar, 1 to a list or map, 2 is kept. */
  readonly copy: number;
  readonly head: string;
  readonly value: string;
  readonly tail: string;
  readonly data: Json;
}

type Item = string | Slot;

export interface Typed {
  /** The fence line that opens the frontmatter and closes it. */
  readonly fence: string;
  readonly items: ReadonlyArray<Item>;
  /** The top level is a flow map. */
  readonly flow: boolean;
  /** The column of the first key. */
  readonly column: number;
  /** The forms this file holds beyond its slots'. */
  readonly forms: ReadonlyArray<string>;
}

const isSlot = (item: Item): item is Slot => !Predicate.isString(item);

export const slots = (typed: Typed): ReadonlyArray<Slot> => typed.items.filter(isSlot);

const frontmatterText = (typed: Typed): string =>
  typed.items.map((item) => (isSlot(item) ? item.head + item.value + item.tail : item)).join("");

export const fileText = (typed: Typed, body: string): string =>
  `${typed.fence}${frontmatterText(typed)}${typed.fence}${body}`;

export const dataRead = (typed: Typed): Record<string, Json> =>
  Object.fromEntries(slots(typed).map((slot) => [slot.key, slot.data]));

export interface Span {
  readonly from: number;
  readonly to: number;
  readonly slot: Slot;
}

/** Where each pair's value text is in the frontmatter, by key. */
export const spansIn = (typed: Typed): ReadonlyMap<string, Span> => {
  const spans = new Map<string, Span>();
  let offset = 0;

  for (const item of typed.items) {
    if (isSlot(item)) {
      const from = offset + item.head.length;

      spans.set(item.key, { from, to: from + item.value.length, slot: item });
      offset = from + item.value.length + item.tail.length;
    } else {
      offset += item.length;
    }
  }

  return spans;
};

/** Where the lines or pairs of a key the file lacks go: the end of the frontmatter, or inside a flow map after its last value. */
const insertionPoint = (typed: Typed): number => {
  if (!typed.flow) {
    return frontmatterText(typed).length;
  }

  const last = [...spansIn(typed).values()].at(-1);

  return last === undefined ? 1 : last.to;
};

export interface Style {
  readonly indent: number;
  readonly crlf: boolean;
}

const LF: Style = { indent: 0, crlf: false };

// `«` and `»` mark the value's text inside a template, and `§` the key's place.
const slotFrom = (
  text: string,
  made: { readonly key: string; readonly data: Json },
  form: string,
  copy: number,
  style: Style,
): Slot => {
  const indented = style.indent === 0 ? text : text.replace(/^(?!»|$)/gm, " ".repeat(style.indent));
  const [head = "", value = "", tail = ""] = indented.split(/[«»]/u);
  const crlf = (piece: string): string => (style.crlf ? piece.replaceAll("\n", "\r\n") : piece);

  return { key: made.key, form, copy, head: crlf(head), value: crlf(value), tail: crlf(tail), data: made.data };
};

export const fenceFor = (style: Style): string => (style.crlf ? "---\r\n" : "---\n");

// ---------------------------------------------------------------------------------------------------------------------
// The forms an old value can have: classes (a) to (l)

interface Made {
  readonly text: string;
  readonly key: string;
  readonly data: Json;
}

interface Member {
  readonly cls: string;
  readonly form: string;
  readonly make: (key: string, copy: number) => Made | undefined;
}

const member = (cls: string, label: string, text: string, data: Json): Member => ({
  cls,
  form: `${cls}:${label}`,
  make: (key) => ({ text: text.replaceAll("§", key), key, data }),
});

const LINES = ["one", "two", "three"];

// One to three content lines; the last member of its class is a block scalar, so the last value before the closing fence is one.
const blockScalar = (header: string): Member => ({
  cls: "c",
  form: `c:${header}`,
  make: (key, copy) => {
    const lines = LINES.slice(0, 1 + (copy % 3));
    const joined = header.startsWith(">") ? lines.join(" ") : lines.join("\n");

    return {
      text: `${key}: «${header}\n${lines.map((line) => `  ${line}\n`).join("")}»`,
      key,
      data: header.endsWith("-") ? joined : `${joined}\n`,
    };
  },
});

const OLD: ReadonlyArray<Member> = [
  member("a", "word", "§: «word»\n", "word"),
  member("a", "87", "§: «87»\n", 87),
  member("a", "0146", "§: «0146»\n", 146),
  member("a", "-1.5", "§: «-1.5»\n", -1.5),
  member("a", "true", "§: «true»\n", true),
  member("a", "false", "§: «false»\n", false),
  member("a", "~", "§: «~»\n", null),
  member("a", "null", "§: «null»\n", null),
  member("a", "two words here", "§: «two words here»\n", "two words here"),
  member("b", "'x'", "§: «'x'»\n", "x"),
  member("b", "'it''s'", "§: «'it''s'»\n", "it's"),
  member("b", "''", "§: «''»\n", ""),
  member("b", '"x"', '§: «"x"»\n', "x"),
  member("b", '"a\\"b"', '§: «"a\\"b"»\n', 'a"b'),
  member("b", '"tab\\there"', '§: «"tab\\there"»\n', "tab\there"),
  member("b", '""', '§: «""»\n', ""),
  blockScalar(">"),
  blockScalar(">-"),
  blockScalar("|"),
  blockScalar("|-"),
  blockScalar("|+"),
  member("d", "[a, b]", "§: «[a, b]»\n", ["a", "b"]),
  member("d", "[ a,b ]", "§: «[ a,b ]»\n", ["a", "b"]),
  member("d", "[]", "§: «[]»\n", []),
  member("d", "{x: 1}", "§: «{x: 1}»\n", { x: 1 }),
  member("d", "{ }", "§: «{ }»\n", {}),
  member("d", "[a, [b, c]]", "§: «[a, [b, c]]»\n", ["a", ["b", "c"]]),
  member("d", "{x: [1, {y: 2}]}", "§: «{x: [1, {y: 2}]}»\n", { x: [1, { y: 2 }] }),
  member("d", "[a,\\n  b]", "§: «[a,\n  b]»\n", ["a", "b"]),
  member("e", "indented", "§:\n  «- a\n  - b\n»", ["a", "b"]),
  member("e", "indented list in list", "§:\n  «- - a\n    - b\n  - c\n»", [["a", "b"], "c"]),
  member("e", "indented list of maps", "§:\n  «- x: 1\n    y: 2\n  - x: 3\n»", [{ x: 1, y: 2 }, { x: 3 }]),
  member("e", "compact", "§:\n«- a\n- b\n»", ["a", "b"]),
  member("e", "compact list in list", "§:\n«- - a\n  - b\n- c\n»", [["a", "b"], "c"]),
  member("e", "compact list of maps", "§:\n«- x: 1\n  y: 2\n- x: 3\n»", [{ x: 1, y: 2 }, { x: 3 }]),
  member("f", "one level", "§:\n  «x: 1\n  y: 2\n»", { x: 1, y: 2 }),
  member("f", "two levels", "§:\n  «x:\n    z: 1\n  y: 2\n»", { x: { z: 1 }, y: 2 }),
  member("g", "k:", "§:«»\n", null),
  member("g", "k: ", "§:«» \n", null),
  member("g", "k: # note", "§:«» # note\n", null),
  member("h", "text", "§:\n  «text»\n", "text"),
  member("h", '"q"', '§:\n  «"q"»\n', "q"),
  member("h", "# note then a list", "§:\n  # note\n  «- a\n»", ["a"]),
  member("h", "a then b", "§: «a\n  b»\n", "a b"),
  member("i", "one space", "§: «1» # c\n", 1),
  member("i", "three spaces", "§: «[a, b]»   # c\n", ["a", "b"]),
  member("i", "a tab", '§: «"x"»\t# c\n', "x"),
  member("j", "comment inside a list", "§:\n  «- a\n  # inner\n  - b\n»", ["a", "b"]),
  member("j", "comment after a map", "§:\n  «x: 1\n»# after\n", { x: 1 }),
  member("k", "!!str 87", "§: «!!str 87»\n", "87"),
  member("k", "!!int 3", "§: «!!int 3»\n", 3),
  member("k", "!!str alone", "§: «!!str»\n", ""),
  member("k", "an unused anchor", "§: «&§ 1»\n", 1),
  member("k", "an alias", "§: «*b»\n", [1]),
  {
    cls: "l",
    form: "l:double-quoted",
    make: (_, copy) => ({ text: `"q k${copy}": «1»\n`, key: `q k${copy}`, data: 1 }),
  },
  {
    cls: "l",
    form: "l:single-quoted",
    make: (_, copy) => ({ text: `'s k${copy}': «1»\n`, key: `s k${copy}`, data: 1 }),
  },
  {
    cls: "l",
    form: "l:explicit",
    make: (_, copy) => ({ text: `? long${copy}\n: «1»\n`, key: `long${copy}`, data: 1 }),
  },
  {
    cls: "l",
    form: "l:plain with a space",
    make: (_, copy) => ({ text: `p q${copy}: «1»\n`, key: `p q${copy}`, data: 1 }),
  },
  {
    cls: "l",
    form: "l:number",
    make: (_, copy) => ({ text: `${9001 + copy}: «1»\n`, key: String(9001 + copy), data: 1 }),
  },
  {
    cls: "l",
    form: "l:boolean",
    make: (_, copy) =>
      copy > 1
        ? undefined
        : { text: `${copy === 0 ? "true" : "false"}: «1»\n`, key: copy === 0 ? "true" : "false", data: 1 },
  },
];

// A line a value's anchor sits on, for an alias value.
const ANCHOR: Slot = {
  key: "anch",
  form: "k:an anchor",
  copy: 2,
  head: "anch: ",
  value: "&b [1]",
  tail: "\n",
  data: [1],
};

const KEY_GROUP_IDS = [...Base.TEXT_GROUPS, ...Base.KEY_GROUPS].map((group) => group.id);

/** Keys from every group of 1926, written as explicit keys: a key may hold anything, and over 1,024 characters it must be one. */
const groupKeyMembers = (seeds: ReadonlyArray<Base.Seed>): ReadonlyArray<Member> =>
  [...Base.TEXT_GROUPS, ...Base.KEY_GROUPS].flatMap((group) => {
    const pool = group.pool(seeds);

    return [...new Set([pool[0], pool.at(-1)])]
      .filter((text): text is string => text !== undefined)
      .map((text): Member => ({
        cls: "l",
        form: `l:group-${group.id}`,
        make: (_, copy) => {
          const key = `${text}${copy === 0 ? "" : copy}`;

          // A long key is kept in one copy only, to keep the file small.
          return copy === 2 && text.length > 200
            ? undefined
            : { text: `? ${JSON.stringify(key)}\n: «1»\n`, key, data: 1 };
        },
      }));
  });

// ---------------------------------------------------------------------------------------------------------------------
// The forms of every class: what a case holds

const range = (from: number, to: number): ReadonlyArray<number> =>
  Array.from({ length: to - from }, (_, i) => from + i);

const formsInClass = (cls: string): ReadonlyArray<string> => [
  ...new Set(OLD.filter((m) => m.cls === cls).map((m) => m.form)),
];

const FLOW_FILES = ["{a: 1, b: [2]}", "{a: 1,}", "{}"];

const NO_PAIR_FILES = ["empty", "blank lines", "comments only"];

const BODY_COUNT = Base.bodyVariants([]).length;

/** Every class of the plan and the forms it is made of. A class is reached by a law only when every form was in a case the law checked. */
export const FORMS: Readonly<Record<string, ReadonlyArray<string>>> = {
  a: formsInClass("a"),
  b: formsInClass("b"),
  c: formsInClass("c"),
  d: formsInClass("d"),
  e: formsInClass("e"),
  f: formsInClass("f"),
  g: formsInClass("g"),
  h: formsInClass("h"),
  i: formsInClass("i"),
  j: [...formsInClass("j"), "j:comment lines"],
  k: [...formsInClass("k"), "k:an anchor"],
  l: [...formsInClass("l"), ...KEY_GROUP_IDS.map((id) => `l:group-${id}`)],
  m: ["m:indented"],
  n: FLOW_FILES.map((file) => `n:${file}`),
  o: ["o:crlf"],
  p: NO_PAIR_FILES.map((file) => `p:${file}`),
  q: ["q:null", "q:true", "q:false", "q:numbers", ...Base.TEXT_GROUPS.map((group) => `q:text-${group.id}`)],
  r: ["r:empty", "r:flat", "r:three deep", "r:maps", "r:60"],
  s: ["s:empty", "s:three deep", ...KEY_GROUP_IDS.map((id) => `s:keys-${id}`)],
  t: ["t:same", "t:text of a number"],
  u: ["u:alone", "u:beside", "u:two"],
  v: ["v:one", "v:two to five", "v:every"],
  w: ["w:value", "w:file"],
  x: ["x:alias", "x:duplicate anchor", "x:nested anchor", "x:end marker", "x:no colon"],
  y: ["y:bare", "y:broken", "y:unread"],
  z: range(0, BODY_COUNT).map((i) => `z:${i}`),
};

/** The classes a law must reach whose forms are not all in `seen`. */
export const unreached = (seen: ReadonlySet<string>, classes: ReadonlyArray<string>): ReadonlyArray<string> =>
  classes.filter((cls) => (FORMS[cls] ?? []).some((form) => !seen.has(form)));

export const OLD_CLASSES = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];

export const SET_CLASSES = ["m", "n", "o", "p", "q", "r", "s", "t", "u", "v"];

// ---------------------------------------------------------------------------------------------------------------------
// Building a case

export interface SetCase {
  readonly name: string;
  readonly typed: Typed;
  /** What a call sets, typed data of S1. */
  readonly values: Readonly<Record<string, Json>>;
  readonly body: string;
  /** Every form this case holds, so a law that checks it has reached them. */
  readonly forms: ReadonlyArray<string>;
}

const formsOfCase = (typed: Typed, extra: ReadonlyArray<string>): ReadonlyArray<string> => [
  ...slots(typed).map((slot) => slot.form),
  ...typed.forms,
  ...extra,
];

const FILLS = ["", "\n", "", "\n\n"];

interface Fills {
  readonly top: string;
  readonly between: (i: number) => string;
  readonly end: string;
}

const BLANKS: Fills = { top: "", between: (i) => at(FILLS, i), end: "" };

const COMMENTS: Fills = {
  top: "# top\n\n",
  between: (i) => (i % 2 === 0 ? "# between\n" : "\n# between\n\n"),
  end: "# end\n\n",
};

const at = <A>(list: ReadonlyArray<A>, n: number): A => {
  const found = list[n % list.length];

  if (found === undefined) {
    throw new Error("an empty list");
  }

  return found;
};

// Slots of `members`, three copies of each: the kept ones first, the ones set to a list or map, then the ones set to a scalar, so the
// last pair of the file is one that a call sets.
const slotsOfMembers = (
  members: ReadonlyArray<Member>,
  style: Style,
  extra: ReadonlyArray<Slot> = [],
  copies: ReadonlyArray<number> = [2, 1, 0],
): ReadonlyArray<Slot> => {
  const taken = new Set<string>(extra.map((slot) => slot.key));
  const made: Array<Slot> = [];
  let n = 0;

  for (const copy of copies) {
    for (const m of members) {
      const one = m.make(`k${n}`, copy);

      n += 1;

      if (one !== undefined && !taken.has(one.key)) {
        taken.add(one.key);
        made.push(slotFrom(one.text, one, m.form, copy, style));
      }
    }
  }

  return made;
};

const assemble = (all: ReadonlyArray<Slot>, fills: Fills, style: Style): ReadonlyArray<Item> => {
  const items: Array<Item> = [];

  if (fills.top !== "") {
    items.push(style.crlf ? fills.top.replaceAll("\n", "\r\n") : fills.top);
  }

  all.forEach((slot, i) => {
    items.push(slot);

    // A keep-chomped block scalar (`|+`) takes the blank lines after it as its own text, so nothing is put there.
    const last = i === all.length - 1;
    const between = slot.value.startsWith("|+") ? "" : last ? fills.end : fills.between(i);

    if (between !== "") {
      items.push(style.crlf ? between.replaceAll("\n", "\r\n") : between);
    }
  });

  return items;
};

const typedFrom = (
  members: ReadonlyArray<Member>,
  style: Style,
  fills: Fills,
  forms: ReadonlyArray<string> = [],
  extra: ReadonlyArray<Slot> = [],
  copies: ReadonlyArray<number> = [2, 1, 0],
): Typed => ({
  fence: fenceFor(style),
  items: assemble([...extra, ...slotsOfMembers(members, style, extra, copies)], fills, style),
  flow: false,
  column: style.indent,
  forms,
});

// ---------------------------------------------------------------------------------------------------------------------
// What a call sets

const SCALARS = (run: Base.Run): ReadonlyArray<Json> => [
  "new",
  "true",
  " padded ",
  "a: b # c",
  "0146",
  "two\nlines",
  5,
  -1.5,
  true,
  false,
  null,
  ...Base.mixedTexts(run.seeds),
];

const COLLECTIONS = (run: Base.Run): ReadonlyArray<Json> => {
  const pools = Base.dataVariants(run.seeds)[0]?.pools;

  const random =
    pools === undefined
      ? []
      : Object.values(Base.jsonData(run.json, pools)).filter((v) => Predicate.isObjectOrArray(v));

  return [["a", "b"], { x: 1 }, [["a"], ["b"]], [{ k: 1 }], { a: { b: { c: 1 } } }, [], {}, [1, [2, [3]]], ...random];
};

const differing = (old: Json, pool: ReadonlyArray<Json>, start: number): Json => {
  for (let i = 0; i < pool.length; i += 1) {
    const candidate = at(pool, start + i);

    if (!Equal.equals(candidate, old)) {
      return candidate;
    }
  }

  return "different";
};

/** Each pair that is not kept gets a value the file does not hold: a scalar for copy 0 and a list or map for copy 1. */
const valuesFor = (all: ReadonlyArray<Slot>, run: Base.Run): Readonly<Record<string, Json>> => {
  const scalars = SCALARS(run);
  const collections = COLLECTIONS(run);
  const pick = run.picks[0] ?? 0;

  return Object.fromEntries(
    all.flatMap((slot, i): ReadonlyArray<readonly [string, Json]> =>
      slot.copy === 2 ? [] : [[slot.key, differing(slot.data, slot.copy === 0 ? scalars : collections, pick + i * 7)]],
    ),
  );
};

const BODIES = (run: Base.Run): ReadonlyArray<string> => [
  "# Body\n",
  ...Base.bodyVariants(run.seeds).map((variant) => variant.body),
];

const bodyAt = (run: Base.Run, n: number): string => at(BODIES(run), (run.picks[1] ?? 0) + n);

const makeCase = (
  name: string,
  typed: Typed,
  values: Readonly<Record<string, Json>>,
  run: Base.Run,
  n: number,
  extra: ReadonlyArray<string> = [],
): SetCase => ({
  name,
  typed,
  values,
  body: bodyAt(run, n),
  forms: formsOfCase(typed, extra),
});

const membersIn = (cls: string, run: Base.Run): ReadonlyArray<Member> => [
  ...OLD.filter((m) => m.cls === cls),
  ...(cls === "l" ? groupKeyMembers(run.seeds) : []),
];

// A few members of every class, for the files that mix forms.
const MIX_FORMS = [
  "a:word",
  "a:87",
  "b:'x'",
  'b:"x"',
  "c:>",
  "c:|+",
  "d:[a, b]",
  "d:[a,\\n  b]",
  "e:indented",
  "e:compact",
  "f:one level",
  "g:k: # note",
  "h:text",
  "h:# note then a list",
  "i:one space",
  "j:comment inside a list",
  "k:!!str 87",
  "k:an alias",
  "l:explicit",
];

const MIX = (): ReadonlyArray<Member> => OLD.filter((m) => MIX_FORMS.includes(m.form));

const oldClassCase = (cls: string, run: Base.Run, n: number): SetCase => {
  const members = membersIn(cls, run);
  const comments = cls === "j" ? COMMENTS : BLANKS;
  const typed = typedFrom(members, LF, comments, cls === "j" ? ["j:comment lines"] : [], cls === "k" ? [ANCHOR] : []);

  return makeCase(`class ${cls}`, typed, valuesFor(slots(typed), run), run, n);
};

const commentsCase = (run: Base.Run, n: number): SetCase => {
  const members = OLD.filter((m) => m.cls === "j" || m.cls === "a" || m.cls === "d");
  const typed = typedFrom(members, LF, COMMENTS, ["j:comment lines"]);

  return makeCase("comment lines", typed, valuesFor(slots(typed), run), run, n);
};

// Class (m): a top-level map indented two spaces. Class (o): CRLF.
const styled = (name: string, style: Style, form: string, run: Base.Run, n: number): SetCase => {
  const typed = typedFrom(
    MIX(),
    style,
    BLANKS,
    [form],
    [ANCHOR].map((slot) => slotFrom(`${slot.head}«${slot.value}»${slot.tail}`, slot, slot.form, 2, style)),
  );

  return makeCase(name, typed, { ...valuesFor(slots(typed), run), "fresh one": "x", "fresh two": [1] }, run, n);
};

// Class (n): a flow map at the top, with a trailing comma, and an empty one.
const flowFile = (file: string): Typed => {
  const pair = (key: string, value: string, tail: string, data: Json): Slot => ({
    key,
    form: "",
    copy: 0,
    head: `${key}: `,
    value,
    tail,
    data,
  });

  const items = (): ReadonlyArray<Item> => {
    if (file === "{a: 1, b: [2]}") {
      return ["{", pair("a", "1", ", ", 1), pair("b", "[2]", "", [2]), "}\n"];
    }

    return file === "{a: 1,}" ? ["{", pair("a", "1", "", 1), ",}\n"] : ["{}\n"];
  };

  return { fence: "---\n", items: items(), flow: true, column: 0, forms: [`n:${file}`] };
};

// Class (p): no pair.
const noPairFile = (file: string): Typed => ({
  fence: "---\n",
  items: file === "empty" ? [] : [file === "blank lines" ? "\n\n" : "# only\n# comments\n"],
  flow: false,
  column: 0,
  forms: [`p:${file}`],
});

const sideCase = (typed: Typed, name: string, run: Base.Run, n: number): SetCase => {
  const all = slots(typed);

  return makeCase(
    name,
    typed,
    {
      ...Object.fromEntries(
        all.map((slot, i) => [slot.key, differing(slot.data, SCALARS(run), (run.picks[2] ?? 0) + i)]),
      ),
      c: 3,
      d: [{ e: 1 }],
    },
    run,
    n,
  );
};

// Class (q): scalars of every JSON kind over a plain old value; texts from every text group.
const scalarCase = (run: Base.Run, n: number): SetCase => {
  // The first pieces of each group, and the pieces drawn for this run.
  const texts = Base.TEXT_GROUPS.flatMap((group) => {
    const pool = group.pool(run.seeds);

    return [...pool.slice(0, 8), ...pool.slice(-6)].map((text) => [group.id, text] as const);
  });

  const list: ReadonlyArray<readonly [string, Json]> = [
    ["null", null],
    ["true", true],
    ["false", false],
    ...Base.NUMBERS.map((number): readonly [string, Json] => ["numbers", number]),
    ...texts.map(([id, text]): readonly [string, Json] => [`text-${id}`, text]),
  ];

  const typed: Typed = {
    fence: "---\n",
    items: list.map((_, i) => ({
      key: `k${i}`,
      form: "q:old",
      copy: 0,
      head: `k${i}: `,
      value: "old",
      tail: "\n",
      data: "old",
    })),
    flow: false,
    column: 0,
    forms: [],
  };

  return makeCase(
    "scalars",
    typed,
    Object.fromEntries(list.map(([, value], i) => [`k${i}`, value])),
    run,
    n,
    list.map(([form]) => `q:${form}`),
  );
};

const keyedMap = (seeds: ReadonlyArray<Base.Seed>): Record<string, Json> =>
  Object.fromEntries(
    [...Base.TEXT_GROUPS, ...Base.KEY_GROUPS].flatMap((group) =>
      group
        .pool(seeds)
        .slice(0, 3)
        .map((key, i) => [key, i]),
    ),
  );

const LIST_VALUES: ReadonlyArray<readonly [string, Json]> = [
  ["r:empty", []],
  ["r:flat", ["a", "b", 1, null]],
  ["r:three deep", [[[["x"]]], [[[]]]]],
  ["r:maps", [{ a: 1 }, { b: [2, { c: 3 }] }]],
  ["r:60", Array.from({ length: 60 }, (_, i) => `item ${i}`)],
];

// A file with every old form in `members` once for each new value, and the values: a pair is set to its own new value.
const grid = (
  members: ReadonlyArray<Member>,
  news: ReadonlyArray<Json>,
): { readonly typed: Typed; readonly values: Readonly<Record<string, Json>> } => {
  const made: Array<Slot> = [];
  const values: Array<readonly [string, Json]> = [];

  members.forEach((m, mi) => {
    news.forEach((value, ni) => {
      const one = m.make(`g${mi}x${ni}`, ni);

      if (one !== undefined) {
        made.push(slotFrom(one.text, one, m.form, 0, LF));
        values.push([one.key, value]);
      }
    });
  });

  return {
    typed: { fence: "---\n", items: made, flow: false, column: 0, forms: [] },
    values: Object.fromEntries(values),
  };
};

const GRID_FORMS = [
  "a:word",
  "d:[a, b]",
  "e:indented",
  "e:compact",
  "f:one level",
  "g:k:",
  "g:k: # note",
  "h:text",
  "c:|",
];

const GRID_MEMBERS = OLD.filter((m) => GRID_FORMS.includes(m.form));

// Classes (r) and (s): a list or map over each kind of old value, so over every place a new value goes.
const collectionCase = (run: Base.Run, n: number): SetCase => {
  const news: ReadonlyArray<readonly [string, Json]> = [
    ...LIST_VALUES,
    ["s:empty", {}],
    ["s:three deep", { a: { b: { c: { d: 1 } } } }],
    ["s:keys", keyedMap(run.seeds)],
  ];

  const { typed, values } = grid(
    GRID_MEMBERS,
    news.map(([, value]) => value),
  );

  const keys = KEY_GROUP_IDS.map((id) => `s:keys-${id}`);

  return makeCase("collections", typed, values, run, n, [
    ...LIST_VALUES.map(([form]) => form),
    "s:empty",
    "s:three deep",
    ...keys,
  ]);
};

// Classes (t), (u) and (v): the same file, with the values a call may give.
const BASE_FORMS = [
  "a:word",
  "a:87",
  "a:true",
  "b:'x'",
  'b:"x"',
  "d:[a, b]",
  "d:{x: 1}",
  "e:indented",
  "e:compact",
  "f:one level",
  "g:k: # note",
  "h:text",
  "i:one space",
  "k:!!str 87",
  "k:an alias",
];

const baseFile = (): Typed =>
  typedFrom(
    OLD.filter((m) => BASE_FORMS.includes(m.form)),
    LF,
    BLANKS,
    [],
    [ANCHOR],
    [2, 0],
  );

const planCases = (run: Base.Run, n: number): ReadonlyArray<SetCase> => {
  const typed = baseFile();
  const set = slots(typed).filter((slot) => slot.copy === 0);
  const pool = SCALARS(run);
  const fresh = (name: string, i: number): readonly [string, Json] => [name, at(pool, (run.picks[3] ?? 0) + i)];

  const change = (slot: Slot, i: number): readonly [string, Json] => [
    slot.key,
    differing(slot.data, pool, (run.picks[4] ?? 0) + i),
  ];

  const many = 2 + ((run.picks[5] ?? 0) % 4);

  const plans: ReadonlyArray<readonly [string, ReadonlyArray<string>, ReadonlyArray<readonly [string, Json]>]> = [
    ["one key", ["v:one"], set.slice(0, 1).map(change)],
    ["two to five keys", ["v:two to five"], set.slice(0, many).map(change)],
    ["every key", ["v:every", "u:two"], [...slots(typed).map(change), fresh("fresh one", 1), fresh("fresh two", 2)]],
    ["a key the file lacks, alone", ["u:alone"], [fresh("fresh one", 3)]],
    [
      "a key the file lacks, beside replaced keys",
      ["u:beside"],
      [...set.slice(0, 2).map(change), fresh("fresh one", 4)],
    ],
    ["two keys the file lacks", ["u:two"], [fresh("fresh one", 5), fresh("fresh two", 6)]],
  ];

  return plans.map(([name, forms, values], i) => makeCase(name, typed, Object.fromEntries(values), run, n + i, forms));
};

/** Class (t): values the file already holds. */
const sameCase = (run: Base.Run, n: number): SetCase => {
  const typed = baseFile();
  const some = slots(typed).filter((_, i) => i % 2 === (run.picks[0] ?? 0) % 2);

  return makeCase("the same values", typed, Object.fromEntries(some.map((slot) => [slot.key, slot.data])), run, n, [
    "t:same",
  ]);
};

export const casesFor = (run: Base.Run): ReadonlyArray<SetCase> => [
  ...OLD_CLASSES.map((cls, i) => oldClassCase(cls, run, i)),
  commentsCase(run, 12),
  styled("indented map", { indent: 2, crlf: false }, "m:indented", run, 13),
  styled("crlf file", { indent: 0, crlf: true }, "o:crlf", run, 14),
  ...FLOW_FILES.map((file, i) => sideCase(flowFile(file), `flow map ${file}`, run, 15 + i)),
  ...NO_PAIR_FILES.map((file, i) => sideCase(noPairFile(file), `no pair: ${file}`, run, 18 + i)),
  scalarCase(run, 21),
  collectionCase(run, 22),
  ...planCases(run, 23),
  sameCase(run, 30),
];

/** Every class's cases: typed files with the values a call sets, for the laws about bytes and about reading back. */
export const typedSets = casesFor;

// ---------------------------------------------------------------------------------------------------------------------
// What a law may ask of a call: which bytes changed, where, and what was written

/** The keys a call changes: those the file has, with another value. */
export const changedKeys = (typed: Typed, values: Readonly<Record<string, Json>>): ReadonlyArray<string> => {
  const old = dataRead(typed);

  return Object.keys(values).filter((key) => Object.hasOwn(old, key) && !Equal.equals(old[key], values[key]));
};

/** The keys a call adds: those the file lacks. */
export const addedKeys = (typed: Typed, values: Readonly<Record<string, Json>>): ReadonlyArray<string> =>
  Object.keys(values).filter((key) => !Object.hasOwn(dataRead(typed), key));

export interface Written {
  /** The keys whose value text this is the new text of; none for the lines of added keys. */
  readonly keys: ReadonlyArray<string>;
  readonly text: string;
}

/**
 * Cuts the answer's frontmatter along the old one: every byte outside the changed values' text, in order, is the old byte.
 * Gives the new text of each cut, or why the answer is not the old text with only those cuts changed.
 */
export const keeps = (
  typed: Typed,
  answer: string,
  changed: ReadonlyArray<string>,
  added: boolean,
): Result.Result<ReadonlyArray<Written>, string> => {
  const old = frontmatterText(typed);
  const spans = spansIn(typed);
  const cuts: Array<{ from: number; to: number; keys: ReadonlyArray<string> }> = [];

  for (const key of changed) {
    const span = spans.get(key);

    if (span === undefined) {
      return Result.fail(`${JSON.stringify(key)} is not a key of the file`);
    }

    cuts.push({ from: span.from, to: span.to, keys: [key] });
  }

  if (added) {
    const at = insertionPoint(typed);

    cuts.push({ from: at, to: at, keys: [] });
  }

  cuts.sort((a, b) => a.from - b.from || a.to - b.to);

  const merged: Array<{ from: number; to: number; keys: ReadonlyArray<string> }> = [];

  for (const cut of cuts) {
    const last = merged.at(-1);

    if (last !== undefined && last.to === cut.from) {
      merged[merged.length - 1] = { from: last.from, to: cut.to, keys: [...last.keys, ...cut.keys] };
    } else {
      merged.push(cut);
    }
  }

  if (merged.length === 0) {
    return answer === old ? Result.succeed([]) : Result.fail("the text changed, though no value did");
  }

  const segments = [old.slice(0, merged[0]?.from), ...merged.map((cut, i) => old.slice(cut.to, merged[i + 1]?.from))];

  const first = segments[0] ?? "";

  if (!answer.startsWith(first)) {
    return Result.fail(
      `the start changed: ${JSON.stringify(answer.slice(0, first.length))} is not ${JSON.stringify(first)}`,
    );
  }

  const written: Array<Written> = [];
  let cursor = first.length;

  for (const [i, cut] of merged.entries()) {
    const next = segments[i + 1] ?? "";
    const end = i === merged.length - 1 ? answer.length - next.length : answer.indexOf(next, cursor);

    if (end < cursor || (i === merged.length - 1 && !answer.endsWith(next))) {
      return Result.fail(`the bytes after the ${i + 1}th change were not kept: ${JSON.stringify(next)}`);
    }

    written.push({ keys: cut.keys, text: answer.slice(cursor, end) });
    cursor = end + next.length;
  }

  return Result.succeed(written);
};

/** The lines of the keys a call adds, as the plan says they are written: as `write` writes the pairs, at the first key's column, with the file's line break. */
export const appendedText = (
  typed: Typed,
  values: Readonly<Record<string, Json>>,
  added: ReadonlyArray<string>,
): string => {
  const written = Frontmatter.write(
    { data: Object.fromEntries(added.map((key) => [key, values[key] ?? null])), body: "" },
    Schema.JsonObject,
  );

  const yaml = Result.getOrThrow(written).slice(4, -4);
  const indented = yaml.replace(/^(?!$)/gm, " ".repeat(typed.column));

  return typed.fence === "---\r\n" ? indented.replaceAll("\n", "\r\n") : indented;
};

/** Where a pair's old value is: on the key's line, on a later line, or nowhere. */
export interface Place {
  readonly kind: "empty" | "inline" | "below";
  /** For a later line, the column the old value starts at. */
  readonly column: number;
  /** An old list that starts at its key's column. */
  readonly compact: boolean;
}

export const placeFor = (typed: Typed, slot: Slot): Place => {
  const lastLine = slot.head.slice(slot.head.lastIndexOf("\n") + 1);
  const column = lastLine.length;

  if (slot.value === "") {
    return { kind: "empty", column, compact: false };
  }

  if (typed.flow || lastLine.trim() !== "") {
    return { kind: "inline", column, compact: false };
  }

  return { kind: "below", column, compact: column === typed.column && slot.value.startsWith("- ") };
};

export const slotOfKey = (typed: Typed, key: string): Slot | undefined => slots(typed).find((slot) => slot.key === key);

/** A value as flow style with no padding inside: `[a, b]`, `{x: 1}`. Only for the simple values `SIMPLE` holds. */
export const flowText = (value: Json): string => {
  if (Array.isArray(value)) {
    return `[${value.map(flowText).join(", ")}]`;
  }

  if (Predicate.isObject(value)) {
    return `{${Object.entries(value)
      .map(([key, item]) => `${key}: ${flowText(item)}`)
      .join(", ")}}`;
  }

  return String(value);
};

// ---------------------------------------------------------------------------------------------------------------------
// Class (r) and (s) as the plan says they are written: only words that need no quoting

const SIMPLE: ReadonlyArray<readonly [string, Json]> = [
  ["scalar", "alpha"],
  ["number", 3],
  ["empty list", []],
  ["list", ["a", "b", 1, null, true]],
  ["three deep", [["a"], ["b", ["c", []]]]],
  ["maps", [{ x: 1 }, { y: [2, { z: {} }] }]],
  ["sixty", Array.from({ length: 60 }, (_, i) => `item${i}`)],
  ["empty map", {}],
  ["map", { x: 1, y: "b" }],
  ["maps three deep", { x: { y: { z: [1] } } }],
];

const PLACED_FORMS = [
  ...GRID_FORMS,
  "b:'x'",
  'b:"x"',
  "c:>",
  "e:indented list of maps",
  "e:compact list of maps",
  "f:two levels",
  "h:# note then a list",
  "h:a then b",
  "k:!!str 87",
  "l:explicit",
];

export interface PlacedCase {
  readonly typed: Typed;
  readonly values: Readonly<Record<string, Json>>;
  readonly body: string;
  readonly forms: ReadonlyArray<string>;
}

/** Each old form with each simple new value, to see how the new value is written in every place. */
export const placedSets = (run: Base.Run): PlacedCase => {
  const { typed, values } = grid(
    OLD.filter((m) => PLACED_FORMS.includes(m.form)),
    SIMPLE.map(([, value]) => value),
  );

  const forms = [
    ...LIST_VALUES.map(([form]) => form),
    "s:empty",
    "s:three deep",
    ...KEY_GROUP_IDS.map((id) => `s:keys-${id}`),
  ];

  return { typed, values, body: bodyAt(run, 0), forms: [...forms, ...slots(typed).map((slot) => slot.form)] };
};

// ---------------------------------------------------------------------------------------------------------------------
// Typed Schemas: S2, S3 and S5 with a file typed in forms their types allow

type Failure = Frontmatter.NoFrontmatter | Frontmatter.BadFrontmatter;

export interface ReadBack {
  readonly name: string;
  readonly text: string;
  /** Sets, then reads the answer with the same Schema: whether it reads as the old data with the set values over it, and the answer. */
  readonly check: Effect.Effect<
    { readonly answer: string; readonly same: boolean; readonly detail: string; readonly bodyKept: boolean },
    Failure
  >;
  readonly forms: ReadonlyArray<string>;
}

const readBack = <S extends Schema.ConstraintCodec<{ readonly [key: string]: unknown }, unknown, never, never>>(
  name: string,
  text: string,
  values: Partial<S["Type"]>,
  schema: S,
  forms: ReadonlyArray<string>,
): ReadBack => ({
  name,
  text,
  forms,
  check: Effect.gen(function* () {
    const before = yield* Frontmatter.read(text, schema);
    const answer = yield* Frontmatter.set(text, values, schema);
    const after = yield* Frontmatter.read(answer, schema);
    const expected = { ...before.data, ...values };

    return {
      answer,
      same: Equal.equals(after.data, expected),
      detail: `${JSON.stringify(after.data)} is not ${JSON.stringify(expected)}`,
      bodyKept: before.body === after.body,
    };
  }),
});

const schemaFile = (templates: ReadonlyArray<readonly [string, Json, string]>, fills: Fills): Typed => ({
  fence: "---\n",
  items: assemble(
    templates.map(([key, data, text]) => slotFrom(text, { key, data }, "typed", 0, LF)),
    fills,
    LF,
  ),
  flow: false,
  column: 0,
  forms: [],
});

const pick = (run: Base.Run, i: number): number => run.picks[i] ?? 0;

const bit = (run: Base.Run, i: number): boolean => pick(run, 0) % 2 ** (i + 1) >= 2 ** i;

/** A file S2 reads, in the forms its types allow, with a few of its fields set. */
const s2Case = (run: Base.Run, n: number): ReadBack => {
  const fills = pick(run, 1) % 2 === 0 ? BLANKS : COMMENTS;

  const templates: ReadonlyArray<readonly [string, Json, string]> = [
    ["number", 87, `number: «${pick(run, 1) % 3 === 0 ? "!!int 87" : "87"}»\n`],
    ["status", "proposed", `status: «${at(["proposed", '"proposed"', "'proposed'"], pick(run, 2))}»\n`],
    ["decided", "x", `decided: «${at(["x", "'x'", '"x"'], pick(run, 3))}»${at(["", "  # c", " # c"], pick(run, 4))}\n`],
    [
      "supersedes",
      [1, 2],
      at(["supersedes: «[1, 2]»\n", "supersedes:\n  «- 1\n  - 2\n»", "supersedes:\n«- 1\n- 2\n»"], pick(run, 5)),
    ],
    [
      "tags",
      ["a", "b"],
      at(["tags: «[a, b]»\n", "tags:\n  «- a\n  - b\n»", "tags: «[ a,b ]»   # c\n"], pick(run, 2) + pick(run, 3)),
    ],
    ...(pick(run, 3) % 2 === 0 ? [["note", "x", "note: «x»\n"] as const] : []),
    ["draft", true, `draft: «${at(["true", "True"], pick(run, 4))}»\n`],
    [
      "meta",
      { "a.b": "x", " c": null },
      at(['meta: «{"a.b": x, " c": null}»\n', 'meta:\n  «"a.b": x\n  " c": null\n»'], pick(run, 5)),
    ],
  ];

  const typed = schemaFile(templates, fills);
  const text = fileText(typed, bodyAt(run, n));

  const values: Partial<typeof Base.S2.Type> = {
    ...(bit(run, 0) || !bit(run, 1) ? { number: 88 } : {}),
    ...(bit(run, 1) ? { status: "accepted" as const } : {}),
    ...(bit(run, 2) ? { decided: "y" } : {}),
    ...(bit(run, 3) ? { tags: ["z", "w"] } : {}),
    ...(bit(run, 4) ? { draft: false } : {}),
    ...(bit(run, 5) ? { meta: { "a.b": "q", " c": 1.5 } } : {}),
    ...(bit(run, 6) ? { supersedes: [3] } : {}),
    ...(bit(run, 7) ? { note: "n" } : {}),
  };

  return readBack("S2", text, values, Base.S2, []);
};

const COUNTS = ['"1.50"', "'2'", '"1e3"', '"0.5"'];

/** A file S3 reads: the number is text in the file. */
const s3Case = (run: Base.Run, n: number, same: boolean): ReadBack => {
  const count = at(COUNTS, pick(run, 0));

  const typed = schemaFile(
    [
      ["count", Number(count.slice(1, -1)), `count: «${count}»${at(["", " # c"], pick(run, 1))}\n`],
      ["label", "x", `label: «${at(["x", "'x'"], pick(run, 2))}»\n`],
    ],
    BLANKS,
  );

  const text = fileText(typed, bodyAt(run, n));
  const old = Number(count.slice(1, -1));

  const values: Partial<typeof Base.S3.Type> = same
    ? { count: old, ...(bit(run, 2) ? { label: "x" } : {}) }
    : { count: old + 1, ...(bit(run, 2) ? { label: "y" } : {}) };

  return readBack(same ? "S3 same" : "S3", text, values, Base.S3, same ? ["t:text of a number"] : []);
};

const NOTES = ["~", "null", "x", "'y'"];

/** A file S5 reads: a decision made from a JSON Schema. */
const s5Case = (run: Base.Run, n: number): ReadBack => {
  const note = at(NOTES, pick(run, 3));

  const typed = schemaFile(
    [
      ["number", 87, `number: «${at(["87", "!!int 87"], pick(run, 1))}»\n`],
      ["status", "accepted", `status: «${at(["accepted", '"accepted"'], pick(run, 2))}»\n`],
      ["decided", "2026-11-22", `decided: «${at(["2026-11-22", '"2026-11-22"'], pick(run, 4))}»\n`],
      ["supersedes", [12, 40], at(["supersedes: «[12, 40]»\n", "supersedes:\n  «- 12\n  - 40\n»"], pick(run, 5))],
      ["draft", false, "draft: «false»\n"],
      ["note", note === "~" || note === "null" ? null : note.replaceAll("'", ""), `note: «${note}»\n`],
    ],
    BLANKS,
  );

  const values: Partial<typeof Base.S5.Type> = {
    ...(bit(run, 0) || !bit(run, 1) ? { number: 2 } : {}),
    ...(bit(run, 1) ? { status: "superseded" as const } : {}),
    ...(bit(run, 2) ? { supersedes: [] } : {}),
    ...(bit(run, 3) ? { note: null } : {}),
    ...(bit(run, 4) ? { draft: true } : {}),
  };

  return readBack("S5", fileText(typed, bodyAt(run, n)), values, Base.S5, []);
};

/** The typed Schemas' cases, one of each. */
export const schemaSets = (run: Base.Run): ReadonlyArray<ReadBack> => [
  s2Case(run, 0),
  s3Case(run, 1, false),
  s5Case(run, 2),
];

/** Class (t) under S3: a number whose file text differs from its writing, set to the value it already holds. */
export const sameSets = (run: Base.Run): { readonly s1: ReadonlyArray<SetCase>; readonly s3: ReadBack } => ({
  s1: casesFor(run)
    .filter(
      (c) => c.forms.includes("t:same") || !c.forms.some((form) => form.startsWith("q:") || form.startsWith("r:")),
    )
    .flatMap((c) =>
      [0, 1].map((parity) => {
        const old = dataRead(c.typed);
        const some = Object.keys(old).filter((_, i) => i % 2 === parity);

        return {
          ...c,
          values: Object.fromEntries(some.map((key) => [key, old[key] ?? null])),
          forms: [...c.forms, "t:same"],
        };
      }),
    ),
  s3: s3Case(run, 3, true),
});

// ---------------------------------------------------------------------------------------------------------------------
// What a call must refuse

export interface Refusal {
  readonly form: string;
  readonly name: string;
  /** The text the call is given: a refusal gives no text back. */
  readonly text: string;
  readonly call: Effect.Effect<string, Failure>;
  /** `NoFrontmatter`, a reason, or `read` when the reason is the one `Frontmatter.read` gives for the text. */
  readonly expect: string;
}

const refusal = (
  form: string,
  name: string,
  text: string,
  expect: string,
  call: Effect.Effect<string, Failure>,
): Refusal => ({ form, name, text, call, expect });

// S2 with a status that is any text of the three, so a status outside them is a value the Schema refuses and not a type error.
const S2Pattern = Schema.Struct({
  ...Base.S2.fields,
  status: Schema.String.check(Schema.isPattern(/^(?:proposed|accepted|superseded)$/u)),
});

/** Classes (w), (x) and (y): files `set` refuses, each with what it must say. */
export const refusedSets = (run: Base.Run): ReadonlyArray<Refusal> => {
  const number = Math.max(2, run.decision.number);
  const word = (Base.mixedTexts(run.seeds)[0] ?? "w").replaceAll(/[^a-z]/gu, "") || "w";
  const files = Base.refusedFiles(number, word);
  const body = bodyAt(run, 0);
  const file = (lines: ReadonlyArray<string>): string => `---\n${lines.join("\n")}\n---\n${body}`;
  const s1 = (text: string, values: Readonly<Record<string, Json>>) => Frontmatter.set(text, values, Base.S1);

  // A good file for S2 with one value the Schema refuses, then the files that fail the Schema as they are.
  const valid = file(files.valid);
  const beside = slots(typedFrom(MIX(), LF, BLANKS, [], [ANCHOR])).slice(0, 6 + (pick(run, 0) % 5));
  const prefix = beside.map((slot) => slot.head + slot.value + slot.tail).join("");
  const anchored = at(["&x [1]", "&x 1", "&x {a: 1}", "&x\n  - 1\n"], pick(run, 1));
  const aliasText = `---\n${prefix}base: ${anchored}${anchored.endsWith("\n") ? "" : "\n"}copy: *x\n---\n${body}`;
  const markerText = `---\n${prefix}last: 1\n...\n---\n${body}`;
  const colonText = `---\n${prefix}? lonely\n---\n${body}`;

  // Two or more anchors of one name, an alias after each, and the edited key at each place. The edit of the first one leaves its alias
  // with no anchor, which the re-read refuses. The edit of a later one leaves its alias reading the anchor before it: the frontmatter still
  // reads, but as other data, and only the data check after the edit refuses it.
  const anchorName = at(["x", "anc", "Z", "n1"], pick(run, 2));
  const anchorCount = 2 + (pick(run, 3) % 2);

  const anchoredAs = (i: number): string =>
    at(
      [`&${anchorName} ${i}`, `&${anchorName} [${i}]`, `&${anchorName} {a: ${i}}`, `&${anchorName}\n  - ${i}\n`],
      pick(run, 4) + i,
    );

  const duplicates = Array.from({ length: anchorCount }, (_, edited) => {
    const lines = Array.from({ length: anchorCount }, (__, i) => {
      const anchored = anchoredAs(i + 1);

      const uses = Array.from(
        { length: 1 + ((pick(run, 5) + i) % 2) },
        (___, use) => `use${i}${use}: *${anchorName}\n`,
      );

      return `dup${i}: ${anchored}${anchored.endsWith("\n") ? "" : "\n"}${uses.join("")}`;
    });

    const text = `---\n${prefix}${lines.join("")}---\n${body}`;

    return refusal(
      "x:duplicate anchor",
      `${anchorCount} anchors of one name, the key of anchor ${edited + 1} set`,
      text,
      "edit",
      s1(text, { [`dup${edited}`]: "changed" }),
    );
  });

  // An earlier anchor of the name, then a key whose value holds a nested anchor of that name, then an alias: the key's edit moves the alias
  // to the earlier anchor.
  const nesteds = ["[&N 2]", "{k: &N 2}", "\n  - &N 2\n", "\n  k: &N 2\n"].map((nested, i) => {
    const text = `---\n${prefix}first: &${anchorName} 1\nmid: ${nested.replaceAll("&N", `&${anchorName}`)}${nested.endsWith("\n") ? "" : "\n"}use: *${anchorName}\n---\n${body}`;

    return refusal(
      "x:nested anchor",
      `an anchor nested in the set value, form ${i}`,
      text,
      "edit",
      s1(text, { mid: "changed" }),
    );
  });

  return [
    refusal("w:value", "number at a fraction", valid, "schema", Frontmatter.set(valid, { number: 1.5 }, Base.S2)),
    refusal("w:value", "number at 0", valid, "schema", Frontmatter.set(valid, { number: 0 }, Base.S2)),
    refusal(
      "w:value",
      "status outside the three",
      valid,
      "schema",
      Frontmatter.set(valid, { status: "Accepted" }, S2Pattern),
    ),
    ...files.broken.map((refused) =>
      refusal(
        "w:file",
        refused.name,
        file(refused.lines),
        "schema",
        Frontmatter.set(file(refused.lines), { status: "accepted" }, Base.S2),
      ),
    ),
    refusal("x:alias", "an anchor that an alias uses", aliasText, "edit", s1(aliasText, { base: ["changed"] })),
    ...duplicates,
    ...nesteds,
    refusal("x:end marker", "a key added after the end marker", markerText, "edit", s1(markerText, { fresh: 1 })),
    refusal("x:no colon", "a key with no colon", colonText, "edit", s1(colonText, { lonely: 1 })),
    ...Base.bareFiles(run.seeds).map((bare, i) =>
      refusal("y:bare", `bare file ${i}`, bare.text, "NoFrontmatter", s1(bare.text, { a: 1 })),
    ),
    ...Base.BROKEN.map((broken) => {
      const text = `---\n${["good: 1", ...broken.lines].join("\n")}\n---\n${body}`;

      return refusal("y:broken", broken.name, text, "read", s1(text, { a: 1 }));
    }),
    ...Base.UNREAD.map((unread) => {
      const text = `---\n${unread.lines.join("\n")}\n---\n${body}`;

      return refusal("y:unread", unread.name, text, "read", s1(text, { a: 1 }));
    }),
  ];
};

// ---------------------------------------------------------------------------------------------------------------------
// The span: files that make `set` succeed and fail each way, with a marker no span may hold

export interface Traced {
  readonly name: string;
  readonly marker: string;
  readonly call: Effect.Effect<string, Failure>;
}

const Note = Schema.Struct({ note: Schema.String });

export const tracedSets = (run: Base.Run): ReadonlyArray<Traced> => {
  const marker = `zq${pick(run, 0)}x${pick(run, 1)}q`;
  const body = `# ${marker}\n`;
  const file = (...lines: ReadonlyArray<string>): string => `---\n${lines.join("\n")}\n---\n${body}`;
  const traced = (name: string, call: Effect.Effect<string, Failure>): Traced => ({ name, marker, call });

  return [
    traced("success", Frontmatter.set(file("note: old", `${marker}: ${marker}`), { note: marker }, Note)),
    traced(
      "success, a key added",
      Frontmatter.set(file(`${marker}: 1`), { [marker]: [marker], fresh: marker }, Base.S1),
    ),
    traced("no frontmatter", Frontmatter.set(`${marker}\n`, { note: marker }, Note)),
    traced("syntax", Frontmatter.set(file(`\t${marker}: 1`), { note: marker }, Note)),
    traced("value", Frontmatter.set(file(`- ${marker}`), { note: marker }, Note)),
    traced("schema, the file", Frontmatter.set(file("note: 5", `other: ${marker}`), { note: marker }, Note)),
    traced(
      "schema, the value",
      Frontmatter.set(
        file("note: x", `other: ${marker}`),
        { note: marker },
        Schema.Struct({ note: Schema.String.check(Schema.isMaxLength(1)) }),
      ),
    ),
    traced("edit", Frontmatter.set(file(`${marker}: &x 1`, "copy: *x"), { [marker]: marker }, Base.S1)),
  ];
};

// ---------------------------------------------------------------------------------------------------------------------
// Body and line ends

/** Class (z): the same file with every body group of 1926, one case each. */
export const bodySets = (run: Base.Run): ReadonlyArray<SetCase> => {
  const typed = baseFile();
  const one = slots(typed).find((slot) => slot.copy === 0);
  const values: Readonly<Record<string, Json>> = one === undefined ? {} : { [one.key]: "changed", fresh: [1] };

  return Base.bodyVariants(run.seeds).map((variant, i) => ({
    name: `body group ${variant.group}`,
    typed,
    values,
    body: variant.body,
    forms: [`z:${i}`],
  }));
};

/** Class (o) and its opposite: CRLF files, and LF files. */
export const crlfSets = (run: Base.Run): ReadonlyArray<SetCase> => {
  const cases = casesFor(run);

  return [
    ...cases.filter((c) => c.typed.fence === "---\r\n").map((c) => ({ ...c, body: "# Body\r\n" })),
    ...cases.filter((c) => c.typed.fence === "---\n" && !c.forms.some((form) => form.startsWith("q:"))),
  ];
};
