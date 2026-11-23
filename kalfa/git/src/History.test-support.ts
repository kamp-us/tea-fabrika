// The history value and its generators, shared by every adapter's laws. HistoryTest.ts exports the part a caller of
// `/test/History` needs; the rest is for this package's own laws.
// A history is plain data: commits by index (a parent has a lower index), refs by name, and the indexes
// of shallow commits. It names no id: each adapter's seeder turns it into a store and hands back the ids.
// The model at the bottom answers what a walk, a merge base and an ancestor question must give, by index,
// so a law compares an adapter with the model and never with another adapter.
//
// A generator's reach is part of its law: every list named `*_CLASSES` below is a class the laws check in
// every run, each one applied to the run's drawn value, so a missing class fails a law loudly.
import { Arbitrary, Predicate, Schema } from "effect";

// ---------------------------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------------------------

const intBetween = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const pick = <const A extends ReadonlyArray<string>>(values: A): Arbitrary.Arbitrary<A[number]> =>
  Arbitrary.schema(Schema.Literals(values));

const alphabetText = (
  alphabet: ReadonlyArray<string>,
  minLength: number,
  maxLength: number,
): Arbitrary.Arbitrary<string> =>
  Arbitrary.array(pick(alphabet), { minLength, maxLength }).pipe(Arbitrary.map((characters) => characters.join("")));

const at = <A>(items: ReadonlyArray<A>, index: number): A => {
  const item = items[index % items.length];

  if (item === undefined) {
    throw new Error("a generated list is empty");
  }

  return item;
};

const encoder = new TextEncoder();

/** The UTF-8 bytes of a text: ordering by them is how git sorts a ref, and a size by them is a commit's. */
const utf8 = (text: string): Uint8Array => encoder.encode(text);

/** git sorts refs by their UTF-8 bytes. JavaScript's `<` sorts by UTF-16 units, which differ past U+E000. */
const byBytes = (a: string, b: string): number => {
  const x = utf8(a);
  const y = utf8(b);

  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const delta = (x[i] ?? 0) - (y[i] ?? 0);

    if (delta !== 0) {
      return delta;
    }
  }

  return x.length - y.length;
};

const LETTERS = [..."abcdefghijklmnopqrstuvwxyz0123456789"];

/** Bytes of a file: any octet, so a draw reaches NUL, 0xff and bytes that are no UTF-8. */
export const bytesArb: Arbitrary.Arbitrary<Uint8Array> = Arbitrary.array(intBetween(0, 255), {
  minLength: 1,
  maxLength: 16,
}).pipe(Arbitrary.map((octets) => Uint8Array.from(octets)));

/** Every ASCII mark git allows inside a ref name part (not `. - @`, which come apart, and not `/`). */
const MARKS = "!\"#$%&'()+,;<=>]_`{|}";

const WIDE = ["\u0250", "\u8BBE", "\u8A9E", "\uFF5A", "\uFF21", "\u{1F600}", "\u{1D4B3}"];

// ---------------------------------------------------------------------------------------------------------
// Commit ids
// ---------------------------------------------------------------------------------------------------------

const HEX = [..."0123456789abcdef"];

/** 40 lowercase hex digits. The first is a letter, so an uppercase form differs from the id. */
export const commitIdArb: Arbitrary.Arbitrary<string> = alphabetText(HEX, 39, 39).pipe(
  Arbitrary.map((rest) => `a${rest}`),
);

export const ID_ACCEPT_CLASSES = ["lowercase hex"] as const;

export const ID_REFUSE_CLASSES = [
  "39 characters",
  "41 characters",
  "64 characters (a sha-256 id)",
  "uppercase hex",
  "a non-hex letter",
  "a leading space",
  "a trailing space",
  "a leading line break",
  "a trailing line break",
  "0x in front",
  "the empty text",
  "an Arabic-Indic digit",
  "a fullwidth digit",
] as const;

/** Each refused form of a good id, one per class above. */
export const idRefusals = (id: string): ReadonlyArray<readonly [label: string, text: string]> => [
  ["39 characters", id.slice(1)],
  ["41 characters", `${id}0`],
  ["64 characters (a sha-256 id)", `${id}${id.slice(0, 24)}`],
  ["uppercase hex", id.toUpperCase()],
  ["a non-hex letter", `g${id.slice(1)}`],
  ["a leading space", ` ${id}`],
  ["a trailing space", `${id} `],
  ["a leading line break", `\n${id}`],
  ["a trailing line break", `${id}\n`],
  ["0x in front", `0x${id}`],
  ["the empty text", ""],
  ["an Arabic-Indic digit", `\u0660${id.slice(1)}`],
  ["a fullwidth digit", `\uFF10${id.slice(1)}`],
];

/** git's empty tree: an id that names a real object in a repository fast-import filled, and never a commit. */
export const TREE_ID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// ---------------------------------------------------------------------------------------------------------
// Ref names
// ---------------------------------------------------------------------------------------------------------

const sanitizePart = (raw: string): string =>
  `p${raw}`
    .replaceAll("..", ".x")
    .replaceAll("@{", "@x")
    .replace(/\.$/, ".x")
    .replace(/\.lock$/, ".lockx");

/** One good name part: a letter first, then marks, dots, dashes, `@` and wide characters; never `..`, `@{`, a trailing `.` or `.lock`. */
export const partArb: Arbitrary.Arbitrary<string> = alphabetText(
  [...LETTERS, ...MARKS, ".", "-", "@", ...WIDE],
  0,
  12,
).pipe(Arbitrary.map(sanitizePart));

const padTo = (part: string, bytes: number): string => part + "a".repeat(Math.max(0, bytes - utf8(part).length));

/** Each accepted class of ref name, made from a drawn part `p`. A branch name is the text after `refs/heads/`. */
const REF_ACCEPT: ReadonlyArray<readonly [label: string, make: (p: string) => string]> = [
  ["plain", (p) => `refs/heads/${p}`],
  ["a character past U+024F inside the Basic Multilingual Plane", (p) => `refs/heads/${p}\u8BBE`],
  ["a character from U+E000 to U+FFFF", (p) => `refs/heads/${p}\uFF5A`],
  ["a character outside the Basic Multilingual Plane", (p) => `refs/heads/${p}\u{1F600}`],
  ["every ASCII mark git allows", (p) => `refs/heads/${p}${MARKS}`],
  ["a lone @ part", (p) => `refs/heads/${p}/@`],
  ["@ inside a part", (p) => `refs/heads/${p}@b`],
  ["a dot inside a part", (p) => `refs/heads/${p}.b`],
  ["a part starting with a dash", (p) => `refs/heads/-${p}`],
  ["a part HEAD", (p) => `refs/heads/${p}/HEAD`],
  ["a part of 200 bytes", (p) => `refs/heads/${padTo(p, 200)}`],
  ["ten parts deep", (p) => `refs/${Array.from({ length: 10 }, () => p).join("/")}`],
  ["past 1000 characters in all", (p) => `refs/heads/${Array.from({ length: 6 }, () => padTo(p, 190)).join("/")}`],
  ["a candidate ref", (p) => `refs/kalfa/candidates/${p}`],
  ["a remote ref", (p) => `refs/remotes/origin/${p}`],
  ["a tag ref", (p) => `refs/tags/${p}`],
  ["two parts", (p) => `refs/${p}`],
];

