// What the laws of `@kalfa/ledger` share: the generators, the forms a secret is written in elsewhere, and the one wrapper a package above makes.
// Each law applies, to each value it draws, one made from it for every class the plan names, so every class is reached in every run and no
// run can pass on less. The package may not import another kalfa package, so the helpers here are this package's own copy of the shape
// `@kalfa/secrets`'s test support has (the plan's finding 2).
import { Arbitrary, Array as Arr, Predicate, Redacted, Result, Schema } from "effect";
import { Base64, Base64Url } from "effect/encoding";
import * as Entry from "./Entry.ts";
import * as EntryId from "./EntryId.ts";
import * as Errors from "./Errors.ts";

/** The shared seed: a fixed seed makes a red run repeat. */
export const SEED = 119120;

// ---- the small tools the generators are built from

/** A whole number from `minimum` to `maximum`. */
const between = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

/** One of the choices. */
const pick = <const A>(choices: ReadonlyArray<A>): Arbitrary.Arbitrary<A> =>
  between(0, choices.length - 1).pipe(Arbitrary.map((index) => Arr.getUnsafe(choices, index)));

/** What an arbitrary draws. */
type Drawn<A> = A extends Arbitrary.Arbitrary<infer B> ? B : never;

/** `length` characters, each one of `chars`. */
const text = (chars: ReadonlyArray<string>, length: number): Arbitrary.Arbitrary<string> =>
  Arbitrary.array(pick(chars), { minLength: length, maxLength: length }).pipe(Arbitrary.map((drawn) => drawn.join("")));

/** Between `minLength` and `maxLength` characters, each one of `chars`. */
const textBetween = (chars: ReadonlyArray<string>, minLength: number, maxLength: number): Arbitrary.Arbitrary<string> =>
  Arbitrary.array(pick(chars), { minLength, maxLength }).pipe(Arbitrary.map((drawn) => drawn.join("")));

const LOWER = [..."abcdefghijklmnopqrstuvwxyz"];

const UPPER = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

const DIGITS = [..."0123456789"];

/** The characters of an entry name: letters, digits, `-` and `_`. */
const NAME_CHARS: ReadonlyArray<string> = [...LOWER, ...UPPER, ...DIGITS, "-", "_"];

/** The characters of an entry id: a name's, and `.` and `:` as well. */
const ID_CHARS: ReadonlyArray<string> = [...NAME_CHARS, ".", ":"];

/** The longest entry id, and the longest entry name (255 less the `.h:` and the 43 characters of a hash). */
const ID_LIMIT = 255;

export const NAME_LIMIT = 209;

/** The marker's alphabet: letters of both cases and digits. */
const ALNUM_ANY_CASE = [...LOWER, ...DIGITS, ...UPPER];

/** A value a test must not be able to hide from a search: a text a drawn value cannot hold by chance. */
const marker: Arbitrary.Arbitrary<string> = Arbitrary.array(pick(ALNUM_ANY_CASE), {
  minLength: 8,
  maxLength: 12,
}).pipe(Arbitrary.map((chars) => `qz9${chars.join("")}`));

// ---- ids and names: the plan's classes (f) and (w), made from one drawn texture

/** A text and the class it is of: `id` says which class, so a failure names it. */
interface Case {
  readonly id: string;
  readonly text: string;
}

/** What every id law draws once: texts of the allowed characters, and a place and a length to put a bad character at. */
export const idTexture = Arbitrary.all({
  id: text(ID_CHARS, ID_LIMIT),
  name: text(NAME_CHARS, NAME_LIMIT),
  length: between(1, ID_LIMIT - 1),
  nameLength: between(1, NAME_LIMIT - 1),
  place: between(0, ID_LIMIT - 1),
  mixed: Arbitrary.array(
    pick([...ID_CHARS, " ", "/", "\\", "é", "设", "😀", "\u0000", "\n", "\r", "\t", "\ud800", "５", "%", "+", "#"]),
    { maxLength: 300 },
  ).pipe(Arbitrary.map((drawn) => drawn.join(""))),
});

type IdTexture = Drawn<typeof idTexture>;

/** The characters an id and a name refuse, one for each way a character can be wrong: each with the name a failure gives it. */
const BAD_CHARS: ReadonlyArray<readonly [string, string]> = [
  ["a space", " "],
  ["a slash", "/"],
  ["a backslash", "\\"],
  ["a letter past ASCII", "é"],
  ["a letter of another script", "设"],
  ["a full-width digit", "５"],
  ["an emoji", "😀"],
  ["a lone surrogate", "\ud800"],
  ["a NUL", "\u0000"],
  ["a newline", "\n"],
  ["a tab", "\t"],
  ["a percent sign", "%"],
];

