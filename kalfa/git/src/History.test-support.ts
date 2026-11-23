// The history value and its generators, shared by every adapter's laws. HistoryTest.ts exports the part a caller of
// `/test/History` needs; the rest is for this package's own laws.
// A history is plain data: commits by index (a parent has a lower index), refs by name, and the indexes
// of shallow commits. It names no id: each adapter's seeder turns it into a store and hands back the ids.
// The model at the bottom answers what a walk, a merge base and an ancestor question must give, by index,
// so a law compares an adapter with the model and never with another adapter.
//
// A generator's reach is part of its law: every list named `*_CLASSES` below is a class the laws check in
// every run, each one applied to the run's drawn value, so a missing class fails a law loudly.
import { Arbitrary, Schema } from "effect";

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