/** Each refused class of ref name, made from a good name `g`: one break at a time. */
const REF_REFUSE: ReadonlyArray<readonly [label: string, make: (g: string) => string]> = [
  ["a part starting with a dot", (g) => g.replace(/[^/]*$/, (last) => `.${last}`)],
  ["a part .", (g) => `${g}/./z`],
  ["a part ..", (g) => `${g}/../z`],
  ["a space", (g) => `${g} z`],
  ["a tab", (g) => `${g}\tz`],
  ["a line feed", (g) => `${g}\nz`],
  ["a carriage return", (g) => `${g}\rz`],
  ...Array.from({ length: 32 }, (_, code) => code)
    .filter((code) => code !== 9 && code !== 10 && code !== 13)
    .map((code): readonly [string, (g: string) => string] => [
      `the control character U+${code.toString(16).padStart(4, "0")}`,
      (g) => `${g}${String.fromCharCode(code)}z`,
    ]),
  ["DEL", (g) => `${g}\u007Fz`],
  ["~", (g) => `${g}~z`],
  ["^", (g) => `${g}^z`],
  [":", (g) => `${g}:z`],
  ["?", (g) => `${g}?z`],
  ["*", (g) => `${g}*z`],
  ["[", (g) => `${g}[z`],
  ["a backslash", (g) => `${g}\\z`],
  ["two dots", (g) => `${g}..z`],
  ["@{", (g) => `${g}@{z`],
  ["the name @", () => "@"],
  ["a part ending .lock", (g) => `${g}.lock`],
  ["a part .lock inside", (g) => `${g}.lock/z`],
  ["an empty part", (g) => `${g}//z`],
  ["a leading slash", (g) => `/${g}`],
  ["a trailing slash", (g) => `${g}/`],
  ["a trailing dot", (g) => `${g}.`],
  ["a lone high surrogate inside", (g) => `${g}\uD800z`],
  ["a lone low surrogate inside", (g) => `${g}\uDC00z`],
  ["a lone surrogate at the end", (g) => `${g}\uD800`],
  ["the empty text", () => ""],
  ["refs alone", () => "refs"],
  ["a name not under refs/", (g) => g.replace(/^refs\//, "heads/")],
];

export const refAccepted = (p: string): ReadonlyArray<readonly [label: string, name: string]> =>
  REF_ACCEPT.map(([label, make]) => [label, make(p)]);

/** Every break applied to every good name. */
export const refRefused = (p: string): ReadonlyArray<readonly [label: string, name: string]> =>
  refAccepted(p).flatMap(([goodLabel, good]) =>
    REF_REFUSE.map(([label, make]): readonly [string, string] => [`${label} (on ${goodLabel})`, make(good)]),
  );

const HEADS = "refs/heads/";

/** A branch name's accepted classes: refName's classes under refs/heads/, and the trap `refs/heads/x`. */
export const branchAccepted = (p: string): ReadonlyArray<readonly [label: string, name: string]> => [
  ...refAccepted(p)
    .filter(([label, name]) => name.startsWith(HEADS) && label !== "a part starting with a dash")
    .map(([label, name]): readonly [string, string] => [label, name.slice(HEADS.length)]),
  ["a branch that is named like a ref", `refs/heads/${p}`],
];

/** A branch name's refused classes: a leading dash, HEAD, the empty name, and refName's refusals under refs/heads/. */
export const branchRefused = (p: string): ReadonlyArray<readonly [label: string, name: string]> => [
  ["a leading dash", `-${p}`],
  ["a lone dash", "-"],
  ["HEAD", "HEAD"],
  ["the empty name", ""],
  ...refRefused(p)
    .filter(([, name]) => name.startsWith(HEADS) && name.length > HEADS.length)
    .map(([label, name]): readonly [string, string] => [label, name.slice(HEADS.length)]),
];

// ---------------------------------------------------------------------------------------------------------
// Messages and signatures
// ---------------------------------------------------------------------------------------------------------

/** A short line of text with no newline: letters, spaces and wide characters. */
export const wordArb: Arbitrary.Arbitrary<string> = alphabetText([...LETTERS, " ", ...WIDE], 0, 20).pipe(
  Arbitrary.map((raw) => `w${raw}z`),
);

export const MESSAGE_CLASSES = [
  "empty",
  "no trailing newline",
  "one trailing newline",
  "several trailing newlines",
  "leading blank lines",
  "CRLF",
  "a lone CR",
  "a tab",
  "a NUL",
  "a character past U+024F inside the Basic Multilingual Plane",
  "a character from U+E000 to U+FFFF",
  "a character outside the Basic Multilingual Plane",
  "long text",
  "header-looking lines",
] as const;

export const messageVariants = (base: string): ReadonlyArray<readonly [label: string, text: string]> => [
  ["empty", ""],
  ["no trailing newline", base],
  ["one trailing newline", `${base}\n`],
  ["several trailing newlines", `${base}\n\n\n`],
  ["leading blank lines", `\n\n${base}\n`],
  ["CRLF", `${base}\r\n${base}\r\n`],
  ["a lone CR", `${base}\r${base}\n`],
  ["a tab", `${base}\t${base}\n`],
  ["a NUL", `${base}\u0000${base}\n`],
  ["a character past U+024F inside the Basic Multilingual Plane", `${base}\u8BBE\n`],
  ["a character from U+E000 to U+FFFF", `${base}\uFF5A\n`],
  ["a character outside the Basic Multilingual Plane", `${base}\u{1F600}\n`],
  ["long text", `${base}\n`.repeat(Math.ceil(10_001 / (base.length + 1)))],
  ["header-looking lines", `parent ${"b".repeat(40)}\ngpgsig ${base}\n\n${base}\n`],
];

/** A signature as the commit's plain value holds it. */
interface PlainSignature {
  readonly name: string;
  readonly email: string;
  readonly at: { readonly seconds: number; readonly offset: string };
}

export interface FlatSignature {
  readonly name: string;
  readonly email: string;
  readonly seconds: number;
  readonly offset: string;
}

const OFFSETS = ["+0000", "-0000", "+0530", "+0545", "-1200", "+1400"] as const;

export const SIGNATURE_CLASSES = [
  "an empty name",
  "a space at the start of a name",
  "a space inside a name",
  "a space at the end of a name",
  "a tab inside a name",
  "an empty email",
  "an email with a space",
  "a character past U+024F inside the Basic Multilingual Plane",
  "a character outside the Basic Multilingual Plane",
  "a name past 200 characters",
  "seconds 0",
  "seconds past 2^32",
  "the offset +0000",
  "the offset -0000",
  "the offset +0530",
  "the offset +0545",
  "the offset -1200",
  "the offset +1400",
] as const;

/** A drawn signature: a name and an email that no class has bent yet. */
export const flatSignatureArb: Arbitrary.Arbitrary<FlatSignature> = Arbitrary.all({
  name: alphabetText([...LETTERS, ...WIDE], 0, 10).pipe(Arbitrary.map((raw) => `n${raw}z`)),
  email: alphabetText(LETTERS, 0, 10).pipe(Arbitrary.map((raw) => `${raw}@example.test`)),
  seconds: intBetween(1, 4_000_000_000),
  offset: pick(OFFSETS),
});

export const signatureVariants = (
  base: FlatSignature,
): ReadonlyArray<readonly [label: string, flat: FlatSignature]> => [
  ["an empty name", { ...base, name: "" }],
  ["a space at the start of a name", { ...base, name: ` ${base.name}` }],
  ["a space inside a name", { ...base, name: `${base.name} ${base.name}` }],
  ["a space at the end of a name", { ...base, name: `${base.name} ` }],
  ["a tab inside a name", { ...base, name: `${base.name}\t${base.name}` }],
  ["an empty email", { ...base, email: "" }],
  ["an email with a space", { ...base, email: `a b${base.email}` }],
  ["a character past U+024F inside the Basic Multilingual Plane", { ...base, name: `${base.name}\u8BBE` }],
  ["a character outside the Basic Multilingual Plane", { ...base, name: `${base.name}\u{1F600}` }],
  ["a name past 200 characters", { ...base, name: base.name.repeat(Math.ceil(201 / base.name.length)) }],
  ["seconds 0", { ...base, seconds: 0 }],
  ["seconds past 2^32", { ...base, seconds: 4_294_967_296 + base.seconds }],
  ...OFFSETS.map((offset): readonly [string, FlatSignature] => [`the offset ${offset}`, { ...base, offset }]),
];

/** Fields git's format cannot hold, each one break of a good signature, as the plain value a decode takes. */
export const signatureRefusals = (
  base: FlatSignature,
): ReadonlyArray<readonly [label: string, plain: PlainSignature]> => {
  const plain = (flat: FlatSignature): PlainSignature => toPlain(flat);

  return [
    ["a name with <", plain({ ...base, name: `${base.name}<x` })],
    ["a name with >", plain({ ...base, name: `${base.name}>x` })],
    ["a name with a line break", plain({ ...base, name: `${base.name}\nx` })],
    ["an email with >", plain({ ...base, email: `${base.email}>x` })],
    ["an email with a line break", plain({ ...base, email: `${base.email}\nx` })],
    ["the offset +9999", plain({ ...base, offset: "+9999" })],
    ["an offset with no sign", plain({ ...base, offset: "0530" })],
    ["fractional seconds", plain({ ...base, seconds: base.seconds + 0.5 })],
    ["negative seconds", plain({ ...base, seconds: -1 })],
  ];
};

export const toPlain = (flat: FlatSignature): PlainSignature => ({
  name: flat.name,
  email: flat.email,
  at: { seconds: flat.seconds, offset: flat.offset },
});

// ---------------------------------------------------------------------------------------------------------
// Tree ids, modes and paths
// ---------------------------------------------------------------------------------------------------------

/** A path as a drawn value: one to three good parts joined by `/`. Each part starts with `p`, so no rule of `Path` touches it. */
export const pathArb: Arbitrary.Arbitrary<string> = Arbitrary.array(partArb, { minLength: 1, maxLength: 3 }).pipe(
  Arbitrary.map((parts) => parts.join("/")),
);

export const MODE_ACCEPT = ["100644", "100755", "120000"] as const;

/** Each refused form of a file mode, with the class it stands for. */
export const MODE_REFUSALS: ReadonlyArray<readonly [label: string, text: string]> = [
  ["a submodule", "160000"],
  ["a folder with a leading zero", "040000"],
  ["a folder", "40000"],
  ["a mode with three digits", "644"],
  ["a mode git does not write", "100664"],
  ["the empty text", ""],
];

const ENDS_OF_THE_IGNORED = ["\u200C", "\u200F", "\u202A", "\u202E", "\u206A", "\u206F", "\uFEFF"];

/** Each part that git's own check calls `.git` (checked with `git fsck --strict` on git 2.40.1, one class each). */
export const DOT_GIT_FORMS: ReadonlyArray<readonly [label: string, part: string]> = [
  ["the part .git", ".git"],
  ["the part .GIT in capitals", ".GIT"],
  ["the part .Git in mixed case", ".Git"],
  ["a trailing space", ".git "],
  ["two trailing spaces", ".git  "],
  ["a trailing dot", ".git."],
  ["capitals with a dot and a space after", ".GIT. "],
  ["a space and a dot after", ".git ."],
  ["the short name git~1", "git~1"],
  ["the short name GIT~1 in capitals", "GIT~1"],
  ["the short name git~1 with a trailing space", "git~1 "],
  ["the short name git~1 with a trailing dot", "git~1."],
  ["a stream name .git:x", ".git:x"],
  ["a stream name with nothing after the colon", ".git:"],
  ...ENDS_OF_THE_IGNORED.map((c): readonly [string, string] => [
    `U+${c.charCodeAt(0).toString(16).toUpperCase()} inside, a character git's HFS check ignores`,
    `.g${c}it`,
  ]),
  ["U+200C after, a character git's HFS check ignores", ".git\u200C"],
  ["U+200C before, a character git's HFS check ignores", "\u200C.git"],
  ["U+FEFF after, a character git's HFS check ignores", ".git\uFEFF"],
  ["U+FEFF before, a character git's HFS check ignores", "\uFEFF.git"],
  // NTFS reads a backslash as a folder separator, so a piece between backslashes is a name of its own (checked with
  // `git fsck --strict` on git 2.40.1).
  [".git after a backslash", "x\\.git"],
  [".git before a backslash", ".git\\x"],
  ["git~1 after a backslash", "x\\git~1"],
  ["git~1 before a backslash", "git~1\\x"],
  [".git in capitals after a backslash, with a trailing space", "x\\.GIT "],
  [".git in capitals with U+200C inside, a character git's HFS check ignores", ".G\u200CIT"],
  [".git in capitals with U+202E inside, a character git's HFS check ignores", ".Gi\u202Et"],
];

/** Parts next to those git's check refuses, which git accepts: a rule that reaches too far is seen here. */
export const NEAR_DOT_GIT: ReadonlyArray<readonly [label: string, part: string]> = [
  ["the part .gitx", ".gitx"],
  ["the part git", "git"],
  ["the part ..a", "..a"],
  ["the part a.", "a."],
  ["the part .git2", ".git2"],
  ["the part git~2", "git~2"],
  ["the part git~10", "git~10"],
  ["U+200B inside .git, which git does not ignore", ".g\u200Bit"],
  ["U+2010 inside .git, just past the ignored U+200C to U+200F", ".g\u2010it"],
  ["U+2029 inside .git, just before the ignored U+202A to U+202E", ".g\u2029it"],
  ["U+202F inside .git, just past the ignored U+202A to U+202E", ".g\u202Fit"],
  ["U+2069 inside .git, just before the ignored U+206A to U+206F", ".g\u2069it"],
  ["U+2070 inside .git, just past the ignored U+206A to U+206F", ".g\u2070it"],
  ["U+FEFE inside .git, just before the ignored U+FEFF", ".g\uFEFEit"],
  [".git with U+200C inside after a backslash: an HFS volume has no folders to split", "x\\.g\u200Cit"],
  ["U+200C before .git, then a backslash", "\u200C.git\\x"],
  [".git, U+200C, then a backslash", ".git\u200C\\x"],
  ["a backslash and git~2", "x\\git~2"],
];

/** The names that are on JavaScript's object prototype: a store that keeps paths in a plain object loses them. */
export const PROTOTYPE_NAMES = ["__proto__", "constructor", "hasOwnProperty", "toString"] as const;

/** Each accepted class of path, made from a drawn path `p`. */
export const pathAccepted = (p: string): ReadonlyArray<readonly [label: string, path: string]> => [
  ["plain", p],
  ["a character past U+024F inside the Basic Multilingual Plane", `${p}\u8BBE`],
  ["a character outside the Basic Multilingual Plane", `${p}\u{1F600}`],
  ["a character from U+E000 to U+FFFF", `${p}\uFF5A`],
  ["a space", `${p} z`],
  ["a line break", `${p}\nz`],
  ["a tab and a carriage return", `${p}\t\rz`],
  ["a backslash", `${p}\\z`],
  ["a leading dash", `-${p}`],
  ["a leading quote", `"${p}`],
  ["a part of 300 bytes", `${p}/${"a".repeat(300)}`],
  ["forty folders deep", Array.from({ length: 40 }, () => p).join("/")],
  ...NEAR_DOT_GIT.flatMap(([label, part]): ReadonlyArray<readonly [string, string]> => [
    [label, part],
    [`${label}, as a folder in the middle`, `${p}/${part}/${p}`],
  ]),
  ...PROTOTYPE_NAMES.flatMap((name): ReadonlyArray<readonly [string, string]> => [
    [`the name ${name}`, name],
    [`the name ${name} as a folder`, `${name}/${p}`],
    [`the name ${name} deep`, `${p}/${name}`],
  ]),
];

/** Each refused class of path, made from a drawn path `p`: one break at a time, in a path every other rule lets through. */
export const pathRefused = (p: string): ReadonlyArray<readonly [label: string, path: string]> => [
  ["an empty part: the empty text", ""],
  ["an empty part: a leading slash", `/${p}`],
  ["an empty part: a trailing slash", `${p}/`],
  ["an empty part: two slashes inside", `${p}//${p}`],
  ["a part .: alone", "."],
  ["a part .: first", `./${p}`],
  ["a part .: inside", `${p}/./${p}`],
  ["a part .: last", `${p}/.`],
  ["a part ..: alone", ".."],
  ["a part ..: first", `../${p}`],
  ["a part ..: inside", `${p}/../${p}`],
  ["a part ..: last", `${p}/..`],
  ...DOT_GIT_FORMS.flatMap(([label, part]): ReadonlyArray<readonly [string, string]> => [
    [`.git form, ${label}: at the top`, part],
    [`.git form, ${label}: as a folder`, `${part}/${p}`],
    [`.git form, ${label}: three folders deep`, `a/b/c/${part}`],
  ]),
  ["a NUL: inside a part", `${p}\u0000${p}`],
  ["a NUL: alone as a part", `${p}/\u0000`],
  ["a NUL: first in a part", `\u0000${p}`],
  ["a NUL: last in a path", `${p}\u0000`],
  ["a lone surrogate: a high one inside", `${p}\uD800${p}`],
  ["a lone surrogate: a low one inside", `${p}\uDC00${p}`],
  ["a lone surrogate: one at the end", `${p}\uD800`],
];

// ---------------------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------------------

/** Duration text across units, as `Duration.fromInput` reads it: `"10 seconds"`. Always more than zero. */
const durationTextArb: Arbitrary.Arbitrary<string> = Arbitrary.all({
  amount: intBetween(1, 9_999),
  unit: pick(["millis", "seconds", "minutes", "hours"]),
}).pipe(Arbitrary.map(({ amount, unit }) => `${amount} ${unit}`));

/** Positive whole counts and a time as duration text: what the settings accept. */
export const limitsArb = Arbitrary.all({
  commits: intBetween(1, 1_000_000_000),
  refs: intBetween(1, 1_000_000_000),
  bytes: intBetween(1, 1_000_000_000),
  files: intBetween(1, 1_000_000_000),
  diff: intBetween(1, 1_000_000_000),
  time: durationTextArb,
});

// ---------------------------------------------------------------------------------------------------------
// The history value
// ---------------------------------------------------------------------------------------------------------

/** A file of a commit's tree, as plain data: where it sits, its kind, its bytes. */
export interface FileSpec {
  readonly path: string;
  readonly mode: "100644" | "100755" | "120000";
  readonly content: Uint8Array;
}

export interface Node {
  readonly parents: ReadonlyArray<number>;
  readonly author: FlatSignature;
  readonly committer: FlatSignature;
  readonly message: string;
  /** No two the same path, and no path a folder of another. `[]` is git's empty tree. */
  readonly files: ReadonlyArray<FileSpec>;
}

export interface History {
  readonly nodes: ReadonlyArray<Node>;
  readonly refs: ReadonlyArray<{ readonly name: string; readonly commit: number }>;
  readonly shallow: ReadonlyArray<number>;
}

/** What one run draws. Every shape reads the same lists, cyclically, from its own cursor. */
export interface Texture {
  readonly nums: ReadonlyArray<number>;
  readonly words: ReadonlyArray<string>;
  readonly signatures: ReadonlyArray<FlatSignature>;
  readonly parts: ReadonlyArray<string>;
  readonly blobs: ReadonlyArray<Uint8Array>;
}

export const textureArb: Arbitrary.Arbitrary<Texture> = Arbitrary.all({
  nums: Arbitrary.array(intBetween(0, 1_000_000_000), { minLength: 96, maxLength: 96 }),
  words: Arbitrary.array(wordArb, { minLength: 12, maxLength: 12 }),
  signatures: Arbitrary.array(flatSignatureArb, { minLength: 8, maxLength: 8 }),
  parts: Arbitrary.array(partArb, { minLength: 8, maxLength: 8 }),
  blobs: Arbitrary.array(bytesArb, { minLength: 8, maxLength: 8 }),
});

class Draw {
  #cursor = 0;
  readonly texture: Texture;

  constructor(texture: Texture) {
    this.texture = texture;
  }

  int(below: number): number {
    return at(this.texture.nums, this.#cursor++) % below;
  }

  word(): string {
    return at(this.texture.words, this.#cursor++);
  }

  signature(seconds: number): FlatSignature {
    const base = at(this.texture.signatures, this.#cursor++);

    return { ...base, seconds, offset: at(OFFSETS, this.#cursor++) };
  }

  part(): string {
    return at(this.texture.parts, this.#cursor++);
  }

  blob(): Uint8Array {
    return at(this.texture.blobs, this.#cursor++);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Trees: the files a commit holds
// ---------------------------------------------------------------------------------------------------------

/** What a tree law draws: parts for names and bytes for contents. */
export interface TreeDraw {
  readonly parts: ReadonlyArray<string>;
  readonly blobs: ReadonlyArray<Uint8Array>;
}

export const treeArb: Arbitrary.Arbitrary<TreeDraw> = Arbitrary.all({
  parts: Arbitrary.array(partArb, { minLength: 6, maxLength: 6 }),
  blobs: Arbitrary.array(bytesArb, { minLength: 6, maxLength: 6 }),
});

const file = (path: string, content: Uint8Array, mode: FileSpec["mode"] = "100644"): FileSpec => ({
  path,
  mode,
  content,
});

const textFile = (path: string, content: string, mode: FileSpec["mode"] = "100644"): FileSpec =>
  file(path, utf8(content), mode);

/** The trees a law builds, each one class of file: order and nesting, contents, kinds, names. */
export const TREE_CLASSES = [
  "a folder beside a-b, a.b and a0",
  "a file three folders deep beside a file at the top",
  "an empty file",
  "no trailing newline",
  "a NUL byte",
  "bytes that are not UTF-8",
  "CRLF lines",
  "past 1000 bytes",
  "the same bytes at two paths",
  "the same bytes at two paths, once with two modes",
  "an executable file",
  "a link",
  "names with a space, a line break, a leading dash and a leading quote",
  "names past U+024F, from U+E000 to U+FFFF and outside the Basic Multilingual Plane",
  "names on the object prototype, as files",
  "names on the object prototype, as folders",
  "no files",
] as const;

/** One tree for each class above, every path a good `Path` and no path a folder of another. */
export const treeClasses = (
  draw: TreeDraw,
): ReadonlyArray<{ readonly label: string; readonly files: ReadonlyArray<FileSpec> }> => {
  const p = at(draw.parts, 0);
  const q = at(draw.parts, 1);
  const r = at(draw.parts, 2);
  const [b, c, d] = [at(draw.blobs, 0), at(draw.blobs, 1), at(draw.blobs, 2)];
  const big = Uint8Array.from({ length: 1000 + b.length }, (_, i) => ((b[i % b.length] ?? 0) + i) & 255);

  return [
    {
      label: "a folder beside a-b, a.b and a0",
      files: [file(`f${p}/c`, b), file(`f${p}-b`, c), file(`f${p}.b`, d), file(`f${p}0`, b)],
    },
    {
      label: "a file three folders deep beside a file at the top",
      files: [file(`t${q}`, c), file(`d1${p}/d2${q}/d3${r}/z`, d)],
    },
    { label: "an empty file", files: [file(`e${p}`, new Uint8Array())] },
    { label: "no trailing newline", files: [textFile(`n${p}`, "no newline")] },
    { label: "a NUL byte", files: [file(`z${p}`, Uint8Array.of(0x61, 0x00, 0x62, 0x0a))] },
    { label: "bytes that are not UTF-8", files: [file(`b${p}`, Uint8Array.of(0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28))] },
    { label: "CRLF lines", files: [textFile(`c${p}`, "one\r\ntwo\r\n")] },
    { label: "past 1000 bytes", files: [file(`k${p}`, big)] },
    { label: "the same bytes at two paths", files: [file(`s1${p}`, b), file(`s2${q}/x`, b)] },
    {
      label: "the same bytes at two paths, once with two modes",
      files: [file(`m1${p}`, b), file(`m2${p}`, b, "100755")],
    },
    { label: "an executable file", files: [textFile(`x${p}`, "#!/bin/sh\n", "100755")] },
    { label: "a link", files: [textFile(`l${p}`, `t${q}`, "120000"), file(`t${q}`, c)] },
    {
      label: "names with a space, a line break, a leading dash and a leading quote",
      files: [file(`a b${p}`, b), file(`l\nb${p}`, c), file(`-d${p}`, d), file(`"q${p}`, b)],
    },
    {
      label: "names past U+024F, from U+E000 to U+FFFF and outside the Basic Multilingual Plane",
      files: ["\u8BBE", "\uFF5A", "\u{1F600}", "\u0250", "\uE000"].map((mark, i) =>
        file(`${mark}${p}`, at(draw.blobs, i)),
      ),
    },
    {
      label: "names on the object prototype, as files",
      files: PROTOTYPE_NAMES.map((name, i) => file(name, at(draw.blobs, i))),
    },
    {
      label: "names on the object prototype, as folders",
      files: PROTOTYPE_NAMES.map((name, i) => file(`${name}/${p}`, at(draw.blobs, i))),
    },
    { label: "no files", files: [] },
  ];
};

/** Trees git cannot hold, one class each, every path a good `Path`: a path that is a folder of another. */
export const CONFLICT_CLASSES = [
  "a file beside a file below it, the file first",
  "a file beside a file below it, the file below first",
  "a file beside a file two folders below it",
  "a file in a folder beside a file below it",
  "a link beside a file below it",
] as const;

export const conflictClasses = (
  draw: TreeDraw,
): ReadonlyArray<{ readonly label: string; readonly files: ReadonlyArray<FileSpec> }> => {
  const p = at(draw.parts, 0);
  const q = at(draw.parts, 1);
  const r = at(draw.parts, 2);
  const [b, c] = [at(draw.blobs, 0), at(draw.blobs, 1)];
  const aside = file(`o${p}`, c);

  return [
    { label: "a file beside a file below it, the file first", files: [aside, file(`a${p}`, b), file(`a${p}/${q}`, c)] },
    {
      label: "a file beside a file below it, the file below first",
      files: [file(`a${p}/${q}`, c), file(`a${p}`, b), aside],
    },
    {
      label: "a file beside a file two folders below it",
      files: [file(`g${p}`, b), file(`g${p}/${q}/${r}`, c), aside],
    },
    {
      label: "a file in a folder beside a file below it",
      files: [file(`x${p}/${q}`, b), aside, file(`x${p}/${q}/${r}`, c)],
    },
    {
      label: "a link beside a file below it",
      files: [textFile(`k${p}`, `t${q}`, "120000"), file(`k${p}/${q}`, c), aside],
    },
  ];
};

/** The files of a tree as one text: equal exactly when two commits hold the same paths, modes and bytes. */
export const filesKey = (files: ReadonlyArray<FileSpec>): string =>
  JSON.stringify(
    files
      .map((each) => [each.path, each.mode, Array.from(each.content)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

/** Whether two commits hold the same files: the model of "same tree id". */
export const sameFiles = (a: ReadonlyArray<FileSpec>, b: ReadonlyArray<FileSpec>): boolean =>
  filesKey(a) === filesKey(b);

const EDIT_KINDS = ["no change", "one byte", "one path", "one folder level", "one mode", "one path removed"] as const;

/** The files of a commit made from its first parent's with one change. `tag` is unique to the commit, so no new path clashes. */
const edit = (
  files: ReadonlyArray<FileSpec>,
  kind: (typeof EDIT_KINDS)[number],
  tag: string,
  part: string,
): ReadonlyArray<FileSpec> => {
  const [first, ...rest] = files;
  const added = [...files, textFile(`${tag}-${part}`, part)];

  if (first === undefined) {
    return kind === "no change" || kind === "one path removed" ? files : added;
  }

  switch (kind) {
    case "no change":
      return files;
    case "one byte":
      return [
        {
          ...first,
          content:
            first.content.length === 0
              ? Uint8Array.of(1)
              : Uint8Array.from(first.content, (octet, i) => (i === 0 ? (octet + 1) & 255 : octet)),
        },
        ...rest,
      ];
    case "one path":
      return added;
    case "one folder level":
      return [{ ...first, path: `${tag}d/${first.path}` }, ...rest];
    case "one mode":
      return [{ ...first, mode: first.mode === "100644" ? "100755" : "100644" }, ...rest];
    case "one path removed":
      return rest;
  }
};

const rootFiles = (draw: Draw, i: number): ReadonlyArray<FileSpec> =>
  Array.from({ length: 1 + draw.int(3) }, (_, k) =>
    file(
      k % 2 === 0 ? `r${i}f${k}-${draw.part()}` : `r${i}d${k}/${draw.part()}`,
      draw.blob(),
      at(MODE_ACCEPT, draw.int(3)),
    ),
  );

const BASE_SECONDS = 1_700_000_000;

type Dates = "forward" | "skew" | "random";

const committerSeconds = (i: number, n: number, dates: Dates, draw: Draw): number => {
  switch (dates) {
    case "forward":
      return BASE_SECONDS + i * 60;
    case "skew":
      return BASE_SECONDS + (n - i) * 60;
    case "random":
      return draw.int(1_000_000_000) * 128 + i;
  }
};

/** The refs of a history of `n` commits: traps for a text prefix and for byte order, then drawn names. */
const refsFor = (draw: Draw, n: number): ReadonlyArray<{ name: string; commit: number }> => {
  if (n === 0) {
    return [];
  }

  const part = draw.part();

  const names = [
    "refs/heads/main",
    "refs/heads/main-2",
    "refs/heads/z-\u8BBE",
    "refs/heads/z-\uFF5A",
    "refs/heads/z-\u{1F600}",
    `refs/kalfa/candidates/${part}`,
    `refs/heads/${part}`,
    `refs/heads/${part}/sub`,
    `refs/heads/${draw.part()}`,
    `refs/tags/${draw.part()}`,
    `refs/heads/${"l".repeat(200)}`,
  ];

  const kept: Array<string> = [];

  for (const name of names) {
    const clash = kept.some((other) => other === name || other.startsWith(`${name}/`) || name.startsWith(`${other}/`));

    if (!clash) {
      kept.push(name);
    }
  }

  return kept.map((name) => ({ name, commit: draw.int(n) }));
};

const build = (draw: Draw, parentLists: ReadonlyArray<ReadonlyArray<number>>, dates: Dates): History => {
  const n = parentLists.length;
  const turn = draw.int(EDIT_KINDS.length);
  const nodes: Array<Node> = [];

  parentLists.forEach((parents, i) => {
    const author = draw.signature(draw.int(4_000_000_000));
    const committer = draw.signature(committerSeconds(i, n, dates, draw));
    const message = draw.word();
    const first = parents[0] === undefined ? undefined : nodes[parents[0]];

    // A root draws its files; any other commit holds its first parent's files with one change, cycling through the kinds.
    const files =
      first === undefined ? rootFiles(draw, i) : edit(first.files, at(EDIT_KINDS, turn + i), `n${i}`, draw.part());

    nodes.push({ parents, author, committer, message, files });
  });

  return { nodes, refs: refsFor(draw, n), shallow: [] };
};

export interface Shape {
  readonly label: string;
  readonly history: History;
}

export const SHAPE_CLASSES = [
  "an empty store",
  "one root",
  "a line",
  "a branch and its merge back",
  "a merge whose parents come in the other order",
  "an octopus merge",
  "a criss-cross",
  "two unrelated roots",
  "three unrelated roots",
  "a commit that is the parent of many",
  "committer dates that go backward",
  "a random graph",
  "a random graph with random dates",
] as const;

/** The criss-cross's commits by index: both merges, whose merge bases are the two commits between. */
export const CRISS = { left: 1, right: 2, first: 3, second: 4 } as const;

/** One history for each shape class, all made from one drawn texture. */
export const shapes = (texture: Texture): ReadonlyArray<Shape> => {
  const draw = new Draw(texture);

  const chain = (length: number, start = 0): Array<ReadonlyArray<number>> =>
    Array.from({ length }, (_, i) => (i === 0 ? [] : [start + i - 1]));

  const branchAndMerge = (flip: boolean): Array<ReadonlyArray<number>> => [[], [0], [1], [1], flip ? [3, 2] : [2, 3]];
  const octopusWidth = 3 + draw.int(3);

  const octopus: Array<ReadonlyArray<number>> = [
    [],
    ...Array.from({ length: octopusWidth }, () => [0]),
    Array.from({ length: octopusWidth }, (_, i) => i + 1),
  ];

  const lineLength = 2 + draw.int(29);

  const separateRoots = (count: number): Array<ReadonlyArray<number>> => {
    const lists: Array<ReadonlyArray<number>> = [];

    for (let r = 0; r < count; r++) {
      const start = lists.length;
      const length = 1 + draw.int(3);

      for (let i = 0; i < length; i++) {
        lists.push(i === 0 ? [] : [start + i - 1]);
      }
    }

    return lists;
  };

  const many: Array<ReadonlyArray<number>> = [[]];
  const kids = 5 + draw.int(4);

  for (let k = 0; k < kids; k++) {
    many.push([0]);

    if (draw.int(2) === 0) {
      many.push([many.length - 1]);
    }
  }

  const randomGraph = (): Array<ReadonlyArray<number>> => {
    const size = 2 + draw.int(29);
    const lists: Array<ReadonlyArray<number>> = [];

    for (let i = 0; i < size; i++) {
      if (i === 0 || draw.int(8) === 0) {
        lists.push([]);
        continue;
      }

      const wanted = 1 + draw.int(3);
      const parents: Array<number> = [];

      for (let p = 0; p < wanted; p++) {
        const parent = draw.int(i);

        if (!parents.includes(parent)) {
          parents.push(parent);
        }
      }

      lists.push(parents);
    }

    return lists;
  };

  return [
    { label: "an empty store", history: build(draw, [], "forward") },
    { label: "one root", history: build(draw, [[]], "forward") },
    { label: "a line", history: build(draw, chain(lineLength), "forward") },
    { label: "a branch and its merge back", history: build(draw, branchAndMerge(false), "forward") },
    { label: "a merge whose parents come in the other order", history: build(draw, branchAndMerge(true), "forward") },
    { label: "an octopus merge", history: build(draw, octopus, "forward") },
    { label: "a criss-cross", history: build(draw, [[], [0], [0], [1, 2], [2, 1]], "forward") },
    { label: "two unrelated roots", history: build(draw, separateRoots(2), "forward") },
    { label: "three unrelated roots", history: build(draw, separateRoots(3), "forward") },
    { label: "a commit that is the parent of many", history: build(draw, many, "forward") },
    { label: "committer dates that go backward", history: build(draw, [...chain(6), [2, 5]], "skew") },
    { label: "a random graph", history: build(draw, randomGraph(), "forward") },
    { label: "a random graph with random dates", history: build(draw, randomGraph(), "random") },
  ];
};

/** The same history with one commit that has parents marked shallow, as a shallow fetch leaves it. */
export const cutShallow = (history: History): History | undefined => {
  const cut = history.nodes.findIndex((node) => node.parents.length > 0);

  return cut === -1 ? undefined : { ...history, shallow: [cut] };
};

/** A line with one commit for every message class and every signature class, so S1 reads each one back. */
export const CARRIER_CLASSES: ReadonlyArray<string> = [
  ...MESSAGE_CLASSES.map((label) => `message: ${label}`),
  ...SIGNATURE_CLASSES.map((label) => `author: ${label}`),
  ...SIGNATURE_CLASSES.filter((label) => !label.startsWith("seconds")).map((label) => `committer: ${label}`),
];

export const carrier = (texture: Texture): { readonly history: History; readonly classes: ReadonlyArray<string> } => {
  const draw = new Draw(texture);
  const word = draw.word();
  const author = draw.signature(draw.int(4_000_000_000));
  const committer = draw.signature(0);

  const entries: Array<{ label: string; author: FlatSignature; committer: FlatSignature; message: string }> = [
    ...messageVariants(word).map(([label, message]) => ({ label: `message: ${label}`, author, committer, message })),
    ...signatureVariants(author).map(([label, flat]) => ({
      label: `author: ${label}`,
      author: flat,
      committer,
      message: word,
    })),
    ...signatureVariants(committer)
      .filter(([label]) => !label.startsWith("seconds"))
      .map(([label, flat]) => ({ label: `committer: ${label}`, author, committer: flat, message: word })),
  ];

  const nodes = entries.map((entry, i): Node => ({
    parents: i === 0 ? [] : [i - 1],
    author: entry.author,
    committer: { ...entry.committer, seconds: BASE_SECONDS + i },
    message: entry.message,
    files: [],
  }));

  return { history: { nodes, refs: refsFor(draw, nodes.length), shallow: [] }, classes: entries.map((e) => e.label) };
};

/** What the tree carrier adds to `TREE_CLASSES`: commits whose files are those of the first one, changed in one way. */
export const TREE_CHANGE_CLASSES = [
  "the same files on another parent",
  "one byte differs",
  "one path differs",
  "one folder level differs",
  "one mode differs",
] as const;

export const TREE_CARRIER_CLASSES: ReadonlyArray<string> = [...TREE_CLASSES, ...TREE_CHANGE_CLASSES];

/** A history with a commit for every tree class, then commits that hold the first one's files changed in one way. */
export const treeCarrier = (
  texture: Texture,
): { readonly history: History; readonly classes: ReadonlyArray<string> } => {
  const draw = new Draw(texture);
  const word = draw.word();
  const author = draw.signature(draw.int(4_000_000_000));
  const committer = draw.signature(0);
  const base = treeClasses(texture);
  const first = base[0]?.files ?? [];
  const part = at(texture.parts, 3);

  const entries: ReadonlyArray<{ label: string; parents: ReadonlyArray<number>; files: ReadonlyArray<FileSpec> }> = [
    ...base.map(({ label, files }, i) => ({ label, parents: i === 0 ? [] : [i - 1], files })),
    { label: "the same files on another parent", parents: [1], files: first },
    { label: "one byte differs", parents: [0], files: edit(first, "one byte", "c1", part) },
    { label: "one path differs", parents: [0], files: edit(first, "one path", "c2", part) },
    { label: "one folder level differs", parents: [0], files: edit(first, "one folder level", "c3", part) },
    { label: "one mode differs", parents: [0], files: edit(first, "one mode", "c4", part) },
  ];

  const nodes = entries.map((entry, i): Node => ({
    parents: entry.parents,
    author,
    committer: { ...committer, seconds: BASE_SECONDS + i },
    message: word,
    files: entry.files,
  }));

  return { history: { nodes, refs: refsFor(draw, nodes.length), shallow: [] }, classes: entries.map((e) => e.label) };
};

/** The same history with a canary in every message, name and email, so a span that leaks one is seen. */
export const CANARY = "canary-7f3a9c";

export const withCanary = (history: History): History => ({
  ...history,
  nodes: history.nodes.map((node, i) => ({
    ...node,
    // A path and a line of every commit carry the canary, so a call that puts either in a span is seen. Every commit holds
    // other files, so two different commits always differ in a changed file.
    files: [textFile(`${CANARY}-path-${i}`, `${CANARY}-line-${i}\n`)],
    message: `${CANARY}-message-${i}`,
    author: { ...node.author, name: `${CANARY}-author-${i}`, email: `${CANARY}-author-${i}@example.test` },
    committer: { ...node.committer, name: `${CANARY}-committer-${i}`, email: `${CANARY}-committer-${i}@example.test` },
  })),
});

/** An id no history holds: 40 hex digits made from a drawn number, moved past every id in `taken`. */
export const missingId = (texture: Texture, k: number, taken: ReadonlyArray<string>): string => {
  let n = at(texture.nums, k) + 1;

  for (;;) {
    const id = n.toString(16).padStart(40, "f");

    if (!taken.includes(id)) {
      return id;
    }

    n += 1;
  }
};

// ---------------------------------------------------------------------------------------------------------
// The model: what each call must answer, by index
// ---------------------------------------------------------------------------------------------------------

/** Every commit the tips reach, themselves included. */
const reach = (history: History, tips: ReadonlyArray<number>): ReadonlySet<number> => {
  const seen = new Set<number>();
  const todo = [...tips];

  for (let next = todo.pop(); next !== undefined; next = todo.pop()) {
    if (seen.has(next)) {
      continue;
    }

    seen.add(next);
    todo.push(...(history.nodes[next]?.parents ?? []));
  }

  return seen;
};

export const walkModel = (
  history: History,
  include: ReadonlyArray<number>,
  exclude: ReadonlyArray<number>,
): ReadonlyArray<number> => {
  const hidden = reach(history, exclude);

  return [...reach(history, include)].filter((i) => !hidden.has(i)).sort((a, b) => a - b);
};

/** The maximal common ancestors: common ones that no other common one reaches through its parents. */
export const basesModel = (history: History, a: number, b: number): ReadonlyArray<number> => {
  const fromA = reach(history, [a]);
  const common = [...reach(history, [b])].filter((i) => fromA.has(i));

  return common.filter((c) => !common.some((d) => d !== c && reach(history, [d]).has(c))).sort((x, y) => x - y);
};

export const isAncestorModel = (history: History, ancestor: number, descendant: number): boolean =>
  reach(history, [descendant]).has(ancestor);

/** Whether every commit of `order` comes after each of its parents that is in `order`. */
export const parentsFirst = (history: History, order: ReadonlyArray<number>): boolean =>
  order.every((commit, position) =>
    (history.nodes[commit]?.parents ?? []).every((parent) => {
      const place = order.indexOf(parent);

      return place === -1 || place < position;
    }),
  );

/** The one order a set has when it is a single line of commits, or undefined when it is not one. */
export const lineOrder = (history: History, set: ReadonlyArray<number>): ReadonlyArray<number> | undefined => {
  const inside = new Set(set);
  const parentIn = (i: number): ReadonlyArray<number> => (history.nodes[i]?.parents ?? []).filter((p) => inside.has(p));
  const childCount = (i: number): number => set.filter((c) => parentIn(c).includes(i)).length;
  const roots = set.filter((i) => parentIn(i).length === 0);

  if (roots.length !== 1 || set.some((i) => parentIn(i).length > 1 || childCount(i) > 1)) {
    return undefined;
  }

  const order: Array<number> = [];
  let current: number | undefined = roots[0];

  while (current !== undefined) {
    order.push(current);
    const from: number = current;
    current = set.find((c) => parentIn(c).includes(from));
  }

  return order.length === set.length ? order : undefined;
};

/** The refs a `readRefs(under)` answers: `under` itself and every ref below `under/`, sorted by UTF-8 bytes. */
export const refsModel = (
  history: History,
  under: string,
): ReadonlyArray<{ readonly name: string; readonly commit: number }> =>
  history.refs
    .filter((ref) => ref.name === under || ref.name.startsWith(`${under}/`))
    .sort((a, b) => byBytes(a.name, b.name));

/** The names `readRefs` is asked for: each ref, each folder above a ref (two parts or more), a text-prefix trap, and none. */
export const refQueries = (history: History): ReadonlyArray<string> => {
  const folders = history.refs.flatMap((ref) => {
    const parts = ref.name.split("/");

    return Array.from({ length: Math.max(0, parts.length - 2) }, (_, i) => parts.slice(0, i + 2).join("/"));
  });

  return [
    ...new Set([
      ...history.refs.map((ref) => ref.name),
      ...folders,
      "refs/heads",
      "refs/heads/z-",
      "refs/nothing/here",
    ]),
  ];
};

/** A commit object's size in bytes, as git writes it: the empty tree, the parents, both idents, a blank line, the message. */
export const objectSize = (node: Node, parentIds: ReadonlyArray<string>): number => {
  const ident = (flat: FlatSignature): string => `${flat.name} <${flat.email}> ${flat.seconds} ${flat.offset}`;

  const head = [
    `tree ${TREE_ID}`,
    ...parentIds.map((id) => `parent ${id}`),
    `author ${ident(node.author)}`,
    `committer ${ident(node.committer)}`,
  ].join("\n");

  return utf8(`${head}\n\n${node.message}`).length;
};

interface Range {
  readonly label: string;
  readonly include: ReadonlyArray<number>;
  readonly exclude: ReadonlyArray<number>;
}

export const RANGE_CLASSES = [
  "one tip, nothing excluded",
  "exclude reaches the include",
  "include equal to exclude",
  "an include an exclude reaches",
  "several includes sharing history",
  "own commits of a branch",
] as const;

/** Ranges drawn from a history (at least one commit), one for each class above. */
export const drawRanges = (history: History, texture: Texture, k: number): ReadonlyArray<Range> => {
  const n = history.nodes.length;
  const draw = new Draw({ ...texture, nums: [...texture.nums.slice(k % 32), ...texture.nums] });
  const a = draw.int(n);
  const b = draw.int(n);
  const c = draw.int(n);
  const descendant = history.nodes.findIndex((_, i) => reach(history, [i]).has(a) && i !== a);

  return [
    { label: "one tip, nothing excluded", include: [a], exclude: [] },
    { label: "exclude reaches the include", include: [a], exclude: [descendant === -1 ? a : descendant] },
    { label: "include equal to exclude", include: [a, b], exclude: [a, b] },
    {
      label: "an include an exclude reaches",
      include: [...new Set([a, b])],
      exclude: [descendant === -1 ? a : descendant],
    },
    { label: "several includes sharing history", include: [...new Set([a, b, c])], exclude: [] },
    { label: "own commits of a branch", include: [a], exclude: [b] },
  ];
};

interface Pair {
  readonly kind: "plain" | "self" | "ancestor" | "unrelated" | "criss-cross";
  readonly a: number;
  readonly b: number;
}

export const PAIR_KINDS = ["plain", "self", "ancestor", "unrelated", "criss-cross"] as const;

/** Pairs of commits for merge-base and ancestor questions, each tagged with the class it reaches. */
export const drawPairs = (shape: Shape, texture: Texture, k: number): ReadonlyArray<Pair> => {
  const { label, history } = shape;
  const n = history.nodes.length;

  if (n === 0) {
    return [];
  }

  const draw = new Draw({ ...texture, nums: [...texture.nums.slice((k * 3) % 32), ...texture.nums] });

  const pairs: Array<Pair> = [
    { kind: "plain", a: draw.int(n), b: draw.int(n) },
    { kind: "plain", a: draw.int(n), b: draw.int(n) },
    { kind: "self", a: n - 1, b: n - 1 },
  ];

  const child = history.nodes.findIndex((node) => node.parents.length > 0);
  const parent = history.nodes[child]?.parents[0];

  if (child !== -1 && parent !== undefined) {
    pairs.push({ kind: "ancestor", a: parent, b: child });
  }

  if (label === "a criss-cross") {
    pairs.push({ kind: "criss-cross", a: CRISS.first, b: CRISS.second });
  }

  if (label === "two unrelated roots" || label === "three unrelated roots") {
    const first = history.nodes.findIndex((node) => node.parents.length === 0);
    pairs.push({ kind: "unrelated", a: first, b: n - 1 });
  }

  return pairs;
};

// ---------------------------------------------------------------------------------------------------------
// Edits: the files of two commits, and the change between them as the model names it (ticket 1933)
// ---------------------------------------------------------------------------------------------------------

const NO_BYTES = new Uint8Array();

/** One character for each byte, so a text of bytes compares and prints exactly. */
const latin1 = (octets: Uint8Array): string => Array.from(octets, (octet) => String.fromCharCode(octet)).join("");

const joined = (...parts: ReadonlyArray<string | ReadonlyArray<number>>): Uint8Array =>
  Uint8Array.from(parts.flatMap((part) => (Predicate.isString(part) ? [...utf8(part)] : [...part])));

/** git's own rule for a file it does not split into lines: a NUL byte among the first 8000. */
const hasNul = (octets: Uint8Array): boolean => octets.subarray(0, 8000).includes(0);

/** The lines of a file, each with its own end. A last line with no newline has none. */
const splitLines = (octets: Uint8Array): ReadonlyArray<string> => {
  const text = latin1(octets);
  const found: Array<string> = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      found.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }

  return start < text.length ? [...found, text.slice(start)] : found;
};

/**
 * The lines removed and added from one smallest diff, each block with its removed lines first. A file the generator draws
 * has one smallest diff, so any smallest diff is the one git prints.
 */
const lineChanges = (before: ReadonlyArray<string>, after: ReadonlyArray<string>): ReadonlyArray<string> => {
  const n = before.length;
  const m = after.length;
  // `longest.get(i, j)` is the length of the longest common run of `before` from i and `after` from j.
  const table = new Map<number, number>();
  const longest = (i: number, j: number): number => (i >= n || j >= m ? 0 : (table.get(i * (m + 1) + j) ?? 0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table.set(
        i * (m + 1) + j,
        before[i] === after[j] ? longest(i + 1, j + 1) + 1 : Math.max(longest(i + 1, j), longest(i, j + 1)),
      );
    }
  }

  const changes: Array<string> = [];
  let i = 0;
  let j = 0;

  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      i += 1;
      j += 1;
    } else if (j >= m || (i < n && longest(i + 1, j) >= longest(i, j + 1))) {
      changes.push(`-${before[i]}`);
      i += 1;
    } else {
      changes.push(`+${after[j]}`);
      j += 1;
    }
  }

  return changes;
};

const isLink = (mode: FileSpec["mode"]): boolean => mode === "120000";

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((octet, i) => octet === b[i]);

// What a changed file adds to the key: a binary file by the bytes on both sides (git names it by its two blobs), a text file by
// its removed and added lines in order. `all` is a file that changed kind, whose every old line is removed and every new one added.
const body = (before: Uint8Array | undefined, after: Uint8Array | undefined, all: boolean): ReadonlyArray<string> => {
  if (hasNul(before ?? NO_BYTES) || hasNul(after ?? NO_BYTES)) {
    return ["binary", before === undefined ? "-" : latin1(before), after === undefined ? "-" : latin1(after)];
  }

  const old = splitLines(before ?? NO_BYTES);
  const next = splitLines(after ?? NO_BYTES);

  return all ? [...old.map((line) => `-${line}`), ...next.map((line) => `+${line}`)] : lineChanges(old, next);
};

const section = (path: string, before: FileSpec | undefined, after: FileSpec | undefined): ReadonlyArray<string> => {
  if (before === undefined && after !== undefined) {
    return ["new", path, after.mode, ...body(undefined, after.content, false)];
  }

  if (before !== undefined && after === undefined) {
    return ["deleted", path, before.mode, ...body(before.content, undefined, false)];
  }

  if (before === undefined || after === undefined) {
    return [];
  }

  if (isLink(before.mode) !== isLink(after.mode)) {
    return ["kind", path, before.mode, after.mode, ...body(before.content, after.content, true)];
  }

  const modes = before.mode === after.mode ? [] : [`mode ${before.mode} ${after.mode}`];

  return sameBytes(before.content, after.content)
    ? ["modified", path, ...modes]
    : ["modified", path, ...modes, ...body(before.content, after.content, false)];
};

const changedSections = (
  before: ReadonlyArray<FileSpec>,
  after: ReadonlyArray<FileSpec>,
): ReadonlyArray<{ readonly path: string; readonly from: FileSpec | undefined; readonly to: FileSpec | undefined }> => {
  const was = new Map(before.map((each) => [each.path, each]));
  const now = new Map(after.map((each) => [each.path, each]));

  return [...new Set([...was.keys(), ...now.keys()])]
    .sort(byBytes)
    .map((path) => ({ path, from: was.get(path), to: now.get(path) }))
    .filter(
      ({ from, to }) =>
        from === undefined || to === undefined || from.mode !== to.mode || !sameBytes(from.content, to.content),
    );
};

/**
 * The model's name for the change from one set of files to another: what a patch id must be equal for. It holds each changed
 * file in path byte order, with its path, a mode only where it is new, gone or changed, and its removed and added lines with
 * their own ends, or both sides' bytes for a binary file. It holds no blob id of a text file and no line number. Two changes
 * have one patch id exactly when their keys are equal, and `undefined` is no change.
 */
export const changeKey = (before: ReadonlyArray<FileSpec>, after: ReadonlyArray<FileSpec>): string | undefined => {
  const sections = changedSections(before, after).map(({ path, from, to }) => section(path, from, to));

  return sections.length === 0 ? undefined : JSON.stringify(sections);
};

/** How many files two sets of files differ in: a file that changes kind counts once. */
export const changedFiles = (before: ReadonlyArray<FileSpec>, after: ReadonlyArray<FileSpec>): number =>
  changedSections(before, after).length;

/** The bytes of content a diff compares: each changed file's bytes before and after, none for a side the file lacks. */
export const comparedBytes = (before: ReadonlyArray<FileSpec>, after: ReadonlyArray<FileSpec>): number =>
  changedSections(before, after).reduce(
    (total, { from, to }) => total + (from?.content.length ?? 0) + (to?.content.length ?? 0),
    0,
  );

/** One edit the generator draws: the commits it goes from and to, the files of both, and the model's key of the change. */
export interface EditCase {
  readonly label: string;
  /** The classes of the plan this case reaches. */
  readonly classes: ReadonlyArray<string>;
  /** Indexes into the carrier's history. */
  readonly from: number;
  readonly to: number;
  readonly before: ReadonlyArray<FileSpec>;
  readonly after: ReadonlyArray<FileSpec>;
  readonly key: string | undefined;
}

export interface EditCarrier {
  readonly history: History;
  readonly cases: ReadonlyArray<EditCase>;
  /** Each group is the cases that are one edit on bases that differ: their keys, and so their ids, are equal. */
  readonly same: ReadonlyArray<ReadonlyArray<number>>;
  /** The drawn edit every `variants` case is one change away from. */
  readonly drawn: number;
  readonly variants: ReadonlyArray<number>;
}

export const EDIT_CLASSES = [
  "(a) a new file",
  "(a) a deleted file",
  "(a) a changed file",
  "(a) a file made a link",
  "(a) a link made a file",
  "(a) a file made a link with the same bytes",
  "(a) a link made a file with the same bytes",
  "(b) a mode-only change",
  "(c) a NUL in the first 8000 bytes on one side",
  "(c) a NUL at byte 8000, binary",
  "(c) a NUL at byte 8001, text",
  "(d) a last line that loses its newline",
  "(d) a last line that gains its newline",
  "(d) CRLF lines",
  "(d) a change of whitespace only",
  "(e) a text file in latin-1 bytes",
  "(f) no change",
  "(f) an empty file added",
  "(g) change blocks at the first line and at the last",
  "(k) the sort traps in the changed paths",
  "(k) characters past U+024F, from U+E000 to U+FFFF, and __proto__",
  "(l) the same edit on a base that differs in another file",
  "(l) the same edit on a base that differs on the line next to it",
  "(l) the same edit where the edited file is executable on the base",
  "(l) the same edit lower in the file",
  "(m) one line changed from the drawn edit: other text",
  "(m) one line changed from the drawn edit: a trailing space",
  "(m) one line changed from the drawn edit: its line end only",
  "(m) the drawn edit at another path",
  "(m) the drawn edit on another line",
  "(m) the drawn edit reversed",
  "(n) a binary edit with other bytes",
  "(n) the same binary edit on a base that differs in another file",
  "(n) the drawn edit with a mode change added",
] as const;

const numbered = (tag: string, count: number, end = "\n"): ReadonlyArray<string> =>
  Array.from({ length: count }, (_, i) => `${tag}:${i}${end}`);

const replaceAt = (lines: ReadonlyArray<string>, index: number, line: string): ReadonlyArray<string> =>
  lines.map((each, i) => (i === index ? line : each));

const withoutLastEnd = (lines: ReadonlyArray<string>): ReadonlyArray<string> =>
  lines.map((each, i) => (i === lines.length - 1 ? each.replace(/\n$/, "") : each));

/**
 * A history of one line of commits, and the edits between pairs of them. Every file is lines no other line of its file
 * repeats, and every inserted line is new to its file, so an edit has one smallest diff and git and the memory adapter
 * print the same lines. A case holds its two commits; a reversed case reuses them the other way round.
 */
export const editCarrier = (texture: Texture): EditCarrier => {
  const p = at(texture.parts, 0);
  const q = at(texture.parts, 1);
  const r = at(texture.parts, 2);
  const src = `s${p}/f${q}`;

  const text = (path: string, lines: ReadonlyArray<string>, mode: FileSpec["mode"] = "100644"): FileSpec =>
    textFile(path, lines.join(""), mode);

  const base = numbered(p, 5);
  const drawn = replaceAt(base, 2, `${p}:new2\n`);
  const other = text(`o${q}`, [`${p}-o:${q}\n`]);
  const alike = text(`o${q}`, [`${r}-x:${q}\n`, "y\n"]);

  const seed = at(texture.signatures, 0);
  const nodes: Array<Node> = [];

  const commit = (files: ReadonlyArray<FileSpec>): number => {
    const i = nodes.length;

    nodes.push({
      parents: i === 0 ? [] : [i - 1],
      author: { ...seed, seconds: BASE_SECONDS + i, offset: "+0000" },
      committer: { ...seed, seconds: BASE_SECONDS + i, offset: "+0000" },
      message: `edit ${i}`,
      files,
    });

    return i;
  };

  const cases: Array<EditCase> = [];

  const made = (
    label: string,
    classes: ReadonlyArray<string>,
    before: ReadonlyArray<FileSpec>,
    after: ReadonlyArray<FileSpec>,
  ): EditCase => {
    const edit: EditCase = {
      label,
      classes,
      from: commit(before),
      to: commit(after),
      before,
      after,
      key: changeKey(before, after),
    };

    cases.push(edit);

    return edit;
  };

  const reversed = (label: string, classes: ReadonlyArray<string>, source: EditCase): EditCase => {
    const edit: EditCase = {
      label,
      classes,
      from: source.to,
      to: source.from,
      before: source.after,
      after: source.before,
      key: changeKey(source.after, source.before),
    };

    cases.push(edit);

    return edit;
  };

  // The drawn edit, and the same edit on bases that differ.
  const first = made("the drawn edit", ["(a) a changed file"], [other, text(src, base)], [other, text(src, drawn)]);

  const same = [
    first,
    made(
      "the same edit, another file differs",
      ["(l) the same edit on a base that differs in another file"],
      [alike, text(src, base)],
      [alike, text(src, drawn)],
    ),
    made(
      "the same edit, the line next to it differs",
      ["(l) the same edit on a base that differs on the line next to it"],
      [other, text(src, replaceAt(base, 1, `${p}:next1\n`))],
      [other, text(src, replaceAt(replaceAt(base, 1, `${p}:next1\n`), 2, `${p}:new2\n`))],
    ),
    made(
      "the same edit, the file is executable on the base",
      ["(l) the same edit where the edited file is executable on the base"],
      [other, text(src, base, "100755")],
      [other, text(src, drawn, "100755")],
    ),
    made(
      "the same edit, lower in the file",
      ["(l) the same edit lower in the file"],
      [other, text(src, [`${p}:top0\n`, `${p}:top1\n`, ...base])],
      [other, text(src, [`${p}:top0\n`, `${p}:top1\n`, ...drawn])],
    ),
  ];

  // One change away from the drawn edit.
  const variants = [
    made(
      "other text",
      ["(m) one line changed from the drawn edit: other text"],
      [other, text(src, base)],
      [other, text(src, replaceAt(base, 2, `${p}:other2\n`))],
    ),
    made(
      "a trailing space",
      ["(m) one line changed from the drawn edit: a trailing space"],
      [other, text(src, base)],
      [other, text(src, replaceAt(base, 2, `${p}:new2 \n`))],
    ),
    made(
      "its line end only",
      ["(m) one line changed from the drawn edit: its line end only"],
      [other, text(src, base)],
      [other, text(src, replaceAt(base, 2, `${p}:new2\r\n`))],
    ),
    made(
      "the drawn edit at another path",
      ["(m) the drawn edit at another path"],
      [other, text(`s${p}/g${q}`, base)],
      [other, text(`s${p}/g${q}`, drawn)],
    ),
    made(
      "the drawn edit on another line",
      ["(m) the drawn edit on another line"],
      [other, text(src, base)],
      [other, text(src, replaceAt(base, 3, `${p}:new2\n`))],
    ),
    reversed("the drawn edit reversed", ["(m) the drawn edit reversed"], first),
    made(
      "the drawn edit with a mode change added",
      ["(n) the drawn edit with a mode change added"],
      [other, text(src, base)],
      [other, text(src, drawn, "100755")],
    ),
  ];

  // Binary files: named by their two blobs.
  const binary = (path: string, last: number): ReadonlyArray<FileSpec> => [
    file(path, joined("a", [0], String.fromCharCode(last))),
  ];

  const bin = `b${p}`;

  const binaryEdit = made(
    "a binary edit",
    ["(n) a binary edit with other bytes"],
    binary(bin, 0x62),
    binary(bin, 0x63),
  );

  made("a binary edit with other bytes", ["(n) a binary edit with other bytes"], binary(bin, 0x62), binary(bin, 0x64));

  const sameBinary = made(
    "the same binary edit beside another file",
    ["(n) the same binary edit on a base that differs in another file"],
    [other, ...binary(bin, 0x62)],
    [other, ...binary(bin, 0x63)],
  );

  // A file that turns binary on one side: two bases that differ only in an unchanged line, so a decision that reads it as
  // text would give both one id.
  const turns = (first: string): ReadonlyArray<FileSpec> => [file(`x${p}`, joined(first, "x\n"))];
  const turned = (first: string): ReadonlyArray<FileSpec> => [file(`x${p}`, joined(first, "x", [0], "\n"))];
  made("text becomes binary", ["(c) a NUL in the first 8000 bytes on one side"], turns("q\n"), turned("q\n"));
  made(
    "text becomes binary, another base",
    ["(c) a NUL in the first 8000 bytes on one side"],
    turns("r\n"),
    turned("r\n"),
  );

  // A NUL at index 8000 is the 8001st byte, which git does not look at; at index 7999 it does. Each pair is one edit (the first
  // letter of the long line) on two bases that differ in the line above it.
  const nul = (above: string, first: string, index: number): Uint8Array =>
    joined(above, first, "x".repeat(index - above.length - 1), [0], "t\n");

  const long =
    (above: string, index: number) =>
    (first: string): ReadonlyArray<FileSpec> => [file(`n${p}`, nul(above, first, index))];

  const text8001 = [
    made("a NUL at byte 8001", ["(c) a NUL at byte 8001, text"], long("q\n", 8000)("a"), long("q\n", 8000)("b")),
    made(
      "a NUL at byte 8001, another base",
      ["(c) a NUL at byte 8001, text"],
      long("r\n", 8000)("a"),
      long("r\n", 8000)("b"),
    ),
  ];

  made("a NUL at byte 8000", ["(c) a NUL at byte 8000, binary"], long("q\n", 7999)("a"), long("q\n", 7999)("b"));
  made(
    "a NUL at byte 8000, another base",
    ["(c) a NUL at byte 8000, binary"],
    long("r\n", 7999)("a"),
    long("r\n", 7999)("b"),
  );

  // Kinds of file: new, gone, links.
  made("a new file", ["(a) a new file"], [other], [other, text(src, base)]);
  made("a deleted file", ["(a) a deleted file"], [other, text(src, base)], [other]);
  made("a file made a link", ["(a) a file made a link"], [text(src, base)], [text(src, [`t${q}`], "120000")]);
  made("a link made a file", ["(a) a link made a file"], [text(src, [`t${q}`], "120000")], [text(src, base)]);

  // A file and a link that hold the same bytes are two blobs of one id, yet git prints every old line removed and every new line
  // added, so two such changes with other bytes are two changes.
  for (const target of [`x${q}`, `y${q}`]) {
    made(
      `a file made a link, both holding ${target}`,
      ["(a) a file made a link with the same bytes"],
      [text(src, [target])],
      [text(src, [target], "120000")],
    );
    made(
      `a link made a file, both holding ${target}`,
      ["(a) a link made a file with the same bytes"],
      [text(src, [target], "120000")],
      [text(src, [target])],
    );
  }

  // Modes.
  made("a mode-only change", ["(b) a mode-only change"], [text(src, base)], [text(src, base, "100755")]);
  made("a mode-only change of a binary file", ["(b) a mode-only change"], binary(bin, 0x62), [
    file(bin, joined("a", [0], "b"), "100755"),
  ]);

  // Line ends.
  made(
    "the last line loses its newline",
    ["(d) a last line that loses its newline"],
    [text(src, base)],
    [text(src, withoutLastEnd(base))],
  );
  made(
    "the last line gains its newline",
    ["(d) a last line that gains its newline"],
    [text(src, withoutLastEnd(base))],
    [text(src, base)],
  );

  const crlf = numbered(p, 4, "\r\n");
  made("CRLF lines", ["(d) CRLF lines"], [text(src, crlf)], [text(src, replaceAt(crlf, 2, `${p}:new2\r\n`))]);
  made(
    "a change of whitespace only",
    ["(d) a change of whitespace only"],
    [text(src, base)],
    [text(src, replaceAt(base, 2, ` ${p}:2\n`))],
  );

  // Bytes that are not UTF-8, and no NUL.
  const latin = (lines: ReadonlyArray<string>): Uint8Array =>
    joined(...lines.flatMap((line): ReadonlyArray<string | ReadonlyArray<number>> => [[0xe9], line]));

  made("latin-1 lines", ["(e) a text file in latin-1 bytes"], [file(src, latin(base))], [file(src, latin(drawn))]);

  // Nothing changed, and an empty file.
  made("no change", ["(f) no change"], [other, text(src, base)], [other, text(src, base)]);
  made("an empty file added", ["(f) an empty file added"], [other], [other, file(`e${p}`, NO_BYTES)]);

  // Several blocks.
  made(
    "blocks at the first line and at the last",
    ["(g) change blocks at the first line and at the last"],
    [text(src, base)],
    [text(src, replaceAt(replaceAt(base, 0, `${p}:new0\n`), 4, `${p}:new4\n`))],
  );
  made(
    "blocks at the first line and at the last but one",
    ["(g) change blocks at the first line and at the last"],
    [text(src, base)],
    [text(src, replaceAt(replaceAt(base, 0, `${p}:new0\n`), 3, `${p}:new3\n`))],
  );

  // Paths: names that sort in traps, and wide characters.
  const trap = [`f${p}/c`, `f${p}-b`, `f${p}.b`, `f${p}0`];
  const pair = [`${p}:a\n`, `${p}:b\n`];

  made(
    "the sort traps",
    ["(k) the sort traps in the changed paths"],
    trap.map((path) => text(path, pair)),
    trap.map((path) => text(path, replaceAt(pair, 1, `${p}:new\n`))),
  );

  // The same edit at paths one character apart: a hash that folds punctuation or non-ASCII characters together would give two of
  // these one id.
  for (const path of [`k${p}-b`, `k${p}.b`]) {
    made(
      `the drawn edit at ${path}`,
      ["(k) the sort traps in the changed paths"],
      [other, text(path, base)],
      [other, text(path, drawn)],
    );
  }

  for (const mark of ["\u8BBE", "\uFF5A", "\u{1F600}"]) {
    made(
      `the drawn edit at ${mark}${p}`,
      ["(k) characters past U+024F, from U+E000 to U+FFFF, and __proto__"],
      [other, text(`${mark}${p}`, base)],
      [other, text(`${mark}${p}`, drawn)],
    );
  }

  const wide = ["\u8BBE", "\uFF5A", "\u{1F600}", "\u0250", "\uE000"].map((mark) => `${mark}${p}`).concat("__proto__");

  made(
    "wide characters and __proto__",
    ["(k) characters past U+024F, from U+E000 to U+FFFF, and __proto__"],
    wide.map((path) => text(path, pair)),
    wide.map((path) => text(path, replaceAt(pair, 0, `${p}:new\n`))),
  );

  return {
    history: { nodes, refs: [], shallow: [] },
    cases,
    same: [same, [binaryEdit, sameBinary], text8001].map((group) => group.map((each) => cases.indexOf(each))),
    drawn: cases.indexOf(first),
    variants: variants.map((each) => cases.indexOf(each)),
  };
};

/** The classes of `EDIT_CLASSES` the carrier's cases reach, in the list's order. */
export const reachedEditClasses = (carrier: EditCarrier): ReadonlyArray<string> => {
  const reached = new Set(carrier.cases.flatMap((each) => each.classes));

  return EDIT_CLASSES.filter((label) => reached.has(label));
};

export const LIMIT_CLASSES = [
  "exactly the files limit",
  "one file more than the limit",
  "exactly the diff limit",
  "one byte more than the limit",
  "over both limits",
] as const;

/**
 * Two commits that differ in four files (one changed, one new, one gone, one whose mode only changes) beside two files that
 * do not change and are larger than the changed ones together, so a count that includes them is seen.
 */
export const limitCarrier = (
  texture: Texture,
): { readonly history: History; readonly before: ReadonlyArray<FileSpec>; readonly after: ReadonlyArray<FileSpec> } => {
  const [a, b, c, d] = [at(texture.blobs, 0), at(texture.blobs, 1), at(texture.blobs, 2), at(texture.blobs, 3)];
  const p = at(texture.parts, 0);
  const big = (k: number): Uint8Array => Uint8Array.from({ length: 4000 }, (_, i) => (i * 7 + k) & 255);
  const longer = Uint8Array.from([...a, 0x41]);

  const before = [
    file(`u${p}1`, big(1)),
    file(`u${p}2`, big(2)),
    file(`c${p}`, a),
    file(`g${p}`, b),
    file(`m${p}`, d, "100644"),
  ];

  const after = [
    file(`u${p}1`, big(1)),
    file(`u${p}2`, big(2)),
    file(`c${p}`, longer),
    file(`n${p}`, c),
    file(`m${p}`, d, "100755"),
  ];

  const seedSignature = at(texture.signatures, 0);

  const nodes = [before, after].map((files, i): Node => ({
    parents: i === 0 ? [] : [0],
    author: { ...seedSignature, seconds: BASE_SECONDS + i, offset: "+0000" },
    committer: { ...seedSignature, seconds: BASE_SECONDS + i, offset: "+0000" },
    message: `limit ${i}`,
    files,
  }));

  return { history: { nodes, refs: [], shallow: [] }, before, after };
};

// Writing a commit and moving a ref
// ---------------------------------------------------------------------------------------------------------

/** The committer setting: a name and an email, plain data. */
export interface Committer {
  readonly name: string;
  readonly email: string;
}

export const committerFrom = (flat: FlatSignature): Committer => ({ name: flat.name, email: flat.email });

/** What a committer's name and email take: what a signature's takes, so every name and email class of a signature but not its time. */
export const COMMITTER_ACCEPT_CLASSES: ReadonlyArray<string> = SIGNATURE_CLASSES.filter(
  (label) => !label.startsWith("seconds") && !label.startsWith("the offset"),
);

export const committerAccepted = (base: FlatSignature): ReadonlyArray<readonly [label: string, person: Committer]> =>
  signatureVariants(base)
    .filter(([label]) => COMMITTER_ACCEPT_CLASSES.includes(label))
    .map(([label, flat]) => [label, committerFrom(flat)]);

export const COMMITTER_REFUSE_CLASSES = [
  "a name with <",
  "a name with >",
  "a name with a line break",
  "a name with a NUL",
  "an email with >",
  "an email with a line break",
  "an email with a NUL",
] as const;

/** Each name and email a commit's format cannot hold, one break of a good committer at a time. */
export const committerRefused = (base: Committer): ReadonlyArray<readonly [label: string, person: Committer]> => [
  ["a name with <", { ...base, name: `${base.name}<x` }],
  ["a name with >", { ...base, name: `${base.name}>x` }],
  ["a name with a line break", { ...base, name: `${base.name}\nx` }],
  ["a name with a NUL", { ...base, name: `${base.name}\u0000x` }],
  ["an email with >", { ...base, email: `${base.email}>x` }],
  ["an email with a line break", { ...base, email: `${base.email}\nx` }],
  ["an email with a NUL", { ...base, email: `${base.email}\u0000x` }],
];

/** Settings as a drawn value: limits, and a committer that is a good name and a good email. */
export const settingsArb = Arbitrary.all({
  limits: limitsArb,
  committer: flatSignatureArb.pipe(Arbitrary.map(committerFrom)),
});

/** The same history with every committer the settings' one, at offset +0000: what a commit written with those settings holds. */
export const asWritten = (history: History, committer: Committer): History => ({
  ...history,
  nodes: history.nodes.map((node) => ({
    ...node,
    committer: { ...node.committer, name: committer.name, email: committer.email, offset: "+0000" },
  })),
});

/** A commit to write: the files of commit `tree` (or git's empty tree) with the commits `parents`, in this order. */
export interface WriteSpec {
  readonly label: string;
  readonly tree: number | "empty";
  readonly parents: ReadonlyArray<number>;
}

export const WRITE_SHAPE_CLASSES = [
  "a root",
  "one parent",
  "a drawn tree and a drawn parent",
  "the empty tree",
  "two parents",
  "two parents, the other way round",
  "three parents",
] as const;

/** Commits to write for a history, one for each class it can reach: a history of one commit has no two parents. */
export const writeSpecs = (history: History, texture: Texture): ReadonlyArray<WriteSpec> => {
  const n = history.nodes.length;

  if (n === 0) {
    return [];
  }

  const draw = new Draw(texture);
  const a = draw.int(n);

  const specs: Array<WriteSpec> = [
    { label: "a root", tree: a, parents: [] },
    { label: "one parent", tree: n - 1, parents: [a] },
    { label: "a drawn tree and a drawn parent", tree: draw.int(n), parents: [draw.int(n)] },
    { label: "the empty tree", tree: "empty", parents: [] },
  ];

  if (n >= 2) {
    const b = (a + 1 + draw.int(n - 1)) % n;
    specs.push(
      { label: "two parents", tree: draw.int(n), parents: [a, b] },
      { label: "two parents, the other way round", tree: draw.int(n), parents: [b, a] },
    );

    if (n >= 3) {
      const c = Array.from({ length: n }, (_, i) => i).find((i) => i !== a && i !== b) ?? a;
      specs.push({ label: "three parents", tree: draw.int(n), parents: [c, a, b] });
    }
  }

  return specs;
};

/** The bytes of a commit object as the format says, from plain fields: the model of what a written commit weighs. */
export const writtenSize = (fields: {
  readonly tree: string;
  readonly parents: ReadonlyArray<string>;
  readonly author: FlatSignature;
  readonly committer: Committer;
  readonly seconds: number;
  readonly message: string;
}): number => {
  const head = [
    `tree ${fields.tree}`,
    ...fields.parents.map((id) => `parent ${id}`),
    `author ${fields.author.name} <${fields.author.email}> ${fields.author.seconds} ${fields.author.offset}`,
    `committer ${fields.committer.name} <${fields.committer.email}> ${fields.seconds} +0000`,
  ].join("\n");

  return utf8(`${head}\n\n${fields.message}`).length;
};

/** A message that ends in a character of one byte, of three and of four, so a size counted in characters is seen. */
export const EDGE_CLASSES = [
  "an ASCII character at the edge",
  "a character past U+024F at the edge",
  "a character outside the Basic Multilingual Plane at the edge",
] as const;

export const edgeMessages = (word: string): ReadonlyArray<readonly [label: string, message: string]> => [
  ["an ASCII character at the edge", `${word}\n`],
  ["a character past U+024F at the edge", `${word}设`],
  ["a character outside the Basic Multilingual Plane at the edge", `${word}\u{1F600}`],
];

/** A message with a NUL byte at its start, in its middle and at its end. */
export const NUL_CLASSES = ["a NUL at the start", "a NUL in the middle", "a NUL at the end"] as const;

export const nulMessages = (word: string): ReadonlyArray<readonly [label: string, message: string]> => [
  ["a NUL at the start", `\u0000${word}\n`],
  ["a NUL in the middle", `${word}\u0000${word}\n`],
  ["a NUL at the end", `${word}\n\u0000`],
];

/** The commits of the move carrier by index. `three` and `side` each have `one` as a parent, `merge` joins them. */
export const MOVE = { root: 0, one: 1, main: 2, three: 3, side: 4, merge: 5 } as const;

/** A history made to move refs in: a line to commit 3, a side branch from commit 1, a merge, and refs that each have a reason. */
export const moveCarrier = (
  texture: Texture,
): {
  readonly history: History;
  readonly names: Record<"main" | "side" | "candidate" | "earlier" | "fresh" | "remote" | "gone" | "branch", string>;
} => {
  const draw = new Draw(texture);
  const part = draw.part();
  const built = build(draw, [[], [0], [1], [2], [1], [3, 4]], "forward");

  return {
    history: {
      ...built,
      refs: [
        { name: "refs/heads/main", commit: MOVE.main },
        { name: "refs/heads/side", commit: MOVE.side },
        { name: `refs/kalfa/candidates/e${part}`, commit: MOVE.three },
        // Listed after `e`, sorted before it: the ref in the way that comes first by bytes is not the first listed.
        { name: `refs/kalfa/candidates/d${part}`, commit: MOVE.one },
      ],
    },
    names: {
      main: "refs/heads/main",
      side: "refs/heads/side",
      candidate: `refs/kalfa/candidates/e${part}`,
      earlier: `refs/kalfa/candidates/d${part}`,
      fresh: `refs/kalfa/candidates/n${part}`,
      remote: `refs/remotes/origin/n${part}`,
      gone: `refs/heads/g${part}`,
      branch: `refs/heads/b${part}`,
    },
  };
};