/** The id classes the plan's (f) lists that a Schema must take. */
export const ACCEPTED_ID_CLASSES = [
  "one character",
  "255 characters",
  "a length between",
  "every kind of character",
] as const;

/** Ids an id Schema must take: one made for each class. */
export const acceptedIds = (texture: IdTexture): ReadonlyArray<Case> => [
  { id: "one character", text: texture.id.slice(0, 1) },
  { id: "255 characters", text: texture.id },
  { id: "a length between", text: texture.id.slice(0, texture.length) },
  { id: "every kind of character", text: ID_CHARS.join("") },
];

/** Ids an id Schema must refuse: the empty text, 256 characters, and a bad character of each kind in each of three places. */
export const refusedIds = (texture: IdTexture): ReadonlyArray<Case> => [
  { id: "empty", text: "" },
  { id: "256 characters", text: `${texture.id}${texture.id.slice(0, 1)}` },
  { id: "256 characters of one kind", text: "a".repeat(ID_LIMIT + 1) },
  ...BAD_CHARS.flatMap(([id, bad]) => [
    {
      id: `${id} in the middle`,
      text: `${texture.id.slice(0, texture.place)}${bad}${texture.id.slice(texture.place + 1)}`,
    },
    { id: `${id} at the start`, text: `${bad}${texture.id.slice(0, texture.length)}` },
    { id: `${id} at the end`, text: `${texture.id.slice(0, texture.length)}${bad}` },
  ]),
];

/** The name classes a name Schema must take. */
export const ACCEPTED_NAME_CLASSES = [
  "one character",
  "209 characters",
  "a length between",
  "every kind of character",
] as const;

/** Names a name Schema must take. */
export const acceptedNames = (texture: IdTexture): ReadonlyArray<Case> => [
  { id: "one character", text: texture.name.slice(0, 1) },
  { id: "209 characters", text: texture.name },
  { id: "a length between", text: texture.name.slice(0, texture.nameLength) },
  { id: "every kind of character", text: NAME_CHARS.join("") },
];

/** Names a name Schema must refuse: an id's own dot and colon, 210 characters, the empty text, and a bad character of each kind. */
export const refusedNames = (texture: IdTexture): ReadonlyArray<Case> => [
  { id: "empty", text: "" },
  { id: "210 characters", text: `${texture.name}${texture.name.slice(0, 1)}` },
  { id: "a dot in the middle", text: `${texture.name.slice(0, texture.nameLength)}.${texture.name.slice(0, 3)}` },
  { id: "a dot at the end", text: `${texture.name.slice(0, texture.nameLength)}.` },
  { id: "a colon in the middle", text: `${texture.name.slice(0, texture.nameLength)}:${texture.name.slice(0, 3)}` },
  { id: "a colon at the end", text: `${texture.name.slice(0, texture.nameLength)}:` },
  { id: "a name and a hash", text: `${texture.name.slice(0, 10)}.h:${"a".repeat(43)}` },
  ...BAD_CHARS.flatMap(([id, bad]) => [
    {
      id: `${id} in the middle`,
      text: `${texture.name.slice(0, texture.nameLength)}${bad}${texture.name.slice(0, 3)}`,
    },
    { id: `${id} at the end`, text: `${texture.name.slice(0, texture.nameLength)}${bad}` },
  ]),
];

/** The characters a text is made of: whether an id, or a name, may hold each one. The test's own oracle, written with no pattern. */
const allowed = (chars: ReadonlyArray<string>): ReadonlySet<string> => new Set(chars);

const ID_SET = allowed(ID_CHARS);

const NAME_SET = allowed(NAME_CHARS);

/** Whether a text is an id by the plan's rule: 1 to 255 characters, each an allowed one. Looks at each character, never through a pattern. */
export const isIdText = (candidate: string): boolean =>
  candidate.length >= 1 && candidate.length <= ID_LIMIT && [...candidate].every((each) => ID_SET.has(each));

/** Whether a text is a name by the plan's rule: 1 to 209 characters, each an allowed one. */
export const isNameText = (candidate: string): boolean =>
  candidate.length >= 1 && candidate.length <= NAME_LIMIT && [...candidate].every((each) => NAME_SET.has(each));

