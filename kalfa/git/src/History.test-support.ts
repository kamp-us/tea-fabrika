// The history value and its generators, shared by every adapter's laws. HistoryTest.ts exports the part a caller of
// `/test/History` needs; the rest is for this package's own laws.
// A history is plain data: commits by index (a parent has a lower index), refs by name, and the indexes
// of shallow commits. It names no id: each adapter's seeder turns it into a store and hands back the ids.
// The model at the bottom answers what a walk, a merge base and an ancestor question must give, by index,
// so a law compares an adapter with the model and never with another adapter.
//
// A generator's reach is part of its law: every list named `*_CLASSES` below is a class the laws check in
// every run, each one applied to the run's drawn value, so a missing class fails a law loudly.
import { createHash } from "node:crypto";
import { Arbitrary, Predicate, Result, Schema } from "effect";
import { Path } from "./Tree.ts";

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

/** Positive whole counts and a time, and a kill wait, each as duration text: what the settings accept. */
export const limitsArb = Arbitrary.all({
  commits: intBetween(1, 1_000_000_000),
  refs: intBetween(1, 1_000_000_000),
  bytes: intBetween(1, 1_000_000_000),
  files: intBetween(1, 1_000_000_000),
  diff: intBetween(1, 1_000_000_000),
  blob: intBetween(1, 1_000_000_000),
  time: durationTextArb,
  kill: durationTextArb,
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

// ---------------------------------------------------------------------------------------------------------
// Reads: what `readFile` and `readText` must answer (ticket 1935, slice 1)
// ---------------------------------------------------------------------------------------------------------

/** What a read at one path must answer: the file's bytes, none, or the kind of thing that is no file. */
export type ReadModel =
  | { readonly kind: "file"; readonly bytes: Uint8Array }
  | { readonly kind: "none" }
  | { readonly kind: "not-a-file"; readonly path: string; readonly holds: "folder" | "link" };

type Held = "file" | "link" | "folder";

// What a path holds in a set of files: the file or the link at it, a folder when a file sits below it, else nothing.
const heldAt = (
  files: ReadonlyArray<FileSpec>,
  path: string,
): { readonly kind: Held; readonly file?: FileSpec } | undefined => {
  const found = files.find((each) => each.path === path);

  if (found !== undefined) {
    return { kind: found.mode === "120000" ? "link" : "file", file: found };
  }

  return files.some((each) => each.path.startsWith(`${path}/`)) ? { kind: "folder" } : undefined;
};

/**
 * What `readFile` must answer for a path in the files of one commit, part by part from the top: nothing at a part, or a file above the
 * last part, is none; a link above the last part is no file and names that part; at the last part a folder or a link is no file and
 * names the path, and a file is the answer. A submodule is on git only.
 */
export const readModel = (files: ReadonlyArray<FileSpec>, path: string): ReadModel => {
  const parts = path.split("/");

  for (const [i] of parts.entries()) {
    const prefix = parts.slice(0, i + 1).join("/");
    const held = heldAt(files, prefix);
    const last = i === parts.length - 1;

    if (held === undefined) {
      return { kind: "none" };
    }

    if (last) {
      return held.kind === "file" && held.file !== undefined
        ? { kind: "file", bytes: held.file.content }
        : { kind: "not-a-file", path, holds: held.kind === "link" ? "link" : "folder" };
    }

    if (held.kind === "file") {
      return { kind: "none" };
    }

    if (held.kind === "link") {
      return { kind: "not-a-file", path: prefix, holds: "link" };
    }
  }

  return { kind: "none" };
};

/** `readText`'s answer for bytes: the text, or `undefined` when they are not UTF-8. A BOM, a CR and a NUL are text. */
export const textModel = (bytes: Uint8Array): string | undefined => {
  const decoded = Result.try(() => strictUtf8.decode(bytes));

  return Result.isSuccess(decoded) ? decoded.success : undefined;
};

/** The classes a read carrier reaches, in this order: each reads at least once in every run. */
export const READ_CLASSES = [
  ...TREE_CLASSES.filter((label) => label !== "no files").map((label) => `(a) ${label}`),
  "(a) an empty file is Some of no bytes",
  "(a) a file beside a name that shares its start",
  "(b) a path no tree has",
  "(b) a name that shares its start with a file",
  "(b) a name that shares its end with a file",
  "(b) a name that is the start of a file's name",
  "(b) a path below a file",
  "(b) a path in a folder that does not exist",
  "(b) a commit with no files",
  "(c) a folder at the top",
  "(c) a folder three deep",
  "(d) a link at the path",
  "(d) a path below a link",
  "(g) UTF-8 with a BOM",
  "(g) a CR and a NUL",
  "(g) latin-1 bytes",
  "(g) a UTF-8 sequence cut short at the end",
  "(g) UTF-8 text with line breaks and wide characters",
] as const;

/** One read: a commit of the history and a path, the model's answer on that commit's files, and the classes it reaches. */
export interface ReadCase {
  readonly label: string;
  readonly classes: ReadonlyArray<string>;
  readonly commit: number;
  readonly path: string;
  readonly expected: ReadModel;
}

export interface ReadCarrier {
  readonly history: History;
  readonly cases: ReadonlyArray<ReadCase>;
}

/**
 * A history with a commit for every tree class and two more (names that share a start or an end, and text of every kind), and every
 * read a law makes on them: each file, each folder on its way, each link and a path below it, and paths that hold nothing.
 */
export const readCarrier = (texture: Texture): ReadCarrier => {
  const draw = new Draw(texture);
  const word = draw.word();
  const author = draw.signature(draw.int(4_000_000_000));
  const committer = draw.signature(0);
  const q = at(texture.parts, 4);
  const base = treeClasses(texture);

  const entries: ReadonlyArray<{
    readonly label: string;
    readonly classes: ReadonlyArray<string>;
    readonly files: ReadonlyArray<FileSpec>;
  }> = [
    ...base.map(({ label, files }) => ({ label, classes: label === "no files" ? [] : [`(a) ${label}`], files })),
    {
      label: "names that share a start or an end",
      classes: ["(a) a file beside a name that shares its start"],
      files: [
        file(`w${q}.b`, utf8("one")),
        file(`w${q}-b`, utf8("two")),
        file(`w${q}0`, utf8("three")),
        file(`xw${q}`, utf8("four")),
      ],
    },
    {
      label: "text",
      classes: [],
      files: [
        file(`g1${q}`, utf8("\uFEFFbom text\n")),
        file(`g2${q}`, Uint8Array.of(0x61, 0x0d, 0x0a, 0x62, 0x00, 0x63, 0x0a)),
        file(`g3${q}`, Uint8Array.of(0x63, 0xe9, 0x0a)),
        file(`g4${q}`, Uint8Array.of(0x61, 0xe2, 0x82)),
        file(`g5${q}`, utf8("line one\nline two \u00e9\u20ac\u{1F600}\n")),
      ],
    },
  ];

  const nodes = entries.map((entry, i): Node => ({
    parents: i === 0 ? [] : [i - 1],
    author,
    committer: { ...committer, seconds: BASE_SECONDS + i },
    message: word,
    files: entry.files,
  }));

  const cases: Array<ReadCase> = [];

  for (const [commit, entry] of entries.entries()) {
    const seen = new Set<string>();

    const add = (label: string, path: string, classes: ReadonlyArray<string>): void => {
      if (seen.has(path)) {
        return;
      }

      seen.add(path);
      cases.push({ label, classes, commit, path, expected: readModel(entry.files, path) });
    };

    const textClasses: ReadonlyArray<readonly [string, string]> = [
      ["g1", "(g) UTF-8 with a BOM"],
      ["g2", "(g) a CR and a NUL"],
      ["g3", "(g) latin-1 bytes"],
      ["g4", "(g) a UTF-8 sequence cut short at the end"],
      ["g5", "(g) UTF-8 text with line breaks and wide characters"],
    ];

    const textClass = (name: string): ReadonlyArray<string> =>
      textClasses.filter(([start]) => name.startsWith(start)).map(([, label]) => label);

    for (const each of entry.files) {
      const parts = each.path.split("/");
      const last = parts.at(-1) ?? each.path;
      const above = parts.slice(0, -1);
      const sibling = (name: string): string => [...above, name].join("/");
      const link = each.mode === "120000";

      add(
        `${entry.label}: ${each.path}`,
        each.path,
        link
          ? ["(d) a link at the path"]
          : [
              ...entry.classes,
              ...(each.content.length === 0 ? ["(a) an empty file is Some of no bytes"] : []),
              ...textClass(last),
            ],
      );
      add(`${entry.label}: below ${each.path}`, `${each.path}/z${q}`, [
        link ? "(d) a path below a link" : "(b) a path below a file",
      ]);
      add(`${entry.label}: deeper below ${each.path}`, `${each.path}/z${q}/y`, [
        link ? "(d) a path below a link" : "(b) a path below a file",
      ]);
      add(`${entry.label}: start of ${each.path}`, sibling(`${last}x`), [
        "(b) a name that shares its start with a file",
      ]);
      add(`${entry.label}: end of ${each.path}`, sibling(`x${last}`), ["(b) a name that shares its end with a file"]);

      // The start of the name: absent, though the names that start with it are there (`a` beside `a.b`, `a-b`, `a0`).
      const shorter = sibling(Array.from(last).slice(0, -1).join(""));

      if (Array.from(last).length > 1 && Schema.is(Path)(shorter)) {
        add(`${entry.label}: start of ${each.path}`, shorter, ["(b) a name that is the start of a file's name"]);
      }

      for (let n = 1; n < parts.length; n++) {
        add(
          `${entry.label}: folder ${parts.slice(0, n).join("/")}`,
          parts.slice(0, n).join("/"),
          [[], ["(c) a folder at the top"], [], ["(c) a folder three deep"]][Math.min(n, 3)] ?? [],
        );
      }
    }

    add(`${entry.label}: nothing`, `nothing${q}`, [
      "(b) a path no tree has",
      ...(entry.files.length === 0 ? ["(b) a commit with no files"] : []),
    ]);
    add(`${entry.label}: no folder`, `nofolder${q}/z/y`, ["(b) a path in a folder that does not exist"]);
  }

  return { history: { nodes, refs: refsFor(draw, nodes.length), shallow: [] }, cases };
};

/** What the names of a sibling tree are made of, each reached in every run by `nameCarrier`. */
export const NAME_CLASSES = [
  "a name that starts with the asked name",
  "a name that ends with the asked name",
  "a name that is the start of the asked name",
  "a name of the asked length that differs in one character",
  "a name of the asked byte length made of other characters",
  "an asked name that is absent and is the start of names that exist",
] as const;

const utf8Length = (text: string): number => utf8(text).length;

/**
 * Two commits of files whose names sit close to each other: for each of four asked names (two of them with a character of two or
 * three bytes), a sibling that starts with it, one that ends with it, one that is its start, ones of its length that differ in one
 * character, and ones of its byte length made of other characters; each at the top in the first commit and in a folder in the
 * second. Every name holds its own bytes, so a read that takes a neighbor's file is seen. The cases are every read of a file.
 */
export const nameCarrier = (texture: Texture): ReadCarrier & { readonly classes: ReadonlyArray<string> } => {
  const asked = [
    `a${at(texture.parts, 0)}`,
    `\u00e9${at(texture.parts, 1)}`,
    `${at(texture.parts, 2)}\u8BBE`,
    `\u{1F600}${at(texture.parts, 3)}`,
  ];

  const reached = new Set<string>();
  const names = new Map<string, number>();

  const take = (name: string, label?: (typeof NAME_CLASSES)[number]): void => {
    if (Schema.is(Path)(name) && !names.has(name)) {
      names.set(name, names.size);

      if (label !== undefined) {
        reached.add(label);
      }
    }
  };

  for (const name of asked) {
    const characters = Array.from(name);
    take(name);
    take(`${name}0`, NAME_CLASSES[0]);
    take(`${name}z`, NAME_CLASSES[0]);
    take(`0${name}`, NAME_CLASSES[1]);
    take(`z${name}`, NAME_CLASSES[1]);
    take(characters.slice(0, -1).join(""), NAME_CLASSES[2]);
    take(characters.slice(0, 1).join(""), NAME_CLASSES[2]);

    for (const [i, character] of characters.entries()) {
      const before = characters.slice(0, i).join("");
      const after = characters.slice(i + 1).join("");

      for (const other of ["0", "~"]) {
        if (utf8Length(character) === 1 && character !== other) {
          take(`${before}${other}${after}`, NAME_CLASSES[3]);
        }
      }

      if (utf8Length(character) > 1) {
        take(`${before}${"0".repeat(utf8Length(character))}${after}`, NAME_CLASSES[4]);
      }
    }
  }

  // Names that are asked and are not there, each the start of names that are: files beside it (`m.b`, `m-b`, `m0`, `mb`) and folders
  // (`m.d/x`, `m-d/x`). A name that only starts other names is none, never a folder.
  const absent = [`m${at(texture.parts, 5)}`, `\u00fc${at(texture.parts, 6)}`];

  const beside = absent.flatMap((name) =>
    [`${name}.b`, `${name}-b`, `${name}0`, `${name}b`, `${name}.d/x`, `${name}-d/x`].filter((each) =>
      Schema.is(Path)(each),
    ),
  );

  const content = (n: number): Uint8Array =>
    Uint8Array.from({ length: 3 + (n % 5) }, (_, k) => [n & 255, n >> 8][k] ?? (n * 31 + k * 7) & 255);

  const draw = new Draw(texture);
  const word = draw.word();
  const author = draw.signature(draw.int(4_000_000_000));
  const committer = draw.signature(0);
  const folder = `dir${at(texture.parts, 4)}`;

  const layouts: ReadonlyArray<(name: string) => string> = [(name) => name, (name) => `${folder}/${name}`];

  const nodes = layouts.map((place, i): Node => ({
    parents: i === 0 ? [] : [i - 1],
    author,
    committer: { ...committer, seconds: BASE_SECONDS + i },
    message: word,
    files: [
      ...[...names].map(([name, n]) => file(place(name), content(n))),
      ...beside.map((name, i) => file(place(name), content(names.size + i))),
    ],
  }));

  const cases = nodes.flatMap((node, commit) => [
    ...node.files.map((each): ReadCase => ({
      label: `names: ${each.path}`,
      classes: [],
      commit,
      path: each.path,
      expected: readModel(node.files, each.path),
    })),
    ...absent.map((name): ReadCase => {
      const path = (layouts[commit] ?? ((text: string) => text))(name);

      return {
        label: `names: absent ${path}`,
        classes: [NAME_CLASSES[5]],
        commit,
        path,
        expected: readModel(node.files, path),
      };
    }),
  ]);

  reached.add(NAME_CLASSES[5]);

  return {
    history: { nodes, refs: refsFor(draw, nodes.length), shallow: [] },
    cases,
    classes: NAME_CLASSES.filter((label) => reached.has(label)),
  };
};

/** The classes of `READ_CLASSES` that the cases of a carrier reach, in the list's order. */
export const reachedReadClasses = (carrier: ReadCarrier): ReadonlyArray<string> => {
  const reached = new Set(carrier.cases.flatMap((each) => each.classes));

  return READ_CLASSES.filter((label) => reached.has(label));
};

// ---------------------------------------------------------------------------------------------------------
// Edits: what `editTree` must answer (ticket 1935, slice 2)
// ---------------------------------------------------------------------------------------------------------

/** What an edit does to one path: the file's new bytes, or `"absent"`. */
export type PathChange = Uint8Array | "absent";

/** An edit as a law hands it to `editTree`: each path once, in the order the law inserts them. */
export type ChangeList = ReadonlyArray<readonly [path: string, change: PathChange]>;

/** What `editTree` must answer for an edit over some files: the files of the tree it makes, or the refusal. */
export type EditModel =
  | { readonly kind: "files"; readonly files: ReadonlyArray<FileSpec> }
  | { readonly kind: "too-large"; readonly path: string; readonly most: number }
  | { readonly kind: "not-a-file"; readonly path: string; readonly holds: "folder" | "link" }
  | { readonly kind: "in-the-way"; readonly path: string; readonly other: string };

/**
 * The model of `editTree`, in the plan's check order: the first changed path by bytes whose new content is over `limit`; the
 * first changed path by bytes that `readFile` refuses, removal included; then the result, in which the first new path by bytes
 * with a file at one of its folders names the shortest such folder. A replaced file keeps its mode, a new file is `100644`.
 */
export const editModel = (files: ReadonlyArray<FileSpec>, changes: ChangeList, limit: number): EditModel => {
  const sorted = changes.toSorted(([a], [b]) => byBytes(a, b));
  const large = sorted.find(([, change]) => change !== "absent" && change.length > limit);

  if (large !== undefined) {
    return { kind: "too-large", path: large[0], most: limit };
  }

  for (const [path] of sorted) {
    const read = readModel(files, path);

    if (read.kind === "not-a-file") {
      return { kind: "not-a-file", path: read.path, holds: read.holds };
    }
  }

  const result = new Map(files.map((each) => [each.path, each]));

  for (const [path, change] of sorted) {
    if (change === "absent") {
      result.delete(path);
    } else {
      result.set(path, { path, mode: result.get(path)?.mode ?? "100644", content: change });
    }
  }

  for (const [path, change] of sorted) {
    const parts = path.split("/");

    for (let n = 1; change !== "absent" && n < parts.length; n++) {
      const other = parts.slice(0, n).join("/");

      if (result.has(other)) {
        return { kind: "in-the-way", path, other };
      }
    }
  }

  return { kind: "files", files: [...result.values()] };
};

/** What the generator reaches for edits, each in every run (the letters are the plan's generator classes). */
export const TREE_EDIT_CLASSES = [
  "(k) one file replaced",
  "(k) several files in several folders in one call",
  "(k) a new file in a new folder three deep",
  "(k) a file removed",
  "(k) the last files of a folder removed, so the folder goes",
  "(k) the last file of three nested folders removed, so all three go",
  "(k) every file removed, the empty tree",
  "(k) a file made a folder",
  "(k) a folder emptied, then a file at its path",
  "(k) a file added to the empty tree",
  "(k) a name that starts others and a name that others start",
  "(k) a random edit",
  "(k) a random edit on an edited tree",
  "(l) an empty edit",
  "(l) a file replaced with its own bytes",
  "(l) an executable file replaced with its own bytes",
  "(l) absent on a path that holds nothing",
  "(l) absent below a file",
  "(l) absent in a folder that does not exist",
  "(l) an edit on the empty tree that changes nothing",
  "(m) an executable file replaced stays 100755",
  "(m) a new file is 100644 beside an executable one",
  "(m) a new file is 100644 in a folder of executable files",
  "(n) a changed path that is a folder",
  "(n) absent at a folder",
  "(n) a folder's files removed and a file added at its path",
  "(n) a link replaced",
  "(n) a link removed",
  "(n) a change below a link",
  "(n) absent below a link",
  "(n) a new file below a file the edit keeps",
  "(n) two new files, one below the other",
  "(p) content too large at a folder's path",
  "(p) a change at a folder beside a new file in the way",
  "(p) two folders changed",
  "(p) two new files in the way",
  "(q) the sort traps among the changed names of one folder",
  "(q) the sort traps added and removed in one folder",
  "(q) names on the object prototype",
] as const;

/** What an edit case is meant to come to, on a store with room for every file. */
export type EditIntent = "tree" | "no change" | "not-a-file" | "in-the-way";

/** One edit: the commit it is made on, what it changes, and the commit whose tree is its answer when it makes one. */
export interface TreeEditCase {
  readonly label: string;
  readonly classes: ReadonlyArray<string>;
  readonly intent: EditIntent;
  readonly base: number;
  readonly changes: ChangeList;
  /** The history's commit whose files are the answer, for an edit that makes a tree: `base` itself when nothing changes. */
  readonly node: number | undefined;
  /** A limit on a file's size under which the same edit fails `FileTooLarge` first, for an edit made to show that order. */
  readonly tight: number | undefined;
}

export interface TreeEditCarrier {
  readonly history: History;
  readonly cases: ReadonlyArray<TreeEditCase>;
  /** The first commit of each kind of base: the mixed tree, the tree with a link, the empty tree, one file, one file in a folder. */
  readonly bases: {
    readonly mixed: number;
    readonly link: number;
    readonly empty: number;
    readonly one: number;
    readonly deep: number;
  };
}

/**
 * Edits over five trees: one with every sort trap, a deep file, an executable, a link, an empty file and names on the object
 * prototype; one with a link; the empty tree; one file; one file in a folder. Each edit is made in every run from the run's
 * drawn value, and for each that makes a tree the history holds a commit with exactly the model's files, so its tree id is the
 * answer. Edits drawn at random join the ones made for a class, and some are made again on an edited tree.
 */
export const treeEditCarrier = (texture: Texture): TreeEditCarrier => {
  const draw = new Draw(texture);
  const word = draw.word();
  const author = draw.signature(draw.int(4_000_000_000));
  const committer = draw.signature(0);
  const [p, q, r] = [at(texture.parts, 0), at(texture.parts, 1), at(texture.parts, 2)];
  const top = `s${p}`;

  // A file's bytes: a drawn blob and a mark no `fresh` content has, so a replaced file always changes.
  const held = (k: number): Uint8Array => Uint8Array.from([...at(texture.blobs, k), 0xb0, k]);
  const fresh = (k: number): Uint8Array => Uint8Array.from([...at(texture.blobs, k), 0xf0, k]);

  const mixed: ReadonlyArray<FileSpec> = [
    file(`${top}/c`, held(0)),
    file(`${top}-b`, held(1)),
    file(`${top}.b`, held(2)),
    file(`${top}0`, held(3)),
    file(`d1${p}/d2${q}/d3${r}/z`, held(4)),
    file(`x${p}`, held(5), "100755"),
    file(`e${p}`, new Uint8Array()),
    file(`m${p}/one`, held(6)),
    file(`m${p}/two`, held(7)),
    file(`ex${p}/run`, held(0), "100755"),
    file(`ex${p}/go`, held(1), "100755"),
    file("__proto__", held(2)),
    file(`constructor/${p}`, held(3)),
  ];

  const linked: ReadonlyArray<FileSpec> = [
    textFile(`k${p}`, `t${q}`, "120000"),
    file(`t${q}`, held(4)),
    file(`ld${p}/inner`, held(5)),
  ];

  const lone: ReadonlyArray<FileSpec> = [file(`o${p}`, held(6))];
  const deep: ReadonlyArray<FileSpec> = [file(`f${q}/only${p}`, held(7))];
  const starts: ReadonlyArray<ReadonlyArray<FileSpec>> = [mixed, linked, [], lone, deep];
  const index = { mixed: 0, link: 1, empty: 2, one: 3, deep: 4 } as const;

  const nodes: Array<Node> = [];

  const addNode = (parents: ReadonlyArray<number>, files: ReadonlyArray<FileSpec>): number => {
    nodes.push({
      parents,
      author,
      committer: { ...committer, seconds: BASE_SECONDS + nodes.length },
      message: word,
      files,
    });

    return nodes.length - 1;
  };

  for (const files of starts) {
    addNode(nodes.length === 0 ? [] : [nodes.length - 1], files);
  }

  const cases: Array<TreeEditCase> = [];
  const GENEROUS = Number.MAX_SAFE_INTEGER;

  const make = (
    label: string,
    classes: ReadonlyArray<string>,
    base: number,
    changes: ChangeList,
    tight?: number,
  ): number | undefined => {
    const files = nodes[base]?.files ?? [];
    const model = editModel(files, changes, GENEROUS);
    let node: number | undefined;
    let intent: EditIntent;

    if (model.kind === "files") {
      const same = nodes.findIndex((each) => sameFiles(each.files, model.files));
      const unchanged = sameFiles(files, model.files);
      intent = unchanged ? "no change" : "tree";
      node = unchanged ? base : same === -1 ? addNode([base], model.files) : same;
    } else {
      intent = model.kind === "in-the-way" ? "in-the-way" : "not-a-file";
    }

    cases.push({ label, classes, intent, base, changes, node, tight });

    return node;
  };

  const [mix, link, empty, one, deepBase] = [index.mixed, index.link, index.empty, index.one, index.deep];
  const [a, b, c, d] = [fresh(0), fresh(1), fresh(2), fresh(3)];
  const copy = (name: string): Uint8Array => Uint8Array.from(mixed.find((each) => each.path === name)?.content ?? []);

  // (k) edits that change.
  make("one file replaced", ["(k) one file replaced"], mix, [[`${top}-b`, a]]);
  make("a top file replaced", ["(k) one file replaced"], mix, [[`e${p}`, b]]);

  make("several files in several folders", ["(k) several files in several folders in one call"], mix, [
    [`m${p}/one`, a],
    [`e${p}`, b],
    [`d1${p}/d2${q}/d3${r}/z`, c],
    [`${top}/c`, d],
  ]);

  make("a new file three folders deep", ["(k) a new file in a new folder three deep"], mix, [
    [`n1${p}/n2${q}/n3${r}/new`, a],
  ]);

  make("a new file in a folder that exists", ["(k) a new file in a new folder three deep"], mix, [
    [`m${p}/n1${q}/n2${r}/new`, a],
    [`m${p}/three`, b],
  ]);

  make("a file removed in a folder", ["(k) a file removed"], mix, [[`m${p}/one`, "absent"]]);
  make("a top file removed", ["(k) a file removed"], mix, [[`e${p}`, "absent"]]);
  make("an executable file removed", ["(k) a file removed"], mix, [[`x${p}`, "absent"]]);

  make("every file of a folder removed", ["(k) the last files of a folder removed, so the folder goes"], mix, [
    [`m${p}/two`, "absent"],
    [`m${p}/one`, "absent"],
  ]);

  make(
    "the one file of three nested folders removed",
    ["(k) the last file of three nested folders removed, so all three go"],
    mix,
    [[`d1${p}/d2${q}/d3${r}/z`, "absent"]],
  );

  make("the one file removed", ["(k) every file removed, the empty tree"], one, [[`o${p}`, "absent"]]);
  make("the one file of a folder removed", ["(k) every file removed, the empty tree"], deepBase, [
    [`f${q}/only${p}`, "absent"],
  ]);

  make(
    "every file of the mixed tree removed",
    ["(k) every file removed, the empty tree"],
    mix,
    mixed.map((each) => [each.path, "absent"] as const).toReversed(),
  );

  const made = make("a file made a folder", ["(k) a file made a folder"], mix, [
    [`e${p}/inner`, a],
    [`e${p}`, "absent"],
  ]);

  if (made !== undefined) {
    const gone = make("the folder emptied", ["(k) a folder emptied, then a file at its path"], made, [
      [`e${p}/inner`, "absent"],
    ]);

    if (gone !== undefined) {
      make("a file where the folder was", ["(k) a folder emptied, then a file at its path"], gone, [[`e${p}`, b]]);
    }
  }

  make("a file added to the empty tree", ["(k) a file added to the empty tree"], empty, [[`a${p}`, a]]);
  make("files added to the empty tree, deep", ["(k) a file added to the empty tree"], empty, [
    [`a${p}/b${q}/c${r}`, b],
    [`z${p}`, c],
  ]);

  make(
    "a name that starts others and names others start",
    ["(k) a name that starts others and a name that others start"],
    mix,
    [
      ["s", a],
      [`${top}-b0`, b],
      [`${top}.bx`, c],
      [`${top}00`, d],
      [`${top}/c0`, a],
    ],
  );

  // (l) edits that change nothing.
  make("an empty edit", ["(l) an empty edit"], mix, []);
  make("a file replaced with its own bytes", ["(l) a file replaced with its own bytes"], mix, [
    [`${top}-b`, copy(`${top}-b`)],
  ]);
  make("an empty file replaced with its own bytes", ["(l) a file replaced with its own bytes"], mix, [
    [`e${p}`, new Uint8Array()],
  ]);
  make("an executable file replaced with its own bytes", ["(l) an executable file replaced with its own bytes"], mix, [
    [`x${p}`, copy(`x${p}`)],
    [`ex${p}/go`, copy(`ex${p}/go`)],
  ]);
  make("absent on a path that holds nothing", ["(l) absent on a path that holds nothing"], mix, [
    [`nothing${p}`, "absent"],
  ]);
  make("absent below a file", ["(l) absent below a file"], mix, [[`e${p}/z`, "absent"]]);
  make("absent in a folder that does not exist", ["(l) absent in a folder that does not exist"], mix, [
    [`nof${p}/a/b`, "absent"],
  ]);
  make("several that change nothing", ["(l) a file replaced with its own bytes"], mix, [
    [`nothing${p}`, "absent"],
    [`m${p}/two`, copy(`m${p}/two`)],
    [`nof${p}/a`, "absent"],
  ]);
  make("an empty edit on the empty tree", ["(l) an edit on the empty tree that changes nothing"], empty, []);
  make("absent on the empty tree", ["(l) an edit on the empty tree that changes nothing"], empty, [
    [`x${p}/y`, "absent"],
  ]);

  // (m) modes.
  make("an executable file replaced", ["(m) an executable file replaced stays 100755"], mix, [
    [`x${p}`, a],
    [`ex${p}/go`, b],
  ]);
  make("new files beside an executable one", ["(m) a new file is 100644 beside an executable one"], mix, [
    [`a${p}`, a],
    [`z${p}`, b],
    [`xn${p}`, c],
  ]);
  make("a new file among executable files", ["(m) a new file is 100644 in a folder of executable files"], mix, [
    [`ex${p}/a`, a],
    [`ex${p}/n`, b],
    [`ex${p}/z`, c],
  ]);

  // (n) refused.
  make("a folder replaced by a file", ["(n) a changed path that is a folder"], mix, [[`m${p}`, a]]);
  make("a deep folder replaced by a file", ["(n) a changed path that is a folder"], mix, [[`d1${p}/d2${q}`, a]]);
  make("a folder made absent", ["(n) absent at a folder"], mix, [[`m${p}`, "absent"]]);
  make("a folder emptied and given a file", ["(n) a folder's files removed and a file added at its path"], mix, [
    [`m${p}/one`, "absent"],
    [`m${p}/two`, "absent"],
    [`m${p}`, a],
  ]);
  make("a link replaced", ["(n) a link replaced"], link, [[`k${p}`, a]]);
  make("a link removed", ["(n) a link removed"], link, [[`k${p}`, "absent"]]);
  make("a link beside a change that works", ["(n) a link removed"], link, [
    [`ld${p}/inner`, a],
    [`k${p}`, "absent"],
  ]);
  make("a file below a link", ["(n) a change below a link"], link, [[`k${p}/z`, a]]);
  make("a file deep below a link", ["(n) a change below a link"], link, [[`k${p}/z/y`, a]]);
  make("absent below a link", ["(n) absent below a link"], link, [[`k${p}/z`, "absent"]]);
  make("a file below a file the edit keeps", ["(n) a new file below a file the edit keeps"], mix, [[`x${p}/below`, a]]);
  make("a file deep below a file the edit keeps", ["(n) a new file below a file the edit keeps"], mix, [
    [`x${p}/a/b`, a],
  ]);
  make("a file below a file the edit replaces", ["(n) a new file below a file the edit keeps"], mix, [
    [`x${p}`, a],
    [`x${p}/below`, b],
  ]);
  make("two new files, one below the other", ["(n) two new files, one below the other"], mix, [
    [`nw${p}/below`, b],
    [`nw${p}`, a],
  ]);

  // (p) the order of the checks.
  const big = Uint8Array.from({ length: 64 }, (_, i) => (i * 5 + 3) & 255);
  make(
    "a large file at a folder's path",
    ["(p) content too large at a folder's path"],
    mix,
    [[`m${p}`, big]],
    big.length - 1,
  );
  make("a folder changed beside a file in the way", ["(p) a change at a folder beside a new file in the way"], mix, [
    [`x${p}/below`, a],
    [`m${p}`, b],
  ]);
  make("two folders changed", ["(p) two folders changed"], mix, [
    [`${top}`, a],
    [`m${p}`, b],
  ]);
  make("two new files in the way", ["(p) two new files in the way"], mix, [
    [`x${p}/b2`, a],
    [`e${p}/a1`, b],
  ]);

  // (q) the sort traps and the object prototype among the changed names of one folder.
  make("every sort trap replaced", ["(q) the sort traps among the changed names of one folder"], mix, [
    [`${top}0`, a],
    [`${top}.b`, b],
    [`${top}/c`, c],
    [`${top}-b`, d],
  ]);
  make("sort traps added and removed", ["(q) the sort traps added and removed in one folder"], mix, [
    [`${top}-bb`, a],
    [`${top}.bb`, b],
    [`${top}0b`, c],
    [`${top}/c2`, d],
    [`${top}.b`, "absent"],
    [`${top}/c`, "absent"],
  ]);
  make("names on the object prototype", ["(q) names on the object prototype"], mix, [
    ["__proto__", a],
    [`constructor/${p}`, b],
    ["toString", c],
    [`hasOwnProperty/${p}`, d],
  ]);
  make("a name on the object prototype removed", ["(q) names on the object prototype"], mix, [["__proto__", "absent"]]);

  // Edits drawn at random over the five trees, then over trees an edit made.
  const randomEdit = (files: ReadonlyArray<FileSpec>, tag: string): ChangeList => {
    const plain = files.filter((each) => each.mode !== "120000");
    const used = new Set<string>();
    const out: Array<readonly [string, PathChange]> = [];

    const add = (path: string, change: PathChange): void => {
      if (!used.has(path) && Schema.is(Path)(path)) {
        used.add(path);
        out.push([path, change]);
      }
    };

    for (let n = 0, count = 1 + draw.int(4); n < count; n++) {
      const kind = draw.int(8);
      const target = plain.length === 0 ? undefined : at(plain, draw.int(plain.length));
      const name = `${tag}${n}${draw.part()}`;
      const content = Uint8Array.from([...draw.blob(), 0xf0, n]);
      const folder = target === undefined ? "" : target.path.split("/").slice(0, -1).join("/");
      const inFolder = (leaf: string): string => (folder === "" ? leaf : `${folder}/${leaf}`);

      if (target === undefined || kind === 2) {
        add(name, content);
      } else if (kind === 0) {
        add(target.path, content);
      } else if (kind === 1) {
        add(target.path, "absent");
      } else if (kind === 3) {
        add(inFolder(name), content);
      } else if (kind === 4) {
        add(`${target.path}/${name}`, content);
      } else if (kind === 5) {
        add(`${target.path}x`, content);
      } else if (kind === 6) {
        add(Array.from(target.path).slice(0, -1).join(""), content);
      } else {
        add(draw.int(2) === 0 ? name : folder === "" ? target.path : folder, "absent");
      }
    }

    return out;
  };

  for (const [k, start] of [mix, mix, mix, mix, mix, mix, link, empty, one, deepBase].entries()) {
    make(`a random edit, ${k}`, ["(k) a random edit"], start, randomEdit(nodes[start]?.files ?? [], `r${k}`));
  }

  const edited = cases.flatMap((each) =>
    each.intent === "tree" && each.node !== undefined && each.node >= starts.length ? [each.node] : [],
  );

  for (const [k, start] of [...new Set(edited)].slice(0, 4).entries()) {
    make(
      `a random edit on an edited tree, ${k}`,
      ["(k) a random edit on an edited tree"],
      start,
      randomEdit(nodes[start]?.files ?? [], `t${k}`),
    );
  }

  return { history: { nodes, refs: refsFor(draw, nodes.length), shallow: [] }, cases, bases: index };
};

/** The classes of `TREE_EDIT_CLASSES` that the cases of a carrier reach, in the list's order. */
export const reachedTreeEditClasses = (carrier: TreeEditCarrier): ReadonlyArray<string> => {
  const reached = new Set(carrier.cases.flatMap((each) => each.classes));

  return TREE_EDIT_CLASSES.filter((label) => reached.has(label));
};

/** Whether a carrier reaches every class of `TREE_EDIT_CLASSES`. */
export const everyTreeEditClassNames = (carrier: TreeEditCarrier): boolean =>
  reachedTreeEditClasses(carrier).length === TREE_EDIT_CLASSES.length;

/** The same history with a canary in every message, name and email, so a span that leaks one is seen. */
export const CANARY = "canary-7f3a9c";

/** With `canaryFiles`, every commit's files are replaced by one whose path and line carry the canary (a merge's files stay, since its model reads them). */
export const withCanary = (history: History, canaryFiles = false): History => ({
  ...history,
  nodes: history.nodes.map((node, i) => ({
    ...node,
    // A path and a line of every commit carry the canary, so a call that puts either in a span is seen. Every commit holds
    // other files, so two different commits always differ in a changed file.
    files: canaryFiles ? [textFile(`${CANARY}-path-${i}`, `${CANARY}-line-${i}\n`)] : node.files,
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

/** One line of a diff as the model names it: removed from the old file or added to the new one, where it sits, and its own bytes as text. */
export interface LineEdit {
  readonly kind: "Removed" | "Added";
  readonly at: number;
  readonly text: string;
}

/**
 * The lines removed and added from one smallest diff, each block with its removed lines first, each with where it sits counting
 * from 1: in the old file for a removed line, in the new file for an added one. A file the generator draws has one smallest diff,
 * so any smallest diff is the one git prints.
 */
const lineEdits = (before: ReadonlyArray<string>, after: ReadonlyArray<string>): ReadonlyArray<LineEdit> => {
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

  const edits: Array<LineEdit> = [];
  let i = 0;
  let j = 0;

  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      i += 1;
      j += 1;
    } else if (j >= m || (i < n && longest(i + 1, j) >= longest(i, j + 1))) {
      edits.push({ kind: "Removed", at: i + 1, text: before[i] ?? "" });
      i += 1;
    } else {
      edits.push({ kind: "Added", at: j + 1, text: after[j] ?? "" });
      j += 1;
    }
  }

  return edits;
};

const lineChanges = (before: ReadonlyArray<string>, after: ReadonlyArray<string>): ReadonlyArray<string> =>
  lineEdits(before, after).map((edit) => `${edit.kind === "Removed" ? "-" : "+"}${edit.text}`);

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

/** The id git gives a blob: the sha-1 of `blob <size>`, a NUL byte and its bytes. */
export const blobId = (content: Uint8Array): string =>
  createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** A line as bytes of text (one character for each byte) read as UTF-8, or `undefined` when its bytes are not UTF-8. */
const decodedLine = (line: string): string | undefined => {
  const decoded = Result.try(() => strictUtf8.decode(Uint8Array.from(line, (character) => character.charCodeAt(0))));

  return Result.isSuccess(decoded) ? decoded.success : undefined;
};

const ModelEntry = Schema.Struct({ mode: Schema.String, blob: Schema.String });

const RemovedLine = Schema.TaggedStruct("Removed", { at: Schema.Int, text: Schema.String });

const AddedLine = Schema.TaggedStruct("Added", { at: Schema.Int, text: Schema.String });

const TextContent = Schema.TaggedStruct("Text", { lines: Schema.Array(Schema.Union([RemovedLine, AddedLine])) });

const BinaryContent = Schema.TaggedStruct("Binary", {});

const ModelContentSchema = Schema.Union([TextContent, BinaryContent]);

const NewFile = Schema.TaggedStruct("New", { path: Schema.String, after: ModelEntry, content: ModelContentSchema });

const DeletedFile = Schema.TaggedStruct("Deleted", {
  path: Schema.String,
  before: ModelEntry,
  content: ModelContentSchema,
});

const ModifiedFile = Schema.TaggedStruct("Modified", {
  path: Schema.String,
  before: ModelEntry,
  after: ModelEntry,
  content: ModelContentSchema,
});

/**
 * The model's diff, as plain data in the form `Diff.FileChange` encodes to. The laws build every expected value with these, so no
 * tag is written by hand, and compare an adapter's encoded answer with them.
 */
export const ModelDiff = {
  Removed: RemovedLine,
  Added: AddedLine,
  Text: TextContent,
  Binary: BinaryContent,
  Content: ModelContentSchema,
  New: NewFile,
  Deleted: DeletedFile,
  Modified: ModifiedFile,
  File: Schema.Union([NewFile, DeletedFile, ModifiedFile]),
} as const;

export type ModelContent = typeof ModelDiff.Content.Type;

export type ModelFile = typeof ModelDiff.File.Type;

/** What `diff` must answer: the files, or the first file in path byte order whose lines are not UTF-8. */
export type DiffModel =
  | { readonly kind: "files"; readonly files: ReadonlyArray<ModelFile> }
  | { readonly kind: "not-utf8"; readonly path: string };

const modelEntry = (spec: FileSpec) => ({ mode: spec.mode, blob: blobId(spec.content) });

// The content of one changed file, or undefined when a line of it is not UTF-8. Bytes that did not change (a mode-only change)
// hold no line, binary or not, as git prints no line for them; a file that changes kind (a link made a file) removes every old
// line and adds every new one.
const modelContent = (from: FileSpec | undefined, to: FileSpec | undefined): ModelContent | undefined => {
  const kind = from !== undefined && to !== undefined && isLink(from.mode) !== isLink(to.mode);

  if (!kind && from !== undefined && to !== undefined && sameBytes(from.content, to.content)) {
    return ModelDiff.Text.make({ lines: [] });
  }

  if (hasNul(from?.content ?? NO_BYTES) || hasNul(to?.content ?? NO_BYTES)) {
    return ModelDiff.Binary.make({});
  }

  const old = splitLines(from?.content ?? NO_BYTES);
  const next = splitLines(to?.content ?? NO_BYTES);

  const edits: ReadonlyArray<LineEdit> = kind
    ? [
        ...old.map((text, i): LineEdit => ({ kind: "Removed", at: i + 1, text })),
        ...next.map((text, i): LineEdit => ({ kind: "Added", at: i + 1, text })),
      ]
    : lineEdits(old, next);

  const lines: Array<typeof RemovedLine.Type | typeof AddedLine.Type> = [];

  for (const edit of edits) {
    const text = decodedLine(edit.text);

    if (text === undefined) {
      return undefined;
    }

    lines.push(
      edit.kind === "Removed"
        ? ModelDiff.Removed.make({ at: edit.at, text })
        : ModelDiff.Added.make({ at: edit.at, text }),
    );
  }

  return ModelDiff.Text.make({ lines });
};

const modelFile = (
  path: string,
  from: FileSpec | undefined,
  to: FileSpec | undefined,
  content: ModelContent,
): ModelFile | undefined => {
  if (from === undefined) {
    return to === undefined ? undefined : ModelDiff.New.make({ path, after: modelEntry(to), content });
  }

  return to === undefined
    ? ModelDiff.Deleted.make({ path, before: modelEntry(from), content })
    : ModelDiff.Modified.make({ path, before: modelEntry(from), after: modelEntry(to), content });
};

/**
 * What `diff` must answer for two sets of files: every file they differ in, in path byte order, with its entries on the sides it
 * has and its lines as one smallest diff gives them; `[]` for the same files. A text file that holds a line that is not UTF-8
 * fails the whole diff, naming the first such file in path order.
 */
export const diffModel = (before: ReadonlyArray<FileSpec>, after: ReadonlyArray<FileSpec>): DiffModel => {
  const files: Array<ModelFile> = [];

  for (const { path, from, to } of changedSections(before, after)) {
    const content = modelContent(from, to);

    if (content === undefined) {
      return { kind: "not-utf8", path };
    }

    const made = modelFile(path, from, to, content);

    if (made !== undefined) {
      files.push(made);
    }
  }

  return { kind: "files", files };
};

/** How many lines a model diff holds in all. */
export const diffLines = (files: ReadonlyArray<ModelFile>): number =>
  files.reduce((total, each) => total + (Predicate.isTagged(each.content, "Text") ? each.content.lines.length : 0), 0);

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
  "(a) a binary file made a link",
  "(a) a link made a binary file",
  "(b) a mode-only change",
  "(c) a NUL in the first 8000 bytes on one side",
  "(c) a NUL at byte 8000, binary",
  "(c) a NUL at byte 8001, text",
  "(d) a last line that loses its newline",
  "(d) a last line that gains its newline",
  "(d) CRLF lines",
  "(d) a change of whitespace only",
  "(e) a text file in latin-1 bytes",
  "(e) a line that starts with a BOM",
  "(f) no change",
  "(f) an empty file added",
  "(g) change blocks at the first line and at the last",
  "(g) lines only inserted and lines only removed",
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

  // The other way round, a file that is binary only before, and a binary file whose bytes are not UTF-8.
  made("binary becomes text", ["(c) a NUL in the first 8000 bytes on one side"], turned("q\n"), turns("q\n"));
  made(
    "a binary file whose bytes are not UTF-8",
    ["(c) a NUL in the first 8000 bytes on one side"],
    [file(`m${p}`, joined("a", [0xe9, 0], "b"))],
    [file(`m${p}`, joined("a", [0xe9, 0], "c"))],
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

  // A binary file made a link and a link made a binary file: git prints one binary section and one text section, and the diff is
  // `Binary` whichever comes first.
  made(
    "a binary file made a link",
    ["(a) a binary file made a link"],
    [file(src, joined("a", [0], "b"))],
    [text(src, [`t${q}`], "120000")],
  );
  made(
    "a link made a binary file",
    ["(a) a link made a binary file"],
    [text(src, [`t${q}`], "120000")],
    [file(src, joined("a", [0], "b"))],
  );

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

  const modeOnlyBinary = made("a mode-only change of a binary file", ["(b) a mode-only change"], binary(bin, 0x62), [
    file(bin, joined("a", [0], "b"), "100755"),
  ]);

  // The same mode change of another binary file at the same path: no byte of either is in the change, so the two are one edit.
  const modeOnlyOther = made(
    "a mode-only change of another binary file at the same path",
    ["(b) a mode-only change"],
    [file(bin, joined("c", [0], "d"))],
    [file(bin, joined("c", [0], "d"), "100755")],
  );

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

  // A line that starts with a BOM keeps it: the diff holds the line as it is, and a reader that drops a leading BOM reads another line.
  const bom = (lines: ReadonlyArray<string>) => lines.map((line, i) => (i === 0 ? `\uFEFF${line}` : line));
  made(
    "a line that starts with a BOM",
    ["(e) a line that starts with a BOM"],
    [text(src, bom(base))],
    [text(src, bom(replaceAt(base, 0, `${p}:new0\n`)))],
  );

  // Two such files, whose paths sort one way by bytes and the other by UTF-16 units: the diff names the first by bytes.
  const gone = [`\uE000${p}`, `\u{1F600}${p}`];

  made(
    "two latin-1 files, named by bytes",
    ["(e) a text file in latin-1 bytes", "(k) characters past U+024F, from U+E000 to U+FFFF, and __proto__"],
    gone.map((path) => file(path, latin(base))),
    gone.map((path) => file(path, latin(drawn))),
  );

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

  // Blocks with nothing on one side: lines only inserted, only removed, and inserted before the first line.
  made(
    "two lines inserted in the middle",
    ["(g) lines only inserted and lines only removed"],
    [text(src, base)],
    [text(src, [...base.slice(0, 2), `${p}:ins0\n`, `${p}:ins1\n`, ...base.slice(2)])],
  );
  made(
    "two lines removed from the middle",
    ["(g) lines only inserted and lines only removed"],
    [text(src, base)],
    [text(src, [...base.slice(0, 1), ...base.slice(3)])],
  );
  made(
    "two lines inserted above a line changed",
    ["(g) lines only inserted and lines only removed"],
    [text(src, base)],
    [text(src, [...base.slice(0, 1), `${p}:ins0\n`, `${p}:ins1\n`, ...replaceAt(base, 3, `${p}:new3\n`).slice(1)])],
  );
  made(
    "a line inserted before the first",
    ["(g) lines only inserted and lines only removed"],
    [text(src, base)],
    [text(src, [`${p}:top\n`, ...base])],
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
    same: [same, [binaryEdit, sameBinary], text8001, [modeOnlyBinary, modeOnlyOther]].map((group) =>
      group.map((each) => cases.indexOf(each)),
    ),
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

/** The classes of `rangePatchId`: the drawn ranges, then the shapes of history and the shallow cut the law adds. */
export const RANGE_PATCH_CLASSES = [
  "(o) the branch before the upstream moved",
  "(o) the branch rebased onto the upstream",
  "(o) the upstream merged into the branch",
  "(o) the branch's own commits, two of them",
  "(r) the tip is its merge base",
  "(r) the tip is the upstream",
  "(p) no common history",
  "(p) a criss-cross with two merge bases",
  "(q) a shallow repository",
] as const;

/** One range of the carrier below: what it is measured against, its tip, and the one merge base the model names. */
export interface RangeCase {
  readonly label: string;
  readonly classes: ReadonlyArray<string>;
  readonly upstream: number;
  readonly commit: number;
  /** The one merge base of the two, by index. */
  readonly base: number;
  /** The model's key of the change from the base to the tip: equal keys are one edit; `undefined` is no change. */
  readonly key: string | undefined;
}

export interface RangeCarrier {
  readonly history: History;
  readonly cases: ReadonlyArray<RangeCase>;
}

/**
 * A main that moves on (`M0`, then `M1` with another file changed) and one edit of a source file made in other ways: on `M0`
 * (`B1`), rebased onto `M1` (`B2`), made on `M0` and `M1` merged into it (`B3`), and made in two commits (`B4`, `B5`), beside a
 * different edit (`B6`). Every range holds the one edit or none, from its merge base.
 */
export const rangeCarrier = (texture: Texture): RangeCarrier => {
  const p = at(texture.parts, 0);
  const q = at(texture.parts, 1);
  const r = at(texture.parts, 2);
  const src = `s${p}/f${q}`;
  const base = numbered(p, 5);
  const readme = (version: string): FileSpec => textFile(`n${q}`, `${r}:${version}\n`);
  const source = (lines: ReadonlyArray<string>): FileSpec => textFile(src, lines.join(""));
  const drawn = replaceAt(base, 2, `${p}:new2\n`);
  const seed = at(texture.signatures, 0);
  const nodes: Array<Node> = [];

  const commit = (parents: ReadonlyArray<number>, files: ReadonlyArray<FileSpec>): number => {
    const i = nodes.length;

    nodes.push({
      parents,
      author: { ...seed, seconds: BASE_SECONDS + i, offset: "+0000" },
      committer: { ...seed, seconds: BASE_SECONDS + i, offset: "+0000" },
      message: `range ${i}`,
      files,
    });

    return i;
  };

  const m0 = commit([], [readme("one"), source(base)]);
  const m1 = commit([m0], [readme("two"), source(base)]);
  const b1 = commit([m0], [readme("one"), source(drawn)]);
  const b2 = commit([m1], [readme("two"), source(drawn)]);
  const b3 = commit([b1, m1], [readme("two"), source(drawn)]);
  const b4 = commit([m0], [readme("one"), source(replaceAt(base, 2, `${p}:tmp2\n`))]);
  const b5 = commit([b4], [readme("one"), source(drawn)]);
  const b6 = commit([m0], [readme("one"), source(replaceAt(base, 2, `${p}:other2\n`))]);

  const cases: ReadonlyArray<Omit<RangeCase, "key">> = [
    { label: "the branch on its own base", classes: [], upstream: m0, commit: b1, base: m0 },
    {
      label: "the branch before main moved",
      classes: ["(o) the branch before the upstream moved"],
      upstream: m1,
      commit: b1,
      base: m0,
    },
    {
      label: "the branch rebased onto the new main",
      classes: ["(o) the branch rebased onto the upstream"],
      upstream: m1,
      commit: b2,
      base: m1,
    },
    {
      label: "the new main merged into the branch",
      classes: ["(o) the upstream merged into the branch"],
      upstream: m1,
      commit: b3,
      base: m1,
    },
    {
      label: "two commits that make the one edit",
      classes: ["(o) the branch's own commits, two of them"],
      upstream: m1,
      commit: b5,
      base: m0,
    },
    { label: "another edit", classes: [], upstream: m1, commit: b6, base: m0 },
    {
      label: "the tip is the merge base",
      classes: ["(r) the tip is its merge base"],
      upstream: m1,
      commit: m0,
      base: m0,
    },
    { label: "the tip is the upstream", classes: ["(r) the tip is the upstream"], upstream: m1, commit: m1, base: m1 },
  ];

  return {
    history: { nodes, refs: [], shallow: [] },
    cases: cases.map((each) => ({
      ...each,
      key: changeKey(nodes[each.base]?.files ?? [], nodes[each.commit]?.files ?? []),
    })),
  };
};

// ---------------------------------------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------------------------------------
// Merging three commits' trees
// ---------------------------------------------------------------------------------------------------------

/** Whether two files are the same entry of a tree: the same mode and the same bytes, or both absent. */
const sameFile = (a: FileSpec | undefined, b: FileSpec | undefined): boolean =>
  a === undefined || b === undefined
    ? a === b
    : a.mode === b.mode &&
      a.content.length === b.content.length &&
      a.content.every((octet, i) => octet === b.content[i]);

/** What a path holds after a merge, by what the merge base, ours and theirs hold there: one of the two sides, or neither. */
const settle = (
  base: FileSpec | undefined,
  ours: FileSpec | undefined,
  theirs: FileSpec | undefined,
): FileSpec | undefined | "conflict" => {
  if (sameFile(ours, theirs) || sameFile(theirs, base)) {
    return ours;
  }

  return sameFile(ours, base) ? theirs : "conflict";
};

/** What a merge of three trees answers: the files of the merged tree, or the paths that could not be combined. */
export type MergeAnswer =
  | { readonly kind: "clean"; readonly files: ReadonlyArray<FileSpec> }
  | { readonly kind: "conflict"; readonly paths: ReadonlyArray<string> };

/**
 * The model of a merge, whole file by whole file: for each path, the entries (mode and bytes) of the merge base, ours and
 * theirs. If ours and theirs are the same, that is the answer; if ours is the base's, theirs is; if theirs is the base's,
 * ours is; else the path conflicts. A merged tree where one path is a folder of another conflicts on both paths.
 */
export const mergeModel = (
  base: ReadonlyArray<FileSpec>,
  ours: ReadonlyArray<FileSpec>,
  theirs: ReadonlyArray<FileSpec>,
): MergeAnswer => {
  const held = (files: ReadonlyArray<FileSpec>): ReadonlyMap<string, FileSpec> =>
    new Map(files.map((each) => [each.path, each]));

  const [b, o, t] = [held(base), held(ours), held(theirs)];
  const merged = new Map<string, FileSpec>();
  const conflicts = new Set<string>();

  for (const path of new Set([...b.keys(), ...o.keys(), ...t.keys()])) {
    const kept = settle(b.get(path), o.get(path), t.get(path));

    if (kept === "conflict") {
      conflicts.add(path);
    } else if (kept !== undefined) {
      merged.set(path, kept);
    }
  }

  for (const path of merged.keys()) {
    const names = path.split("/");

    for (let depth = 1; depth < names.length; depth++) {
      const folder = names.slice(0, depth).join("/");

      if (merged.has(folder)) {
        conflicts.add(folder);
        conflicts.add(path);
      }
    }
  }

  return conflicts.size > 0
    ? { kind: "conflict", paths: [...conflicts].sort(byBytes) }
    : { kind: "clean", files: [...merged.values()] };
};

/** The merges that git and `/memory` both answer alike, then the conflicts they both see. Each class is reached in every run. */
export const MERGE_CLASSES = [
  "only ours changes a path",
  "only theirs changes a path",
  "both make the same change",
  "ours deletes a path theirs leaves",
  "theirs deletes a path ours leaves",
  "theirs adds a file two folders deep",
  "both delete one path",
  "ours is the merge base",
  "every file deleted",
  "binary content changed on one side",
  "a mode made executable on one side",
  "a link's target changed on one side",
  "names on the object prototype",
  "both change a one-line file to different lines",
  "ours deletes what theirs changes",
  "theirs deletes what ours changes",
  "both add one path with different one-line contents",
  "conflicts at names with a space, a line break, a leading quote and characters past U+024F",
] as const;

/** The classes of `MERGE_CLASSES` whose answer is a conflict: the last five. */
export const CONFLICT_MERGE_CLASSES: ReadonlyArray<string> = MERGE_CLASSES.slice(13);

/** The merges only `/memory` answers, since git renames a file that stands where a folder is wanted. */
export const FOLDER_MERGE_CLASSES = [
  "ours adds a file, theirs adds a file in a folder of its name",
  "ours adds a file in a folder, theirs adds a file of the folder's name",
  "a file against a file two folders below it",
  "a file in a folder against a file below it",
] as const;

/** One merge in a history: three commits by index, and what the merge of their trees must answer. */
export interface MergeCase {
  readonly label: string;
  readonly base: number;
  readonly ours: number;
  readonly theirs: number;
  /** The commit whose tree the merge must give, when it is clean. */
  readonly tree: number | undefined;
  readonly expected: MergeAnswer;
}

/** A history that holds many merges at once, each between commits of its own, and the other facts the merge laws read. */
export interface MergeCarrier {
  readonly history: History;
  readonly cases: ReadonlyArray<MergeCase>;
  /** `theirs` is a commit `ours` already reaches: the merge makes a commit all the same, with the tree of `ours`. */
  readonly inside: { readonly ours: number; readonly theirs: number };
  /** Two commits that share no history. */
  readonly unrelated: { readonly ours: number; readonly theirs: number };
  /** Two commits with two best common ancestors, `bases` by index. */
  readonly criss: { readonly ours: number; readonly theirs: number; readonly bases: readonly [number, number] };
}

interface Sides {
  readonly base: ReadonlyArray<FileSpec>;
  readonly ours: ReadonlyArray<FileSpec>;
  readonly theirs: ReadonlyArray<FileSpec>;
}

const bump = (content: Uint8Array, by: number): Uint8Array => Uint8Array.from([...content, by]);

const join = (a: Sides, b: Sides): Sides => ({
  base: [...a.base, ...b.base],
  ours: [...a.ours, ...b.ours],
  theirs: [...a.theirs, ...b.theirs],
});

/**
 * The files of one class of merge, as the three sides' files. No side both deletes a path and adds another (so git finds
 * no rename), no path changes its mode on one side and its content on the other, and no path is a folder of another.
 * Every conflict is a one-line text file, so git cannot merge it by line.
 */
const focus = (label: (typeof MERGE_CLASSES)[number], draw: Draw, tag: string): Sides => {
  const path = (letter: string): string => `${tag}${letter}${draw.part()}`;
  const [v0, other] = [draw.blob(), draw.blob()];
  const [v1, v2] = [bump(v0, 1), bump(v0, 2)];
  const word = draw.word();
  const line = (side: string): Uint8Array => utf8(`${side}:${word}\n`);
  const [x, y] = [path("x"), path("y")];

  switch (label) {
    case "only ours changes a path":
      return { base: [file(x, v0)], ours: [file(x, v1)], theirs: [file(x, v0)] };
    case "only theirs changes a path":
      return { base: [file(x, v0)], ours: [file(x, v0)], theirs: [file(x, v2)] };
    case "both make the same change":
      return {
        base: [file(x, v0), file(y, other)],
        ours: [file(x, v1), file(`${y}-new`, v2), file(y, other, "100755")],
        theirs: [file(x, v1), file(`${y}-new`, v2), file(y, other, "100755")],
      };
    case "ours deletes a path theirs leaves":
      return { base: [file(x, v0)], ours: [], theirs: [file(x, v0)] };
    case "theirs deletes a path ours leaves":
      return { base: [file(x, v0)], ours: [file(x, v0)], theirs: [] };
    case "theirs adds a file two folders deep":
      return {
        base: [file(x, v0)],
        ours: [file(x, v0)],
        theirs: [file(x, v0), file(`g${draw.part()}/h${draw.part()}/${y}`, v1)],
      };
    case "both delete one path":
      return { base: [file(x, v0), file(y, other)], ours: [file(y, other)], theirs: [file(y, other)] };
    case "ours is the merge base":
      return { base: [file(x, v0)], ours: [file(x, v0)], theirs: [file(x, v1), file(y, other)] };
    case "every file deleted": {
      const inside = file(`f${draw.part()}/${y}`, other);

      return { base: [file(x, v0), inside], ours: [], theirs: [file(x, v0), inside] };
    }

    case "binary content changed on one side": {
      const binary = Uint8Array.of(0x00, 0xff, 0xfe, 0x00, ...v0);

      return { base: [file(x, binary)], ours: [file(x, bump(binary, 0))], theirs: [file(x, binary)] };
    }

    case "a mode made executable on one side":
      return { base: [file(x, v0)], ours: [file(x, v0, "100755")], theirs: [file(x, v0)] };
    case "a link's target changed on one side":
      return {
        base: [file(x, utf8(`t${word}`), "120000")],
        ours: [file(x, utf8(`u${word}`), "120000")],
        theirs: [file(x, utf8(`t${word}`), "120000")],
      };
    case "names on the object prototype": {
      const content = (i: number): Uint8Array => bump(v0, i + 3);
      const at = (i: number, bytes: Uint8Array): FileSpec => file(PROTOTYPE_NAMES[i] ?? x, bytes);

      return {
        base: PROTOTYPE_NAMES.map((_, i) => at(i, content(i))),
        ours: PROTOTYPE_NAMES.map((_, i) => at(i, i === 0 ? bump(content(i), 1) : content(i))),
        theirs: PROTOTYPE_NAMES.map((_, i) => at(i, i === 1 ? bump(content(i), 2) : content(i))),
      };
    }

    case "both change a one-line file to different lines":
      return { base: [file(x, line("b"))], ours: [file(x, line("o"))], theirs: [file(x, line("t"))] };
    case "ours deletes what theirs changes":
      return { base: [file(x, line("b"))], ours: [], theirs: [file(x, line("t"))] };
    case "theirs deletes what ours changes":
      return { base: [file(x, line("b"))], ours: [file(x, line("o"))], theirs: [] };
    case "both add one path with different one-line contents":
      return { base: [], ours: [file(x, line("o"))], theirs: [file(x, line("t"))] };
    case "conflicts at names with a space, a line break, a leading quote and characters past U+024F": {
      const names = ["a b", "l\nb", '"q', "ｚ", "\u{1F600}", "设", "-d"].map((name) => `${name}${draw.part()}`);

      return {
        base: names.map((name) => file(name, line("b"))),
        ours: names.map((name) => file(name, line("o"))),
        theirs: names.map((name) => file(name, line("t"))),
      };
    }
  }
};

/** Three paths beside the one in focus: one nobody changes, one only ours changes and one only theirs changes. */
const beside = (draw: Draw, tag: string): Sides => {
  const [kept, byOurs, byTheirs] = [draw.blob(), draw.blob(), draw.blob()];
  const [first, second, folder, third] = [draw.part(), draw.part(), draw.part(), draw.part()];
  const [k, o, t] = [`${tag}k${first}`, `${tag}o${second}`, `d${tag}${folder}/${tag}t${third}`];

  return {
    base: [file(k, kept), file(o, byOurs), file(t, byTheirs)],
    ours: [file(k, kept), file(o, bump(byOurs, 1)), file(t, byTheirs)],
    theirs: [file(k, kept), file(o, byOurs), file(t, bump(byTheirs, 2))],
  };
};

const folderSides = (label: (typeof FOLDER_MERGE_CLASSES)[number], draw: Draw): Sides => {
  const [a, b, c] = [draw.part(), draw.part(), draw.part()];
  const [v0, v1] = [draw.blob(), draw.blob()];
  const name = `a${a}`;

  switch (label) {
    case "ours adds a file, theirs adds a file in a folder of its name":
      return { base: [], ours: [file(name, v0)], theirs: [file(`${name}/${b}`, v1)] };
    case "ours adds a file in a folder, theirs adds a file of the folder's name":
      return { base: [], ours: [file(`${name}/${b}`, v1)], theirs: [file(name, v0)] };
    case "a file against a file two folders below it":
      return { base: [], ours: [file(name, v0)], theirs: [file(`${name}/${b}/${c}`, v1)] };
    case "a file in a folder against a file below it":
      return { base: [], ours: [file(`${name}/${b}`, v0)], theirs: [file(`${name}/${b}/${c}`, v1)] };
  }
};

/** A history being built one commit at a time, each with drawn authorship and message. */
const commits = (draw: Draw) => {
  const nodes: Array<Node> = [];

  const commit = (parents: ReadonlyArray<number>, files: ReadonlyArray<FileSpec>): number => {
    nodes.push({
      parents,
      author: draw.signature(draw.int(4_000_000_000)),
      committer: draw.signature(BASE_SECONDS + nodes.length * 60),
      message: draw.word(),
      files,
    });

    return nodes.length - 1;
  };

  return { nodes, commit };
};

/**
 * One history that holds a merge for each class of `MERGE_CLASSES`, each between commits of its own (a base, ours and
 * theirs, with a commit beside them for the files a clean merge must give), and the commits the helper's laws read: one
 * whose second side is already in the first, two unrelated roots and a criss-cross. `tag` goes in front of every
 * path's first part, so a law can make each path carry a canary. Without `answers` no commit holds the files a clean
 * merge must give, so the store holds no tree that a merge could find and not make.
 */
export const mergeCarrier = (texture: Texture, tag = "", answers = true): MergeCarrier => {
  const draw = new Draw(texture);
  const { nodes, commit } = commits(draw);

  const made = MERGE_CLASSES.map((label) => {
    // Nothing is beside the files of a merge that deletes every one of them: its answer is git's empty tree.
    const sides =
      label === "every file deleted" ? focus(label, draw, tag) : join(focus(label, draw, tag), beside(draw, tag));

    const base = commit([], sides.base);

    // Ours is the merge base itself: its commit is the base's, so the files it holds are the base's too.
    const isBase = label === "ours is the merge base";
    const oursFiles = isBase ? sides.base : sides.ours;
    const ours = isBase ? base : commit([base], oursFiles);
    const theirs = commit([base], sides.theirs);

    return { label, base, ours, theirs, answer: mergeModel(sides.base, oursFiles, sides.theirs) };
  });

  // A commit for the files each clean merge must give, so a law compares tree ids and never lists files.
  const cases = made.map(({ label, base, ours, theirs, answer }): MergeCase => ({
    label,
    base,
    ours,
    theirs,
    tree: answer.kind === "clean" && answers ? commit([], answer.files) : undefined,
    expected: answer,
  }));

  const kept = beside(draw, tag);
  const root = commit([], kept.base);
  const theirs = commit([root], kept.theirs);
  const ours = commit([theirs], [...kept.theirs, file(`${tag}z${draw.part()}`, draw.blob())]);

  const crissFiles = (i: number): ReadonlyArray<FileSpec> => [textFile(`${tag}c${draw.part()}`, `${i}\n`)];
  const crissRoot = commit([], crissFiles(0));
  const [left, right] = [commit([crissRoot], crissFiles(1)), commit([crissRoot], crissFiles(2))];
  const [first, second] = [commit([left, right], crissFiles(3)), commit([right, left], crissFiles(4))];

  return {
    history: { nodes, refs: refsFor(draw, nodes.length), shallow: [] },
    cases,
    inside: { ours, theirs },
    unrelated: { ours: made[0]?.base ?? 0, theirs: made[1]?.base ?? 0 },
    criss: { ours: first, theirs: second, bases: [left, right] },
  };
};

/** A history with a merge for each class of `FOLDER_MERGE_CLASSES`, with the paths each conflict must name. */
export const folderCarrier = (
  texture: Texture,
): { readonly history: History; readonly cases: ReadonlyArray<MergeCase> } => {
  const draw = new Draw(texture);
  const { nodes, commit } = commits(draw);

  const cases = FOLDER_MERGE_CLASSES.map((label): MergeCase => {
    const sides = join(folderSides(label, draw), beside(draw, ""));
    const base = commit([], sides.base);

    return {
      label,
      base,
      ours: commit([base], sides.ours),
      theirs: commit([base], sides.theirs),
      tree: undefined,
      expected: mergeModel(sides.base, sides.ours, sides.theirs),
    };
  });

  return { history: { nodes, refs: [], shallow: [] }, cases };
};

// ---------------------------------------------------------------------------------------------------------
// Rebasing own commits onto a new base (ticket 1936, slice 1)
// ---------------------------------------------------------------------------------------------------------

/**
 * What a rebase must answer, by index into the history: one new commit for each own commit, each with the node whose files
 * are the model's tree, or the failure the model names.
 */
export type RebaseAnswer =
  | {
      readonly kind: "commits";
      readonly steps: ReadonlyArray<{ readonly own: number; readonly tree: number }>;
    }
  | { readonly kind: "conflict"; readonly paths: ReadonlyArray<string> }
  /** The merge commits among the own commits, in index order: the law sorts them by id. */
  | { readonly kind: "merge"; readonly commits: ReadonlyArray<number> }
  /** The root commits among the own commits, when there is no merge commit. */
  | { readonly kind: "root"; readonly commits: ReadonlyArray<number> }
  /** An own commit's message holds a NUL byte, and nothing before the check refuses. */
  | { readonly kind: "nul" };

/** The model of a rebase, with the files each new commit must hold and not yet a node. */
export type RebaseModel =
  | {
      readonly kind: "commits";
      readonly steps: ReadonlyArray<{ readonly own: number; readonly files: ReadonlyArray<FileSpec> }>;
    }
  | Exclude<RebaseAnswer, { readonly kind: "commits" }>;

/**
 * The model of `rebase({ upstream, commit, onto })`, step by step as the plan says. The own commits are those `commit` reaches
 * that neither `upstream` nor `onto` reaches. A merge commit among them, else a root, refuses; then a NUL in a message
 * refuses; else each own commit is merged over its own parent as the merge base, with the new tip's files as ours and its
 * own files as theirs, and the first merge that conflicts ends the call with its paths.
 */
export const rebaseModel = (history: History, upstream: number, commit: number, onto: number): RebaseModel => {
  const own = walkModel(history, [commit], [upstream, onto]);
  const commitAt = (i: number): Node => nodeAtIndex(history, i);
  const merges = own.filter((i) => commitAt(i).parents.length > 1);

  if (merges.length > 0) {
    return { kind: "merge", commits: merges };
  }

  const roots = own.filter((i) => commitAt(i).parents.length === 0);

  if (roots.length > 0) {
    return { kind: "root", commits: roots };
  }

  if (own.some((i) => commitAt(i).message.includes("\0"))) {
    return { kind: "nul" };
  }

  let tip = commitAt(onto).files;
  const steps: Array<{ own: number; files: ReadonlyArray<FileSpec> }> = [];

  for (const i of own) {
    const parent = commitAt(i).parents[0];
    const merged = mergeModel(parent === undefined ? [] : commitAt(parent).files, tip, commitAt(i).files);

    if (merged.kind === "conflict") {
      return { kind: "conflict", paths: merged.paths };
    }

    tip = merged.files;
    steps.push({ own: i, files: merged.files });
  }

  return { kind: "commits", steps };
};

const nodeAtIndex = (history: History, i: number): Node => {
  const node = history.nodes[i];

  if (node === undefined) {
    throw new Error(`no commit ${i}`);
  }

  return node;
};

/** One rebase of the carrier: the three commits it is asked with, by index, and what the model answers. */
export interface RebaseCase {
  readonly label: string;
  readonly upstream: number;
  readonly commit: number;
  readonly onto: number;
  readonly expected: RebaseAnswer;
}

/** A history that holds a rebase for each class of `REBASE_CLASSES`, each among commits of its own. */
export interface RebaseCarrier {
  readonly history: History;
  readonly cases: ReadonlyArray<RebaseCase>;
}

/** The classes a rebase run reaches in every run, each applied to the run's drawn value, in the order the carrier makes them. */
export const REBASE_CLASSES: ReadonlyArray<string> = [
  "(a) one commit",
  "(a) three commits",
  "(a) a file three folders deep",
  "(a) the last file of a folder deleted",
  "(a) a mode made executable",
  "(a) binary content",
  "(a) a link's target",
  "(a) names on the object prototype",
  "(a) a path onto also changed to the same bytes",
  "(a) a later commit changes what the commit before it changed",
  "(a) a commit undoes the commit before it",
  "(b) the commit is reached by the upstream",
  "(b) the commit is reached by onto only",
  "(c) a commit that starts empty",
  "(c) a commit that becomes empty",
  "(d) every message class but the NUL and every signature class, one for each commit",
  "(k) three commits that end in a character of one, three and four bytes",
  "(n) onto already reaches the first commit of the branch",
  "(e) conflicts at the first own commit, and again at the second",
  "(e) conflicts at the third, after two clean ones that the third changes again",
  ...CONFLICT_MERGE_CLASSES.map((label) => `(e) ${label}`),
  "(f) one merge commit among the own commits",
  "(f) two merge commits among the own commits",
  "(f) three merge commits among the own commits",
  "(f) a merge commit below the upstream",
  "(g) own commits that reach a root",
  "(g) a merge commit and a root together",
  "(l) a NUL in the third message, after two clean commits",
  "(l) a NUL in the second message, after a commit that conflicts",
];

/** The committer of the commits of the byte-limit branch: short, so a settings' committer is longer. */
const SHORT_COMMITTER = { name: "o", email: "o", offset: "+0000" } as const;

/**
 * One history for a rebase law, made from one drawn texture: a base, a new base (`onto`) and a branch for each class. Each case is
 * `rebaseModel` run on the history so far, and each clean step has a node of its own that holds the files the step must give, so a
 * law compares tree ids and never lists files. `tag` goes in front of every path's first part, so a law can make each path carry a
 * canary. No side of any merge both deletes a path and adds another, so git finds no rename and the model and git agree.
 */
export const rebaseCarrier = (texture: Texture, tag = ""): RebaseCarrier => {
  const draw = new Draw(texture);
  const nodes: Array<Node> = [];
  const cases: Array<RebaseCase> = [];
  const filesAt = (i: number): ReadonlyArray<FileSpec> => nodeAtIndex({ nodes, refs: [], shallow: [] }, i).files;

  const make = (
    parents: ReadonlyArray<number>,
    files: ReadonlyArray<FileSpec>,
    over: Partial<Pick<Node, "author" | "committer" | "message">> = {},
  ): number => {
    nodes.push({
      parents,
      author: over.author ?? draw.signature(draw.int(4_000_000_000)),
      committer: over.committer ?? draw.signature(BASE_SECONDS + nodes.length * 60),
      message: over.message ?? draw.word(),
      files,
    });

    return nodes.length - 1;
  };

  const add = (label: string, upstream: number, commit: number, onto: number): void => {
    const model = rebaseModel({ nodes, refs: [], shallow: [] }, upstream, commit, onto);

    const expected: RebaseAnswer =
      model.kind === "commits"
        ? { kind: "commits", steps: model.steps.map((step) => ({ own: step.own, tree: make([], step.files) })) }
        : model;

    cases.push({ label, upstream, commit, onto, expected });
  };

  // `walk` leaves out what either reaches, so the upstream is the new base or the old one, by turns.
  let turn = 0;
  const upstreamFor = (base: number, onto: number): number => (turn++ % 2 === 0 ? onto : base);

  /** A branch of one commit: its parent holds `sides.base`, the new base `sides.ours` and the commit `sides.theirs`. */
  const single = (label: string, sides: Sides): void => {
    const base = make([], sides.base);
    const onto = make([base], sides.ours);
    const commit = make([base], sides.theirs);
    add(label, upstreamFor(base, onto), commit, onto);
  };

  const flipped = (sides: Sides): Sides => ({ base: sides.base, ours: sides.theirs, theirs: sides.ours });
  const v0 = draw.blob();
  const [v1, v2] = [bump(v0, 1), bump(v0, 2)];

  // One file more than the files before it, so each own commit of a branch is a change of its own.
  const grown = (i: number, files: ReadonlyArray<FileSpec>): ReadonlyArray<FileSpec> => [
    ...files,
    file(`${tag}c${i}${draw.part()}`, draw.blob()),
  ];

  // (a) clean lines
  single("(a) one commit", join(focus("only theirs changes a path", draw, tag), beside(draw, tag)));

  {
    const around = beside(draw, tag);
    const base = make([], around.base);
    const onto = make([base], around.ours);
    const first = make([base], around.theirs);
    const second = make([first], grown(2, filesAt(first)));
    const third = make([second], grown(3, filesAt(second)));
    add("(a) three commits", upstreamFor(base, onto), third, onto);
  }

  {
    const x = `${tag}x${draw.part()}`;
    const deep = `${tag}g${draw.part()}/h${draw.part()}/i${draw.part()}/y${draw.part()}`;

    single(
      "(a) a file three folders deep",
      join({ base: [file(x, v0)], ours: [file(x, v0)], theirs: [file(x, v0), file(deep, v1)] }, beside(draw, tag)),
    );
  }

  {
    const [x, last, other] = [
      `${tag}x${draw.part()}`,
      `${tag}f${draw.part()}/y${draw.part()}`,
      `${tag}z${draw.part()}`,
    ];

    single(
      "(a) the last file of a folder deleted",
      join(
        {
          base: [file(x, v0), file(last, v1), file(other, v2)],
          ours: [file(x, bump(v0, 3)), file(last, v1), file(other, v2)],
          theirs: [file(x, v0), file(other, v2)],
        },
        beside(draw, tag),
      ),
    );
  }

  single(
    "(a) a mode made executable",
    join(flipped(focus("a mode made executable on one side", draw, tag)), beside(draw, tag)),
  );
  single(
    "(a) binary content",
    join(flipped(focus("binary content changed on one side", draw, tag)), beside(draw, tag)),
  );
  single(
    "(a) a link's target",
    join(flipped(focus("a link's target changed on one side", draw, tag)), beside(draw, tag)),
  );
  single(
    "(a) names on the object prototype",
    join(focus("names on the object prototype", draw, tag), beside(draw, tag)),
  );
  single(
    "(a) a path onto also changed to the same bytes",
    join(focus("both make the same change", draw, tag), beside(draw, tag)),
  );

  for (const [label, last] of [
    ["(a) a later commit changes what the commit before it changed", v2],
    ["(a) a commit undoes the commit before it", v0],
  ] as const) {
    // The second commit changes the file the first one changed, or puts it back. Merged over the first commit's parent,
    // the first would conflict and the second would keep the change.
    const around = beside(draw, tag);
    const p = `${tag}p${draw.part()}`;
    const base = make([], [...around.base, file(p, v0)]);
    const onto = make([base], [...around.ours, file(p, v0)]);
    const first = make([base], [...around.theirs, file(p, v1)]);
    const second = make([first], [...around.theirs, file(p, last)]);
    add(label, upstreamFor(base, onto), second, onto);
  }

  // (b) nothing to do
  {
    const around = beside(draw, tag);
    const base = make([], around.base);
    const onto = make([base], around.ours);
    const commit = make([base], around.theirs);
    const merged = make([commit, onto], around.theirs);
    add("(b) the commit is reached by the upstream", merged, commit, onto);
  }

  {
    const around = beside(draw, tag);
    const base = make([], around.base);
    const commit = make([base], around.theirs);
    const onto = make([commit], [...around.theirs, file(`${tag}u${draw.part()}`, v1)]);
    add("(b) the commit is reached by onto only", base, commit, onto);
  }

  // (c) empty commits
  {
    const around = beside(draw, tag);
    const base = make([], around.base);
    const onto = make([base], around.ours);
    const commit = make([base], around.base);
    add("(c) a commit that starts empty", upstreamFor(base, onto), commit, onto);
  }

  {
    const x = `${tag}x${draw.part()}`;
    const around = beside(draw, tag);
    const base = make([], [...around.base, file(x, v0)]);
    const onto = make([base], [...around.ours, file(x, v1)]);
    const commit = make([base], [...around.base, file(x, v1)]);
    add("(c) a commit that becomes empty", upstreamFor(base, onto), commit, onto);
  }

  // (d) what is kept: one commit for each class of signature, each with a message of a class of its own
  {
    const around = beside(draw, tag);
    const base = make([], around.base);
    const onto = make([base], around.ours);
    const messages = messageVariants(draw.word()).filter(([label]) => label !== "a NUL");
    let parent = base;
    let files = around.theirs;

    for (const [i, [, author]] of signatureVariants(draw.signature(draw.int(4_000_000_000))).entries()) {
      files = grown(i, files);
      parent = make([parent], files, { author, message: at(messages, i)[1] });
    }

    add(
      "(d) every message class but the NUL and every signature class, one for each commit",
      upstreamFor(base, onto),
      parent,
      onto,
    );
  }

  // (k) messages that end in a character of one, three and four bytes, by a short committer, so a settings' committer is longer
  {
    const around = beside(draw, tag);
    const base = make([], around.base);
    const onto = make([base], around.ours);
    const author = draw.signature(draw.int(4_000_000_000));
    let parent = base;
    let files = around.theirs;

    for (const [i, [, message]] of edgeMessages(draw.word()).entries()) {
      files = grown(i, files);
      parent = make([parent], files, {
        author,
        message,
        committer: { ...SHORT_COMMITTER, seconds: BASE_SECONDS + nodes.length },
      });
    }

    add(
      "(k) three commits that end in a character of one, three and four bytes",
      upstreamFor(base, onto),
      parent,
      onto,
    );
  }

  // (n) onto already reaches the first commit of the branch, so that commit is left out
  {
    const around = beside(draw, tag);
    const base = make([], around.base);
    const first = make([base], around.theirs);
    const second = make([first], grown(2, filesAt(first)));
    const third = make([second], grown(3, filesAt(second)));
    const onto = make([first], [...filesAt(first), file(`${tag}n${draw.part()}`, v1)]);
    add("(n) onto already reaches the first commit of the branch", base, third, onto);
  }

  // (e) conflicts
  {
    // The first commit conflicts with onto on `x`. The second would conflict on `y`, but is never merged.
    const [x, y] = [`${tag}x${draw.part()}`, `${tag}y${draw.part()}`];
    const word = draw.word();
    const line = (side: string): Uint8Array => utf8(`${side}:${word}\n`);
    const base = make([], [file(x, line("b")), file(y, line("b"))]);
    const onto = make([base], [file(x, line("o")), file(y, line("o"))]);
    const first = make([base], [file(x, line("t")), file(y, line("b"))]);
    const second = make([first], [file(x, line("t")), file(y, line("t"))]);
    add("(e) conflicts at the first own commit, and again at the second", base, second, onto);
  }

  {
    // The third commit conflicts with onto on `x`, and changes `q` again, which the first commit changed: merged over the
    // first commit's parent, `q` would conflict too.
    const [x, q, kept] = [`${tag}x${draw.part()}`, `${tag}q${draw.part()}`, `${tag}k${draw.part()}`];
    const word = draw.word();
    const line = (side: string): Uint8Array => utf8(`${side}:${word}\n`);
    const base = make([], [file(x, line("x0")), file(q, line("q0")), file(kept, v0)]);
    const onto = make([base], [file(x, line("xo")), file(q, line("q0")), file(kept, v0)]);
    const first = make([base], [file(x, line("x0")), file(q, line("q1")), file(kept, v0)]);
    const second = make([first], [file(x, line("x0")), file(q, line("q1")), file(kept, v1)]);
    const third = make([second], [file(x, line("x3")), file(q, line("q2")), file(kept, v1)]);
    add("(e) conflicts at the third, after two clean ones that the third changes again", base, third, onto);
  }

  for (const label of MERGE_CLASSES.slice(13)) {
    single(`(e) ${label}`, join(focus(label, draw, tag), beside(draw, tag)));
  }

  // (f) merge commits among the own commits
  {
    const around = beside(draw, tag);
    const base = make([], around.base);
    const onto = make([base], around.ours);
    const sideFile = file(`${tag}s${draw.part()}`, v1);
    const side = make([base], [...around.base, sideFile]);
    const first = make([base], around.theirs);
    const merge = make([first, side], [...around.theirs, sideFile]);
    const last = make([merge], filesAt(merge));
    add("(f) one merge commit among the own commits", base, last, onto);
  }

  const merges = (label: string, count: number): void => {
    const around = beside(draw, tag);
    const base = make([], around.base);
    const onto = make([base], around.ours);
    let tip = make([base], around.theirs);

    for (let i = 0; i < count; i++) {
      const side = make([base], [...around.base, file(`${tag}s${i}${draw.part()}`, draw.blob())]);
      tip = make([make([tip, side], around.theirs)], around.theirs);
    }

    add(label, base, tip, onto);
  };

  merges("(f) two merge commits among the own commits", 2);
  merges("(f) three merge commits among the own commits", 3);

  {
    // A merge commit the upstream reaches is no own commit: the rebase goes on from it.
    const around = beside(draw, tag);
    const base = make([], around.base);
    const [leftFile, rightFile] = [file(`${tag}l${draw.part()}`, v1), file(`${tag}r${draw.part()}`, v2)];
    const left = make([base], [...around.base, leftFile]);
    const right = make([base], [...around.base, rightFile]);
    const joined = [...around.base, leftFile, rightFile];
    const merge = make([left, right], joined);

    const [ontoFile, firstFile, secondFile] = [
      file(`${tag}u${draw.part()}`, v0),
      file(`${tag}c${draw.part()}`, v1),
      file(`${tag}e${draw.part()}`, v2),
    ];

    // The new base is a branch of its own: it does not reach the merge commit, which only the upstream does.
    const onto = make([base], [...joined, ontoFile]);
    const first = make([merge], [...joined, firstFile]);
    const second = make([first], [...joined, firstFile, secondFile]);
    add("(f) a merge commit below the upstream", merge, second, onto);
  }

  // (g) roots
  {
    const around = beside(draw, tag);
    const base = make([], around.base);
    const onto = make([base], around.ours);
    const root = make([], around.theirs);
    const commit = make([root], grown(1, around.theirs));
    add("(g) own commits that reach a root", base, commit, onto);
  }

  {
    const around = beside(draw, tag);
    const base = make([], around.base);
    const onto = make([base], around.ours);
    const root = make([], around.theirs);
    const [left, right] = [make([root], grown(1, around.theirs)), make([root], grown(2, around.theirs))];
    const merge = make([left, right], around.theirs);
    const commit = make([merge], grown(3, around.theirs));
    add("(g) a merge commit and a root together", base, commit, onto);
  }

  // (l) a NUL in an own commit's message, which is refused before any commit is made
  {
    const around = beside(draw, tag);
    const [, nul] = at(nulMessages(draw.word()), 1);
    const base = make([], around.base);
    const onto = make([base], around.ours);
    const first = make([base], around.theirs);
    const second = make([first], grown(1, filesAt(first)));
    const third = make([second], grown(2, filesAt(second)), { message: nul });
    add("(l) a NUL in the third message, after two clean commits", base, third, onto);
  }

  {
    // The first commit conflicts with onto and the second holds the NUL: the NUL is found first, before any merge.
    const [x, y] = [`${tag}x${draw.part()}`, `${tag}y${draw.part()}`];
    const word = draw.word();
    const line = (side: string): Uint8Array => utf8(`${side}:${word}\n`);
    const [, nul] = at(nulMessages(draw.word()), 0);
    const base = make([], [file(x, line("b")), file(y, line("b"))]);
    const onto = make([base], [file(x, line("o")), file(y, line("b"))]);
    const first = make([base], [file(x, line("t")), file(y, line("b"))]);
    const second = make([first], [file(x, line("t")), file(y, line("t"))], { message: nul });
    add("(l) a NUL in the second message, after a commit that conflicts", base, second, onto);
  }

  return { history: { nodes, refs: refsFor(draw, nodes.length), shallow: [] }, cases };
};

/** What a rebase is compared against `git rebase` for: the commits `git rebase --force-rebase` drops, besides the call's own. */
export const GIT_DROPS: ReadonlyArray<string> = ["a commit that becomes empty", "a patch the upstream already holds"];

export const AGAINST_GIT_CLASSES: ReadonlyArray<string> = [
  "a commit that starts empty",
  "a commit that becomes empty",
  "a patch the upstream already holds",
  "a rename on one side and a change on the other",
  "the same rename on both",
  "a file added in a folder the other side renamed",
  "a message with no final newline",
  "a message with leading blank lines",
  "a message with leading lines of spaces and tabs",
];

/** One rebase to compare with `git rebase`: the three commits by index. */
export interface AgainstGitCase {
  readonly label: string;
  readonly upstream: number;
  readonly commit: number;
  readonly onto: number;
}

/**
 * A history with one small branch for each class of `AGAINST_GIT_CLASSES`, each with files git's rename detection can follow (ten
 * lines of text, so a moved file is the same file). The call and `git rebase --force-rebase` are asked the same question about each.
 */
export const againstGitCarrier = (
  texture: Texture,
): { readonly history: History; readonly cases: ReadonlyArray<AgainstGitCase> } => {
  const draw = new Draw(texture);
  const { nodes, commit } = commits(draw);
  const cases: Array<AgainstGitCase> = [];

  const ten = (word: string, changed = -1): string =>
    Array.from({ length: 10 }, (_, i) => (i === changed ? `${word} changed\n` : `${word} line ${i}\n`)).join("");

  const one = (
    label: string,
    base: ReadonlyArray<FileSpec>,
    onto: ReadonlyArray<FileSpec>,
    own: ReadonlyArray<FileSpec>,
    message?: string,
  ) => {
    const b = commit([], base);
    const o = commit([b], onto);
    const c = commit([b], own);

    if (message !== undefined) {
      nodes[c] = { ...nodeAtIndex({ nodes, refs: [], shallow: [] }, c), message };
    }

    cases.push({ label, upstream: b, commit: c, onto: o });
  };

  const [a, z, extra] = [`a${draw.part()}`, `z${draw.part()}`, `e${draw.part()}`];
  const [w1, w2, w3] = [draw.word(), draw.word(), draw.word()];
  const moved = `r${draw.part()}/${a}`;
  const kept = textFile(z, ten(w3));

  one(
    "a commit that starts empty",
    [textFile(a, ten(w1)), kept],
    [textFile(a, ten(w1)), kept, textFile(extra, ten(w2))],
    [textFile(a, ten(w1)), kept],
  );

  one(
    "a commit that becomes empty",
    [textFile(a, ten(w1)), kept],
    [textFile(a, ten(w1, 4)), kept],
    [textFile(a, ten(w1, 4)), kept],
  );

  {
    // The upstream holds the same change as the branch, made on the same base: its patch is the branch's.
    const b = commit([], [textFile(a, ten(w1)), kept]);
    const u = commit([b], [textFile(a, ten(w1, 4)), kept]);
    const c = commit([b], [textFile(a, ten(w1, 4)), kept]);
    cases.push({ label: "a patch the upstream already holds", upstream: u, commit: c, onto: u });
  }

  one(
    "a rename on one side and a change on the other",
    [textFile(a, ten(w1)), kept],
    [textFile(moved, ten(w1)), kept],
    [textFile(a, ten(w1, 4)), kept],
  );

  one(
    "the same rename on both",
    [textFile(a, ten(w1)), kept],
    [textFile(moved, ten(w1)), kept],
    [textFile(moved, ten(w1, 4)), kept],
  );

  {
    const folder = `d${draw.part()}`;
    const moves = `n${draw.part()}`;
    const inside = (name: string, i: number, words: string): FileSpec => textFile(`${name}/f${i}`, ten(words));
    const texts = [w1, `${w1}${w1}`, `${w2}${w2}${w2}`];
    const base = [...texts.map((words, i) => inside(folder, i, words)), kept];

    one(
      "a file added in a folder the other side renamed",
      base,
      [...texts.map((words, i) => inside(moves, i, words)), kept],
      [...base, textFile(`${folder}/new${draw.part()}`, ten(w3))],
    );
  }

  one(
    "a message with no final newline",
    [textFile(a, ten(w1)), kept],
    [textFile(a, ten(w1)), kept, textFile(extra, ten(w2))],
    [textFile(a, ten(w1)), kept, textFile(`${extra}-own`, ten(w3))],
    "no final newline",
  );

  one(
    "a message with leading blank lines",
    [textFile(a, ten(w1)), kept],
    [textFile(a, ten(w1)), kept, textFile(extra, ten(w2))],
    [textFile(a, ten(w1)), kept, textFile(`${extra}-own`, ten(w3))],
    "\n\nleading blank lines\n",
  );

  {
    // `git rebase` also skips a line that holds only spaces and tabs; the first line with text keeps its own spaces.
    const blank = Array.from({ length: 1 + draw.int(3) }, () => (draw.int(2) === 0 ? " " : "\t")).join("");
    const first = draw.int(2) === 0 ? "" : " ";

    one(
      "a message with leading lines of spaces and tabs",
      [textFile(a, ten(w1)), kept],
      [textFile(a, ten(w1)), kept, textFile(extra, ten(w2))],
      [textFile(a, ten(w1)), kept, textFile(`${extra}-spaced`, ten(w3))],
      `${blank}\n${draw.int(2) === 0 ? "\n" : ""}${first}${w2}\n`,
    );
  }

  return { history: { nodes, refs: [], shallow: [] }, cases };
};