// ---- child ids: the plan's classes (t) to (w), made from one drawn texture

/** What every child law draws once: a name of drawn length, one of 209 characters, a parent of 255 characters, a second name and a character to change. */
export const childTexture = Arbitrary.all({
  name: textBetween(NAME_CHARS, 1, NAME_LIMIT),
  long: text(NAME_CHARS, NAME_LIMIT),
  other: textBetween(NAME_CHARS, 1, NAME_LIMIT),
  pool: text(ID_CHARS, ID_LIMIT),
  flip: pick(ID_CHARS),
  place: between(0, 3),
});

type ChildTexture = Drawn<typeof childTexture>;

/** A name and a parent, and the class of the pair. The names are made by `Schema`, so the pair is typed. */
interface Pair {
  readonly id: string;
  readonly name: EntryId.EntryName;
  readonly parent: EntryId.EntryId;
}

const entryName = Schema.decodeUnknownSync(EntryId.EntryName);

const entryId = Schema.decodeUnknownSync(EntryId.EntryId);

/** A character that is not `char`, among the id characters. */
const otherThan = (char: string, flip: string): string => (flip === char ? (char === "a" ? "b" : "a") : flip);

/** A name that is not `name`: another of the same shape, with its first character changed when the drawn one happens to be the same. */
const differentName = (name: string, other: string): string =>
  other === name ? `${name.slice(0, -1)}${name.endsWith("a") ? "b" : "a"}` : other;

/** The pair classes the plan's (t) to (w) list, in the order `pairs` gives them. */
export const PAIR_CLASSES = [
  "joined 254",
  "joined 255",
  "joined 256",
  "a parent of 255",
  "a name of 209 joined to 255",
  "a name of 209 and a parent of 255",
  "a name of 1 joined to 255",
  "a name of 1 and a parent of 255",
  "a parent with a colon",
  "a parent that starts with a colon",
  "a parent with a dot",
  "a parent that is a plain child",
  "a parent that is a hashed child",
  "a short parent",
  "a second name, plain",
  "a second name, hashed",
  "a parent changed in its last character, plain",
  "a parent changed in its last character, hashed",
  "a parent changed in its first character, hashed",
] as const;

/**
 * The pairs of a name and a parent a child law reads: one made for each class of (t), (u), (v) and (w). Each pair is a way two parts can meet, and the
 * pairs of one drawn texture are read together, so a law can look for a collision between them.
 */
export const pairs = (texture: ChildTexture): ReadonlyArray<Pair> => {
  const { name, long, pool } = texture;

  const make = (id: string, n: string, parent: string): Pair => ({
    id,
    name: entryName(n),
    parent: entryId(parent),
  });

  // The parent that makes `<name>:<parent>` exactly `joined` characters long.
  const fitting = (n: string, joined: number): string => pool.slice(0, joined - n.length - 1);

  const second = differentName(name, texture.other);

  const lastChanged = (parent: string): string =>
    `${parent.slice(0, -1)}${otherThan(parent.at(-1) ?? "a", texture.flip)}`;

  const firstChanged = (parent: string): string => `${otherThan(parent.at(0) ?? "a", texture.flip)}${parent.slice(1)}`;

  const shortParent = pool.slice(0, 20);

  const colon = texture.place + 2;

  return [
    make("joined 254", name, fitting(name, 254)),
    make("joined 255", name, fitting(name, 255)),
    make("joined 256", name, fitting(name, 256)),
    make("a parent of 255", name, pool),
    make("a name of 209 joined to 255", long, fitting(long, 255)),
    make("a name of 209 and a parent of 255", long, pool),
    make("a name of 1 joined to 255", "a", fitting("a", 255)),
    make("a name of 1 and a parent of 255", "a", pool),
    make("a parent with a colon", name, `${shortParent.slice(0, colon)}:${shortParent.slice(colon)}`),
    make("a parent that starts with a colon", name, `:${shortParent}`),
    make("a parent with a dot", name, `${shortParent.slice(0, colon)}.${shortParent.slice(colon)}`),
    make("a parent that is a plain child", name, `${second}:${shortParent}`),
    make("a parent that is a hashed child", name, `${second}.h:${pool.slice(0, 43)}`),
    make("a short parent", name, shortParent),
    make("a second name, plain", second, shortParent),
    make("a second name, hashed", second, pool),
    make("a parent changed in its last character, plain", name, lastChanged(shortParent)),
    make("a parent changed in its last character, hashed", name, lastChanged(pool)),
    make("a parent changed in its first character, hashed", name, firstChanged(pool)),
  ];
};

// ---- errors: one of each of the eight, made from one drawn texture

const generated = Arbitrary.schema;

/**
 * What every error law draws once: a value for each field of each of the eight errors. The numbers and the texts come from Effect's own schemas, never
 * from the error's field, so a field the build types wrongly is a field a law catches. Only `part` is read from its field, since the field is its list.
 */
export const errorTexture = Arbitrary.all({
  part: generated(Errors.BadEntry.fields.part),
  bytes: generated(Schema.Int),
  limit: generated(Schema.Int),
  admission: generated(Schema.String),
  reason: generated(Schema.String),
  expected: generated(Entry.Revision),
  actual: generated(Entry.Revision),
  cause: generated(Schema.Json),
});

type ErrorTexture = Drawn<typeof errorTexture>;

/** The nine errors a package may answer with, as a union a test can list. */
export type AnyError = Errors.Refusal | Errors.Failure;

/** The tags of the six refusals and of the three failures, in the order `eachError` gives them. */
export const REFUSAL_TAGS = [
  "BadEntry",
  "IdReused",
  "TooBig",
  "AdmissionRefused",
  "RevisionConflict",
  "EmptyTags",
] as const;

export const FAILURE_TAGS = ["Unreachable", "BadRow", "StorageFailed"] as const;

/** An error, and the fields it was made from: the test's own record of what the error must hold. */
interface Made {
  readonly error: AnyError;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** One of each of the nine errors, made from the texture's fields, each beside the fields it was given. */
export const eachError = (texture: ErrorTexture): ReadonlyArray<Made> => {
  const bad = { part: texture.part };
  const big = { bytes: texture.bytes, limit: texture.limit };
  const refused = { admission: texture.admission, reason: texture.reason };
  const conflict = { expected: texture.expected, actual: texture.actual };
  const cause = Redacted.make(texture.cause);

  return [
    { error: new Errors.BadEntry(bad), fields: bad },
    { error: new Errors.IdReused({}), fields: {} },
    { error: new Errors.TooBig(big), fields: big },
    { error: new Errors.AdmissionRefused(refused), fields: refused },
    { error: new Errors.RevisionConflict(conflict), fields: conflict },
    { error: new Errors.EmptyTags({}), fields: {} },
    { error: new Errors.Unreachable({ cause }), fields: { cause } },
    { error: new Errors.BadRow({ cause }), fields: { cause } },
    { error: new Errors.StorageFailed({ cause }), fields: { cause } },
  ];
};

/**
 * An error as plain data: every property it owns by name, the hidden `cause` of a failure included whether it is listed or not, and the `stack`
 * left out, which is a place and not a field. A hidden cause stays hidden, and two errors that mean the same make data that `Equal.equals` calls equal,
 * since a hidden value is equal to another by what it holds.
 */
export const shape = (error: AnyError): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    Object.entries(Object.getOwnPropertyDescriptors(error))
      .filter(([name]) => name !== "stack")
      .map(([name, described]) => [name, described.value]),
  );

// ---- the wrapper a package above makes

/**
 * What the pattern says a package above writes: its own error that holds a Ledger failure as its reason, and the same failure as its cause.
 *
 * @category wrappers
 */
export class ChatUnavailable extends Schema.TaggedError<ChatUnavailable, { readonly brand: unique symbol }>()(
  "ChatUnavailable",
  { reason: Errors.Failure },
) {
  override readonly cause = this.reason;
}

/**
 * Its refusal twin: a package above holds a Ledger refusal as its reason.
 *
 * @category wrappers
 */
export class ChatRefused extends Schema.TaggedError<ChatRefused, { readonly brand: unique symbol }>()("ChatRefused", {
  reason: Errors.Refusal,
}) {}

// ---- secrets: the plan's (y), a value and the forms it is written in elsewhere

/** Pieces a secret may hold: quotes, backslashes, CR and LF, control characters, letters past ASCII and an emoji. */
const PIECES = [
  '"',
  "'",
  "\\",
  "\r",
  "\n",
  "\r\n",
  "\t",
  "\u0000",
  "\u0001",
  "\u001f",
  " ",
  "é",
  "设",
  "😀",
  "&",
  "=",
  "%",
  "+",
  "/",
  "?",
  "#",
  "<",
] as const;

/** The three shapes of a cause a client's own error can have: an error that quotes a value, a text, and a record. */
const CAUSE_FORMS = ["error", "text", "record"] as const;

/** What every secret law draws once: a marker, the pieces around it, and the shape of the cause that quotes it. */
export const secretTexture = Arbitrary.all({
  core: marker,
  tail: Arbitrary.array(pick(PIECES), { minLength: 1, maxLength: 8 }),
  form: pick(CAUSE_FORMS),
});

type SecretTexture = Drawn<typeof secretTexture>;

/** The whole secret of a texture. */
const secretText = (texture: SecretTexture): string => `${texture.core}${texture.tail.join("")}`;

/** What a driver's error can be: an error that quotes a value, a text, or a record. */
type Quoted = Error | string | { readonly reason: string; readonly nested: { readonly reason: string } };

/**
 * The cause a driver's error holds when it quotes the secret: the secret in its message, in the error under it, and under that; or as a text, or in a
 * record.
 */
export const quoting = (texture: SecretTexture): Quoted => {
  const secret = secretText(texture);

  return {
    error: new Error(`bad value ${secret}`, { cause: new Error(`nested ${secret}`, { cause: secret }) }),
    text: secret,
    record: { reason: secret, nested: { reason: secret } },
  }[texture.form];
};

/** The forms a text is written in elsewhere: as it is, as JSON text holds it, in base64, in base64url, and percent-encoded. */
const forms = (value: string): ReadonlyArray<string> => [
  value,
  JSON.stringify(value).slice(1, -1),
  Base64.encode(value),
  Base64Url.encode(value),
  encodeURIComponent(value),
];

/**
 * The base64 text a marker makes inside a longer text, at each of the three alignments a base64 writer meets it: the first and last groups are cut
 * off, since they mix the marker with what is around it, and what stays is the same wherever the marker sits.
 */
const inside = (core: string, encode: (input: string) => string): ReadonlyArray<string> =>
  [0, 1, 2].map((offset) => encode(`${"A".repeat(offset)}${core}`).slice(offset > 0 ? 4 : 0, -4));

/** Every text that shows a secret: its forms, its marker's forms, the marker's base64 inside a longer text, and the first eight characters of the marker. */
export const needles = (texture: SecretTexture): ReadonlyArray<string> =>
  [
    ...forms(secretText(texture)),
    ...forms(texture.core),
    ...inside(texture.core, Base64.encode),
    ...inside(texture.core, Base64Url.encode),
    texture.core.slice(0, 8),
  ].filter((each) => each !== "");

/** The needles that some text holds, each cut to its first 24 characters so a failure names it. */
export const showsAny = (texts: ReadonlyArray<string>, found: ReadonlyArray<string>): ReadonlyArray<string> =>
  found.filter((needle) => texts.some((each) => each.includes(needle))).map((needle) => needle.slice(0, 24));

/** The most objects a search reaches: a getter that makes a new object each time it is read has no end. */
const REACH_LIMIT = 500;

/** An object and every prototype above it, up to the plain ones: the places a property can be found by its name. */
const lineage = (start: object): ReadonlyArray<object> => {
  const found: Array<object> = [];
  let at: object | null = start;

  while (
    at !== null &&
    at !== Object.prototype &&
    at !== Error.prototype &&
    at !== Function.prototype &&
    at !== Array.prototype
  ) {
    found.push(at);
    at = Object.getPrototypeOf(at);
  }

  return found;
};

/**
 * Every text a value's properties reach, names and symbols' descriptions included, inherited getters read, cause chains and nested objects too.
 * A getter on a class is a property of every instance, so a leak through one is found.
 */
export const reachable = (root: object): ReadonlyArray<string> => {
  const seen = new Set<object>();
  const found: Array<string> = [];
  const pending: Array<object> = [root];

  while (pending.length > 0) {
    const next = pending.pop();

    if (next === undefined || seen.has(next) || seen.size >= REACH_LIMIT) {
      continue;
    }

    seen.add(next);

    for (const level of lineage(next)) {
      for (const key of Reflect.ownKeys(level)) {
        found.push(String(key));

        const described = Object.getOwnPropertyDescriptor(level, key);

        const read = described?.get;
        const value = read === undefined ? described?.value : Result.getOrUndefined(Result.try(() => read.call(next)));

        if (Predicate.isString(value)) {
          found.push(value);
        } else if (Predicate.isObjectOrArray(value) && !Predicate.isFunction(value)) {
          pending.push(value);
        }
      }
    }
  }

  return found;
};
